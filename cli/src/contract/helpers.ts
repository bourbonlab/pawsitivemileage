/**
 * Pure helpers for the live contract conformance check (cli/src/contract-check.ts).
 */
import type { z } from 'zod';

/** `METHOD /path` → Lambda handler name, parsed from the addRoute calls in api-stack.ts */
export function parseRouteHandlers(apiStackSource: string): Map<string, string> {
  const handlers = new Map<string, string>();
  for (const [, method, path, fn] of apiStackSource.matchAll(/addRoute\(apigwv2\.HttpMethod\.(\w+),\s*'([^']+)',\s*'(\w+)'/g)) {
    handlers.set(`${method} ${path}`, fn);
  }
  return handlers;
}

/** Fill `{param}` placeholders; throws if one is missing, so a bad call never hits the API */
export function fillPath(template: string, params: Record<string, string> = {}): string {
  return template.replace(/\{(\w+)\}/g, (_m, name: string) => {
    const value = params[name];
    if (!value) throw new Error(`Missing path parameter "${name}" for ${template}`);
    return encodeURIComponent(value);
  });
}

/**
 * Validation issues as `path: message`, without the offending values (responses contain
 * personal data). Array indexes are collapsed to [] so 100 bad rows read as one problem.
 */
export function summarizeIssues(error: z.ZodError, limit = 5): string[] {
  const seen = new Map<string, number>();
  for (const issue of error.issues) {
    const path = issue.path.map((p) => (typeof p === 'number' ? '[]' : `.${String(p)}`)).join('').replace(/^\./, '') || '(root)';
    const key = `${path}: ${issue.message}`;
    seen.set(key, (seen.get(key) ?? 0) + 1);
  }
  return [...seen].slice(0, limit).map(([key, count]) => (count > 1 ? `${key} (×${count})` : key));
}
