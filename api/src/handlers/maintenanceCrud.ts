import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { GetCommand, PutCommand, QueryCommand, DeleteCommand, ScanCommand } from '@aws-sdk/lib-dynamodb';
import { ulid } from 'ulid';
import { getDocClient, getTableName } from '../lib/dynamo.js';
import { getUserId } from '../lib/auth.js';
import { success, error } from '../lib/response.js';
import { InvalidCursorError, queryPage } from '../lib/pagination.js';
import { CONFLICT_MESSAGE, checkIfMatch, ifMatchCondition, isConditionFailure } from '../lib/concurrency.js';
import { withIdempotency } from '../lib/idempotency.js';
import { parseBody } from '../lib/validation.js';
import { validate } from '../lib/contract.js';
import { ListQuery, MaintenanceCreate, MaintenanceUpdate } from '@pawsitivemileage/contracts';
import { createLogger } from '../lib/logger.js';
import { deleteObject, photoKeyFieldError } from '../lib/s3.js';
import { calculateReminder } from '../lib/reminders.js';
import { verifyAccess } from '../lib/authSharing.js';
import type { MaintenanceRecord } from '../types/maintenance.js';
import type { MaintenanceSchema } from '../types/schema.js';
import type { Vehicle } from '../types/vehicle.js';

const logger = createLogger('maintenanceCrud');

export const handler = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
  const requestId = event.requestContext?.requestId ?? ulid();
  const userId = getUserId(event as Parameters<typeof getUserId>[0]);

  if (!userId) {
    return error('UNAUTHORIZED', 'Missing authentication', requestId);
  }

  const method = event.requestContext?.http?.method;
  const vehicleId = event.pathParameters?.vehicleId;
  const recordId = event.pathParameters?.recordId;
  const path = event.rawPath ?? '';

  if (!vehicleId) {
    return error('VALIDATION_ERROR', 'vehicleId is required', requestId);
  }

  try {
    // Determine required operation based on HTTP method
    const isRead = method === 'GET';
    const requiredOperation = isRead ? 'read' as const : 'write-maintenance' as const;

    // Verify ownership or shared access with appropriate permission
    const access = await verifyAccess(userId, vehicleId, requiredOperation);
    if (!access.allowed || !access.ownerUserId) {
      return error('FORBIDDEN', 'You do not have permission to perform this action', requestId);
    }
    const { ownerUserId } = access;

    // Route: GET /v1/vehicles/{vehicleId}/maintenance/reminders
    if (method === 'GET' && path.endsWith('/reminders')) {
      // Reminders need the full Vehicle object for maintenanceOverrides
      const vehicle = await getVehicle(ownerUserId, vehicleId);
      if (!vehicle) {
        return error('NOT_FOUND', 'Vehicle not found', requestId);
      }
      return await getReminders(vehicle, requestId, userId);
    }

    // Route: GET /v1/vehicles/{vehicleId}/maintenance/schemas
    // Active maintenance types for the add-maintenance form. Unlike /v1/admin/schemas,
    // this is available to the owner and anyone the vehicle is shared with.
    if (method === 'GET' && path.endsWith('/schemas')) {
      return success(await fetchActiveSchemas(), requestId);
    }

    // Maintenance CRUD routes
    if (method === 'GET' && !recordId) {
      return await listMaintenance(event, vehicleId, requestId, userId);
    }
    if (method === 'POST') {
      return await withIdempotency(event, userId, requestId, () => createMaintenance(event, vehicleId, ownerUserId, requestId, userId));
    }
    if (method === 'PUT' && recordId) {
      return await updateMaintenance(event, vehicleId, recordId, ownerUserId, requestId, userId);
    }
    if (method === 'DELETE' && recordId) {
      return await deleteMaintenance(vehicleId, recordId, requestId, userId);
    }

    return error('VALIDATION_ERROR', 'Unsupported operation', requestId);
  } catch (err) {
    logger.error('Unhandled error in maintenanceCrud', requestId, userId, err);
    return error('INTERNAL_ERROR', 'An internal error occurred', requestId);
  }
};


/**
 * Fetch the vehicle record. Returns the full Vehicle (needed for maintenanceOverrides on reminders).
 */
async function getVehicle(userId: string, vehicleId: string): Promise<Vehicle | null> {
  const docClient = getDocClient();
  const tableName = getTableName('VEHICLES_TABLE');

  const result = await docClient.send(new GetCommand({
    TableName: tableName,
    Key: { userId, vehicleId },
  }));

  return (result.Item as Vehicle) ?? null;
}


