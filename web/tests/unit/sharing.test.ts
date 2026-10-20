import { describe, it, expect } from 'vitest';
import { canEditRecords, canImportData, permissionLabel, selectablePermissions } from '@/lib/sharing';

describe('canEditRecords', () => {
  it('allows the owner (no share)', () => {
    expect(canEditRecords(undefined)).toBe(true);
  });

  it('allows fuel, legacy maintenance, and full shares to edit both fillups and maintenance', () => {
    expect(canEditRecords('fuel')).toBe(true);
    expect(canEditRecords('maintenance')).toBe(true);
    expect(canEditRecords('full')).toBe(true);
  });

  it('denies readonly shares', () => {
    expect(canEditRecords('readonly')).toBe(false);
  });
});

describe('canImportData', () => {
  it('allows only the owner and full shares', () => {
    expect(canImportData(undefined)).toBe(true);
    expect(canImportData('full')).toBe(true);
    expect(canImportData('fuel')).toBe(false);
    expect(canImportData('maintenance')).toBe(false);
    expect(canImportData('readonly')).toBe(false);
  });
});

describe('share permission options', () => {
  it('no longer offers the legacy maintenance-only level', () => {
    expect(selectablePermissions).toEqual(['readonly', 'fuel', 'full']);
  });

  it('labels legacy maintenance shares the same as fuel shares', () => {
    expect(permissionLabel.maintenance).toBe(permissionLabel.fuel);
  });
});
