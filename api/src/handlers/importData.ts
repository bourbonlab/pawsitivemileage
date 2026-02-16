import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { GetCommand, QueryCommand, BatchWriteCommand } from '@aws-sdk/lib-dynamodb';
import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { ulid } from 'ulid';
import { getUserId } from '../lib/auth.js';
import { getDocClient, getTableName } from '../lib/dynamo.js';
import { createLogger } from '../lib/logger.js';
import { success, error } from '../lib/response.js';
import { parseFuelupsCsv, parseMaintenanceCsv } from '../lib/csv-parser.js';
import { recalculateAllMetrics } from '../lib/metrics.js';
import type { Fillup } from '../types/fillup.js';

const logger = createLogger('importData');

let s3Client: S3Client | null = null;
function getS3Client(): S3Client {
  if (!s3Client) s3Client = new S3Client({});
  return s3Client;
}

interface ImportResult {
  totalRows: number;
  imported: number;
  skipped: number;
  duplicates: number;
  errors: string[];
}

interface RecalculateResult {
  recalculatedCount: number;
}

async function verifyVehicleOwnership(userId: string, vehicleId: string): Promise<boolean> {
  const docClient = getDocClient();
  const tableName = getTableName('VEHICLES_TABLE');

  const result = await docClient.send(new GetCommand({
    TableName: tableName,
    Key: { userId, vehicleId },
    ProjectionExpression: 'vehicleId',
  }));

  return !!result.Item;
}

function parseBody(event: APIGatewayProxyEventV2): Record<string, unknown> | null {
  if (!event.body) return null;
  try {
    return JSON.parse(event.body) as Record<string, unknown>;
  } catch {
    return null;
  }
}

async function batchWriteWithRetry(
  docClient: ReturnType<typeof getDocClient>,
  tableName: string,
  items: Array<{ PutRequest: { Item: Record<string, unknown> } }>,
): Promise<void> {
  let unprocessed: typeof items | undefined = items;
  while (unprocessed && unprocessed.length > 0) {
    const response = await docClient.send(new BatchWriteCommand({
      RequestItems: { [tableName]: unprocessed },
    }));
    const remaining = response.UnprocessedItems?.[tableName] as typeof items | undefined;
    unprocessed = remaining && remaining.length > 0 ? remaining : undefined;
  }
}

async function importFuelups(
  s3Key: string,
  vehicleId: string,
  userId: string,
  requestId: string,
): Promise<APIGatewayProxyResultV2> {
  const docClient = getDocClient();
  const fillupsTable = getTableName('FILLUPS_TABLE');
  const photosBucket = process.env.PHOTOS_BUCKET;
  if (!photosBucket) {
    return error('INTERNAL_ERROR', 'An internal error occurred', requestId);
  }

  // 1. Download CSV from S3
  let csvContent: string;
  try {
    const response = await getS3Client().send(new GetObjectCommand({
      Bucket: photosBucket,
      Key: s3Key,
    }));
    csvContent = await response.Body!.transformToString('utf-8');
  } catch (err: unknown) {
    const code = (err as { name?: string }).name;
    if (code === 'NoSuchKey' || code === 'AccessDenied') {
      return error('NOT_FOUND', 'CSV file not found', requestId);
    }
    throw err;
  }

  // 2. Parse CSV
  const parseResult = parseFuelupsCsv(csvContent);
  if (parseResult.records.length === 0 && parseResult.totalRows > 0) {
    return error('VALIDATION_ERROR', 'No valid records found in CSV', requestId);
  }
  if (parseResult.totalRows === 0) {
    return error('VALIDATION_ERROR', 'No valid records found in CSV', requestId);
  }

  // 3. Sort by date ascending
  const sorted = [...parseResult.records].sort((a, b) => a.date.localeCompare(b.date));

  // 4. Build DynamoDB items — no duplicate filtering (multiple entries per day are allowed)
  const now = new Date().toISOString();
  const itemsToWrite: Record<string, unknown>[] = [];

  for (const record of sorted) {
    const fillupId = ulid();
    const item: Record<string, unknown> = {
      vehicleId,
      fillupId,
      fillupDateId: `${record.date}#${fillupId}`,
      userId,
      date: record.date,
      currencySpent: record.currencySpent,
      gallonsAdded: record.gallonsAdded,
      odometerReading: record.odometerReading,
      isPartialFill: record.isPartialFill,
      isBusiness: false,
      pricePerGallon: null,
      milesSinceLastFillup: null,
      mpg: null,
      costPerMile: null,
      daysSinceLastFillup: null,
      createdAt: now,
      updatedAt: now,
      GSI1PK: userId,
      GSI1SK: record.date,
      GSI2PK: 'FILLUPS',
      GSI2SK: record.date,
    };

    // Optional fields
    if (record.locationLat !== undefined) item.locationLat = record.locationLat;
    if (record.locationLng !== undefined) item.locationLng = record.locationLng;
    if (record.notes !== undefined) item.notes = record.notes;

    itemsToWrite.push(item);
  }

  // 5. Batch write in chunks of 25
  const errors: string[] = [];
  for (let i = 0; i < itemsToWrite.length; i += 25) {
    const batch = itemsToWrite.slice(i, i + 25);
    const requestItems = batch.map(item => ({
      PutRequest: { Item: item },
    }));

    try {
      await batchWriteWithRetry(docClient, fillupsTable, requestItems);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Unknown batch write error';
      errors.push(`Batch starting at index ${i}: ${msg}`);
      logger.error(`Batch write failed at index ${i}`, requestId, userId, err);
    }
  }

  const imported = itemsToWrite.length - errors.length;
  const result: ImportResult = {
    totalRows: parseResult.totalRows,
    imported,
    skipped: parseResult.skipped.length,
    duplicates: 0,
    errors,
  };

  logger.info(`Import fuelups complete: ${imported} imported, ${parseResult.skipped.length} skipped`, requestId, userId);
  return success(result, requestId);
}

