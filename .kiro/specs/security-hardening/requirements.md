# Requirements Document

## Introduction

This specification addresses 12 security findings from the PawsitiveMileage security assessment (2026-02-15). The findings span the full stack — frontend CDN, backend Lambda handlers, CDK infrastructure, and the deployment pipeline. Remediation covers secret management, input validation, output sanitization, rate limiting, security headers, and deployment hygiene.

## Glossary

- **API_Handler**: A Lambda function that processes HTTP requests routed through API Gateway v2
- **Validation_Module**: The shared `api/src/lib/validation.ts` module used by all API handlers for input parsing and validation
- **Auth_Stack**: The CDK stack (`infra/lib/stacks/auth-stack.ts`) that provisions Cognito, the Google identity provider, and OAuth configuration
- **API_Stack**: The CDK stack (`infra/lib/stacks/api-stack.ts`) that provisions the HTTP API, routes, and JWT authorizer
- **Frontend_Stack**: The CDK stack (`infra/lib/stacks/frontend-stack.ts`) that provisions the S3 bucket, CloudFront distribution, and related resources
- **Logger**: The structured JSON logger (`api/src/lib/logger.ts`) used by all Lambda handlers
- **Export_Handler**: The Lambda handler (`api/src/handlers/exportData.ts`) responsible for CSV and PDF exports
- **Presign_Handler**: The Lambda handler (`api/src/handlers/presignUrl.ts`) responsible for generating presigned S3 upload URLs
- **Deploy_Script**: The CI/CD pipeline script (`deploy.sh`) that builds, tests, and deploys the application

## Requirements

### Requirement 1: Secure OAuth Secret Management

**User Story:** As a platform operator, I want the Google OAuth client secret stored in AWS Secrets Manager instead of plaintext CDK context, so that the secret is not exposed in process listings, CloudFormation templates, or `cdk.context.json`.

#### Acceptance Criteria

1. THE Auth_Stack SHALL retrieve the Google OAuth client secret from AWS Secrets Manager using `cdk.SecretValue.secretsManagerValue()`
2. WHEN the Auth_Stack constructs the Google identity provider, THE Auth_Stack SHALL pass the Secrets Manager reference as `clientSecretValue` instead of `cdk.SecretValue.unsafePlainText()`
3. THE Deploy_Script SHALL remove the Google client secret from CDK context arguments (`-c googleClientSecret=...`)
4. THE Deploy_Script SHALL accept a Secrets Manager secret name or ARN as a CDK context parameter for the OAuth secret reference

### Requirement 2: Request Body Size Enforcement

**User Story:** As a backend developer, I want the request body parser to enforce a maximum size limit, so that oversized payloads are rejected before JSON parsing.

#### Acceptance Criteria

1. WHEN a request body exceeds 65,536 bytes, THE Validation_Module SHALL return null from `parseBody()` without attempting JSON parsing
2. WHEN a request body is within the size limit, THE Validation_Module SHALL parse the body as JSON and return the result
3. THE Validation_Module SHALL accept an optional `maxBytes` parameter to override the default 65,536-byte limit

### Requirement 3: String Length Validation for Text Fields

**User Story:** As a backend developer, I want all user-supplied text fields validated for maximum length, so that excessively long strings cannot be stored in the database.

#### Acceptance Criteria

1. THE Validation_Module SHALL provide a `validateStringLength()` function that checks string fields against specified maximum lengths
2. WHEN a text field exceeds its maximum allowed length, THE Validation_Module SHALL return a validation error identifying the field and the limit
3. WHEN processing fillup data, THE API_Handler SHALL validate `stationName`, `address`, and `notes` with maximum lengths of 255, 1000, and 1000 characters respectively
4. WHEN processing vehicle data, THE API_Handler SHALL validate `make`, `model`, `trim`, `color`, `vin`, `licensePlate`, and `notes` with maximum lengths of 100, 100, 100, 50, 17, 20, and 1000 characters respectively
5. WHEN processing user profile data, THE API_Handler SHALL validate `displayName` with a maximum length of 255 characters
6. WHEN processing maintenance schema data, THE API_Handler SHALL validate `name` and `description` with maximum lengths of 255 and 1000 characters respectively

### Requirement 4: Location Coordinate Validation

**User Story:** As a backend developer, I want location coordinates validated for type and range, so that invalid geographic data cannot be stored.

#### Acceptance Criteria

1. WHEN a fillup includes `locationLat`, THE API_Handler SHALL validate that the value is a number between -90 and 90 inclusive
2. WHEN a fillup includes `locationLng`, THE API_Handler SHALL validate that the value is a number between -180 and 180 inclusive
3. IF `locationLat` or `locationLng` fails validation, THEN THE API_Handler SHALL return a 400 response with a descriptive validation error

