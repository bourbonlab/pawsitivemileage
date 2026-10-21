/**
 * Cursor pagination for list endpoints (#26).
 *
 * - No `limit`: every item, following DynamoDB's 1 MB pages (today's behavior for clients).
 * - `limit`: one page; `nextCursor` (opaque, base64url) when more remain. Pass it back as `cursor`.
 * - `order`: asc (chronological, the default) or desc (newest first).
 *
 * A cursor is bound to the partition it came from: one from another vehicle, or a tampered one,
 * is rejected instead of being passed to DynamoDB.
 */
import { QueryCommand, type QueryCommandInput } from '@aws-sdk/lib-dynamodb';
import { getDocClient } from './dynamo.js';

export interface PageRequest {
  limit?: number;
  cursor?: string;
  order?: 'asc' | 'desc';
}

export interface Page<T> {
  items: T[];
  nextCursor?: string;
}

export class InvalidCursorError extends Error {
  constructor() {
    super('cursor is not valid for this list');
    this.name = 'InvalidCursorError';
  }
}

export function encodeCursor(lastEvaluatedKey: Record<string, unknown>): string {
  return Buffer.from(JSON.stringify(lastEvaluatedKey)).toString('base64url');
}

/** Decode a cursor, requiring its partition key to match the list being read */
export function decodeCursor(cursor: string, partitionKey: string, partitionValue: string): Record<string, unknown> {
  let key: unknown;
  try {
    key = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
  } catch {
    throw new InvalidCursorError();
  }
  if (!key || typeof key !== 'object' || Array.isArray(key) || (key as Record<string, unknown>)[partitionKey] !== partitionValue) {
    throw new InvalidCursorError();
  }
  return key as Record<string, unknown>;
}

/**
 * Query one partition. `query` must select a single partition (`partitionKey = partitionValue`)
 * and must not set Limit/ExclusiveStartKey/ScanIndexForward.
 */
export async function queryPage<T>(
  query: Omit<QueryCommandInput, 'Limit' | 'ExclusiveStartKey' | 'ScanIndexForward'>,
  partition: { key: string; value: string },
  page: PageRequest,
): Promise<Page<T>> {
  const docClient = getDocClient();
  const ScanIndexForward = page.order !== 'desc';

  if (page.limit === undefined) {
    const items: T[] = [];
    let ExclusiveStartKey: Record<string, unknown> | undefined;
    do {
      const result = await docClient.send(new QueryCommand({ ...query, ScanIndexForward, ExclusiveStartKey }));
      items.push(...((result.Items ?? []) as T[]));
      ExclusiveStartKey = result.LastEvaluatedKey;
    } while (ExclusiveStartKey);
    return { items };
  }

  const ExclusiveStartKey = page.cursor ? decodeCursor(page.cursor, partition.key, partition.value) : undefined;
  const result = await docClient.send(new QueryCommand({ ...query, ScanIndexForward, Limit: page.limit, ExclusiveStartKey }));
  return {
    items: (result.Items ?? []) as T[],
    ...(result.LastEvaluatedKey && { nextCursor: encodeCursor(result.LastEvaluatedKey) }),
  };
}
