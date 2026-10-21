/**
 * Shared primitives and the response envelope for every /v1 endpoint.
 */
import * as z from 'zod';

/** App-generated IDs (vehicles, fill-ups, maintenance records, shares, schemas) */
export const Ulid = z.string().regex(/^[0-9A-HJKMNP-TV-Z]{26}$/).describe('ULID');

/** A user's ID: their Cognito `sub` */
export const UserId = z.guid().describe('Cognito user ID (sub)');

/** Calendar date as stored and returned by the API */
export const IsoDate = z.iso.date().describe('YYYY-MM-DD');

/** Timestamp, e.g. createdAt/updatedAt (UTC, `Date.toISOString()`) */
export const IsoDateTime = z.iso.datetime().describe('ISO 8601 UTC timestamp');

/** Calendar month used in analytics buckets */
export const YearMonth = z.string().regex(/^\d{4}-\d{2}$/).describe('YYYY-MM');

/**
 * Date accepted in request bodies. The handlers only check that it's a string today; the format
 * is documented so clients send YYYY-MM-DD (enforced from #18).
 */
export const DateInput = z.string().min(1).describe('YYYY-MM-DD');

export const ErrorCode = z.enum([
  'VALIDATION_ERROR',
  'UNAUTHORIZED',
  'FORBIDDEN',
  'NOT_FOUND',
  'CONFLICT',
  'INTERNAL_ERROR',
]);
export type ErrorCode = z.infer<typeof ErrorCode>;

/** Body of every non-2xx response */
export const ErrorResponse = z.object({
  error: z.string().describe('Human-readable message'),
  code: ErrorCode,
  requestId: z.string(),
});
export type ErrorResponse = z.infer<typeof ErrorResponse>;

/** Body of every 2xx response: `{ data, requestId }` */
export function successEnvelope<T extends z.ZodType>(data: T) {
  return z.object({ data, requestId: z.string() });
}

/** `{ deleted: true }`, returned by DELETE endpoints */
export const Deleted = z.object({ deleted: z.literal(true) });

/**
 * Response objects may carry extra keys today (internal DynamoDB keys such as GSI1PK, see #20),
 * so response schemas accept unknown keys until that cleanup ships.
 */
export const responseObject = z.looseObject;
