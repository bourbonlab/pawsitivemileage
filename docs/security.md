# PawsitiveMileage — Security Assessment

**Date:** 2026-02-15
**Scope:** Full codebase review — frontend (`web/`), backend (`api/`), infrastructure (`infra/`), CLI (`cli/`), and deployment pipeline (`deploy.sh`)

> **Update — 2026-05-22:** A follow-up code review identified three additional
> security-relevant findings, recorded below as **F-15, F-16, and F-17**. See the
> [Follow-up Review (2026-05-22)](#follow-up-review--2026-05-22) section and the
> full [`code-review-2026-05.md`](./code-review-2026-05.md) for context.
>
> **Update — 2026-10-22:** F-15 (2026-10-20) and F-16 (v1.4.0, 2026-10-22) are remediated.
> Since this assessment, the app moved to its own AWS account (`376784708284`) and domain
> (`pawsitivemileage.app`), and gained public PKCE clients for Android and the `pm` CLI.
> File and line references below are from the date of each review and may have moved.

---

## Executive Summary

PawsitiveMileage has a solid security foundation. Authentication is handled by Cognito with JWT validation at the API Gateway level, IAM permissions follow least-privilege per Lambda function, S3 buckets block public access, DynamoDB has PITR enabled, and all Lambda functions use X-Ray tracing with structured logging. The codebase demonstrates consistent authorization checks and input validation patterns.

That said, the review identified 14 findings across critical, high, medium, and low severity. The most impactful are missing input validation on several fields, no API rate limiting, a Google OAuth secret stored as plaintext in CDK context, and CSV formula injection risk in exports.

---

## Remediation Status

**13 of 17 findings remediated**; one accepted as a risk. F-01–F-14 were addressed in the `feat/security-hardening` branch; F-15–F-17 come from the [follow-up review](#follow-up-review--2026-05-22).

| Status | Count | Findings |
|--------|-------|----------|
| ✅ Remediated | 13 | F-01, F-02, F-03, F-04, F-05, F-06, F-07, F-09, F-10, F-11, F-13, F-15, F-16 |
| ⚠️ Accepted risk | 1 | F-12 (no interactive IAM approval — dedicated account, IAM reviewed in PRs; since 2026-10-20) |
| ⬚ Not addressed | 3 | F-08 (admin audit trail — new feature, deferred), F-14 (table name prefix — breaking change, requires migration), F-17 (inline scripts allowed by the CSP; photos readable by URL) |

---

## Findings

### F-01 — Google OAuth Client Secret Passed as Plaintext CDK Context (HIGH)

**File:** `infra/lib/stacks/auth-stack.ts:44`
**File:** `deploy.sh:236`

The Google OAuth client secret is passed via CDK context (`-c googleClientSecret=...`) and consumed with `cdk.SecretValue.unsafePlainText()`. This means:
- The secret appears in `cdk.context.json`, CloudFormation template parameters, and CloudFormation console
- `deploy.sh` passes it as a CLI argument, which is visible in process listings (`ps aux`)
- The CDK explicitly names this method "unsafe" for a reason

**Recommendation:** Store the Google client secret in AWS Secrets Manager or SSM Parameter Store (SecureString) and reference it via `cdk.SecretValue.secretsManagerValue()` or `cdk.SecretValue.ssmSecure()`. Remove it from `.env` and CDK context.

---

### F-02 — No Request Body Size Limit (HIGH)

**Files:** All handlers via `parseBody()` in `api/src/lib/validation.ts:63`

`parseBody()` calls `JSON.parse(body)` on the raw event body with no size check. API Gateway v2 has a 10 MB payload limit by default, but there's no application-level enforcement. A 10 MB JSON payload could:
- Consume significant Lambda memory (256 MB configured)
- Create oversized DynamoDB items (400 KB limit) causing silent failures
- Enable denial-of-service via repeated large payloads

**Recommendation:** Add a body size check before parsing:
```typescript
export function parseBody(body: string | null | undefined, maxBytes = 65536): Record<string, unknown> | null {
  if (!body || body.length > maxBytes) return null;
  try { return JSON.parse(body); } catch { return null; }
}
```

---

### F-03 — No String Length Validation on User-Supplied Text Fields (HIGH)

**Files:** `fillupCrud.ts`, `vehicleCrud.ts`, `maintenanceCrud.ts`, `userProfile.ts`, `adminSchemas.ts`

Fields like `stationName`, `address`, `notes`, `displayName`, `make`, `model`, `trim`, `color`, `vin`, `licensePlate`, and schema `name`/`description` have no maximum length enforcement. Combined with F-02, this allows storing arbitrarily large strings in DynamoDB.

**Recommendation:** Add `validateStringLength()` to `validation.ts` and apply it to all text fields with sensible limits (e.g., 255 for names, 1000 for notes/addresses).

---

### F-04 — Missing Location Coordinate Validation (MEDIUM)

**File:** `api/src/handlers/fillupCrud.ts:240-242`

`locationLat` and `locationLng` are accepted without type or range validation. They're cast directly with `as number` and stored. Invalid values (NaN, Infinity, out-of-range) would be persisted and could cause frontend map rendering issues.

**Recommendation:** Add coordinate validation:
```typescript
const coordErrors = validateRange(body, {
  locationLat: { min: -90, max: 90 },
  locationLng: { min: -180, max: 180 },
});
```

---

### F-05 — No API Gateway Throttling or Rate Limiting (MEDIUM)

**File:** `infra/lib/stacks/api-stack.ts:155-175`

The HTTP API has no throttle configuration. API Gateway v2 defaults to 10,000 requests/second with a 5,000 burst, which is far above what a <1,000 MAU app needs. This leaves the API open to:
- Credential stuffing (though mitigated by Cognito)
- DynamoDB cost amplification via rapid authenticated requests
- Abuse of export/PDF generation endpoints

**Recommendation:** Set explicit throttle limits on the HTTP API stage:
```typescript
const stage = this.httpApi.defaultStage?.node.defaultChild as apigwv2.CfnStage;
stage.addPropertyOverride('DefaultRouteSettings', {
  ThrottlingBurstLimit: 100,
  ThrottlingRateLimit: 50,
});
```

---

### F-06 — CSV Export Vulnerable to Formula Injection (MEDIUM)

**File:** `api/src/handlers/exportData.ts:142-149`

The `escapeCsvField()` function handles commas, quotes, and newlines but does not guard against CSV formula injection. If a user stores `=CMD("calc")` in a notes field, it would be exported verbatim. When opened in Excel, this could execute arbitrary commands.

**Recommendation:** Prefix fields starting with `=`, `+`, `-`, `@`, `\t`, or `\r` with a single quote:
```typescript
function escapeCsvField(value: unknown): string {
  if (value === null || value === undefined) return '';
  let str = String(value);
  if (/^[=+\-@\t\r]/.test(str)) str = `'${str}`;
  if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}
```

---

### F-07 — No Content Security Policy Headers on CloudFront (MEDIUM)

**File:** `infra/lib/stacks/frontend-stack.ts`

The CloudFront distribution does not set security response headers (CSP, X-Frame-Options, X-Content-Type-Options, Referrer-Policy, Permissions-Policy). This leaves the SPA vulnerable to:
- XSS via injected scripts (no CSP)
- Clickjacking (no X-Frame-Options)
- MIME-type sniffing attacks

**Recommendation:** Add a `ResponseHeadersPolicy` to the CloudFront distribution:
```typescript
const securityHeaders = new cloudfront.ResponseHeadersPolicy(this, 'SecurityHeaders', {
  securityHeadersBehavior: {
    contentSecurityPolicy: {
      contentSecurityPolicy: "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data: https://*.tile.openstreetmap.org; connect-src 'self' https://{apiDomain} https://{resourcePrefix}-photos.s3.us-east-1.amazonaws.com https://cognito-idp.us-east-1.amazonaws.com https://{authDomain}",
      override: true,
    },
    frameOptions: { frameOption: cloudfront.HeadersFrameOption.DENY, override: true },
    contentTypeOptions: { override: true },
    referrerPolicy: { referrerPolicy: cloudfront.HeadersReferrerPolicy.STRICT_ORIGIN_WHEN_CROSS_ORIGIN, override: true },
    strictTransportSecurity: { accessControlMaxAge: cdk.Duration.days(365), includeSubdomains: true, override: true },
  },
});
```

---

### F-08 — No Audit Trail for Admin Actions (MEDIUM)

**Files:** `api/src/handlers/adminUsers.ts`, `adminSchemas.ts`

Admin operations (granting/revoking admin privileges, creating/modifying/activating maintenance schemas) are logged to CloudWatch via the structured logger, but there is no dedicated audit trail. CloudWatch logs can be deleted or expire (1 week in non-prod). There is no record of who changed what, when, and from what previous value.

**Recommendation:** Create a dedicated audit log — either a DynamoDB audit table or CloudWatch Logs with a longer retention policy. Log the actor, action, target, previous value, new value, and timestamp for every admin mutation.

---

### F-09 — Presigned URL Filename Not Sanitized (MEDIUM)

**File:** `api/src/handlers/presignUrl.ts:52`, `api/src/lib/s3.ts:17`

The `filename` parameter from the request body is used directly in the S3 key via `buildS3Key()`. While the key is scoped to `{userId}/{vehicleId}/{type}/`, the filename itself is not sanitized. A filename like `../../../other-user/data` would be neutralized by S3's flat key namespace, but filenames with special characters, extremely long names, or null bytes could cause issues.

**Recommendation:** Sanitize the filename — strip path separators, limit length, and restrict to alphanumeric + common file characters:
```typescript
function sanitizeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 255);
}
```

---

### F-10 — `contentType` Not Validated on Presigned Upload (MEDIUM)

**File:** `api/src/handlers/presignUrl.ts:53`

The `contentType` from the request body is passed directly to the S3 `PutObjectCommand`. There is no validation that it's an image MIME type. A user could upload arbitrary content types (e.g., `text/html`, `application/javascript`) which, if served via CloudFront's `/photos/*` behavior, could enable stored XSS.

**Recommendation:** Whitelist allowed content types:
```typescript
const ALLOWED_CONTENT_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic'];
if (!ALLOWED_CONTENT_TYPES.includes(contentType)) {
  return error('VALIDATION_ERROR', 'Unsupported content type', requestId);
}
```

---

### F-11 — Error Stack Traces Logged in All Environments (LOW)

**File:** `api/src/lib/logger.ts:24`

The logger includes full error stack traces in structured log output across all environments. While this is useful for debugging, stack traces can reveal internal file paths, dependency versions, and code structure.

**Recommendation:** Consider omitting or truncating stack traces in production logs, or ensure CloudWatch log access is tightly controlled via IAM.

---

### F-12 — `--require-approval never` in Deploy Script (LOW)

**File:** `deploy.sh:262`

The deploy script uses `--require-approval never` for CDK deployments, which auto-approves IAM and security group changes without human review. While acceptable for test/staging, this is risky for production.

**Recommendation:** Use `--require-approval broadening` for production deployments to require approval for IAM/security changes:
```bash
APPROVAL_FLAG="--require-approval never"
if [[ "$DEPLOY_ENV" == "production" ]]; then
  APPROVAL_FLAG="--require-approval broadening"
fi
```

**Status: accepted risk (2026-10-20).** This was remediated with `--require-approval broadening` for production, then reverted to `--require-approval never` for every environment.
- **Why:** the app moved to a dedicated AWS account (`376784708284`) that holds nothing else, so the blast radius of a bad IAM change is limited to this app. Also, the interactive prompt blocked non-interactive deploys.
- **Compensating control:** IAM changes are reviewed in PRs. For changes to `infra/`, run `cdk diff --security-only` before a production deploy.
- **CI/CD (2026-10-20):** GitHub Actions deploys through OIDC roles that are effectively account admin (via the CDK bootstrap roles). Production deploys wait for approval in the `production` GitHub environment, and both environments only accept `main`. Pull requests get no AWS access. See [ci-cd.md](ci-cd.md).

---

### F-13 — No `npm audit` in CI/CD Pipeline (LOW)

**File:** `deploy.sh`

The deploy pipeline installs dependencies, builds, tests, and deploys but never runs `npm audit` to check for known vulnerabilities in dependencies. Supply chain attacks are an increasing risk.

**Recommendation:** Add `npm audit --audit-level=high` after `npm install` for each package directory. Fail the pipeline on high/critical vulnerabilities.

---

### F-14 — DynamoDB Table Names Hardcoded with Prefix (LOW)

**File:** `infra/lib/stacks/database-stack.ts`

Table names use the pattern `pawsitivemileage-{entity}-{env}` with a hardcoded `pawsitivemileage` prefix instead of using `config.resourcePrefix`. This means the `RESOURCE_PREFIX` env var doesn't fully control resource naming, which could cause conflicts if multiple deployments share an account.

**Recommendation:** Use `${config.resourcePrefix}-{entity}` consistently for all table names.

---

## Strengths

The following security practices are well-implemented:

- **Authentication:** Cognito JWT validation at the API Gateway level — handlers never see unauthenticated requests
- **Authorization:** Every handler extracts `userId` from JWT claims and scopes data access accordingly. Admin handlers verify `isAdmin` from DynamoDB before processing
- **Vehicle ownership:** `fillupCrud`, `maintenanceCrud`, `analytics`, `exportData`, and `importData` all verify vehicle ownership before operating on data. When ownership fails, handlers fall back to shared access checks via `authSharing.ts`, enforcing permission-based access (readonly, fuel, maintenance, full)
- **S3 access control:** All buckets use `BlockPublicAccess.BLOCK_ALL`, CloudFront uses OAC (not OAI), presigned URLs are scoped to `{userId}/{vehicleId}/`
- **IAM least privilege:** Each Lambda function is granted only the specific DynamoDB tables and S3 buckets it needs (read-only where possible)
- **CORS:** Properly scoped to the frontend domain in production, with localhost only in non-prod
- **Encryption:** S3 buckets use server-side encryption, CloudFront enforces TLS 1.2+, API Gateway uses HTTPS
- **Data protection:** Cascading account deletion properly removes all user data (DynamoDB records + S3 objects)
- **Secrets in `.env`:** `.env` is in `.gitignore`, `.env.example` contains only placeholder values
- **Production safeguards:** Termination protection on stateful stacks, RETAIN removal policies, production deploy requires `--yes` flag
- **Monitoring:** CloudWatch dashboard with API latency percentiles, Lambda errors, DynamoDB capacity metrics
- **Structured logging:** JSON logs with requestId, userId, handler, and timestamp — no sensitive data (tokens, passwords) logged

---

## Risk Summary

| ID | Severity | Finding | OWASP Category | Status |
|----|----------|---------|----------------|--------|
| F-01 | HIGH | OAuth secret in plaintext CDK context | A02: Cryptographic Failures | ✅ Remediated |
| F-02 | HIGH | No request body size limit | A03: Injection | ✅ Remediated |
| F-03 | HIGH | No string length validation | A03: Injection | ✅ Remediated |
| F-04 | MEDIUM | Missing coordinate validation | A03: Injection | ✅ Remediated |
| F-05 | MEDIUM | No API rate limiting | A04: Insecure Design | ✅ Remediated |
| F-06 | MEDIUM | CSV formula injection | A03: Injection | ✅ Remediated |
| F-07 | MEDIUM | No CSP headers on CloudFront | A05: Security Misconfiguration | ✅ Remediated |
| F-08 | MEDIUM | No admin action audit trail | A09: Security Logging Failures | ⬚ Not addressed |
| F-09 | MEDIUM | Presigned URL filename not sanitized | A03: Injection | ✅ Remediated |
| F-10 | MEDIUM | Upload content type not validated | A04: Insecure Design | ✅ Remediated |
| F-11 | LOW | Stack traces in production logs | A09: Security Logging Failures | ✅ Remediated |
| F-12 | LOW | Auto-approve IAM changes in prod | A05: Security Misconfiguration | ✅ Remediated |
| F-13 | LOW | No `npm audit` in pipeline | A06: Vulnerable Components | ✅ Remediated |
| F-14 | LOW | Hardcoded table name prefix | A05: Security Misconfiguration | ⬚ Not addressed |

---

## Recommended Remediation Priority

1. **F-01** — Move OAuth secret to Secrets Manager (HIGH, quick win)
2. **F-02** — Add body size limit to `parseBody()` (HIGH, one-line fix)
3. **F-03** — Add string length validation across handlers (HIGH, moderate effort)
4. **F-10** — Whitelist upload content types (MEDIUM, quick win)
5. **F-06** — Fix CSV formula injection (MEDIUM, quick win)
6. **F-09** — Sanitize presigned URL filenames (MEDIUM, quick win)
7. **F-05** — Add API Gateway throttling (MEDIUM, CDK change)
8. **F-07** — Add CSP headers via CloudFront response headers policy (MEDIUM, CDK change)
9. **F-04** — Add coordinate range validation (MEDIUM, quick win)
10. **F-08** — Implement admin audit logging (MEDIUM, new feature)
11. **F-12** — Use `--require-approval broadening` for prod (LOW, one-line fix)
12. **F-13** — Add `npm audit` to pipeline (LOW, quick win)
13. **F-11** — Truncate stack traces in production (LOW, minor change)
14. **F-14** — Use `config.resourcePrefix` for table names (LOW, breaking change — requires migration)

---

## Follow-up Review — 2026-05-22

A full follow-up code review ([`code-review-2026-05.md`](./code-review-2026-05.md)) found
no critical or high-severity issues, but surfaced three security-relevant findings not
covered by the original assessment. They are recorded here for continuity.

### F-15 — Import Handler Trusts Client-Supplied S3 Key (MEDIUM)

**File:** `api/src/handlers/importData.ts:375` (object read at `:87`, `:196`)

The import handler reads `s3Key` from the request body and passes it directly to
`GetObjectCommand` on the photos bucket. It verifies the caller owns the path
`vehicleId`, but never verifies that `s3Key` is scoped to the caller. S3 photo keys
are exposed verbatim in CloudFront URLs (`/photos/{userId}/{vehicleId}/...`) — and to
shared-vehicle users — so the `{userId}` prefix is not secret. This is a missing
object-level authorization control (security-by-obscurity only).

Separately, `importData.ts:47` defines a **local `parseBody`** that omits the
`maxBytes` size cap added to `lib/validation.ts` for **F-02** — a partial regression
of that remediation.

**Recommendation:** Reject any `s3Key` that does not begin with `${userId}/`. Replace
the local `parseBody` with the shared, size-capped implementation from `validation.ts`.

**Status — remediated 2026-10-20:** `importData` accepts only the vehicle owner's own
`csv-import` key for that vehicle (`isOwnCsvImportKey` in `api/src/lib/s3.ts`), and the
other handlers check submitted photo and receipt keys the same way (`photoKeyFieldError`).
The import handler still has its own `parseBody` without the 64 KB cap; its body is a
single validated `s3Key`, so the remaining exposure is the API Gateway payload limit.

### F-16 — Account Deletion Leaves Orphaned Sharing Records (MEDIUM)

**File:** `api/src/handlers/userProfile.ts:162-219`

Cascading account deletion removes vehicles, fillups, maintenance records, and S3
objects, but never deletes `Sharing` table rows — neither shares the user created
(`ownerUserId = userId`) nor shares targeting the user's email (`GSI1PK = email`).

Because shares key on email and Google sign-up auto-provisions accounts, a future
account that reuses the same email address would inherit stale shared-vehicle grants.
Deletion also leaves the Cognito user intact, so a later Google login silently
recreates an empty profile.

**Recommendation:** Delete all `Sharing` rows where `ownerUserId = userId` and all GSI1
rows where `GSI1PK = userEmail` during account deletion. Decide explicitly whether the
Cognito user should also be removed.

**Status — remediated 2026-10-22 (v1.4.0, #41):** `deleteAccount` deletes shares by the
owner and shares to the user's email, the user's exports, and finally the Cognito user
(`ListUsers` by `sub`, then `AdminDeleteUser`, scoped to the app's own pool). It's
retry-safe. A later Google sign-in starts a new, empty account.

### F-17 — CSP Allows Inline Scripts; Photos Served Publicly (LOW)

**File:** `infra/lib/stacks/frontend-stack.ts:79`, `:118`

The CloudFront `ResponseHeadersPolicy` sets `script-src 'self' 'unsafe-inline'`. The
`'unsafe-inline'` token largely defeats CSP's protection against injected scripts and
is weaker than the **F-07** recommendation (`script-src 'self'`). A Vite production
build does not emit inline scripts.

Additionally, the `/photos/*` CloudFront behavior serves objects with no signed URLs
or signed cookies — any photo (including receipts, which may contain PII) is readable
by anyone holding the key.

**Recommendation:** Remove `'unsafe-inline'` from `script-src` and verify the SPA still
loads. For photos, consider CloudFront signed URLs/cookies, or formally document the
access model as an accepted tradeoff.

### Follow-up Risk Summary

| ID | Severity | Finding | OWASP Category | Status |
|----|----------|---------|----------------|--------|
| F-15 | MEDIUM | Import handler trusts client-supplied S3 key | A01: Broken Access Control | ✅ Remediated 2026-10-20 (key check); local `parseBody` remains |
| F-16 | MEDIUM | Account deletion leaves orphaned sharing records | A01: Broken Access Control | ✅ Remediated 2026-10-22 (v1.4.0) |
| F-17 | LOW | CSP allows inline scripts; photos served publicly | A05: Security Misconfiguration | ⬚ Not addressed |
