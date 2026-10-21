import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { BatchGetCommand, GetCommand, PutCommand, QueryCommand, DeleteCommand } from '@aws-sdk/lib-dynamodb';
import { ulid } from 'ulid';
import { getDocClient, getTableName } from '../lib/dynamo.js';
import { getUserId } from '../lib/auth.js';
import { getUserEmail } from '../lib/authSharing.js';
import { success, error } from '../lib/response.js';
import { withIdempotency } from '../lib/idempotency.js';
import { parseBody } from '../lib/validation.js';
import { validate } from '../lib/contract.js';
import { ShareCreate } from '@pawsitivemileage/contracts';
import { createLogger } from '../lib/logger.js';
import type { ShareRecord, SharePermission, SharedVehicle } from '../types/sharing.js';

const logger = createLogger('sharingCrud');


export const handler = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
  const requestId = event.requestContext?.requestId ?? ulid();
  const userId = getUserId(event as unknown as Parameters<typeof getUserId>[0]);

  if (!userId) {
    return error('UNAUTHORIZED', 'Missing authentication', requestId);
  }

  try {
    const method = event.requestContext?.http?.method;
    const path = event.rawPath ?? '';
    const vehicleId = event.pathParameters?.vehicleId;

    // GET /v1/vehicles/shared — list vehicles shared with current user
    // Must be matched BEFORE vehicleId-based routes since "shared" could be mistaken for a vehicleId
    if (method === 'GET' && path === '/v1/vehicles/shared') {
      return await listSharedVehicles(userId, requestId);
    }

    // POST /v1/vehicles/{vehicleId}/sharing — create or update a share
    if (method === 'POST' && vehicleId && path.endsWith('/sharing')) {
      return await withIdempotency(event, userId, requestId, () => createOrUpdateShare(event, userId, vehicleId, requestId));
    }

    // GET /v1/vehicles/{vehicleId}/sharing — list shares for a vehicle (owner only)
    if (method === 'GET' && vehicleId && path.endsWith('/sharing')) {
      return await listVehicleShares(userId, vehicleId, requestId);
    }

    // DELETE /v1/vehicles/{vehicleId}/sharing/{shareId} — revoke a share
    const shareId = event.pathParameters?.shareId;
    if (method === 'DELETE' && vehicleId && shareId) {
      return await deleteShare(userId, vehicleId, shareId, requestId);
    }

    return error('VALIDATION_ERROR', 'Unsupported operation', requestId);
  } catch (err) {
    logger.error('Unhandled error in sharingCrud', requestId, userId, err);
    return error('INTERNAL_ERROR', 'An internal error occurred', requestId);
  }
};


/**
 * Verify that the vehicle belongs to the authenticated user.
 */
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

/**
 * GET /v1/vehicles/shared
 * List all vehicles shared with the current user.
 * Looks up the caller's email, queries GSI1 for share records,
 * batch-fetches vehicles, filters out archived ones, and attaches owner display names.
 */
