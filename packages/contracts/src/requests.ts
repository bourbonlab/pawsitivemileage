/**
 * Request bodies and query strings. These encode the rules the handlers enforce today; where a
 * handler is looser than the contract, the difference is noted with "Handler gap" and is closed
 * when the handlers validate with these schemas (#18).
 *
 * Shared conventions, matching api/src/lib/validation.ts:
 * - Required means present and not null or "".
 * - Optional fields may also be null; the handlers skip type checks for null.
 * - Ranges are inclusive.
 * - Unknown fields are ignored.
 * - Bodies are capped at 64 KB.
 */
import * as z from 'zod';
import { DateInput, Ulid } from './common.js';
import { SharePermission } from './entities.js';

const optional = <T extends z.ZodType>(schema: T) => schema.nullish();
const requiredString = () => z.string().min(1);
const maxLen = (n: number) => z.string().max(n);

/** Vehicle model years: 1900 to two years after the current year */
const ModelYear = z.number().int().min(1900).refine((y) => y <= new Date().getFullYear() + 2, {
  // Computed per validation, not baked into the schema, so openapi.json doesn't go stale each January
  error: () => `year must be at most ${new Date().getFullYear() + 2}`,
});

const Latitude = z.number().min(-90).max(90);
const Longitude = z.number().min(-180).max(180);

/** Must be a key returned by POST /v1/upload/presign for this vehicle (or the record's current key) */
const PhotoKey = z.string().describe('Key returned by POST /v1/upload/presign for this vehicle and type');

// ── Vehicles ────────────────────────────────────────────────────────────────

const vehicleFields = {
  nickname: z.string(),
  make: maxLen(100),
  model: maxLen(100),
  year: ModelYear,
  trim: optional(maxLen(100)),
  color: optional(maxLen(50)),
  vin: optional(maxLen(17)),
  licensePlate: optional(maxLen(20)),
  tankSize: optional(z.number().min(0.1)),
  fuelType: optional(z.string()),
  photoKey: optional(PhotoKey),
};

export const VehicleCreate = z.object({
  ...vehicleFields,
  nickname: requiredString(),
  make: requiredString().max(100),
  model: requiredString().max(100),
});
export type VehicleCreate = z.infer<typeof VehicleCreate>;

export const VehicleUpdate = z.object({
  nickname: optional(vehicleFields.nickname),
  make: optional(vehicleFields.make),
  model: optional(vehicleFields.model),
  year: optional(vehicleFields.year),
  trim: vehicleFields.trim,
  color: vehicleFields.color,
  vin: vehicleFields.vin,
  licensePlate: vehicleFields.licensePlate,
  tankSize: vehicleFields.tankSize,
  fuelType: vehicleFields.fuelType,
  photoKey: vehicleFields.photoKey,
});
export type VehicleUpdate = z.infer<typeof VehicleUpdate>;

export const VehicleArchive = z.object({ isArchived: z.boolean() });

export const VehicleListQuery = z.object({
  status: z.enum(['active', 'archived', 'all']).optional()
    .describe("Default 'active'. Any value other than 'active' or 'archived' returns all vehicles."),
});

/**
 * Pagination for growing lists (#26). Without `limit` the full list is returned, as before.
 */
export const ListQuery = z.object({
  limit: z.coerce.number<number>().int().min(1).max(500).optional().describe('Page size; omit for the full list'),
  cursor: z.string().min(1).optional().describe('`nextCursor` from the previous page'),
  order: z.enum(['asc', 'desc']).optional().describe("'asc' (default): oldest first; 'desc': newest first"),
});
export type ListQuery = z.infer<typeof ListQuery>;

// ── Fill-ups ────────────────────────────────────────────────────────────────

const fillupOptionalFields = {
  isPartialFill: optional(z.boolean()),
  isBusiness: optional(z.boolean()),
  locationLat: optional(Latitude),
  locationLng: optional(Longitude),
  // Handler gap: only the length is checked for these three; non-strings are stored as sent
  stationName: optional(maxLen(255)),
  address: optional(maxLen(1000)),
  notes: optional(maxLen(1000)),
  receiptPhotoKey: optional(PhotoKey),
};

export const FillupCreate = z.object({
  date: DateInput,
  currencySpent: z.number().min(0.01),
  gallonsAdded: z.number().min(0.01),
  odometerReading: z.number().min(0.01),
  ...fillupOptionalFields,
});
export type FillupCreate = z.infer<typeof FillupCreate>;

/**
 * Every field is optional. `receiptPhotoKey: null` removes the receipt and deletes the file.
 * Handler gap: PUT doesn't type-check fields today (only ranges, lengths and coordinates).
 */
