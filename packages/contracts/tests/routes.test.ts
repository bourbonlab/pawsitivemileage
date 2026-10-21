import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { routes, type RouteDefinition } from '../src/index.js';

const apiStack = readFileSync(fileURLToPath(new URL('../../../infra/lib/stacks/api-stack.ts', import.meta.url)), 'utf8');
const deployed = [...apiStack.matchAll(/addRoute\(apigwv2\.HttpMethod\.(\w+),\s*'([^']+)'/g)].map(([, m, p]) => `${m} ${p}`).sort();
const all = Object.entries(routes) as Array<[string, RouteDefinition]>;
const declared = all.map(([, r]) => `${r.method} ${r.path}`).sort();

describe('route table', () => {
  it('declares exactly the routes deployed in api-stack.ts', () => {
    expect(deployed.length).toBeGreaterThan(30); // guard against the regex silently matching nothing
    expect(declared).toEqual(deployed);
  });

  it('has unique method + path pairs', () => {
    expect(new Set(declared).size).toBe(declared.length);
  });

  it.each(all)('%s: path placeholders match its params schema', (_id, route) => {
    const placeholders = [...route.path.matchAll(/\{(\w+)\}/g)].map(([, p]) => p).sort();
    expect(Object.keys(route.params?.shape ?? {}).sort()).toEqual(placeholders);
  });

  it.each(all)('%s: only body-carrying methods declare a body', (_id, route) => {
    if (route.method === 'GET' || route.method === 'DELETE') expect(route.body).toBeUndefined();
  });

  it.each(all)('%s: every schema converts to JSON Schema (needed for OpenAPI)', (_id, route) => {
    for (const schema of [route.params, route.query, route.body, route.response]) {
      if (schema) expect(() => z.toJSONSchema(schema, { io: 'input', unrepresentable: 'any' })).not.toThrow();
    }
  });
});
