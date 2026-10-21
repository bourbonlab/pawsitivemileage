# API Contract & Client SDKs

Plan for one API contract shared by the web app, a user-facing CLI, and a native Android app (iOS later). Last updated 2026-10-21.

## Goals

- **One source of truth** for every endpoint's request and response, so the web app, CLI and Android app can't drift from the API, or from each other.
- **Generated clients:** a typed TypeScript SDK for web and CLI, and a Kotlin client for Android, both built from the same contract.
- **Mobile-ready API:** absolute media URLs, access-token auth, version gating, safe retries, and conflict detection, so a native client works on flaky networks and can be phased out cleanly.

## Where we are today

The API is 12 Lambda handlers. Their validation was hand-rolled (`api/src/lib/validation.ts`) until #18 moved it to the contract. The web app keeps its own copy of the types (`web/src/types/`) and request shapes (`web/src/api/*.ts`). Probing the live API (2026-10-21) shows the two copies have drifted:

| Area | What clients are told | What the API actually returns |
|---|---|---|
| Year-over-year | `{ years: […], trends: {…} }` | `{ summaries: [{ year: "2025", …, trends: { totalSpent: "up", … } }] }`, with `year` as a string and trends per summary |
| Admin stats | `{ totalUsers, activeUsers, totalFillups, totalVehicles }` | the same plus `usageTrends: [{ month, count }]` |
| Admin users | `lastActive?: string` | sometimes a date (`2026-10-20`), sometimes a timestamp |
| Users, vehicles, fill-ups, maintenance | entity fields only | entity fields **plus internal DynamoDB keys**: `GSI1PK`/`GSI1SK`, `GSI2PK`/`GSI2SK`, `fillupDateId`, `serviceDateId` |
| `Vehicle.maintenanceOverrides` | declared | no endpoint accepts or sets it |

## Architecture

```
packages/contracts   zod schemas + route table  ← single source of truth
   ├─▶ request validation in the API handlers (phase B)
   ├─▶ openapi.json  (OpenAPI 3.1, generated, committed; CI fails if stale)
   │      └─▶ Kotlin client for Android (openapi-generator)
   └─▶ packages/sdk  typed TS client (fetch + pluggable token) ─▶ web, CLI
```

- **Contract-first in TypeScript, using zod 4.** One schema gives the TypeScript type, runtime validation, and JSON Schema for OpenAPI through zod's built-in `toJSONSchema`, with no extra generator dependency.
- **Route table:** each operation is declared once, with its method, path, path/query/body schemas, success status and `data` schema, auth requirement, and an `operationId`. The OpenAPI document and the SDK methods are both derived from it.
- **The envelope is part of the contract:** success responses are `{ data, requestId }`, and errors are `{ error, code, requestId }` with `code` drawn from a closed enum.
- **Open response schemas, strict checking:** response schemas accept unknown keys, so additive v1 changes never break an installed client. The API is held to the contract the other way: `contract-check` fails on any field the contract doesn't declare. Since #20, the API also strips DynamoDB storage keys from every response.

## Compatibility rules

- `/v1` only changes **additively:** new optional fields, new endpoints and new enum values clients tolerate. Renames, removals and type changes need `/v2`.
- **Exception:** removing the internal DynamoDB keys is allowed within v1. They were never documented, and the only consumer is our own web app, which doesn't read them.
- Installed mobile apps can't be forced to update. Phase B adds `GET /v1/meta`, which returns the minimum supported version per platform, and the API keeps supporting older clients for the whole support window.

## Sequencing around the account migration

Production is moving to the new AWS account (see [account-migration.md](account-migration.md)). Until that cutover is locked with `complete`:
- **The parity check needs identical responses from the old and new APIs**, so no response shapes change.
- **Each migration run makes the new account an exact copy of the old one**, so no data-model changes or backfills either.

| Phase | Ships | Runtime impact | When |
|---|---|---|---|
| **A: contract & tooling** | contracts package, OpenAPI document, live conformance check, SDK package | **none**: nothing is wired into the handlers or the web app | now, merge any time |
| **B: adopt & harden** | handler validation from contracts; web app on the SDK; response cleanup; mobile-readiness changes | yes | after the production cutover is locked |
| **C: clients** | user-facing CLI; Kotlin client and Android scaffold | new apps | after B's API changes |

