#!/usr/bin/env npx tsx
/**
 * Post-migration functional check: invokes the API Lambdas directly with
 * authenticated API Gateway v2 events and compares old vs new environments.
 *
 * 1. Parity — every read endpoint is called in both accounts as the same user
 *    (old sub vs new sub, from the migration mapping file). Responses must match
 *    once old subs are rewritten to new ones. Only GETs touch the source account.
 * 2. Writes — create/update/delete fill-up and maintenance records, share/unshare,
 *    presign + upload + fetch a photo through the site, exports, summary card,
 *    recalculate. Target account only; re-run `migrate` afterwards to undo them.
 *
 * Usage (from cli/):
 *   npx tsx src/parity-check.ts --env staging [--site https://staging.pawsitivemileage.app]
 */
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { InvokeCommand, LambdaClient } from '@aws-sdk/client-lambda';
import { remapString } from './migrate/remap.js';

const { values: opts } = parseArgs({
  options: {
    env: { type: 'string', default: 'staging' },
    site: { type: 'string' },
    'source-profile': { type: 'string', default: 'bourbonlab-root' },
    'target-profile': { type: 'string', default: 'pawsitivemileage' },
    mapping: { type: 'string' },
    'skip-writes': { type: 'boolean', default: false },
  },
});
const env = opts.env!;
const site = opts.site ?? (env === 'production' ? 'https://pawsitivemileage.app' : `https://${env}.pawsitivemileage.app`);
const mapping = JSON.parse(readFileSync(opts.mapping ?? join(homedir(), '.pawsitivemileage-migration', `${env}-user-map.json`), 'utf8')) as {
  users: Array<{ email: string; oldSub: string; newSub: string }>;
};
const subMap = new Map(mapping.users.map((u) => [u.oldSub, u.newSub]));

const sides = {
  old: { lambda: new LambdaClient({ region: 'us-east-1', profile: opts['source-profile'] }), prefix: `pawsitivemileage-${env}` },
  new: { lambda: new LambdaClient({ region: 'us-east-1', profile: opts['target-profile'] }), prefix: `pawsitivemileage-app-${env}` },
};
type SideName = keyof typeof sides;

interface Call { fn: string; method: string; path: string; params?: Record<string, string>; query?: Record<string, string>; body?: unknown }
interface Result { status: number; body: any }

let seq = 0;
async function invoke(side: SideName, user: { sub: string; email: string }, call: Call): Promise<Result> {
  const event = {
    version: '2.0',
    routeKey: `${call.method} ${call.path}`,
    rawPath: call.path,
    rawQueryString: new URLSearchParams(call.query ?? {}).toString(),
    headers: { 'content-type': 'application/json' },
    queryStringParameters: call.query,
    pathParameters: call.params,
    body: call.body === undefined ? undefined : JSON.stringify(call.body),
    isBase64Encoded: false,
    requestContext: {
      requestId: `parity-${Date.now()}-${seq++}`,
      http: { method: call.method, path: call.path, protocol: 'HTTP/1.1', sourceIp: '127.0.0.1', userAgent: 'parity-check' },
      authorizer: { jwt: { claims: { sub: user.sub, email: user.email }, scopes: [] } },
    },
  };
  const { FunctionName, lambda } = { FunctionName: `${sides[side].prefix}-${call.fn}`, lambda: sides[side].lambda };
  const out = await lambda.send(new InvokeCommand({ FunctionName, Payload: Buffer.from(JSON.stringify(event)) }));
  const payload = JSON.parse(Buffer.from(out.Payload ?? []).toString() || '{}');
  if (out.FunctionError) throw new Error(`${FunctionName} ${call.method} ${call.path}: ${out.FunctionError} ${JSON.stringify(payload).slice(0, 300)}`);
  return { status: payload.statusCode, body: payload.body ? JSON.parse(payload.body) : undefined };
}

/** Drop per-request and time-varying fields before comparing */
const VOLATILE = new Set(['requestId', 'downloadUrl', 'url', 'expiresIn', 'generatedAt']);
function strip(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(strip);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).filter(([k]) => !VOLATILE.has(k)).map(([k, v]) => [k, strip(v)]));
  }
  return value;
}

