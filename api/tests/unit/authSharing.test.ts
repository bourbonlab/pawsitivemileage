import { describe, it, expect, vi, beforeEach } from 'vitest';
import { isOperationAllowed } from '../../src/lib/authSharing';
import type { SharePermission } from '../../src/types/sharing';

// Test the pure function — no DynamoDB mocking needed

describe('isOperationAllowed', () => {
  const permissions: SharePermission[] = ['readonly', 'fuel', 'maintenance', 'full'];

  describe('read operation', () => {
    it('is allowed for all permission levels', () => {
      for (const perm of permissions) {
        expect(isOperationAllowed(perm, 'read')).toBe(true);
      }
    });
  });

  describe('write-fuel operation', () => {
    it('is allowed for fuel permission', () => {
      expect(isOperationAllowed('fuel', 'write-fuel')).toBe(true);
    });

    it('is allowed for full permission', () => {
      expect(isOperationAllowed('full', 'write-fuel')).toBe(true);
    });

    it('is denied for readonly permission', () => {
      expect(isOperationAllowed('readonly', 'write-fuel')).toBe(false);
    });

    it('is denied for maintenance permission', () => {
      expect(isOperationAllowed('maintenance', 'write-fuel')).toBe(false);
    });
  });

  describe('write-maintenance operation', () => {
    it('is allowed for maintenance permission', () => {
      expect(isOperationAllowed('maintenance', 'write-maintenance')).toBe(true);
    });

    it('is allowed for full permission', () => {
      expect(isOperationAllowed('full', 'write-maintenance')).toBe(true);
    });

    it('is denied for readonly permission', () => {
      expect(isOperationAllowed('readonly', 'write-maintenance')).toBe(false);
    });

    it('is denied for fuel permission', () => {
      expect(isOperationAllowed('fuel', 'write-maintenance')).toBe(false);
    });
  });

  describe('unknown operation', () => {
    it('is denied for any permission', () => {
      // Cast to bypass type checking for edge case
      expect(isOperationAllowed('full', 'delete' as any)).toBe(false);
    });
  });
});
