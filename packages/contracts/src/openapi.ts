/**
 * Builds the OpenAPI 3.1 document from the route table (#15). The committed copy is
 * packages/contracts/openapi.json; regenerate it with `npm run openapi -w @pawsitivemileage/contracts`.
 * A test fails when the committed copy is stale, so Android's generated client always matches.
 */
import * as z from 'zod';
import { Deleted, ErrorResponse, successEnvelope } from './common.js';
import * as entities from './entities.js';
import * as requests from './requests.js';
import * as responses from './responses.js';
import { routes, type RouteDefinition } from './routes.js';

const ref = (id: string) => ({ $ref: `#/components/schemas/${id}` });
const pascal = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Query-string schemas become parameters, not components */
const QUERY_ONLY = new Set(['VehicleListQuery']);

/** Named component schemas: every exported object/array/enum schema in these modules, under its export name */
function namedSchemas(): Array<[string, z.ZodType]> {
  const named: Array<[string, z.ZodType]> = [['ErrorResponse', ErrorResponse], ['Deleted', Deleted]];
  for (const mod of [entities, requests, responses]) {
    for (const [name, value] of Object.entries(mod)) {
      if (QUERY_ONLY.has(name)) continue;
      if (value instanceof z.ZodType && ['object', 'array', 'enum', 'pipe'].includes(value.def.type)) named.push([name, value]);
    }
  }
  return named;
}

const TAG_DESCRIPTIONS: Record<RouteDefinition['tag'], string> = {
  Meta: 'Public client metadata: version gating, feature flags, policy links',
  Profile: "The signed-in user's profile and account",
  Vehicles: 'Vehicles the caller owns (shared vehicles are under Sharing)',
  'Fill-ups': 'Fuel fill-ups; derived metrics (MPG, cost per mile, …) are computed server-side',
  Maintenance: 'Maintenance records, reminders and the maintenance schemas to choose from',
  Analytics: 'Charts and yearly summaries computed from fill-ups and maintenance',
  Exports: 'CSV exports and report data (presigned download URLs)',
  Uploads: "Presigned S3 uploads for photos, receipts and CSV imports (stored under the vehicle owner's ID)",
  Imports: 'Fuelly CSV import and metric recalculation',
  Sharing: 'Sharing vehicles with other users by email',
  Admin: "Administration; requires isAdmin on the caller's profile",
};

/** One OpenAPI parameter per key of a path or query object schema */
function parameters(schema: z.ZodObject | undefined, location: 'path' | 'query') {
  if (!schema) return [];
  return Object.entries(schema.shape).map(([name, field]) => {
    const json = z.toJSONSchema(field as z.ZodType, { io: 'input', unrepresentable: 'any' }) as Record<string, unknown>;
    const { $schema: _s, description, ...fieldSchema } = json;
    return {
      name,
      in: location,
      required: location === 'path' || !(field as z.ZodType).safeParse(undefined).success,
      ...(description ? { description } : {}),
      schema: fieldSchema,
    };
  });
}

const IDEMPOTENCY_HEADER = {
  name: 'Idempotency-Key',
  in: 'header',
  required: false,
  description: 'Client-generated key (e.g. a UUID). A retry with the same key and request returns the original response with `Idempotent-Replayed: true` instead of creating again; keys expire after 24 hours.',
  schema: { type: 'string', pattern: '^[A-Za-z0-9_-]{1,255}$' },
};

const IF_MATCH_HEADER = {
  name: 'If-Match',
  in: 'header',
  required: false,
  description: "The record's `updatedAt` (or the ETag from a previous response). The update is refused with 409 if the record changed since; omit it to overwrite unconditionally.",
  schema: { type: 'string' },
};

const ETAG_HEADER = {
  ETag: { description: "The record's version (its `updatedAt`, quoted); send it back in If-Match", schema: { type: 'string' } },
};

/** Routes returning a single record with updatedAt also return an ETag header */
const hasVersion = (schema: z.ZodType) => schema.def.type === 'object' && 'updatedAt' in (schema as z.ZodObject).shape;

const ERROR_RESPONSES = {
  400: 'VALIDATION_ERROR: invalid or missing input',
  401: 'UNAUTHORIZED: missing or invalid token',
  403: 'FORBIDDEN: no access to this resource (or not an admin)',
  404: 'NOT_FOUND',
  500: 'INTERNAL_ERROR',
} as const;

