import type { SharePermission } from '@pawsitivemileage/sdk';

/**
 * Whether a viewer can add, edit, and delete fillups and maintenance records.
 * Owners pass `undefined` (no share). Mirrors isOperationAllowed in api/src/lib/authSharing.ts:
 * every share level except readonly can edit records; the legacy 'maintenance' level
 * behaves the same as 'fuel'.
 */
export function canEditRecords(permission: SharePermission | undefined): boolean {
  return permission === undefined || permission !== 'readonly';
}

/** Whether a viewer can import CSV data and recalculate metrics (owner or full access only). */
export function canImportData(permission: SharePermission | undefined): boolean {
  return permission === undefined || permission === 'full';
}

export const permissionLabel: Record<SharePermission, string> = {
  readonly: 'Read Only',
  fuel: 'Fuel & Maintenance',
  maintenance: 'Fuel & Maintenance',
  full: 'Full Access',
};

export const permissionVariant: Record<SharePermission, 'secondary' | 'default' | 'outline' | 'destructive'> = {
  readonly: 'secondary',
  fuel: 'default',
  maintenance: 'default',
  full: 'destructive',
};

/** Levels offered when creating or changing a share. 'maintenance' is legacy and no longer offered. */
export const selectablePermissions: SharePermission[] = ['readonly', 'fuel', 'full'];
