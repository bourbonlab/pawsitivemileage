/**
 * Dashboard figures for one vehicle, derived from its fillups so the Dash tab needs no extra
 * API call. All values use the per-fillup metrics the API already stores.
 */
import type { Fillup } from '@pawsitivemileage/sdk';

export interface MetricStat {
  /** Most recent fillup's value */
  latest: number;
  /** Mean across every fillup that has the metric */
  average: number;
  /** Where `latest` sits between the lowest and highest value, 0–1 (0.6 with one data point) */
  position: number;
}

export interface VehicleStats {
  odometer: number | null;
  lastFillupDate: string | null;
  fillupCount: number;
  mpg: MetricStat | null;
  pricePerGallon: MetricStat | null;
  costPerMile: MetricStat | null;
  /** Fuel spend in the calendar month of `today` */
  spentThisMonth: number;
  mpgSeries: { date: string; mpg: number }[];
}

/** Oldest first; same-day fillups ordered by odometer */
export function sortFillupsByDate(fillups: Fillup[]): Fillup[] {
  return [...fillups].sort((a, b) =>
    a.date === b.date ? a.odometerReading - b.odometerReading : a.date < b.date ? -1 : 1,
  );
}

function metricStat(values: number[]): MetricStat | null {
  if (!values.length) return null;
  const latest = values[values.length - 1];
  const average = values.reduce((sum, v) => sum + v, 0) / values.length;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const position = max === min ? 0.6 : (latest - min) / (max - min);
  return { latest, average, position };
}

function pick(fillups: Fillup[], key: 'mpg' | 'pricePerGallon' | 'costPerMile'): number[] {
  return fillups.flatMap((f) => (f[key] == null ? [] : [f[key]]));
}

export function vehicleStats(fillups: Fillup[], today: Date = new Date()): VehicleStats {
  const sorted = sortFillupsByDate(fillups);
  const last = sorted[sorted.length - 1];
  const month = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;

  return {
    odometer: sorted.length ? Math.max(...sorted.map((f) => f.odometerReading)) : null,
    lastFillupDate: last?.date ?? null,
    fillupCount: sorted.length,
    mpg: metricStat(pick(sorted, 'mpg')),
    pricePerGallon: metricStat(pick(sorted, 'pricePerGallon')),
    costPerMile: metricStat(pick(sorted, 'costPerMile')),
    spentThisMonth: sorted
      .filter((f) => f.date.startsWith(month))
      .reduce((sum, f) => sum + f.currencySpent, 0),
    mpgSeries: sorted.flatMap((f) => (f.mpg == null ? [] : [{ date: f.date, mpg: f.mpg }])),
  };
}

/** "today", "yesterday", "5 days ago", or a short date past a month */
export function relativeDay(isoDate: string, today: Date = new Date()): string {
  const then = new Date(isoDate + 'T00:00:00');
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const days = Math.round((start.getTime() - then.getTime()) / 86_400_000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 31) return `${days} days ago`;
  return then.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}
