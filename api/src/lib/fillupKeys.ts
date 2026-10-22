/**
 * Fill-up storage keys. A fill-up is stored once, under sort key `{date}#{fillupId}`.
 *
 * A stored key can disagree with the item's `date` if the date was changed outside the API.
 * Rewriting the vehicle's fill-ups (on every create/update/delete, and on recalculate) then put
 * a second copy under the new key and left the old one, so the fill-up was listed twice and its
 * metrics went wrong. Readers dedupe with canonicalFillups(), and writers delete the stale keys.
 */

export interface StoredFillup {
  fillupId: string;
  date: string;
  fillupDateId?: string;
  updatedAt?: string;
}

export const fillupSortKey = (f: { date: string; fillupId: string }): string => `${f.date}#${f.fillupId}`;

/**
 * One item per fill-up, in date order. When several stored items share a fillupId, the one whose
 * key matches its date wins, else the latest updatedAt. `staleKeys` are the stored sort keys to
 * delete once the kept items are written under fillupSortKey().
 */
export function canonicalFillups<T extends StoredFillup>(items: T[]): { fillups: T[]; staleKeys: string[] } {
  const byId = new Map<string, T[]>();
  for (const item of items) byId.set(item.fillupId, [...(byId.get(item.fillupId) ?? []), item]);

  const fillups: T[] = [];
  const staleKeys: string[] = [];
  for (const copies of byId.values()) {
    const keep = copies.find((c) => c.fillupDateId === fillupSortKey(c))
      ?? [...copies].sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''))[0];
    fillups.push(keep);
    for (const c of copies) {
      if (c.fillupDateId && c.fillupDateId !== fillupSortKey(keep)) staleKeys.push(c.fillupDateId);
    }
  }
  fillups.sort((a, b) => a.date.localeCompare(b.date) || a.fillupId.localeCompare(b.fillupId));
  return { fillups, staleKeys: [...new Set(staleKeys)] };
}
