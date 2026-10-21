/**
 * Response schemas must accept what the API actually returns today. The fixtures mirror the
 * structures probed from staging/production on 2026-10-21 (synthetic values), including the
 * internal DynamoDB keys that #20 will remove.
 */
import { describe, it, expect } from 'vitest';
import {
  AdminStats, AdminUserStats, ErrorResponse, Fillup, MaintenanceRecord, SharedVehicle, User, Vehicle, YearOverYear,
  successEnvelope,
} from '../src/index.js';

const SUB = '11111111-aaaa-4bbb-8ccc-222222222222';
const VID = '01KHKHBG12P5BK5724XW7X0D30';
const FID = '01KS5M8EYJ5VP2GYMBBEQZ5VPH';
const TS = '2026-10-20T17:41:39.695Z';

const fillup = {
  vehicleId: VID, fillupId: FID, userId: SUB, date: '2026-10-20', currencySpent: 42.5, gallonsAdded: 12.3,
  odometerReading: 81234, isPartialFill: false, isBusiness: false, pricePerGallon: 3.455, milesSinceLastFillup: null,
  mpg: null, costPerMile: null, daysSinceLastFillup: null, createdAt: TS, updatedAt: TS,
  // internal keys present today (see #20)
  GSI1PK: SUB, GSI1SK: '2026-10-20', GSI2PK: 'FILLUPS', GSI2SK: '2026-10-20', fillupDateId: `2026-10-20#${FID}`,
};

describe('entities as returned today', () => {
  it('accepts a fill-up, including internal keys and null derived metrics', () => {
    expect(Fillup.safeParse(fillup).success).toBe(true);
  });

  it('accepts optional fields set to null (handlers store null when sent)', () => {
    expect(Fillup.safeParse({ ...fillup, stationName: null, receiptPhotoKey: null }).success).toBe(true);
  });

  it('rejects a malformed date (catches bad data via the conformance check)', () => {
    expect(Fillup.safeParse({ ...fillup, date: '10/20/2026' }).success).toBe(false);
  });

  it('accepts a vehicle, maintenance record, user and shared vehicle', () => {
    expect(Vehicle.safeParse({
      userId: SUB, vehicleId: VID, nickname: 'Daily', make: 'Subaru', model: 'Outback', year: 2019, isArchived: false,
      vin: '4S4BSANC5K3123456', createdAt: TS, updatedAt: TS, GSI1PK: 'VEHICLES', GSI1SK: TS,
    }).success).toBe(true);
    expect(MaintenanceRecord.safeParse({
      vehicleId: VID, recordId: FID, userId: SUB, customTypeName: 'Oil change', datePerformed: '2026-02-16',
      odometerAtService: 80000, cost: 49.99, createdAt: TS, updatedAt: TS, serviceDateId: `2026-02-16#${FID}`,
    }).success).toBe(true);
    expect(User.safeParse({ userId: SUB, email: 'a@b.co', displayName: 'A', isAdmin: false, createdAt: TS, updatedAt: TS, GSI1PK: 'USERS' }).success).toBe(true);
    expect(SharedVehicle.safeParse({
      vehicle: { vehicleId: VID, nickname: 'Daily', make: 'Subaru', model: 'Outback', year: 2019, photoKey: `${SUB}/${VID}/vehicle-photo/car.jpg` },
      ownerDisplayName: 'Kyle', permission: 'fuel', shareId: FID,
    }).success).toBe(true);
  });
});

describe('documented drift from the old web types', () => {
  const summary = {
    year: '2025', totalSpent: 1200.5, totalGallons: 350.2, averageMpg: 31.5, totalMiles: 11000, maintenanceCost: 250,
    trends: { totalSpent: 'up', totalGallons: 'up', averageMpg: 'down', totalMiles: 'flat', maintenanceCost: 'up' },
  };

  it('year-over-year is { summaries }, with year as a string', () => {
    expect(YearOverYear.safeParse({ summaries: [summary] }).success).toBe(true);
    expect(YearOverYear.safeParse({ years: [{ ...summary, year: 2025 }] }).success).toBe(false);
  });

  it('admin stats include usageTrends', () => {
    expect(AdminStats.safeParse({ totalUsers: 5, activeUsers: 2, totalFillups: 172, totalVehicles: 6, usageTrends: [{ month: '2026-10', count: 4 }] }).success).toBe(true);
  });

  it('admin lastActive is a date or a timestamp', () => {
    const u = { userId: SUB, email: 'a@b.co', displayName: 'A', isAdmin: false, createdAt: TS, updatedAt: TS, vehicleCount: 1, fillupCount: 3 };
    expect(AdminUserStats.safeParse({ ...u, lastActive: '2026-10-20' }).success).toBe(true);
    expect(AdminUserStats.safeParse({ ...u, lastActive: TS }).success).toBe(true);
  });
});

describe('envelope', () => {
  it('wraps data with requestId; errors carry a known code', () => {
    expect(successEnvelope(Fillup).safeParse({ data: fillup, requestId: 'r1' }).success).toBe(true);
    expect(ErrorResponse.safeParse({ error: 'Fillup not found', code: 'NOT_FOUND', requestId: 'r1' }).success).toBe(true);
    expect(ErrorResponse.safeParse({ error: 'x', code: 'TEAPOT', requestId: 'r1' }).success).toBe(false);
  });
});
