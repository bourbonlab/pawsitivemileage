/**
 * Typed client for the PawsitiveMileage API. Every method is derived from the route table in
 * @pawsitivemileage/contracts, so a contract change shows up here as a compile error.
 *
 *   const api = createClient({ baseUrl: 'https://api.pawsitivemileage.app', getToken });
 *   const vehicles = await api.listVehicles({ query: { status: 'all' } });
 *   const fillup = await api.createFillup({ params: { vehicleId }, body: { date, currencySpent, gallonsAdded, odometerReading } });
 *
 * Paginated lists (#26) return everything by default. To page through them:
 *   const { items, nextCursor } = await api.page('listFillups', { params: { vehicleId }, query: { limit: 50, order: 'desc' } });
 *   for await (const fillup of api.paginate('listFillups', { params: { vehicleId } })) { ... }
 */
import type { z } from 'zod';
import { ErrorCode, routes, type OperationId, type RouteDefinition, type Routes } from '@pawsitivemileage/contracts';

/** A non-2xx response (or a client-side failure before/after the request) */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: ErrorCode | 'CONTRACT_MISMATCH' | 'NETWORK_ERROR',
    message: string,
    readonly requestId?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export interface ClientOptions {
  /** e.g. https://api.pawsitivemileage.app (no trailing /v1) */
  baseUrl: string;
  /** Returns the Cognito JWT for the Authorization header; nothing means "not signed in" */
  getToken: () => string | null | undefined | Promise<string | null | undefined>;
  /** Defaults to globalThis.fetch */
  fetch?: typeof fetch;
  /** Validate every response against the contract (development, tests, CLI). Default false. */
  validateResponses?: boolean;
  /** Validate request bodies before sending. Default false (the API validates anyway). */
  validateRequests?: boolean;
  /** Extra headers on every request (e.g. X-Client for version gating, #23) */
  headers?: Record<string, string>;
}

type Input<S> = S extends z.ZodType ? z.input<S> : never;

/** Arguments for one operation: params when the path has placeholders, body when the route takes one */
export type OperationArgs<R extends RouteDefinition> =
  & (R extends { params: z.ZodType } ? { params: Input<R['params']> } : { params?: never })
  & (R extends { query: z.ZodType } ? { query?: Input<R['query']> } : { query?: never })
  & (R extends { body: z.ZodType }
    ? R extends { bodyOptional: true } ? { body?: Input<R['body']> } : { body: Input<R['body']> }
    : { body?: never })
  & (R extends { conditional: true } ? { /** Sent as If-Match: the record's updatedAt; 409 if it changed since */ ifMatch?: string } : { ifMatch?: never })
  & (R extends { idempotent: true } ? { /** Sent as Idempotency-Key; reuse it when retrying the same create */ idempotencyKey?: string } : { idempotencyKey?: never })
  & { signal?: AbortSignal; headers?: Record<string, string> };

/** The `data` an operation resolves to */
export type OperationData<R extends RouteDefinition> = z.output<R['response']>;

/** What an operation takes as `body`, by operation id: `OperationBody<'createFillup'>` */
export type OperationBody<K extends OperationId> = Routes[K] extends { body: z.ZodType } ? Input<Routes[K]['body']> : never;

/** What an operation resolves to, by operation id: `OperationResult<'getYearOverYear'>` */
export type OperationResult<K extends OperationId> = OperationData<Routes[K]>;

type RequiredKeys<T> = { [K in keyof T]-?: undefined extends T[K] ? never : K }[keyof T];

/** Operations that accept limit/cursor/order and may return nextCursor */
export type PaginatedOperationId = { [K in OperationId]: Routes[K] extends { paginated: true } ? K : never }[OperationId];

/** One item of a paginated operation's list */
export type PageItem<K extends PaginatedOperationId> = OperationData<Routes[K]> extends Array<infer T> ? T : never;

export interface Page<T> {
  items: T[];
  /** Pass as `query.cursor` for the next page; absent on the last page */
  nextCursor?: string;
}

/** Page size `paginate` uses when the caller doesn't set `query.limit` */
export const DEFAULT_PAGE_SIZE = 100;

type Operations = {
  [K in OperationId]: RequiredKeys<OperationArgs<Routes[K]>> extends never
    ? (args?: OperationArgs<Routes[K]>) => Promise<OperationData<Routes[K]>>
    : (args: OperationArgs<Routes[K]>) => Promise<OperationData<Routes[K]>>;
};

export type Client = Operations & {
  /** One page of a paginated list; without `query.limit` it is the whole list */
  page<K extends PaginatedOperationId>(operation: K, args: OperationArgs<Routes[K]>): Promise<Page<PageItem<K>>>;
  /** Every item of a paginated list, fetched a page at a time as it is iterated */
  paginate<K extends PaginatedOperationId>(operation: K, args: OperationArgs<Routes[K]>): AsyncGenerator<PageItem<K>, void, undefined>;
};

