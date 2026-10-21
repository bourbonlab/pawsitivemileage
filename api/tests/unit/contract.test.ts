import { describe, it, expect } from 'vitest';
import { FillupCreate, MaintenanceCreate, PresignRequest, ShareCreate, VehicleCreate } from '@pawsitivemileage/contracts';
import { validate } from '../../src/lib/contract';

const message = (schema: Parameters<typeof validate>[0], body: unknown) => {
  const result = validate(schema, body);
  return result.ok ? null : result.message;
};
const fillup = { date: '2026-10-20', currencySpent: 42.5, gallonsAdded: 12.3, odometerReading: 81234 };
const vehicle = { nickname: 'Daily', make: 'Subaru', model: 'Outback', year: 2019 };

describe('validate: handler-compatible messages', () => {
  it('passes valid bodies through, returning parsed data', () => {
    const result = validate(FillupCreate, { ...fillup, extra: 'ignored' });
    expect(result.ok).toBe(true);
  });

  it('reports missing, null and empty required fields as "is required"', () => {
    const { gallonsAdded: _g, ...noGallons } = fillup;
    expect(message(FillupCreate, noGallons)).toBe('gallonsAdded is required');
    expect(message(VehicleCreate, { ...vehicle, make: null })).toBe('make is required');
    expect(message(VehicleCreate, { ...vehicle, nickname: '' })).toBe('nickname is required');
  });

  it('reports wrong types', () => {
    expect(message(FillupCreate, { ...fillup, currencySpent: '42.50' })).toBe('currencySpent must be a number');
    expect(message(FillupCreate, { ...fillup, isBusiness: 'yes' })).toBe('isBusiness must be a boolean');
  });

  it('reports ranges and lengths like the old validators', () => {
    expect(message(FillupCreate, { ...fillup, gallonsAdded: 0 })).toBe('gallonsAdded must be at least 0.01');
    expect(message(VehicleCreate, { ...vehicle, year: 1800 })).toBe('year must be at least 1900');
    expect(message(VehicleCreate, { ...vehicle, year: new Date().getFullYear() + 3 })).toBe(`year must be at most ${new Date().getFullYear() + 2}`);
    expect(message(VehicleCreate, { ...vehicle, vin: 'x'.repeat(18) })).toBe('vin must be at most 17 characters');
    expect(message(FillupCreate, { ...fillup, locationLat: 91 })).toBe('locationLat must be at most 90');
  });

  it('reports enums with their allowed values', () => {
    expect(message(ShareCreate, { email: 'a@b.co', permission: 'owner' })).toBe('permission must be one of: readonly, fuel, maintenance, full');
  });

  it('uses the contract\'s own wording for refinements and custom errors', () => {
    const base = { datePerformed: '2026-10-01', odometerAtService: 1, cost: 1 };
    expect(message(MaintenanceCreate, base)).toBe('Either schemaId or customTypeName is required');
    expect(message(ShareCreate, { email: 'nope', permission: 'fuel' })).toBe('email must be a valid email address');
    expect(message(PresignRequest, { uploadType: 'receipt-photo', vehicleId: '01KHKHBG12P5BK5724XW7X0D30', filename: 'r.pdf', contentType: 'application/pdf', fileSize: 11 * 1024 * 1024 }))
      .toBe('File size exceeds maximum of 10 MB');
  });

  it('joins several problems with "; " and drops duplicates', () => {
    expect(message(FillupCreate, {})).toBe('date is required; currencySpent is required; gallonsAdded is required; odometerReading is required');
  });
});