/**
 * GET /v1/vehicles/{vehicleId}/maintenance — List all maintenance records, sorted by date (Req 4.9).
 */
async function listMaintenance(
  event: APIGatewayProxyEventV2,
  vehicleId: string,
  requestId: string,
  userId: string,
): Promise<APIGatewayProxyResultV2> {
  // Optional pagination (#26): no limit → the full list, as before
  const query = validate(ListQuery, event.queryStringParameters ?? {});
  if (!query.ok) {
    return error('VALIDATION_ERROR', query.message, requestId);
  }

  logger.info('Listing maintenance records', requestId, userId);

  try {
    const page = await queryPage(
      {
        TableName: getTableName('MAINTENANCE_TABLE'),
        KeyConditionExpression: 'vehicleId = :vid',
        ExpressionAttributeValues: { ':vid': vehicleId },
      },
      { key: 'vehicleId', value: vehicleId },
      query.data,
    );
    return success(page.items, requestId, 200, page.nextCursor ? { nextCursor: page.nextCursor } : undefined);
  } catch (err) {
    if (err instanceof InvalidCursorError) return error('VALIDATION_ERROR', err.message, requestId);
    throw err;
  }
}


/**
 * POST /v1/vehicles/{vehicleId}/maintenance — Create a maintenance record.
 * Accepts either schemaId (references a MaintenanceSchema) or customTypeName (free-text).
 * The record is attributed to the vehicle owner, even when created by a shared user.
 * Validates: Requirements 4.4, 4.5
 */
async function createMaintenance(
  event: APIGatewayProxyEventV2,
  vehicleId: string,
  ownerUserId: string,
  requestId: string,
  userId: string,
): Promise<APIGatewayProxyResultV2> {
  const body = parseBody(event.body);
  if (!body) {
    return error('VALIDATION_ERROR', 'Invalid or missing request body', requestId);
  }

  // Validate against the API contract (#18): required fields, types, ranges, lengths, coordinates,
  // and schemaId-or-customTypeName
  const valid = validate(MaintenanceCreate, body);
  if (!valid.ok) {
    return error('VALIDATION_ERROR', valid.message, requestId);
  }

  const receiptKeyError = photoKeyFieldError('receiptPhotoKey', body.receiptPhotoKey, undefined, ownerUserId, vehicleId, 'receipt-photo');
  if (receiptKeyError) {
    return error('VALIDATION_ERROR', receiptKeyError, requestId);
  }

  // Must provide either schemaId or customTypeName
  const schemaId = body.schemaId as string | undefined;
  const customTypeName = body.customTypeName as string | undefined;

  if (!schemaId && !customTypeName) {
    return error('VALIDATION_ERROR', 'Either schemaId or customTypeName is required', requestId);
  }

  // If schemaId provided, look up the schema to get the name (Req 4.4)
  let schemaName: string | undefined;
  if (schemaId) {
    const schema = await getSchema(schemaId);
    if (!schema) {
      return error('NOT_FOUND', 'Maintenance schema not found', requestId);
    }
    if (!schema.isActive) {
      return error('VALIDATION_ERROR', 'Maintenance schema is inactive', requestId);
    }
    schemaName = schema.name;
  }

  const now = new Date().toISOString();
  const recordId = ulid();
  const datePerformed = body.datePerformed as string;
  const sortKey = `${datePerformed}#${recordId}`;

  const record: MaintenanceRecord = {
    vehicleId,
    recordId,
    userId: ownerUserId,
    ...(schemaId && { schemaId }),
    ...(schemaName && { schemaName }),
    ...(customTypeName && { customTypeName }),
    datePerformed,
    odometerAtService: body.odometerAtService as number,
    cost: body.cost as number,
    ...(body.location !== undefined && { location: body.location as string }),
    ...(body.locationLat !== undefined && { locationLat: body.locationLat as number }),
    ...(body.locationLng !== undefined && { locationLng: body.locationLng as number }),
    ...(body.stationName !== undefined && { stationName: body.stationName as string }),
    ...(body.address !== undefined && { address: body.address as string }),
    ...(body.notes !== undefined && { notes: body.notes as string }),
    ...(body.receiptPhotoKey !== undefined && { receiptPhotoKey: body.receiptPhotoKey as string }),
    createdAt: now,
    updatedAt: now,
  };

  const docClient = getDocClient();
  const tableName = getTableName('MAINTENANCE_TABLE');

  await docClient.send(new PutCommand({
    TableName: tableName,
    Item: {
      ...record,
      serviceDateId: sortKey,
      GSI1PK: ownerUserId,
      GSI1SK: datePerformed,
    },
  }));

  logger.info(`Created maintenance record ${recordId}`, requestId, userId);
  return success(record, requestId, 201);
}


