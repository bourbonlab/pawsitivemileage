# Tech Stack & Build

## Frontend (`web/`)
- React 19.2.x with TypeScript 5.9.x
- Vite 7.3.x (build tool, HMR, `@tailwindcss/vite` plugin)
- React Router v7.13.x (`createBrowserRouter`, element-based routes)
- TanStack Query v5.90.x (5-min stale time, single retry, no refetch on window focus)
- shadcn/ui + Radix v1.4.x (mobile-first components: alert, badge, button, card, dialog, input, label, select, separator, switch, table, tabs, textarea)
- Recharts 2.15.x (MPG, spending, cost per mile, cost per gallon charts)
- Leaflet 1.9.x + react-leaflet 5.x (fillup location maps and picker)
- Lucide React 0.564.x (icons)
- Tailwind CSS 4.1.x with tailwind-merge 3.4.x + clsx 2.1.x via `cn()` helper
- AWS Amplify JS v6.16.x (Cognito OAuth, token management)
- class-variance-authority 0.7.x (component variants)

## Backend (`api/`)
- AWS Lambda, Node.js 24.x runtime
- esbuild 0.27.x for bundling (ESM output, tree-shaking, minified, source maps, `@aws-sdk/*` externalized)
- API Gateway v2 (HTTP API), JWT authorizer (Cognito)
- All routes prefixed `/v1/`
- Single-purpose Lambda per route group (11 handlers total)
- AWS SDK v3: `@aws-sdk/client-dynamodb` ^3.990, `@aws-sdk/lib-dynamodb` ^3.990, `@aws-sdk/client-s3` ^3.990, `@aws-sdk/s3-request-presigner` ^3.990
- ULID 3.x for sortable unique IDs

## Infrastructure (`infra/`)
- AWS CDK 2.238.x (`aws-cdk-lib`) with constructs 10.4.x
- CDK CLI via `aws-cdk` ^2.1106.x (devDependency)
- TypeScript 5.9.x, tsx 4.21.x for running scripts
- 6 stacks per environment with explicit dependency ordering:
  - Auth → (no deps)
  - Database → (no deps)
  - Storage → (no deps)
  - API → depends on Auth, Database, Storage
  - Frontend → depends on API
  - Monitoring → depends on API, Database
- Stack naming: `PawsitiveMileage-{env}-{StackName}`
- Custom `AppFunction` construct: NodejsFunction + dedicated LogGroup + X-Ray tracing

### Lambda Function Configuration (via AppFunction construct)
- Runtime: Node.js 24.x
- Memory: 256 MB
- Timeout: 30 seconds
- Tracing: AWS X-Ray active
- Bundling: CDK NodejsFunction with esbuild (ESM, minified, tree-shaking, source maps)
- Log retention: 1 week (non-production), 3 months (production)
- Log removal: DESTROY (non-production), RETAIN (production)
- `NODE_OPTIONS=--enable-source-maps` set automatically

### Environment-Specific Behavior
| Aspect | Non-Production | Production |
|--------|---------------|------------|
| DynamoDB removal policy | DESTROY | RETAIN |
| S3 removal policy | DESTROY (auto-delete) | RETAIN |
| Log retention | 1 week | 3 months |
| CORS origins | Frontend domain + `localhost:5173` | Frontend domain only |
| Cognito callback URLs | Frontend domain + `localhost:5173` | Frontend domain only |
| Termination protection | Off | On (Database, Storage) |

## CLI (`cli/`)
- TypeScript 5.9.x, run via `npx tsx`
- AWS SDK v3: `@aws-sdk/client-dynamodb` ^3.800, `@aws-sdk/lib-dynamodb` ^3.800
- Scripts: `backfill-gsi2.ts` (backfill GSI2PK/GSI2SK on fillup items)

## Data
- DynamoDB single-table design per entity (5 tables, 6 GSIs, on-demand billing, PITR enabled)
- S3 for photos/receipts (presigned uploads), exports (7-day lifecycle), and frontend static hosting
- CloudFront CDN for frontend (OAC, TLS 1.2, SPA 403/404 → index.html)

## Auth
- AWS Cognito User Pool with Google OAuth 2.0 (sole identity provider)
- Cognito Hosted UI, authorization code grant (PKCE), no client secret (SPA)
- OAuth scopes: openid, email, profile, aws.cognito.signin.user.admin
- JWT tokens validated by API Gateway v2 JWT authorizer
- Admin flag stored in DynamoDB Users table (`isAdmin` field)
- Cognito domain prefix: `pmileage-{env}` (avoids "aws" substring rejection)

## DNS
- CloudFlare (proxied, Full Strict SSL)
- ACM certificate in us-east-1 for CloudFront and API Gateway custom domains