/** Fill `{param}` placeholders, URL-encoding each value */
export function buildPath(template: string, params: Record<string, unknown> = {}): string {
  return template.replace(/\{(\w+)\}/g, (_m, name: string) => {
    const value = params[name];
    if (value === undefined || value === null || value === '') throw new ApiError(0, 'VALIDATION_ERROR', `Missing path parameter "${name}"`);
    return encodeURIComponent(String(value));
  });
}

function queryString(query: Record<string, unknown> | undefined): string {
  if (!query) return '';
  const entries = Object.entries(query).filter(([, v]) => v !== undefined && v !== null).map(([k, v]) => [k, String(v)]);
  return entries.length ? `?${new URLSearchParams(entries)}` : '';
}

/** Untyped arguments used internally; the public Client methods are typed per operation */
interface RequestArgs {
  params?: Record<string, unknown>;
  query?: Record<string, unknown>;
  body?: unknown;
  idempotencyKey?: string;
  ifMatch?: string;
  signal?: AbortSignal;
  headers?: Record<string, string>;
}

export function createClient(options: ClientOptions): Client {
  const doFetch = options.fetch ?? globalThis.fetch.bind(globalThis);
  const baseUrl = options.baseUrl.replace(/\/+$/, '');

  async function request(route: RouteDefinition, args: RequestArgs = {}) {
    const token = route.public ? undefined : await options.getToken();
    if (!token && !route.public) throw new ApiError(401, 'UNAUTHORIZED', 'Not signed in');

    if (options.validateRequests && route.body && args.body !== undefined) {
      const parsed = route.body.safeParse(args.body);
      if (!parsed.success) throw new ApiError(400, 'VALIDATION_ERROR', parsed.error.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`).join('; '));
    }

    const url = `${baseUrl}${buildPath(route.path, args.params)}${queryString(args.query)}`;
    let res: Response;
    try {
      res = await doFetch(url, {
        method: route.method,
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...(args.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
          ...(args.idempotencyKey ? { 'Idempotency-Key': args.idempotencyKey } : {}),
          ...(args.ifMatch ? { 'If-Match': args.ifMatch } : {}),
          ...options.headers,
          ...args.headers,
        },
        body: args.body !== undefined ? JSON.stringify(args.body) : undefined,
        signal: args.signal,
      });
    } catch (err) {
      if ((err as Error)?.name === 'AbortError') throw err;
      throw new ApiError(0, 'NETWORK_ERROR', err instanceof Error ? err.message : String(err));
    }

    const json = await res.json().catch(() => undefined) as { data?: unknown; requestId?: string; nextCursor?: string; error?: string; code?: string } | undefined;
    if (!res.ok) {
      const code = ErrorCode.safeParse(json?.code);
      throw new ApiError(res.status, code.success ? code.data : 'INTERNAL_ERROR', json?.error ?? `HTTP ${res.status}`, json?.requestId);
    }
    if (!json || !('data' in json)) {
      throw new ApiError(res.status, 'CONTRACT_MISMATCH', 'Response is not a { data, requestId } envelope', json?.requestId);
    }
    if (options.validateResponses) {
      const parsed = route.response.safeParse(json.data);
      if (!parsed.success) {
        const where = parsed.error.issues.slice(0, 3).map((i) => `${i.path.join('.') || 'data'}: ${i.message}`).join('; ');
        throw new ApiError(res.status, 'CONTRACT_MISMATCH', `Response does not match the contract: ${where}`, json.requestId);
      }
      return { data: parsed.data, nextCursor: json.nextCursor };
    }
    return { data: json.data, nextCursor: json.nextCursor };
  }

  function paginatedRoute(operation: string): RouteDefinition {
    const route = (routes as Record<string, RouteDefinition>)[operation];
    if (!route?.paginated) throw new ApiError(0, 'VALIDATION_ERROR', `${operation} is not a paginated operation`);
    return route;
  }

  async function page(operation: string, args: RequestArgs = {}): Promise<Page<unknown>> {
    const { data, nextCursor } = await request(paginatedRoute(operation), args);
    return { items: data as unknown[], ...(nextCursor && { nextCursor }) };
  }

  async function* paginate(operation: string, args: RequestArgs = {}): AsyncGenerator<unknown, void, undefined> {
    let cursor = args.query?.cursor as string | undefined;
    const limit = args.query?.limit ?? DEFAULT_PAGE_SIZE;
    do {
      const result = await page(operation, { ...args, query: { ...args.query, limit, cursor } });
      yield* result.items;
      cursor = result.nextCursor;
    } while (cursor);
  }

  const operations = Object.fromEntries(
    (Object.entries(routes) as Array<[OperationId, RouteDefinition]>).map(([id, route]) => [id, async (args?: RequestArgs) => (await request(route, args)).data]),
  );
  return { ...operations, page, paginate } as unknown as Client;
}
