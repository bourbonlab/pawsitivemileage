import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { buildOpenApiDocument, renderOpenApiDocument, routes } from '../src/index.js';

const committed = readFileSync(fileURLToPath(new URL('../openapi.json', import.meta.url)), 'utf8');
const doc = buildOpenApiDocument() as unknown as {
  paths: Record<string, Record<string, { operationId: string; requestBody?: { required: boolean }; responses: Record<string, unknown>; 'x-admin'?: boolean }>>;
  components: Record<string, Record<string, unknown>>;
};
const operations = Object.values(doc.paths).flatMap((methods) => Object.values(methods));
const byId = Object.fromEntries(operations.map((op) => [op.operationId, op]));

describe('openapi.json', () => {
  it('is up to date with the contract (run: npm run openapi -w @pawsitivemileage/contracts)', () => {
    expect(committed).toBe(renderOpenApiDocument());
  });

  it('has one operation per route, keyed by operationId', () => {
    expect(Object.keys(byId).sort()).toEqual(Object.keys(routes).sort());
  });

  it('resolves every $ref', () => {
    const refs = [...committed.matchAll(/"\$ref": "#\/components\/(\w+)\/(\w+)"/g)];
    expect(refs.length).toBeGreaterThan(100);
    for (const [, section, name] of refs) expect(doc.components[section]?.[name], `${section}/${name}`).toBeDefined();
  });

  it('documents both success statuses where a route has two', () => {
    expect(Object.keys(byId.shareVehicle.responses)).toEqual(expect.arrayContaining(['200', '201']));
    expect(Object.keys(byId.getProfile.responses)).toEqual(expect.arrayContaining(['200', '201']));
  });

  it('marks the public route as needing no security', () => {
    expect((byId.getMeta as unknown as { security?: unknown[] }).security).toEqual([]);
    expect((byId.listVehicles as unknown as { security?: unknown[] }).security).toBeUndefined();
  });

  it('marks optional request bodies and admin routes', () => {
    expect(byId.exportReport.requestBody?.required).toBe(false);
    expect(byId.createFillup.requestBody?.required).toBe(true);
    expect(byId.adminStats['x-admin']).toBe(true);
    expect(byId.listVehicles['x-admin']).toBeUndefined();
  });
});
