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

const omitStorageKeys = (key: string, value: unknown) => (STORAGE_KEY.test(key) ? undefined : value);

export function success<T>(data: T, requestId: string, statusCode = 200) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ data, requestId }, omitStorageKeys),
  };
}

export function error(code: ApiErrorCode, message: string, requestId: string) {
  return {
    statusCode: ERROR_STATUS_MAP[code],
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ error: message, code, requestId }),
  };
}
