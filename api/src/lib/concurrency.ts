/**
 * Optimistic concurrency for updates (#25). A client sends `If-Match` with the record's
 * `updatedAt` (or the ETag from a previous response, which is that value quoted). If the record
 * changed since, the update is refused with 409 instead of silently overwriting someone else's
 * edit. Without the header, updates behave as before (last write wins).
 *
 * Vehicles and same-date maintenance updates use a DynamoDB condition, so the check is atomic.
 * Fill-up updates rewrite the vehicle's fill-ups in a batch (to recalculate metrics), and batch
 * writes can't be conditional, so there the check happens right after the read.
 */
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { error } from './response.js';

export const CONFLICT_MESSAGE = 'This record was changed after you loaded it; reload it and try again';

/** The expected `updatedAt` from If-Match, accepting `value`, `"value"` or `W/"value"` */
export function ifMatch(event: APIGatewayProxyEventV2): string | undefined {
  const raw = event.headers?.['if-match']?.trim();
  if (!raw || raw === '*') return undefined;
  return raw.replace(/^W\//, '').replace(/^"(.*)"$/, '$1');
}

/** 409 when If-Match is present and doesn't match the record's current updatedAt */
export function checkIfMatch(event: APIGatewayProxyEventV2, currentUpdatedAt: unknown, requestId: string): APIGatewayProxyResultV2 | null {
  const expected = ifMatch(event);
  return expected !== undefined && expected !== currentUpdatedAt ? error('CONFLICT', CONFLICT_MESSAGE, requestId) : null;
}

/** DynamoDB condition fragments enforcing If-Match atomically on a single-item write */
export function ifMatchCondition(event: APIGatewayProxyEventV2): {
  ConditionExpression?: string;
  names: Record<string, string>;
  values: Record<string, unknown>;
} {
  const expected = ifMatch(event);
  if (expected === undefined) return { names: {}, values: {} };
  return {
    ConditionExpression: '#ifMatchUpdatedAt = :ifMatchUpdatedAt',
    names: { '#ifMatchUpdatedAt': 'updatedAt' },
    values: { ':ifMatchUpdatedAt': expected },
  };
}

export const isConditionFailure = (err: unknown) => (err as Error)?.name === 'ConditionalCheckFailedException';
