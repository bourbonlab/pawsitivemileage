/**
 * Client-side derived metrics preview.
 * Mirrors the API calculation in api/src/lib/metrics.ts so users
 * see live feedback before submitting a fillup.
 */

export interface PreviewMetricsInput {
  currencySpent: number;
  gallonsAdded: number;
  odometerReading: number;
  previousOdometer?: number;
  previousDate?: string;
  currentDate: string;
}

export interface PreviewMetrics {
  pricePerGallon: number | null;
  milesSinceLastFillup: number | null;
  mpg: number | null;
  costPerMile: number | null;
}

export function previewMetrics(input: PreviewMetricsInput): PreviewMetrics {
  const { currencySpent, gallonsAdded, odometerReading, previousOdometer } = input;

  // Guard against division by zero / invalid inputs
  if (gallonsAdded <= 0 || currencySpent <= 0) {
    return { pricePerGallon: null, milesSinceLastFillup: null, mpg: null, costPerMile: null };
  }

  const pricePerGallon = currencySpent / gallonsAdded;

  if (previousOdometer == null || odometerReading <= previousOdometer) {
    // First fillup or invalid odometer — only price per gallon available
    return { pricePerGallon, milesSinceLastFillup: null, mpg: null, costPerMile: null };
  }

  const milesSinceLastFillup = odometerReading - previousOdometer;
  const mpg = milesSinceLastFillup / gallonsAdded;
  const costPerMile = currencySpent / milesSinceLastFillup;

  return { pricePerGallon, milesSinceLastFillup, mpg, costPerMile };
}