function diffPaths(a: unknown, b: unknown, path = '$', out: string[] = []): string[] {
  if (out.length > 5) return out;
  if (typeof a !== typeof b || Array.isArray(a) !== Array.isArray(b)) { out.push(`${path}: ${JSON.stringify(a)?.slice(0, 80)} ≠ ${JSON.stringify(b)?.slice(0, 80)}`); return out; }
  if (a && typeof a === 'object') {
    const keys = new Set([...Object.keys(a as object), ...Object.keys(b as object)]);
    for (const k of keys) diffPaths((a as any)[k], (b as any)[k], Array.isArray(a) ? `${path}[${k}]` : `${path}.${k}`, out);
  } else if (a !== b) out.push(`${path}: ${JSON.stringify(a)?.slice(0, 80)} ≠ ${JSON.stringify(b)?.slice(0, 80)}`);
  return out;
}

/** Number of CSV records, honoring quoted fields that contain newlines */
function csvRecordCount(text: string): number {
  let records = 0, inQuotes = false, sawContent = false;
  for (const ch of text) {
    if (ch === '"') inQuotes = !inQuotes;
    if (ch === '\n' && !inQuotes) { if (sawContent) records++; sawContent = false; continue; }
    if (ch !== '\r') sawContent = true;
  }
  return records + (sawContent ? 1 : 0);
}

const failures: string[] = [];
const check = (label: string, ok: boolean, detail = '') => {
  console.log(`  ${ok ? '✔' : '✖'} ${label}${detail ? `  ${detail}` : ''}`);
  if (!ok) failures.push(label);
};

async function parity(user: { email: string; oldSub: string; newSub: string }): Promise<string[]> {
  const asOld = { sub: user.oldSub, email: user.email };
  const asNew = { sub: user.newSub, email: user.email };
  const vehiclesOld = await invoke('old', asOld, { fn: 'vehicleCrud', method: 'GET', path: '/v1/vehicles' });
  const archivedOld = await invoke('old', asOld, { fn: 'vehicleCrud', method: 'GET', path: '/v1/vehicles', query: { status: 'archived' } });
  const vehicleIds: string[] = [...(vehiclesOld.body?.data ?? []), ...(archivedOld.body?.data ?? [])].map((v: { vehicleId: string }) => v.vehicleId);

  const calls: Call[] = [
    { fn: 'userProfile', method: 'GET', path: '/v1/user/profile' },
    { fn: 'vehicleCrud', method: 'GET', path: '/v1/vehicles' },
    { fn: 'vehicleCrud', method: 'GET', path: '/v1/vehicles', query: { status: 'archived' } },
    { fn: 'sharingCrud', method: 'GET', path: '/v1/vehicles/shared' },
    { fn: 'adminStats', method: 'GET', path: '/v1/admin/stats' },
    { fn: 'adminUsers', method: 'GET', path: '/v1/admin/users' },
    { fn: 'adminSchemas', method: 'GET', path: '/v1/admin/schemas' },
  ];
  for (const vehicleId of vehicleIds) {
    const p = { vehicleId };
    const base = `/v1/vehicles/${vehicleId}`;
    calls.push(
      { fn: 'vehicleCrud', method: 'GET', path: base, params: p },
      { fn: 'fillupCrud', method: 'GET', path: `${base}/fillups`, params: p },
      { fn: 'maintenanceCrud', method: 'GET', path: `${base}/maintenance`, params: p },
      { fn: 'maintenanceCrud', method: 'GET', path: `${base}/maintenance/reminders`, params: p },
      { fn: 'maintenanceCrud', method: 'GET', path: `${base}/maintenance/schemas`, params: p },
      { fn: 'analytics', method: 'GET', path: `${base}/analytics`, params: p },
      { fn: 'analytics', method: 'GET', path: `${base}/analytics/yoy`, params: p },
      { fn: 'sharingCrud', method: 'GET', path: `${base}/sharing`, params: p },
    );
  }

  console.log(`\nParity — ${calls.length} read endpoints, ${vehicleIds.length} vehicle(s)`);
  for (const call of calls) {
    const [o, n] = await Promise.all([invoke('old', asOld, call), invoke('new', asNew, call)]);
    const expected = strip(JSON.parse(remapString(JSON.stringify(o.body ?? null), subMap)));
    const diffs = o.status !== n.status ? [`status ${o.status} ≠ ${n.status}`] : diffPaths(expected, strip(n.body ?? null));
    const size = Array.isArray(n.body?.data) ? ` (${n.body.data.length} items)` : '';
    check(`${call.method} ${call.path.replace(/01[0-9A-HJKMNP-TV-Z]{24}/g, '{id}')}${call.query ? '?' + new URLSearchParams(call.query) : ''} → ${n.status}${size}`,
      diffs.length === 0, diffs.join('; '));
  }
  return vehicleIds;
}

