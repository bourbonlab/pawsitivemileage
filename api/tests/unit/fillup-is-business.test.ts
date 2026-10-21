/**
 * #31: isBusiness is required in the contract. Fill-ups stored before the field existed were
 * backfilled; an update of one that was missed still writes false rather than leaving it absent.
 */
import { describe, it, expect, vi } from 'vitest';
import type { APIGatewayProxyEventV2 } from 'aws-lambda';

const SUB = '11111111-aaaa-4bbb-8ccc-222222222222';
const VID = '01KHKHBG12P5BK5724XW7X0D30';
const FID = '01KS5M8EYJ5VP2GYMBBEQZ5VPH';
const TS = '2026-10-01T10:00:00.000Z';
const legacy = {
  vehicleId: VID, fillupId: FID, userId: SUB, date: '2026-10-01', fillupDateId: `2026-10-01#${FID}`,
  currencySpent: 40, gallonsAdded: 12, odometerReading: 1000, isPartialFill: false, createdAt: TS, updatedAt: TS,
};

const puts: Array<Record<string, unknown>> = [];
const mockSend = vi.fn(async (cmd: { constructor: { name: string }; input: Record<string, any> }) => {
  if (cmd.constructor.name === 'QueryCommand') return { Items: [legacy] };
  if (cmd.constructor.name === 'PutCommand') puts.push(cmd.input.Item);
  return {};
});
vi.mock('../../src/lib/dynamo', () => ({ getDocClient: () => ({ send: mockSend }), getTableName: (n: string) => n }));
vi.mock('../../src/lib/authSharing', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/lib/authSharing')>()),
  verifyAccess: vi.fn(async () => ({ allowed: true, isOwner: true, ownerUserId: SUB, permission: null })),
}));
process.env.PHOTOS_BUCKET = 'photos-test';

const { handler } = await import('../../src/handlers/fillupCrud');

describe('fill-up update without isBusiness (#31)', () => {
  it('writes isBusiness=false', async () => {
    const res = await handler({
      version: '2.0', rawPath: `/v1/vehicles/${VID}/fillups/${FID}`, headers: {}, pathParameters: { vehicleId: VID, fillupId: FID },
      body: JSON.stringify({ notes: 'edited' }), isBase64Encoded: false,
      requestContext: { requestId: 't', http: { method: 'PUT' }, authorizer: { jwt: { claims: { sub: SUB } } } },
    } as unknown as APIGatewayProxyEventV2) as { statusCode: number; body: string };
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).data.isBusiness).toBe(false);
    expect(puts[0]).toMatchObject({ fillupId: FID, isBusiness: false });
  });
});
