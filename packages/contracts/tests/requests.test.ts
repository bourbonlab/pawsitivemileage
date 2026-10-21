/**
 * Request schemas must accept and reject exactly what the handlers do today (api/src/lib/validation.ts
 * and per-handler rules). Where the contract is intentionally stricter, the test says so.
 */
import { describe, it, expect } from 'vitest';
import {
  AdminSchemaCreate, FillupCreate, FillupUpdate, MaintenanceCreate, PresignRequest, ProfileUpdate, ShareCreate,
  VehicleCreate, VehicleListQuery, VehicleUpdate,
} from '../src/index.js';

const ok = (schema: { safeParse: (v: unknown) => { success: boolean } }, value: unknown) => expect(schema.safeParse(value).success).toBe(true);
const bad = (schema: { safeParse: (v: unknown) => { success: boolean } }, value: unknown) => expect(schema.safeParse(value).success).toBe(false);

const VID = '01KHKHBG12P5BK5724XW7X0D30';
const vehicle = { nickname: 'Daily', make: 'Subaru', model: 'Outback', year: 2019 };
const fillup = { date: '2026-10-20', currencySpent: 42.5, gallonsAdded: 12.3, odometerReading: 81234 };

describe('VehicleCreate', () => {
  it('accepts the required fields alone, and with every optional field', () => {
    ok(VehicleCreate, vehicle);
    ok(VehicleCreate, { ...vehicle, trim: 'Limited', color: 'Blue', vin: '4S4BSANC5K3123456', licensePlate: 'ABC1234', tankSize: 18.5, fuelType: 'regular', photoKey: 'k' });
  });

  it('treats "" and null as missing for required fields', () => {
    bad(VehicleCreate, { ...vehicle, nickname: '' });
    bad(VehicleCreate, { ...vehicle, make: null });
    const { model: _m, ...noModel } = vehicle;
    bad(VehicleCreate, noModel);
  });

  it('accepts null for optional fields (handlers skip type checks for null)', () => {
    ok(VehicleCreate, { ...vehicle, trim: null, tankSize: null, photoKey: null });
  });

  it('enforces year 1900 .. current year + 2 (inclusive)', () => {
    const max = new Date().getFullYear() + 2;
    ok(VehicleCreate, { ...vehicle, year: 1900 });
    ok(VehicleCreate, { ...vehicle, year: max });
    bad(VehicleCreate, { ...vehicle, year: 1899 });
    bad(VehicleCreate, { ...vehicle, year: max + 1 });
    bad(VehicleCreate, { ...vehicle, year: '2019' });
  });

  it('enforces string lengths and tankSize >= 0.1', () => {
    ok(VehicleCreate, { ...vehicle, vin: 'x'.repeat(17), color: 'x'.repeat(50) });
    bad(VehicleCreate, { ...vehicle, vin: 'x'.repeat(18) });
    bad(VehicleCreate, { ...vehicle, licensePlate: 'x'.repeat(21) });
    bad(VehicleCreate, { ...vehicle, make: 'x'.repeat(101) });
    ok(VehicleCreate, { ...vehicle, tankSize: 0.1 });
    bad(VehicleCreate, { ...vehicle, tankSize: 0.09 });
  });

  it('ignores unknown fields', () => {
    ok(VehicleCreate, { ...vehicle, somethingElse: true });
  });
});

describe('VehicleUpdate / VehicleListQuery', () => {
  it('accepts partial updates and validates what is present', () => {
    ok(VehicleUpdate, {});
    ok(VehicleUpdate, { nickname: 'Weekend' });
    bad(VehicleUpdate, { year: 1800 });
    bad(VehicleUpdate, { vin: 'x'.repeat(18) });
  });

  it('documents the status filter', () => {
    ok(VehicleListQuery, {});
    ok(VehicleListQuery, { status: 'archived' });
    ok(VehicleListQuery, { status: 'all' });
  });
});

