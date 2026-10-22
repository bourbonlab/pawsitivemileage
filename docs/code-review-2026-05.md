# PawsitiveMileage — Code Review

> **Snapshot from May 2026, not kept up to date.** Line numbers and some file names have since changed. Current status of the security findings (M1/F-15 and M3/F-16 are fixed): [security.md](security.md#remediation-status). The `.kiro/` steering files it mentions are gone; the README, `docs/` and CLAUDE.md are the references now.


**Date:** 2026-05-22
**Reviewer:** Full-codebase review
**Scope:** Frontend (`web/`), backend (`api/`), infrastructure (`infra/`), CLI (`cli/`), deployment pipeline (`deploy.sh`), and project documentation (`docs/`, `.kiro/`).
**Verification performed:** `tsc --noEmit` (all 4 packages — pass), `vitest run` (API 131 tests, web 26 tests — pass), `cdk synth` (all stacks — pass).

---

## Executive Summary

PawsitiveMileage is a **well-architected and well-documented serverless application**. The code is internally consistent, the single-table DynamoDB design is sound, authorization is enforced in every handler, and the security hardening tracked in [`security.md`](./security.md) (12 of 14 findings) is genuinely in place.

This review found **no critical vulnerabilities** — there is no authentication bypass, no trivially exploitable data leak, and no self-privilege-escalation path. The findings below are **MEDIUM and LOW severity**: correctness bugs, defense-in-depth gaps, scalability ceilings, and documentation drift.

| Severity | Count |
|----------|-------|
| Critical | 0 |
| High | 0 |
| Medium | 7 |
| Low | 14 |

Three of the MEDIUM findings are security-relevant and have been added to [`security.md`](./security.md) as **F-15, F-16, F-17**.

---

## Findings — Medium

### M1 / F-15 — `importData` trusts client-supplied `s3Key` without an ownership check

**File:** `api/src/handlers/importData.ts:375` (and `:87`, `:196`)

The import handler reads `body.s3Key` and passes it directly to `GetObjectCommand` on the photos bucket. It verifies the caller owns the *path* `vehicleId`, but never checks that `s3Key` is scoped to the caller (`{userId}/...`). Photo keys are exposed verbatim in CloudFront URLs (`/photos/{userId}/{vehicleId}/...`), so the prefix is not secret — particularly to shared-vehicle users, who see the owner's keys. This is a missing object-level authorization control.

Additionally, `importData.ts:47` defines a **local `parseBody`** that omits the `maxBytes` size cap added to `lib/validation.ts` for finding F-02 — a regression of that hardening.

**Recommendation:** Reject any `s3Key` that does not begin with `${userId}/`. Replace the local `parseBody` with the shared `validation.ts` implementation.

```typescript
if (typeof s3Key !== 'string' || !s3Key.startsWith(`${userId}/`)) {
  return error('VALIDATION_ERROR', 's3Key is required', requestId);
}
```

### M2 — `createFillup` never recalculates metrics and assumes append-only ordering

**File:** `api/src/handlers/fillupCrud.ts:124-273`

`createFillup` computes derived metrics for the new fillup relative to *the chronologically-last* existing fillup and writes only that one row. By contrast, `updateFillup` (`:401`) and `deleteFillup` (`:440`) correctly call `recalculateAllMetrics` over the whole series.

The odometer-monotonicity check (`:195`) partially protects this — a realistically back-dated fillup has a lower odometer and is rejected — but there is **no date-ordering validation**. A fillup entered out of date order with an inconsistent odometer silently corrupts MPG / cost-per-mile for itself and its true successors until a manual `/recalculate`.

**Recommendation:** After inserting, fetch + `recalculateAllMetrics` + write back, consistent with update/delete. Alternatively, reject a `date` earlier than the latest fillup's date.

### M3 / F-16 — Account deletion leaves orphaned `Sharing` records

**File:** `api/src/handlers/userProfile.ts:162-219`

`deleteAccount` cascades vehicles, fillups, maintenance, and S3 objects, but never touches the `Sharing` table — neither shares the user *created* (`ownerUserId = userId`) nor shares *targeting their email* (`GSI1PK = email`).

Because shares key on email and Google sign-up auto-provisions accounts, a future account reusing the same email **inherits stale shared-vehicle grants** — a privacy gap. The handler also does not delete the Cognito user, so a subsequent Google login silently recreates an empty profile.

**Recommendation:** In `deleteAccount`, query and delete all `Sharing` rows where `ownerUserId = userId`, and all rows on GSI1 where `GSI1PK = userEmail`. Decide explicitly whether the Cognito user should be removed (`AdminDeleteUser`) or intentionally retained.

### M4 / F-17 — Photos are world-readable; CSP allows inline scripts

**Files:** `infra/lib/stacks/frontend-stack.ts:79`, `:118`

Two issues:

1. **CSP weakness.** The Content-Security-Policy sets `script-src 'self' 'unsafe-inline'`. The `'unsafe-inline'` token largely defeats CSP's XSS protection and is weaker than the F-07 recommendation (`script-src 'self'`). A Vite production build does not emit inline scripts.
2. **Public photo objects.** The `/photos/*` CloudFront behavior serves objects with no signed URLs or signed cookies. Any photo (including receipts, which may contain PII) is readable by anyone holding the key. Keys embed unguessable Cognito UUIDs, but this is security-by-obscurity, and shared-vehicle users legitimately see the owner's keys.

**Recommendation:** Remove `'unsafe-inline'` from `script-src` (verify the build still loads). For photos, consider CloudFront signed URLs/cookies, or formally document the access model as an accepted tradeoff.

### M5 — No CloudWatch alarms; monitoring stack contains dead code

**File:** `infra/lib/stacks/monitoring-stack.ts`

The stack builds dashboards but defines **zero `cloudwatch.Alarm`s and no SNS notifications**, despite `tech.md` and `Project.md` §5.6 promising alarms on error rate and latency. It also builds `coldStartMetrics` (`:64`) and `lambdaWidgets` (`:57`) arrays that are never added to a widget — and `AWS/Lambda` has no `ColdStart` metric. The `Sharing` table is absent from the DynamoDB capacity widgets.

**Recommendation:** Add alarms for API 5xx rate, API p99 latency, and per-function Lambda errors, wired to an SNS topic. Delete the unused `coldStartMetrics` / `lambdaWidgets` code. Add the Sharing table to capacity widgets.

### M6 — Handler logic is largely untested

**Files:** `api/vitest` coverage config; `api/tests/unit/`

API coverage **excludes `src/handlers/**`**, and only `userProfile.test.ts` exercises a handler. The bulk of the business logic — routing, the ownership→shared-access fallback, CRUD, metric recalculation — is untested. Many spec-defined property tests remain unchecked in `.kiro/specs/*/tasks.md`, including tenant isolation (`pawsitive-mileage` task 11), S3-key user-scoping, import logic, and the `sharingCrud` / `importData` handler tests.

**Recommendation:** Add handler-level tests (in-memory or mocked DynamoDB) for the critical authorization paths, and complete the outstanding property tests — especially tenant isolation and shared-access enforcement.

### M7 — Presigned-upload size limit is advisory only

**File:** `api/src/handlers/presignUrl.ts:67-76`

`presignUrl` validates `fileSize` *only if the client sends it*, and the presigned `PUT` URL carries no `ContentLengthRange` condition. Actual uploads are therefore unbounded up to S3's own limits.

**Recommendation:** Use a presigned POST policy with a `content-length-range` condition to enforce the 10 MB cap server-side.

---

## Findings — Low

| ID | Finding | File |
|----|---------|------|
| L1 | `updateFillup` performs no odometer-monotonicity check; an edited reading can yield negative `milesSinceLastFillup` → negative MPG. | `api/src/handlers/fillupCrud.ts:279` |
| L2 | `adminStats` compares a date-only `GSI2SK` (`YYYY-MM-DD`) against full-ISO-timestamp bounds, misattributing month-boundary fillups and excluding the threshold day. | `api/src/handlers/adminStats.ts:144`, `:183` |
| L3 | `escapeCsvField` prefixes anything matching `^[=+\-@\t\r]` with `'`, mangling legitimate negative numbers (`-5` → `'-5`) in CSV exports. | `api/src/handlers/exportData.ts:179` |
| L4 | `.kiro/steering/tech.md` & `structure.md` have drifted from `package.json` after the May 2026 dependency updates (TS 5.9→6.0, CDK 2.238→2.255, SDK 3.990→3.1049, Recharts/Lucide/Radix versions, "3 test files" → 7 API + 5 web). | `.kiro/steering/` |
| L5 | `security.md` F-08 (admin audit trail) and F-14 (table names hardcoded as `pawsitivemileage-*-{env}` instead of `config.resourcePrefix`) remain open. | `infra/lib/stacks/database-stack.ts:33` |
| L6 | Duplication: `checkIsAdmin` copied across 3 admin handlers, `parseBody` in 2, `daysBetween` in 2 (with differing `round`/`floor` semantics). | `api/src/handlers/admin*.ts`, `lib/metrics.ts`, `lib/reminders.ts` |
| L7 | `findFillupById` / `getFillup` use a post-query `FilterExpression` and take `Items[0]`; if a vehicle's fillups exceed a 1 MB query page, an existing fillup can be reported "not found". | `api/src/handlers/fillupCrud.ts:93`, `:481` |
| L8 | `vehicleCrud` validates a `notes` field that does not exist on `Vehicle`; updating `photoKey` orphans the previous S3 object. | `api/src/handlers/vehicleCrud.ts:146`, `:333` |
| L9 | `deploy.sh` runs `npm audit` but only `warn`s — it never fails the pipeline (F-13 only partially satisfied). | `deploy.sh:249` |
| L10 | `metrics.ts` imports `'../types/fillup'` without the `.js` extension used everywhere else in this ESM project. | `api/src/lib/metrics.ts:1` |
| L11 | `writeAllFillups` / `recalculate` rewrite every fillup row on each create/update/delete (O(n) writes) — fine now, costly and throttle-prone at scale. | `api/src/handlers/fillupCrud.ts:499`, `importData.ts:275` |
| L12 | `adminUsers.listUsers` issues 2–3 queries per user (N+1); approaches the 30 s Lambda timeout near the stated 1,000-user ceiling. | `api/src/handlers/adminUsers.ts:77` |
| L13 | `auth-stack.ts` maps Google `picture` to `custom:picture`, but the user pool defines no custom attributes — this can break federated sign-in. **Verify against the live deployment.** | `infra/lib/stacks/auth-stack.ts:53` |
| L14 | `analytics` `summary-card` returns JSON only; `Project.md` §5.6 specifies shareable *image* cards (acknowledged as client-rendered, but a spec deviation). | `api/src/handlers/analytics.ts:358` |

---

## Strengths

The following are well-implemented and should be preserved:

- Consistent `{ data, requestId }` / `{ error, code, requestId }` response envelope.
- Per-Lambda least-privilege IAM grants (read-only where possible).
- Consistent ownership-then-shared-access authorization pattern via `verifyAccess`.
- Structured JSON logging with production stack-trace suppression.
- PITR, termination protection, and `RETAIN` removal policies on production stateful resources.
- Pagination correctly handled in cascading delete and most fetch loops.
- High-quality property-based tests where they exist (metrics, reminders, validation, CSV parser).
- Clean separation of concerns across `web/`, `api/`, `infra/`, `cli/`.

---

## Prioritized Task List

Effort key: **S** ≈ under 1 hour · **M** ≈ a few hours · **L** ≈ a day or more.

| # | Task | Finding | Severity | Effort |
|---|------|---------|----------|--------|
| 1 | Validate `s3Key` ownership prefix in `importData`; use the shared `parseBody`. | M1 / F-15 | MED | S |
| 2 | Recalculate metrics after `createFillup` (or reject out-of-order dates). | M2 | MED | S |
| 3 | Delete `Sharing` records (as owner and as shared email) on account deletion. | M3 / F-16 | MED | M |
| 4 | Remove `'unsafe-inline'` from CSP `script-src`; verify the build. | M4 / F-17 | MED | S |
| 5 | Add CloudWatch alarms (5xx rate, p99 latency, Lambda errors) + SNS; delete dead monitoring code. | M5 | MED | M |
| 6 | Add `updateFillup` odometer-monotonicity validation. | L1 | LOW | S |
| 7 | Add handler-level tests; complete outstanding spec property tests (tenant isolation, S3 scoping, import). | M6 | MED | L |
| 8 | Verify the `custom:picture` Cognito mapping against the live deployment; remove or define the attribute. | L13 | LOW | S |
| 9 | Fix `adminStats` date comparisons — compare date-only to date-only. | L2 | LOW | S |
| 10 | Stop quote-escaping negative numbers in CSV export. | L3 | LOW | S |
| 11 | Refresh `.kiro/steering/*` to match the current `package.json` and test layout. | L4 | LOW | S |
| 12 | Make `deploy.sh` `npm audit` fail on high/critical; enforce presign size via a POST policy. | L9, M7 | LOW/MED | S |
| 13 | Address remaining F-08 (audit trail) and F-14 (`resourcePrefix` table names). | L5 | LOW | M/L |
| 14 | De-duplicate `checkIsAdmin` / `parseBody` / `daysBetween` into `lib/`; drop the dead `notes` validation; delete orphaned photos on `photoKey` change. | L6, L8 | LOW | S |
| 15 | Plan for scale: batch writes in recalculation; paginate / cap concurrency in `adminUsers`. | L11, L12 | LOW | M |

Recommended order: tackle **#1–#5** first — they are the genuine security, correctness, and operability items, and most are small.

---

## Related Documents

- [`security.md`](./security.md) — Security assessment; findings F-15–F-17 added from this review.
- [`cost.md`](./cost.md) — AWS cost estimate.
- `Project.md` (repo root) — Project charter and specification.
- `.kiro/specs/` — Feature specs and task lists (several property-test tasks still open — see M6).
