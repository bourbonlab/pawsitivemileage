import { describe, it, expect } from 'vitest';
import { isOperationAllowed, uploadAllowed, type AccessResult } from '../../src/lib/authSharing';
import type { SharePermission } from '../../src/types/sharing';

// Test the pure function — no DynamoDB mocking needed

describe('isOperationAllowed', () => {
  const permissions: SharePermission[] = ['readonly', 'fuel', 'maintenance', 'full'];
  const editors: SharePermission[] = ['fuel', 'maintenance', 'full'];

  describe('read operation', () => {
    it('is allowed for all permission levels', () => {
      for (const perm of permissions) {
        expect(isOperationAllowed(perm, 'read')).toBe(true);
      }
    });
  });

  describe('write-fuel operation', () => {
    it('is allowed for every editor permission', () => {
      for (const perm of editors) {
        expect(isOperationAllowed(perm, 'write-fuel')).toBe(true);
      }
    });

    it('is denied for readonly permission', () => {
      expect(isOperationAllowed('readonly', 'write-fuel')).toBe(false);
    });
  });

  describe('write-maintenance operation', () => {
    it('is allowed for every editor permission, including fuel', () => {
      for (const perm of editors) {
        expect(isOperationAllowed(perm, 'write-maintenance')).toBe(true);
      }
    });

    it('is denied for readonly permission', () => {
      expect(isOperationAllowed('readonly', 'write-maintenance')).toBe(false);
    });
  });

  describe('unknown values', () => {
    it('denies an unknown operation for any permission', () => {
      // Cast to bypass type checking for edge case
      expect(isOperationAllowed('full', 'delete' as any)).toBe(false);
    });

    it('denies writes for an unknown permission', () => {
      expect(isOperationAllowed('owner' as any, 'write-fuel')).toBe(false);
      expect(isOperationAllowed('owner' as any, 'write-maintenance')).toBe(false);
    });
  });
});

describe('uploadAllowed', () => {
  const owner: AccessResult = { allowed: true, isOwner: true, ownerUserId: 'owner', permission: null };
  const shared = (permission: SharePermission): AccessResult => {
    const allowed = isOperationAllowed(permission, 'write-fuel');
    return { allowed, isOwner: false, ownerUserId: allowed ? 'owner' : null, permission };
  };
  const none: AccessResult = { allowed: false, isOwner: false, ownerUserId: null, permission: null };

  it('lets the owner upload every type', () => {
    for (const type of ['vehicle-photo', 'receipt-photo', 'csv-import'] as const) {
      expect(uploadAllowed(type, owner)).toBe(true);
    }
  });

  it('lets record editors upload receipts, but not readonly shares or strangers', () => {
    for (const perm of ['fuel', 'maintenance', 'full'] as const) expect(uploadAllowed('receipt-photo', shared(perm))).toBe(true);
    expect(uploadAllowed('receipt-photo', shared('readonly'))).toBe(false);
    expect(uploadAllowed('receipt-photo', none)).toBe(false);
  });

  it('keeps vehicle photos owner-only (shared users cannot update vehicles)', () => {
    for (const perm of ['readonly', 'fuel', 'maintenance', 'full'] as const) {
      expect(uploadAllowed('vehicle-photo', shared(perm))).toBe(false);
    }
  });

  it("allows CSV imports for the owner and 'full' shares only, matching importData", () => {
    expect(uploadAllowed('csv-import', shared('full'))).toBe(true);
    for (const perm of ['readonly', 'fuel', 'maintenance'] as const) expect(uploadAllowed('csv-import', shared(perm))).toBe(false);
    expect(uploadAllowed('csv-import', none)).toBe(false);
  });
});
