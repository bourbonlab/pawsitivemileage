# API Contract & Client SDKs

Plan for one API contract shared by the web app, a user-facing CLI, and a native Android app (iOS later). Last updated 2026-10-21.

## Goals

- **One source of truth** for every endpoint's request and response, so the web app, CLI and Android app can't drift from the API, or from each other.
- **Generated clients:** a typed TypeScript SDK for web and CLI, and a Kotlin client for Android, both built from the same contract.
- **Mobile-ready API:** absolute media URLs, access-token auth, version gating, safe retries, and conflict detection, so a native client works on flaky networks and can be phased out cleanly.

## Where we are today

The API is 12 Lambda handlers with hand-rolled validation (`api/src/lib/validation.ts`). The web app keeps its own copy of the types (`web/src/types/`) and request shapes (`web/src/api/*.ts`). Probing the live API (2026-10-21) shows the two copies have drifted:

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
- **Lenient now, strict later:** in phase A, response schemas allow unknown keys, so today's responses (internal keys included) conform. Phase B removes the internal keys and then makes the schemas strict.

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
   - A route table covering all 39 routes.
   - Unit tests that pin the request rules to the handlers' current behavior.
2. **`openapi.json`:** generated from the route table and committed. CI regenerates it and fails on any difference, so the Kotlin client always matches.
3. **Live conformance check** (`cli/src/contract-check.ts`): calls every read endpoint in an environment as a real user and validates each response against the contract. It's read-only and runs in rehearsals and after deploys.
4. **`packages/sdk`** (`@pawsitivemileage/sdk`): `createClient({ baseUrl, getToken, fetch? })`, with one typed method per operation. It unwraps the envelope, turns errors into a typed `ApiError`, and optionally validates responses. It's tested against a mocked `fetch`; no app uses it yet.

## Phase B — adopt & harden (after cutover)

1. **The API validates requests with the contract schemas**, replacing `validation.ts` rule by rule, with error messages kept compatible. Handlers then can't drift from the contract.
2. **The web app moves to the SDK.** Delete `web/src/types/` and the hand-written request types in `web/src/api/`, and fix the drifted year-over-year and admin types.
3. **Response cleanup:** strip the internal DynamoDB keys, then make the response schemas strict.
4. **Mobile readiness:**
   - **Media URLs:** responses include absolute `photoUrl`/`receiptPhotoUrl` values alongside the keys.
   - **Access tokens:** the API accepts Cognito access tokens. Profile auto-creation reads email and name from `/oauth2/userInfo` when the token lacks them. Android and CLI app clients are added (public, PKCE) and listed in the JWT authorizer's audience.
   - **`GET /v1/meta`** (public): minimum supported version per platform, feature flags, and policy links (privacy, terms, account deletion).
   - **Safe retries:** an `Idempotency-Key` header on creates (fill-ups, maintenance, vehicles, shares).
   - **Conflict detection:** `updatedAt`-based `If-Match` on updates, returning `409 CONFLICT` when stale.
   - **Pagination:** one cursor format for every list (`?limit&cursor` returning `nextCursor`), staying backward compatible: no `limit` means today's full list.

## Phase C — clients

1. **`pm` CLI** on the SDK. `pm login` uses the Cognito PKCE flow with a localhost callback. Commands include `vehicles`, `fillup add`, `maintenance`, `export`. The admin migration and backfill scripts stay separate.
2. **Android:**
   - `android/` (Gradle, in this repo), package `app.pawsitivemileage`.
   - The Kotlin client is generated from `openapi.json`.
   - Sign-in uses AppAuth and Custom Tabs against the Cognito hosted UI.
   - Offline entry uses Room plus WorkManager, relying on idempotency keys.

## Open questions

- Should the `/v1/meta` minimum versions live in SSM Parameter Store, so they can change without a deploy, or in code?
- Does pagination need to apply to fill-ups only (the only list that grows large), or to every list?
