import type { ApiErrorCode } from '../types/api.js';

const ERROR_STATUS_MAP: Record<ApiErrorCode, number> = {
  VALIDATION_ERROR: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  INTERNAL_ERROR: 500,
};

/**
 * DynamoDB storage keys that are never part of the API (#20): GSI keys and composite sort keys.
 * Handlers often return items straight from DynamoDB, so they are dropped here, at any depth.
 */
const STORAGE_KEY = /^(GSI\d+(PK|SK)|fillupDateId|serviceDateId|vehicleEmailKey)$/;

/** Photo-bucket key fields and the absolute URL field added next to each (#21) */
const MEDIA_FIELDS: Record<string, string> = { photoKey: 'photoUrl', receiptPhotoKey: 'receiptPhotoUrl' };

/**
 * Absolute URL for a photo-bucket key: served by the frontend CloudFront at /photos/{key}.
 * Native clients have no web origin, so they need this rather than the key. Segments are encoded
 * (keys can contain spaces). Undefined when FRONTEND_DOMAIN isn't configured.
 */
export function mediaUrl(key: string): string | undefined {
  const domain = process.env.FRONTEND_DOMAIN;
  return domain ? `https://${domain}/photos/${key.split('/').map(encodeURIComponent).join('/')}` : undefined;
}

/** JSON.stringify replacer: drop storage keys, add media URLs next to photo keys */
function serialize(key: string, value: unknown): unknown {
  if (STORAGE_KEY.test(key)) return undefined;
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const record = value as Record<string, unknown>;
    let withUrls: Record<string, unknown> | undefined;
    for (const [keyField, urlField] of Object.entries(MEDIA_FIELDS)) {
      const mediaKey = record[keyField];
      if (typeof mediaKey === 'string' && mediaKey && record[urlField] === undefined) {
        const url = mediaUrl(mediaKey);
        if (url) (withUrls ??= { ...record })[urlField] = url;
      }
    }
    if (withUrls) return withUrls;
  }
  return value;
}

/**
 * ETag for a single record: its updatedAt, quoted. Clients send it back in If-Match to update
 * only if nobody else changed the record in between (#25).
 */
function etag(data: unknown): string | undefined {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return undefined;
  const updatedAt = (data as { updatedAt?: unknown }).updatedAt;
  return typeof updatedAt === 'string' ? `"${updatedAt}"` : undefined;
}

/** `extra` adds envelope-level fields next to data/requestId (e.g. nextCursor, #26) */
export function success<T>(data: T, requestId: string, statusCode = 200, extra?: Record<string, unknown>) {
  const tag = etag(data);
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json', ...(tag && { ETag: tag }) },
    body: JSON.stringify({ data, requestId, ...extra }, serialize),
  };
}

export function error(code: ApiErrorCode, message: string, requestId: string) {
  return {
    statusCode: ERROR_STATUS_MAP[code],
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ error: message, code, requestId }),
  };
}
