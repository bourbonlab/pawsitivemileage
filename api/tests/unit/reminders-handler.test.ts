/**
 * Reminders start with the first recorded service of a type: a vehicle with no oil change on
 * record isn't told it is 116,000 miles overdue.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { APIGatewayProxyEventV2 } from 'aws-lambda';

const SUB = '11111111-aaaa-4bbb-8ccc-222222222222';
const VID = '01KHKHBG12P5BK5724XW7X0D30';
const OIL = '01M5FV5N9GKCZ2MG85X5AGPKP0';
const TIRES = '01M5FV5N9GKCZ2MG85X5AGPKP1';
const TS = '2024-01-01T00:00:00.000Z';
const today = new Date().toISOString().split('T')[0];
const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString().split('T')[0];

const schema = (schemaId: string, name: string) => ({ schemaId, name, description: '', defaultMileageInterval: 5000, defaultTimeIntervalDays: 180, category: 'engine', isActive: true, createdAt: TS, updatedAt: TS });
let records: Array<Record<string, unknown>>;
const mockSend = vi.fn(async (cmd: { constructor: { name: string }; input: Record<string, any> }) => {
  const table = cmd.input.TableName;
  if (cmd.constructor.name === 'GetCommand') return { Item: { userId: SUB, vehicleId: VID, nickname: 'Daily', make: 'Nissan', model: 'Xterra', year: 2016, isArchived: false, createdAt: TS, updatedAt: TS } };
  if (table === 'SCHEMAS_TABLE') return { Items: [schema(OIL, 'Oil Change'), schema(TIRES, 'Tire Rotation')] };
  if (table === 'FILLUPS_TABLE') return { Items: [{ odometerReading: 121500 }] };
  if (table === 'MAINTENANCE_TABLE') return { Items: records };
  return {};
});
vi.mock('../../src/lib/dynamo', () => ({ getDocClient: () => ({ send: mockSend }), getTableName: (n: string) => n }));
vi.mock('../../src/lib/authSharing', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/lib/authSharing')>()),
  verifyAccess: vi.fn(async () => ({ allowed: true, isOwner: true, ownerUserId: SUB, permission: null })),
}));

const { handler } = await import('../../src/handlers/maintenanceCrud');
const reminders = async () => {
  const res = await handler({
    version: '2.0', rawPath: `/v1/vehicles/${VID}/maintenance/reminders`, headers: {}, pathParameters: { vehicleId: VID },
    requestContext: { requestId: 't', http: { method: 'GET', path: `/v1/vehicles/${VID}/maintenance/reminders` }, authorizer: { jwt: { claims: { sub: SUB } } } },
  } as unknown as APIGatewayProxyEventV2) as { statusCode: number; body: string };
  expect(res.statusCode).toBe(200);
  return JSON.parse(res.body).data as Array<{ schemaName: string; isOverdue: boolean; mileageRemaining: number | null }>;
};
const record = (over: Record<string, unknown>) => ({ vehicleId: VID, recordId: '01M5G0000000000000000000R1', userId: SUB, cost: 50, createdAt: TS, updatedAt: TS, ...over });

beforeEach(() => { records = []; });

describe('maintenance reminders', () => {
  it('shows nothing for types never recorded (no counting from odometer 0)', async () => {
    expect(await reminders()).toEqual([]);
  });

  it('ignores a custom record that only shares the name', async () => {
    records = [record({ customTypeName: 'Oil Change', datePerformed: daysAgo(400), odometerAtService: 100000 })];
    expect(await reminders()).toEqual([]);
  });

  it('starts once a service of that type is recorded, and only for that type', async () => {
    records = [record({ schemaId: OIL, schemaName: 'Oil Change', datePerformed: daysAgo(400), odometerAtService: 110000 })];
    const list = await reminders();
    expect(list.map((r) => r.schemaName)).toEqual(['Oil Change']);
    expect(list[0]).toMatchObject({ isOverdue: true, mileageRemaining: 110000 + 5000 - 121500 });
  });

  it('is quiet right after a service', async () => {
    records = [record({ schemaId: OIL, schemaName: 'Oil Change', datePerformed: today, odometerAtService: 121500 })];
    expect(await reminders()).toEqual([]);
  });
});
