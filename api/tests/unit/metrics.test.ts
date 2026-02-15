import { describe, it, expect } from 'vitest';
import {
  daysBetween,
  calculateDerivedMetrics,
  recalculateAllMetrics,
} from '../../src/lib/metrics';
import { Fillup, FillupInput } from '../../src/types/fillup';

// Helper to create a minimal Fillup object for recalculateAllMetrics
function makeFillup(overrides: Partial<Fillup> & Pick<Fillup, 'date' | 'currencySpent' | 'gallonsAdded' | 'odometerReading'>): Fillup {
  return {
    vehicleId: 'v1',
    fillupId: `f-${overrides.odometerReading}`,
    userId: 'u1',
    isPartialFill: false,
    pricePerGallon: null,
    milesSinceLastFillup: null,
    mpg: null,
    costPerMile: null,
    daysSinceLastFillup: null,
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
    ...overrides,
  };
}

describe('daysBetween', () => {
  it('returns 0 for the same date', () => {
    expect(daysBetween('2024-08-08', '2024-08-08')).toBe(0);
  });

  it('returns correct days between two dates', () => {
    expect(daysBetween('2024-08-08', '2024-08-29')).toBe(21);
  });

  it('is commutative (order does not matter)', () => {
    expect(daysBetween('2024-01-01', '2024-03-01')).toBe(
      daysBetween('2024-03-01', '2024-01-01'),
    );
  });
});

describe('calculateDerivedMetrics', () => {
  describe('first fillup (no previous)', () => {
    it('returns only pricePerGallon, all other metrics null (Req 3.3)', () => {
      const current: FillupInput = {
        date: '2024-08-08T00:00:00Z',
        currencySpent: 45.50,
        gallonsAdded: 13.5,
        odometerReading: 44800,
        isPartialFill: false,
      };

      const result = calculateDerivedMetrics(current, null, 0, 0);

      expect(result.pricePerGallon).toBeCloseTo(45.50 / 13.5, 5);
      expect(result.milesSinceLastFillup).toBeNull();
      expect(result.mpg).toBeNull();
      expect(result.costPerMile).toBeNull();
      expect(result.daysSinceLastFillup).toBeNull();
    });
  });

  describe('standard two-fillup calculation (Req 3.2)', () => {
    it('calculates all derived metrics correctly', () => {
      const previous: FillupInput = {
        date: '2024-08-08T00:00:00Z',
        currencySpent: 45.50,
        gallonsAdded: 13.5,
        odometerReading: 44800,
        isPartialFill: false,
      };
      const current: FillupInput = {
        date: '2024-08-29T00:00:00Z',
        currencySpent: 43.50,
        gallonsAdded: 10.7,
        odometerReading: 44945,
        isPartialFill: false,
      };

      const result = calculateDerivedMetrics(current, previous, 0, 0);

      expect(result.pricePerGallon).toBeCloseTo(43.50 / 10.7, 5);
      expect(result.milesSinceLastFillup).toBe(145);
      expect(result.mpg).toBeCloseTo(145 / 10.7, 5);
      expect(result.costPerMile).toBeCloseTo(43.50 / 145, 5);
      expect(result.daysSinceLastFillup).toBe(21);
    });
  });

  describe('partial fill (Req 3.4)', () => {
    it('returns pricePerGallon, miles, days but null mpg and costPerMile', () => {
      const previous: FillupInput = {
        date: '2024-08-08T00:00:00Z',
        currencySpent: 45.50,
        gallonsAdded: 13.5,
        odometerReading: 44800,
        isPartialFill: false,
      };
      const current: FillupInput = {
        date: '2024-08-15T00:00:00Z',
        currencySpent: 20.00,
        gallonsAdded: 5.0,
        odometerReading: 44900,
        isPartialFill: true,
      };

      const result = calculateDerivedMetrics(current, previous, 0, 0);

      expect(result.pricePerGallon).toBeCloseTo(20.00 / 5.0, 5);
      expect(result.milesSinceLastFillup).toBe(100);
      expect(result.mpg).toBeNull();
      expect(result.costPerMile).toBeNull();
      expect(result.daysSinceLastFillup).toBe(7);
    });
  });

  describe('full fill after partials (Req 3.5)', () => {
    it('uses accumulated gallons and miles for MPG', () => {
      const previous: FillupInput = {
        date: '2024-08-15T00:00:00Z',
        currencySpent: 20.00,
        gallonsAdded: 5.0,
        odometerReading: 44900,
        isPartialFill: true,
      };
      const current: FillupInput = {
        date: '2024-08-22T00:00:00Z',
        currencySpent: 35.00,
        gallonsAdded: 8.0,
        odometerReading: 45050,
        isPartialFill: false,
      };

      // Accumulated from the partial: 5 gallons, 100 miles (44900 - 44800)
      const result = calculateDerivedMetrics(current, previous, 5.0, 100);

      // totalGallons = 5 + 8 = 13, totalMiles = 100 + 150 = 250
      expect(result.mpg).toBeCloseTo(250 / 13, 5);
      expect(result.milesSinceLastFillup).toBe(150);
      expect(result.costPerMile).toBeCloseTo(35.00 / 150, 5);
    });
  });

  describe('edge cases', () => {
    it('handles zero gallons gracefully (returns null pricePerGallon)', () => {
      const current: FillupInput = {
        date: '2024-08-08T00:00:00Z',
        currencySpent: 0,
        gallonsAdded: 0,
        odometerReading: 44800,
        isPartialFill: false,
      };

      const result = calculateDerivedMetrics(current, null, 0, 0);
      expect(result.pricePerGallon).toBeNull();
    });

    it('handles zero miles since last fillup (costPerMile null)', () => {
      const previous: FillupInput = {
        date: '2024-08-08T00:00:00Z',
        currencySpent: 45.50,
        gallonsAdded: 13.5,
        odometerReading: 44800,
        isPartialFill: false,
      };
      const current: FillupInput = {
        date: '2024-08-08T00:00:00Z',
        currencySpent: 10.00,
        gallonsAdded: 2.5,
        odometerReading: 44800,
        isPartialFill: false,
      };

      const result = calculateDerivedMetrics(current, previous, 0, 0);
      expect(result.milesSinceLastFillup).toBe(0);
      expect(result.costPerMile).toBeNull();
    });
  });
});