/**
 * PUT /v1/vehicles/{vehicleId}/maintenance/{recordId} — Update a maintenance record.
 */
async function updateMaintenance(
  event: APIGatewayProxyEventV2,
  vehicleId: string,
  recordId: string,
  ownerUserId: string,
  requestId: string,
  userId: string,
): Promise<APIGatewayProxyResultV2> {
  const body = parseBody(event.body);
  if (!body) {
    return error('VALIDATION_ERROR', 'Invalid or missing request body', requestId);
  }

  // Validate against the API contract (#18) before touching the database
  const valid = validate(MaintenanceUpdate, body);
  if (!valid.ok) {
    return error('VALIDATION_ERROR', valid.message, requestId);
  }

  // Find the existing record
  const existing = await findRecordById(vehicleId, recordId);
  if (!existing) {
    return error('NOT_FOUND', 'Maintenance record not found', requestId);
  }

  const receiptKeyError = photoKeyFieldError('receiptPhotoKey', body.receiptPhotoKey, existing.receiptPhotoKey, ownerUserId, vehicleId, 'receipt-photo');
  if (receiptKeyError) {
    return error('VALIDATION_ERROR', receiptKeyError, requestId);
  }

  // If-Match (#25): refuse to overwrite a newer version
  const stale = checkIfMatch(event, existing.updatedAt, requestId);
  if (stale) return stale;
  const condition = ifMatchCondition(event);

  // If schemaId is being changed, look up the new schema
  let schemaName = existing.schemaName;
  if (body.schemaId !== undefined) {
    const newSchemaId = body.schemaId as string;
    const schema = await getSchema(newSchemaId);
    if (!schema) {
      return error('NOT_FOUND', 'Maintenance schema not found', requestId);
    }
    schemaName = schema.name;
  }

  const now = new Date().toISOString();
  const updatedDate = (body.datePerformed as string) ?? existing.datePerformed;
  const oldSortKey = `${existing.datePerformed}#${recordId}`;
  const newSortKey = `${updatedDate}#${recordId}`;

  const docClient = getDocClient();
  const tableName = getTableName('MAINTENANCE_TABLE');

  // If the date changed, delete the old item (sort key changed). With If-Match, the delete carries
  // the condition, so a concurrent edit stops the update before anything is written.
  const keyChanged = oldSortKey !== newSortKey;
  if (keyChanged) {
    try {
      await docClient.send(new DeleteCommand({
        TableName: tableName,
        Key: { vehicleId, serviceDateId: oldSortKey },
        ConditionExpression: condition.ConditionExpression,
        ...(condition.ConditionExpression && { ExpressionAttributeNames: condition.names, ExpressionAttributeValues: condition.values }),
      }));
    } catch (err) {
      if (isConditionFailure(err)) return error('CONFLICT', CONFLICT_MESSAGE, requestId);
      throw err;
    }
  }

  const updated: MaintenanceRecord = {
    ...existing,
    // Re-attribute to the owner in case an older record was stamped with a shared user's id
    userId: ownerUserId,
    ...(body.schemaId !== undefined && { schemaId: body.schemaId as string }),
    ...(schemaName !== undefined && { schemaName }),
    ...(body.customTypeName !== undefined && { customTypeName: body.customTypeName as string }),
    datePerformed: updatedDate,
    odometerAtService: (body.odometerAtService as number) ?? existing.odometerAtService,
    cost: (body.cost as number) ?? existing.cost,
    ...(body.location !== undefined && { location: body.location as string }),
    ...(body.locationLat !== undefined && { locationLat: body.locationLat as number }),
    ...(body.locationLng !== undefined && { locationLng: body.locationLng as number }),
    ...(body.stationName !== undefined && { stationName: body.stationName as string }),
    ...(body.address !== undefined && { address: body.address as string }),
    ...(body.notes !== undefined && { notes: body.notes as string }),
    // receiptPhotoKey: null means "remove photo"; string means "set new photo"
    ...(body.receiptPhotoKey !== undefined && body.receiptPhotoKey !== null && { receiptPhotoKey: body.receiptPhotoKey as string }),
    updatedAt: now,
  };

  // receiptPhotoKey: null removes the receipt: strip the field now, delete the file after the write
  const removeReceipt = body.receiptPhotoKey === null && existing.receiptPhotoKey;
  if (removeReceipt) {
    delete (updated as unknown as Record<string, unknown>).receiptPhotoKey;
  }

  try {
    await docClient.send(new PutCommand({
      TableName: tableName,
      Item: {
        ...updated,
        serviceDateId: newSortKey,
        GSI1PK: ownerUserId,
        GSI1SK: updatedDate,
      },
      // Same key: If-Match is enforced atomically here (a changed key was guarded by the delete)
      ...(!keyChanged && condition.ConditionExpression && {
        ConditionExpression: condition.ConditionExpression,
        ExpressionAttributeNames: condition.names,
        ExpressionAttributeValues: condition.values,
      }),
    }));
  } catch (err) {
    if (isConditionFailure(err)) return error('CONFLICT', CONFLICT_MESSAGE, requestId);
    throw err;
  }

  // Only after the record no longer references it
  if (removeReceipt) {
    const photosBucket = process.env.PHOTOS_BUCKET;
    if (photosBucket) {
      try {
        await deleteObject(photosBucket, existing.receiptPhotoKey!);
        logger.info(`Deleted receipt photo ${existing.receiptPhotoKey} from S3`, requestId, userId);
      } catch (s3Err) {
        logger.error('Failed to delete receipt photo from S3', requestId, userId, s3Err);
        // Continue — the update succeeded; an orphaned file is harmless
      }
    }
  }

  logger.info(`Updated maintenance record ${recordId}`, requestId, userId);
  return success(updated, requestId);
}


