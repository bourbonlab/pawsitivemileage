import { describe, it, expect } from 'vitest';
import {
  canonical, findUnmappedUserIds, keyString, remapItem, remapString, s3KeyOwner, unmappedUuids, type Item,
} from '../src/migrate/remap.js';

const OLD = '11111111-aaaa-4bbb-8ccc-222222222222';
const NEW = '99999999-dddd-4eee-8fff-000000000000';
const OTHER_OLD = '33333333-aaaa-4bbb-8ccc-444444444444';
const FILENAME_UUID = '5c6d7e8f-1234-4abc-9def-0123456789ab';
const map = new Map([[OLD, NEW]]);
const known = new Set([OLD, OTHER_OLD]);

describe('remapString', () => {
  it('rewrites a whole-value sub', () => {
    expect(remapString(OLD, map)).toBe(NEW);
  });

  it('rewrites the owner segment of an S3 key but leaves a UUID-named file alone', () => {
    const key = `${OLD}/01JABCDEFGHJKMNPQRSTVWXYZ0/vehicle-photo/${FILENAME_UUID}-1_all_13037.jpg`;
    expect(remapString(key, map)).toBe(`${NEW}/01JABCDEFGHJKMNPQRSTVWXYZ0/vehicle-photo/${FILENAME_UUID}-1_all_13037.jpg`);
  });

  it('matches subs case-insensitively', () => {
    expect(remapString(OLD.toUpperCase(), map)).toBe(NEW);
  });

  it('leaves strings without mapped subs unchanged', () => {
    expect(remapString('VEHICLES', map)).toBe('VEHICLES');
    expect(remapString(`user ${OTHER_OLD}`, map)).toBe(`user ${OTHER_OLD}`);
  });
});

describe('remapItem', () => {
  it('rewrites keys, GSI attributes, sets, nested maps and lists; leaves other types intact', () => {
    const item: Item = {
      vehicleId: { S: '01JABCDEFGHJKMNPQRSTVWXYZ0' },
      userId: { S: OLD },
      GSI1PK: { S: OLD },
      receiptPhotoKey: { S: `${OLD}/v/receipt-photo/r.jpg` },
      tags: { SS: [OLD, 'x'] },
      meta: { M: { owner: { S: OLD }, history: { L: [{ S: OLD }, { N: '42.10' }] } } },
      gallons: { N: '12.345' },
      isBusiness: { BOOL: false },
      note: { NULL: true },
    };
    expect(remapItem(item, map)).toEqual({
      vehicleId: { S: '01JABCDEFGHJKMNPQRSTVWXYZ0' },
      userId: { S: NEW },
      GSI1PK: { S: NEW },
      receiptPhotoKey: { S: `${NEW}/v/receipt-photo/r.jpg` },
      tags: { SS: [NEW, 'x'] },
      meta: { M: { owner: { S: NEW }, history: { L: [{ S: NEW }, { N: '42.10' }] } } },
      gallons: { N: '12.345' },
      isBusiness: { BOOL: false },
      note: { NULL: true },
    });
  });

  it('preserves exact number strings (no float round-trip)', () => {
    expect(remapItem({ price: { N: '3.1000000000000000001' } }, map)).toEqual({ price: { N: '3.1000000000000000001' } });
  });
});

describe('findUnmappedUserIds', () => {
  it('passes items whose user-ID fields belong to known source users', () => {
    const item: Item = { userId: { S: OLD }, GSI1PK: { S: OTHER_OLD }, receiptPhotoKey: { S: `${OLD}/v/receipt-photo/r.jpg` } };
    expect(findUnmappedUserIds('fillups', item, known)).toEqual([]);
  });

  it('flags orphaned owners in user-ID fields and photo keys', () => {
    const orphan = '77777777-aaaa-4bbb-8ccc-888888888888';
    const item: Item = { userId: { S: orphan }, photoKey: { S: `${orphan}/v/vehicle-photo/${FILENAME_UUID}.jpg` } };
    expect(findUnmappedUserIds('vehicles', item, known)).toEqual([
      { attribute: 'userId', value: orphan },
      { attribute: 'photoKey', value: `${orphan}/v/vehicle-photo/${FILENAME_UUID}.jpg` },
    ]);
  });

  it('does not treat non-user GSI values as user IDs', () => {
    expect(findUnmappedUserIds('vehicles', { userId: { S: OLD }, GSI1PK: { S: 'VEHICLES' } }, known)).toEqual([]);
    expect(findUnmappedUserIds('sharing', { ownerUserId: { S: OLD }, GSI1PK: { S: 'friend@example.com' } }, known)).toEqual([]);
  });
});

describe('unmappedUuids', () => {
  it('reports UUIDs that are not mapped subs (e.g. in filenames)', () => {
    const item: Item = { photoKey: { S: `${OLD}/v/vehicle-photo/${FILENAME_UUID}-1.jpg` } };
    expect(unmappedUuids(item, map)).toEqual([FILENAME_UUID]);
  });
});

describe('keyString / canonical', () => {
  it('builds the primary key string from the table key schema', () => {
    const item: Item = { ownerUserId: { S: NEW }, vehicleEmailKey: { S: 'v#a@b.c' }, extra: { S: 'ignored' } };
    expect(keyString('sharing', item)).toBe(`{"S":"${NEW}"}|{"S":"v#a@b.c"}`);
  });

  it('ignores attribute order and string-set member order', () => {
    expect(canonical({ b: { SS: ['y', 'x'] }, a: { S: '1' } })).toBe(canonical({ a: { S: '1' }, b: { SS: ['x', 'y'] } }));
  });

  it('extracts the owner segment of a photo key', () => {
    expect(s3KeyOwner(`${OLD}/v/receipt-photo/r.jpg`)).toBe(OLD);
  });
});
