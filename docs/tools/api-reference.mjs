#!/usr/bin/env node
/**
 * Writes docs/api-reference.md from packages/contracts/openapi.json, so the API reference reads
 * on GitHub without a viewer. No dependencies. `npm run openapi -w @pawsitivemileage/contracts` runs it
 * after writing openapi.json, and a contracts test runs it with --check.
 *
 *   node docs/tools/api-reference.mjs           # rewrite docs/api-reference.md
 *   node docs/tools/api-reference.mjs --check   # exit 1 if it's stale
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const specPath = fileURLToPath(new URL('../../packages/contracts/openapi.json', import.meta.url));
const outPath = fileURLToPath(new URL('../api-reference.md', import.meta.url));
const spec = JSON.parse(readFileSync(specPath, 'utf8'));
const schemas = spec.components.schemas;
const METHODS = ['get', 'post', 'put', 'patch', 'delete'];
const RAW_SPEC = 'https://raw.githubusercontent.com/bourbonlab/pawsitivemileage/main/packages/contracts/openapi.json';

// GitHub's heading anchors: lowercase, punctuation dropped, spaces to hyphens, repeats suffixed -1, -2, …
const seen = new Map();
function slug(heading) {
  const base = heading.toLowerCase().replace(/[^\p{L}\p{M}\p{N}\p{Pc} -]/gu, '').replace(/ /g, '-');
  const n = seen.get(base) ?? 0;
  seen.set(base, n + 1);
  return n ? `${base}-${n}` : base;
}

const refName = (ref) => ref.split('/').pop();
const cell = (s) => String(s ?? '').replace(/\|/g, '\\|').replace(/\n+/g, ' ');

// Every operation, grouped by tag in the spec's tag order
const operations = [];
for (const [path, item] of Object.entries(spec.paths)) {
  for (const method of METHODS) if (item[method]) operations.push({ path, method, op: item[method] });
}
const tags = spec.tags.map((t) => ({ ...t, ops: operations.filter((o) => o.op.tags?.[0] === t.name) }));

// Schemas worth documenting: everything the operations reach, minus the response envelopes
const isEnvelope = (name) => /Response$/.test(name) && schemas[name]?.properties?.requestId;
const documented = new Set();
function collect(schema) {
  if (!schema || typeof schema !== 'object') return;
  if (schema.$ref) {
    const name = refName(schema.$ref);
    if (documented.has(name)) return;
    if (!isEnvelope(name)) documented.add(name);
    collect(schemas[name]);
    return;
  }
  for (const value of Object.values(schema)) {
    if (Array.isArray(value)) value.forEach(collect);
    else collect(value);
  }
}
for (const { op } of operations) {
  collect(op.requestBody?.content?.['application/json']?.schema);
  for (const r of Object.values(op.responses)) collect(r.content?.['application/json']?.schema);
}
const schemaNames = Object.keys(schemas).filter((n) => documented.has(n)).sort();

// Anchors, assigned in document order
const H = {
  overview: slug('Overview'),
  endpoints: slug('Endpoints'),
  tags: new Map(),
  ops: new Map(),
  schemasHeading: null,
  schemas: new Map(),
};
for (const t of tags) {
  H.tags.set(t.name, slug(t.name));
  for (const o of t.ops) H.ops.set(o, slug(`${o.method.toUpperCase()} ${o.path}`));
}
H.schemasHeading = slug('Schemas');
for (const name of schemaNames) H.schemas.set(name, slug(name));

const link = (name) => (H.schemas.has(name) ? `[${name}](#${H.schemas.get(name)})` : `\`${name}\``);

function typeOf(s) {
  if (!s) return 'any';
  if (s.$ref) {
    const name = refName(s.$ref);
    const target = schemas[name];
    // Inline simple enums so a field reads "readonly | fuel | …" without a jump
    if (target?.enum && !H.schemas.has(name)) return target.enum.map((v) => `\`${v}\``).join(' \\| ');
    return link(name);
  }
  if (s.const !== undefined) return `\`${JSON.stringify(s.const)}\``;
  if (s.enum) return s.enum.map((v) => `\`${v}\``).join(' \\| ');
  if (s.anyOf || s.oneOf) return (s.anyOf ?? s.oneOf).map(typeOf).join(' \\| ');
  if (Array.isArray(s.type)) return s.type.join(' \\| ');
  if (s.type === 'array') return `${typeOf(s.items)}[]`;
  if (s.type === 'object' && s.additionalProperties && !s.properties) return `map of ${typeOf(s.additionalProperties)}`;
  if (s.type === 'string' && s.format) return `string (${s.format})`;
  return s.type ?? 'any';
}

function constraints(s) {
  const out = [];
  const parts = s.anyOf ?? s.oneOf ?? [s];
  for (const p of parts) {
    if (p.minLength !== undefined && p.maxLength !== undefined) out.push(`${p.minLength}–${p.maxLength} chars`);
    else if (p.minLength === 1) out.push('non-empty');
    else if (p.minLength !== undefined && p.minLength > 1) out.push(`at least ${p.minLength} chars`);
    else if (p.maxLength !== undefined) out.push(`at most ${p.maxLength} chars`);
    // zod gives every int the safe-integer range; that's no constraint worth printing
    const min = Math.abs(p.minimum) >= Number.MAX_SAFE_INTEGER ? undefined : p.minimum;
    const max = Math.abs(p.maximum) >= Number.MAX_SAFE_INTEGER ? undefined : p.maximum;
    if (min !== undefined && max !== undefined) out.push(`${min} to ${max}`);
    else if (min !== undefined) out.push(`≥ ${min}`);
    else if (max !== undefined) out.push(`≤ ${max}`);
    if (p.exclusiveMinimum !== undefined) out.push(`> ${p.exclusiveMinimum}`);
    if (p.pattern && p.pattern.length <= 40 && !p.format) out.push(`pattern \`${p.pattern}\``);
  }
  return out;
}

function notes(s) {
  const target = s.$ref ? schemas[refName(s.$ref)] : null;
  const description = s.description
    ?? (s.anyOf ?? s.oneOf ?? []).find((p) => p.description)?.description
    ?? (target && !H.schemas.has(refName(s.$ref)) ? target.description : undefined);
  return [...constraints(s), description].filter(Boolean).join('; ');
}

/** Field rows for an object schema; inline objects are flattened as parent.child */
function fieldRows(s, prefix = '') {
  const rows = [];
  const required = new Set(s.required ?? []);
  for (const [name, prop] of Object.entries(s.properties ?? {})) {
    const field = `${prefix}${name}`;
    rows.push(`| \`${field}\` | ${typeOf(prop)} | ${required.has(name) ? 'yes' : ''} | ${cell(notes(prop))} |`);
    const inline = prop.type === 'object' && prop.properties ? prop : prop.anyOf?.find((p) => p.type === 'object' && p.properties);
    if (inline) rows.push(...fieldRows(inline, `${field}.`));
    if (prop.type === 'array' && prop.items?.type === 'object' && prop.items.properties) {
      rows.push(...fieldRows(prop.items, `${field}[].`));
    }
    if (prop.additionalProperties?.properties) rows.push(...fieldRows(prop.additionalProperties, `${field}.<key>.`));
  }
  return rows;
}