async function importMaintenance(
  s3Key: string,
  vehicleId: string,
  userId: string,
  requestId: string,
): Promise<APIGatewayProxyResultV2> {
  const docClient = getDocClient();
  const maintenanceTable = getTableName('MAINTENANCE_TABLE');
  const photosBucket = process.env.PHOTOS_BUCKET;
  if (!photosBucket) {
    return error('INTERNAL_ERROR', 'An internal error occurred', requestId);
  }

  // 1. Download CSV from S3
  let csvContent: string;
  try {
    const response = await getS3Client().send(new GetObjectCommand({
      Bucket: photosBucket,
      Key: s3Key,
    }));
    csvContent = await response.Body!.transformToString('utf-8');
  } catch (err: unknown) {
    const code = (err as { name?: string }).name;
    if (code === 'NoSuchKey' || code === 'AccessDenied') {
      return error('NOT_FOUND', 'CSV file not found', requestId);
    }
    throw err;
  }

  // 2. Parse CSV
  const parseResult = parseMaintenanceCsv(csvContent);
  if (parseResult.records.length === 0 && parseResult.totalRows > 0) {
    return error('VALIDATION_ERROR', 'No valid records found in CSV', requestId);
  }
  if (parseResult.totalRows === 0) {
    return error('VALIDATION_ERROR', 'No valid records found in CSV', requestId);
  }

  // 3. Build DynamoDB items — no duplicate filtering (multiple entries per day are allowed)
  const now = new Date().toISOString();
  const itemsToWrite: Record<string, unknown>[] = [];

  for (const record of parseResult.records) {
    const recordId = ulid();
    const item: Record<string, unknown> = {
      vehicleId,
      recordId,
      serviceDateId: `${record.datePerformed}#${recordId}`,
      userId,
      customTypeName: record.customTypeName,
      datePerformed: record.datePerformed,
      odometerAtService: record.odometerAtService,
      cost: record.cost,
      createdAt: now,
      updatedAt: now,
      GSI1PK: userId,
      GSI1SK: record.datePerformed,
    };

    // Optional fields
    if (record.notes !== undefined) item.notes = record.notes;

    itemsToWrite.push(item);
  }

  // 4. Batch write in chunks of 25
  const errors: string[] = [];
  for (let i = 0; i < itemsToWrite.length; i += 25) {
    const batch = itemsToWrite.slice(i, i + 25);
    const requestItems = batch.map(item => ({
      PutRequest: { Item: item },
    }));

    try {
      await batchWriteWithRetry(docClient, maintenanceTable, requestItems);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Unknown batch write error';
      errors.push(`Batch starting at index ${i}: ${msg}`);
      logger.error(`Batch write failed at index ${i}`, requestId, userId, err);
    }
  }

  const imported = itemsToWrite.length - errors.length;
  const result: ImportResult = {
    totalRows: parseResult.totalRows,
    imported,
    skipped: parseResult.skipped.length,
    duplicates: 0,
    errors,
  };

  logger.info(`Import maintenance complete: ${imported} imported, ${parseResult.skipped.length} skipped`, requestId, userId);
  return success(result, requestId);
}

