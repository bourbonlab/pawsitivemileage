import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { APIGatewayProxyEventV2 } from 'aws-lambda';

const SUB = '11111111-aaaa-4bbb-8ccc-222222222222';
const VID = '01KHKHBG12P5BK5724XW7X0D30';

/** Three DynamoDB pages, as a large partition returns them (1 MB each) */
const pages = [
  { Items: [{ n: 1 }, { n: 2 }], LastEvaluatedKey: { vehicleId: VID, fillupDateId: 'k2' } },
  { Items: [{ n: 3 }, { n: 4 }], LastEvaluatedKey: { vehicleId: VID, fillupDateId: 'k4' } },
  { Items: [{ n: 5 }] },
];
const queries: Array<Record<string, any>> = [];
const mockSend = vi.fn(async (cmd: { input: Record<string, any> }) => {
  queries.push(cmd.input);
  if (cmd.input.Limit) return { Items: [{ n: 1 }, { n: 2 }], LastEvaluatedKey: { vehicleId: VID, fillupDateId: 'k2' } };
  const start = cmd.input.ExclusiveStartKey?.fillupDateId;
  return pages[start === 'k2' ? 1 : start === 'k4' ? 2 : 0];
});
vi.mock('../../src/lib/dynamo', () => ({ getDocClient: () => ({ send: mockSend }), getTableName: (n: string) => n }));
vi.mock('../../src/lib/authSharing', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/lib/authSharing')>()),
  verifyAccess: vi.fn(async () => ({ allowed: true, isOwner: true, ownerUserId: SUB, permission: null })),
}));

const { decodeCursor, encodeCursor, InvalidCursorError, queryPage } = await import('../../src/lib/pagination');
const { handler: fillups } = await import('../../src/handlers/fillupCrud');

const list = (query?: Record<string, string>) => fillups({
  version: '2.0', rawPath: `/v1/vehicles/${VID}/fillups`, headers: {}, pathParameters: { vehicleId: VID }, queryStringParameters: query,
  requestContext: { requestId: 't', http: { method: 'GET' }, authorizer: { jwt: { claims: { sub: SUB } } } },
} as unknown as APIGatewayProxyEventV2) as Promise<{ statusCode: number; body: string }>;

beforeEach(() => { queries.length = 0; mockSend.mockClear(); });

describe('queryPage', () => {
  const q = { TableName: 'FILLUPS_TABLE', KeyConditionExpression: 'vehicleId = :vid', ExpressionAttributeValues: { ':vid': VID } };
  const partition = { key: 'vehicleId', value: VID };

  it('without limit, follows every DynamoDB page (no silent truncation)', async () => {
    const page = await queryPage(q, partition, {});
    expect(page.items).toEqual([{ n: 1 }, { n: 2 }, { n: 3 }, { n: 4 }, { n: 5 }]);
    expect(page.nextCursor).toBeUndefined();
    expect(queries).toHaveLength(3);
  });

  it('with limit, returns one page and a cursor that resumes after it', async () => {
    const page = await queryPage(q, partition, { limit: 2, order: 'desc' });
    expect(page.items).toHaveLength(2);
    expect(queries[0]).toMatchObject({ Limit: 2, ScanIndexForward: false });
    expect(decodeCursor(page.nextCursor!, 'vehicleId', VID)).toEqual({ vehicleId: VID, fillupDateId: 'k2' });
    await queryPage(q, partition, { limit: 2, cursor: page.nextCursor });
    expect(queries[1].ExclusiveStartKey).toEqual({ vehicleId: VID, fillupDateId: 'k2' });
  });

  it('rejects cursors from another vehicle, and garbage', () => {
    const other = encodeCursor({ vehicleId: '01JOTHERVEHICLE00000000000', fillupDateId: 'x' });
    expect(() => decodeCursor(other, 'vehicleId', VID)).toThrow(InvalidCursorError);
    expect(() => decodeCursor('not-base64-json', 'vehicleId', VID)).toThrow(InvalidCursorError);
    expect(() => decodeCursor(encodeCursor([1, 2] as never), 'vehicleId', VID)).toThrow(InvalidCursorError);
  });
});

describe('GET fill-ups', () => {
  it('returns the full list when no limit is given (backward compatible envelope)', async () => {
    const body = JSON.parse((await list()).body);
    expect(body.data).toHaveLength(5);
    expect(body).not.toHaveProperty('nextCursor');
  });

  it('puts nextCursor next to data when paginating', async () => {
    const body = JSON.parse((await list({ limit: '2' })).body);
    expect(body.data).toHaveLength(2);
    expect(typeof body.nextCursor).toBe('string');
  });

  it('validates the query', async () => {
    for (const [query, message] of [
      [{ limit: '0' }, 'limit must be at least 1'],
      [{ limit: '501' }, 'limit must be at most 500'],
      [{ limit: 'ten' }, 'limit must be a number'],
      [{ order: 'newest' }, 'order must be one of: asc, desc'],
      [{ limit: '2', cursor: encodeCursor({ vehicleId: 'someone-elses', fillupDateId: 'x' }) }, 'cursor is not valid for this list'],
    ] as const) {
      const res = await list(query);
      expect(res.statusCode, JSON.stringify(query)).toBe(400);
      expect(JSON.parse(res.body).error).toBe(message);
    }
  });
});