describe('recalculateAllMetrics', () => {
  it('returns empty array for empty input', () => {
    expect(recalculateAllMetrics([])).toEqual([]);
  });

  it('handles single fillup (first fillup, Req 3.3)', () => {
    const fillups: Fillup[] = [
      makeFillup({
        date: '2024-08-08T00:00:00Z',
        currencySpent: 45.50,
        gallonsAdded: 13.5,
        odometerReading: 44800,
      }),
    ];

    const result = recalculateAllMetrics(fillups);

    expect(result).toHaveLength(1);
    expect(result[0].pricePerGallon).toBeCloseTo(45.50 / 13.5, 5);
    expect(result[0].mpg).toBeNull();
    expect(result[0].milesSinceLastFillup).toBeNull();
    expect(result[0].costPerMile).toBeNull();
    expect(result[0].daysSinceLastFillup).toBeNull();
  });

  it('calculates metrics for a sequence of full fills (Req 3.2)', () => {
    const fillups: Fillup[] = [
      makeFillup({
        date: '2024-08-08T00:00:00Z',
        currencySpent: 45.50,
        gallonsAdded: 13.5,
        odometerReading: 44800,
      }),
      makeFillup({
        date: '2024-08-29T00:00:00Z',
        currencySpent: 43.50,
        gallonsAdded: 10.7,
        odometerReading: 44945,
      }),
      makeFillup({
        date: '2024-09-15T00:00:00Z',
        currencySpent: 40.00,
        gallonsAdded: 11.0,
        odometerReading: 45200,
      }),
    ];

    const result = recalculateAllMetrics(fillups);

    // First fillup
    expect(result[0].mpg).toBeNull();

    // Second fillup: 145 miles / 10.7 gal
    expect(result[1].milesSinceLastFillup).toBe(145);
    expect(result[1].mpg).toBeCloseTo(145 / 10.7, 5);

    // Third fillup: 255 miles / 11.0 gal
    expect(result[2].milesSinceLastFillup).toBe(255);
    expect(result[2].mpg).toBeCloseTo(255 / 11.0, 5);
  });

  it('handles partial fill accumulation correctly (Req 3.4, 3.5)', () => {
    const fillups: Fillup[] = [
      makeFillup({
        date: '2024-08-01T00:00:00Z',
        currencySpent: 45.00,
        gallonsAdded: 13.0,
        odometerReading: 44000,
      }),
      makeFillup({
        date: '2024-08-08T00:00:00Z',
        currencySpent: 20.00,
        gallonsAdded: 5.0,
        odometerReading: 44100,
        isPartialFill: true,
      }),
      makeFillup({
        date: '2024-08-15T00:00:00Z',
        currencySpent: 15.00,
        gallonsAdded: 4.0,
        odometerReading: 44200,
        isPartialFill: true,
      }),
      makeFillup({
        date: '2024-08-22T00:00:00Z',
        currencySpent: 35.00,
        gallonsAdded: 8.0,
        odometerReading: 44350,
      }),
    ];

    const result = recalculateAllMetrics(fillups);

    // First fillup: no previous
    expect(result[0].mpg).toBeNull();

    // Second fillup: partial — mpg null
    expect(result[1].mpg).toBeNull();
    expect(result[1].milesSinceLastFillup).toBe(100);

    // Third fillup: partial — mpg null
    expect(result[2].mpg).toBeNull();
    expect(result[2].milesSinceLastFillup).toBe(100);

    // Fourth fillup: full fill after 2 partials
    // accumulatedGallons = 5 + 4 = 9, accumulatedMiles = 100 + 100 = 200
    // totalGallons = 9 + 8 = 17, totalMiles = 200 + 150 = 350
    expect(result[3].milesSinceLastFillup).toBe(150);
    expect(result[3].mpg).toBeCloseTo(350 / 17, 5);
    expect(result[3].costPerMile).toBeCloseTo(35.00 / 150, 5);
  });

  it('resets accumulators after a full fill (Req 3.6)', () => {
    const fillups: Fillup[] = [
      makeFillup({
        date: '2024-08-01T00:00:00Z',
        currencySpent: 45.00,
        gallonsAdded: 13.0,
        odometerReading: 44000,
      }),
      makeFillup({
        date: '2024-08-08T00:00:00Z',
        currencySpent: 20.00,
        gallonsAdded: 5.0,
        odometerReading: 44100,
        isPartialFill: true,
      }),
      makeFillup({
        date: '2024-08-15T00:00:00Z',
        currencySpent: 35.00,
        gallonsAdded: 8.0,
        odometerReading: 44250,
      }),
      // This fillup should NOT include accumulated values from the earlier partial
      makeFillup({
        date: '2024-08-22T00:00:00Z',
        currencySpent: 40.00,
        gallonsAdded: 10.0,
        odometerReading: 44500,
      }),
    ];

    const result = recalculateAllMetrics(fillups);

    // Fourth fillup: accumulators should be reset, so MPG = 250 / 10
    expect(result[3].milesSinceLastFillup).toBe(250);
    expect(result[3].mpg).toBeCloseTo(250 / 10, 5);
  });

  it('preserves non-metric fields on fillup objects', () => {
    const fillups: Fillup[] = [
      makeFillup({
        date: '2024-08-08T00:00:00Z',
        currencySpent: 45.50,
        gallonsAdded: 13.5,
        odometerReading: 44800,
        notes: 'Shell station',
        stationName: 'Shell',
      }),
    ];

    const result = recalculateAllMetrics(fillups);

    expect(result[0].notes).toBe('Shell station');
    expect(result[0].stationName).toBe('Shell');
    expect(result[0].vehicleId).toBe('v1');
    expect(result[0].userId).toBe('u1');
  });
});
