/**
 * Maintenance updates with Android's request bodies: every field is sent, with nulls (the app's
 * UpdateBodyConverter). A custom-type record arrives with `schemaId: null`, which used to be
 * looked up as a schema key and fail the request in DynamoDB (500).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { APIGatewayProxyEventV2 } from 'aws-lambda';

const SUB = '11111111-aaaa-4bbb-8ccc-222222222222';
const VID = '01KHKHBG12P5BK5724XW7X0D30';
const RID = '01KS5M8EYJ5VP2GYMBBEQZ5VPH';
const SID = '01KS5M8EYJ5VP2GYMBBEQZ5VPJ';
const TS = '2026-10-01T10:00:00.000Z';
const RECEIPT = `${SUB}/${VID}/receipt-photo/01KS5M8EYJ5VP2GYMBBEQZ5VPK-r.jpg`;

const vehicle = { userId: SUB, vehicleId: VID, nickname: 'Daily', make: 'Subaru', model: 'Outback', year: 2019, isArchived: false, createdAt: TS, updatedAt: TS };
const customRecord = { vehicleId: VID, recordId: RID, userId: SUB, customTypeName: 'Wiper blades', datePerformed: '2026-10-01', serviceDateId: `2026-10-01#${RID}`, odometerAtService: 1000, cost: 25, createdAt: TS, updatedAt: TS };
const scheduleRecord = { ...customRecord, customTypeName: undefined, schemaId: SID, schemaName: 'Oil change' };
let stored: Record<string, unknown>;

type Cmd = { constructor: { name: string }; input: Record<string, any> };
const sent: Cmd[] = [];
const mockSend = vi.fn(async (cmd: Cmd) => {
  sent.push(cmd);
  const { input } = cmd;
  switch (cmd.constructor.name) {
    case 'GetCommand':
      if (input.TableName === 'SCHEMAS_TABLE') {
        // DynamoDB rejects a key value that isn't a string, as it did in production
        if (typeof input.Key.schemaId !== 'string') throw Object.assign(new Error('The provided key element does not match the schema'), { name: 'ValidationException' });
        return { Item: input.Key.schemaId === SID ? { schemaId: SID, name: 'Oil change' } : undefined };
      }
      return { Item: vehicle };
    case 'QueryCommand':
      return { Items: [stored] };
    default:
      return {};
  }
});
vi.mock('../../src/lib/dynamo', () => ({ getDocClient: () => ({ send: mockSend }), getTableName: (n: string) => n }));
vi.mock('../../src/lib/authSharing', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/lib/authSharing')>()),
  verifyAccess: vi.fn(async () => ({ allowed: true, isOwner: true, ownerUserId: SUB, permission: null })),
}));
process.env.PHOTOS_BUCKET = 'photos-test';

const { handler } = await import('../../src/handlers/maintenanceCrud');

/** The body MaintenanceForm.toUpdate builds, encoded with explicit nulls */
const androidBody = (over: Record<string, unknown> = {}) => ({
  schemaId: null, customTypeName: 'Wiper blades', datePerformed: '2026-10-01', odometerAtService: 1000, cost: 25,
  location: null, locationLat: null, locationLng: null, stationName: null, address: null, notes: null, receiptPhotoKey: null,
  ...over,
});
const put = async (body: unknown) => {
  const path = `/v1/vehicles/${VID}/maintenance/${RID}`;
  const res = await handler({
    version: '2.0', rawPath: path, headers: {}, pathParameters: { vehicleId: VID, recordId: RID }, body: JSON.stringify(body), isBase64Encoded: false,
    requestContext: { requestId: 't', http: { method: 'PUT', path }, authorizer: { jwt: { claims: { sub: SUB } } } },
  } as unknown as APIGatewayProxyEventV2) as { statusCode: number; body: string };
  return { status: res.statusCode, body: JSON.parse(res.body) };
};
/** Items as written: undefined fields are dropped by the real client (removeUndefinedValues) */
const written = () => sent.filter((c) => c.constructor.name === 'PutCommand').map((c) => c.input.Item);
const deletes = () => sent.filter((c) => c.constructor.name === 'DeleteCommand').map((c) => c.input.Key);

beforeEach(() => {
  sent.length = 0;
  stored = { ...customRecord };
});

describe('maintenance update with a full Android body', () => {
  it('changes the date of a custom-type record (schemaId: null), moving it to the new key', async () => {
    const res = await put(androidBody({ datePerformed: '2026-10-05' }));
    expect(res.status).toBe(200);
    expect(deletes()).toEqual([{ vehicleId: VID, serviceDateId: `2026-10-01#${RID}` }]);
    expect(written()[0]).toMatchObject({ serviceDateId: `2026-10-05#${RID}`, datePerformed: '2026-10-05', customTypeName: 'Wiper blades' });
    expect(written()[0].schemaId).toBeUndefined();
    expect(sent.some((c) => c.input.TableName === 'SCHEMAS_TABLE')).toBe(false);
  });

  it('attaches a new receipt to a custom-type record', async () => {
    const res = await put(androidBody({ receiptPhotoKey: RECEIPT }));
    expect(res.status).toBe(200);
    expect(written()[0]).toMatchObject({ receiptPhotoKey: RECEIPT, customTypeName: 'Wiper blades' });
  });

  it('keeps a schedule-type record on its schema and drops the null customTypeName', async () => {
    stored = { ...scheduleRecord };
    const res = await put(androidBody({ schemaId: SID, customTypeName: null, cost: 60 }));
    expect(res.status).toBe(200);
    expect(written()[0]).toMatchObject({ schemaId: SID, schemaName: 'Oil change', cost: 60 });
    expect(written()[0].customTypeName).toBeUndefined();
  });

  it('switches a schedule record to a custom type when schemaId is null and a name is given', async () => {
    stored = { ...scheduleRecord };
    const res = await put(androidBody({ customTypeName: 'Cabin filter' }));
    expect(res.status).toBe(200);
    expect(written()[0]).toMatchObject({ customTypeName: 'Cabin filter' });
    expect(written()[0].schemaId).toBeUndefined();
    expect(written()[0].schemaName).toBeUndefined();
  });

  it('refuses to leave a record with neither a schema nor a custom type name (400, nothing written)', async () => {
    const res = await put(androidBody({ customTypeName: null }));
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Either schemaId or customTypeName is required');
    expect(written()).toHaveLength(0);
    expect(deletes()).toHaveLength(0);
  });

  it('still returns 404 for an unknown schema', async () => {
    expect((await put(androidBody({ schemaId: '01KS5M8EYJ5VP2GYMBBEQZ5VPZ' }))).status).toBe(404);
  });
});

describe('maintenance update with a sparse body (web, queued receipt attach)', () => {
  it('leaves the type alone when schemaId and customTypeName are absent', async () => {
    const res = await put({ receiptPhotoKey: RECEIPT });
    expect(res.status).toBe(200);
    expect(written()[0]).toMatchObject({ customTypeName: 'Wiper blades', receiptPhotoKey: RECEIPT });
  });
});
