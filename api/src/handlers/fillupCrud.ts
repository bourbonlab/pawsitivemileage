import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { PutCommand, QueryCommand, DeleteCommand } from '@aws-sdk/lib-dynamodb';
import { ulid } from 'ulid';
import { getDocClient, getTableName } from '../lib/dynamo.js';
import { getUserId } from '../lib/auth.js';
import { success, error } from '../lib/response.js';
import { InvalidCursorError, queryPage } from '../lib/pagination.js';
import { checkIfMatch } from '../lib/concurrency.js';
import { withIdempotency } from '../lib/idempotency.js';
import { parseBody } from '../lib/validation.js';
import { validate } from '../lib/contract.js';
import { FillupCreate, FillupUpdate, ListQuery } from '@pawsitivemileage/contracts';
import { createLogger } from '../lib/logger.js';
import { calculateDerivedMetrics, recalculateAllMetrics } from '../lib/metrics.js';
import { deleteObject, photoKeyFieldError } from '../lib/s3.js';
import { verifyAccess } from '../lib/authSharing.js';
import type { Fillup } from '../types/fillup.js';

const logger = createLogger('fillupCrud');

export const handler = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
  const requestId = event.requestContext?.requestId ?? ulid();
  const userId = getUserId(event as unknown as Parameters<typeof getUserId>[0]);

  if (!userId) {
    return error('UNAUTHORIZED', 'Missing authentication', requestId);
  }

  const method = event.requestContext?.http?.method;
  const vehicleId = event.pathParameters?.vehicleId;
  const fillupId = event.pathParameters?.fillupId;

  if (!vehicleId) {
    return error('VALIDATION_ERROR', 'vehicleId is required', requestId);
  }

  try {
    // Determine required operation based on HTTP method
    const isRead = method === 'GET';
    const requiredOperation = isRead ? 'read' as const : 'write-fuel' as const;

    // Verify ownership or shared access with appropriate permission
    const access = await verifyAccess(userId, vehicleId, requiredOperation);
    if (!access.allowed || !access.ownerUserId) {
      return error('FORBIDDEN', 'You do not have permission to perform this action', requestId);
    }
    const { ownerUserId } = access;

    if (method === 'GET' && !fillupId) {
      return await listFillups(event, vehicleId, requestId, userId);
    }
    if (method === 'GET' && fillupId) {
      return await getFillup(vehicleId, fillupId, requestId, userId);
    }
    if (method === 'POST') {
      return await withIdempotency(event, userId, requestId, () => createFillup(event, vehicleId, ownerUserId, requestId, userId));
    }
    if (method === 'PUT' && fillupId) {
      return await updateFillup(event, vehicleId, fillupId, ownerUserId, requestId, userId);
    }
    if (method === 'DELETE' && fillupId) {
      return await deleteFillup(vehicleId, fillupId, ownerUserId, requestId, userId);
    }

    return error('VALIDATION_ERROR', 'Unsupported operation', requestId);
  } catch (err) {
    logger.error('Unhandled error in fillupCrud', requestId, userId, err);
    return error('INTERNAL_ERROR', 'An internal error occurred', requestId);
  }
};


/**
 * GET /v1/vehicles/{vehicleId}/fillups — List all fillups for a vehicle, sorted by date.
 */