### Requirement 5: API Gateway Throttling

**User Story:** As a platform operator, I want explicit rate limits on the HTTP API, so that the backend is protected from traffic spikes and abuse.

#### Acceptance Criteria

1. THE API_Stack SHALL configure the HTTP API default stage with a burst limit of 100 requests
2. THE API_Stack SHALL configure the HTTP API default stage with a rate limit of 50 requests per second

### Requirement 6: CSV Formula Injection Prevention

**User Story:** As a backend developer, I want CSV exports to sanitize fields against formula injection, so that exported files cannot execute formulas when opened in spreadsheet applications.

#### Acceptance Criteria

1. WHEN a CSV field value starts with `=`, `+`, `-`, `@`, a tab character, or a carriage return character, THE Export_Handler SHALL prefix the field with a single quote character
2. WHEN a CSV field value does not start with a formula-triggering character, THE Export_Handler SHALL output the field unchanged (aside from standard CSV escaping)

### Requirement 7: CloudFront Security Response Headers

**User Story:** As a platform operator, I want CloudFront to attach security headers to all responses, so that the frontend is protected against common web vulnerabilities.

#### Acceptance Criteria

1. THE Frontend_Stack SHALL create a Response_Headers_Policy with a Content-Security-Policy header that restricts script sources, style sources, image sources, font sources, and connect sources to known origins
2. THE Frontend_Stack SHALL set the X-Frame-Options header to DENY via the Response_Headers_Policy
3. THE Frontend_Stack SHALL set the X-Content-Type-Options header to nosniff via the Response_Headers_Policy
4. THE Frontend_Stack SHALL set the Referrer-Policy header to strict-origin-when-cross-origin via the Response_Headers_Policy
5. THE Frontend_Stack SHALL enable Strict-Transport-Security with a max-age of at least 31536000 seconds and includeSubDomains via the Response_Headers_Policy
6. THE Frontend_Stack SHALL attach the Response_Headers_Policy to the default behavior and all additional behaviors of the CloudFront distribution

### Requirement 8: Presigned URL Filename Sanitization

**User Story:** As a backend developer, I want uploaded filenames sanitized before use in S3 keys, so that path traversal and malformed keys are prevented.

#### Acceptance Criteria

1. WHEN generating a presigned URL, THE Presign_Handler SHALL strip path separator characters (`/`, `\`) from the filename
2. WHEN generating a presigned URL, THE Presign_Handler SHALL restrict the filename to alphanumeric characters, hyphens, underscores, periods, and spaces
3. WHEN generating a presigned URL, THE Presign_Handler SHALL truncate the sanitized filename to a maximum of 255 characters
4. IF the sanitized filename is empty after processing, THEN THE Presign_Handler SHALL return a 400 validation error

### Requirement 9: Upload Content Type Validation

**User Story:** As a backend developer, I want presigned upload URLs restricted to allowed image content types, so that arbitrary file types cannot be uploaded to the photos bucket.

#### Acceptance Criteria

1. THE Presign_Handler SHALL accept only `image/jpeg`, `image/png`, `image/webp`, and `image/heic` as valid content types
2. IF the requested content type is not in the allowed list, THEN THE Presign_Handler SHALL return a 400 validation error listing the allowed types

### Requirement 10: Production Stack Trace Suppression

**User Story:** As a backend developer, I want error stack traces omitted from production logs, so that internal implementation details are not exposed in production log streams.

#### Acceptance Criteria

1. WHILE the `ENVIRONMENT` variable is set to `production`, THE Logger SHALL omit the `stack` field from structured error log entries
2. WHILE the `ENVIRONMENT` variable is not set to `production`, THE Logger SHALL include the full `stack` field in structured error log entries

### Requirement 11: Production Deployment Approval Gate

**User Story:** As a platform operator, I want production CDK deployments to require approval for security-broadening changes, so that IAM and security group changes are reviewed before deployment.

#### Acceptance Criteria

1. WHEN deploying to the production environment, THE Deploy_Script SHALL use `--require-approval broadening` instead of `--require-approval never`
2. WHEN deploying to non-production environments, THE Deploy_Script SHALL continue using `--require-approval never`

### Requirement 12: Dependency Vulnerability Scanning in CI/CD

**User Story:** As a platform operator, I want the deployment pipeline to check for known dependency vulnerabilities, so that packages with high-severity CVEs are flagged before deployment.

#### Acceptance Criteria

1. THE Deploy_Script SHALL run `npm audit --audit-level=high` for each package directory (`api/`, `web/`, `infra/`) after `npm install`
2. IF `npm audit` reports high or critical vulnerabilities, THEN THE Deploy_Script SHALL print a warning but continue the deployment (non-blocking)


