/**
 * Import limits (security review 2026-10-23): the CSV is refused over 10 MB before it is read,
 * and rows whose text fields break the contract's length limits are skipped, not stored.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { APIGatewayProxyEventV2 } from 'aws-lambda';

const SUB = '11111111-aaaa-4bbb-8ccc-222222222222';
const VID = '01KHKHBG12P5BK5724XW7X0D30';
const KEY = `${SUB}/${VID}/csv-import/01KHKHBG12P5BK5724XW7X0D31-fuelly.csv`;

const mockSend = vi.fn(async (cmd: { constructor: { name: string }; input: Record<string, any> }) => {
  switch (cmd.constructor.name) {
    case 'GetCommand':
      return { Item: { userId: SUB, vehicleId: VID } };
    case 'QueryCommand':
      return { Items: [] };
    case 'BatchWriteCommand':
      return { UnprocessedItems: {} };
    default:
      return {};
  }
});
vi.mock('../../src/lib/dynamo', () => ({ getDocClient: () => ({ send: mockSend }), getTableName: (n: string) => n }));

const s3Object = { ContentLength: 0 as number | undefined, text: '' };
const destroy = vi.fn();
vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: class { send = vi.fn(async () => ({ ContentLength: s3Object.ContentLength, Body: { transformToString: async () => s3Object.text, destroy } })); },
  GetObjectCommand: class { constructor(public input: unknown) {} },
}));
process.env.PHOTOS_BUCKET = 'photos-test';

const { handler } = await import('../../src/handlers/importData');

const importCsv = (type: 'fuelups' | 'maintenance', body: unknown = { s3Key: KEY }) => {
  const path = `/v1/vehicles/${VID}/import/${type}`;
  return handler({
    version: '2.0', rawPath: path, headers: {}, pathParameters: { vehicleId: VID, type }, body: JSON.stringify(body), isBase64Encoded: false,
    requestContext: { requestId: 't', http: { method: 'POST', path }, authorizer: { jwt: { claims: { sub: SUB } } } },
  } as unknown as APIGatewayProxyEventV2) as Promise<{ statusCode: number; body: string }>;
};
const writtenItems = () => mockSend.mock.calls
  .filter(([cmd]) => cmd.constructor.name === 'BatchWriteCommand')
  .flatMap(([cmd]) => (Object.values(cmd.input.RequestItems)[0] as Array<{ PutRequest: { Item: Record<string, unknown> } }>).map((r) => r.PutRequest.Item));
const useCsv = (text: string) => Object.assign(s3Object, { text, ContentLength: Buffer.byteLength(text) });

beforeEach(() => {
  mockSend.mockClear();
  destroy.mockClear();
});

describe('import size limit', () => {
  it('refuses a CSV over 10 MB without reading it', async () => {
    Object.assign(s3Object, { ContentLength: 10 * 1024 * 1024 + 1, text: 'unread' });
    const res = await importCsv('fuelups');
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toBe('CSV file exceeds maximum of 10 MB');
    expect(destroy).toHaveBeenCalled();
    expect(writtenItems()).toHaveLength(0);
  });

  it('refuses a request body over the shared 64 KB cap', async () => {
    const res = await importCsv('fuelups', { s3Key: KEY, padding: 'x'.repeat(70_000) });
    expect(res.statusCode).toBe(400);
  });
});

describe('import text length limits', () => {
  it('skips fill-up rows whose notes are longer than the API allows', async () => {
    useCsv(`fuelup_date,gallons,odometer,price,notes\n2024-08-08,13.5,44800,3.37,ok\n2024-08-09,10,45100,3.40,${'x'.repeat(1001)}`);
    const res = await importCsv('fuelups');
    const { data } = JSON.parse(res.body);
    expect(res.statusCode).toBe(200);
    expect(data).toMatchObject({ totalRows: 2, imported: 1, skipped: 1 });
    expect(writtenItems().map((i) => i.notes)).toEqual(['ok']);
  });

  it('skips maintenance rows whose type name or notes are too long', async () => {
    const longType = Array.from({ length: 30 }, (_, i) => `service_type_${i}`).join(',');
    useCsv(`service_date,odometer,price,sub_service_types,notes\n2024-08-08,44800,45.99,oil_filter,ok\n2024-08-09,44900,10,"${longType}",fine\n2024-08-10,45000,10,tires,${'y'.repeat(1001)}`);
    const res = await importCsv('maintenance');
    const { data } = JSON.parse(res.body);
    expect(data).toMatchObject({ totalRows: 3, imported: 1, skipped: 2 });
    expect(writtenItems().map((i) => i.customTypeName)).toEqual(['Oil Filter']);
  });
});
