# API Contract & Client SDKs

One API contract is shared by the web app, the `pm` command line and the Android app. It defines every `/v1` endpoint's request and response, and everything else is derived from it: the API's request validation, the OpenAPI document, the TypeScript SDK and the Android app's Kotlin client. Last updated 2026-10-22.

- **Every endpoint, parameter and schema:** [api-reference.md](api-reference.md), generated from the OpenAPI document.
- **Interactive:** [Redoc](https://redocly.github.io/redoc/?url=https://raw.githubusercontent.com/bourbonlab/pawsitivemileage/main/packages/contracts/openapi.json) · [Swagger UI](https://petstore.swagger.io/?url=https://raw.githubusercontent.com/bourbonlab/pawsitivemileage/main/packages/contracts/openapi.json), both loading the `openapi.json` on `main`.
- **Machine-readable:** [`packages/contracts/openapi.json`](../packages/contracts/openapi.json) (OpenAPI 3.1).

## Architecture

```
packages/contracts   zod schemas + route table  ← single source of truth
   ├─▶ request validation in the API handlers (api/src/lib/contract.ts)
   ├─▶ openapi.json  (OpenAPI 3.1, generated, committed; a test fails if it's stale)
   │      ├─▶ docs/api-reference.md  (docs/tools/api-reference.mjs)
   │      └─▶ Kotlin client for Android (openapi-generator, at build time)
   └─▶ packages/sdk  typed TS client (fetch + pluggable token) ─▶ web, pm
```

- **Contract-first in TypeScript, using zod 4.** One schema gives the TypeScript type, runtime validation, and JSON Schema for OpenAPI through zod's built-in `toJSONSchema`, with no extra generator dependency.
- **Route table** (`packages/contracts/src/routes.ts`): each operation is declared once, with its method, path, path/query/body schemas, success status and `data` schema, auth requirement, and an `operationId`. There are 40 operations, including the public `GET /v1/meta`. The OpenAPI document and the SDK methods are both derived from it, and a test checks it against the routes in `infra/lib/stacks/api-stack.ts`.
- **The envelope is part of the contract:** success responses are `{ data, requestId }`, and errors are `{ error, code, requestId }` with `code` drawn from a closed enum.
- **Open response schemas, strict checking:** response schemas accept unknown keys, so additive `/v1` changes never break an installed client. The API is held to the contract the other way: `contract-check` fails on any field the contract doesn't declare, and `success()` strips DynamoDB storage keys from every response.
- **`openapi.json`:** every entity and request is a named component, so generated Kotlin classes get readable names, and each route gets a `<OperationId>Response` envelope. It passes Redocly's recommended lint rules with no warnings.

| Path | What's there |
|---|---|
| `packages/contracts/src/entities.ts` | User, Vehicle, Fillup, MaintenanceRecord, MaintenanceSchema, Reminder, Share, SharedVehicle, Meta |
| `packages/contracts/src/requests.ts` | Request bodies and query schemas, with the API's field rules (required fields, ranges, lengths, coordinates, enums, email format) |
| `packages/contracts/src/responses.ts` | Analytics, year-over-year, exports, the report, imports and admin responses |
| `packages/contracts/src/routes.ts` | The route table |
| `packages/contracts/src/openapi.ts` | Builds the OpenAPI document |
| `packages/sdk/src/client.ts` | `createClient()` |
| `api/src/lib/contract.ts` | `validate(Schema, body)` for handlers |
| `cli/src/contract-check.ts` | Live conformance check |
| `docs/tools/api-reference.mjs` | Generates `docs/api-reference.md` |

## Changing an endpoint

1. Change the schema or route in `packages/contracts`. New field rules go here, not in the handler.
2. Change the handler; it validates with `validate(Schema, body)` from `api/src/lib/contract.ts`. A new route also needs its entry in `api-stack.ts`.
3. Regenerate the OpenAPI document and the API reference: `npm run openapi -w @pawsitivemileage/contracts` (it runs `docs/tools/api-reference.mjs` after writing `openapi.json`).
4. Run `npm test -w @pawsitivemileage/contracts` (route table vs `api-stack.ts`, `openapi.json` and `api-reference.md` freshness), then `npm test` and `npm run lint --workspaces --if-present`. TypeScript callers that no longer match the contract fail to compile.
5. The Android app picks up the new `openapi.json` on its next build. Build it (`./gradlew :app:assembleStagingDebug`) if the change touches anything it uses; the Android workflow does this on the PR.

The README doesn't list endpoints, so there's nothing to update there; it links to the generated reference.

## Compatibility rules

- `/v1` only changes **additively:** new optional fields, new endpoints and new enum values clients tolerate. Renames, removals and type changes need `/v2`.
- Installed mobile apps can't be forced to update. `GET /v1/meta` returns the minimum supported version per platform (`minimumVersions`), and Android and `pm` refuse to sign in below it. Raise it only after the older versions have had time to update; the API keeps supporting them until then.
- Clients send `X-Client: <platform>/<version>` (`android/1.4.0`, `cli/1.1.0`).
- Values for `/v1/meta` live in **`infra/lib/client-metadata.ts`**: code, not SSM, so a change is a one-line PR and a deploy.

## Conventions

The [API reference](api-reference.md#overview) has the short version. How they work:

### Auth

- The **web** app uses its own Cognito app client and sends **ID tokens**. Like the native clients, it has scopes `openid email profile` only.
- **Android and `pm`** are public clients (`{prefix}-android-client`, `{prefix}-cli-client`, in `AuthStack`): authorization code + PKCE through the Hosted UI with Google, scopes `openid email profile` only (no `aws.cognito.signin.user.admin`). They send **access tokens**.
- Redirects (`infra/lib/client-metadata.ts`): Android `app.pawsitivemileage://callback` in production and `app.pawsitivemileage.<env>://callback` elsewhere, so a staging build doesn't catch production redirects. `pm` uses `http://localhost:47815/callback`.
- The JWT authorizer's audience lists all three clients. Access tokens have no `aud`, so API Gateway checks their `client_id` against the audience instead.
- `getIdentity()` (`api/src/lib/auth.ts`) calls `https://{AUTH_DOMAIN}/oauth2/userInfo` with the caller's own token when `token_use` is `access`. If that fails, the profile is not created (500, retryable), so no profile ends up without an email. If the token or userInfo says `email_verified` is false, the profile is not created either (403): shares are granted by email, so an unverified address must never be stored.
- `GET /v1/meta` is public (`security: []` in OpenAPI; the SDK sends no token) and returns `auth`: issuer, Hosted UI domain, scopes, and per-platform `clientId`/`redirectUri`/`logoutUri`. A native client needs only the API base URL to sign in.

### Media URLs

`success()` adds `https://{FRONTEND_DOMAIN}/photos/{key}` as `photoUrl`/`receiptPhotoUrl` next to every `photoKey`/`receiptPhotoKey`, at any depth, with path segments encoded. Clients use the URL; the key is what they send back.

### Safe retries

Creates for vehicles, fill-ups, maintenance records and shares accept an `Idempotency-Key` header (1–255 of `A–Z a–z 0–9 - _`).

- `withIdempotency()` (`api/src/lib/idempotency.ts`) stores records in `pawsitivemileage-idempotency-{env}`, per user, expiring after 24 hours.
- A conditional "pending" put stops concurrent duplicates.
- A retry gets the stored response, with `Idempotent-Replayed: true`. A different body gets `409`, as does a request that's still in flight.
- A 5xx clears the record, so the client can retry.
- The SDK takes `idempotencyKey` on these four operations. `pm` retries once with the same key; Android uses each queued entry's ID.

### Conflict detection

- Single-record responses carry `ETag: "<updatedAt>"`.
- Vehicle update/archive and fill-up/maintenance updates accept `If-Match`: the raw `updatedAt`, `"…"` or `W/"…"`. A stale value gets `409 CONFLICT`. Without `If-Match`, the last write wins.
- Vehicles, and maintenance updates where the date doesn't change, use a DynamoDB condition, so the check is atomic. When the maintenance date changes, the delete of the old item carries the condition instead.
- Fill-ups check right after the read, because their batch rewrite can't be conditional.
- CORS allows `Idempotency-Key`, `If-Match` and `X-Client`, and exposes `ETag` and `Idempotent-Replayed`.

### Pagination

- Fill-ups and maintenance (the lists that grow without bound) take `?limit=1–500`, `cursor` and `order=asc|desc` (default `asc`, chronological). Without `limit`, the full list comes back.
- `nextCursor` sits next to `data` in the envelope and is absent on the last page. Routes are flagged `paginated` in the contract, so OpenAPI documents the query and the paged envelope.
- The cursor is DynamoDB's `LastEvaluatedKey`, base64url-encoded and bound to the vehicle. One from another vehicle, or a tampered one, is a `400`.
- `queryPage()` (`api/src/lib/pagination.ts`) follows every 1 MB DynamoDB page when there's no `limit`.
- Other lists (vehicles, shares, reminders, schemas) are small and bounded per user, so they aren't paginated. Adding the flag later is backward compatible.
- The SDK has `page(op, args)` → `{ items, nextCursor }` and `paginate(op, args)` (async iterator, default page size 100).

## Clients

### TypeScript SDK (`packages/sdk`)

`createClient({ baseUrl, getToken, fetch? })` returns one typed method per operation, named by its `operationId`:

```ts
const api = createClient({ baseUrl: 'https://api.pawsitivemileage.app', getToken });
const fillup = await api.createFillup({ params: { vehicleId }, body: { date, currencySpent, gallonsAdded, odometerReading } });
```

- Path params, query and body types come from the contract's input types, and results from its output types. `OperationBody<'createFillup'>` and `OperationResult<'getYearOverYear'>` name an operation's request and response.
- It unwraps the envelope, and every failure is a typed `ApiError` with `status`, `code` and `requestId`. The codes are the API's own plus `CONTRACT_MISMATCH` and `NETWORK_ERROR`.
- It sends no request without a token, except to public operations.
- Optional `validateResponses` and `validateRequests` check against the contract. The web app validates responses in development.

Users: the web app (`web/src/api/client.ts`, with the Amplify ID token) and `pm`.

### Android (Kotlin)

The app generates Retrofit interfaces and kotlinx.serialization models from `openapi.json` at build time; nothing generated is committed. See [android/README.md](../android/README.md#the-generated-api-client) for the generator settings.

### `pm`

The user-facing command line, on the SDK. See the README's [pm command line](../README.md#pm-command-line).

## Checks

| Check | What it catches | Where it runs |
|---|---|---|
| `packages/contracts` tests | Request rules pinned to the API's behavior; route table vs `api-stack.ts`; `openapi.json` or `api-reference.md` stale | `npm test`, every PR |
| `api` tests | Handlers validating with the contract, response shaping | `npm test`, every PR |
| TypeScript | Web and `pm` calls that don't match the contract | `npm run lint`, every PR |
| Android build | Kotlin client generation and use | Android workflow, PRs touching `android/` or `openapi.json` |
| `contract-check` | The live API returning something the contract doesn't describe | By hand |

**`contract-check`** (`cli/src/contract-check.ts`) calls every read endpoint in an environment as each user and validates the status, the envelope and the data against the contract:

```bash
cd cli && npx tsx src/contract-check.ts --env staging      # or --env production
```

- It's read-only. The CSV export GETs write a file, so they only run with `--include-exports`.
- It walks both orders of the paginated lists and compares them with the full list.
- Failures list schema paths and messages, never values.
- `--allow-undeclared` tolerates undeclared fields, for an environment still on an older build.

## History

| When | What |
|---|---|
| 2026-10-21, before the account cutover | **Contract and tooling** (nothing wired into the API or web): the contracts package, `openapi.json`, `contract-check` and the SDK. |
| 2026-10-21, v1.1.0 (PR #30) | **Adopted and hardened:** handlers validate with the contract (#18), the web app moved to the SDK (#19), responses lost their DynamoDB keys (#20), plus media URLs, access tokens (#22), `/v1/meta`, idempotency (#24), `If-Match` (#25) and pagination (#26). Then the `pm` CLI (#27). |
| v1.2.0 – v1.4.0 | **Android** (#28, #38) on the generated Kotlin client; account deletion (#41). |

Findings along the way:
- Before the contract, the web app kept its own copy of the types, and it had drifted from the API: year-over-year was `{ summaries: […] }` with per-year trends, not `{ years, trends }`; admin stats had `usageTrends`; responses leaked `GSI*PK/SK`, `fillupDateId` and `serviceDateId`. The contract describes what the API returns, and the drift was fixed in the web app.
- Moving the web app to the SDK fixed a 404 (toggling a schema's active flag PATCHed the wrong path) and `0.0` MPG for years without one (now `—`).
- `import * as z from 'zod'` lets esbuild drop zod's locales, which took a handler from 473 KB to 122 KB minified. The contract adds about 32 KB gzipped to the web bundle.
- The first `contract-check` run found 20 production fill-ups without `isBusiness`, older records never backfilled (#31). They were backfilled after the cutover, and `Fillup.isBusiness` is now required. It also showed that year-over-year `averageMpg` can be `null`.

Issue numbers #18–#31 refer to the old Gitea repository (see CLAUDE.md); #38 and later are on GitHub.
