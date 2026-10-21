/**
 * Request parsing helpers. Field validation lives in the API contract
 * (@pawsitivemileage/contracts, applied via ./contract.ts, #18).
 */

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
