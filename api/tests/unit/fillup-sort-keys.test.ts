/**
 * A fill-up stored under a key that disagrees with its date (the production duplicate of
 * 2026-10-21) is cleaned up by any rewrite, and update/delete use the stored keys.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { APIGatewayProxyEventV2 } from 'aws-lambda';

const SUB = '11111111-aaaa-4bbb-8ccc-222222222222';
const VID = '01KHKHBG12P5BK5724XW7X0D30';
const DUP = '01KHHJSXNKX2DRMAG1110MHGR5';
const OTHER = '01KHHJSXNKX2DRMAG1110MHGR6';
const TS = '2026-02-15T21:20:17.075Z';
const base = { vehicleId: VID, userId: SUB, currencySpent: 50, gallonsAdded: 13, isPartialFill: false, isBusiness: false, createdAt: TS, updatedAt: TS };
let table: Map<string, Record<string, unknown>>;

const mockSend = vi.fn(async (cmd: { constructor: { name: string }; input: Record<string, any> }) => {
  const { input } = cmd;
  switch (cmd.constructor.name) {
    case 'QueryCommand': {
      let items = [...table.values()].sort((a, b) => String(a.fillupDateId).localeCompare(String(b.fillupDateId)));
      if (input.ExpressionAttributeValues?.[':fid']) items = items.filter((i) => i.fillupId === input.ExpressionAttributeValues[':fid']);
      return { Items: items };
    }
    case 'PutCommand':
      table.set(input.Item.fillupDateId, input.Item);
      return {};
    case 'DeleteCommand':
      table.delete(input.Key.fillupDateId);
      return {};
    case 'GetCommand':
      return { Item: { userId: SUB, vehicleId: VID, nickname: 'Daily', make: 'Nissan', model: 'Xterra', year: 2016, isArchived: false, createdAt: TS, updatedAt: TS } };
    case 'BatchWriteCommand':
      for (const r of Object.values(input.RequestItems)[0] as Array<{ PutRequest: { Item: Record<string, any> } }>) table.set(r.PutRequest.Item.fillupDateId, r.PutRequest.Item);
      return { UnprocessedItems: {} };
    default:
      return {};
  }
});
vi.mock('../../src/lib/dynamo', () => ({ getDocClient: () => ({ send: mockSend }), getTableName: (n: string) => n }));
vi.mock('../../src/lib/authSharing', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/lib/authSharing')>()),
  verifyAccess: vi.fn(async () => ({ allowed: true, isOwner: true, ownerUserId: SUB, permission: null })),
  getSharedPermission: vi.fn(async () => null),
}));
process.env.PHOTOS_BUCKET = 'photos-test';

const { handler: fillups } = await import('../../src/handlers/fillupCrud');
const { handler: imports } = await import('../../src/handlers/importData');

const call = (h: typeof fillups, method: string, path: string, params: Record<string, string>, body?: unknown) => h({
  version: '2.0', rawPath: path, headers: {}, pathParameters: params, body: body === undefined ? undefined : JSON.stringify(body), isBase64Encoded: false,
  requestContext: { requestId: 't', http: { method, path }, authorizer: { jwt: { claims: { sub: SUB } } } },
} as unknown as APIGatewayProxyEventV2) as Promise<{ statusCode: number; body: string }>;

beforeEach(() => {
  // The production state: a ghost copy under 0024-…, the real one under 2024-…, and a later fill-up
  table = new Map(Object.entries({
    [`0024-08-29#${DUP}`]: { ...base, fillupId: DUP, date: '2024-08-29', fillupDateId: `0024-08-29#${DUP}`, odometerReading: 7575 },
    [`2024-08-29#${DUP}`]: { ...base, fillupId: DUP, date: '2024-08-29', fillupDateId: `2024-08-29#${DUP}`, odometerReading: 7575 },
    [`2024-09-15#${OTHER}`]: { ...base, fillupId: OTHER, date: '2024-09-15', fillupDateId: `2024-09-15#${OTHER}`, odometerReading: 7900 },
  }));
});

const keys = () => [...table.keys()].sort();

describe('fill-up sort keys', () => {
  it('editing another fill-up removes the stale copy and fixes the metrics', async () => {
    const res = await call(fillups, 'PUT', `/v1/vehicles/${VID}/fillups/${OTHER}`, { vehicleId: VID, fillupId: OTHER }, { notes: 'x' });
    expect(res.statusCode).toBe(200);
    expect(keys()).toEqual([`2024-08-29#${DUP}`, `2024-09-15#${OTHER}`]);
    expect(table.get(`2024-09-15#${OTHER}`)!.milesSinceLastFillup).toBe(325); // was 0 against the duplicate
  });

  it('deleting the fill-up deletes every stored copy', async () => {
    expect((await call(fillups, 'DELETE', `/v1/vehicles/${VID}/fillups/${DUP}`, { vehicleId: VID, fillupId: DUP })).statusCode).toBe(200);
    expect(keys()).toEqual([`2024-09-15#${OTHER}`]);
  });

  it('changing its date leaves exactly one item under the new key', async () => {
    expect((await call(fillups, 'PUT', `/v1/vehicles/${VID}/fillups/${DUP}`, { vehicleId: VID, fillupId: DUP }, { date: '2024-08-30' })).statusCode).toBe(200);
    expect(keys()).toEqual([`2024-08-30#${DUP}`, `2024-09-15#${OTHER}`]);
  });

  it('recalculate removes the stale copy too', async () => {
    const res = await call(imports, 'POST', `/v1/vehicles/${VID}/recalculate`, { vehicleId: VID }, {});
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).data.recalculatedCount).toBe(2);
    expect(keys()).toEqual([`2024-08-29#${DUP}`, `2024-09-15#${OTHER}`]);
  });
});
