/**
 * Every /v1 route, declared once. The OpenAPI document (#15) and the SDK (#17) are derived from
 * this table, and a test keeps it in step with the routes deployed in infra/lib/stacks/api-stack.ts.
 *
 * All routes require a Cognito JWT (`Authorization: Bearer <token>`); admin routes also require
 * the caller's profile to have isAdmin. Success bodies are `{ data, requestId }`, errors
 * `{ error, code, requestId }`.
 */
import * as z from 'zod';
import { Deleted, Ulid, UserId } from './common.js';
import {
  MaintenanceRecord, MaintenanceSchema, Fillup, Reminder, Share, SharedVehicle, User, Vehicle,
} from './entities.js';
import {
  AdminSchemaActive, AdminSchemaCreate, AdminSchemaUpdate, AdminSetAdmin, DateRange, FillupCreate, FillupUpdate,
  ImportRequest, MaintenanceCreate, MaintenanceUpdate, PresignRequest, ProfileUpdate, ShareCreate, SummaryCardRequest,
  VehicleArchive, VehicleCreate, VehicleListQuery, VehicleUpdate,
} from './requests.js';
import {
  AccountDeleted, AdminStats, AdminUserStats, AnalyticsDashboard, CsvExport, ImportResult, PresignResult,
  RecalculateResult, Report, SummaryCard, YearOverYear,
} from './responses.js';

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export interface RouteDefinition {
  method: HttpMethod;
  /** Path template with `{param}` placeholders */
  path: string;
  summary: string;
  tag: 'Profile' | 'Vehicles' | 'Fill-ups' | 'Maintenance' | 'Analytics' | 'Exports' | 'Uploads' | 'Imports' | 'Sharing' | 'Admin';
  params?: z.ZodObject;
  query?: z.ZodObject;
  body?: z.ZodType;
  /** The body may be omitted entirely */
  bodyOptional?: boolean;
  /** Success status */
  status: 200 | 201;
  /** Other success statuses this route can return with the same body */
  alsoReturns?: ReadonlyArray<200 | 201>;
  /** Schema of `data` in the success envelope */
  response: z.ZodType;
  /** Requires isAdmin on the caller's profile */
  admin?: boolean;
}

const defineRoute = <const R extends RouteDefinition>(route: R): R => route;

const VehicleParams = z.object({ vehicleId: Ulid });
const FillupParams = z.object({ vehicleId: Ulid, fillupId: Ulid });
const RecordParams = z.object({ vehicleId: Ulid, recordId: Ulid });
const ShareParams = z.object({ vehicleId: Ulid, shareId: Ulid });
const SchemaParams = z.object({ schemaId: Ulid });
const ImportParams = z.object({ vehicleId: Ulid, type: z.enum(['fuelups', 'maintenance']) });