describe('FillupCreate / FillupUpdate', () => {
  it('requires date, currencySpent, gallonsAdded, odometerReading', () => {
    ok(FillupCreate, fillup);
    for (const field of Object.keys(fillup)) {
      const { [field]: _omit, ...rest } = fillup as Record<string, unknown>;
      bad(FillupCreate, rest);
    }
  });

  it('enforces the 0.01 minimum on amounts (inclusive)', () => {
    ok(FillupCreate, { ...fillup, currencySpent: 0.01, gallonsAdded: 0.01, odometerReading: 0.01 });
    bad(FillupCreate, { ...fillup, gallonsAdded: 0 });
  });

  it('enforces coordinate ranges and text lengths', () => {
    ok(FillupCreate, { ...fillup, locationLat: -90, locationLng: 180 });
    bad(FillupCreate, { ...fillup, locationLat: 90.0001 });
    bad(FillupCreate, { ...fillup, locationLng: -180.5 });
    ok(FillupCreate, { ...fillup, stationName: 'x'.repeat(255), notes: 'x'.repeat(1000) });
    bad(FillupCreate, { ...fillup, stationName: 'x'.repeat(256) });
    bad(FillupCreate, { ...fillup, address: 'x'.repeat(1001) });
  });

  it('update: everything optional; receiptPhotoKey null means remove', () => {
    ok(FillupUpdate, {});
    ok(FillupUpdate, { receiptPhotoKey: null });
    bad(FillupUpdate, { gallonsAdded: 0 });
  });

  it('update: rejects wrong types (stricter than the handler today; see #18)', () => {
    bad(FillupUpdate, { currencySpent: '42.50' });
  });
});

describe('MaintenanceCreate', () => {
  const base = { datePerformed: '2026-10-01', odometerAtService: 81000, cost: 49.99 };

  it('requires a schemaId or customTypeName', () => {
    bad(MaintenanceCreate, base);
    ok(MaintenanceCreate, { ...base, customTypeName: 'Oil change' });
    ok(MaintenanceCreate, { ...base, schemaId: VID });
  });

  it('allows zero cost and odometer (min 0, inclusive) but not negative', () => {
    ok(MaintenanceCreate, { ...base, customTypeName: 'Free check', cost: 0, odometerAtService: 0 });
    bad(MaintenanceCreate, { ...base, customTypeName: 'x', cost: -1 });
  });

  it('caps customTypeName at 255 and notes at 1000', () => {
    bad(MaintenanceCreate, { ...base, customTypeName: 'x'.repeat(256) });
    bad(MaintenanceCreate, { ...base, customTypeName: 'x', notes: 'x'.repeat(1001) });
  });
});

describe('ShareCreate / ProfileUpdate', () => {
  it('validates email format and permission', () => {
    ok(ShareCreate, { email: 'friend@example.com', permission: 'fuel' });
    bad(ShareCreate, { email: 'not-an-email', permission: 'fuel' });
    ok(ShareCreate, { email: '  Friend@Example.com ', permission: 'readonly' }); // trimmed first, like the handler
    bad(ShareCreate, { email: 'friend@example.com', permission: 'owner' });
  });

  it('requires a non-blank displayName up to 255 characters', () => {
    ok(ProfileUpdate, { displayName: 'Kyle' });
    bad(ProfileUpdate, { displayName: '   ' });
    bad(ProfileUpdate, { displayName: 'x'.repeat(256) });
  });
});

describe('PresignRequest', () => {
  const presign = { uploadType: 'receipt-photo', vehicleId: VID, filename: 'receipt.pdf', contentType: 'application/pdf' };

  it('accepts the allowed upload and content types', () => {
    ok(PresignRequest, presign);
    ok(PresignRequest, { ...presign, uploadType: 'csv-import', contentType: 'text/csv', fileSize: 10 * 1024 * 1024 });
  });

  it('rejects other types and files over 10 MB', () => {
    bad(PresignRequest, { ...presign, uploadType: 'avatar' });
    bad(PresignRequest, { ...presign, contentType: 'image/gif' });
    bad(PresignRequest, { ...presign, fileSize: 10 * 1024 * 1024 + 1 });
    bad(PresignRequest, { ...presign, fileSize: 0 });
  });
});

describe('AdminSchemaCreate', () => {
  it('requires name, description, category; intervals positive or null', () => {
    const s = { name: 'Oil change', description: 'Engine oil and filter', category: 'Engine' };
    ok(AdminSchemaCreate, s);
    ok(AdminSchemaCreate, { ...s, defaultMileageInterval: 5000, defaultTimeIntervalDays: null });
    bad(AdminSchemaCreate, { ...s, defaultMileageInterval: 0 });
    bad(AdminSchemaCreate, { ...s, description: '' });
  });
});