function fieldTable(s) {
  return ['| Field | Type | Required | Notes |', '|---|---|---|---|', ...fieldRows(s)].join('\n');
}

/** What the success envelope's `data` holds, and whether the route is paginated */
function successOf(op) {
  const [status, response] = Object.entries(op.responses).find(([code]) => code.startsWith('2'));
  const schema = response.content?.['application/json']?.schema;
  const envelope = schema?.$ref ? schemas[refName(schema.$ref)] : schema;
  return {
    status,
    data: envelope?.properties?.data ? typeOf(envelope.properties.data) : typeOf(schema),
    paginated: Boolean(envelope?.properties?.nextCursor),
    headers: Object.keys(response.headers ?? {}),
  };
}

function errorsOf(op) {
  return Object.entries(op.responses)
    .filter(([code]) => !code.startsWith('2'))
    .map(([code, r]) => {
      const name = r.$ref ? refName(r.$ref) : null;
      const description = name ? spec.components.responses[name].description : r.description;
      return `\`${code}\` ${description.split(':')[0]}`;
    });
}

function operationSection(o) {
  const { op, method, path } = o;
  const summary = op.summary ? op.summary.replace(/\.?$/, '.') : '';
  const lines = [`### ${method.toUpperCase()} ${path}`, '', summary, ''];
  const auth = op.security && op.security.length === 0
    ? 'none (public)'
    : o.op.tags?.[0] === 'Admin' ? 'bearer token, admin' : 'bearer token';
  lines.push(`SDK: \`api.${op.operationId}()\` · Auth: ${auth}`, '');

  const params = op.parameters ?? [];
  if (params.length) {
    lines.push('| Parameter | In | Type | Required | Notes |', '|---|---|---|---|---|');
    for (const p of params) {
      lines.push(`| \`${p.name}\` | ${p.in} | ${typeOf(p.schema)} | ${p.required ? 'yes' : ''} | ${cell([...constraints(p.schema), p.description].filter(Boolean).join('; '))} |`);
    }
    lines.push('');
  }

  const body = op.requestBody?.content?.['application/json']?.schema;
  if (body) lines.push(`**Body:** ${typeOf(body)}${op.requestBody.required ? '' : ' (optional)'}`, '');

  const success = successOf(op);
  const extras = [success.paginated && 'plus `nextCursor` when more pages remain', ...success.headers.map((h) => `\`${h}\` header`)]
    .filter(Boolean);
  lines.push(`**Returns** \`${success.status}\`: \`data\` is ${success.data}${extras.length ? `, ${extras.join(', ')}` : ''}.`, '');
  lines.push(`**Errors:** ${errorsOf(op).join(', ')}`, '');
  return lines.join('\n');
}

