import { describe, it, expect, vi, beforeEach } from 'vitest';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { main, type Deps } from '../src/main.js';
import { SessionStore } from '../src/session.js';

const SUB = '11111111-aaaa-4bbb-8ccc-222222222222';
const V1 = '01KHKHBG12P5BK5724XW7X0D30';
const V2 = '01KHKHBG12P5BK5724XW7X0D31';
const S1 = '01KS5M8EYJ5VP2GYMBBEQZ5VPH';
const TS = '2026-10-20T17:41:39.695Z';
const vehicle = (vehicleId: string, nickname: string, isArchived = false) =>
  ({ userId: SUB, vehicleId, nickname, make: 'Subaru', model: 'Outback', year: 2019, isArchived, createdAt: TS, updatedAt: TS });
const fillup = (n: number) => ({
  vehicleId: V1, fillupId: `01KS5M8EYJ5VP2GYMBBEQZ5V${String(n).padStart(2, '0')}`, userId: SUB, date: `2026-10-${String(n).padStart(2, '0')}`,
  currencySpent: 40, gallonsAdded: 12.5, odometerReading: 50000 + n * 300, isPartialFill: false, isBusiness: false,
  pricePerGallon: 3.2, milesSinceLastFillup: 300, mpg: 24, costPerMile: 0.13, daysSinceLastFillup: 7, createdAt: TS, updatedAt: TS,
});

type Handler = (req: { method: string; path: string; query: URLSearchParams; body: any; headers: Record<string, string> }) => { status?: number; body: unknown };
let routes: Record<string, Handler>;
let calls: Array<{ method: string; path: string; query: URLSearchParams; body: any; headers: Record<string, string> }>;
let output: string[];
let errors: string[];
let deps: Deps;
let cwd: string;

const ok = (data: unknown, extra: Record<string, unknown> = {}) => ({ body: { data, requestId: 'r', ...extra } });

beforeEach(() => {
  const dir = mkdtempSync(join(tmpdir(), 'pm-cmd-'));
  cwd = mkdtempSync(join(tmpdir(), 'pm-cwd-'));
  const store = new SessionStore(dir);
  store.save({
    env: 'staging', apiUrl: 'https://api.test',
    auth: { issuer: 'https://i', domain: 'auth.test', scopes: ['openid'], clients: { cli: { clientId: 'c', redirectUri: 'http://localhost:47815/callback', logoutUri: 'http://localhost:47815/signout' } } },
    tokens: { accessToken: 'tok', refreshToken: 'r', expiresAt: Date.now() + 3_600_000 },
  });
  store.setDefaultEnv('staging');
  calls = [];
  output = [];
  errors = [];
  routes = {
    'GET /v1/vehicles': () => ok([vehicle(V1, 'Outback'), vehicle(V2, 'Old Civic', true)]),
    'GET /v1/vehicles/shared': () => ok([]),
  };
  const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    if (url.hostname === 's3.test') return new Response('date,gallons\n2026-10-01,12.5\n');
    const req = { method: init?.method ?? 'GET', path: url.pathname, query: url.searchParams, body: init?.body ? JSON.parse(init.body as string) : undefined, headers: init?.headers as Record<string, string> };
    calls.push(req);
    const handler = routes[`${req.method} ${req.path}`];
    if (!handler) return new Response(JSON.stringify({ error: 'Not found', code: 'NOT_FOUND', requestId: 'r404' }), { status: 404 });
    const { status = 200, body } = handler(req);
    return new Response(JSON.stringify(body), { status });
  });
  deps = { out: (t) => output.push(t), err: (t) => errors.push(t), store, fetch: fetchMock as never, openBrowser: vi.fn(), now: () => new Date(2026, 9, 21, 12), cwd };
});

const run = (...argv: string[]) => main(argv, deps);

describe('vehicles and resolution', () => {
  it('lists active vehicles with the access token and X-Client header', async () => {
    expect(await run('vehicles')).toBe(0);
    expect(output[0]).toContain('Outback');
    expect(calls[0].query.get('status')).toBe('active');
    expect(calls[0].headers).toMatchObject({ Authorization: 'Bearer tok', 'X-Client': 'cli/0.1.0' });
  });

  it('uses the only active vehicle when none is named, and matches nicknames case-insensitively or by prefix', async () => {
    routes['GET /v1/vehicles/01KHKHBG12P5BK5724XW7X0D30/fillups'] = () => ok([fillup(2), fillup(1)]);
    expect(await run('fillups')).toBe(0);
    expect(await run('fillups', 'outback')).toBe(0);
    expect(await run('fillups', 'out')).toBe(0);
    expect(calls.filter((c) => c.path.endsWith('/fillups'))).toHaveLength(3);
  });

  it('explains an unknown vehicle with exit code 2', async () => {
    expect(await run('fillups', 'tesla')).toBe(2);
    expect(errors[0]).toContain('No vehicle "tesla". Yours: "Outback", "Old Civic"');
  });
});

