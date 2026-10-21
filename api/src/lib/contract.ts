/**
 * Request validation against @pawsitivemileage/contracts (#18). Handlers validate bodies and
 * queries with the contract's schemas, so the API can't drift from what clients are told.
 *
 * Messages keep the wording clients already show ("gallonsAdded must be at least 0.01",
 * "nickname is required"), joined with "; ".
 */
import type { z } from 'zod';

type Issue = z.core.$ZodIssue;

function valueAt(input: unknown, path: PropertyKey[]): unknown {
  let current = input;
  for (const key of path) {
    if (current === null || typeof current !== 'object') return undefined;
    current = (current as Record<PropertyKey, unknown>)[key];
  }
  return current;
}

/** zod's built-in messages; anything else was written in the contract and is used as-is */
const ZOD_DEFAULT_MESSAGE = /^(Invalid|Too (big|small))\b/;

/** One handler-style message per issue */
export function formatIssue(issue: Issue, input: unknown): string {
  if (!ZOD_DEFAULT_MESSAGE.test(issue.message)) return issue.message;
  const field = issue.path.map(String).join('.') || 'body';
  const value = valueAt(input, issue.path);
  switch (issue.code) {
    case 'invalid_type':
      return value === undefined || value === null ? `${field} is required` : `${field} must be a ${issue.expected === 'int' ? 'number' : issue.expected}`;
    case 'too_small':
      if (issue.origin === 'string') return value === '' ? `${field} is required` : `${field} must be at least ${issue.minimum} characters`;
      if (issue.minimum === 0 && !issue.inclusive) return `${field} must be a positive number`;
      return `${field} must be at least ${issue.minimum}`;
    case 'too_big':
      return issue.origin === 'string' ? `${field} must be at most ${issue.maximum} characters` : `${field} must be at most ${issue.maximum}`;
    case 'invalid_value':
      return `${field} must be one of: ${issue.values.map(String).join(', ')}`;
    default:
      return `${field} is not valid`;
  }
}

export type Validated<T> = { ok: true; data: T } | { ok: false; message: string };

/** Validate a parsed body (or query) against a contract schema */
export function validate<S extends z.ZodType>(schema: S, input: unknown): Validated<z.output<S>> {
  const result = schema.safeParse(input);
  if (result.success) return { ok: true, data: result.data };
  const messages = [...new Set(result.error.issues.map((issue) => formatIssue(issue, input)))];
  return { ok: false, message: messages.join('; ') };
}