async function listSharedVehicles(
  userId: string,
  requestId: string,
): Promise<APIGatewayProxyResultV2> {
  const email = await getUserEmail(userId);
  if (!email) {
    // User has no email in the Users table — no shares possible
    return success([], requestId);
  }

  const docClient = getDocClient();
  const sharingTable = getTableName('SHARING_TABLE');

  // Query GSI1 for all share records where this email is the shared user
  const sharesResult = await docClient.send(new QueryCommand({
    TableName: sharingTable,
    IndexName: 'GSI1',
    KeyConditionExpression: 'GSI1PK = :email',
    ExpressionAttributeValues: {
      ':email': email,
    },
  }));

  const shareItems = sharesResult.Items ?? [];
  if (shareItems.length === 0) {
    return success([], requestId);
  }

  // Batch-get vehicles from the Vehicles table
  // Each share has ownerUserId + vehicleId — those are the PK/SK of the Vehicles table
  const vehiclesTable = getTableName('VEHICLES_TABLE');
  const vehicleKeys = shareItems.map(item => ({
    userId: item.ownerUserId as string,
    vehicleId: item.vehicleId as string,
  }));

  // BatchGetCommand supports up to 100 keys per request
  const BATCH_SIZE = 100;
  const vehicleMap = new Map<string, Record<string, unknown>>();

  for (let i = 0; i < vehicleKeys.length; i += BATCH_SIZE) {
    const batch = vehicleKeys.slice(i, i + BATCH_SIZE);
    const batchResult = await docClient.send(new BatchGetCommand({
      RequestItems: {
        [vehiclesTable]: {
          Keys: batch,
          ProjectionExpression: 'vehicleId, userId, nickname, make, model, #yr, photoKey, isArchived',
          ExpressionAttributeNames: { '#yr': 'year' },
        },
      },
    }));

    const responses = batchResult.Responses?.[vehiclesTable] ?? [];
    for (const vehicle of responses) {
      vehicleMap.set(vehicle.vehicleId as string, vehicle);
    }
  }

  // Collect unique owner userIds for display name lookup
  const ownerIds = new Set<string>();
  for (const item of shareItems) {
    const vehicle = vehicleMap.get(item.vehicleId as string);
    if (vehicle && !vehicle.isArchived) {
      ownerIds.add(item.ownerUserId as string);
    }
  }

  // Batch-get owner display names from Users table
  const usersTable = getTableName('USERS_TABLE');
  const ownerNameMap = new Map<string, string>();

  if (ownerIds.size > 0) {
    const ownerKeys = Array.from(ownerIds).map(id => ({ userId: id }));

    for (let i = 0; i < ownerKeys.length; i += BATCH_SIZE) {
      const batch = ownerKeys.slice(i, i + BATCH_SIZE);
      const batchResult = await docClient.send(new BatchGetCommand({
        RequestItems: {
          [usersTable]: {
            Keys: batch,
            ProjectionExpression: 'userId, displayName',
          },
        },
      }));

      const responses = batchResult.Responses?.[usersTable] ?? [];
      for (const user of responses) {
        ownerNameMap.set(user.userId as string, (user.displayName as string) ?? 'Unknown');
      }
    }
  }

  // Build the SharedVehicle response array
  const sharedVehicles: SharedVehicle[] = [];

  for (const item of shareItems) {
    const vehicle = vehicleMap.get(item.vehicleId as string);

    // Skip if vehicle not found or is archived
    if (!vehicle || vehicle.isArchived) {
      continue;
    }

    sharedVehicles.push({
      vehicle: {
        vehicleId: vehicle.vehicleId as string,
        nickname: vehicle.nickname as string,
        make: vehicle.make as string,
        model: vehicle.model as string,
        year: vehicle.year as number,
        ...(vehicle.photoKey ? { photoKey: vehicle.photoKey as string } : {}),
      },
      ownerDisplayName: ownerNameMap.get(item.ownerUserId as string) ?? 'Unknown',
      permission: item.permission as SharePermission,
      shareId: item.shareId as string,
    });
  }

  logger.info(`Found ${sharedVehicles.length} shared vehicles for user`, requestId, userId);

  return success(sharedVehicles, requestId);
}

/**
 * POST /v1/vehicles/{vehicleId}/sharing
 * Create a new share or update an existing one (upsert by vehicleId + email).
 */
