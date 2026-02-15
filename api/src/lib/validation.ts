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
 * Parse a JSON request body, returning null if parsing fails.
 */
export function parseBody(body: string | null | undefined): Record<string, unknown> | null {
  if (!body) return null;
  try {
    return JSON.parse(body) as Record<string, unknown>;
  } catch {
    return null;
  }
}
