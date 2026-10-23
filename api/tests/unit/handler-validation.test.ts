/**
 * Handlers validate requests with the API contract (#18): invalid input gets a 400 with the
 * established wording, before anything is written (and, for updates, before the record is read).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';

const SUB = '11111111-aaaa-4bbb-8ccc-222222222222';
const VID = '01KHKHBG12P5BK5724XW7X0D30';
const FID = '01KS5M8EYJ5VP2GYMBBEQZ5VPH';

const mockSend = vi.fn();
vi.mock('../../src/lib/dynamo', () => ({
  getDocClient: () => ({ send: mockSend }),
  getTableName: (name: string) => `${name.toLowerCase()}-test`,
}));
vi.mock('../../src/lib/authSharing', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/lib/authSharing')>()),
  verifyAccess: vi.fn(async () => ({ allowed: true, isOwner: true, ownerUserId: SUB, permission: null })),
  getUserEmail: vi.fn(async () => 'owner@example.com'),
}));

process.env.PHOTOS_BUCKET = 'photos-test';
process.env.EXPORTS_BUCKET = 'exports-test';

const { handler: fillups } = await import('../../src/handlers/fillupCrud');
const { handler: vehicles } = await import('../../src/handlers/vehicleCrud');
const { handler: maintenance } = await import('../../src/handlers/maintenanceCrud');
const { handler: sharing } = await import('../../src/handlers/sharingCrud');
const { handler: presign } = await import('../../src/handlers/presignUrl');
const { handler: profile } = await import('../../src/handlers/userProfile');

function event(method: string, path: string, body?: unknown, pathParameters?: Record<string, string>): APIGatewayProxyEventV2 {
  return {
    version: '2.0', routeKey: `${method} ${path}`, rawPath: path, rawQueryString: '', headers: {}, isBase64Encoded: false,
    pathParameters, body: body === undefined ? undefined : JSON.stringify(body),
    requestContext: {
      requestId: 'test', http: { method, path, protocol: 'HTTP/1.1', sourceIp: '127.0.0.1', userAgent: 'test' },
      authorizer: { jwt: { claims: { sub: SUB, email: 'owner@example.com' }, scopes: [] } },
    },
  } as unknown as APIGatewayProxyEventV2;
}

async function expect400(result: APIGatewayProxyResultV2 | Promise<APIGatewayProxyResultV2>, message: string) {
  const res = (await result) as { statusCode: number; body: string };
  expect(res.statusCode).toBe(400);
  expect(JSON.parse(res.body)).toMatchObject({ code: 'VALIDATION_ERROR', error: message });
}

const writes = () => mockSend.mock.calls.filter(([cmd]) => /Put|Update|Delete|BatchWrite/.test(cmd?.constructor?.name ?? ''));

beforeEach(() => {
  mockSend.mockReset();
  mockSend.mockResolvedValue({ Item: { userId: SUB, vehicleId: VID, isAdmin: false }, Items: [] });
});

describe('fill-ups', () => {
  const path = `/v1/vehicles/${VID}/fillups`;
  const ok = { date: '2026-10-20', currencySpent: 42.5, gallonsAdded: 12.3, odometerReading: 81234 };

  it('rejects a missing required field without writing', async () => {
    const { gallonsAdded: _g, ...body } = ok;
    await expect400(fillups(event('POST', path, body, { vehicleId: VID })), 'gallonsAdded is required');
    expect(writes()).toHaveLength(0);
  });

  it('rejects out-of-range amounts and coordinates', async () => {
    await expect400(fillups(event('POST', path, { ...ok, gallonsAdded: 0 }, { vehicleId: VID })), 'gallonsAdded must be at least 0.01');
    await expect400(fillups(event('POST', path, { ...ok, locationLng: 181 }, { vehicleId: VID })), 'locationLng must be at most 180');
  });

  it('PUT now rejects wrong types (handler gap closed), before reading the record', async () => {
    await expect400(fillups(event('PUT', `${path}/${FID}`, { currencySpent: '42.50' }, { vehicleId: VID, fillupId: FID })), 'currencySpent must be a number');
    expect(mockSend).not.toHaveBeenCalled();
  });
});

describe('vehicles', () => {
  const vehicle = { nickname: 'Daily', make: 'Subaru', model: 'Outback', year: 2019 };

  it('validates create', async () => {
    await expect400(vehicles(event('POST', '/v1/vehicles', { ...vehicle, nickname: '' })), 'nickname is required');
    await expect400(vehicles(event('POST', '/v1/vehicles', { ...vehicle, year: 1800 })), 'year must be at least 1900');
    await expect400(vehicles(event('POST', '/v1/vehicles', { ...vehicle, vin: 'x'.repeat(18) })), 'vin must be at most 17 characters');
    expect(writes()).toHaveLength(0);
  });

  it('accepts a valid create with unknown extra fields', async () => {
    const res = await vehicles(event('POST', '/v1/vehicles', { ...vehicle, somethingElse: true })) as { statusCode: number };
    expect(res.statusCode).toBe(201);
  });

  it('validates update before reading the vehicle, and archive', async () => {
    await expect400(vehicles(event('PUT', `/v1/vehicles/${VID}`, { tankSize: 0 }, { vehicleId: VID })), 'tankSize must be at least 0.1');
    expect(mockSend).not.toHaveBeenCalled();
    await expect400(vehicles(event('PATCH', `/v1/vehicles/${VID}/archive`, {}, { vehicleId: VID })), 'isArchived is required');
  });
});

describe('maintenance, sharing, uploads, profile', () => {
  it('requires a schema or custom type for maintenance', async () => {
    await expect400(maintenance(event('POST', `/v1/vehicles/${VID}/maintenance`, { datePerformed: '2026-10-01', odometerAtService: 1, cost: 1 }, { vehicleId: VID })),
      'Either schemaId or customTypeName is required');
  });

  it('validates share email and permission', async () => {
    const path = `/v1/vehicles/${VID}/sharing`;
    await expect400(sharing(event('POST', path, { email: 'nope', permission: 'fuel' }, { vehicleId: VID })), 'email must be a valid email address');
    await expect400(sharing(event('POST', path, { email: 'a@b.co', permission: 'owner' }, { vehicleId: VID })), 'permission must be one of: readonly, fuel, maintenance, full');
  });

  it('validates presign content type and size', async () => {
    const body = { uploadType: 'receipt-photo', vehicleId: VID, filename: 'r.pdf', contentType: 'application/pdf', fileSize: 1024 };
    await expect400(presign(event('POST', '/v1/upload/presign', { ...body, contentType: 'image/gif' })),
      'contentType must be one of: image/jpeg, image/png, image/webp, image/heic, application/pdf, application/msword, application/vnd.openxmlformats-officedocument.wordprocessingml.document, text/csv');
    await expect400(presign(event('POST', '/v1/upload/presign', { ...body, fileSize: 11 * 1024 * 1024 })), 'File size exceeds maximum of 10 MB');
    await expect400(presign(event('POST', '/v1/upload/presign', { ...body, fileSize: undefined })), 'fileSize is required');
  });

  it('keeps the profile message for a blank display name', async () => {
    await expect400(profile(event('PUT', '/v1/user/profile', { displayName: '   ' })), 'displayName is required and must be a non-empty string');
    expect(writes()).toHaveLength(0);
  });
});
