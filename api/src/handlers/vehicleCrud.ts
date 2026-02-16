import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { GetCommand, PutCommand, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { ulid } from 'ulid';
import { getDocClient, getTableName } from '../lib/dynamo.js';
import { getUserId } from '../lib/auth.js';
import { success, error } from '../lib/response.js';
import { parseBody, validateRequired, validateTypes, validateRange, validateStringLength } from '../lib/validation.js';
import { createLogger } from '../lib/logger.js';
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
      return await createVehicle(event, userId, requestId);
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

  const requiredErrors = validateRequired(body, ['nickname', 'make', 'model', 'year']);
  if (requiredErrors.length > 0) {
    return error('VALIDATION_ERROR', requiredErrors.map((e) => e.message).join(', '), requestId);
  }

  const typeErrors = validateTypes(body, {
    nickname: 'string',
    make: 'string',
    model: 'string',
    year: 'number',
    trim: 'string',
    color: 'string',
    vin: 'string',
    licensePlate: 'string',
    tankSize: 'number',
    fuelType: 'string',
    photoKey: 'string',
  });
  if (typeErrors.length > 0) {
    return error('VALIDATION_ERROR', typeErrors.map((e) => e.message).join(', '), requestId);
  }

  const rangeErrors = validateRange(body, {
    year: { min: 1900, max: new Date().getFullYear() + 2 },
    tankSize: { min: 0.1 },
  });
  if (rangeErrors.length > 0) {
    return error('VALIDATION_ERROR', rangeErrors.map((e) => e.message).join(', '), requestId);
  }

  // Validate string field lengths (Req 3.4)
  const lengthErrors = validateStringLength(body, {
    make: 100,
    model: 100,
    trim: 100,
    color: 50,
    vin: 17,
    licensePlate: 20,
    notes: 1000,
  });
  if (lengthErrors.length > 0) {
    return error('VALIDATION_ERROR', lengthErrors.map((e) => e.message).join(', '), requestId);
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
 */
async function getVehicle(
  userId: string,
  vehicleId: string,
  requestId: string,
): Promise<APIGatewayProxyResultV2> {
  const tableName = getTableName('VEHICLES_TABLE');
  const docClient = getDocClient();

  const result = await docClient.send(
    new GetCommand({
      TableName: tableName,
      Key: { userId, vehicleId },
    }),
  );

  if (!result.Item) {
    return error('NOT_FOUND', 'Vehicle not found', requestId);
  }

  logger.info(`Retrieved vehicle ${vehicleId}`, requestId, userId);
  return success(result.Item as Vehicle, requestId);
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

  // Validate types for any provided fields
  const typeErrors = validateTypes(body, {
    nickname: 'string',
    make: 'string',
    model: 'string',
    year: 'number',
    trim: 'string',
    color: 'string',
    vin: 'string',
    licensePlate: 'string',
    tankSize: 'number',
    fuelType: 'string',
    photoKey: 'string',
  });
  if (typeErrors.length > 0) {
    return error('VALIDATION_ERROR', typeErrors.map((e) => e.message).join(', '), requestId);
  }

  if (body.year !== undefined) {
    const rangeErrors = validateRange(body, {
      year: { min: 1900, max: new Date().getFullYear() + 2 },
    });
    if (rangeErrors.length > 0) {
      return error('VALIDATION_ERROR', rangeErrors.map((e) => e.message).join(', '), requestId);
    }
  }

  if (body.tankSize !== undefined) {
    const rangeErrors = validateRange(body, {
      tankSize: { min: 0.1 },
    });
    if (rangeErrors.length > 0) {
      return error('VALIDATION_ERROR', rangeErrors.map((e) => e.message).join(', '), requestId);
    }
  }

  // Validate string field lengths (Req 3.4)
  const lengthErrors = validateStringLength(body, {
    make: 100,
    model: 100,
    trim: 100,
    color: 50,
    vin: 17,
    licensePlate: 20,
    notes: 1000,
  });
  if (lengthErrors.length > 0) {
    return error('VALIDATION_ERROR', lengthErrors.map((e) => e.message).join(', '), requestId);
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
  if (!body || typeof body.isArchived !== 'boolean') {
    return error('VALIDATION_ERROR', 'Request body must contain isArchived (boolean)', requestId);
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
        ':isArchived': body.isArchived,
        ':updatedAt': now,
      },
      ReturnValues: 'ALL_NEW',
    }),
  );

  const action = body.isArchived ? 'Archived' : 'Unarchived';
  logger.info(`${action} vehicle ${vehicleId}`, requestId, userId);
  return success(result.Attributes as Vehicle, requestId);
}
