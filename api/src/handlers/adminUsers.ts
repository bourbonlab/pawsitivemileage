import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { GetCommand, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { ulid } from 'ulid';
import { getDocClient, getTableName } from '../lib/dynamo.js';
import { getUserId } from '../lib/auth.js';
import { success, error } from '../lib/response.js';
import { parseBody } from '../lib/validation.js';
import { validate } from '../lib/contract.js';
import { AdminSetAdmin } from '@pawsitivemileage/contracts';
import { createLogger } from '../lib/logger.js';
import type { User } from '../types/user.js';

const logger = createLogger('adminUsers');

export const handler = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
  const requestId = event.requestContext?.requestId ?? ulid();
  const userId = getUserId(event as unknown as Parameters<typeof getUserId>[0]);

  if (!userId) {
    return error('UNAUTHORIZED', 'Missing authentication', requestId);
  }

  try {
    // Verify admin flag for all requests
    const isAdmin = await checkIsAdmin(userId);
    if (!isAdmin) {
      logger.warn('Non-admin user attempted admin users access', requestId, userId);
      return error('FORBIDDEN', 'Admin access required', requestId);
    }

    const method = event.requestContext?.http?.method;
    const targetUserId = event.pathParameters?.userId;
    const path = event.rawPath ?? '';
    const isAdminRoute = path.endsWith('/admin');

    // GET /v1/admin/users — list all users with stats
    if (method === 'GET' && !targetUserId) {
      return await listUsers(requestId, userId);
    }

    // PATCH /v1/admin/users/{userId}/admin — set/remove admin flag
    if (method === 'PATCH' && targetUserId && isAdminRoute) {
      return await toggleAdminFlag(event, targetUserId, requestId, userId);
    }

    return error('VALIDATION_ERROR', 'Unsupported operation', requestId);
  } catch (err) {
    logger.error('Unhandled error in adminUsers', requestId, userId, err);
    return error('INTERNAL_ERROR', 'An internal error occurred', requestId);
  }
};


/**
 * Check if the user has the isAdmin flag set in the Users table.
 */
async function checkIsAdmin(userId: string): Promise<boolean> {
  const tableName = getTableName('USERS_TABLE');
  const docClient = getDocClient();

  const result = await docClient.send(
    new GetCommand({
      TableName: tableName,
      Key: { userId },
      ProjectionExpression: 'isAdmin',
    }),
  );

  return result.Item?.isAdmin === true;
}

/**
 * GET /v1/admin/users
 * List all users with vehicle count, fillup count, and last active date.
 * Uses GSI1 on Users table (GSI1PK = "USERS", GSI1SK = createdAt) for listing.
 * For each user, queries Vehicles table by userId to count vehicles,
 * and Fillups table GSI1 (GSI1PK = userId) to count fillups.
 */
async function listUsers(
  requestId: string,
  userId: string,
): Promise<APIGatewayProxyResultV2> {
  const docClient = getDocClient();
  const usersTable = getTableName('USERS_TABLE');
  const vehiclesTable = getTableName('VEHICLES_TABLE');
  const fillupsTable = getTableName('FILLUPS_TABLE');

  // Query all users via GSI1
  const usersResult = await docClient.send(
    new QueryCommand({
      TableName: usersTable,
      IndexName: 'GSI1',
      KeyConditionExpression: 'GSI1PK = :pk',
      ExpressionAttributeValues: { ':pk': 'USERS' },
    }),
  );

  const users = (usersResult.Items ?? []) as (User & { GSI1PK?: string; GSI1SK?: string })[];

  // For each user, aggregate vehicle count and fillup count
  const usersWithStats = await Promise.all(
    users.map(async (user) => {
      const [vehicleCount, fillupStats] = await Promise.all([
        countVehicles(docClient, vehiclesTable, user.userId),
        countFillupsAndLastActive(docClient, fillupsTable, user.userId),
      ]);

      return {
        userId: user.userId,
        email: user.email,
        displayName: user.displayName,
        isAdmin: user.isAdmin,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt,
        vehicleCount,
        fillupCount: fillupStats.count,
        lastActive: fillupStats.lastDate ?? user.updatedAt,
      };
    }),
  );

  logger.info(`Listed ${usersWithStats.length} users with stats`, requestId, userId);
  return success(usersWithStats, requestId);
}

