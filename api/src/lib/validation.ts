export interface ValidationError {
  field: string;
  message: string;
}

/**
 * Validate that all required fields are present and non-empty on the body object.
 */
export function validateRequired(body: Record<string, unknown>, fields: string[]): ValidationError[] {
  const errors: ValidationError[] = [];
  for (const field of fields) {
    const value = body[field];
    if (value === undefined || value === null || value === '') {
      errors.push({ field, message: `${field} is required` });
    }
  }
  return errors;
}

/**
 * Validate that specified fields are of the expected type.
 */
export function validateTypes(
  body: Record<string, unknown>,
  schema: Record<string, 'string' | 'number' | 'boolean'>,
): ValidationError[] {
  const errors: ValidationError[] = [];
  for (const [field, expectedType] of Object.entries(schema)) {
    const value = body[field];
    if (value !== undefined && value !== null && typeof value !== expectedType) {
      errors.push({ field, message: `${field} must be a ${expectedType}` });
    }
  }
  return errors;
}

/**
 * Validate that numeric fields fall within the specified range (inclusive).
 */
export function validateRange(
  body: Record<string, unknown>,
  ranges: Record<string, { min?: number; max?: number }>,
): ValidationError[] {
  const errors: ValidationError[] = [];
  for (const [field, { min, max }] of Object.entries(ranges)) {
    const value = body[field];
    if (typeof value !== 'number') continue;
    if (!Number.isFinite(value)) {
      errors.push({ field, message: `${field} must be a finite number` });
      continue;
    }
    if (min !== undefined && value < min) {
      errors.push({ field, message: `${field} must be at least ${min}` });
    }
    if (max !== undefined && value > max) {
      errors.push({ field, message: `${field} must be at most ${max}` });
    }
  }
  return errors;
}

/**
 * Parse a JSON request body with size enforcement.
 * Returns null if body is missing, exceeds maxBytes, or is invalid JSON.
 */
export function parseBody(
  body: string | null | undefined,
  maxBytes: number = 65_536
): Record<string, unknown> | null {
  if (!body) return null;
  if (body.length > maxBytes) return null;
  try {
    return JSON.parse(body) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/**
 * Validate that string fields do not exceed specified maximum lengths.
 */
export function validateStringLength(
  body: Record<string, unknown>,
  limits: Record<string, number>,
): ValidationError[] {
  const errors: ValidationError[] = [];
  for (const [field, limit] of Object.entries(limits)) {
    const value = body[field];
    if (typeof value === 'string' && value.length > limit) {
      errors.push({ field, message: `${field} must be at most ${limit} characters` });
    }
  }
  return errors;
}

/**
 * Validate that location coordinates are valid numbers within geographic range.
 * locationLat must be in [-90, 90], locationLng must be in [-180, 180].
 * Only validates fields that are present in the body. Rejects NaN and Infinity.
 */
export function validateCoordinates(
  body: Record<string, unknown>,
): ValidationError[] {
  const errors: ValidationError[] = [];

  if ('locationLat' in body && body.locationLat !== undefined && body.locationLat !== null) {
    const lat = body.locationLat;
    if (typeof lat !== 'number' || !Number.isFinite(lat)) {
      errors.push({ field: 'locationLat', message: 'locationLat must be a finite number' });
    } else if (lat < -90 || lat > 90) {
      errors.push({ field: 'locationLat', message: 'locationLat must be between -90 and 90' });
    }
  }

  if ('locationLng' in body && body.locationLng !== undefined && body.locationLng !== null) {
    const lng = body.locationLng;
    if (typeof lng !== 'number' || !Number.isFinite(lng)) {
      errors.push({ field: 'locationLng', message: 'locationLng must be a finite number' });
    } else if (lng < -180 || lng > 180) {
      errors.push({ field: 'locationLng', message: 'locationLng must be between -180 and 180' });
    }
  }

  return errors;
}

/**
 * Sanitize a filename for safe use in S3 keys.
 * Strips path separators, removes disallowed characters, trims whitespace,
 * and truncates to 255 characters. Returns null if the result is empty.
 */
export function sanitizeFilename(filename: string): string | null {
  const stripped = filename.replace(/[/\\]/g, '');
  const cleaned = stripped.replace(/[^a-zA-Z0-9._\- ]/g, '');
  const trimmed = cleaned.trim();
  const truncated = trimmed.slice(0, 255);
  return truncated.length > 0 ? truncated : null;
}