## Phase A — contract & tooling (pre-cutover safe)

1. **`packages/contracts`** (`@pawsitivemileage/contracts`)
   - Entity schemas: User, Vehicle, Fillup, MaintenanceRecord, MaintenanceSchema, Reminder, Share, SharedVehicle.
   - Request schemas that encode **exactly** today's handler rules: required fields, types, ranges, string lengths, coordinates, enums, the email format.
   - Response schemas for analytics, year-over-year, exports, the report, imports and admin, matching what the API returns, including the drift above.
   - A route table covering all `/v1` routes (40, including the public `GET /v1/meta`).
   - Unit tests that pin the request rules to the handlers' current behavior.
2. **`openapi.json`** (`packages/contracts/openapi.json`, OpenAPI 3.1): generated from the route table and committed.
   - Regenerate it with `npm run openapi -w @pawsitivemileage/contracts`.
   - A unit test fails if the committed copy is stale, and CI runs it on every PR, so the Kotlin client always matches.
   - Every entity and request becomes a named component, so the generated Kotlin classes get readable names; each route also gets a `<OperationId>Response` envelope.
   - It passes Redocly's recommended lint rules with no warnings.
3. **Live conformance check** (`cli/src/contract-check.ts`): calls every read endpoint in an environment as each migrated user and validates the status, the envelope and the data against the contract.
   - Run it with `npx tsx src/contract-check.ts --env staging|production` (from `cli/`).
   - It's read-only. The CSV export GETs write a file, so they only run with `--include-exports`.
   - Failures list schema paths and messages, never values.
   - First run (2026-10-21): it found **20 production fill-ups missing `isBusiness`**, older records never backfilled (#31). It also showed **year-over-year `averageMpg` can be `null`**. The contract now reflects both, and staging and production conform: 17 and 97 responses.
4. **`packages/sdk`** (`@pawsitivemileage/sdk`): `createClient({ baseUrl, getToken, fetch? })`, with one typed method per operation.
   - Path params, query and body types come from the contract's input types, and results from its output types.
   - It unwraps the envelope, and every failure is a typed `ApiError` with `status`, `code` and `requestId`. The codes are the API's own plus `CONTRACT_MISMATCH` and `NETWORK_ERROR`.
   - It sends no request without a token.
   - Optional `validateResponses` and `validateRequests` check against the contract.
   - It's tested against a mocked `fetch`, with compile-time type assertions checked by `tsc`. No app uses it yet.

   ```ts
   const api = createClient({ baseUrl: 'https://api.pawsitivemileage.app', getToken });
   const fillup = await api.createFillup({ params: { vehicleId }, body: { date, currencySpent, gallonsAdded, odometerReading } });
   ```

## Phase B — adopt & harden (after cutover)

1. **The API validates requests with the contract schemas**, replacing `validation.ts` rule by rule, with error messages kept compatible. Handlers then can't drift from the contract.
   - *Done on the branch.* Every handler calls `validate(Schema, body)` from `api/src/lib/contract.ts`. Messages keep the existing wording, and the contract's own messages win.
   - Updates are validated before the database read.
   - The handler gaps are closed: for example, `PUT` fill-up now rejects `"currencySpent": "42.50"`.
   - Bundles use `import * as z from 'zod'`, so esbuild can drop zod's locales. That took a handler from 473 KB to 122 KB minified.
2. **The web app moves to the SDK.** Delete `web/src/types/` and the hand-written request types in `web/src/api/`, and fix the drifted year-over-year and admin types.
3. **Response cleanup:** strip the internal DynamoDB keys.
   - *Done on the branch.* `success()` drops `GSI*PK/SK`, `fillupDateId`, `serviceDateId` and `vehicleEmailKey` at any depth.
   - `contract-check` now flags undeclared fields. Use `--allow-undeclared` for an environment still on an older build.
4. **Mobile readiness:**
   - **Media URLs:** responses include absolute `photoUrl`/`receiptPhotoUrl` values alongside the keys.
     - *Done on the branch:* `success()` adds `https://{FRONTEND_DOMAIN}/photos/{key}` next to every `photoKey`/`receiptPhotoKey`, at any depth, with path segments encoded.
   - **Access tokens:** the API accepts Cognito access tokens. Profile auto-creation reads email and name from `/oauth2/userInfo` when the token lacks them. Android and CLI app clients are added (public, PKCE) and listed in the JWT authorizer's audience.
   - **`GET /v1/meta`** (public): minimum supported version per platform, feature flags, and policy links (privacy, terms, account deletion).
     - *Done on the branch:* the `meta` Lambda answers without a token, and adds `serverTime`.
     - Values are in **`infra/lib/client-metadata.ts`**: code, not SSM, so a change is a one-line PR and a deploy.
     - It's marked `public` in the contract, so OpenAPI gives it `security: []` and the SDK skips the token.
   - **Safe retries:** an `Idempotency-Key` header on creates (fill-ups, maintenance, vehicles, shares).
     - *Done on the branch:* `withIdempotency()` (`api/src/lib/idempotency.ts`) stores records in `pawsitivemileage-idempotency-{env}`. Records are per user and expire after 24 hours.
     - A conditional "pending" put stops concurrent duplicates.
     - A retry gets the stored response, with `Idempotent-Replayed: true`. A different body gets `409`, as does a request that's still in flight.
     - A 5xx clears the record, so the client can retry.
     - The SDK takes `idempotencyKey` on these four operations only.
   - **Conflict detection:** `updatedAt`-based `If-Match` on updates, returning `409 CONFLICT` when stale.
     - *Done on the branch:* single-record responses carry `ETag: "<updatedAt>"`.
     - Vehicle update/archive and vehicle/fill-up/maintenance updates accept `If-Match`: the raw `updatedAt`, `"…"` or `W/"…"`.
     - Vehicles, and maintenance updates where the date doesn't change, use a DynamoDB condition, so the check is atomic. When the maintenance date changes, the delete of the old item carries the condition instead.
     - Fill-ups check right after the read, because their batch rewrite can't be conditional.
     - Maintenance now deletes a removed receipt's file **after** the record is written.
     - CORS now allows `Idempotency-Key`, `If-Match` and `X-Client`, and exposes `ETag` and `Idempotent-Replayed`.
   - **Pagination:** one cursor format for every list (`?limit&cursor` returning `nextCursor`), staying backward compatible: no `limit` means today's full list.
     - *Done on the branch:* fill-ups and maintenance (the lists that grow without bound) take `?limit=1–500`, `cursor` and `order=asc|desc` (default `asc`, chronological, as before).
     - `nextCursor` sits next to `data` in the envelope and is absent on the last page. Routes are flagged `paginated` in the contract, so OpenAPI documents the query and the paged envelope.
     - The cursor is DynamoDB's `LastEvaluatedKey`, base64url-encoded and bound to the vehicle. One from another vehicle, or a tampered one, is a `400`.
     - `queryPage()` (`api/src/lib/pagination.ts`) also fixes a latent bug: without `limit`, fill-ups now follow every 1 MB DynamoDB page, where before the list silently stopped at the first.
     - Other lists (vehicles, shares, reminders, schemas) are small and bounded per user; they stay unpaginated until they need it. Adding the flag later is backward compatible.
     - The SDK adds `page(op, args)` → `{ items, nextCursor }` and `paginate(op, args)` (async iterator, default page size 100). `contract-check` walks both orders and compares them with the full list.

## Phase C — clients

1. **`pm` CLI** on the SDK. `pm login` uses the Cognito PKCE flow with a localhost callback. Commands include `vehicles`, `fillup add`, `maintenance`, `export`. The admin migration and backfill scripts stay separate.
2. **Android:**
   - `android/` (Gradle, in this repo), package `app.pawsitivemileage`.
   - The Kotlin client is generated from `openapi.json`.
   - Sign-in uses AppAuth and Custom Tabs against the Cognito hosted UI.
   - Offline entry uses Room plus WorkManager, relying on idempotency keys.

## Open questions

None at the moment. (Pagination scope: fill-ups and maintenance only, see Phase B.)
