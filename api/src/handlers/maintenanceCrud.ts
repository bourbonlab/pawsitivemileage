import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { GetCommand, PutCommand, QueryCommand, DeleteCommand, ScanCommand } from '@aws-sdk/lib-dynamodb';
import { ulid } from 'ulid';
import { getDocClient, getTableName } from '../lib/dynamo.js';
import { getUserId } from '../lib/auth.js';
import { success, error } from '../lib/response.js';
import { parseBody, validateRequired, validateTypes, validateRange } from '../lib/validation.js';
import { createLogger } from '../lib/logger.js';
import { calculateReminder } from '../lib/reminders.js';
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
    // Verify vehicle ownership before any operation
    const vehicle = await getVehicle(userId, vehicleId);
    if (!vehicle) {
      return error('NOT_FOUND', 'Vehicle not found', requestId);
    }

    // Route: GET /v1/vehicles/{vehicleId}/reminders
    if (method === 'GET' && path.endsWith('/reminders')) {
      return await getReminders(vehicle, requestId, userId);
    }

    // Maintenance CRUD routes
    if (method === 'GET' && !recordId) {
      return await listMaintenance(vehicleId, requestId, userId);
    }
    if (method === 'POST') {
      return await createMaintenance(event, vehicleId, requestId, userId);
    }
    if (method === 'PUT' && recordId) {
      return await updateMaintenance(event, vehicleId, recordId, requestId, userId);
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
  vehicleId: string,
  requestId: string,
  userId: string,
): Promise<APIGatewayProxyResultV2> {
  const docClient = getDocClient();
  const tableName = getTableName('MAINTENANCE_TABLE');

  logger.info('Listing maintenance records', requestId, userId);

  const items: Record<string, unknown>[] = [];
  let exclusiveStartKey: Record<string, unknown> | undefined;

  do {
    const result = await docClient.send(new QueryCommand({
      TableName: tableName,
      KeyConditionExpression: 'vehicleId = :vid',
      ExpressionAttributeValues: { ':vid': vehicleId },
      ScanIndexForward: true, // chronological order
      ExclusiveStartKey: exclusiveStartKey,
    }));

    if (result.Items) items.push(...result.Items);
    exclusiveStartKey = result.LastEvaluatedKey;
  } while (exclusiveStartKey);

  return success(items, requestId);
}


/**
 * POST /v1/vehicles/{vehicleId}/maintenance — Create a maintenance record.
 * Accepts either schemaId (references a MaintenanceSchema) or customTypeName (free-text).
 * Validates: Requirements 4.4, 4.5
 */
async function createMaintenance(
  event: APIGatewayProxyEventV2,
  vehicleId: string,
  requestId: string,
  userId: string,
): Promise<APIGatewayProxyResultV2> {
  const body = parseBody(event.body);
  if (!body) {
    return error('VALIDATION_ERROR', 'Invalid or missing request body', requestId);
  }

  // Validate required fields
  const requiredErrors = validateRequired(body, ['datePerformed', 'odometerAtService', 'cost']);
  if (requiredErrors.length > 0) {
    return error('VALIDATION_ERROR', requiredErrors.map(e => e.message).join('; '), requestId);
  }

  // Validate types
  const typeErrors = validateTypes(body, {
    datePerformed: 'string',
    odometerAtService: 'number',
    cost: 'number',
  });
  if (typeErrors.length > 0) {
    return error('VALIDATION_ERROR', typeErrors.map(e => e.message).join('; '), requestId);
  }

  // Validate ranges
  const rangeErrors = validateRange(body, {
    odometerAtService: { min: 0 },
    cost: { min: 0 },
  });
  if (rangeErrors.length > 0) {
    return error('VALIDATION_ERROR', rangeErrors.map(e => e.message).join('; '), requestId);
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
    userId,
    ...(schemaId && { schemaId }),
    ...(schemaName && { schemaName }),
    ...(customTypeName && { customTypeName }),
    datePerformed,
    odometerAtService: body.odometerAtService as number,
    cost: body.cost as number,
    ...(body.location !== undefined && { location: body.location as string }),
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
      GSI1PK: userId,
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
  requestId: string,
  userId: string,
): Promise<APIGatewayProxyResultV2> {
  const body = parseBody(event.body);
  if (!body) {
    return error('VALIDATION_ERROR', 'Invalid or missing request body', requestId);
  }

  // Find the existing record
  const existing = await findRecordById(vehicleId, recordId);
  if (!existing) {
    return error('NOT_FOUND', 'Maintenance record not found', requestId);
  }

  // Validate types if provided
  const typeChecks: Record<string, 'string' | 'number' | 'boolean'> = {};
  if (body.datePerformed !== undefined) typeChecks.datePerformed = 'string';
  if (body.odometerAtService !== undefined) typeChecks.odometerAtService = 'number';
  if (body.cost !== undefined) typeChecks.cost = 'number';

  if (Object.keys(typeChecks).length > 0) {
    const typeErrors = validateTypes(body, typeChecks);
    if (typeErrors.length > 0) {
      return error('VALIDATION_ERROR', typeErrors.map(e => e.message).join('; '), requestId);
    }
  }

  // Validate ranges if provided
  const rangeChecks: Record<string, { min?: number }> = {};
  if (body.odometerAtService !== undefined) rangeChecks.odometerAtService = { min: 0 };
  if (body.cost !== undefined) rangeChecks.cost = { min: 0 };

  if (Object.keys(rangeChecks).length > 0) {
    const rangeErrors = validateRange(body, rangeChecks);
    if (rangeErrors.length > 0) {
      return error('VALIDATION_ERROR', rangeErrors.map(e => e.message).join('; '), requestId);
    }
  }

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

  // If the date changed, delete the old item (sort key changed)
  if (oldSortKey !== newSortKey) {
    await docClient.send(new DeleteCommand({
      TableName: tableName,
      Key: { vehicleId, serviceDateId: oldSortKey },
    }));
  }

  const updated: MaintenanceRecord = {
    ...existing,
    ...(body.schemaId !== undefined && { schemaId: body.schemaId as string }),
    ...(schemaName !== undefined && { schemaName }),
    ...(body.customTypeName !== undefined && { customTypeName: body.customTypeName as string }),
    datePerformed: updatedDate,
    odometerAtService: (body.odometerAtService as number) ?? existing.odometerAtService,
    cost: (body.cost as number) ?? existing.cost,
    ...(body.location !== undefined && { location: body.location as string }),
    ...(body.notes !== undefined && { notes: body.notes as string }),
    ...(body.receiptPhotoKey !== undefined && { receiptPhotoKey: body.receiptPhotoKey as string }),
    updatedAt: now,
  };

  await docClient.send(new PutCommand({
    TableName: tableName,
    Item: {
      ...updated,
      serviceDateId: newSortKey,
      GSI1PK: userId,
      GSI1SK: updatedDate,
    },
  }));

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
 * GET /v1/vehicles/{vehicleId}/reminders — Get upcoming maintenance reminders.
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
