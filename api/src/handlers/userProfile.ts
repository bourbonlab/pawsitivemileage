import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { DeleteCommand, GetCommand, PutCommand, QueryCommand, BatchWriteCommand } from '@aws-sdk/lib-dynamodb';
import { S3Client, ListObjectsV2Command, DeleteObjectsCommand } from '@aws-sdk/client-s3';
import { getDocClient, getTableName } from '../lib/dynamo.js';
import { getUserId } from '../lib/auth.js';
import { success, error } from '../lib/response.js';
import { parseBody, validateStringLength } from '../lib/validation.js';
import { createLogger } from '../lib/logger.js';
import type { User } from '../types/user.js';

const logger = createLogger('userProfile');

let s3Client: S3Client | null = null;
function getS3Client(): S3Client {
  if (!s3Client) {
    s3Client = new S3Client({});
  }
  return s3Client;
}

export const handler = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
  const requestId = event.requestContext?.requestId ?? 'unknown';
  const userId = getUserId(event as unknown as Parameters<typeof getUserId>[0]);

  if (!userId) {
    return error('UNAUTHORIZED', 'Missing authentication', requestId);
  }

  const method = event.requestContext?.http?.method;

  try {
    if (method === 'GET') {
      return await getProfile(event, userId, requestId);
    }
    if (method === 'PUT') {
      return await updateProfile(event, userId, requestId);
    }
    if (method === 'DELETE') {
      return await deleteAccount(userId, requestId);
    }

    return error('VALIDATION_ERROR', 'Unsupported operation', requestId);
  } catch (err) {
    logger.error('Unhandled error in userProfile', requestId, userId, err);
    return error('INTERNAL_ERROR', 'An internal error occurred', requestId);
  }
};


/**
 * GET /v1/user/profile
 * Fetch the user profile. If not found, auto-create from JWT claims (Req 1.3, Property 26).
 */
async function getProfile(
  event: APIGatewayProxyEventV2,
  userId: string,
  requestId: string,
): Promise<APIGatewayProxyResultV2> {
  const docClient = getDocClient();
  const tableName = getTableName('USERS_TABLE');

  const result = await docClient.send(
    new GetCommand({ TableName: tableName, Key: { userId } }),
  );

  if (result.Item) {
    logger.info('Retrieved user profile', requestId, userId);
    return success(result.Item as User, requestId);
  }

  // Auto-create profile from JWT claims
  const claims = (event.requestContext as unknown as { authorizer?: { jwt?: { claims?: Record<string, string> } } })?.authorizer?.jwt?.claims;
  const email = (claims?.email as string) ?? '';
  const displayName = (claims?.name as string) ?? (claims?.email as string) ?? '';

  const now = new Date().toISOString();
  const user: User = {
    userId,
    email,
    displayName,
    isAdmin: false,
    createdAt: now,
    updatedAt: now,
  };

  await docClient.send(
    new PutCommand({
      TableName: tableName,
      Item: { ...user, GSI1PK: 'USERS', GSI1SK: now },
    }),
  );

  logger.info('Auto-created user profile from JWT claims', requestId, userId);
  return success(user, requestId, 201);
}

/**
 * PUT /v1/user/profile
 * Update user profile. Only displayName is user-editable.
 */
async function updateProfile(
  event: APIGatewayProxyEventV2,
  userId: string,
  requestId: string,
): Promise<APIGatewayProxyResultV2> {
  const body = parseBody(event.body);
  if (!body) {
    return error('VALIDATION_ERROR', 'Invalid or missing request body', requestId);
  }

  if (typeof body.displayName !== 'string' || body.displayName.trim() === '') {
    return error('VALIDATION_ERROR', 'displayName is required and must be a non-empty string', requestId);
  }

  const lengthErrors = validateStringLength(body, {
    displayName: 255,
  });
  if (lengthErrors.length > 0) {
    return error('VALIDATION_ERROR', lengthErrors.map(e => e.message).join(', '), requestId);
  }

  const docClient = getDocClient();
  const tableName = getTableName('USERS_TABLE');

  const existing = await docClient.send(
    new GetCommand({ TableName: tableName, Key: { userId } }),
  );

  if (!existing.Item) {
    return error('NOT_FOUND', 'User profile not found', requestId);
  }

  const now = new Date().toISOString();
  const updated: User = {
    ...(existing.Item as User),
    displayName: body.displayName as string,
    updatedAt: now,
  };

  await docClient.send(
    new PutCommand({
      TableName: tableName,
      Item: { ...updated, GSI1PK: 'USERS', GSI1SK: updated.createdAt },
    }),
  );

  logger.info('Updated user profile', requestId, userId);
  return success(updated, requestId);
}


/**
 * DELETE /v1/user/profile
 * Cascading account deletion (Req 11.1, 11.3, Property 25):
 * 1. Query all vehicles for the user
 * 2. For each vehicle, delete all fillups
 * 3. For each vehicle, delete all maintenance records
 * 4. Delete all vehicles
 * 5. Delete all S3 objects with the user's prefix
 * 6. Delete the user profile
 */
