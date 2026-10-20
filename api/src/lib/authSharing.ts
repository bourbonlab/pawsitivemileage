import { GetCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { getDocClient, getTableName } from './dynamo.js';
import type { SharePermission } from '../types/sharing.js';

export interface SharedPermission {
  shareId: string;
  ownerUserId: string;
  permission: SharePermission;
}

/** Permission levels that may create, edit, and delete fillup and maintenance records. */
const RECORD_WRITE_PERMISSIONS: readonly SharePermission[] = ['fuel', 'maintenance', 'full'];

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
    ownerUserId: item.ownerUserId as string,
    permission: item.permission as SharePermission,
  };
}

/**
 * Pure function: check if a permission level allows a specific operation.
 *
 * Any shared editor can write both fillups and maintenance records. The legacy
 * 'maintenance' level is kept for existing shares and behaves the same as 'fuel'.
 * Only 'full' additionally unlocks import/recalculate (enforced in importData).
 *
 * Permission matrix:
 * | Permission    | read | write-fuel | write-maintenance |
 * |---------------|------|------------|-------------------|
 * | readonly      | ✅   | ❌          | ❌                 |
 * | fuel          | ✅   | ✅          | ✅                 |
 * | maintenance   | ✅   | ✅          | ✅                 |
 * | full          | ✅   | ✅          | ✅                 |
 */
export function isOperationAllowed(
  permission: SharePermission,
  operation: 'read' | 'write-fuel' | 'write-maintenance',
): boolean {
  if (operation === 'read') {
    return true;
  }

  if (operation === 'write-fuel' || operation === 'write-maintenance') {
    return RECORD_WRITE_PERMISSIONS.includes(permission);
  }

  return false;
}

/**
 * Pure function: may this caller upload a file of this type for the vehicle?
 * `access` must come from verifyAccess(…, 'write-fuel').
 *
 * - receipt-photo: anyone who may write records (owner, or fuel/maintenance/full share)
 * - vehicle-photo: owner only — shared users can't update vehicles
 * - csv-import:    owner or 'full' share — matches what importData allows
 */
export function uploadAllowed(
  uploadType: 'vehicle-photo' | 'receipt-photo' | 'csv-import',
  access: AccessResult,
): boolean {
  if (uploadType === 'vehicle-photo') return access.isOwner;
  if (uploadType === 'csv-import') return access.isOwner || access.permission === 'full';
  return access.allowed;
}

export interface AccessResult {
  allowed: boolean;
  isOwner: boolean;
  /** The vehicle owner's userId. Records written by shared users are attributed to the owner. Null when access is denied. */
  ownerUserId: string | null;
  /** The caller's share permission, or null when they own the vehicle or have no access. */
  permission: SharePermission | null;
}

/**
 * Combined access check: first verify ownership, then fall back to shared permission.
 * Returns whether access is allowed, whether the user is the vehicle owner, and the owner's userId.
 */
export async function verifyAccess(
  userId: string,
  vehicleId: string,
  requiredOperation: 'read' | 'write-fuel' | 'write-maintenance',
): Promise<AccessResult> {
  const docClient = getDocClient();
  const vehiclesTable = getTableName('VEHICLES_TABLE');

  // Check ownership first
  const ownerResult = await docClient.send(new GetCommand({
    TableName: vehiclesTable,
    Key: { userId, vehicleId },
    ProjectionExpression: 'vehicleId',
  }));

  if (ownerResult.Item) {
    return { allowed: true, isOwner: true, ownerUserId: userId, permission: null };
  }

  // Not the owner — check shared access
  const email = await getUserEmail(userId);
  if (!email) {
    return { allowed: false, isOwner: false, ownerUserId: null, permission: null };
  }

  const sharedPermission = await getSharedPermission(email, vehicleId);
  if (!sharedPermission) {
    return { allowed: false, isOwner: false, ownerUserId: null, permission: null };
  }

  const allowed = isOperationAllowed(sharedPermission.permission, requiredOperation);
  return {
    allowed,
    isOwner: false,
    ownerUserId: allowed ? sharedPermission.ownerUserId : null,
    permission: sharedPermission.permission,
  };
}
