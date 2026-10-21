import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { GetCommand, PutCommand, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { ulid } from 'ulid';
import { getDocClient, getTableName } from '../lib/dynamo.js';
import { getUserId } from '../lib/auth.js';
import { getUserEmail, getSharedPermission } from '../lib/authSharing.js';
import { success, error } from '../lib/response.js';
import { withIdempotency } from '../lib/idempotency.js';
import { parseBody } from '../lib/validation.js';
import { validate } from '../lib/contract.js';
import { VehicleArchive, VehicleCreate, VehicleUpdate } from '@pawsitivemileage/contracts';
import { createLogger } from '../lib/logger.js';
import { photoKeyFieldError } from '../lib/s3.js';
import type { Vehicle } from '../types/vehicle.js';

const logger = createLogger('vehicleCrud');

export const handler = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
  const requestId = event.requestContext?.requestId ?? ulid();
  const userId = getUserId(event as unknown as Parameters<typeof getUserId>[0]);

  if (!userId) {
    return error('UNAUTHORIZED', 'Missing authentication', requestId);
  }

  const method = event.requestContext?.http?.method;
  const path = event.rawPath ?? '';
  const vehicleId = event.pathParameters?.vehicleId;
  const isArchiveRoute = path.endsWith('/archive');

  try {
    // GET /v1/vehicles — list vehicles
    if (method === 'GET' && !vehicleId) {
      return await listVehicles(event, userId, requestId);
    }

    // POST /v1/vehicles — create vehicle
    if (method === 'POST' && !vehicleId) {
      return await withIdempotency(event, userId, requestId, () => createVehicle(event, userId, requestId));
    }

    // GET /v1/vehicles/{vehicleId} — get vehicle detail
    if (method === 'GET' && vehicleId && !isArchiveRoute) {
      return await getVehicle(userId, vehicleId, requestId);
    }

    // PUT /v1/vehicles/{vehicleId} — update vehicle
    if (method === 'PUT' && vehicleId) {
      return await updateVehicle(event, userId, vehicleId, requestId);
    }

    // PATCH /v1/vehicles/{vehicleId}/archive — archive/unarchive
    if (method === 'PATCH' && vehicleId && isArchiveRoute) {
      return await archiveVehicle(event, userId, vehicleId, requestId);
    }

    return error('VALIDATION_ERROR', 'Unsupported operation', requestId);
  } catch (err) {
    logger.error('Unhandled error in vehicleCrud', requestId, userId, err);
    return error('INTERNAL_ERROR', 'An internal error occurred', requestId);
  }
};


/**
 * GET /v1/vehicles
 * List vehicles for the authenticated user, filtered by status (active/archived).
 * Default: active vehicles only.
 */
async function listVehicles(
  event: APIGatewayProxyEventV2,
  userId: string,
  requestId: string,
): Promise<APIGatewayProxyResultV2> {
  const status = event.queryStringParameters?.status ?? 'active';

  if (status !== 'active' && status !== 'archived' && status !== 'all') {
    return error('VALIDATION_ERROR', 'status must be "active", "archived", or "all"', requestId);
  }

  logger.info(`Listing vehicles with status=${status}`, requestId, userId);

  const tableName = getTableName('VEHICLES_TABLE');
  const docClient = getDocClient();

  const result = await docClient.send(
    new QueryCommand({
      TableName: tableName,
      KeyConditionExpression: 'userId = :userId',
      ExpressionAttributeValues: { ':userId': userId },
    }),
  );

  let vehicles = (result.Items ?? []) as Vehicle[];

  if (status === 'active') {
    vehicles = vehicles.filter((v) => !v.isArchived);
  } else if (status === 'archived') {
    vehicles = vehicles.filter((v) => v.isArchived);
  }

  return success(vehicles, requestId);
}

/**
 * POST /v1/vehicles
 * Create a new vehicle. Required: nickname, make, model, year.
 */