async function writes(user: { email: string; newSub: string }, vehicleId: string): Promise<void> {
  const as = { sub: user.newSub, email: user.email };
  const base = `/v1/vehicles/${vehicleId}`;
  const p = { vehicleId };
  const today = new Date().toISOString().slice(0, 10);
  console.log('\nWrites (target only)');

  const vehicle = (await invoke('new', as, { fn: 'vehicleCrud', method: 'GET', path: base, params: p })).body.data;
  const upd = await invoke('new', as, { fn: 'vehicleCrud', method: 'PUT', path: base, params: p, body: { nickname: vehicle.nickname } });
  check('vehicle update', upd.status === 200, `${upd.status}`);

  const fills = (await invoke('new', as, { fn: 'fillupCrud', method: 'GET', path: `${base}/fillups`, params: p })).body.data;
  const list = Array.isArray(fills) ? fills : fills.items ?? [];
  const maxOdo = Math.max(0, ...list.map((f: { odometerReading: number }) => f.odometerReading ?? 0));
  const created = await invoke('new', as, { fn: 'fillupCrud', method: 'POST', path: `${base}/fillups`, params: p,
    body: { date: today, currencySpent: 42.5, gallonsAdded: 12.3, odometerReading: maxOdo + 321, stationName: 'Parity check' } });
  check('fill-up create', created.status === 201, `${created.status} ${created.body?.error ?? ''}`);
  const fillupId = created.body?.data?.fillupId;
  if (fillupId) {
    const fp = { vehicleId, fillupId };
    const got = await invoke('new', as, { fn: 'fillupCrud', method: 'GET', path: `${base}/fillups/${fillupId}`, params: fp });
    check('fill-up read back', got.status === 200 && got.body?.data?.stationName === 'Parity check', `${got.status}`);
    const put = await invoke('new', as, { fn: 'fillupCrud', method: 'PUT', path: `${base}/fillups/${fillupId}`, params: fp, body: { stationName: 'Parity check (edited)' } });
    check('fill-up update', put.status === 200, `${put.status} ${put.body?.error ?? ''}`);
    const del = await invoke('new', as, { fn: 'fillupCrud', method: 'DELETE', path: `${base}/fillups/${fillupId}`, params: fp });
    check('fill-up delete', [200, 204].includes(del.status), `${del.status}`);
  }

  const mcreated = await invoke('new', as, { fn: 'maintenanceCrud', method: 'POST', path: `${base}/maintenance`, params: p,
    body: { datePerformed: today, odometerAtService: maxOdo + 300, cost: 19.99, customTypeName: 'Parity check', notes: 'Parity check' } });
  check('maintenance create', mcreated.status === 201, `${mcreated.status} ${mcreated.body?.error ?? ''}`);
  const recordId = mcreated.body?.data?.recordId;
  if (recordId) {
    const mp = { vehicleId, recordId };
    const put = await invoke('new', as, { fn: 'maintenanceCrud', method: 'PUT', path: `${base}/maintenance/${recordId}`, params: mp, body: { notes: 'Parity check (edited)' } });
    check('maintenance update', put.status === 200, `${put.status} ${put.body?.error ?? ''}`);
    const del = await invoke('new', as, { fn: 'maintenanceCrud', method: 'DELETE', path: `${base}/maintenance/${recordId}`, params: mp });
    check('maintenance delete', [200, 204].includes(del.status), `${del.status}`);
  }

  const share = await invoke('new', as, { fn: 'sharingCrud', method: 'POST', path: `${base}/sharing`, params: p, body: { email: 'parity-check@example.com', permission: 'readonly' } });
  check('share create', [200, 201].includes(share.status), `${share.status} ${share.body?.error ?? ''}`);
  const shareId = share.body?.data?.shareId;
  if (shareId) {
    const del = await invoke('new', as, { fn: 'sharingCrud', method: 'DELETE', path: `${base}/sharing/${shareId}`, params: { vehicleId, shareId } });
    check('share delete', [200, 204].includes(del.status), `${del.status}`);
  }

  const presign = await invoke('new', as, { fn: 'presignUrl', method: 'POST', path: '/v1/upload/presign',
    body: { uploadType: 'receipt-photo', vehicleId, filename: 'parity-check.png', contentType: 'image/png', fileSize: 68 } });
  check('presign', presign.status === 200, `${presign.status} ${presign.body?.error ?? ''}`);
  if (presign.body?.data?.url) {
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');
    const put = await fetch(presign.body.data.url, { method: 'PUT', headers: { 'Content-Type': 'image/png', Origin: site }, body: png });
    check('upload to S3 via presigned URL', put.ok, `${put.status}`);
    const served = await fetch(`${site}/photos/${presign.body.data.key.split('/').map(encodeURIComponent).join('/')}`);
    check('photo served through site', served.ok && served.headers.get('content-type') === 'image/png', `${served.status} ${served.headers.get('content-type')}`);
  }

  for (const kind of ['fillups', 'maintenance'] as const) {
    const exp = await invoke('new', as, { fn: 'exportData', method: 'GET', path: `${base}/export/${kind}`, params: p });
    const dl = exp.body?.data?.downloadUrl ? await fetch(exp.body.data.downloadUrl) : undefined;
    const rows = dl?.ok ? csvRecordCount(await dl.text()) - 1 : -1; // minus header
    check(`export ${kind} CSV`, exp.status === 200 && rows === exp.body.data.recordCount, `${exp.status}, ${rows} rows / recordCount ${exp.body?.data?.recordCount}`);
  }
  const pdf = await invoke('new', as, { fn: 'exportData', method: 'POST', path: `${base}/export/pdf`, params: p, body: {} });
  check('export report (PDF data)', pdf.status === 200, `${pdf.status} ${pdf.body?.error ?? ''}`);
  const card = await invoke('new', as, { fn: 'analytics', method: 'POST', path: `${base}/summary-card`, params: p, body: { year: new Date().getFullYear() } });
  check('summary card', card.status === 200, `${card.status} ${card.body?.error ?? ''}`);
  const recalc = await invoke('new', as, { fn: 'importData', method: 'POST', path: `${base}/recalculate`, params: p, body: {} });
  check('recalculate metrics', recalc.status === 200, `${recalc.status} ${recalc.body?.error ?? ''}`);
}

async function main(): Promise<void> {
  console.log(`parity-check — ${env} (${mapping.users.length} user(s), site ${site})`);
  for (const user of mapping.users) {
    console.log(`\n== ${user.email.replace(/^(.).*(@.*)$/, '$1***$2')}`);
    const vehicleIds = await parity(user);
    if (!opts['skip-writes'] && vehicleIds[0]) await writes(user, vehicleIds[0]);
  }
  if (failures.length) {
    console.error(`\n${failures.length} check(s) FAILED`);
    process.exitCode = 2;
  } else {
    console.log('\nAll checks passed.');
  }
}

main().catch((err) => { console.error(`\nFailed: ${err instanceof Error ? err.message : err}`); process.exit(1); });
