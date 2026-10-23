import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { GetCommand, QueryCommand, BatchWriteCommand, DeleteCommand } from '@aws-sdk/lib-dynamodb';
import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { ulid } from 'ulid';
import { getUserId } from '../lib/auth.js';
import { getDocClient, getTableName } from '../lib/dynamo.js';
import { getUserEmail, getSharedPermission } from '../lib/authSharing.js';
import { createLogger } from '../lib/logger.js';
import { success, error } from '../lib/response.js';
import { parseFuelupsCsv, parseMaintenanceCsv } from '../lib/csv-parser.js';
import { recalculateAllMetrics } from '../lib/metrics.js';
import { isOwnCsvImportKey } from '../lib/s3.js';
import { validate } from '../lib/contract.js';
import { parseBody } from '../lib/validation.js';
import { ImportRequest } from '@pawsitivemileage/contracts';
import type { Fillup } from '../types/fillup.js';
import { canonicalFillups, fillupSortKey } from '../lib/fillupKeys.js';

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

/** Same limit as uploads (PresignRequest.fileSize), checked again here before reading the file */
export const MAX_IMPORT_BYTES = 10 * 1024 * 1024;

/**
 * Read an uploaded CSV, refusing one over MAX_IMPORT_BYTES before its body is read into memory.
 * Returns the text, or the error response to send.
 */
async function downloadCsv(
  bucket: string,
  key: string,
  requestId: string,
): Promise<{ content: string } | { response: APIGatewayProxyResultV2 }> {
  try {
    const object = await getS3Client().send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    if (object.ContentLength === undefined || object.ContentLength > MAX_IMPORT_BYTES) {
      (object.Body as { destroy?: () => void } | undefined)?.destroy?.();
      return { response: error('VALIDATION_ERROR', 'CSV file exceeds maximum of 10 MB', requestId) };
    }
    return { content: await object.Body!.transformToString('utf-8') };
  } catch (err: unknown) {
    const code = (err as { name?: string }).name;
    if (code === 'NoSuchKey' || code === 'AccessDenied') {
      return { response: error('NOT_FOUND', 'CSV file not found', requestId) };
    }
    throw err;
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
  ownerUserId: string,
  requestId: string,
  userId: string,
): Promise<APIGatewayProxyResultV2> {
  const docClient = getDocClient();
  const fillupsTable = getTableName('FILLUPS_TABLE');
  const photosBucket = process.env.PHOTOS_BUCKET;
  if (!photosBucket) {
    return error('INTERNAL_ERROR', 'An internal error occurred', requestId);
  }

  // 1. Download CSV from S3 (at most 10 MB)
  const download = await downloadCsv(photosBucket, s3Key, requestId);
  if ('response' in download) return download.response;
  const csvContent = download.content;

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
      userId: ownerUserId,
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
      GSI1PK: ownerUserId,
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
  ownerUserId: string,
  requestId: string,
  userId: string,
): Promise<APIGatewayProxyResultV2> {
  const docClient = getDocClient();
  const maintenanceTable = getTableName('MAINTENANCE_TABLE');
  const photosBucket = process.env.PHOTOS_BUCKET;
  if (!photosBucket) {
    return error('INTERNAL_ERROR', 'An internal error occurred', requestId);
  }

  // 1. Download CSV from S3 (at most 10 MB)
  const download = await downloadCsv(photosBucket, s3Key, requestId);
  if ('response' in download) return download.response;
  const csvContent = download.content;

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
      userId: ownerUserId,
      customTypeName: record.customTypeName,
      datePerformed: record.datePerformed,
      odometerAtService: record.odometerAtService,
      cost: record.cost,
      createdAt: now,
      updatedAt: now,
      GSI1PK: ownerUserId,
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

  // 2. One item per fill-up in date order; stale copies under an old key are collected
  const { fillups: canonical, staleKeys } = canonicalFillups(fillups as Array<Fillup & { fillupDateId?: string }>);

  // 3. Recalculate all derived metrics
  const updated = recalculateAllMetrics(canonical);

  // 4. Write all updated fillups back to DynamoDB in batches of 25, each under its date key
  for (let i = 0; i < updated.length; i += 25) {
    const batch = updated.slice(i, i + 25);
    const requestItems = batch.map(item => ({
      PutRequest: { Item: { ...item, fillupDateId: fillupSortKey(item) } as unknown as Record<string, unknown> },
    }));
    await batchWriteWithRetry(docClient, fillupsTable, requestItems);
  }

  // 5. Remove stale copies, so a fill-up is never stored (and listed) twice
  const written = new Set(updated.map(fillupSortKey));
  for (const key of staleKeys.filter((k) => !written.has(k))) {
    await docClient.send(new DeleteCommand({ TableName: fillupsTable, Key: { vehicleId, fillupDateId: key } }));
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
    // Verify vehicle ownership or shared access before any operation.
    // Imported records are attributed to the vehicle owner, even when a shared user runs the import.
    let ownerUserId = userId;
    const ownershipValid = await verifyVehicleOwnership(userId, vehicleId);
    if (!ownershipValid) {
      // Check shared access — only 'full' permission allows import/recalculate
      const email = await getUserEmail(userId);
      if (!email) {
        return error('NOT_FOUND', 'Vehicle not found', requestId);
      }
      const shared = await getSharedPermission(email, vehicleId);
      if (!shared || shared.permission !== 'full') {
        return error('NOT_FOUND', 'Vehicle not found', requestId);
      }
      ownerUserId = shared.ownerUserId;
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

    const body = parseBody(event.body);
    if (!body) {
      return error('VALIDATION_ERROR', 'Invalid or missing request body', requestId);
    }

    // Validate against the API contract (#18): s3Key (non-empty string)
    const valid = validate(ImportRequest, body);
    if (!valid.ok) {
      return error('VALIDATION_ERROR', valid.message, requestId);
    }
    const { s3Key } = valid.data;

    // Only allow importing a CSV uploaded for this vehicle — presignUrl stores it under the
    // vehicle owner's ID — so one user can't read another user's uploads by passing an arbitrary key.
    if (!isOwnCsvImportKey(s3Key, ownerUserId, vehicleId)) {
      return error('FORBIDDEN', 'You do not have permission to import this file', requestId);
    }

    logger.info(`Import ${importType} requested`, requestId, userId);

    if (importType === 'fuelups') {
      return await importFuelups(s3Key, vehicleId, ownerUserId, requestId, userId);
    }

    return await importMaintenance(s3Key, vehicleId, ownerUserId, requestId, userId);
  } catch (err) {
    logger.error('Unhandled error in importData', requestId, userId, err);
    return error('INTERNAL_ERROR', 'An internal error occurred', requestId);
  }
};
