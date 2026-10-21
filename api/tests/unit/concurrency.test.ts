/**
 * If-Match optimistic concurrency (#25): stale updates get 409 instead of overwriting, the check
 * is a DynamoDB condition where the write allows it, and no header means last write wins.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import { ifMatch } from '../../src/lib/concurrency';

const SUB = '11111111-aaaa-4bbb-8ccc-222222222222';
const VID = '01KHKHBG12P5BK5724XW7X0D30';
const RID = '01KS5M8EYJ5VP2GYMBBEQZ5VPH';
const V1 = '2026-10-01T10:00:00.000Z';
const V2 = '2026-10-02T10:00:00.000Z';

const vehicle = { userId: SUB, vehicleId: VID, nickname: 'Daily', make: 'Subaru', model: 'Outback', year: 2019, isArchived: false, createdAt: V1, updatedAt: V1 };
const record = { vehicleId: VID, recordId: RID, userId: SUB, customTypeName: 'Oil', datePerformed: '2026-10-01', odometerAtService: 1, cost: 1, createdAt: V1, updatedAt: V1, receiptPhotoKey: `${SUB}/${VID}/receipt-photo/r.pdf` };

type Cmd = { constructor: { name: string }; input: Record<string, any> };
const sent: Cmd[] = [];
let failConditionalWrites = false;
const mockSend = vi.fn(async (cmd: Cmd) => {
  sent.push(cmd);
  const name = cmd.constructor.name;
  if (failConditionalWrites && cmd.input.ConditionExpression?.includes('ifMatchUpdatedAt')) {
    throw Object.assign(new Error('changed'), { name: 'ConditionalCheckFailedException' });
  }
  if (name === 'GetCommand') return { Item: vehicle };
  if (name === 'QueryCommand') return { Items: [record] };
  if (name === 'UpdateCommand') return { Attributes: { ...vehicle, updatedAt: V2 } };
  return {};
});
const mockDeleteObject = vi.fn(async () => {});
vi.mock('../../src/lib/dynamo', () => ({ getDocClient: () => ({ send: mockSend }), getTableName: (n: string) => n }));
vi.mock('../../src/lib/s3', async (importOriginal) => ({ ...(await importOriginal<typeof import('../../src/lib/s3')>()), deleteObject: mockDeleteObject }));
vi.mock('../../src/lib/authSharing', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/lib/authSharing')>()),
  verifyAccess: vi.fn(async () => ({ allowed: true, isOwner: true, ownerUserId: SUB, permission: null })),
}));

process.env.PHOTOS_BUCKET = 'photos-test';

const { handler: vehicles } = await import('../../src/handlers/vehicleCrud');
const { handler: maintenance } = await import('../../src/handlers/maintenanceCrud');

function event(method: string, path: string, body: unknown, params: Record<string, string>, headers: Record<string, string> = {}): APIGatewayProxyEventV2 {
  return {
    version: '2.0', rawPath: path, headers, pathParameters: params, body: JSON.stringify(body), isBase64Encoded: false,
    requestContext: { requestId: 't', http: { method, path }, authorizer: { jwt: { claims: { sub: SUB, email: 'o@example.com' } } } },
  } as unknown as APIGatewayProxyEventV2;
}
const status = (r: unknown) => (r as { statusCode: number }).statusCode;
const writes = () => sent.filter((c) => /Put|Update|Delete/.test(c.constructor.name));

beforeEach(() => { sent.length = 0; failConditionalWrites = false; mockSend.mockClear(); mockDeleteObject.mockClear(); });

describe('ifMatch', () => {
  const ev = (value?: string) => ({ headers: value === undefined ? {} : { 'if-match': value } }) as unknown as APIGatewayProxyEventV2;
  it('accepts the raw updatedAt, a quoted ETag or a weak ETag; ignores * and absence', () => {
    expect(ifMatch(ev(V1))).toBe(V1);
    expect(ifMatch(ev(`"${V1}"`))).toBe(V1);
    expect(ifMatch(ev(`W/"${V1}"`))).toBe(V1);
    expect(ifMatch(ev('*'))).toBeUndefined();
    expect(ifMatch(ev())).toBeUndefined();
  });
});

describe('vehicle update / archive', () => {
  const update = (headers: Record<string, string> = {}) =>
    vehicles(event('PUT', `/v1/vehicles/${VID}`, { nickname: 'Weekend' }, { vehicleId: VID }, headers));

  it('without If-Match: unconditional write, as before', async () => {
    expect(status(await update())).toBe(200);
    expect(writes()[0].input.ConditionExpression).toBeUndefined();
  });

  it('with a matching If-Match: writes atomically with a condition, and returns the new ETag', async () => {
    const res = await update({ 'if-match': `"${V1}"` }) as { statusCode: number; headers: Record<string, string> };
    expect(res.statusCode).toBe(200);
    expect(writes()[0].input.ConditionExpression).toBe('#ifMatchUpdatedAt = :ifMatchUpdatedAt');
    expect(writes()[0].input.ExpressionAttributeValues[':ifMatchUpdatedAt']).toBe(V1);
    expect(res.headers.ETag).toBe(`"${V2}"`);
  });

  it('with a stale If-Match: 409 and nothing written', async () => {
    const res = await update({ 'if-match': V2 });
    expect(status(res)).toBe(409);
    expect(writes()).toHaveLength(0);
  });

  it('when another write lands between read and write: the condition turns it into a 409', async () => {
    failConditionalWrites = true;
    expect(status(await update({ 'if-match': V1 }))).toBe(409);
    expect(status(await vehicles(event('PATCH', `/v1/vehicles/${VID}/archive`, { isArchived: true }, { vehicleId: VID }, { 'if-match': V1 })))).toBe(409);
  });
});

describe('maintenance update', () => {
  const path = `/v1/vehicles/${VID}/maintenance/${RID}`;
  const params = { vehicleId: VID, recordId: RID };

  it('same date: the Put carries the condition', async () => {
    expect(status(await maintenance(event('PUT', path, { notes: 'x' }, params, { 'if-match': V1 })))).toBe(200);
    const put = writes().find((c) => c.constructor.name === 'PutCommand')!;
    expect(put.input.ConditionExpression).toBe('#ifMatchUpdatedAt = :ifMatchUpdatedAt');
  });

  it('date change: the delete of the old item carries the condition', async () => {
    failConditionalWrites = true;
    expect(status(await maintenance(event('PUT', path, { datePerformed: '2026-10-05' }, params, { 'if-match': V1 })))).toBe(409);
    expect(writes().map((c) => c.constructor.name)).toEqual(['DeleteCommand']); // stopped at the guarded delete
  });

  it('stale If-Match: 409 before any write or file deletion', async () => {
    expect(status(await maintenance(event('PUT', path, { receiptPhotoKey: null }, params, { 'if-match': V2 })))).toBe(409);
    expect(writes()).toHaveLength(0);
    expect(mockDeleteObject).not.toHaveBeenCalled();
  });

  it('removing a receipt deletes the file only after the record is written', async () => {
    failConditionalWrites = true;
    expect(status(await maintenance(event('PUT', path, { receiptPhotoKey: null }, params, { 'if-match': V1 })))).toBe(409);
    expect(mockDeleteObject).not.toHaveBeenCalled(); // write was refused, so the file stays
    failConditionalWrites = false;
    expect(status(await maintenance(event('PUT', path, { receiptPhotoKey: null }, params, { 'if-match': V1 })))).toBe(200);
    expect(mockDeleteObject).toHaveBeenCalledOnce();
  });
});
