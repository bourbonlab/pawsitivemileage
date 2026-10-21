import { describe, it, expect, vi, expectTypeOf } from 'vitest';
import { ApiError, buildPath, createClient, type Fillup, type Vehicle } from '../src/index.js';

const VID = '01KHKHBG12P5BK5724XW7X0D30';
const FID = '01KS5M8EYJ5VP2GYMBBEQZ5VPH';
const SUB = '11111111-aaaa-4bbb-8ccc-222222222222';
const TS = '2026-10-20T17:41:39.695Z';
const vehicle = { userId: SUB, vehicleId: VID, nickname: 'Daily', make: 'Subaru', model: 'Outback', year: 2019, isArchived: false, createdAt: TS, updatedAt: TS };

function mockFetch(status: number, body: unknown) {
  return vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }));
}

function client(fetchImpl: ReturnType<typeof mockFetch>, extra: Partial<Parameters<typeof createClient>[0]> = {}) {
  return createClient({ baseUrl: 'https://api.example.app/', getToken: async () => 'tok', fetch: fetchImpl as unknown as typeof fetch, ...extra });
}

describe('requests', () => {
  it('builds the URL from path params and query, with auth', async () => {
    const f = mockFetch(200, { data: [vehicle], requestId: 'r1' });
    await client(f).listVehicles({ query: { status: 'all' } });
    const [url, init] = f.mock.calls[0];
    expect(url).toBe('https://api.example.app/v1/vehicles?status=all');
    expect(init?.method).toBe('GET');
    expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer tok');
    expect(init?.body).toBeUndefined();
  });

  it('sends JSON bodies with the right method and path', async () => {
    const f = mockFetch(201, { data: { ...vehicle }, requestId: 'r2' });
    await client(f).createVehicle({ body: { nickname: 'Daily', make: 'Subaru', model: 'Outback', year: 2019 } });
    const [url, init] = f.mock.calls[0];
    expect(url).toBe('https://api.example.app/v1/vehicles');
    expect(init?.method).toBe('POST');
    expect((init?.headers as Record<string, string>)['Content-Type']).toBe('application/json');
    expect(JSON.parse(init?.body as string)).toEqual({ nickname: 'Daily', make: 'Subaru', model: 'Outback', year: 2019 });
  });

  it('fills and encodes path parameters', () => {
    expect(buildPath('/v1/vehicles/{vehicleId}/fillups/{fillupId}', { vehicleId: VID, fillupId: 'a b' })).toBe(`/v1/vehicles/${VID}/fillups/a%20b`);
    expect(() => buildPath('/v1/vehicles/{vehicleId}', {})).toThrow(ApiError);
  });

  it('omits undefined query values and adds client headers', async () => {
    const f = mockFetch(200, { data: { downloadUrl: 'https://s3.example/x.csv', recordCount: 3 }, requestId: 'r' });
    await client(f, { headers: { 'X-Client': 'cli/1.0.0' } }).exportFillups({ params: { vehicleId: VID }, query: { startDate: '2026-01-01', endDate: undefined } });
    const [url, init] = f.mock.calls[0];
    expect(url).toBe(`https://api.example.app/v1/vehicles/${VID}/export/fillups?startDate=2026-01-01`);
    expect((init?.headers as Record<string, string>)['X-Client']).toBe('cli/1.0.0');
  });
});

describe('responses', () => {
  it('unwraps the { data, requestId } envelope', async () => {
    const vehicles = await client(mockFetch(200, { data: [vehicle], requestId: 'r' })).listVehicles();
    expect(vehicles).toEqual([vehicle]);
  });

  it('turns error bodies into ApiError with status, code and requestId', async () => {
    const call = client(mockFetch(404, { error: 'Vehicle not found', code: 'NOT_FOUND', requestId: 'r404' })).getVehicle({ params: { vehicleId: VID } });
    await expect(call).rejects.toMatchObject({ name: 'ApiError', status: 404, code: 'NOT_FOUND', message: 'Vehicle not found', requestId: 'r404' });
  });

  it('maps unknown error codes and non-JSON errors to INTERNAL_ERROR', async () => {
    await expect(client(mockFetch(500, { error: 'boom', code: 'TEAPOT' })).listVehicles()).rejects.toMatchObject({ code: 'INTERNAL_ERROR', status: 500 });
    const html = vi.fn(async () => new Response('<html>Bad gateway</html>', { status: 502 }));
    await expect(client(html as never).listVehicles()).rejects.toMatchObject({ code: 'INTERNAL_ERROR', status: 502 });
  });

  it('rejects a 2xx body that is not an envelope', async () => {
    await expect(client(mockFetch(200, [vehicle])).listVehicles()).rejects.toMatchObject({ code: 'CONTRACT_MISMATCH' });
  });

  it('validates responses against the contract when asked', async () => {
    const bad = { data: [{ ...vehicle, year: 'twenty-nineteen' }], requestId: 'r' };
    await expect(client(mockFetch(200, bad)).listVehicles()).resolves.toBeDefined(); // off by default
    await expect(client(mockFetch(200, bad), { validateResponses: true }).listVehicles()).rejects.toMatchObject({ code: 'CONTRACT_MISMATCH' });
  });
});