async function createVehicle(
  event: APIGatewayProxyEventV2,
  userId: string,
  requestId: string,
): Promise<APIGatewayProxyResultV2> {
  const body = parseBody(event.body);
  if (!body) {
    return error('VALIDATION_ERROR', 'Invalid or missing request body', requestId);
  }

  // Validate against the API contract (#18): required fields, types, year/tankSize ranges, lengths
  const valid = validate(VehicleCreate, body);
  if (!valid.ok) {
    return error('VALIDATION_ERROR', valid.message, requestId);
  }

  // The vehicle doesn't exist yet, so accept any vehicle segment under the caller's own prefix
  const photoKeyError = photoKeyFieldError('photoKey', body.photoKey, undefined, userId, null, 'vehicle-photo');
  if (photoKeyError) {
    return error('VALIDATION_ERROR', photoKeyError, requestId);
  }

  const now = new Date().toISOString();
  const vehicleId = ulid();

  const vehicle: Vehicle = {
    userId,
    vehicleId,
    nickname: body.nickname as string,
    make: body.make as string,
    model: body.model as string,
    year: body.year as number,
    trim: body.trim as string | undefined,
    color: body.color as string | undefined,
    vin: body.vin as string | undefined,
    licensePlate: body.licensePlate as string | undefined,
    tankSize: body.tankSize as number | undefined,
    fuelType: body.fuelType as string | undefined,
    photoKey: body.photoKey as string | undefined,
    isArchived: false,
    createdAt: now,
    updatedAt: now,
  };

  const tableName = getTableName('VEHICLES_TABLE');
  const docClient = getDocClient();

  await docClient.send(
    new PutCommand({
      TableName: tableName,
      Item: {
        ...vehicle,
        GSI1PK: 'VEHICLES',
        GSI1SK: now,
      },
    }),
  );

  logger.info(`Created vehicle ${vehicleId}`, requestId, userId);
  return success(vehicle, requestId, 201);
}


/**
 * GET /v1/vehicles/{vehicleId}
 * Get a single vehicle by userId + vehicleId composite key.
 * Falls back to shared access if the caller doesn't own the vehicle.
 */
async function getVehicle(
  userId: string,
  vehicleId: string,
  requestId: string,
): Promise<APIGatewayProxyResultV2> {
  const tableName = getTableName('VEHICLES_TABLE');
  const docClient = getDocClient();

  // Try direct ownership first
  const result = await docClient.send(
    new GetCommand({
      TableName: tableName,
      Key: { userId, vehicleId },
    }),
  );

  if (result.Item) {
    logger.info(`Retrieved vehicle ${vehicleId}`, requestId, userId);
    return success(result.Item as Vehicle, requestId);
  }

  // Not the owner — check shared access
  const email = await getUserEmail(userId);
  if (email) {
    const sharedPermission = await getSharedPermission(email, vehicleId);
    if (sharedPermission) {
      // Find the owner's userId from the sharing table and fetch the vehicle
      const sharingTable = getTableName('SHARING_TABLE');
      const shareResult = await docClient.send(
        new QueryCommand({
          TableName: sharingTable,
          IndexName: 'GSI1',
          KeyConditionExpression: 'GSI1PK = :email AND GSI1SK = :vehicleId',
          ExpressionAttributeValues: {
            ':email': email,
            ':vehicleId': vehicleId,
          },
          Limit: 1,
        }),
      );

      const shareItem = shareResult.Items?.[0];
      if (shareItem?.ownerUserId) {
        const ownerResult = await docClient.send(
          new GetCommand({
            TableName: tableName,
            Key: { userId: shareItem.ownerUserId as string, vehicleId },
          }),
        );

        if (ownerResult.Item) {
          logger.info(`Retrieved shared vehicle ${vehicleId}`, requestId, userId);
          return success(ownerResult.Item as Vehicle, requestId);
        }
      }
    }
  }

  return error('NOT_FOUND', 'Vehicle not found', requestId);
}

/**
 * PUT /v1/vehicles/{vehicleId}
 * Update vehicle fields. Preserves userId, vehicleId, createdAt, and isArchived.
 */
