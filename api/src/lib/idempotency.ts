/**
 * Idempotency-Key support for create requests (#24). A client that retries a POST after a
 * timeout gets the original response back instead of creating a duplicate.
 *
 * - Keys are scoped per user ("{userId}#{key}") and kept for 24 hours (DynamoDB TTL).
 * - A pending record is written with a conditional put before the work starts, so two concurrent
 *   requests with the same key can't both create.
 * - Same key + same request (method, path, body) → the stored response, with
 *   `Idempotent-Replayed: true`. Same key + different request → 409. Still in flight → 409.
 * - 5xx responses (and thrown errors) clear the record, so a retry runs again.
 * - Requests without the header behave exactly as before.
 */
import { createHash } from 'node:crypto';
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { DeleteCommand, GetCommand, PutCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { getDocClient, getTableName } from './dynamo.js';
import { error } from './response.js';

const TTL_SECONDS = 24 * 60 * 60;
const KEY_PATTERN = /^[A-Za-z0-9_-]{1,255}$/;

type StructuredResult = { statusCode: number; headers?: Record<string, string | number | boolean>; body?: string };

interface IdempotencyRecord {
  id: string;
  requestHash: string;
  state: 'pending' | 'completed';
  statusCode?: number;
  body?: string;
}

/** API Gateway v2 lowercases header names */
export function idempotencyKey(event: APIGatewayProxyEventV2): string | undefined {
  return event.headers?.['idempotency-key'];
}

export function requestHash(event: APIGatewayProxyEventV2): string {
  return createHash('sha256')
    .update(`${event.requestContext?.http?.method}\n${event.rawPath}\n${event.body ?? ''}`)
    .digest('hex');
}

export async function withIdempotency(
  event: APIGatewayProxyEventV2,
  userId: string,
  requestId: string,
  handle: () => Promise<APIGatewayProxyResultV2>,
): Promise<APIGatewayProxyResultV2> {
  const key = idempotencyKey(event);
  if (key === undefined) return handle();
  if (!KEY_PATTERN.test(key)) {
    return error('VALIDATION_ERROR', 'Idempotency-Key must be 1-255 characters of letters, digits, "-" or "_"', requestId);
  }

  const docClient = getDocClient();
  const TableName = getTableName('IDEMPOTENCY_TABLE');
  const id = `${userId}#${key}`;
  const hash = requestHash(event);

  try {
    await docClient.send(new PutCommand({
      TableName,
      Item: { id, requestHash: hash, state: 'pending', createdAt: new Date().toISOString(), expiresAt: Math.floor(Date.now() / 1000) + TTL_SECONDS },
      ConditionExpression: 'attribute_not_exists(id)',
    }));
  } catch (err) {
    if ((err as Error).name !== 'ConditionalCheckFailedException') throw err;
    const { Item } = await docClient.send(new GetCommand({ TableName, Key: { id }, ConsistentRead: true }));
    const existing = Item as IdempotencyRecord | undefined;
    if (!existing) return handle(); // expired between the two calls: treat as new
    if (existing.requestHash !== hash) {
      return error('CONFLICT', 'Idempotency-Key was already used for a different request', requestId);
    }
    if (existing.state !== 'completed' || existing.statusCode === undefined) {
      return error('CONFLICT', 'A request with this Idempotency-Key is still in progress', requestId);
    }
    return {
      statusCode: existing.statusCode,
      headers: { 'Content-Type': 'application/json', 'Idempotent-Replayed': 'true' },
      body: existing.body,
    };
  }

  let result: StructuredResult;
  try {
    result = await handle() as StructuredResult;
  } catch (err) {
    await docClient.send(new DeleteCommand({ TableName, Key: { id } }));
    throw err;
  }

  if (result.statusCode >= 500) {
    await docClient.send(new DeleteCommand({ TableName, Key: { id } }));
  } else {
    await docClient.send(new UpdateCommand({
      TableName,
      Key: { id },
      UpdateExpression: 'SET #state = :completed, statusCode = :status, body = :body',
      ExpressionAttributeNames: { '#state': 'state' },
      ExpressionAttributeValues: { ':completed': 'completed', ':status': result.statusCode, ':body': result.body ?? '' },
    }));
  }
  return result;
}