## Testing
- Vitest 4.x across all packages (`vitest run` for CI, `vitest` for watch mode)
- fast-check 4.5.x for property-based testing (metrics, reminders)
- @testing-library/react 16.x + jsdom 28.x for frontend component tests
- @vitest/coverage-v8 4.x for coverage
- API coverage includes `src/**/*.ts` but excludes `src/handlers/**/*.ts`
- Test files: `api/tests/unit/metrics.test.ts`, `api/tests/unit/reminders.test.ts`, `api/tests/unit/userProfile.test.ts`

## Monitoring
- CloudWatch Dashboard per environment (`{prefix}-dashboard`)
  - API latency (p50/p95/p99), request count, 4xx/5xx errors
  - Lambda duration p95 per function, Lambda errors per function
  - DynamoDB read/write capacity per table
- Structured JSON logging via `createLogger()` (level, message, requestId, userId, handler, timestamp)
- AWS X-Ray active tracing on all Lambda functions

## Common Commands
```bash
# Frontend
cd web && npm install && npm run dev      # local dev server (localhost:5173)
cd web && npm run build                   # production build (tsc + vite build)
cd web && npm run lint                    # type check (tsc --noEmit)

# API
cd api && npm install
cd api && npm run build                   # esbuild bundle → api/dist/
cd api && npm test                        # vitest run
cd api && npm run lint                    # type check

# CDK
cd infra && npm install
cd infra && npx cdk synth                 # synthesize stacks
cd infra && npx cdk deploy --all          # deploy all stacks

# CLI
cd cli && npm install
FILLUPS_TABLE=pawsitivemileage-fillups-test npx tsx src/backfill-gsi2.ts

# Full pipeline
./deploy.sh              # synth only (no deploy)
./deploy.sh --test       # deploy to test
./deploy.sh --stage      # deploy to staging
./deploy.sh --prod --yes # deploy to production
./deploy.sh --skip-tests # skip test suite
./deploy.sh --verbose    # detailed output

# Type checking across all packages
cd api && npm run lint
cd web && npm run lint
cd infra && npm run lint
cd cli && npm run lint
```

## Deployment Pipeline (`deploy.sh`)
1. Prerequisite checks (Node.js 24+, npm, AWS CLI, CDK)
2. AWS credential verification (`sts get-caller-identity`)
3. Load and validate `.env` (all required vars present, no placeholders)
4. `npm install` in api/, web/, infra/
5. API build (esbuild → `api/dist/`)
6. API tests (vitest, skippable with `--skip-tests`)
7. CDK synth with environment context variables
8. CDK deploy all stacks (if environment flag provided)
9. Fetch Cognito outputs from CloudFormation stack
10. Build frontend with `VITE_*` env vars baked in
11. S3 sync `web/dist/` to frontend bucket
12. CloudFront cache invalidation

## Environment Variables

### Deployment (`.env` at project root, sourced by `deploy.sh`)
- `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` — Google OAuth 2.0 credentials
- `ACM_CERTIFICATE_ARN` — ACM certificate ARN (us-east-1)
- `FRONTEND_DOMAIN_TEST` / `FRONTEND_DOMAIN_STAGING` / `FRONTEND_DOMAIN_PRODUCTION`
- `API_DOMAIN_TEST` / `API_DOMAIN_STAGING` / `API_DOMAIN_PRODUCTION`
- `RESOURCE_PREFIX` — prefix for all AWS resource names (default: `pawsitivemileage`)
- `COGNITO_DOMAIN_PREFIX` — Cognito hosted UI domain prefix (default: `pmileage`)

### Frontend (`web/.env.local`, from CDK stack outputs)
- `VITE_API_URL` — API Gateway endpoint
- `VITE_COGNITO_USER_POOL_ID` — Cognito User Pool ID
- `VITE_COGNITO_APP_CLIENT_ID` — Cognito App Client ID
- `VITE_COGNITO_DOMAIN` — Cognito Hosted UI domain

### Lambda (set automatically by CDK)
- `USERS_TABLE`, `VEHICLES_TABLE`, `FILLUPS_TABLE`, `MAINTENANCE_TABLE`, `SCHEMAS_TABLE`
- `PHOTOS_BUCKET`, `EXPORTS_BUCKET`
- `FRONTEND_DOMAIN`, `ENVIRONMENT`
- `NODE_OPTIONS=--enable-source-maps`

## Conventions
- TypeScript everywhere (frontend, backend, infra, CLI) with strict mode
- ES2022 target, bundler module resolution (tsconfig.base.json)
- Structured JSON logging in Lambda functions
- Environment variables for all config (table names, bucket names, domains)
- ULID for all entity IDs (sortable, unique)
- Consistent API response envelope (`{ data, requestId }` / `{ error, code, requestId }`)
- Use latest stable runtimes and libraries to minimize future refactoring
- S3 keys: `{userId}/{vehicleId}/{type}/{filename}` for photos/receipts
