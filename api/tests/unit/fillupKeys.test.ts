import { describe, it, expect } from 'vitest';
import { canonicalFillups, fillupSortKey } from '../../src/lib/fillupKeys';

const ID = '01KHHJSXNKX2DRMAG1110MHGR5';
const item = (fillupDateId: string, date: string, extra: Record<string, unknown> = {}) => ({ fillupId: ID, date, fillupDateId, ...extra });

describe('canonicalFillups', () => {
  it('passes clean data through, in date order, with nothing stale', () => {
    const a = { fillupId: 'A', date: '2026-02-01', fillupDateId: '2026-02-01#A' };
    const b = { fillupId: 'B', date: '2026-01-01', fillupDateId: '2026-01-01#B' };
    expect(canonicalFillups([a, b])).toEqual({ fillups: [b, a], staleKeys: [] });
  });

  it('collapses the production duplicate: keeps the copy whose key matches its date', () => {
    const ghost = item(`0024-08-29#${ID}`, '2024-08-29', { mpg: 10.7 });
    const real = item(`2024-08-29#${ID}`, '2024-08-29', { mpg: 0 });
    const { fillups, staleKeys } = canonicalFillups([ghost, real]);
    expect(fillups).toEqual([real]);
    expect(staleKeys).toEqual([`0024-08-29#${ID}`]);
  });

  it('re-keys a single item whose key disagrees with its date', () => {
    const { fillups, staleKeys } = canonicalFillups([item(`0024-08-29#${ID}`, '2024-08-29')]);
    expect(fillupSortKey(fillups[0])).toBe(`2024-08-29#${ID}`);
    expect(staleKeys).toEqual([`0024-08-29#${ID}`]);
  });

  it('without a matching key, keeps the most recently updated copy', () => {
    const older = item('2024-01-01#X', '2024-08-29', { updatedAt: '2026-01-01T00:00:00Z' });
    const newer = item('2024-02-02#X', '2024-08-29', { updatedAt: '2026-02-01T00:00:00Z' });
    const { fillups, staleKeys } = canonicalFillups([older, newer]);
    expect(fillups).toEqual([newer]);
    expect(staleKeys.sort()).toEqual(['2024-01-01#X', '2024-02-02#X']);
  });
});
