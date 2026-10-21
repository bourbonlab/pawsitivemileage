#!/usr/bin/env npx tsx
/**
 * Live contract conformance check (#16): calls every read endpoint in an environment as each
 * migrated user, via direct Lambda invocation like parity-check, and validates each response
 * against its schema in @pawsitivemileage/contracts. It checks the status and the
 * `{ data, requestId }` envelope.
 *
 * Read-only by default. The CSV export GETs write a file to the exports bucket, so they only
 * run with --include-exports. Admin routes run for users whose profile has isAdmin. Failures
 * list schema paths and messages, never response values.
 *
 * Usage (from cli/):
 *   npx tsx src/contract-check.ts --env staging
 *   npx tsx src/contract-check.ts --env production [--include-exports]
 */
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { InvokeCommand, LambdaClient } from '@aws-sdk/client-lambda';
import { routes, successEnvelope, type RouteDefinition } from '@pawsitivemileage/contracts';
import { fillPath, parseRouteHandlers, summarizeIssues } from './contract/helpers.js';

const { values: opts } = parseArgs({
  options: {
    env: { type: 'string', default: 'staging' },
    profile: { type: 'string', default: 'pawsitivemileage' },
    prefix: { type: 'string' },
    mapping: { type: 'string' },
    'include-exports': { type: 'boolean', default: false },
  },
});
const env = opts.env!;
const prefix = opts.prefix ?? `pawsitivemileage-app-${env}`;
const mapping = JSON.parse(readFileSync(opts.mapping ?? join(homedir(), '.pawsitivemileage-migration', `${env}-user-map.json`), 'utf8')) as {
  users: Array<{ email: string; newSub: string }>;
};
const handlers = parseRouteHandlers(readFileSync(fileURLToPath(new URL('../../infra/lib/stacks/api-stack.ts', import.meta.url)), 'utf8'));
const lambda = new LambdaClient({ region: 'us-east-1', profile: opts.profile });
const mask = (email: string) => email.replace(/^(.).*(@.*)$/, '$1***$2');

type Caller = { sub: string; email: string };
type OperationId = keyof typeof routes;

let seq = 0;
async function invoke(caller: Caller, route: RouteDefinition, params?: Record<string, string>, query?: Record<string, string>) {
  const fn = handlers.get(`${route.method} ${route.path}`);
  if (!fn) throw new Error(`No handler in api-stack.ts for ${route.method} ${route.path}`);
  const path = fillPath(route.path, params);
  const event = {
    version: '2.0',
    routeKey: `${route.method} ${route.path}`,
    rawPath: path,
    rawQueryString: new URLSearchParams(query ?? {}).toString(),
    headers: {},
    pathParameters: params,
    queryStringParameters: query,
    isBase64Encoded: false,
    requestContext: {
      requestId: `contract-check-${Date.now()}-${seq++}`,
      http: { method: route.method, path, protocol: 'HTTP/1.1', sourceIp: '127.0.0.1', userAgent: 'contract-check' },
      authorizer: { jwt: { claims: { sub: caller.sub, email: caller.email }, scopes: [] } },
    },
  };
  const out = await lambda.send(new InvokeCommand({ FunctionName: `${prefix}-${fn}`, Payload: Buffer.from(JSON.stringify(event)) }));
  const payload = JSON.parse(Buffer.from(out.Payload ?? []).toString() || '{}');
  if (out.FunctionError) throw new Error(`${prefix}-${fn}: ${out.FunctionError}`);
  return { status: payload.statusCode as number, body: payload.body ? JSON.parse(payload.body) : undefined };
}

const results = { checked: 0, failed: 0, notes: [] as string[] };

/** Call a route and validate status + envelope + data; returns the data when it conforms */
async function check(caller: Caller, id: OperationId, params?: Record<string, string>, query?: Record<string, string>) {
  const route: RouteDefinition = routes[id];
  const label = `${id}${query ? `?${new URLSearchParams(query)}` : ''}`;
  const { status, body } = await invoke(caller, route, params, query);
  const okStatuses = [route.status, ...(route.alsoReturns ?? [])];
  results.checked++;
  if (!okStatuses.includes(status as 200 | 201)) {
    results.failed++;
    console.log(`  ✖ ${label} → ${status} (expected ${okStatuses.join('/')}) ${body?.code ?? ''}`);
    return undefined;
  }
  const parsed = successEnvelope(route.response).safeParse(body);
  if (!parsed.success) {
    results.failed++;
    console.log(`  ✖ ${label} → ${status} does not match the contract:`);
    for (const line of summarizeIssues(parsed.error)) console.log(`      data${line.startsWith('[') ? '' : '.'}${line.replace(/^data\.?/, '')}`);
    return undefined;
  }
  const count = Array.isArray(parsed.data.data) ? ` (${parsed.data.data.length})` : '';
  console.log(`  ✔ ${label} → ${status}${count}`);
  return parsed.data.data as never;
}

async function checkUser(caller: Caller): Promise<void> {
  console.log(`\n== ${mask(caller.email)}`);
  const profile = await check(caller, 'getProfile') as { isAdmin?: boolean } | undefined;
  const owned = (await check(caller, 'listVehicles') ?? []) as Array<{ vehicleId: string }>;
  const archived = (await check(caller, 'listVehicles', undefined, { status: 'archived' }) ?? []) as Array<{ vehicleId: string }>;
  await check(caller, 'listVehicles', undefined, { status: 'all' });
  const shared = (await check(caller, 'listSharedVehicles') ?? []) as Array<{ vehicle: { vehicleId: string } }>;

  const vehicles = [
    ...[...owned, ...archived].map((v) => ({ vehicleId: v.vehicleId, owned: true })),
    ...shared.map((s) => ({ vehicleId: s.vehicle.vehicleId, owned: false })),
  ];
  for (const { vehicleId, owned: isOwner } of vehicles) {
    const p = { vehicleId };
    await check(caller, 'getVehicle', p);
    const fillups = (await check(caller, 'listFillups', p) ?? []) as Array<{ fillupId: string }>;
    if (fillups[0]) await check(caller, 'getFillup', { vehicleId, fillupId: fillups[0].fillupId });
    await check(caller, 'listMaintenance', p);
    await check(caller, 'listReminders', p);
    await check(caller, 'listVehicleSchemas', p);
    await check(caller, 'getAnalytics', p);
    await check(caller, 'getYearOverYear', p);
    if (isOwner) await check(caller, 'listShares', p);
    if (opts['include-exports']) {
      await check(caller, 'exportFillups', p);
      await check(caller, 'exportMaintenance', p);
    }
  }

  if (profile?.isAdmin) {
    await check(caller, 'adminListUsers');
    await check(caller, 'adminListSchemas');
    await check(caller, 'adminStats');
  }
}

async function main(): Promise<void> {
  console.log(`contract-check — ${env} (${prefix}, ${mapping.users.length} user(s))${opts['include-exports'] ? ' + exports' : ''}`);
  for (const user of mapping.users) await checkUser({ sub: user.newSub, email: user.email });
  const getRoutes = (Object.keys(routes) as OperationId[]).filter((id) => routes[id].method === 'GET').length;
  console.log(`\n${results.checked} responses checked (the contract has ${getRoutes} GET routes${opts['include-exports'] ? '' : '; the 2 CSV exports are skipped without --include-exports'}).`);
  if (results.failed) {
    console.error(`${results.failed} response(s) do not match the contract.`);
    process.exitCode = 2;
  } else {
    console.log('All responses match the contract.');
  }
}

main().catch((err) => {
  console.error(`\nFailed: ${err instanceof Error ? err.message : err}`);
  process.exit(1);
});