/**
 * DELETE /v1/vehicles/{vehicleId}/maintenance/{recordId} — Delete a maintenance record.
 */
async function deleteMaintenance(
  vehicleId: string,
  recordId: string,
  requestId: string,
  userId: string,
): Promise<APIGatewayProxyResultV2> {
  const existing = await findRecordById(vehicleId, recordId);
  if (!existing) {
    return error('NOT_FOUND', 'Maintenance record not found', requestId);
  }

  const docClient = getDocClient();
  const tableName = getTableName('MAINTENANCE_TABLE');
  const sortKey = `${existing.datePerformed}#${recordId}`;

  await docClient.send(new DeleteCommand({
    TableName: tableName,
    Key: { vehicleId, serviceDateId: sortKey },
  }));

  logger.info(`Deleted maintenance record ${recordId}`, requestId, userId);
  return success({ deleted: true }, requestId);
}


/**
 * GET /v1/vehicles/{vehicleId}/maintenance/reminders — Get upcoming maintenance reminders.
 *
 * For each active schema, finds the most recent maintenance record for this vehicle,
 * then calculates reminders using the design's calculateReminder logic.
 * Supports vehicle-level maintenanceOverrides for custom intervals (Req 4.6, 4.7, 4.8).
 */
async function getReminders(
  vehicle: Vehicle,
  requestId: string,
  userId: string,
): Promise<APIGatewayProxyResultV2> {
  logger.info('Calculating reminders', requestId, userId);

  // Fetch all active schemas
  const schemas = await fetchActiveSchemas();

  // Fetch all maintenance records for this vehicle
  const records = await fetchAllRecords(vehicle.vehicleId);

  // Get the vehicle's current odometer from the most recent fillup or maintenance record
  const currentOdometer = await getCurrentOdometer(vehicle.vehicleId);
  const currentDate = new Date().toISOString().split('T')[0];

  const reminders = [];

  for (const schema of schemas) {
    // Find the most recent maintenance record for this schema
    const lastRecord = findLastRecordForSchema(records, schema.schemaId);

    // Determine intervals — vehicle overrides take precedence (Req 4.6)
    const overrides = vehicle.maintenanceOverrides?.[schema.schemaId];
    const mileageInterval = overrides?.mileageInterval ?? schema.defaultMileageInterval;
    const timeIntervalDays = overrides?.timeIntervalDays ?? schema.defaultTimeIntervalDays;

    // Skip if no intervals defined at all
    if ((mileageInterval === null || mileageInterval === undefined)
      && (timeIntervalDays === null || timeIntervalDays === undefined)) {
      continue;
    }

    // If no previous service record, use vehicle creation as baseline
    const lastServiceOdometer = lastRecord?.odometerAtService ?? 0;
    const lastServiceDate = lastRecord?.datePerformed ?? vehicle.createdAt.split('T')[0];

    const reminder = calculateReminder({
      schemaName: schema.name,
      mileageInterval: mileageInterval ?? null,
      timeIntervalDays: timeIntervalDays ?? null,
      lastServiceOdometer,
      lastServiceDate,
      currentOdometer,
      currentDate,
    });

    if (reminder) {
      reminders.push(reminder);
    }
  }

  return success(reminders, requestId);
}


