import { describe, it, expect } from 'vitest';
import { isOperationAllowed } from '../../src/lib/authSharing';
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
