import { Fillup, FillupInput, DerivedMetrics } from '../types/fillup';

/**
 * Calculate the number of days between two ISO 8601 date strings.
 * Returns a positive integer representing the absolute day difference.
 */
export function daysBetween(dateA: string, dateB: string): number {
  const a = new Date(dateA);
  const b = new Date(dateB);
  const diffMs = Math.abs(a.getTime() - b.getTime());
  return Math.round(diffMs / (1000 * 60 * 60 * 24));
}

/**
 * Calculate derived metrics for a single fillup.
 *
 * @param current - The current fillup input
 * @param previous - The previous fillup input (null for first fillup)
 * @param accumulatedGallons - Gallons accumulated from preceding partial fills
 * @param accumulatedMiles - Miles accumulated from preceding partial fills
 * @returns Derived metrics for the current fillup
 *
 * Requirements: 3.2, 3.3, 3.4, 3.5
 */
export function calculateDerivedMetrics(
  current: FillupInput,
  previous: FillupInput | null,
  accumulatedGallons: number,
  accumulatedMiles: number,
): DerivedMetrics {
  // Price per gallon is always calculable (guard against division by zero)
  const pricePerGallon =
    current.gallonsAdded > 0 ? current.currencySpent / current.gallonsAdded : null;

  // First fillup — only price per gallon is available (Req 3.3)
  if (!previous) {
    return {
      pricePerGallon,
      milesSinceLastFillup: null,
      mpg: null,
      costPerMile: null,
      daysSinceLastFillup: null,
    };
  }

  const milesSinceLastFillup = current.odometerReading - previous.odometerReading;
  const daysSinceLastFillup = daysBetween(current.date, previous.date);

  // Partial fill — record miles/days but skip MPG and costPerMile (Req 3.4)
  if (current.isPartialFill) {
    return {
      pricePerGallon,
      milesSinceLastFillup,
      mpg: null,
      costPerMile: null,
      daysSinceLastFillup,
    };
  }

  // Full fill — use accumulated values from any preceding partial fills (Req 3.5)
  const totalGallons = accumulatedGallons + current.gallonsAdded;
  const totalMiles = accumulatedMiles + milesSinceLastFillup;

  const mpg = totalGallons > 0 ? totalMiles / totalGallons : null;
  const costPerMile = milesSinceLastFillup > 0 ? current.currencySpent / milesSinceLastFillup : null;

  return {
    pricePerGallon,
    milesSinceLastFillup,
    mpg,
    costPerMile,
    daysSinceLastFillup,
  };
}

/**
 * Recalculate all derived metrics for an ordered sequence of fillups.
 *
 * Walks through the array tracking accumulated gallons and miles for partial fills,
 * then calls calculateDerivedMetrics for each entry. Returns a new array with
 * updated derived metrics on each fillup.
 *
 * @param fillups - Array of Fillup objects sorted by date ascending
 * @returns New array with recalculated derived metrics
 *
 * Requirements: 3.2, 3.3, 3.4, 3.5, 3.6
 */
export function recalculateAllMetrics(fillups: Fillup[]): Fillup[] {
  if (fillups.length === 0) return [];

  let accumulatedGallons = 0;
  let accumulatedMiles = 0;
  // Track the last full (non-partial) fillup for accumulation reference
  let lastFullFillupIndex: number | null = null;

  return fillups.map((fillup, index) => {
    const previous: FillupInput | null = index > 0 ? fillups[index - 1] : null;

    const metrics = calculateDerivedMetrics(
      fillup,
      previous,
      accumulatedGallons,
      accumulatedMiles,
    );

    if (fillup.isPartialFill) {
      // Accumulate gallons and miles for the next full fill
      accumulatedGallons += fillup.gallonsAdded;
      if (previous) {
        accumulatedMiles += fillup.odometerReading - previous.odometerReading;
      }
    } else {
      // Reset accumulators after a full fill
      accumulatedGallons = 0;
      accumulatedMiles = 0;
      lastFullFillupIndex = index;
    }

    return {
      ...fillup,
      pricePerGallon: metrics.pricePerGallon,
      milesSinceLastFillup: metrics.milesSinceLastFillup,
      mpg: metrics.mpg,
      costPerMile: metrics.costPerMile,
      daysSinceLastFillup: metrics.daysSinceLastFillup,
    };
  });
}
