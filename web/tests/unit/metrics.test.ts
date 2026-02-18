import { describe, it, expect } from 'vitest';
import { previewMetrics } from '../../src/lib/metrics';

describe('previewMetrics', () => {
  it('calculates all metrics with valid inputs', () => {
    const result = previewMetrics({
      currencySpent: 43.50,
      gallonsAdded: 10.7,
      odometerReading: 44945,
      previousOdometer: 44800,
      previousDate: '2024-08-08',
      currentDate: '2024-08-29',
    });

    expect(result.pricePerGallon).toBeCloseTo(43.50 / 10.7, 5);
    expect(result.milesSinceLastFillup).toBe(145);
    expect(result.mpg).toBeCloseTo(145 / 10.7, 5);
    expect(result.costPerMile).toBeCloseTo(43.50 / 145, 5);
  });

  it('returns only pricePerGallon for first fillup (no previous odometer)', () => {
    const result = previewMetrics({
      currencySpent: 45.50,
      gallonsAdded: 13.5,
      odometerReading: 44800,
      currentDate: '2024-08-08',
    });

    expect(result.pricePerGallon).toBeCloseTo(45.50 / 13.5, 5);
    expect(result.milesSinceLastFillup).toBeNull();
    expect(result.mpg).toBeNull();
    expect(result.costPerMile).toBeNull();
  });

  it('returns all nulls when gallons is zero', () => {
    const result = previewMetrics({
      currencySpent: 45.50,
      gallonsAdded: 0,
      odometerReading: 44800,
      currentDate: '2024-08-08',
    });

    expect(result.pricePerGallon).toBeNull();
    expect(result.milesSinceLastFillup).toBeNull();
    expect(result.mpg).toBeNull();
    expect(result.costPerMile).toBeNull();
  });

  it('returns all nulls when gallons is negative', () => {
    const result = previewMetrics({
      currencySpent: 45.50,
      gallonsAdded: -5,
      odometerReading: 44800,
      currentDate: '2024-08-08',
    });

    expect(result.pricePerGallon).toBeNull();
  });

  it('returns all nulls when currencySpent is zero', () => {
    const result = previewMetrics({
      currencySpent: 0,
      gallonsAdded: 13.5,
      odometerReading: 44800,
      currentDate: '2024-08-08',
    });

    expect(result.pricePerGallon).toBeNull();
  });

  it('returns only pricePerGallon when odometer has not advanced', () => {
    const result = previewMetrics({
      currencySpent: 45.50,
      gallonsAdded: 13.5,
      odometerReading: 44800,
      previousOdometer: 44800,
      currentDate: '2024-08-08',
    });

    expect(result.pricePerGallon).toBeCloseTo(45.50 / 13.5, 5);
    expect(result.milesSinceLastFillup).toBeNull();
    expect(result.mpg).toBeNull();
    expect(result.costPerMile).toBeNull();
  });

  it('returns only pricePerGallon when odometer went backwards', () => {
    const result = previewMetrics({
      currencySpent: 45.50,
      gallonsAdded: 13.5,
      odometerReading: 44700,
      previousOdometer: 44800,
      currentDate: '2024-08-08',
    });

    expect(result.pricePerGallon).toBeCloseTo(45.50 / 13.5, 5);
    expect(result.mpg).toBeNull();
  });
});
