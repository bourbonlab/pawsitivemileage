import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { error, mediaUrl, success } from '../../src/lib/response';

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

describe('media URLs (#21)', () => {
  beforeEach(() => { process.env.FRONTEND_DOMAIN = 'staging.example.app'; });
  afterEach(() => { delete process.env.FRONTEND_DOMAIN; });

  it('adds photoUrl / receiptPhotoUrl next to the keys, at any depth, encoding segments', () => {
    const res = body(success({
      vehicles: [{ vehicleId: 'V', photoKey: 'u/V/vehicle-photo/01J-car.jpg' }],
      shared: { vehicle: { vehicleId: 'V2', photoKey: 'u2/V2/vehicle-photo/x.png' } },
      fillup: { fillupId: 'F', receiptPhotoKey: 'u/V/receipt-photo/01J-Payment Receipt_ One.pdf' },
    }, 'r'));
    expect(res.data.vehicles[0].photoUrl).toBe('https://staging.example.app/photos/u/V/vehicle-photo/01J-car.jpg');
    expect(res.data.shared.vehicle.photoUrl).toBe('https://staging.example.app/photos/u2/V2/vehicle-photo/x.png');
    expect(res.data.fillup.receiptPhotoUrl).toBe('https://staging.example.app/photos/u/V/receipt-photo/01J-Payment%20Receipt_%20One.pdf');
    expect(res.data.fillup.receiptPhotoKey).toBe('u/V/receipt-photo/01J-Payment Receipt_ One.pdf');
  });

  it('adds nothing for missing, null or empty keys, or without a configured domain', () => {
    const res = body(success([{ photoKey: null }, { receiptPhotoKey: '' }, { vehicleId: 'V' }], 'r'));
    expect(res.data).toEqual([{ photoKey: null }, { receiptPhotoKey: '' }, { vehicleId: 'V' }]);
    delete process.env.FRONTEND_DOMAIN;
    expect(mediaUrl('a/b.jpg')).toBeUndefined();
  });

  it('strips storage keys from objects that also get a media URL', () => {
    const res = body(success({ vehicleId: 'V', photoKey: 'u/V/vehicle-photo/c.jpg', GSI1PK: 'VEHICLES' }, 'r'));
    expect(res.data).toEqual({ vehicleId: 'V', photoKey: 'u/V/vehicle-photo/c.jpg', photoUrl: 'https://staging.example.app/photos/u/V/vehicle-photo/c.jpg' });
  });
});

describe('error', () => {
  it('maps codes to statuses', () => {
    expect(error('CONFLICT', 'stale', 'r').statusCode).toBe(409);
    expect(body(error('NOT_FOUND', 'Vehicle not found', 'r'))).toEqual({ error: 'Vehicle not found', code: 'NOT_FOUND', requestId: 'r' });
  });
});
