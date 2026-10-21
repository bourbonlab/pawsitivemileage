import { describe, it, expect } from 'vitest';
import { deletableKeys, planMoves, relocatedKey, type Reference } from '../src/relocate/plan.js';

const OWNER = '11111111-aaaa-4bbb-8ccc-222222222222';
const SHARER = '33333333-aaaa-4bbb-8ccc-444444444444';
const V1 = '01KHKHBG12P5BK5724XW7X0D30';
const ULID = '01KS5M8EYJ5VP2GYMBBEQZ5VPH';
const newUlid = () => '01M5ZZZZZZZZZZZZZZZZZZZZZZ';
const owners = new Map([[V1, OWNER]]);
const ref = (over: Partial<Reference>): Reference => ({
  table: 'fillups', key: { vehicleId: V1, fillupDateId: `2026-01-01#${ULID}` }, id: ULID, vehicleId: V1,
  field: 'receiptPhotoKey', objectKey: `${SHARER}/${V1}/receipt-photo/receipt.jpg`, ...over,
});

describe('relocatedKey', () => {
  it('moves under the owner, adding a ULID to old-style filenames and keeping an existing one', () => {
    expect(relocatedKey(`${SHARER}/${V1}/receipt-photo/receipt.jpg`, OWNER, V1, 'receipt-photo', newUlid))
      .toBe(`${OWNER}/${V1}/receipt-photo/01M5ZZZZZZZZZZZZZZZZZZZZZZ-receipt.jpg`);
    expect(relocatedKey(`${SHARER}/${V1}/receipt-photo/${ULID}-my receipt.pdf`, OWNER, V1, 'receipt-photo', newUlid))
      .toBe(`${OWNER}/${V1}/receipt-photo/${ULID}-my receipt.pdf`);
  });
});

describe('planMoves', () => {
  it('moves only references not under the owner, and reports orphans', () => {
    const own = ref({ id: 'own', objectKey: `${OWNER}/${V1}/receipt-photo/${ULID}-a.jpg` });
    const misplaced = ref({ id: 'bad' });
    const orphan = ref({ id: 'orphan', vehicleId: '01GONEGONEGONEGONEGONEGONE' });
    const { moves, orphaned } = planMoves([own, misplaced, orphan], owners, newUlid);
    expect(moves.map((m) => m.id)).toEqual(['bad']);
    expect(moves[0].newKey.startsWith(`${OWNER}/${V1}/receipt-photo/`)).toBe(true);
    expect(orphaned.map((r) => r.id)).toEqual(['orphan']);
  });

  it('uses the vehicle-photo folder for vehicle photos', () => {
    const { moves } = planMoves([ref({ table: 'vehicles', field: 'photoKey', objectKey: `${SHARER}/${V1}/vehicle-photo/car.png` })], owners, newUlid);
    expect(moves[0].newKey).toBe(`${OWNER}/${V1}/vehicle-photo/01M5ZZZZZZZZZZZZZZZZZZZZZZ-car.png`);
  });

  it('gives one shared file one new key', () => {
    let n = 0;
    const counter = () => `01M5ZZZZZZZZZZZZZZZZZZZZZ${n++}`;
    const { moves } = planMoves([ref({ id: 'a' }), ref({ id: 'b', key: { vehicleId: V1, fillupDateId: 'x' } })], owners, counter);
    expect(new Set(moves.map((m) => m.newKey)).size).toBe(1);
  });
});

describe('deletableKeys', () => {
  it('keeps an old object that an unmoved record still references', () => {
    const moved = ref({ id: 'a' });
    const other = ref({ id: 'b', table: 'maintenance', key: { vehicleId: V1, serviceDateId: 'y' } });
    const { moves } = planMoves([moved], owners, newUlid);
    expect(deletableKeys(moves, [moved])).toEqual([moved.objectKey]);
    expect(deletableKeys(moves, [moved, other])).toEqual([]);
  });
});
