/**
 * Resources returned by the API. Optional fields may be omitted, or null when a client stored
 * null (the handlers accept null for optional fields).
 */
import * as z from 'zod';
import { IsoDate, IsoDateTime, Ulid, UserId, responseObject } from './common.js';

const optional = <T extends z.ZodType>(schema: T) => schema.nullish();

export const SharePermission = z.enum(['readonly', 'fuel', 'maintenance', 'full']).describe(
  "readonly: view only. fuel and maintenance (legacy, same as fuel): add/edit/delete fill-up and maintenance records. full: also import CSVs and recalculate metrics.",
);
export type SharePermission = z.infer<typeof SharePermission>;

export const User = responseObject({
  userId: UserId,
  email: z.string(),
  displayName: z.string(),
  isAdmin: z.boolean(),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type User = z.infer<typeof User>;

export const MaintenanceOverride = z.object({
  mileageInterval: z.number().optional(),
  timeIntervalDays: z.number().optional(),
});

export const Vehicle = responseObject({
  userId: UserId.describe("Owner's user ID"),
  vehicleId: Ulid,
  nickname: z.string(),
  make: z.string(),
  model: z.string(),
  year: z.number().int(),
  trim: optional(z.string()),
  color: optional(z.string()),
  vin: optional(z.string()),
  licensePlate: optional(z.string()),
  tankSize: optional(z.number()),
  fuelType: optional(z.string()),
  photoKey: optional(z.string()).describe('Photo-bucket key; the web app serves it at /photos/{key}'),
  photoUrl: optional(z.url()).describe('Absolute URL of the photo (present when photoKey is set)'),
  isArchived: z.boolean(),
  maintenanceOverrides: optional(z.record(z.string(), MaintenanceOverride)).describe('Read-only: no endpoint sets it yet'),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type Vehicle = z.infer<typeof Vehicle>;

export const Fillup = responseObject({
  vehicleId: Ulid,
  fillupId: Ulid,
  userId: UserId.describe("Vehicle owner's user ID (records written by shared users belong to the owner)"),
  date: IsoDate,
  currencySpent: z.number(),
  gallonsAdded: z.number(),
  odometerReading: z.number(),
  isPartialFill: z.boolean(),
  isBusiness: z.boolean().optional().describe('Absent on fill-ups created before the field existed; treat as false (backfill: #31)'),
  pricePerGallon: z.number().nullable(),
  milesSinceLastFillup: z.number().nullable(),
  mpg: z.number().nullable(),
  costPerMile: z.number().nullable(),
  daysSinceLastFillup: z.number().nullable(),
  locationLat: optional(z.number()),
  locationLng: optional(z.number()),
  stationName: optional(z.string()),
  address: optional(z.string()),
  receiptPhotoKey: optional(z.string()),
  receiptPhotoUrl: optional(z.url()).describe('Absolute URL of the receipt (present when receiptPhotoKey is set)'),
  notes: optional(z.string()),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type Fillup = z.infer<typeof Fillup>;

export const MaintenanceRecord = responseObject({
  vehicleId: Ulid,
  recordId: Ulid,
  userId: UserId.describe("Vehicle owner's user ID"),
  schemaId: optional(Ulid),
  schemaName: optional(z.string()),
  customTypeName: optional(z.string()),
  datePerformed: IsoDate,
  odometerAtService: z.number(),
  cost: z.number(),
  location: optional(z.string()),
  locationLat: optional(z.number()),
  locationLng: optional(z.number()),
  stationName: optional(z.string()),
  address: optional(z.string()),
  notes: optional(z.string()),
  receiptPhotoKey: optional(z.string()),
  receiptPhotoUrl: optional(z.url()).describe('Absolute URL of the receipt (present when receiptPhotoKey is set)'),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type MaintenanceRecord = z.infer<typeof MaintenanceRecord>;

export const MaintenanceSchema = responseObject({
  schemaId: Ulid,
  name: z.string(),
  description: z.string(),
  defaultMileageInterval: z.number().nullable(),
  defaultTimeIntervalDays: z.number().nullable(),
  category: z.string(),
  isActive: z.boolean(),
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type MaintenanceSchema = z.infer<typeof MaintenanceSchema>;

export const Reminder = responseObject({
  schemaName: z.string(),
  type: z.enum(['mileage', 'time', 'both']),
  mileageRemaining: z.number().nullable(),
  daysRemaining: z.number().nullable(),
  isOverdue: z.boolean(),
});
export type Reminder = z.infer<typeof Reminder>;

export const Share = responseObject({
  shareId: Ulid,
  ownerUserId: UserId,
  sharedEmail: z.string(),
  vehicleId: Ulid,
  permission: SharePermission,
  createdAt: IsoDateTime,
  updatedAt: IsoDateTime,
});
export type Share = z.infer<typeof Share>;

export const SharedVehicle = responseObject({
  vehicle: responseObject({
    vehicleId: Ulid,
    nickname: z.string(),
    make: z.string(),
    model: z.string(),
    year: z.number().int(),
    photoKey: optional(z.string()),
    photoUrl: optional(z.url()),
  }),
  ownerDisplayName: z.string(),
  permission: SharePermission,
  shareId: Ulid,
});
export type SharedVehicle = z.infer<typeof SharedVehicle>;