async function recalculate(
  vehicleId: string,
  userId: string,
  requestId: string,
): Promise<APIGatewayProxyResultV2> {
  const docClient = getDocClient();
  const fillupsTable = getTableName('FILLUPS_TABLE');

  // 1. Fetch all fillups for the vehicle, handling pagination
  const fillups: Fillup[] = [];
  let exclusiveStartKey: Record<string, unknown> | undefined;
  do {
    const result = await docClient.send(new QueryCommand({
      TableName: fillupsTable,
      KeyConditionExpression: 'vehicleId = :vid',
      ExpressionAttributeValues: { ':vid': vehicleId },
      ExclusiveStartKey: exclusiveStartKey,
    }));
    if (result.Items) {
      fillups.push(...(result.Items as Fillup[]));
    }
    exclusiveStartKey = result.LastEvaluatedKey;
  } while (exclusiveStartKey);

  if (fillups.length === 0) {
    return success({ recalculatedCount: 0 } satisfies RecalculateResult, requestId);
  }

  // 2. Sort by date ascending (explicit sort by date field for safety)
  fillups.sort((a, b) => a.date.localeCompare(b.date));

  // 3. Recalculate all derived metrics
  const updated = recalculateAllMetrics(fillups);

  // 4. Write all updated fillups back to DynamoDB in batches of 25
  for (let i = 0; i < updated.length; i += 25) {
    const batch = updated.slice(i, i + 25);
    const requestItems = batch.map(item => ({
      PutRequest: { Item: item as unknown as Record<string, unknown> },
    }));
    await batchWriteWithRetry(docClient, fillupsTable, requestItems);
  }

  logger.info(`Recalculate complete: ${updated.length} fillups recalculated`, requestId, userId);
  const result: RecalculateResult = { recalculatedCount: updated.length };
  return success(result, requestId);
}

export const handler = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
  const requestId = event.requestContext?.requestId ?? ulid();
  const userId = getUserId(event as Parameters<typeof getUserId>[0]);

  if (!userId) {
    return error('UNAUTHORIZED', 'Missing authentication', requestId);
  }

  const vehicleId = event.pathParameters?.vehicleId;
  const path = event.rawPath ?? '';

  if (!vehicleId) {
    return error('VALIDATION_ERROR', 'vehicleId is required', requestId);
  }

  try {
    // Verify vehicle ownership before any operation
    const ownershipValid = await verifyVehicleOwnership(userId, vehicleId);
    if (!ownershipValid) {
      return error('NOT_FOUND', 'Vehicle not found', requestId);
    }

    // POST /v1/vehicles/{vehicleId}/recalculate
    if (path.endsWith('/recalculate')) {
      logger.info('Recalculate metrics requested', requestId, userId);
      return await recalculate(vehicleId, userId, requestId);
    }

    // POST /v1/vehicles/{vehicleId}/import/{type}
    const importTypeMatch = path.match(/\/import\/([^/]+)$/);
    if (!importTypeMatch) {
      return error('VALIDATION_ERROR', 'Unsupported operation', requestId);
    }

    const importType = importTypeMatch[1];
    if (importType !== 'fuelups' && importType !== 'maintenance') {
      return error('VALIDATION_ERROR', "Import type must be 'fuelups' or 'maintenance'", requestId);
    }

    const body = parseBody(event);
    if (!body) {
      return error('VALIDATION_ERROR', 'Invalid or missing request body', requestId);
    }

    const s3Key = body.s3Key;
    if (!s3Key || typeof s3Key !== 'string') {
      return error('VALIDATION_ERROR', 's3Key is required', requestId);
    }

    logger.info(`Import ${importType} requested`, requestId, userId);

    if (importType === 'fuelups') {
      return await importFuelups(s3Key, vehicleId, userId, requestId);
    }

    return await importMaintenance(s3Key, vehicleId, userId, requestId);
  } catch (err) {
    logger.error('Unhandled error in importData', requestId, userId, err);
    return error('INTERNAL_ERROR', 'An internal error occurred', requestId);
  }
};