async function deleteAccount(
  userId: string,
  requestId: string,
): Promise<APIGatewayProxyResultV2> {
  const docClient = getDocClient();
  const usersTable = getTableName('USERS_TABLE');
  const vehiclesTable = getTableName('VEHICLES_TABLE');
  const fillupsTable = getTableName('FILLUPS_TABLE');
  const maintenanceTable = getTableName('MAINTENANCE_TABLE');
  const photosBucket = process.env.PHOTOS_BUCKET;

  // Verify user exists
  const existing = await docClient.send(
    new GetCommand({ TableName: usersTable, Key: { userId } }),
  );

  if (!existing.Item) {
    return error('NOT_FOUND', 'User profile not found', requestId);
  }

  logger.info('Starting cascading account deletion', requestId, userId);

  // Step 1: Get all vehicles for this user
  const vehiclesResult = await docClient.send(
    new QueryCommand({
      TableName: vehiclesTable,
      KeyConditionExpression: 'userId = :userId',
      ExpressionAttributeValues: { ':userId': userId },
      ProjectionExpression: 'vehicleId',
    }),
  );
  const vehicleIds = (vehiclesResult.Items ?? []).map((v) => v.vehicleId as string);

  // Step 2 & 3: For each vehicle, delete all fillups and maintenance records
  for (const vehicleId of vehicleIds) {
    await deleteTableItemsByPartitionKey(fillupsTable, 'vehicleId', vehicleId, 'fillupDateId');
    await deleteTableItemsByPartitionKey(maintenanceTable, 'vehicleId', vehicleId, 'serviceDateId');
  }

  // Step 4: Delete all vehicles (BatchWrite, 25 items max per batch)
  if (vehicleIds.length > 0) {
    const vehicleKeys = vehicleIds.map((vehicleId) => ({ userId, vehicleId }));
    await batchDeleteItems(vehiclesTable, vehicleKeys);
  }

  // Step 5: Delete all S3 objects with the user's prefix
  if (photosBucket) {
    await deleteS3ObjectsByPrefix(photosBucket, `${userId}/`);
  }

  // Step 6: Delete the user profile
  await docClient.send(
    new DeleteCommand({ TableName: usersTable, Key: { userId } }),
  );

  logger.info('Completed cascading account deletion', requestId, userId);
  return success({ message: 'Account and all associated data deleted' }, requestId);
}

/**
 * Query all items by partition key and delete them in batches of 25.
 * Handles pagination for tables with many items.
 */
async function deleteTableItemsByPartitionKey(
  tableName: string,
  pkName: string,
  pkValue: string,
  skName: string,
): Promise<void> {
  const docClient = getDocClient();
  let lastEvaluatedKey: Record<string, unknown> | undefined;

  do {
    const result = await docClient.send(
      new QueryCommand({
        TableName: tableName,
        KeyConditionExpression: '#pk = :pk',
        ExpressionAttributeNames: { '#pk': pkName },
        ExpressionAttributeValues: { ':pk': pkValue },
        ProjectionExpression: `#pk, ${skName}`,
        ExclusiveStartKey: lastEvaluatedKey,
      }),
    );

    const items = result.Items ?? [];
    if (items.length > 0) {
      const keys = items.map((item) => ({
        [pkName]: item[pkName],
        [skName]: item[skName],
      }));
      await batchDeleteItems(tableName, keys);
    }

    lastEvaluatedKey = result.LastEvaluatedKey;
  } while (lastEvaluatedKey);
}

/**
 * Delete items from a DynamoDB table in batches of 25 (BatchWriteItem limit).
 */
async function batchDeleteItems(
  tableName: string,
  keys: Record<string, unknown>[],
): Promise<void> {
  const docClient = getDocClient();
  const BATCH_SIZE = 25;

  for (let i = 0; i < keys.length; i += BATCH_SIZE) {
    const batch = keys.slice(i, i + BATCH_SIZE);
    const requestItems = {
      [tableName]: batch.map((key) => ({
        DeleteRequest: { Key: key },
      })),
    };

    let unprocessed: Record<string, Record<string, unknown>[]> = requestItems;
    do {
      const result = await docClient.send(
        new BatchWriteCommand({ RequestItems: unprocessed }),
      );

      const remaining = result.UnprocessedItems?.[tableName];
      if (remaining && remaining.length > 0) {
        unprocessed = { [tableName]: remaining };
      } else {
        break;
      }
    } while (true);
  }
}

/**
 * Delete all S3 objects under a given prefix. Handles pagination for >1000 objects.
 */
async function deleteS3ObjectsByPrefix(bucket: string, prefix: string): Promise<void> {
  const client = getS3Client();
  let continuationToken: string | undefined;

  do {
    const listResult = await client.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: prefix,
        ContinuationToken: continuationToken,
      }),
    );

    const objects = listResult.Contents;
    if (objects && objects.length > 0) {
      await client.send(
        new DeleteObjectsCommand({
          Bucket: bucket,
          Delete: {
            Objects: objects.map((obj) => ({ Key: obj.Key! })),
            Quiet: true,
          },
        }),
      );
    }

    continuationToken = listResult.IsTruncated ? listResult.NextContinuationToken : undefined;
  } while (continuationToken);
}