describe('fillups', () => {
  it('pages newest first with --limit, and walks every page with --all', async () => {
    routes[`GET /v1/vehicles/${V1}/fillups`] = ({ query }) => query.get('cursor')
      ? ok([fillup(1)])
      : ok([fillup(3), fillup(2)], { nextCursor: 'c2' });
    await run('fillups', '--limit', '2');
    const listCalls = () => calls.filter((c) => c.path.endsWith('/fillups'));
    expect(Object.fromEntries(listCalls()[0].query)).toEqual({ limit: '2', order: 'desc' });
    expect(output.at(-1)!.split('\n')).toHaveLength(3); // header + 2 rows

    await run('fillups', '--all', '--json');
    expect(listCalls().slice(1).map((c) => c.query.get('cursor'))).toEqual([null, 'c2']);
    expect(JSON.parse(output.at(-1)!)).toHaveLength(3);
  });

  it('adds a fill-up for today with an Idempotency-Key, retrying a 5xx with the same key', async () => {
    let attempts = 0;
    routes[`POST /v1/vehicles/${V1}/fillups`] = ({ body }) => (++attempts === 1
      ? { status: 502, body: { error: 'Bad gateway', code: 'INTERNAL_ERROR', requestId: 'r' } }
      : { status: 201, body: { data: { ...fillup(21), ...body }, requestId: 'r' } });
    expect(await run('fillup', 'add', '--gallons', '12.4', '--cost', '$41.20', '--odometer', '52,310', '--partial')).toBe(0);
    const posts = calls.filter((c) => c.method === 'POST');
    expect(posts).toHaveLength(2);
    expect(posts[0].headers['Idempotency-Key']).toMatch(/^[0-9a-f-]{36}$/);
    expect(posts[1].headers['Idempotency-Key']).toBe(posts[0].headers['Idempotency-Key']);
    expect(posts[0].body).toEqual({ date: '2026-10-21', gallonsAdded: 12.4, currencySpent: 41.2, odometerReading: 52310, isPartialFill: true, isBusiness: false });
    expect(output.at(-1)).toBe('Added fill-up to Outback on 2026-10-21: 12.400 gal, $41.20, 24.0 mpg');
  });

  it('rejects missing or non-numeric values before calling the API', async () => {
    expect(await run('fillup', 'add', '--gallons', '12', '--cost', 'ten', '--odometer', '1')).toBe(2);
    expect(errors[0]).toContain('--cost must be a number');
    expect(await run('fillup', 'add', '--gallons', '12')).toBe(2);
    expect(errors[1]).toContain('--cost is required');
    expect(calls.filter((c) => c.method === 'POST')).toHaveLength(0);
  });

  it('reports API validation errors with the request ID', async () => {
    routes[`POST /v1/vehicles/${V1}/fillups`] = () => ({ status: 400, body: { error: 'odometerReading must be greater than the previous fill-up', code: 'VALIDATION_ERROR', requestId: 'req-9' } });
    expect(await run('fillup', 'add', '-g', '12', '-c', '40', '-o', '1')).toBe(1);
    expect(errors[0]).toBe('Error: odometerReading must be greater than the previous fill-up (request req-9).');
  });
});

describe('maintenance', () => {
  beforeEach(() => {
    routes[`GET /v1/vehicles/${V1}/maintenance/schemas`] = () => ok([{ schemaId: S1, name: 'Oil Change', description: '', defaultMileageInterval: 5000, defaultTimeIntervalDays: 180, category: 'engine', isActive: true, createdAt: TS, updatedAt: TS }]);
    routes[`POST /v1/vehicles/${V1}/maintenance`] = ({ body }) => ({ status: 201, body: { data: {
      vehicleId: V1, recordId: S1, userId: SUB, ...body, ...(body.schemaId && { schemaName: 'Oil Change' }), createdAt: TS, updatedAt: TS,
    }, requestId: 'r' } });
  });

  it('matches a known maintenance type by name, else records a custom type', async () => {
    expect(await run('maintenance', 'add', '--type', 'oil change', '--odometer', '52310', '--cost', '65')).toBe(0);
    expect(await run('maintenance', 'add', '-t', 'Wiper blades', '-o', '52310', '-c', '20')).toBe(0);
    const bodies = calls.filter((c) => c.method === 'POST').map((c) => c.body);
    expect(bodies[0]).toEqual({ schemaId: S1, datePerformed: '2026-10-21', odometerAtService: 52310, cost: 65 });
    expect(bodies[1]).toMatchObject({ customTypeName: 'Wiper blades' });
    expect(output).toEqual(['Added Oil Change to Outback on 2026-10-21: $65.00', 'Added Wiper blades to Outback on 2026-10-21: $20.00 (custom type)']);
  });
});

describe('export', () => {
  it('downloads the CSV next to you and refuses to overwrite without --force', async () => {
    routes[`GET /v1/vehicles/${V1}/export/fillups`] = () => ok({ downloadUrl: 'https://s3.test/x.csv', recordCount: 1 });
    expect(await run('export', 'fillups', '--from', '2026-01-01')).toBe(0);
    const path = join(cwd, 'outback-fillups.csv');
    expect(readFileSync(path, 'utf8')).toContain('2026-10-01');
    expect(calls.at(-1)!.query.get('startDate')).toBe('2026-01-01');
    expect(await run('export', 'fillups')).toBe(2);
    expect(errors[0]).toContain('exists; pass --force');
    expect(await run('export', 'outback', 'fillups', '--force')).toBe(0);
    expect(existsSync(path)).toBe(true);
  });
});

describe('main', () => {
  it('prints help, versions and usage errors with the right exit codes', async () => {
    expect(await run('--help')).toBe(0);
    expect(output[0]).toContain('fillup add');
    expect(await run('--version')).toBe(0);
    expect(output[1]).toBe('0.1.0');
    expect(await run('frobnicate')).toBe(2);
    expect(await run('vehicles', '--bogus')).toBe(2);
    expect(errors.at(-1)).toContain('Usage: pm vehicles');
  });

  it('asks for login when the environment has no session', async () => {
    expect(await run('vehicles', '--env', 'production')).toBe(1);
    expect(errors[0]).toBe('Not signed in. Run: pm login');
  });
});
