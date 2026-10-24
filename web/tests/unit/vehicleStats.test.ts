import { describe, it, expect } from 'vitest';
import type { Fillup } from '@pawsitivemileage/sdk';
import { relativeDay, sortFillupsByDate, vehicleStats } from '../../src/lib/vehicle-stats';

function fillup(overrides: Partial<Fillup>): Fillup {
  return {
    vehicleId: '01J0000000000000000000000V',
    fillupId: '01J0000000000000000000000F',
    userId: '00000000-0000-0000-0000-000000000000',
    date: '2026-10-01',
    currencySpent: 50,
    gallonsAdded: 10,
    odometerReading: 1000,
    isPartialFill: false,
    isBusiness: false,
    pricePerGallon: 5,
    milesSinceLastFillup: null,
    mpg: null,
    costPerMile: null,
    daysSinceLastFillup: null,
    createdAt: '2026-10-01T00:00:00Z',
    updatedAt: '2026-10-01T00:00:00Z',
    ...overrides,
  } as Fillup;
}

describe('vehicleStats', () => {
  const fillups = [
    fillup({ date: '2026-10-20', odometerReading: 1600, currencySpent: 60, mpg: 14, pricePerGallon: 6, costPerMile: 0.4 }),
    fillup({ date: '2026-09-10', odometerReading: 1000, currencySpent: 40 }),
    fillup({ date: '2026-10-05', odometerReading: 1300, currencySpent: 45, mpg: 12, pricePerGallon: 4.5, costPerMile: 0.5 }),
  ];
  const today = new Date(2026, 9, 24);

  it('uses the latest fillup and the highest odometer', () => {
    const stats = vehicleStats(fillups, today);
    expect(stats.odometer).toBe(1600);
    expect(stats.lastFillupDate).toBe('2026-10-20');
    expect(stats.fillupCount).toBe(3);
  });

  it('places the latest value between the min and max', () => {
    const stats = vehicleStats(fillups, today);
    expect(stats.mpg).toEqual({ latest: 14, average: 13, position: 1 });
    expect(stats.costPerMile?.position).toBe(0);
  });

  it('sums only the current month', () => {
    expect(vehicleStats(fillups, today).spentThisMonth).toBe(105);
  });

  it('builds the MPG series oldest first, skipping fillups without MPG', () => {
    expect(vehicleStats(fillups, today).mpgSeries).toEqual([
      { date: '2026-10-05', mpg: 12 },
      { date: '2026-10-20', mpg: 14 },
    ]);
  });

  it('handles a vehicle with no fillups', () => {
    const stats = vehicleStats([], today);
    expect(stats.odometer).toBeNull();
    expect(stats.mpg).toBeNull();
    expect(stats.spentThisMonth).toBe(0);
  });

  it('uses a middle position when there is a single data point', () => {
    expect(vehicleStats([fillups[0]], today).mpg?.position).toBe(0.6);
  });
});

describe('sortFillupsByDate', () => {
  it('orders same-day fillups by odometer', () => {
    const sorted = sortFillupsByDate([
      fillup({ fillupId: 'b', date: '2026-10-01', odometerReading: 200 }),
      fillup({ fillupId: 'a', date: '2026-10-01', odometerReading: 100 }),
    ]);
    expect(sorted.map((f) => f.fillupId)).toEqual(['a', 'b']);
  });
});

describe('relativeDay', () => {
  const today = new Date(2026, 9, 24);
  it.each([
    ['2026-10-24', 'today'],
    ['2026-10-23', 'yesterday'],
    ['2026-10-19', '5 days ago'],
  ])('%s → %s', (date, expected) => {
    expect(relativeDay(date, today)).toBe(expected);
  });

  it('falls back to a date past a month', () => {
    expect(relativeDay('2026-08-01', today)).toBe('Aug 1, 2026');
  });
});
