# Implementation Plan: Security Hardening

## Overview

Implement 12 security remediations across the PawsitiveMileage stack. The plan starts with the shared validation module (used by all handlers), then updates each handler, then infrastructure stacks, and finally the deploy script. Property-based tests are written alongside each component.

## Tasks

- [ ] 1. Harden the validation module
  - [ ] 1.1 Add body size limit to `parseBody()` in `api/src/lib/validation.ts`
    - Add optional `maxBytes` parameter (default 65,536)
    - Return `null` if `body.length > maxBytes` before calling `JSON.parse`
    - _Requirements: 2.1, 2.2, 2.3_

  - [ ] 1.2 Add `validateStringLength()` function to `api/src/lib/validation.ts`
    - Accept `body` and `limits: Record<string, number>`
    - Return `ValidationError[]` for fields exceeding their limit
    - _Requirements: 3.1, 3.2_

  - [ ] 1.3 Add `validateCoordinates()` function to `api/src/lib/validation.ts`
    - Validate `locationLat` in [-90, 90] and `locationLng` in [-180, 180]
    - Return `ValidationError[]` for out-of-range or wrong-type values
    - _Requirements: 4.1, 4.2, 4.3_

  - [ ] 1.4 Add `sanitizeFilename()` function to `api/src/lib/validation.ts`
    - Strip `/` and `\`, remove chars outside `[a-zA-Z0-9._\- ]`, trim, truncate to 255
    - Return `null` if result is empty
    - _Requirements: 8.1, 8.2, 8.3, 8.4_

  - [ ]* 1.5 Write property tests for validation module in `api/tests/unit/security.test.ts`
    - **Property 1: Body size enforcement** — _Validates: Requirements 2.1, 2.3_
    - **Property 2: parseBody round-trip for valid JSON** — _Validates: Requirements 2.2_
    - **Property 3: String length validation rejects oversized fields** — _Validates: Requirements 3.2_
    - **Property 4: Coordinate range validation** — _Validates: Requirements 4.1, 4.2_
    - **Property 6: Filename sanitization output invariants** — _Validates: Requirements 8.1, 8.2, 8.3_
    - **Property 7: Filename sanitization rejects all-invalid inputs** — _Validates: Requirements 8.4_

- [ ] 2. Harden the export handler and presign handler
  - [ ] 2.1 Fix CSV formula injection in `api/src/handlers/exportData.ts`
    - Update `escapeCsvField()` to prefix fields starting with `=`, `+`, `-`, `@`, `\t`, `\r` with a single quote before standard CSV escaping
    - _Requirements: 6.1, 6.2_

  - [ ] 2.2 Add content type whitelist and filename sanitization to `api/src/handlers/presignUrl.ts`
    - Add `ALLOWED_CONTENT_TYPES` array: `image/jpeg`, `image/png`, `image/webp`, `image/heic`
    - Validate `contentType` against the whitelist, return 400 if invalid
    - Call `sanitizeFilename()` on the `filename` field, return 400 if null
    - _Requirements: 9.1, 9.2, 8.1, 8.2, 8.3, 8.4_

  - [ ]* 2.3 Write property tests for export and presign hardening in `api/tests/unit/security.test.ts`
    - **Property 5: CSV formula injection guard** — _Validates: Requirements 6.1, 6.2_
    - **Property 8: Content type whitelist** — _Validates: Requirements 9.1_

- [ ] 3. Harden remaining API handlers with string length and coordinate validation
  - [ ] 3.1 Add `validateStringLength` calls to `api/src/handlers/fillupCrud.ts`
    - Validate `stationName` (255), `address` (1000), `notes` (1000) in create and update paths
    - Add `validateCoordinates(body)` call after existing validation in create and update paths
    - _Requirements: 3.3, 4.1, 4.2, 4.3_

  - [ ] 3.2 Add `validateStringLength` calls to `api/src/handlers/vehicleCrud.ts`
    - Validate `make` (100), `model` (100), `trim` (100), `color` (50), `vin` (17), `licensePlate` (20), `notes` (1000) in create and update paths
    - _Requirements: 3.4_

  - [ ] 3.3 Add `validateStringLength` calls to `api/src/handlers/userProfile.ts`
    - Validate `displayName` (255) in the update path
    - _Requirements: 3.5_

  - [ ] 3.4 Add `validateStringLength` calls to `api/src/handlers/maintenanceCrud.ts`
    - Validate `notes` (1000), `serviceName` (255) in create and update paths
    - _Requirements: 3.3_

  - [ ] 3.5 Add `validateStringLength` calls to `api/src/handlers/adminSchemas.ts`
    - Validate `name` (255), `description` (1000) in create and update paths
    - _Requirements: 3.6_

- [ ] 4. Harden the logger
  - [ ] 4.1 Add production stack trace suppression to `api/src/lib/logger.ts`
    - Check `process.env.ENVIRONMENT === 'production'`
    - Omit `stack` field from error log entries in production
    - Make `stack` optional in the `LogEntry` interface
    - _Requirements: 10.1, 10.2_

  - [ ]* 4.2 Write property test for logger stack trace suppression in `api/tests/unit/security.test.ts`
    - **Property 9: Logger stack trace environment-conditional** — _Validates: Requirements 10.1, 10.2_

- [ ] 5. Checkpoint — Ensure all API-layer tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 6. Harden CDK infrastructure stacks
  - [ ] 6.1 Move OAuth secret to Secrets Manager in `infra/lib/stacks/auth-stack.ts`
    - Replace `cdk.SecretValue.unsafePlainText(googleClientSecret)` with `cdk.SecretValue.secretsManagerValue(secretName)`
    - Read secret name from CDK context (`googleClientSecretArn`)
    - _Requirements: 1.1, 1.2_

  - [ ] 6.2 Add API Gateway throttling in `infra/lib/stacks/api-stack.ts`
    - Use L1 escape hatch on the default stage `CfnStage`
    - Set `throttlingBurstLimit: 100` and `throttlingRateLimit: 50`
    - _Requirements: 5.1, 5.2_

  - [ ] 6.3 Add CloudFront security response headers in `infra/lib/stacks/frontend-stack.ts`
    - Create a `ResponseHeadersPolicy` with CSP, X-Frame-Options (DENY), X-Content-Type-Options (nosniff), Referrer-Policy (strict-origin-when-cross-origin), HSTS (31536000s, includeSubDomains)
    - Attach the policy to the default behavior and `/photos/*` behavior
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6_

- [ ] 7. Harden the deploy script
  - [ ] 7.1 Update `deploy.sh` for production approval gate
    - Use `--require-approval broadening` when `DEPLOY_ENV` is `production`
    - Keep `--require-approval never` for non-production
    - _Requirements: 11.1, 11.2_

  - [ ] 7.2 Remove plaintext secret from CDK context in `deploy.sh`
    - Remove `-c googleClientSecret="$GOOGLE_CLIENT_SECRET"` from CDK context array
    - Add `-c googleClientSecretArn="$GOOGLE_CLIENT_SECRET_ARN"` instead
    - Add `GOOGLE_CLIENT_SECRET_ARN` to the required env var checks
    - _Requirements: 1.3, 1.4_

  - [ ] 7.3 Add `npm audit` to the deploy pipeline in `deploy.sh`
    - Run `npm audit --audit-level=high` after each `npm install` step
    - Print warning on vulnerabilities but do not fail the build
    - _Requirements: 12.1, 12.2_

- [ ] 8. Final checkpoint — Ensure all tests pass and CDK synth succeeds
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Property tests use fast-check 4.5.x with minimum 100 iterations per property
- CDK infrastructure changes are verified via `cdk synth` — no property tests needed
- Deploy script changes are manual verification only
