/**
 * Pure helpers for the account migration: rewriting Cognito user IDs (subs)
 * inside DynamoDB items and S3 keys, and checking that every field that
 * structurally holds a user ID maps to a migrated user.
 *
 * App-generated IDs are ULIDs, so the only UUIDs the app writes are Cognito
 * subs. User-supplied strings (e.g. photo filenames) can still contain UUIDs,
 * so only UUIDs present in the mapping are rewritten — never "every UUID".
 */
import type { AttributeValue } from '@aws-sdk/client-dynamodb';

/** old sub (lowercase) → new sub */
export type SubMap = ReadonlyMap<string, string>;

export type Item = Record<string, AttributeValue>;

export const TABLES = ['users', 'vehicles', 'fillups', 'maintenance', 'schemas', 'sharing'] as const;
export type TableName = (typeof TABLES)[number];

/** Primary key attributes per table (mirrors infra/lib/stacks/database-stack.ts) */
export const KEY_ATTRS: Record<TableName, readonly string[]> = {
  users: ['userId'],
  vehicles: ['userId', 'vehicleId'],
  fillups: ['vehicleId', 'fillupDateId'],
  maintenance: ['vehicleId', 'serviceDateId'],
  schemas: ['schemaId'],
  sharing: ['ownerUserId', 'vehicleEmailKey'],
};

/** Attributes whose whole value is a user ID; when present they must map to a migrated user */
const USER_ID_ATTRS: Record<TableName, readonly string[]> = {
  users: ['userId'],
  vehicles: ['userId'],
  fillups: ['userId', 'GSI1PK'],
  maintenance: ['userId', 'GSI1PK'],
  schemas: [],
  sharing: ['ownerUserId'],
};

/** Attributes holding photo-bucket keys, shaped `{userId}/{vehicleId}/{type}/{filename}` */
const S3_KEY_ATTRS = ['photoKey', 'receiptPhotoKey'] as const;

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

export function tableName(table: TableName, env: string): string {
  return `pawsitivemileage-${table}-${env}`;
}

/** Replace every mapped sub inside a string; unmapped UUIDs are left untouched. */
export function remapString(value: string, map: SubMap): string {
  return value.replace(UUID_RE, (match) => map.get(match.toLowerCase()) ?? match);
}

/** Deep-remap a DynamoDB attribute value (S, SS, M keys/values, L); other types pass through. */
export function remapAttributeValue(value: AttributeValue, map: SubMap): AttributeValue {
  if (value.S !== undefined) return { S: remapString(value.S, map) };
  if (value.SS !== undefined) return { SS: value.SS.map((s) => remapString(s, map)) };
  if (value.M !== undefined) return { M: remapItem(value.M, map) };
  if (value.L !== undefined) return { L: value.L.map((v) => remapAttributeValue(v, map)) };
  return value;
}

export function remapItem(item: Item, map: SubMap): Item {
  const out: Item = {};
  for (const [name, value] of Object.entries(item)) {
    out[remapString(name, map)] = remapAttributeValue(value, map);
  }
  return out;
}

/** The owning user ID of a photo-bucket key (its first path segment). */
export function s3KeyOwner(key: string): string {
  return key.split('/', 1)[0];
}

export interface UnmappedUserId {
  attribute: string;
  value: string;
}

/**
 * Structural user-ID fields that don't map to a known source user — i.e. orphaned
 * data whose owner no longer exists in the source user pool. `knownSubs` are the
 * source pool's subs (lowercase).
 */
export function findUnmappedUserIds(table: TableName, item: Item, knownSubs: ReadonlySet<string>): UnmappedUserId[] {
  const problems: UnmappedUserId[] = [];
  for (const attribute of USER_ID_ATTRS[table]) {
    const value = item[attribute]?.S;
    if (value !== undefined && !knownSubs.has(value.toLowerCase())) problems.push({ attribute, value });
  }
  for (const attribute of S3_KEY_ATTRS) {
    const value = item[attribute]?.S;
    if (value && !knownSubs.has(s3KeyOwner(value).toLowerCase())) problems.push({ attribute, value });
  }
  return problems;
}

/** Distinct UUIDs anywhere in the item that are not mapped subs (informational only). */
export function unmappedUuids(item: Item, map: SubMap): string[] {
  const found = new Set<string>();
  const visit = (value: AttributeValue): void => {
    const strings = value.S !== undefined ? [value.S] : value.SS ?? [];
    for (const s of strings) for (const m of s.match(UUID_RE) ?? []) if (!map.has(m.toLowerCase())) found.add(m);
    if (value.M) Object.values(value.M).forEach(visit);
    if (value.L) value.L.forEach(visit);
  };
  Object.values(item).forEach(visit);
  return [...found];
}

/** Stable string form of an item's primary key, for matching source and target items. */
export function keyString(table: TableName, item: Item): string {
  return KEY_ATTRS[table].map((attr) => canonical(item[attr])).join('|');
}

/** Order-independent canonical JSON (object keys and set members sorted) for equality checks. */
export function canonical(value: unknown): string {
  return JSON.stringify(normalize(value));
}

function normalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalize);
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => [k, (k === 'SS' || k === 'NS') && Array.isArray(v) ? [...v].sort() : normalize(v)]);
    return Object.fromEntries(entries);
  }
  return value;
}