/**
 * Count vehicles for a user by querying the Vehicles table (PK = userId).
 */
async function countVehicles(
  docClient: ReturnType<typeof getDocClient>,
  tableName: string,
  targetUserId: string,
): Promise<number> {
  const result = await docClient.send(
    new QueryCommand({
      TableName: tableName,
      KeyConditionExpression: 'userId = :uid',
      ExpressionAttributeValues: { ':uid': targetUserId },
      Select: 'COUNT',
    }),
  );

  return result.Count ?? 0;
}

/**
 * Count fillups and find the most recent fillup date for a user.
 * Uses Fillups GSI1 (GSI1PK = userId, GSI1SK = date).
 */
async function countFillupsAndLastActive(
  docClient: ReturnType<typeof getDocClient>,
  tableName: string,
  targetUserId: string,
): Promise<{ count: number; lastDate: string | null }> {
  const result = await docClient.send(
    new QueryCommand({
      TableName: tableName,
      IndexName: 'GSI1',
      KeyConditionExpression: 'GSI1PK = :pk',
      ExpressionAttributeValues: { ':pk': targetUserId },
      Select: 'COUNT',
    }),
  );

  const count = result.Count ?? 0;

  // Get the most recent fillup date by querying in reverse
  if (count === 0) {
    return { count, lastDate: null };
  }

  const lastResult = await docClient.send(
    new QueryCommand({
      TableName: tableName,
      IndexName: 'GSI1',
      KeyConditionExpression: 'GSI1PK = :pk',
      ExpressionAttributeValues: { ':pk': targetUserId },
      ScanIndexForward: false,
      Limit: 1,
      ProjectionExpression: 'GSI1SK',
    }),
  );

  const lastDate = (lastResult.Items?.[0]?.GSI1SK as string) ?? null;
  return { count, lastDate };
}

/**
 * PATCH /v1/admin/users/{userId}/admin
 * Set or remove the admin flag on a user. Body: { "isAdmin": true/false }
 */
async function toggleAdminFlag(
  event: APIGatewayProxyEventV2,
  targetUserId: string,
  requestId: string,
  userId: string,
): Promise<APIGatewayProxyResultV2> {
  const body = parseBody(event.body);
  // Validate against the API contract (#18): isAdmin (boolean)
  const valid = validate(AdminSetAdmin, body ?? {});
  if (!valid.ok) {
    return error('VALIDATION_ERROR', valid.message, requestId);
  }

  const tableName = getTableName('USERS_TABLE');
  const docClient = getDocClient();

  // Verify target user exists
  const existing = await docClient.send(
    new GetCommand({
      TableName: tableName,
      Key: { userId: targetUserId },
    }),
  );

  if (!existing.Item) {
    return error('NOT_FOUND', 'User not found', requestId);
  }

  const now = new Date().toISOString();

  const result = await docClient.send(
    new UpdateCommand({
      TableName: tableName,
      Key: { userId: targetUserId },
      UpdateExpression: 'SET #isAdmin = :isAdmin, #updatedAt = :updatedAt',
      ExpressionAttributeNames: {
        '#isAdmin': 'isAdmin',
        '#updatedAt': 'updatedAt',
      },
      ExpressionAttributeValues: {
        ':isAdmin': valid.data.isAdmin,
        ':updatedAt': now,
      },
      ReturnValues: 'ALL_NEW',
    }),
  );

  const action = valid.data.isAdmin ? 'Granted' : 'Revoked';
  logger.info(`${action} admin flag for user ${targetUserId}`, requestId, userId);
  return success(result.Attributes as User, requestId);
}