async function createOrUpdateShare(
  event: APIGatewayProxyEventV2,
  userId: string,
  vehicleId: string,
  requestId: string,
): Promise<APIGatewayProxyResultV2> {
  const body = parseBody(event.body);
  if (!body) {
    return error('VALIDATION_ERROR', 'Invalid or missing request body', requestId);
  }

  // Validate against the API contract (#18): email format (after trimming) and permission
  const valid = validate(ShareCreate, body);
  if (!valid.ok) {
    return error('VALIDATION_ERROR', valid.message, requestId);
  }

  const email = valid.data.email.toLowerCase();
  const { permission } = valid.data;

  // Reject self-sharing
  const ownerEmail = await getUserEmail(userId);
  if (ownerEmail && ownerEmail === email) {
    return error('VALIDATION_ERROR', 'Cannot share a vehicle with yourself', requestId);
  }

  // Verify caller owns the vehicle
  const isOwner = await verifyVehicleOwnership(userId, vehicleId);
  if (!isOwner) {
    return error('FORBIDDEN', 'You do not own this vehicle', requestId);
  }

  const docClient = getDocClient();
  const tableName = getTableName('SHARING_TABLE');
  const now = new Date().toISOString();
  const sortKey = `${vehicleId}#${email}`;

  // Check for existing share (upsert)
  const existing = await docClient.send(new GetCommand({
    TableName: tableName,
    Key: { ownerUserId: userId, vehicleEmailKey: sortKey },
  }));

  let record: ShareRecord;

  if (existing.Item) {
    // Update existing share's permission
    record = {
      shareId: existing.Item.shareId as string,
      ownerUserId: userId,
      sharedEmail: email,
      vehicleId,
      permission: permission as SharePermission,
      createdAt: existing.Item.createdAt as string,
      updatedAt: now,
    };
    logger.info(`Updating existing share ${record.shareId} for ${email}`, requestId, userId);
  } else {
    // Create new share
    record = {
      shareId: ulid(),
      ownerUserId: userId,
      sharedEmail: email,
      vehicleId,
      permission: permission as SharePermission,
      createdAt: now,
      updatedAt: now,
    };
    logger.info(`Creating new share ${record.shareId} for ${email}`, requestId, userId);
  }

  await docClient.send(new PutCommand({
    TableName: tableName,
    Item: {
      ownerUserId: record.ownerUserId,
      vehicleEmailKey: sortKey,
      shareId: record.shareId,
      sharedEmail: record.sharedEmail,
      vehicleId: record.vehicleId,
      permission: record.permission,
      GSI1PK: email,
      GSI1SK: vehicleId,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    },
  }));

  return success(record, requestId, existing.Item ? 200 : 201);
}


/**
 * GET /v1/vehicles/{vehicleId}/sharing
 * List all shares for a vehicle (owner only).
 */
async function listVehicleShares(
  userId: string,
  vehicleId: string,
  requestId: string,
): Promise<APIGatewayProxyResultV2> {
  // Verify caller owns the vehicle
  const isOwner = await verifyVehicleOwnership(userId, vehicleId);
  if (!isOwner) {
    return error('FORBIDDEN', 'You do not own this vehicle', requestId);
  }

  const docClient = getDocClient();
  const tableName = getTableName('SHARING_TABLE');

  const result = await docClient.send(new QueryCommand({
    TableName: tableName,
    KeyConditionExpression: 'ownerUserId = :userId AND begins_with(vehicleEmailKey, :prefix)',
    ExpressionAttributeValues: {
      ':userId': userId,
      ':prefix': `${vehicleId}#`,
    },
  }));

  const shares: ShareRecord[] = (result.Items ?? []).map(item => ({
    shareId: item.shareId as string,
    ownerUserId: item.ownerUserId as string,
    sharedEmail: item.sharedEmail as string,
    vehicleId: item.vehicleId as string,
    permission: item.permission as SharePermission,
    createdAt: item.createdAt as string,
    updatedAt: item.updatedAt as string,
  }));

  return success(shares, requestId);
}

/**
 * DELETE /v1/vehicles/{vehicleId}/sharing/{shareId}
 * Revoke a share by shareId (owner only).
 */
async function deleteShare(
  userId: string,
  vehicleId: string,
  shareId: string,
  requestId: string,
): Promise<APIGatewayProxyResultV2> {
  // Verify caller owns the vehicle
  const isOwner = await verifyVehicleOwnership(userId, vehicleId);
  if (!isOwner) {
    return error('FORBIDDEN', 'You do not own this vehicle', requestId);
  }

  const docClient = getDocClient();
  const tableName = getTableName('SHARING_TABLE');

  // Query all shares for this vehicle to find the one with matching shareId
  const result = await docClient.send(new QueryCommand({
    TableName: tableName,
    KeyConditionExpression: 'ownerUserId = :userId AND begins_with(vehicleEmailKey, :prefix)',
    ExpressionAttributeValues: {
      ':userId': userId,
      ':prefix': `${vehicleId}#`,
    },
  }));

  const targetItem = (result.Items ?? []).find(item => item.shareId === shareId);
  if (!targetItem) {
    return error('NOT_FOUND', 'Share not found', requestId);
  }

  // Delete using the actual PK/SK from the found item
  await docClient.send(new DeleteCommand({
    TableName: tableName,
    Key: {
      ownerUserId: targetItem.ownerUserId as string,
      vehicleEmailKey: targetItem.vehicleEmailKey as string,
    },
  }));

  logger.info(`Deleted share ${shareId} for vehicle ${vehicleId}`, requestId, userId);

  return success({ deleted: true }, requestId);
}