export const routes = {
  // ── Profile ──
  getProfile: defineRoute({
    method: 'GET', path: '/v1/user/profile', tag: 'Profile', status: 200, alsoReturns: [201], response: User,
    summary: "The caller's profile. Created from the token's claims on first call (201).",
  }),
  updateProfile: defineRoute({
    method: 'PUT', path: '/v1/user/profile', tag: 'Profile', status: 200, body: ProfileUpdate, response: User,
    summary: 'Update the display name',
  }),
  deleteAccount: defineRoute({
    method: 'DELETE', path: '/v1/user/profile', tag: 'Profile', status: 200, response: AccountDeleted,
    summary: 'Delete the account and all owned vehicles, records and files',
  }),

  // ── Vehicles ──
  listVehicles: defineRoute({
    method: 'GET', path: '/v1/vehicles', tag: 'Vehicles', status: 200, query: VehicleListQuery, response: z.array(Vehicle),
    summary: "The caller's own vehicles (shared vehicles: listSharedVehicles)",
  }),
  createVehicle: defineRoute({
    method: 'POST', path: '/v1/vehicles', tag: 'Vehicles', status: 201, body: VehicleCreate, response: Vehicle,
    summary: 'Add a vehicle',
  }),
  getVehicle: defineRoute({
    method: 'GET', path: '/v1/vehicles/{vehicleId}', tag: 'Vehicles', status: 200, params: VehicleParams, response: Vehicle,
    summary: 'A vehicle the caller owns or has been shared',
  }),
  updateVehicle: defineRoute({
    method: 'PUT', path: '/v1/vehicles/{vehicleId}', tag: 'Vehicles', status: 200, params: VehicleParams, body: VehicleUpdate,
    response: Vehicle, summary: 'Update a vehicle (owner only)',
  }),
  archiveVehicle: defineRoute({
    method: 'PATCH', path: '/v1/vehicles/{vehicleId}/archive', tag: 'Vehicles', status: 200, params: VehicleParams,
    body: VehicleArchive, response: Vehicle, summary: 'Archive or unarchive a vehicle (owner only)',
  }),

  // ── Fill-ups ──
  listFillups: defineRoute({
    method: 'GET', path: '/v1/vehicles/{vehicleId}/fillups', tag: 'Fill-ups', status: 200, params: VehicleParams,
    response: z.array(Fillup), summary: 'All fill-ups for a vehicle',
  }),
  createFillup: defineRoute({
    method: 'POST', path: '/v1/vehicles/{vehicleId}/fillups', tag: 'Fill-ups', status: 201, params: VehicleParams,
    body: FillupCreate, response: Fillup, summary: 'Add a fill-up; derived metrics are recalculated for the vehicle',
  }),
  getFillup: defineRoute({
    method: 'GET', path: '/v1/vehicles/{vehicleId}/fillups/{fillupId}', tag: 'Fill-ups', status: 200, params: FillupParams,
    response: Fillup, summary: 'One fill-up',
  }),
  updateFillup: defineRoute({
    method: 'PUT', path: '/v1/vehicles/{vehicleId}/fillups/{fillupId}', tag: 'Fill-ups', status: 200, params: FillupParams,
    body: FillupUpdate, response: Fillup, summary: 'Update a fill-up; receiptPhotoKey: null removes the receipt',
  }),
  deleteFillup: defineRoute({
    method: 'DELETE', path: '/v1/vehicles/{vehicleId}/fillups/{fillupId}', tag: 'Fill-ups', status: 200, params: FillupParams,
    response: Deleted, summary: 'Delete a fill-up',
  }),

  // ── Maintenance ──
  listMaintenance: defineRoute({
    method: 'GET', path: '/v1/vehicles/{vehicleId}/maintenance', tag: 'Maintenance', status: 200, params: VehicleParams,
    response: z.array(MaintenanceRecord), summary: 'All maintenance records for a vehicle',
  }),
  createMaintenance: defineRoute({
    method: 'POST', path: '/v1/vehicles/{vehicleId}/maintenance', tag: 'Maintenance', status: 201, params: VehicleParams,
    body: MaintenanceCreate, response: MaintenanceRecord, summary: 'Add a maintenance record',
  }),
  updateMaintenance: defineRoute({
    method: 'PUT', path: '/v1/vehicles/{vehicleId}/maintenance/{recordId}', tag: 'Maintenance', status: 200,
    params: RecordParams, body: MaintenanceUpdate, response: MaintenanceRecord,
    summary: 'Update a maintenance record; receiptPhotoKey: null removes the receipt',
  }),
  deleteMaintenance: defineRoute({
    method: 'DELETE', path: '/v1/vehicles/{vehicleId}/maintenance/{recordId}', tag: 'Maintenance', status: 200,
    params: RecordParams, response: Deleted, summary: 'Delete a maintenance record',
  }),
  listReminders: defineRoute({
    method: 'GET', path: '/v1/vehicles/{vehicleId}/maintenance/reminders', tag: 'Maintenance', status: 200,
    params: VehicleParams, response: z.array(Reminder), summary: 'Maintenance due soon or overdue',
  }),
  listVehicleSchemas: defineRoute({
    method: 'GET', path: '/v1/vehicles/{vehicleId}/maintenance/schemas', tag: 'Maintenance', status: 200,
    params: VehicleParams, response: z.array(MaintenanceSchema), summary: 'Active maintenance schemas to choose from',
  }),

  // ── Analytics ──
  getAnalytics: defineRoute({
    method: 'GET', path: '/v1/vehicles/{vehicleId}/analytics', tag: 'Analytics', status: 200, params: VehicleParams,
    response: AnalyticsDashboard, summary: 'Dashboard series',
  }),
  getYearOverYear: defineRoute({
    method: 'GET', path: '/v1/vehicles/{vehicleId}/analytics/yoy', tag: 'Analytics', status: 200, params: VehicleParams,
    response: YearOverYear, summary: 'Per-year totals with trends against the previous year',
  }),
  getSummaryCard: defineRoute({
    method: 'POST', path: '/v1/vehicles/{vehicleId}/summary-card', tag: 'Analytics', status: 200, params: VehicleParams,
    body: SummaryCardRequest, response: SummaryCard, summary: 'Totals for one year',
  }),

  // ── Exports ──
  exportFillups: defineRoute({
    method: 'GET', path: '/v1/vehicles/{vehicleId}/export/fillups', tag: 'Exports', status: 200, params: VehicleParams,
    query: DateRange, response: CsvExport, summary: 'Fill-ups as CSV (presigned download URL)',
  }),
  exportMaintenance: defineRoute({
    method: 'GET', path: '/v1/vehicles/{vehicleId}/export/maintenance', tag: 'Exports', status: 200, params: VehicleParams,
    query: DateRange, response: CsvExport, summary: 'Maintenance records as CSV (presigned download URL)',
  }),
  exportReport: defineRoute({
    method: 'POST', path: '/v1/vehicles/{vehicleId}/export/pdf', tag: 'Exports', status: 200, params: VehicleParams,
    body: DateRange, bodyOptional: true, response: Report, summary: 'Report data for a client-rendered PDF',
  }),

  // ── Uploads & imports ──
  presignUpload: defineRoute({
    method: 'POST', path: '/v1/upload/presign', tag: 'Uploads', status: 200, body: PresignRequest, response: PresignResult,
    summary: "Presigned PUT URL; files are stored under the vehicle owner's ID",
  }),
  importCsv: defineRoute({
    method: 'POST', path: '/v1/vehicles/{vehicleId}/import/{type}', tag: 'Imports', status: 200, params: ImportParams,
    body: ImportRequest, response: ImportResult, summary: 'Import a Fuelly CSV (owner or full share)',
  }),
  recalculateMetrics: defineRoute({
    method: 'POST', path: '/v1/vehicles/{vehicleId}/recalculate', tag: 'Imports', status: 200, params: VehicleParams,
    bodyOptional: true, response: RecalculateResult, summary: 'Recompute derived fill-up metrics (owner or full share)',
  }),

  // ── Sharing ──
  listSharedVehicles: defineRoute({
    method: 'GET', path: '/v1/vehicles/shared', tag: 'Sharing', status: 200, response: z.array(SharedVehicle),
    summary: 'Vehicles other users have shared with the caller',
  }),
  listShares: defineRoute({
    method: 'GET', path: '/v1/vehicles/{vehicleId}/sharing', tag: 'Sharing', status: 200, params: VehicleParams,
    response: z.array(Share), summary: 'Who a vehicle is shared with (owner only)',
  }),
  shareVehicle: defineRoute({
    method: 'POST', path: '/v1/vehicles/{vehicleId}/sharing', tag: 'Sharing', status: 201, alsoReturns: [200],
    params: VehicleParams, body: ShareCreate, response: Share,
    summary: 'Share by email (201), or change the permission of an existing share (200)',
  }),
  unshareVehicle: defineRoute({
    method: 'DELETE', path: '/v1/vehicles/{vehicleId}/sharing/{shareId}', tag: 'Sharing', status: 200, params: ShareParams,
    response: Deleted, summary: 'Remove a share',
  }),

  // ── Admin ──
  adminListUsers: defineRoute({
    method: 'GET', path: '/v1/admin/users', tag: 'Admin', status: 200, admin: true, response: z.array(AdminUserStats),
    summary: 'All users with usage counts',
  }),
  adminSetAdmin: defineRoute({
    method: 'PATCH', path: '/v1/admin/users/{userId}/admin', tag: 'Admin', status: 200, admin: true,
    params: z.object({ userId: UserId }), body: AdminSetAdmin, response: User, summary: "Grant or revoke a user's admin flag",
  }),
  adminListSchemas: defineRoute({
    method: 'GET', path: '/v1/admin/schemas', tag: 'Admin', status: 200, admin: true, response: z.array(MaintenanceSchema),
    summary: 'All maintenance schemas, active and inactive',
  }),
  adminCreateSchema: defineRoute({
    method: 'POST', path: '/v1/admin/schemas', tag: 'Admin', status: 201, admin: true, body: AdminSchemaCreate,
    response: MaintenanceSchema, summary: 'Add a maintenance schema',
  }),
  adminUpdateSchema: defineRoute({
    method: 'PUT', path: '/v1/admin/schemas/{schemaId}', tag: 'Admin', status: 200, admin: true, params: SchemaParams,
    body: AdminSchemaUpdate, response: MaintenanceSchema, summary: 'Update a maintenance schema',
  }),
  adminSetSchemaActive: defineRoute({
    method: 'PATCH', path: '/v1/admin/schemas/{schemaId}/active', tag: 'Admin', status: 200, admin: true,
    params: SchemaParams, body: AdminSchemaActive, response: MaintenanceSchema, summary: 'Activate or deactivate a schema',
  }),
  adminStats: defineRoute({
    method: 'GET', path: '/v1/admin/stats', tag: 'Admin', status: 200, admin: true, response: AdminStats,
    summary: 'Platform totals and monthly fill-up trend',
  }),
} as const satisfies Record<string, RouteDefinition>;

export type Routes = typeof routes;
export type OperationId = keyof Routes;