async function updateVehicle(
  event: APIGatewayProxyEventV2,
  userId: string,
  vehicleId: string,
  requestId: string,
): Promise<APIGatewayProxyResultV2> {
  const body = parseBody(event.body);
  if (!body) {
    return error('VALIDATION_ERROR', 'Invalid or missing request body', requestId);
  }

  // Validate against the API contract (#18) before touching the database
  const valid = validate(VehicleUpdate, body);
  if (!valid.ok) {
    return error('VALIDATION_ERROR', valid.message, requestId);
  }

  // Verify vehicle exists and belongs to user
  const tableName = getTableName('VEHICLES_TABLE');
  const docClient = getDocClient();

  const existing = await docClient.send(
    new GetCommand({
      TableName: tableName,
      Key: { userId, vehicleId },
    }),
  );

  if (!existing.Item) {
    return error('NOT_FOUND', 'Vehicle not found', requestId);
  }

  const photoKeyError = photoKeyFieldError('photoKey', body.photoKey, existing.Item.photoKey as string | undefined, userId, vehicleId, 'vehicle-photo');
  if (photoKeyError) {
    return error('VALIDATION_ERROR', photoKeyError, requestId);
  }

  // Build update expression from allowed fields
  const allowedFields = [
    'nickname', 'make', 'model', 'year', 'trim', 'color',
    'vin', 'licensePlate', 'tankSize', 'fuelType', 'photoKey',
  ];

  const updates: string[] = [];
  const expressionNames: Record<string, string> = {};
  const expressionValues: Record<string, unknown> = {};

  for (const field of allowedFields) {
    if (body[field] !== undefined) {
      updates.push(`#${field} = :${field}`);
      expressionNames[`#${field}`] = field;
      expressionValues[`:${field}`] = body[field];
    }
  }

  if (updates.length === 0) {
    return error('VALIDATION_ERROR', 'No valid fields to update', requestId);
  }

  const now = new Date().toISOString();
  updates.push('#updatedAt = :updatedAt');
  expressionNames['#updatedAt'] = 'updatedAt';
  expressionValues[':updatedAt'] = now;

  const result = await docClient.send(
    new UpdateCommand({
      TableName: tableName,
      Key: { userId, vehicleId },
      UpdateExpression: `SET ${updates.join(', ')}`,
      ExpressionAttributeNames: expressionNames,
      ExpressionAttributeValues: expressionValues,
      ReturnValues: 'ALL_NEW',
    }),
  );

  logger.info(`Updated vehicle ${vehicleId}`, requestId, userId);
  return success(result.Attributes as Vehicle, requestId);
}

/**
 * PATCH /v1/vehicles/{vehicleId}/archive
 * Archive or unarchive a vehicle. Body: { "isArchived": true/false }
 * Does not delete associated fillup or maintenance data.
 */
async function archiveVehicle(
  event: APIGatewayProxyEventV2,
  userId: string,
  vehicleId: string,
  requestId: string,
): Promise<APIGatewayProxyResultV2> {
  const body = parseBody(event.body);
  // Validate against the API contract (#18): isArchived (boolean)
  const valid = validate(VehicleArchive, body ?? {});
  if (!valid.ok) {
    return error('VALIDATION_ERROR', valid.message, requestId);
  }

  const tableName = getTableName('VEHICLES_TABLE');
  const docClient = getDocClient();

  // Verify vehicle exists and belongs to user
  const existing = await docClient.send(
    new GetCommand({
      TableName: tableName,
      Key: { userId, vehicleId },
    }),
  );

  if (!existing.Item) {
    return error('NOT_FOUND', 'Vehicle not found', requestId);
  }

  const now = new Date().toISOString();

  const result = await docClient.send(
    new UpdateCommand({
      TableName: tableName,
      Key: { userId, vehicleId },
      UpdateExpression: 'SET #isArchived = :isArchived, #updatedAt = :updatedAt',
      ExpressionAttributeNames: {
        '#isArchived': 'isArchived',
        '#updatedAt': 'updatedAt',
      },
      ExpressionAttributeValues: {
        ':isArchived': valid.data.isArchived,
        ':updatedAt': now,
      },
      ReturnValues: 'ALL_NEW',
    }),
  );

  const action = valid.data.isArchived ? 'Archived' : 'Unarchived';
  logger.info(`${action} vehicle ${vehicleId}`, requestId, userId);
  return success(result.Attributes as Vehicle, requestId);
}
