import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { routes } from '@pawsitivemileage/contracts';
import { fillPath, parseRouteHandlers, summarizeIssues } from '../src/contract/helpers.js';

describe('parseRouteHandlers', () => {
  const apiStack = readFileSync(fileURLToPath(new URL('../../infra/lib/stacks/api-stack.ts', import.meta.url)), 'utf8');
  const handlers = parseRouteHandlers(apiStack);

  it('finds a Lambda handler for every route in the contract', () => {
    for (const route of Object.values(routes)) {
      expect(handlers.get(`${route.method} ${route.path}`), `${route.method} ${route.path}`).toMatch(/^\w+$/);
    }
  });

  it('maps known routes to their handlers', () => {
    expect(handlers.get('GET /v1/vehicles/{vehicleId}/analytics/yoy')).toBe('analytics');
    expect(handlers.get('POST /v1/upload/presign')).toBe('presignUrl');
  });
});

describe('fillPath', () => {
  it('fills and encodes parameters', () => {
    expect(fillPath('/v1/vehicles/{vehicleId}/fillups/{fillupId}', { vehicleId: 'V1', fillupId: 'F 1' })).toBe('/v1/vehicles/V1/fillups/F%201');
  });

  it('refuses to build a path with a missing parameter', () => {
    expect(() => fillPath('/v1/vehicles/{vehicleId}', {})).toThrow('vehicleId');
  });
});

describe('summarizeIssues', () => {
  it('reports paths and messages without values, collapsing array indexes', () => {
    const schema = z.array(z.object({ date: z.iso.date(), email: z.string() }));
    const result = schema.safeParse([
      { date: '10/20/2026', email: 'private@example.com' },
      { date: '10/21/2026', email: 'other@example.com' },
    ]);
    const lines = summarizeIssues(result.error!);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/^\[\]\.date: .+ \(×2\)$/);
    expect(lines.join(' ')).not.toContain('2026');
    expect(lines.join(' ')).not.toContain('example.com');
  });
});
