import { describe, it, expect } from 'vitest';
import { error, success } from '../../src/lib/response';

const body = (res: { body: string }) => JSON.parse(res.body);

describe('success', () => {
  it('wraps data in { data, requestId } with the given status', () => {
    const res = success({ a: 1 }, 'r1', 201);
    expect(res.statusCode).toBe(201);
    expect(body(res)).toEqual({ data: { a: 1 }, requestId: 'r1' });
  });

  it('drops DynamoDB storage keys at any depth (#20)', () => {
    const fillup = {
      vehicleId: 'V', fillupId: 'F', date: '2026-10-20', mpg: null, stationName: undefined,
      GSI1PK: 'user', GSI1SK: '2026-10-20', GSI2PK: 'FILLUPS', GSI2SK: '2026-10-20', fillupDateId: '2026-10-20#F',
    };
    const res = body(success({ items: [fillup], share: { vehicleEmailKey: 'V#a@b.co', shareId: 'S' }, record: { serviceDateId: 'x', recordId: 'R' } }, 'r'));
    expect(res.data.items[0]).toEqual({ vehicleId: 'V', fillupId: 'F', date: '2026-10-20', mpg: null });
    expect(res.data.share).toEqual({ shareId: 'S' });
    expect(res.data.record).toEqual({ recordId: 'R' });
  });

  it('keeps fields that only look similar', () => {
    expect(body(success({ GSI: 1, userGSI1PK: 2, fillupId: 'F' }, 'r')).data).toEqual({ GSI: 1, userGSI1PK: 2, fillupId: 'F' });
  });
});

describe('error', () => {
  it('maps codes to statuses', () => {
    expect(error('CONFLICT', 'stale', 'r').statusCode).toBe(409);
    expect(body(error('NOT_FOUND', 'Vehicle not found', 'r'))).toEqual({ error: 'Vehicle not found', code: 'NOT_FOUND', requestId: 'r' });
  });
});
