import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import * as z from 'zod';
import { Fillup, YearOverYear, routes } from '@pawsitivemileage/contracts';
import { countPaths, fillPath, parseRouteHandlers, summarizeIssues, undeclaredKeys } from '../src/contract/helpers.js';

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

describe('undeclaredKeys', () => {
  const fillup = {
    vehicleId: 'V', fillupId: 'F', userId: 'U', date: '2026-10-20', currencySpent: 1, gallonsAdded: 1, odometerReading: 1,
    isPartialFill: false, pricePerGallon: 1, milesSinceLastFillup: null, mpg: null, costPerMile: null, daysSinceLastFillup: null,
    createdAt: 'x', updatedAt: 'y',
  };

  it('finds no extras on a clean response', () => {
    expect(undeclaredKeys(z.array(Fillup), [fillup, { ...fillup, stationName: null }])).toEqual([]);
  });

  it('reports undeclared fields with their path, through arrays and nested objects', () => {
    const leaky = { ...fillup, GSI1PK: 'U', fillupDateId: 'd#F' };
    expect(countPaths(undeclaredKeys(z.array(Fillup), [leaky, leaky]))).toEqual(['data[].GSI1PK (×2)', 'data[].fillupDateId (×2)']);
    const yoy = { summaries: [{ year: '2025', totalSpent: 1, totalGallons: 1, averageMpg: null, totalMiles: 1, maintenanceCost: 1,
      trends: { totalSpent: 'up', totalGallons: 'up', averageMpg: 'flat', totalMiles: 'up', maintenanceCost: 'up', bonus: 'x' } }] };
    expect(undeclaredKeys(YearOverYear, yoy)).toEqual(['data.summaries[].trends.bonus']);
  });
});
