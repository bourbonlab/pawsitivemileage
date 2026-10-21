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

  it('documents Idempotency-Key and its 409 on create routes only', () => {
    type Op = { parameters: Array<{ name: string; in: string }>; responses: Record<string, unknown> };
    for (const id of ['createFillup', 'createMaintenance', 'createVehicle', 'shareVehicle']) {
      const op = byId[id] as unknown as Op;
      expect(op.parameters.some((p) => p.name === 'Idempotency-Key' && p.in === 'header'), id).toBe(true);
      expect(op.responses['409'], id).toBeDefined();
    }
    expect((byId.updateFillup as unknown as Op).parameters.some((p) => p.name === 'Idempotency-Key')).toBe(false);
  });

  it('documents If-Match and 409 on conditional updates, and ETag on single-record responses', () => {
    type Op = { parameters: Array<{ name: string }>; responses: Record<string, { headers?: Record<string, unknown> }> };
    for (const id of ['updateVehicle', 'archiveVehicle', 'updateFillup', 'updateMaintenance']) {
      const op = byId[id] as unknown as Op;
      expect(op.parameters.some((p) => p.name === 'If-Match'), id).toBe(true);
      expect(op.responses['409'], id).toBeDefined();
    }
    expect((byId.getVehicle as unknown as Op).responses['200'].headers?.ETag).toBeDefined();
    expect((byId.listVehicles as unknown as Op).responses['200'].headers).toBeUndefined();
  });

  it('documents limit/cursor/order and nextCursor on paginated lists only', () => {
    type Op = { parameters?: Array<{ name: string; in: string }>; responses: Record<string, { content: Record<string, { schema: { $ref: string } }> }> };
    const envelope = (op: Op) => Object.keys((doc.components.schemas[op.responses['200'].content['application/json'].schema.$ref.split('/').pop()!] as { properties: object }).properties);
    for (const id of ['listFillups', 'listMaintenance']) {
      const op = byId[id] as unknown as Op;
      expect(op.parameters?.filter((p) => p.in === 'query').map((p) => p.name).sort(), id).toEqual(['cursor', 'limit', 'order']);
      expect(envelope(op), id).toContain('nextCursor');
    }
    const vehicles = byId.listVehicles as unknown as Op;
    expect(envelope(vehicles)).not.toContain('nextCursor');
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