const out = [];
out.push(
  '# PawsitiveMileage API reference',
  '',
  '<!-- Generated by docs/tools/api-reference.mjs from packages/contracts/openapi.json. Do not edit by hand. -->',
  '',
  `Generated from [\`packages/contracts/openapi.json\`](../packages/contracts/openapi.json) (OpenAPI ${spec.openapi}), which is generated from the contract in [\`packages/contracts\`](../packages/contracts). How the contract works and how to change an endpoint: [api-contract.md](api-contract.md).`,
  '',
  `Interactive views of the same document: [Redoc](https://redocly.github.io/redoc/?url=${RAW_SPEC}) · [Swagger UI](https://petstore.swagger.io/?url=${RAW_SPEC}). Both load the copy on \`main\`.`,
  '',
  '## Overview',
  '',
  '| Environment | Base URL |',
  '|---|---|',
  ...spec.servers.map((s) => `| ${s.description} | \`${s.url}\` |`),
  '',
  `- **Auth:** every endpoint except \`GET /v1/meta\` needs \`Authorization: Bearer <token>\`, a token from the environment's Cognito user pool. The web app sends its ID token; Android and \`pm\` sign in with authorization code + PKCE through the Hosted UI and send access tokens. \`GET /v1/meta\` returns everything a native client needs to sign in. Admin endpoints also need \`isAdmin\` on the caller's profile.`,
  '- **Envelope:** a success is `{ "data": …, "requestId": "…" }`; an error is `{ "error": "message", "code": "…", "requestId": "…" }` with `code` one of `VALIDATION_ERROR` (400), `UNAUTHORIZED` (401), `FORBIDDEN` (403), `NOT_FOUND` (404), `CONFLICT` (409), `INTERNAL_ERROR` (500). Below, **Returns** describes `data`.',
  '- **Safe retries:** creates marked with an `Idempotency-Key` header return the original response for a retry with the same key and body (`Idempotent-Replayed: true`). Keys are per user and expire after 24 hours.',
  '- **Conflicts:** single-record responses carry `ETag`. Send it back as `If-Match` on an update to get `409 CONFLICT` instead of overwriting someone else\'s change.',
  '- **Pagination:** paginated lists return everything without `limit`. With `limit`, the envelope adds `nextCursor` while more remain; pass it back as `cursor`.',
  '- **Compatibility:** `/v1` only changes additively, so clients must ignore fields they don\'t know.',
  '- **Clients:** TypeScript: [`@pawsitivemileage/sdk`](../packages/sdk), one method per operation (named under each endpoint). Kotlin: generated at build time by the Android app ([android/README.md](../android/README.md#the-generated-api-client)).',
  '',
  '## Endpoints',
  '',
  '| Method | Path | Summary |',
  '|---|---|---|',
);
for (const t of tags) {
  out.push(`| | **[${t.name}](#${H.tags.get(t.name)})** | ${cell(t.description)} |`);
  for (const o of t.ops) {
    out.push(`| ${o.method.toUpperCase()} | [\`${o.path}\`](#${H.ops.get(o)}) | ${cell(o.op.summary)} |`);
  }
}
out.push('');

for (const t of tags) {
  out.push(`## ${t.name}`, '', `${t.description}.`, '');
  for (const o of t.ops) out.push(operationSection(o));
}

out.push('## Schemas', '', 'Response objects may gain fields within `/v1`; requests reject wrong types and out-of-range values with `400`.', '');
for (const name of schemaNames) {
  const s = schemas[name];
  out.push(`### ${name}`, '');
  if (s.description) out.push(`${s.description}`, '');
  if (s.properties) out.push(fieldTable(s), '');
  else out.push(`${typeOf({ ...s, description: undefined })}${constraints(s).length ? ` (${constraints(s).join('; ')})` : ''}`, '');
}

const markdown = `${out.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd()}\n`;
if (process.argv.includes('--check')) {
  let current = '';
  try { current = readFileSync(outPath, 'utf8'); } catch { /* missing counts as stale */ }
  if (current !== markdown) {
    console.error('docs/api-reference.md is stale: run node docs/tools/api-reference.mjs');
    process.exit(1);
  }
  console.log('docs/api-reference.md is up to date');
} else {
  writeFileSync(outPath, markdown);
  console.log(`wrote ${outPath}`);
}
