import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { DeleteCommand, GetCommand, PutCommand, QueryCommand, BatchWriteCommand } from '@aws-sdk/lib-dynamodb';
import { S3Client, ListObjectsV2Command, DeleteObjectsCommand } from '@aws-sdk/client-s3';
import { AdminDeleteUserCommand, CognitoIdentityProviderClient, ListUsersCommand } from '@aws-sdk/client-cognito-identity-provider';
import { getDocClient, getTableName } from '../lib/dynamo.js';
import { getIdentity, getUserId } from '../lib/auth.js';
import { success, error } from '../lib/response.js';
import { parseBody } from '../lib/validation.js';
import { validate } from '../lib/contract.js';
import { ProfileUpdate } from '@pawsitivemileage/contracts';
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
      return await deleteAccount(event, userId, requestId);
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

  // Auto-create profile from the token: ID-token claims, or /oauth2/userInfo for access tokens (#22)
  const identity = await getIdentity(event as unknown as Parameters<typeof getIdentity>[0]);
  if (!identity) {
    return error('INTERNAL_ERROR', 'Could not read your email from the sign-in service; try again', requestId);
  }
  const { email, name: displayName } = identity;

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

  // Validate against the API contract (#18): non-blank displayName, at most 255 characters
  const valid = validate(ProfileUpdate, body);
  if (!valid.ok) {
    return error('VALIDATION_ERROR', valid.message, requestId);
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
 * DELETE /v1/user/profile — delete the account and everything stored for it (Play policy: a
 * user can delete their account and its data, in the app and on the web).
 *
 * In order: shares of the user's vehicles and shares to the user's email, every vehicle's
 * fill-ups and maintenance, the vehicles, photos and receipts (photo bucket, `{userId}/`),
 * exports (`exports/{userId}/`), the profile, and last the Cognito user, so the sign-in itself
 * is gone and signing in again starts a new, empty account.
 *
 * Safe to retry: every step deletes what's there, and a missing profile doesn't stop the rest.
 */
async function deleteAccount(
  event: APIGatewayProxyEventV2,
  userId: string,
  requestId: string,
): Promise<APIGatewayProxyResultV2> {
  const docClient = getDocClient();
  const usersTable = getTableName('USERS_TABLE');
  const vehiclesTable = getTableName('VEHICLES_TABLE');
  const fillupsTable = getTableName('FILLUPS_TABLE');
  const maintenanceTable = getTableName('MAINTENANCE_TABLE');
  const sharingTable = getTableName('SHARING_TABLE');

  const existing = await docClient.send(new GetCommand({ TableName: usersTable, Key: { userId } }));
  const claims = (event.requestContext as unknown as { authorizer?: { jwt?: { claims?: Record<string, string> } } })?.authorizer?.jwt?.claims;
  const email = ((existing.Item?.email as string | undefined) || claims?.email || '').toLowerCase();

  logger.info('Starting cascading account deletion', requestId, userId);

  // Shares of this user's vehicles (keyed by owner), and shares to this user's email (GSI1)
  await deleteTableItemsByPartitionKey(sharingTable, 'ownerUserId', userId, 'vehicleEmailKey');
  if (email) await deleteSharesTo(sharingTable, email);

  const vehicleIds: string[] = [];
  let lastKey: Record<string, unknown> | undefined;
  do {
    const page = await docClient.send(new QueryCommand({
      TableName: vehiclesTable,
      KeyConditionExpression: 'userId = :userId',
      ExpressionAttributeValues: { ':userId': userId },
      ProjectionExpression: 'vehicleId',
      ExclusiveStartKey: lastKey,
    }));
    vehicleIds.push(...(page.Items ?? []).map((v) => v.vehicleId as string));
    lastKey = page.LastEvaluatedKey;
  } while (lastKey);

  for (const vehicleId of vehicleIds) {
    await deleteTableItemsByPartitionKey(fillupsTable, 'vehicleId', vehicleId, 'fillupDateId');
    await deleteTableItemsByPartitionKey(maintenanceTable, 'vehicleId', vehicleId, 'serviceDateId');
  }
  if (vehicleIds.length > 0) {
    await batchDeleteItems(vehiclesTable, vehicleIds.map((vehicleId) => ({ userId, vehicleId })));
  }

  const photosBucket = process.env.PHOTOS_BUCKET;
  if (photosBucket) await deleteS3ObjectsByPrefix(photosBucket, `${userId}/`);
  const exportsBucket = process.env.EXPORTS_BUCKET;
  if (exportsBucket) await deleteS3ObjectsByPrefix(exportsBucket, `exports/${userId}/`);

  await docClient.send(new DeleteCommand({ TableName: usersTable, Key: { userId } }));

  // Last: the sign-in account. If this fails the data is already gone; a retry finishes it.
  await deleteCognitoUser(userId, requestId);

  logger.info('Completed cascading account deletion', requestId, userId);
  return success({ message: 'Account and all associated data deleted' }, requestId);
}

/** Shares to this email (GSI1: GSI1PK = email), deleted by their table key */
async function deleteSharesTo(sharingTable: string, email: string): Promise<void> {
  const docClient = getDocClient();
  let lastKey: Record<string, unknown> | undefined;
  do {
    const page = await docClient.send(new QueryCommand({
      TableName: sharingTable,
      IndexName: 'GSI1',
      KeyConditionExpression: 'GSI1PK = :email',
      ExpressionAttributeValues: { ':email': email },
      ProjectionExpression: 'ownerUserId, vehicleEmailKey',
      ExclusiveStartKey: lastKey,
    }));
    const keys = (page.Items ?? []).map((i) => ({ ownerUserId: i.ownerUserId, vehicleEmailKey: i.vehicleEmailKey }));
    if (keys.length > 0) await batchDeleteItems(sharingTable, keys);
    lastKey = page.LastEvaluatedKey;
  } while (lastKey);
}

let cognito: CognitoIdentityProviderClient | null = null;

/** Delete the Cognito user whose sub is `userId` (and with it any linked Google identity) */
async function deleteCognitoUser(userId: string, requestId: string): Promise<void> {
  const userPoolId = process.env.USER_POOL_ID;
  if (!userPoolId) {
    logger.warn('USER_POOL_ID not set; the Cognito user was not deleted', requestId, userId);
    return;
  }
  cognito ??= new CognitoIdentityProviderClient({});
  const found = await cognito.send(new ListUsersCommand({ UserPoolId: userPoolId, Filter: `sub = "${userId}"`, Limit: 1 }));
  const username = found.Users?.[0]?.Username;
  if (!username) return; // already gone
  await cognito.send(new AdminDeleteUserCommand({ UserPoolId: userPoolId, Username: username }));
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