describe('idempotency keys', () => {
  it('sends Idempotency-Key on create routes when given', async () => {
    const f = mockFetch(201, { data: {}, requestId: 'r' });
    await client(f).createFillup({ params: { vehicleId: VID }, idempotencyKey: 'retry-123', body: { date: '2026-10-20', currencySpent: 1, gallonsAdded: 1, odometerReading: 1 } });
    expect((f.mock.calls[0][1]?.headers as Record<string, string>)['Idempotency-Key']).toBe('retry-123');
    const neverRun = () => {
      // @ts-expect-error: only idempotent (create) routes accept idempotencyKey
      void client(f).updateFillup({ params: { vehicleId: VID, fillupId: FID }, body: {}, idempotencyKey: 'x' });
    };
    expect(neverRun).toBeTypeOf('function');
  });
});

describe('public routes', () => {
  it('calls getMeta without a token or Authorization header', async () => {
    const meta = { apiVersion: 'v1', minimumVersions: { android: '1.0.0' }, features: {}, serverTime: '2026-10-21T12:00:00.000Z',
      links: { privacyPolicy: 'https://x.app/privacy', terms: 'https://x.app/terms', accountDeletion: 'https://x.app/account' } };
    const f = mockFetch(200, { data: meta, requestId: 'r' });
    const getToken = vi.fn(() => null);
    await expect(client(f, { getToken, validateResponses: true }).getMeta()).resolves.toEqual(meta);
    expect(getToken).not.toHaveBeenCalled();
    expect((f.mock.calls[0][1]?.headers as Record<string, string>).Authorization).toBeUndefined();
  });
});

describe('client-side guards', () => {
  it('does not call fetch without a token', async () => {
    const f = mockFetch(200, { data: [], requestId: 'r' });
    await expect(client(f, { getToken: () => null }).listVehicles()).rejects.toMatchObject({ status: 401, code: 'UNAUTHORIZED' });
    expect(f).not.toHaveBeenCalled();
  });

  it('validates request bodies before sending when asked', async () => {
    const f = mockFetch(201, { data: {}, requestId: 'r' });
    const api = client(f, { validateRequests: true });
    await expect(api.createFillup({ params: { vehicleId: VID }, body: { date: '2026-10-20', currencySpent: 0, gallonsAdded: 1, odometerReading: 1 } }))
      .rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(f).not.toHaveBeenCalled();
  });

  it('wraps network failures', async () => {
    const down = vi.fn(async () => { throw new TypeError('fetch failed'); });
    await expect(client(down as never).listVehicles()).rejects.toMatchObject({ code: 'NETWORK_ERROR', status: 0 });
  });
});

describe('types (checked by tsc during lint)', () => {
  it('derives arguments and results from the contract', () => {
    const api = client(mockFetch(200, { data: [], requestId: 'r' }));
    expectTypeOf(api.listVehicles).returns.resolves.toEqualTypeOf<Vehicle[]>();
    expectTypeOf(api.getFillup).returns.resolves.toEqualTypeOf<Fillup>();
    expectTypeOf(api.getFillup).parameter(0).toHaveProperty('params').toEqualTypeOf<{ vehicleId: string; fillupId: string }>();

    // Compile-time only: these calls are never executed
    const neverRun = () => {
      // @ts-expect-error: vehicleId is required
      void api.getVehicle({ params: {} });
      // @ts-expect-error: getVehicle needs arguments
      void api.getVehicle();
      // @ts-expect-error: createFillup requires a body
      void api.createFillup({ params: { vehicleId: VID } });
      // @ts-expect-error: unknown status value
      void api.listVehicles({ query: { status: 'deleted' } });
      // @ts-expect-error: listVehicles takes no path params
      void api.listVehicles({ params: { vehicleId: VID } });
      // Optional body: no error
      void api.exportReport({ params: { vehicleId: VID } });
      void api.listVehicles();
    };
    expect(neverRun).toBeTypeOf('function');
  });

  it('exposes FID-shaped ids as strings', () => {
    expectTypeOf(FID).toBeString();
  });
});
