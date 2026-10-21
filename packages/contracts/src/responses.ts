/**
 * Computed (non-entity) responses, as the API actually returns them (probed 2026-10-21).
 */
import { z } from 'zod';
import { IsoDate, YearMonth, responseObject } from './common.js';
import { User } from './entities.js';

const Trend = z.enum(['up', 'down', 'flat']);

export const AnalyticsDashboard = responseObject({
  mpgOverTime: z.array(z.object({ date: IsoDate, mpg: z.number() })),
  monthlySpending: z.array(z.object({ month: YearMonth, totalSpent: z.number() })),
  costPerMileTrend: z.array(z.object({ date: IsoDate, costPerMile: z.number() })),
  pricePerGallonTrend: z.array(z.object({ date: IsoDate, pricePerGallon: z.number() })),
  milesPerMonth: z.array(z.object({ month: YearMonth, miles: z.number() })),
  fillupFrequency: z.array(z.object({ month: YearMonth, count: z.number() })),
});
export type AnalyticsDashboard = z.infer<typeof AnalyticsDashboard>;

/** Year-over-year. Note: `year` is a string, and trends are per summary, compared with the previous year. */
export const YearOverYear = responseObject({
  summaries: z.array(responseObject({
    year: z.string().regex(/^\d{4}$/),
    totalSpent: z.number(),
    totalGallons: z.number(),
    averageMpg: z.number(),
    totalMiles: z.number(),
    maintenanceCost: z.number(),
    trends: z.object({
      totalSpent: Trend,
      totalGallons: Trend,
      averageMpg: Trend,
      totalMiles: Trend,
      maintenanceCost: Trend,
    }),
  })),
});
export type YearOverYear = z.infer<typeof YearOverYear>;

export const SummaryCard = responseObject({
  year: z.number(),
  totalMiles: z.number(),
  totalFuelCost: z.number(),
  averageMpg: z.number().nullable(),
  fillupCount: z.number(),
  totalMaintenanceCost: z.number(),
});
export type SummaryCard = z.infer<typeof SummaryCard>;

/** CSV exports: a presigned download URL (expires after 1 hour) */
export const CsvExport = responseObject({
  downloadUrl: z.url(),
  recordCount: z.number().int(),
});
export type CsvExport = z.infer<typeof CsvExport>;

/** Structured report data; the PDF is rendered client-side. Also stored as JSON at `downloadUrl`. */
export const Report = responseObject({
  vehicle: z.object({ nickname: z.string(), make: z.string(), model: z.string(), year: z.number() }),
  dateRange: z.object({ startDate: z.string().nullable(), endDate: z.string().nullable() }),
  fuelSummary: z.object({
    totalSpent: z.number(),
    totalGallons: z.number(),
    averageMpg: z.number().nullable(),
    totalMiles: z.number(),
    fillupCount: z.number().int(),
  }),
  maintenanceSummary: z.object({ totalCost: z.number(), recordCount: z.number().int() }),
  charts: z.object({
    mpgOverTime: z.array(z.object({ date: z.string(), mpg: z.number() })),
    monthlySpending: z.array(z.object({ month: YearMonth, totalSpent: z.number() })),
  }),
  note: z.string(),
  downloadUrl: z.url(),
});
export type Report = z.infer<typeof Report>;

export const PresignResult = responseObject({
  url: z.url().describe('PUT the file here with the same Content-Type'),
  key: z.string().describe('Store this on the record (photoKey / receiptPhotoKey) or pass it to import'),
  expiresIn: z.number().int().describe('Seconds'),
});
export type PresignResult = z.infer<typeof PresignResult>;

export const ImportResult = responseObject({
  totalRows: z.number().int(),
  imported: z.number().int(),
  skipped: z.number().int(),
  duplicates: z.number().int(),
  errors: z.array(z.string()),
});
export type ImportResult = z.infer<typeof ImportResult>;

export const RecalculateResult = responseObject({ recalculatedCount: z.number().int() });

export const AccountDeleted = responseObject({ message: z.string() });

export const AdminStats = responseObject({
  totalUsers: z.number().int(),
  activeUsers: z.number().int().describe('Users with a fill-up in the last 30 days'),
  totalFillups: z.number().int(),
  totalVehicles: z.number().int(),
  usageTrends: z.array(z.object({ month: YearMonth, count: z.number().int() })).describe('Fill-ups per month, last 6 months'),
});
export type AdminStats = z.infer<typeof AdminStats>;

export const AdminUserStats = User.extend({
  vehicleCount: z.number().int(),
  fillupCount: z.number().int(),
  lastActive: z.string().optional().describe('Date of the last fill-up (YYYY-MM-DD), or the profile updatedAt timestamp if none'),
});
export type AdminUserStats = z.infer<typeof AdminUserStats>;