async function listFillups(
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

  logger.info('Listing fillups', requestId, userId);

  try {
    const page = await queryPage(
      {
        TableName: getTableName('FILLUPS_TABLE'),
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
 * GET /v1/vehicles/{vehicleId}/fillups/{fillupId} — Get a single fillup detail.
 */
async function getFillup(
  vehicleId: string,
  fillupId: string,
  requestId: string,
  userId: string,
): Promise<APIGatewayProxyResultV2> {
  const docClient = getDocClient();
  const tableName = getTableName('FILLUPS_TABLE');

  logger.info(`Getting fillup ${fillupId}`, requestId, userId);

  // Query by vehicleId and filter for the fillupId since the SK is composite
  const result = await docClient.send(new QueryCommand({
    TableName: tableName,
    KeyConditionExpression: 'vehicleId = :vid',
    FilterExpression: 'fillupId = :fid',
    ExpressionAttributeValues: { ':vid': vehicleId, ':fid': fillupId },
  }));

  const fillup = result.Items?.[0];
  if (!fillup) {
    return error('NOT_FOUND', 'Fillup not found', requestId);
  }

  return success(fillup, requestId);
}


/**
 * POST /v1/vehicles/{vehicleId}/fillups — Create a new fillup with derived metrics.
 * The fillup is attributed to the vehicle owner, even when created by a shared user.
 */
async function createFillup(
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

  // Validate against the API contract (#18): required fields, types, ranges, lengths, coordinates
  const valid = validate(FillupCreate, body);
  if (!valid.ok) {
    return error('VALIDATION_ERROR', valid.message, requestId);
  }

  const receiptKeyError = photoKeyFieldError('receiptPhotoKey', body.receiptPhotoKey, undefined, ownerUserId, vehicleId, 'receipt-photo');
  if (receiptKeyError) {
    return error('VALIDATION_ERROR', receiptKeyError, requestId);
  }

  const date = body.date as string;
  const currencySpent = body.currencySpent as number;
  const gallonsAdded = body.gallonsAdded as number;
  const odometerReading = body.odometerReading as number;
  const isPartialFill = (body.isPartialFill as boolean) ?? false;
  const isBusiness = (body.isBusiness as boolean) ?? false;

  // Fetch existing fillups to check odometer monotonicity and calculate metrics
  const existingFillups = await fetchAllFillups(vehicleId);

  // Enforce odometer monotonicity (Req 3.9, Property 4)
  const previousFillup = existingFillups.length > 0
    ? existingFillups[existingFillups.length - 1]
    : null;

  if (previousFillup && odometerReading <= previousFillup.odometerReading) {
    return error(
      'VALIDATION_ERROR',
      `Odometer reading must be greater than the previous reading of ${previousFillup.odometerReading}`,
      requestId,
    );
  }

  // Calculate accumulated gallons/miles from trailing partial fills
  let accumulatedGallons = 0;
  let accumulatedMiles = 0;
  for (let i = existingFillups.length - 1; i >= 0; i--) {
    if (!existingFillups[i].isPartialFill) break;
    accumulatedGallons += existingFillups[i].gallonsAdded;
    if (i > 0) {
      accumulatedMiles += existingFillups[i].odometerReading - existingFillups[i - 1].odometerReading;
    }
  }

  const metrics = calculateDerivedMetrics(
    { date, currencySpent, gallonsAdded, odometerReading, isPartialFill },
    previousFillup ? {
      date: previousFillup.date,
      currencySpent: previousFillup.currencySpent,
      gallonsAdded: previousFillup.gallonsAdded,
      odometerReading: previousFillup.odometerReading,
      isPartialFill: previousFillup.isPartialFill,
    } : null,
    accumulatedGallons,
    accumulatedMiles,
  );

  const now = new Date().toISOString();
  const fillupId = ulid();
  const sortKey = `${date}#${fillupId}`;

  const fillup: Fillup = {
    vehicleId,
    fillupId,
    userId: ownerUserId,
    date,
    currencySpent,
    gallonsAdded,
    odometerReading,
    isPartialFill,
    isBusiness,
    pricePerGallon: metrics.pricePerGallon,
    milesSinceLastFillup: metrics.milesSinceLastFillup,
    mpg: metrics.mpg,
    costPerMile: metrics.costPerMile,
    daysSinceLastFillup: metrics.daysSinceLastFillup,
    ...(body.locationLat !== undefined && { locationLat: body.locationLat as number }),
    ...(body.locationLng !== undefined && { locationLng: body.locationLng as number }),
    ...(body.stationName !== undefined && { stationName: body.stationName as string }),
    ...(body.address !== undefined && { address: body.address as string }),
    ...(body.receiptPhotoKey !== undefined && { receiptPhotoKey: body.receiptPhotoKey as string }),
    ...(body.notes !== undefined && { notes: body.notes as string }),
    createdAt: now,
    updatedAt: now,
  };

  const docClient = getDocClient();
  const tableName = getTableName('FILLUPS_TABLE');

  await docClient.send(new PutCommand({
    TableName: tableName,
    Item: {
      ...fillup,
      fillupDateId: sortKey,
      GSI1PK: ownerUserId,
      GSI1SK: date,
      GSI2PK: 'FILLUPS',
      GSI2SK: date,
    },
  }));

  logger.info(`Created fillup ${fillupId}`, requestId, userId);
  return success(fillup, requestId, 201);
}


/**
 * PUT /v1/vehicles/{vehicleId}/fillups/{fillupId} — Update a fillup and recalculate all metrics.
 */
async function updateFillup(
  event: APIGatewayProxyEventV2,
  vehicleId: string,
  fillupId: string,
  ownerUserId: string,
  requestId: string,
  userId: string,
): Promise<APIGatewayProxyResultV2> {
  const body = parseBody(event.body);
  if (!body) {
    return error('VALIDATION_ERROR', 'Invalid or missing request body', requestId);
  }

  // Validate against the API contract (#18) before touching the database
  const valid = validate(FillupUpdate, body);
  if (!valid.ok) {
    return error('VALIDATION_ERROR', valid.message, requestId);
  }

  const docClient = getDocClient();
  const tableName = getTableName('FILLUPS_TABLE');

  // Find the existing fillup
  const existing = await findFillupById(vehicleId, fillupId);
  if (!existing) {
    return error('NOT_FOUND', 'Fillup not found', requestId);
  }

  // If-Match (#25). Checked right after the read: the batch rewrite below can't be conditional
  const stale = checkIfMatch(event, existing.updatedAt, requestId);
  if (stale) return stale;

  const receiptKeyError = photoKeyFieldError('receiptPhotoKey', body.receiptPhotoKey, existing.receiptPhotoKey, ownerUserId, vehicleId, 'receipt-photo');
  if (receiptKeyError) {
    return error('VALIDATION_ERROR', receiptKeyError, requestId);
  }

  // Merge updates onto existing values
  const updatedDate = (body.date as string) ?? existing.date;
  const updatedCurrencySpent = (body.currencySpent as number) ?? existing.currencySpent;
  const updatedGallonsAdded = (body.gallonsAdded as number) ?? existing.gallonsAdded;
  const updatedOdometerReading = (body.odometerReading as number) ?? existing.odometerReading;
  const updatedIsPartialFill = body.isPartialFill !== undefined
    ? (body.isPartialFill as boolean)
    : existing.isPartialFill;
  const updatedIsBusiness = body.isBusiness !== undefined
    ? (body.isBusiness as boolean)
    : existing.isBusiness;

  const now = new Date().toISOString();
  const oldSortKey = `${existing.date}#${fillupId}`;
  const newSortKey = `${updatedDate}#${fillupId}`;

  // If the date changed, we need to delete the old item and insert a new one
  // Otherwise, we can update in place
  const updatedFillup: Fillup = {
    ...existing,
    date: updatedDate,
    currencySpent: updatedCurrencySpent,
    gallonsAdded: updatedGallonsAdded,
    odometerReading: updatedOdometerReading,
    isPartialFill: updatedIsPartialFill,
    isBusiness: updatedIsBusiness,
    ...(body.locationLat !== undefined && { locationLat: body.locationLat as number }),
    ...(body.locationLng !== undefined && { locationLng: body.locationLng as number }),
    ...(body.stationName !== undefined && { stationName: body.stationName as string }),
    ...(body.address !== undefined && { address: body.address as string }),
    // receiptPhotoKey: null means "remove photo"; string means "set new photo"
    ...(body.receiptPhotoKey !== undefined && body.receiptPhotoKey !== null && { receiptPhotoKey: body.receiptPhotoKey as string }),
    ...(body.notes !== undefined && { notes: body.notes as string }),
    // Metrics will be recalculated below
    pricePerGallon: null,
    milesSinceLastFillup: null,
    mpg: null,
    costPerMile: null,
    daysSinceLastFillup: null,
    updatedAt: now,
  };

  // If receiptPhotoKey is explicitly null, remove the photo from S3 and strip the field
  if (body.receiptPhotoKey === null && existing.receiptPhotoKey) {
    const photosBucket = process.env.PHOTOS_BUCKET;
    if (photosBucket) {
      try {
        await deleteObject(photosBucket, existing.receiptPhotoKey);
        logger.info(`Deleted receipt photo ${existing.receiptPhotoKey} from S3`, requestId, userId);
      } catch (s3Err) {
        logger.error('Failed to delete receipt photo from S3', requestId, userId, s3Err);
        // Continue — don't fail the update if S3 delete fails
      }
    }
    delete (updatedFillup as unknown as Record<string, unknown>).receiptPhotoKey;
  }

  // Delete old item if sort key changed
  if (oldSortKey !== newSortKey) {
    await docClient.send(new DeleteCommand({
      TableName: tableName,
      Key: { vehicleId, fillupDateId: oldSortKey },
    }));
  }

  // Fetch all fillups, replace the updated one, sort, and recalculate (Req 3.6)
  const allFillups = await fetchAllFillups(vehicleId);
  const updatedList = allFillups
    .filter(f => f.fillupId !== fillupId)
    .concat(updatedFillup)
    .sort((a, b) => a.date.localeCompare(b.date) || a.fillupId.localeCompare(b.fillupId));

  const recalculated = recalculateAllMetrics(updatedList);

  // Write all recalculated fillups back to DynamoDB
  await writeAllFillups(recalculated, ownerUserId);

  const result = recalculated.find(f => f.fillupId === fillupId);
  logger.info(`Updated fillup ${fillupId}`, requestId, userId);
  return success(result, requestId);
}

/**
 * DELETE /v1/vehicles/{vehicleId}/fillups/{fillupId} — Delete a fillup and recalculate remaining metrics.
 */
async function deleteFillup(
  vehicleId: string,
  fillupId: string,
  ownerUserId: string,
  requestId: string,
  userId: string,
): Promise<APIGatewayProxyResultV2> {
  const docClient = getDocClient();
  const tableName = getTableName('FILLUPS_TABLE');

  // Find the existing fillup to get its sort key
  const existing = await findFillupById(vehicleId, fillupId);
  if (!existing) {
    return error('NOT_FOUND', 'Fillup not found', requestId);
  }

  const sortKey = `${existing.date}#${fillupId}`;

  // Delete the fillup
  await docClient.send(new DeleteCommand({
    TableName: tableName,
    Key: { vehicleId, fillupDateId: sortKey },
  }));

  // Fetch remaining fillups and recalculate all metrics (Req 3.6)
  const remainingFillups = await fetchAllFillups(vehicleId);
  if (remainingFillups.length > 0) {
    const recalculated = recalculateAllMetrics(remainingFillups);
    await writeAllFillups(recalculated, ownerUserId);
  }

  logger.info(`Deleted fillup ${fillupId}`, requestId, userId);
  return success({ deleted: true }, requestId);
}


/**
 * Fetch all fillups for a vehicle, sorted chronologically by the composite sort key.
 */
async function fetchAllFillups(vehicleId: string): Promise<Fillup[]> {
  const docClient = getDocClient();
  const tableName = getTableName('FILLUPS_TABLE');

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

    if (result.Items) {
      items.push(...result.Items);
    }
    exclusiveStartKey = result.LastEvaluatedKey;
  } while (exclusiveStartKey);

  return items as unknown as Fillup[];
}

/**
 * Find a single fillup by vehicleId and fillupId.
 * Queries the table and filters by fillupId since the sort key is composite.
 */
async function findFillupById(vehicleId: string, fillupId: string): Promise<Fillup | null> {
  const docClient = getDocClient();
  const tableName = getTableName('FILLUPS_TABLE');

  const result = await docClient.send(new QueryCommand({
    TableName: tableName,
    KeyConditionExpression: 'vehicleId = :vid',
    FilterExpression: 'fillupId = :fid',
    ExpressionAttributeValues: { ':vid': vehicleId, ':fid': fillupId },
  }));

  return (result.Items?.[0] as unknown as Fillup) ?? null;
}

/**
 * Write all fillups back to DynamoDB after recalculation.
 * Each fillup is written with its composite sort key and GSI attributes, attributed to the vehicle owner.
 */
async function writeAllFillups(fillups: Fillup[], ownerUserId: string): Promise<void> {
  const docClient = getDocClient();
  const tableName = getTableName('FILLUPS_TABLE');

  // Write each fillup individually — for small datasets this is fine.
  // For larger datasets, BatchWriteItem could be used.
  const writes = fillups.map(fillup =>
    docClient.send(new PutCommand({
      TableName: tableName,
      Item: {
        ...fillup,
        userId: ownerUserId,
        fillupDateId: `${fillup.date}#${fillup.fillupId}`,
        GSI1PK: ownerUserId,
        GSI1SK: fillup.date,
        GSI2PK: 'FILLUPS',
        GSI2SK: fillup.date,
      },
    })),
  );

  await Promise.all(writes);
}