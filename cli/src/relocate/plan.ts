/**
 * Planning for relocate-files (#2): find photo-bucket references stored under someone other
 * than the vehicle owner, and work out where each file belongs. Pure, so it is unit-tested.
 */

export type KeyField = 'photoKey' | 'receiptPhotoKey';
export type UploadType = 'vehicle-photo' | 'receipt-photo';

export interface Reference {
  table: 'vehicles' | 'fillups' | 'maintenance';
  /** The item's primary key, for the conditional update */
  key: Record<string, string>;
  /** fillupId / recordId / vehicleId, for the report */
  id: string;
  vehicleId: string;
  field: KeyField;
  objectKey: string;
}

export interface Move extends Reference {
  ownerUserId: string;
  newKey: string;
}

const ULID_PREFIX = /^[0-9A-HJKMNP-TV-Z]{26}-/;

/**
 * Where a file belongs: `{owner}/{vehicleId}/{type}/{ulid}-{filename}`. A filename that already
 * starts with a ULID keeps it; older keys get a new one so the target can't collide.
 */
export function relocatedKey(objectKey: string, ownerUserId: string, vehicleId: string, type: UploadType, newUlid: () => string): string {
  const filename = objectKey.split('/').pop() ?? objectKey;
  return `${ownerUserId}/${vehicleId}/${type}/${ULID_PREFIX.test(filename) ? filename : `${newUlid()}-${filename}`}`;
}

export const uploadTypeOf = (field: KeyField): UploadType => (field === 'photoKey' ? 'vehicle-photo' : 'receipt-photo');

/**
 * References whose first key segment isn't the vehicle's owner. References to vehicles that no
 * longer exist are returned separately (nothing to move them to).
 */
export function planMoves(refs: Reference[], ownerOf: Map<string, string>, newUlid: () => string): { moves: Move[]; orphaned: Reference[] } {
  const moves: Move[] = [];
  const orphaned: Reference[] = [];
  // One file referenced by several records moves once, to one new key
  const targets = new Map<string, string>();
  for (const ref of refs) {
    const ownerUserId = ownerOf.get(ref.vehicleId);
    if (!ownerUserId) {
      orphaned.push(ref);
      continue;
    }
    if (ref.objectKey.split('/')[0] === ownerUserId) continue;
    const newKey = targets.get(ref.objectKey)
      ?? relocatedKey(ref.objectKey, ownerUserId, ref.vehicleId, uploadTypeOf(ref.field), newUlid);
    targets.set(ref.objectKey, newKey);
    moves.push({ ...ref, ownerUserId, newKey });
  }
  return { moves, orphaned };
}

/** Old objects that no reference will point at once the moves are done */
export function deletableKeys(moves: Move[], allRefs: Reference[]): string[] {
  const moved = new Set(moves.map((m) => `${m.table}|${JSON.stringify(m.key)}|${m.field}`));
  const stillUsed = new Set(
    allRefs.filter((r) => !moved.has(`${r.table}|${JSON.stringify(r.key)}|${r.field}`)).map((r) => r.objectKey),
  );
  return [...new Set(moves.map((m) => m.objectKey))].filter((key) => !stillUsed.has(key));
}
