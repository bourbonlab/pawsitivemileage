import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { GetCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { ulid } from 'ulid';
import { getDocClient, getTableName } from '../lib/dynamo.js';
import { getUserId } from '../lib/auth.js';
import { success, error } from '../lib/response.js';
import { createLogger } from '../lib/logger.js';

const logger = createLogger('adminStats');

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
      logger.warn('Non-admin user attempted admin stats access', requestId, userId);
      return error('FORBIDDEN', 'Admin access required', requestId);
    }

    const method = event.requestContext?.http?.method;

    // GET /v1/admin/stats — platform statistics
    if (method === 'GET') {
      return await getStats(requestId, userId);
    }

    return error('VALIDATION_ERROR', 'Unsupported operation', requestId);
  } catch (err) {
    logger.error('Unhandled error in adminStats', requestId, userId, err);
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
 * GET /v1/admin/stats
 * Returns platform statistics:
 * - totalUsers: count of all registered users
 * - activeUsers: count of users with at least one fillup in the last 30 days
 * - totalFillups: count of all fillups across the platform
 * - totalVehicles: count of all vehicles across the platform
 * - usageTrends: monthly fillup counts for the last 6 months
 */
async function getStats(
  requestId: string,
  userId: string,
): Promise<APIGatewayProxyResultV2> {
  const docClient = getDocClient();
  const usersTable = getTableName('USERS_TABLE');
  const vehiclesTable = getTableName('VEHICLES_TABLE');
  const fillupsTable = getTableName('FILLUPS_TABLE');

  // Run aggregate counts in parallel
  const [totalUsers, totalVehicles, totalFillups] = await Promise.all([
    countFromGSI(docClient, usersTable, 'GSI1', 'USERS'),
    countFromGSI(docClient, vehiclesTable, 'GSI1', 'VEHICLES'),
    countFromGSI(docClient, fillupsTable, 'GSI2', 'FILLUPS'),
  ]);

  // Active users: users with fillups in the last 30 days
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  const thirtyDaysAgoISO = thirtyDaysAgo.toISOString();

  const activeUsers = await countActiveUsers(docClient, fillupsTable, thirtyDaysAgoISO);

  // Usage trends: monthly fillup counts for the last 6 months
  const usageTrends = await getUsageTrends(docClient, fillupsTable);

  const stats = {
    totalUsers,
    activeUsers,
    totalFillups,
    totalVehicles,
    usageTrends,
  };

  logger.info('Retrieved platform statistics', requestId, userId);
  return success(stats, requestId);
}

/**
 * Count all items in a GSI by partition key value using Select: 'COUNT'.
 * Handles pagination to get the full count.
 */
async function countFromGSI(
  docClient: ReturnType<typeof getDocClient>,
  tableName: string,
  indexName: string,
  pkValue: string,
): Promise<number> {
  let total = 0;
  let lastKey: Record<string, unknown> | undefined;

  do {
    const pkAttr = indexName === 'GSI2' ? 'GSI2PK' : 'GSI1PK';
    const result = await docClient.send(
      new QueryCommand({
        TableName: tableName,
        IndexName: indexName,
        KeyConditionExpression: `${pkAttr} = :pk`,
        ExpressionAttributeValues: { ':pk': pkValue },
        Select: 'COUNT',
        ExclusiveStartKey: lastKey,
      }),
    );

    total += result.Count ?? 0;
    lastKey = result.LastEvaluatedKey as Record<string, unknown> | undefined;
  } while (lastKey);

  return total;
}

/**
 * Count distinct users who have at least one fillup since the given date.
 * Queries Fillups GSI2 (GSI2PK = "FILLUPS", GSI2SK = date) with a date range filter,
 * then collects distinct userIds.
 */
async function countActiveUsers(
  docClient: ReturnType<typeof getDocClient>,
  fillupsTable: string,
  sinceDate: string,
): Promise<number> {
  const userIds = new Set<string>();
  let lastKey: Record<string, unknown> | undefined;

  do {
    const result = await docClient.send(
      new QueryCommand({
        TableName: fillupsTable,
        IndexName: 'GSI2',
        KeyConditionExpression: 'GSI2PK = :pk AND GSI2SK >= :since',
        ExpressionAttributeValues: {
          ':pk': 'FILLUPS',
          ':since': sinceDate,
        },
        ProjectionExpression: 'userId',
        ExclusiveStartKey: lastKey,
      }),
    );

    for (const item of result.Items ?? []) {
      if (item.userId) {
        userIds.add(item.userId as string);
      }
    }

    lastKey = result.LastEvaluatedKey as Record<string, unknown> | undefined;
  } while (lastKey);

  return userIds.size;
}

/**
 * Get monthly fillup counts for the last 6 months.
 * Returns an array of { month: "YYYY-MM", count: number } sorted chronologically.
 */
async function getUsageTrends(
  docClient: ReturnType<typeof getDocClient>,
  fillupsTable: string,
): Promise<Array<{ month: string; count: number }>> {
  const now = new Date();
  const months: Array<{ month: string; start: string; end: string }> = [];

  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const monthLabel = `${year}-${month}`;

    const nextMonth = new Date(year, d.getMonth() + 1, 1);
    months.push({
      month: monthLabel,
      start: d.toISOString(),
      end: nextMonth.toISOString(),
    });
  }

  // Query each month's count in parallel
  const trends = await Promise.all(
    months.map(async ({ month, start, end }) => {
      let count = 0;
      let lastKey: Record<string, unknown> | undefined;

      do {
        const result = await docClient.send(
          new QueryCommand({
            TableName: fillupsTable,
            IndexName: 'GSI2',
            KeyConditionExpression: 'GSI2PK = :pk AND GSI2SK BETWEEN :start AND :end',
            ExpressionAttributeValues: {
              ':pk': 'FILLUPS',
              ':start': start,
              ':end': end,
            },
            Select: 'COUNT',
            ExclusiveStartKey: lastKey,
          }),
        );

        count += result.Count ?? 0;
        lastKey = result.LastEvaluatedKey as Record<string, unknown> | undefined;
      } while (lastKey);

      return { month, count };
    }),
  );

  return trends;
}