export function buildOpenApiDocument() {
  const registry = z.registry<{ id: string }>();
  for (const [id, schema] of namedSchemas()) {
    if (!registry.has(schema)) registry.add(schema, { id });
  }

  const paths: Record<string, Record<string, unknown>> = {};
  for (const [operationId, route] of Object.entries(routes) as Array<[string, RouteDefinition]>) {
    const envelopeId = `${pascal(operationId)}Response`;
    registry.add(successEnvelope(route.response), { id: envelopeId });

    let bodyRef: string | undefined;
    if (route.body) {
      bodyRef = registry.get(route.body)?.id;
      if (!bodyRef) {
        bodyRef = `${pascal(operationId)}Request`;
        registry.add(route.body, { id: bodyRef });
      }
    }

    const success = Object.fromEntries([route.status, ...(route.alsoReturns ?? [])].map((status) => [status, {
      description: status === 201 ? 'Created' : 'OK',
      ...(hasVersion(route.response) ? { headers: ETAG_HEADER } : {}),
      content: { 'application/json': { schema: ref(envelopeId) } },
    }]));
    const errors = Object.fromEntries(Object.keys(ERROR_RESPONSES).map((status) => [status, { $ref: `#/components/responses/Error${status}` }]));

    paths[route.path] ??= {};
    paths[route.path][route.method.toLowerCase()] = {
      operationId,
      summary: route.summary,
      tags: [route.tag],
      ...(route.public ? { security: [] } : {}),
      ...(route.admin ? { description: 'Admin only: requires isAdmin on the caller\'s profile.', 'x-admin': true } : {}),
      parameters: [
        ...parameters(route.params, 'path'),
        ...parameters(route.query, 'query'),
        ...(route.idempotent ? [IDEMPOTENCY_HEADER] : []),
        ...(route.conditional ? [IF_MATCH_HEADER] : []),
      ],
      ...(bodyRef ? { requestBody: { required: !route.bodyOptional, content: { 'application/json': { schema: ref(bodyRef) } } } } : {}),
      responses: {
        ...success,
        ...errors,
        ...(route.idempotent ? { 409: { $ref: '#/components/responses/ErrorIdempotency' } } : {}),
        ...(route.conditional ? { 409: { $ref: '#/components/responses/ErrorStale' } } : {}),
      },
    };
  }

  const converted = z.toJSONSchema(registry, {
    uri: (id) => `#/components/schemas/${id}`,
    io: 'input',
    unrepresentable: 'any',
  }) as { schemas: Record<string, Record<string, unknown>> };
  const schemas = Object.fromEntries(Object.entries(converted.schemas)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([id, { $schema: _s, $id: _i, ...schema }]) => [id, schema]));

  return {
    openapi: '3.1.0',
    info: {
      title: 'PawsitiveMileage API',
      version: '1',
      license: { name: 'AGPL-3.0-only', identifier: 'AGPL-3.0-only' },
      description: 'Generated from packages/contracts. Success bodies are `{ data, requestId }`; errors are `{ error, code, requestId }`. See docs/api-contract.md.',
    },
    servers: [
      { url: 'https://api.pawsitivemileage.app', description: 'Production' },
      { url: 'https://api-staging.pawsitivemileage.app', description: 'Staging' },
    ],
    security: [{ cognitoJwt: [] }],
    tags: [...new Set(Object.values(routes).map((r) => r.tag))].map((name) => ({ name, description: TAG_DESCRIPTIONS[name] })),
    paths: Object.fromEntries(Object.entries(paths).sort(([a], [b]) => a.localeCompare(b))),
    components: {
      securitySchemes: {
        cognitoJwt: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
          description: 'Cognito ID token from the PawsitiveMileage user pool (access tokens from #22).',
        },
      },
      responses: {
        ...Object.fromEntries(Object.entries(ERROR_RESPONSES).map(([status, description]) => [`Error${status}`, {
          description,
          content: { 'application/json': { schema: ref('ErrorResponse') } },
        }])),
        ErrorStale: {
          description: 'CONFLICT: the record changed since the If-Match version; reload it and try again',
          content: { 'application/json': { schema: ref('ErrorResponse') } },
        },
        ErrorIdempotency: {
          description: 'CONFLICT: the Idempotency-Key was used for a different request, or that request is still in progress',
          content: { 'application/json': { schema: ref('ErrorResponse') } },
        },
      },
      schemas,
    },
  };
}

/** The document as written to openapi.json (stable formatting, trailing newline) */
export function renderOpenApiDocument(): string {
  return `${JSON.stringify(buildOpenApiDocument(), null, 2)}\n`;
}