export const FillupUpdate = z.object({
  date: optional(DateInput),
  currencySpent: optional(z.number().min(0.01)),
  gallonsAdded: optional(z.number().min(0.01)),
  odometerReading: optional(z.number().min(0.01)),
  ...fillupOptionalFields,
});
export type FillupUpdate = z.infer<typeof FillupUpdate>;

// ── Maintenance ─────────────────────────────────────────────────────────────

const maintenanceOptionalFields = {
  location: optional(z.string()),
  locationLat: optional(Latitude),
  locationLng: optional(Longitude),
  stationName: optional(z.string()),
  address: optional(z.string()),
  notes: optional(maxLen(1000)),
  receiptPhotoKey: optional(PhotoKey),
};

export const MaintenanceCreate = z.object({
  schemaId: optional(Ulid).describe('A maintenance schema; or give customTypeName'),
  customTypeName: optional(maxLen(255)),
  datePerformed: DateInput,
  odometerAtService: z.number().min(0),
  cost: z.number().min(0),
  ...maintenanceOptionalFields,
}).refine((b) => !!b.schemaId || !!b.customTypeName, {
  message: 'Either schemaId or customTypeName is required',
  path: ['customTypeName'],
});
export type MaintenanceCreate = z.infer<typeof MaintenanceCreate>;

/** Every field is optional. `receiptPhotoKey: null` removes the receipt and deletes the file. */
export const MaintenanceUpdate = z.object({
  schemaId: optional(Ulid),
  customTypeName: optional(maxLen(255)),
  datePerformed: optional(DateInput),
  odometerAtService: optional(z.number().min(0)),
  cost: optional(z.number().min(0)),
  ...maintenanceOptionalFields,
});
export type MaintenanceUpdate = z.infer<typeof MaintenanceUpdate>;

// ── Sharing, profile, uploads, imports, exports ─────────────────────────────

export const ShareCreate = z.object({
  // Trimmed before the format check, like the handler (which also lowercases it)
  email: z.string().trim().regex(/^[^\s@]+@[^\s@]+\.[^\s@]+$/, 'email must be a valid email address'),
  permission: SharePermission,
}).describe('Creates the share, or updates the permission of an existing share for this email (200 vs 201)');
export type ShareCreate = z.infer<typeof ShareCreate>;

export const ProfileUpdate = z.object({
  displayName: z.string().max(255).refine((s) => s.trim() !== '', 'displayName is required and must be a non-empty string'),
});
export type ProfileUpdate = z.infer<typeof ProfileUpdate>;

export const UploadType = z.enum(['vehicle-photo', 'receipt-photo', 'csv-import']);
export const UploadContentType = z.enum([
  'image/jpeg', 'image/png', 'image/webp', 'image/heic',
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/csv',
]);

export const PresignRequest = z.object({
  uploadType: UploadType.describe(
    'receipt-photo: owner or fuel/maintenance/full share. vehicle-photo: owner only. csv-import: owner or full share.',
  ),
  vehicleId: Ulid,
  filename: requiredString().describe('Sanitized server-side; the stored key gets a unique prefix'),
  contentType: UploadContentType,
  // Signed into the URL with contentType, so S3 rejects a PUT of any other size or type
  fileSize: z.number().int().positive().max(10 * 1024 * 1024, { error: 'File size exceeds maximum of 10 MB' })
    .describe('Bytes, max 10 MB. The PUT must send exactly this many bytes.'),
});
export type PresignRequest = z.infer<typeof PresignRequest>;

export const ImportRequest = z.object({
  s3Key: requiredString().describe('A csv-import key returned by POST /v1/upload/presign for this vehicle'),
});

export const SummaryCardRequest = z.object({ year: z.number() });

export const DateRange = z.object({
  startDate: optional(DateInput),
  endDate: optional(DateInput),
});

// ── Admin ───────────────────────────────────────────────────────────────────

const PositiveInterval = optional(z.number().positive());

export const AdminSchemaCreate = z.object({
  name: requiredString().max(255),
  description: requiredString().max(1000),
  category: requiredString(),
  defaultMileageInterval: PositiveInterval,
  defaultTimeIntervalDays: PositiveInterval,
});

export const AdminSchemaUpdate = z.object({
  name: optional(maxLen(255)),
  description: optional(maxLen(1000)),
  category: optional(z.string()),
  defaultMileageInterval: PositiveInterval,
  defaultTimeIntervalDays: PositiveInterval,
});

export const AdminSchemaActive = z.object({ isActive: z.boolean() });

export const AdminSetAdmin = z.object({ isAdmin: z.boolean() });
