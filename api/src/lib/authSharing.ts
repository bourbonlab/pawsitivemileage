import { GetCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { getDocClient, getTableName } from './dynamo.js';
import type { SharePermission } from '../types/sharing.js';

export interface SharedPermission {
  shareId: string;
  permission: SharePermission;
}

/**
 * Look up a user's email from the Users table.
 * Returns the email lowercase and trimmed, or null if the user doesn't exist.
 */
export async function getUserEmail(userId: string): Promise<string | null> {
  const docClient = getDocClient();
  const tableName = getTableName('USERS_TABLE');

  const result = await docClient.send(new GetCommand({
    TableName: tableName,
    Key: { userId },
    ProjectionExpression: 'email',
  }));

  if (!result.Item?.email) {
    return null;
  }

  return (result.Item.email as string).toLowerCase().trim();
}

/**
 * Query the Sharing table GSI1 to check if an email has shared access to a vehicle.
 * GSI1PK = sharedEmail (lowercase), GSI1SK = vehicleId.
 */
export async function getSharedPermission(
  userEmail: string,
  vehicleId: string,
): Promise<SharedPermission | null> {
  const docClient = getDocClient();
  const tableName = getTableName('SHARING_TABLE');

  const result = await docClient.send(new QueryCommand({
    TableName: tableName,
    IndexName: 'GSI1',
    KeyConditionExpression: 'GSI1PK = :email AND GSI1SK = :vehicleId',
    ExpressionAttributeValues: {
      ':email': userEmail.toLowerCase().trim(),
      ':vehicleId': vehicleId,
    },
    Limit: 1,
  }));

  const item = result.Items?.[0];
  if (!item) {
    return null;
  }

  return {
    shareId: item.shareId as string,
    permission: item.permission as SharePermission,
  };
}

/**
 * Pure function: check if a permission level allows a specific operation.
 *
 * Permission matrix:
 * | Permission    | read | write-fuel | write-maintenance |
 * |---------------|------|------------|-------------------|
 * | readonly      | ✅   | ❌          | ❌                 |
 * | fuel          | ✅   | ✅          | ❌                 |
 * | maintenance   | ✅   | ❌          | ✅                 |
 * | full          | ✅   | ✅          | ✅                 |
 */
export function isOperationAllowed(
  permission: SharePermission,
  operation: 'read' | 'write-fuel' | 'write-maintenance',
): boolean {
  if (operation === 'read') {
    return true;
  }

  if (operation === 'write-fuel') {
    return permission === 'fuel' || permission === 'full';
  }

  if (operation === 'write-maintenance') {
    return permission === 'maintenance' || permission === 'full';
  }

  return false;
}

/**
 * Combined access check: first verify ownership, then fall back to shared permission.
 * Returns whether access is allowed and whether the user is the vehicle owner.
 */
export async function verifyAccess(
  userId: string,
  vehicleId: string,
  requiredOperation: 'read' | 'write-fuel' | 'write-maintenance',
): Promise<{ allowed: boolean; isOwner: boolean }> {
  const docClient = getDocClient();
  const vehiclesTable = getTableName('VEHICLES_TABLE');

  // Check ownership first
  const ownerResult = await docClient.send(new GetCommand({
    TableName: vehiclesTable,
    Key: { userId, vehicleId },
    ProjectionExpression: 'vehicleId',
  }));

  if (ownerResult.Item) {
    return { allowed: true, isOwner: true };
  }

  // Not the owner — check shared access
  const email = await getUserEmail(userId);
  if (!email) {
    return { allowed: false, isOwner: false };
  }

  const sharedPermission = await getSharedPermission(email, vehicleId);
  if (!sharedPermission) {
    return { allowed: false, isOwner: false };
  }

  const allowed = isOperationAllowed(sharedPermission.permission, requiredOperation);
  return { allowed, isOwner: false };
}
