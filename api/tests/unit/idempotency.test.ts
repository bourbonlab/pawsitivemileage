import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { APIGatewayProxyEventV2 } from 'aws-lambda';

/** In-memory table honouring the conditional put used for the pending record */
const table = new Map<string, Record<string, unknown>>();
const send = vi.fn(async (cmd: { constructor: { name: string }; input: Record<string, any> }) => {
  const { input } = cmd;
  switch (cmd.constructor.name) {
    case 'PutCommand':
      if (input.ConditionExpression && table.has(input.Item.id)) {
        throw Object.assign(new Error('exists'), { name: 'ConditionalCheckFailedException' });
      }
      table.set(input.Item.id, { ...input.Item });
      return {};
    case 'GetCommand':
      return { Item: table.get(input.Key.id) };
    case 'UpdateCommand': {
      const v = input.ExpressionAttributeValues;
      table.set(input.Key.id, { ...table.get(input.Key.id), state: v[':completed'], statusCode: v[':status'], body: v[':body'] });
      return {};
    }
    case 'DeleteCommand':
      table.delete(input.Key.id);
      return {};
    default:
      throw new Error(`unexpected ${cmd.constructor.name}`);
  }
});
vi.mock('../../src/lib/dynamo', () => ({ getDocClient: () => ({ send }), getTableName: () => 'idempotency-test' }));

const { withIdempotency } = await import('../../src/lib/idempotency');

const event = (key?: string, body = '{"gallonsAdded":12.3}'): APIGatewayProxyEventV2 => ({
  rawPath: '/v1/vehicles/V/fillups', body, headers: key === undefined ? {} : { 'idempotency-key': key },
  requestContext: { http: { method: 'POST' } },
}) as unknown as APIGatewayProxyEventV2;

const created = (id: string) => ({ statusCode: 201, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ data: { fillupId: id }, requestId: 'r' }) });
const status = (r: unknown) => (r as { statusCode: number }).statusCode;
const json = (r: unknown) => JSON.parse((r as { body: string }).body);

beforeEach(() => { table.clear(); send.mockClear(); });

describe('withIdempotency', () => {
  it('passes straight through without the header', async () => {
    const handle = vi.fn(async () => created('F1'));
    expect(status(await withIdempotency(event(), 'u1', 'r', handle))).toBe(201);
    expect(handle).toHaveBeenCalledOnce();
    expect(send).not.toHaveBeenCalled();
  });

  it('rejects malformed keys without running the request', async () => {
    const handle = vi.fn(async () => created('F1'));
    const res = await withIdempotency(event('has spaces!'), 'u1', 'r', handle);
    expect(status(res)).toBe(400);
    expect(json(res).code).toBe('VALIDATION_ERROR');
    expect(handle).not.toHaveBeenCalled();
  });

  it('replays the original response for a retry, without creating again', async () => {
    const handle = vi.fn(async () => created(`F${handle.mock.calls.length}`));
    const first = await withIdempotency(event('k1'), 'u1', 'r', handle);
    const retry = await withIdempotency(event('k1'), 'u1', 'r', handle);
    expect(handle).toHaveBeenCalledOnce();
    expect(status(retry)).toBe(201);
    expect(json(retry)).toEqual(json(first));
    expect((retry as { headers: Record<string, string> }).headers['Idempotent-Replayed']).toBe('true');
  });

  it('refuses to reuse a key for a different request', async () => {
    await withIdempotency(event('k1'), 'u1', 'r', async () => created('F1'));
    const res = await withIdempotency(event('k1', '{"gallonsAdded":99}'), 'u1', 'r', async () => created('F2'));
    expect(status(res)).toBe(409);
    expect(json(res).error).toMatch(/different request/);
  });

  it('answers 409 while the first request is still in flight (no double create)', async () => {
    let release!: () => void;
    const slow = vi.fn(() => new Promise<ReturnType<typeof created>>((resolve) => { release = () => resolve(created('F1')); }));
    const inFlight = withIdempotency(event('k1'), 'u1', 'r', slow);
    await vi.waitFor(() => expect(slow).toHaveBeenCalled());
    const concurrent = await withIdempotency(event('k1'), 'u1', 'r', async () => created('F2'));
    expect(status(concurrent)).toBe(409);
    expect(json(concurrent).error).toMatch(/still in progress/);
    release();
    expect(status(await inFlight)).toBe(201);
  });

  it('lets a retry run again after a server error or a thrown error', async () => {
    const failing = vi.fn(async () => ({ statusCode: 500, body: '{}' }));
    await withIdempotency(event('k1'), 'u1', 'r', failing);
    expect(status(await withIdempotency(event('k1'), 'u1', 'r', async () => created('F1')))).toBe(201);

    await expect(withIdempotency(event('k2'), 'u1', 'r', async () => { throw new Error('boom'); })).rejects.toThrow('boom');
    expect(status(await withIdempotency(event('k2'), 'u1', 'r', async () => created('F2')))).toBe(201);
  });

  it('stores client errors too: a retried invalid request gets the same 400', async () => {
    const invalid = vi.fn(async () => ({ statusCode: 400, body: '{"error":"gallonsAdded is required","code":"VALIDATION_ERROR"}' }));
    await withIdempotency(event('k1'), 'u1', 'r', invalid);
    const retry = await withIdempotency(event('k1'), 'u1', 'r', invalid);
    expect(invalid).toHaveBeenCalledOnce();
    expect(status(retry)).toBe(400);
  });

  it('scopes keys per user', async () => {
    const handle = vi.fn(async () => created('F'));
    await withIdempotency(event('same'), 'u1', 'r', handle);
    await withIdempotency(event('same'), 'u2', 'r', handle);
    expect(handle).toHaveBeenCalledTimes(2);
  });
});
