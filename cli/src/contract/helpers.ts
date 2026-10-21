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

interface SchemaDef {
  type: string;
  shape?: Record<string, z.ZodType>;
  element?: z.ZodType;
  innerType?: z.ZodType;
  in?: z.ZodType;
  valueType?: z.ZodType;
}

/**
 * Fields present in `value` that `schema` doesn't declare, as paths like `data[].GSI1PK`.
 * Response schemas accept unknown keys (clients must tolerate additive changes), so the
 * conformance check uses this to make sure the API itself never returns undeclared fields (#20).
 */
export function undeclaredKeys(schema: z.ZodType, value: unknown, path = 'data'): string[] {
  const def = (schema as unknown as { def: SchemaDef }).def;
  switch (def.type) {
    case 'optional':
    case 'nullable':
    case 'default':
    case 'readonly':
      return value === null || value === undefined ? [] : undeclaredKeys(def.innerType!, value, path);
    case 'pipe':
      return undeclaredKeys(def.in!, value, path);
    case 'array':
      return Array.isArray(value) ? value.flatMap((item) => undeclaredKeys(def.element!, item, `${path}[]`)) : [];
    case 'record':
      return value && typeof value === 'object' ? Object.values(value).flatMap((v) => undeclaredKeys(def.valueType!, v, `${path}{}`)) : [];
    case 'object': {
      if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
      return Object.entries(value).flatMap(([key, v]) =>
        key in def.shape! ? undeclaredKeys(def.shape![key], v, `${path}.${key}`) : [`${path}.${key}`]);
    }
    default:
      return [];
  }
}

/** Collapse repeated paths: ['a', 'a', 'b'] → ['a (×2)', 'b'] */
export function countPaths(paths: string[], limit = 5): string[] {
  const counts = new Map<string, number>();
  for (const p of paths) counts.set(p, (counts.get(p) ?? 0) + 1);
  return [...counts].slice(0, limit).map(([p, n]) => (n > 1 ? `${p} (×${n})` : p));
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