// ─── Helper Functions ────────────────────────────────────────────────────────

/**
 * Look up a maintenance schema by schemaId.
 */
async function getSchema(schemaId: string): Promise<MaintenanceSchema | null> {
  const docClient = getDocClient();
  const tableName = getTableName('SCHEMAS_TABLE');

  const result = await docClient.send(new GetCommand({
    TableName: tableName,
    Key: { schemaId },
  }));

  return (result.Item as MaintenanceSchema) ?? null;
}

/**
 * Fetch all active maintenance schemas.
 */
async function fetchActiveSchemas(): Promise<MaintenanceSchema[]> {
  const docClient = getDocClient();
  const tableName = getTableName('SCHEMAS_TABLE');

  const result = await docClient.send(new ScanCommand({
    TableName: tableName,
    FilterExpression: 'isActive = :active',
    ExpressionAttributeValues: { ':active': true },
  }));

  return (result.Items ?? []) as MaintenanceSchema[];
}

/**
 * Fetch all maintenance records for a vehicle, sorted chronologically.
 */
async function fetchAllRecords(vehicleId: string): Promise<MaintenanceRecord[]> {
  const docClient = getDocClient();
  const tableName = getTableName('MAINTENANCE_TABLE');

  const items: Record<string, unknown>[] = [];
  let exclusiveStartKey: Record<string, unknown> | undefined;

  do {
    const result = await docClient.send(new QueryCommand({
      TableName: tableName,
      KeyConditionExpression: 'vehicleId = :vid',
      ExpressionAttributeValues: { ':vid': vehicleId },
      ScanIndexForward: true,
      ExclusiveStartKey: exclusiveStartKey,
    }));

    if (result.Items) items.push(...result.Items);
    exclusiveStartKey = result.LastEvaluatedKey;
  } while (exclusiveStartKey);

  return items as unknown as MaintenanceRecord[];
}

/**
 * Find a single maintenance record by vehicleId and recordId.
 */
async function findRecordById(vehicleId: string, recordId: string): Promise<MaintenanceRecord | null> {
  const docClient = getDocClient();
  const tableName = getTableName('MAINTENANCE_TABLE');

  const result = await docClient.send(new QueryCommand({
    TableName: tableName,
    KeyConditionExpression: 'vehicleId = :vid',
    FilterExpression: 'recordId = :rid',
    ExpressionAttributeValues: { ':vid': vehicleId, ':rid': recordId },
  }));

  return (result.Items?.[0] as unknown as MaintenanceRecord) ?? null;
}

/**
 * Find the most recent maintenance record for a given schemaId.
 * Records are already sorted chronologically, so the last match is the most recent.
 */
function findLastRecordForSchema(records: MaintenanceRecord[], schemaId: string): MaintenanceRecord | null {
  for (let i = records.length - 1; i >= 0; i--) {
    if (records[i].schemaId === schemaId) return records[i];
  }
  return null;
}

/**
 * Get the current odometer reading for a vehicle.
 * Checks the most recent fillup first, then falls back to the most recent maintenance record.
 */
async function getCurrentOdometer(vehicleId: string): Promise<number> {
  const docClient = getDocClient();

  // Try fillups table first (most likely to have the latest odometer)
  try {
    const fillupsTable = getTableName('FILLUPS_TABLE');
    const fillupResult = await docClient.send(new QueryCommand({
      TableName: fillupsTable,
      KeyConditionExpression: 'vehicleId = :vid',
      ExpressionAttributeValues: { ':vid': vehicleId },
      ScanIndexForward: false, // most recent first
      Limit: 1,
      ProjectionExpression: 'odometerReading',
    }));

    if (fillupResult.Items?.[0]?.odometerReading) {
      return fillupResult.Items[0].odometerReading as number;
    }
  } catch {
    // FILLUPS_TABLE may not be configured; fall through
  }

  // Fall back to most recent maintenance record
  try {
    const maintTable = getTableName('MAINTENANCE_TABLE');
    const maintResult = await docClient.send(new QueryCommand({
      TableName: maintTable,
      KeyConditionExpression: 'vehicleId = :vid',
      ExpressionAttributeValues: { ':vid': vehicleId },
      ScanIndexForward: false,
      Limit: 1,
      ProjectionExpression: 'odometerAtService',
    }));

    if (maintResult.Items?.[0]?.odometerAtService) {
      return maintResult.Items[0].odometerAtService as number;
    }
  } catch {
    // Fall through to default
  }

  return 0;
}
