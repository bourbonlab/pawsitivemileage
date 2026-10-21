# 🐾 PawsitiveMileage

A serverless vehicle fuel tracking and maintenance management application built on AWS. Users log fuel purchases with minimal input and the system auto-calculates MPG, cost per mile, price per gallon, and miles between fillups.

Built with React 19, AWS Lambda (Node.js 24.x), DynamoDB, and CDK — designed to run for under $12/month at 1,000 users.

**License:** [GNU AGPL v3](LICENSE)

---

## Table of Contents

- [Features](#features)
- [Screenshots](#screenshots)
- [Architecture](#architecture)
- [Project Structure](#project-structure)
- [Tech Stack](#tech-stack)
- [Prerequisites](#prerequisites)
- [Getting Started](#getting-started)
- [Environment Variables](#environment-variables)
- [Deployment](#deployment)
- [API Reference](#api-reference)
- [Data Model](#data-model)
- [Authentication](#authentication)
- [Frontend Architecture](#frontend-architecture)
- [Backend Architecture](#backend-architecture)
- [Infrastructure](#infrastructure)
- [CLI Tools](#cli-tools)
- [Testing](#testing)
- [Monitoring](#monitoring)
- [Cost Estimate](#cost-estimate)
- [Sample Data](#sample-data)
- [Security](#security)
- [License](#license)

---

## Features

**Fuel Tracking**
- Log fillups with date, amount spent, gallons, and odometer reading
- Auto-calculated MPG, cost per mile, price per gallon, miles between fillups
- Partial fill support (defers MPG calculation until next full fill, accumulating gallons and miles)
- Receipt photo uploads via S3 presigned URLs
- Optional location tagging (browser geolocation, map picker via Leaflet, or manual entry)

**Garage / Multi-Vehicle**
- Add unlimited vehicles with make, model, year, photo, and specs (trim, color, VIN, license plate, tank size, fuel type)
- Archive/unarchive vehicles without losing historical data
- Per-vehicle fillup and maintenance history

**Maintenance Tracking**
- Admin-configurable maintenance schemas (Oil Change, Tire Rotation, etc.) with mileage and time intervals
- Per-vehicle maintenance records with cost, odometer, and receipt photos
- Mileage-based and time-based reminder calculations (500-mile / 30-day thresholds)
- Custom one-off maintenance entries not tied to a schema
- Per-vehicle interval overrides for global schemas

**Analytics & Reporting**
- MPG over time, monthly spending, cost per mile, cost per gallon trend charts (Recharts)
- Year-over-year comparisons with percentage change indicators
- Shareable summary cards (annual vehicle stats)
- CSV export for fillups and maintenance with date range filtering
- PDF report generation

**Data Import & Recalculation**
- Import Fuelly CSV exports (fuelups and maintenance) via S3 presigned upload
- CSV parsing with field mapping, validation, and skip logic for invalid rows
- Fillup and maintenance imports allow multiple entries per day (no duplicate filtering)
- Bulk metrics recalculation for all fillups on a vehicle
- Import result summary (imported, skipped, errors)

**Vehicle Sharing**
- Share vehicles with other users by email address
- Three permission levels: Read Only, Fuel & Maintenance (add/edit/delete fillups and maintenance records), and Full Access (also CSV import and metric recalculation). Legacy maintenance-only shares behave like Fuel & Maintenance
- Records created or edited by shared users are attributed to the vehicle owner
- Shared vehicles appear in a dedicated "Shared Garage" section on the Garage page
- Permission-based UI controls — edit/delete buttons hidden based on access level
- Email-based sharing without registration check (prevents user enumeration)
- Owner-only sharing management dialog with add, update, and revoke controls

**Admin Panel**
- User management with admin role assignment
- Maintenance schema CRUD with activate/deactivate
- Platform-wide statistics (total users, vehicles, fillups, maintenance records)
- CloudWatch monitoring dashboard

**Auth**
- Google OAuth 2.0 via AWS Cognito Hosted UI
- JWT-based API authorization (API Gateway v2 JWT authorizer)
- Role-based access control (user vs admin, admin flag stored in DynamoDB)

---

## Screenshots

### Garage
![Garage](docs/Garage.png)

### Fillups
![Fillups](docs/Fillups.png)

### Analytics
![Analytics](docs/Analytics.png)

### Admin Dashboard
![Admin Dashboard](docs/AdminDashboard.png)

---

## Architecture

```
┌─────────────┐     ┌──────────────┐     ┌─────────────────┐
│  CloudFlare  │────▶│  CloudFront  │────▶│   S3 (Frontend)  │
│  (DNS/Proxy) │     │  (CDN/TLS)   │     │   React SPA      │
└─────────────┘     └──────────────┘     └─────────────────┘
       │
       │            ┌──────────────┐     ┌─────────────────┐
       └───────────▶│ API Gateway  │────▶│  Lambda (×12)    │
                    │ HTTP API v2  │     │  Node.js 24.x    │
                    │ JWT Auth     │     └────────┬────────┘
                    └──────────────┘              │
                                                  ▼
                    ┌──────────────┐     ┌─────────────────┐
                    │   Cognito    │     │   DynamoDB (×6)  │
                    │  User Pool   │     │   On-Demand      │
                    │  Google IdP  │     │   + GSIs + PITR  │
                    └──────────────┘     └─────────────────┘
                                                  │
                                         ┌────────┴────────┐
                                         ▼                  ▼
                                  ┌────────────┐   ┌────────────┐
                                  │ S3 (Photos)│   │S3 (Exports)│
                                  │ Presigned  │   │ 7-day TTL  │
                                  └────────────┘   └────────────┘
```

All infrastructure is serverless — zero cost when idle, scales automatically. DNS is managed in CloudFlare with proxy enabled (Full Strict SSL mode). ACM certificates in us-east-1 provide TLS for CloudFront and API Gateway custom domains.

---

## Project Structure

```
pawsitivemileage/
├── web/                    # React frontend (Vite + TypeScript)
│   ├── src/
│   │   ├── api/            # API client functions (typed fetch wrappers)
│   │   │   ├── client.ts   # Base apiClient with auth token injection
│   │   │   ├── vehicles.ts # Vehicle CRUD calls
│   │   │   ├── fillups.ts  # Fillup CRUD calls
│   │   │   ├── maintenance.ts
│   │   │   ├── analytics.ts
│   │   │   ├── upload.ts   # Presigned URL upload (photos + CSV import)
│   │   │   ├── import.ts   # CSV import + metrics recalculation mutations
│   │   │   ├── sharing.ts  # Vehicle sharing CRUD + shared vehicles query
│   │   │   └── admin.ts    # Admin API calls
│   │   ├── auth/           # Amplify config, AuthProvider, route guards
│   │   │   ├── amplify-config.ts  # Cognito configuration from VITE_ env vars
│   │   │   ├── AuthProvider.tsx   # React context with user state + admin flag
│   │   │   ├── ProtectedRoute.tsx # Redirects unauthenticated users to /login
│   │   │   └── AdminRoute.tsx     # Redirects non-admin users
│   │   ├── components/     # UI components
│   │   │   ├── Layout.tsx          # App shell with nav, sidebar, mobile menu
│   │   │   ├── AppVersion.tsx      # Footer release version (links to the GitHub release)
│   │   │   ├── VehicleCard.tsx     # Garage vehicle card
│   │   │   ├── FillupList.tsx      # Fillup history table
│   │   │   ├── FillupMap.tsx       # Leaflet map of fillup locations
│   │   │   ├── MaintenanceList.tsx # Maintenance history table
│   │   │   ├── ReminderBanner.tsx  # Upcoming maintenance alerts
│   │   │   ├── SummaryCard.tsx     # Shareable annual stats card
│   │   │   ├── PhotoUpload.tsx     # S3 presigned URL photo upload
│   │   │   ├── ImportDialog.tsx   # Fuelly CSV import dialog (upload + import flow)
│   │   │   ├── LocationPicker.tsx  # Leaflet map picker for fillup location
│   │   │   ├── SharedGarageSection.tsx # Shared vehicles display with permission badges
│   │   │   ├── SharingManagementDialog.tsx # Owner dialog to manage vehicle shares
│   │   │   ├── charts/            # Recharts chart components
│   │   │   │   ├── MpgChart.tsx
│   │   │   │   ├── SpendingChart.tsx
│   │   │   │   ├── CostPerMileChart.tsx
│   │   │   │   └── CostPerGallonChart.tsx
│   │   │   └── ui/               # shadcn/ui primitives (Radix-based)
│   │   ├── lib/            # Utilities
│   │   │   ├── utils.ts    # cn() helper (clsx + tailwind-merge)
│   │   │   └── metrics.ts  # Client-side metric formatting
│   │   ├── pages/          # Route pages
│   │   │   ├── LoginPage.tsx
│   │   │   ├── GaragePage.tsx
│   │   │   ├── VehicleDetailPage.tsx
│   │   │   ├── AddFillupPage.tsx
│   │   │   ├── AddMaintenancePage.tsx
│   │   │   ├── AnalyticsPage.tsx
│   │   │   ├── ExportPage.tsx
│   │   │   ├── AccountPage.tsx
│   │   │   ├── AdminUsersPage.tsx
│   │   │   ├── AdminSchemasPage.tsx
│   │   │   ├── AdminStatsPage.tsx
│   │   │   ├── PrivacyPolicyPage.tsx
│   │   │   ├── TermsOfServicePage.tsx
│   │   │   └── NotFoundPage.tsx
│   │   ├── types/          # TypeScript type definitions (mirrors api/src/types/)
│   │   ├── App.tsx         # Root: QueryClientProvider + AuthProvider + RouterProvider
│   │   ├── router.tsx      # React Router v7 route definitions
│   │   ├── main.tsx        # Entry point (configureAmplify → render)
│   │   └── app.css         # Global styles (Tailwind CSS v4)
│   ├── public/             # Static assets (logo)
│   └── tests/              # Vitest unit + component tests
│
├── api/                    # Lambda handlers (Node.js 24.x + esbuild)
│   ├── src/
│   │   ├── handlers/       # One handler per API route group (12 total)
│   │   │   ├── userProfile.ts
│   │   │   ├── vehicleCrud.ts
│   │   │   ├── fillupCrud.ts
│   │   │   ├── maintenanceCrud.ts
│   │   │   ├── analytics.ts
│   │   │   ├── exportData.ts
│   │   │   ├── importData.ts
│   │   │   ├── presignUrl.ts
│   │   │   ├── sharingCrud.ts
│   │   │   ├── adminUsers.ts
│   │   │   ├── adminSchemas.ts
│   │   │   └── adminStats.ts
│   │   ├── lib/            # Shared utilities
│   │   │   ├── dynamo.ts   # Singleton DynamoDB Document Client + table name resolver
│   │   │   ├── auth.ts     # getUserId() from JWT claims (Cognito sub)
│   │   │   ├── authSharing.ts # Shared vehicle access authorization helpers
│   │   │   ├── response.ts # Typed success/error response builders
│   │   │   ├── validation.ts # Request body validation (required, types, ranges)
│   │   │   ├── logger.ts   # Structured JSON logger (INFO/WARN/ERROR to stdout)
│   │   │   ├── metrics.ts  # Fillup derived metric calculations + recalculation
│   │   │   ├── reminders.ts # Maintenance reminder calculation
│   │   │   ├── csv-parser.ts # Fuelly CSV import parser (fuelups + maintenance)
│   │   │   └── s3.ts       # S3 presigned URL generation + direct upload
│   │   └── types/          # Shared TypeScript types
│   │       ├── index.ts    # Re-exports all types
│   │       ├── api.ts      # ApiErrorCode, ApiSuccessResponse, ApiErrorResponse
│   │       ├── user.ts     # User interface
│   │       ├── vehicle.ts  # Vehicle + MaintenanceOverride interfaces
│   │       ├── fillup.ts   # Fillup, FillupInput, DerivedMetrics
│   │       ├── maintenance.ts # MaintenanceRecord, ReminderInput, Reminder
│   │       ├── sharing.ts  # ShareRecord, SharePermission, SharedVehicle
│   │       ├── schema.ts   # MaintenanceSchema interface
│   │       └── config.ts   # EnvironmentConfig interface
│   └── tests/unit/         # API unit + property-based tests (see Testing)
│
├── infra/                  # AWS CDK infrastructure-as-code
│   ├── test/               # Stack synthesis + GitHub access tests
│   ├── bin/app.ts          # CDK app entry point (stack wiring + dependency ordering)
│   ├── bin/github-access.ts # Separate CDK app: GitHub OIDC provider + deploy roles (deployed by hand)
│   └── lib/
│       ├── config.ts       # Environment configs (test, staging, production) with context overrides
│       ├── tags.ts         # Resource tagging utility (Environment, Project, ManagedBy)
│       ├── constructs/
│       │   └── lambda-function.ts  # AppFunction construct (NodejsFunction + LogGroup + X-Ray)
│       └── stacks/
│           ├── auth-stack.ts       # Cognito User Pool, Google IdP, App Client, Hosted UI
│           ├── database-stack.ts   # 6 DynamoDB tables with GSIs and PITR
│           ├── storage-stack.ts    # S3 buckets (Photos, Exports with 7-day lifecycle)
│           ├── api-stack.ts        # API Gateway v2, 12 Lambda functions, JWT authorizer, routes
│           ├── frontend-stack.ts   # S3 + CloudFront with OAC, SPA error handling
│           ├── monitoring-stack.ts # CloudWatch Dashboard (API, Lambda, DynamoDB widgets)
│           └── github-access-stack.ts # GitHub Actions OIDC provider + per-environment deploy roles
│
├── cli/                    # Admin CLI tools (run with npx tsx)
│   ├── src/
│   │   ├── migrate-account.ts   # Re-runnable account migration (users, tables, photos, verify, freeze, lock)
│   │   ├── parity-check.ts      # Post-migration parity + write smoke tests via direct Lambda invocation
│   │   ├── migrate/remap.ts     # User-ID remapping helpers (unit tested)
│   │   ├── release/version.ts   # Semantic version from conventional commits (used by GitHub Actions)
│   │   ├── backfill-gsi2.ts     # Backfill GSI2PK/GSI2SK on fillup items
│   │   └── backfill-is-business.ts # Backfill isBusiness=false on fillup items
│   └── tests/                   # Vitest unit tests
│
├── SampleData/
│   └── FuelEfficency.csv   # 19 real-world fillup records (Aug 2024 – Feb 2026)
│
├── docs/
│   ├── account-migration.md # Account migration, cutover, and legacy teardown runbook
│   ├── ci-cd.md            # GitHub Actions pipelines, OIDC deploy roles, setup
│   ├── code-review-2026-05.md # May 2026 code review findings
│   ├── cost.md             # Detailed AWS cost estimate breakdown
│   └── security.md         # Security assessment with remediation status
│
├── .github/workflows/      # CI (PRs) and Deploy (main → staging → production) — see docs/ci-cd.md
├── .claude/settings.json   # Shared Claude Code project settings
├── CLAUDE.md               # Project conventions for AI assistants (accounts, workflow, commands)
│
├── deploy.sh               # Full CI/CD pipeline script (run locally and by GitHub Actions)
├── setup-github.sh         # Copy .env config into the GitHub staging/production environments
├── unit-test.sh            # Run the API + frontend test suites
├── package.json            # npm workspaces root (build/test/lint/audit scripts)
├── .nvmrc                  # Node.js version (24), used by GitHub Actions
├── Project.md              # Complete project charter and specification
├── Roadmap.md              # Planned features
├── StartingPrompt          # Original project prompt
├── tsconfig.base.json      # Shared TypeScript config (ES2022, strict, bundler resolution)
├── .env.example            # Environment variable template
├── .gitignore              # Node, CDK, IDE, OS ignores
└── LICENSE                 # GNU AGPL v3
```

---

## Tech Stack

| Layer | Technology | Version | Notes |
|-------|-----------|---------|-------|
| Frontend | React | 19.3.x | With TypeScript |
| Build | Vite | 8.3.x | Fast HMR, Tailwind CSS plugin |
| Routing | React Router | v8.5.x | `createBrowserRouter` with element-based routes |
| Server State | TanStack Query | v5.104.x | 5-min stale time, single retry |
| UI Components | shadcn/ui + Radix | v4 | Mobile-first, Tailwind CSS v4 |
| Charts | Recharts | 3.10.x | MPG, spending, cost per mile, cost per gallon |
| Maps | Leaflet + react-leaflet | 1.9.x / 5.x | Fillup location picker and map view |
| Icons | Lucide React | 1.60.x | |
| Styling | Tailwind CSS | 4.3.x | With tailwind-merge + clsx via `cn()` |
| Auth (client) | AWS Amplify JS | v6.22.x | Cognito OAuth, token management |
| Backend Runtime | Node.js on Lambda | 24.x | Latest LTS |
| Bundler (Lambda) | esbuild (via CDK NodejsFunction) | 0.28.x | ESM output, tree-shaking, minified, source maps |
| Database | DynamoDB | On-demand | 6 tables, 6 GSIs, PITR enabled |
| Object Storage | S3 | — | 3 buckets (frontend, photos, exports) |
| CDN | CloudFront | — | OAC, TLS 1.2, SPA error handling |
| Auth | Cognito | — | Google OAuth 2.0, Hosted UI on custom domain (`auth.pawsitivemileage.app`) |
| API | API Gateway v2 | HTTP API | JWT authorizer, CORS, custom domain |
| Infrastructure | AWS CDK | 2.273.x (CLI 2.1146) | 5 stacks (+ optional monitoring), TypeScript |
| Language | TypeScript | 7.0.x | Strict mode, ES2022 target |
| Testing | Vitest | 5.x | Unit + property-based (fast-check 4.x) |
| IDs | ULID | 3.x | Sortable unique IDs for fillups, vehicles, etc. |
| DNS | CloudFlare | — | Proxied, Full Strict SSL |

---

## Prerequisites

- **Node.js** 24+ ([nodejs.org](https://nodejs.org/))
- **npm** (comes with Node.js)
- **AWS CLI** v2 ([install guide](https://docs.aws.amazon.com/cli/latest/userguide/install-cliv2.html))
- **AWS CDK CLI** (installed as a devDependency in `infra/`; no global install needed)
- **AWS credentials** for the app's dedicated account (an `AWS_PROFILE` set in `.env`, e.g. IAM Identity Center via `aws sso login`)
- **CDK bootstrap** in that account, once: `npx cdk bootstrap aws://<account-id>/us-east-1` (run outside `infra/`)
- **Google OAuth credentials** (Client ID + Secret for Cognito identity provider)
- **ACM certificate** in **us-east-1** covering the apex and wildcard (e.g. `pawsitivemileage.app` + `*.pawsitivemileage.app`) — used by CloudFront, API Gateway, and the Cognito custom domain

---

## Getting Started

### 1. Clone and install

```bash
git clone https://github.com/bourbonlab/pawsitivemileage.git
cd pawsitivemileage

# Install all workspaces (api, web, cli, infra) from the root lockfile
npm ci
```

### 2. Configure environment

```bash
cp .env.example .env
# Edit .env with your AWS profile/account IDs, Google OAuth Client ID, ACM certificate ARN, and domain names
```

See [Environment Variables](#environment-variables) for the full list of required values.

### 3. Store Google OAuth secret in Secrets Manager

The Google OAuth client secret must be stored in AWS Secrets Manager — it is never passed as plaintext through CDK context or CLI arguments. The CDK Auth stack reads it at deploy time via `cdk.SecretValue.secretsManager()`.

```bash
# Create the secret (use your actual Google client secret value)
aws secretsmanager create-secret \
  --name pawsitivemileage/google-oauth-client-secret \
  --description "Google OAuth client secret for PawsitiveMileage Cognito integration" \
  --secret-string "YOUR_GOOGLE_CLIENT_SECRET" \
  --region us-east-1 --profile pawsitivemileage
```

Copy the full ARN from the output (e.g. `arn:aws:secretsmanager:us-east-1:123456789:secret:pawsitivemileage/google-oauth-client-secret-AbCdEf`) and set it in `.env`:

```env
# Both can point to the same secret, or use separate secrets per environment
GOOGLE_CLIENT_SECRET_ARN_STAGING=arn:aws:secretsmanager:us-east-1:123456789:secret:pawsitivemileage/google-oauth-client-secret-AbCdEf
GOOGLE_CLIENT_SECRET_ARN_PRODUCTION=arn:aws:secretsmanager:us-east-1:123456789:secret:pawsitivemileage/google-oauth-client-secret-AbCdEf
```

To update the secret value later:

```bash
aws secretsmanager put-secret-value \
  --secret-id pawsitivemileage/google-oauth-client-secret \
  --secret-string "NEW_SECRET_VALUE" \
  --region us-east-1
```

### 4. Deploy infrastructure (first time)

```bash
./deploy.sh --stage   # Full pipeline: install → build → test → synth → deploy
```

The deploy script automatically fetches Cognito outputs after deployment and builds the frontend with the correct `VITE_*` environment variables baked in.

### 5. Local frontend development

After your first deployment, create `web/.env.local` with the Cognito values from CDK stack outputs:

```env
VITE_API_URL=https://api-staging.pawsitivemileage.app
VITE_COGNITO_USER_POOL_ID=us-east-1_XXXXXXXXX
VITE_COGNITO_APP_CLIENT_ID=xxxxxxxxxxxxxxxxxxxxxxxxxx
VITE_COGNITO_DOMAIN=auth-staging.pawsitivemileage.app
```

Then run the dev server:

```bash
cd web && npm run dev
# → http://localhost:5173
```

API calls go to the deployed staging environment. The Cognito app client includes `http://localhost:5173` in its callback URLs for non-production environments.

### 6. Build and test API locally

```bash
cd api && npm run build    # esbuild bundle → api/dist/
cd api && npm test         # vitest run
```

---

## Environment Variables

### Deployment (`.env` at project root)

All deployment configuration lives in a single `.env` file. The `deploy.sh` script validates that every required variable is present and not a placeholder before running.

| Variable | Description | Example |
|----------|-------------|---------|
| `GOOGLE_CLIENT_ID` | Google OAuth 2.0 Client ID | `123456789-abc.apps.googleusercontent.com` |
| `AWS_PROFILE` | AWS CLI profile used for every `aws`/`cdk` call | `pawsitivemileage` |
| `AWS_ACCOUNT_ID_STAGING` / `_PRODUCTION` | Account each environment is pinned to — deploy aborts if credentials don't match | `376784708284` |
| `GOOGLE_CLIENT_SECRET_ARN_STAGING` / `_PRODUCTION` | Secrets Manager ARN for the Google OAuth secret (in the target account) | `arn:aws:secretsmanager:us-east-1:123456789012:secret:my-secret-AbCdEf` |
| `ACM_CERTIFICATE_ARN` | ACM certificate ARN (**must be us-east-1**) | `arn:aws:acm:us-east-1:...` |
| `FRONTEND_DOMAIN_STAGING` / `_PRODUCTION` | Frontend domain | `staging.pawsitivemileage.app` / `pawsitivemileage.app` |
| `API_DOMAIN_STAGING` / `_PRODUCTION` | API domain | `api-staging.pawsitivemileage.app` / `api.pawsitivemileage.app` |
| `AUTH_DOMAIN_STAGING` / `_PRODUCTION` | Cognito Hosted UI custom domain | `auth-staging.pawsitivemileage.app` / `auth.pawsitivemileage.app` |
| `RESOURCE_PREFIX` | Prefix for AWS resource names (S3 bucket names are globally unique) | `pawsitivemileage-app` |
| `SOURCE_CODE_URL` | Source code repository URL (leave blank to hide the link) | `https://github.com/org/PawsitiveMileage` |
| `SUPPORT_EMAIL` | Support email shown on Privacy Policy and Terms of Service pages | `support@example.com` |

The `.env` file is in `.gitignore` and should never be committed. Only the target environment's `*_<ENV>` variables are required. A `--test` environment is still supported by the code; add `*_TEST` variables to use it.

### Frontend (`web/.env.local`)

| Variable | Description |
|----------|-------------|
| `VITE_API_URL` | API Gateway endpoint URL (e.g. `https://api-staging.pawsitivemileage.app`) |
| `VITE_COGNITO_USER_POOL_ID` | Cognito User Pool ID |
| `VITE_COGNITO_APP_CLIENT_ID` | Cognito App Client ID |
| `VITE_COGNITO_DOMAIN` | Cognito Hosted UI custom domain (e.g. `auth-staging.pawsitivemileage.app`) |
| `VITE_SOURCE_CODE_URL` | Source code repository URL (optional; hides link if blank) |
| `VITE_SUPPORT_EMAIL` | Support email shown on Privacy Policy and Terms of Service pages |
| `VITE_APP_VERSION` | Release version in the footer, linked to its GitHub release. Set by `deploy.sh`: the release tag in GitHub Actions (`APP_VERSION`), else `git describe` |

The Cognito values come from CDK stack outputs after deployment. The branding values (`VITE_SOURCE_CODE_URL`, `VITE_SUPPORT_EMAIL`) are passed through from the root `.env` file by `deploy.sh`. The deploy script automatically injects them during the frontend build step.

### Lambda (set automatically by CDK)

| Variable | Description |
|----------|-------------|
| `USERS_TABLE` | DynamoDB Users table name |
| `VEHICLES_TABLE` | DynamoDB Vehicles table name |
| `FILLUPS_TABLE` | DynamoDB Fillups table name |
| `MAINTENANCE_TABLE` | DynamoDB Maintenance table name |
| `SCHEMAS_TABLE` | DynamoDB Schemas table name |
| `SHARING_TABLE` | DynamoDB Sharing table name |
| `PHOTOS_BUCKET` | S3 photos bucket name |
| `EXPORTS_BUCKET` | S3 exports bucket name |
| `FRONTEND_DOMAIN` | Frontend domain (for CORS headers) |
| `ENVIRONMENT` | Current environment name (test/staging/production) |
| `NODE_OPTIONS` | `--enable-source-maps` (set by AppFunction construct) |

---

## Deployment

### GitHub Actions

Pull requests run lint, all tests, the build and a CDK synth ([`ci.yml`](.github/workflows/ci.yml)), plus a PR title check ([`pr-title.yml`](.github/workflows/pr-title.yml)). Every push to `main` deploys **staging**, then **production** once approved in the `production` GitHub environment ([`deploy.yml`](.github/workflows/deploy.yml)). Deploy jobs reach AWS through GitHub OIDC with a per-environment role; there are no AWS keys in GitHub. Setup, configuration and access details are in [docs/ci-cd.md](docs/ci-cd.md).

Every merge to `main` is a release: it is tagged `vX.Y.Z` with the next [semantic version](https://semver.org) from its conventional commits (`feat` → minor, `!`/`BREAKING CHANGE` → major, anything else → patch), gets a GitHub Release, and shows that version in the app footer. PR titles must be conventional commits; a check shows the version merging will release. See [Versioning](docs/ci-cd.md#versioning).

**Workflow:** branch from `main` (`feat/`, `fix/`, `refactor/`, `chore/`, `docs/`), open a PR, and merge it once CI is green. The merge deploys staging automatically; check the change there, and fix any issue in a follow-up PR. Production deploys only after a reviewer approves the run in the `production` environment.

```bash
git push -u origin fix/short-description
gh pr create --title "fix: short description" --base main
gh pr merge <number> --merge --delete-branch
```

### Deploy Script (`deploy.sh`)

The `deploy.sh` script handles the full CI/CD pipeline:

```bash
./deploy.sh              # Install, build, test, synth only (no deploy)
./deploy.sh --stage      # Deploy to staging environment
./deploy.sh --prod --yes # Deploy to production (--yes required as safety gate)

# Options
./deploy.sh --skip-tests # Skip running test suites
./deploy.sh --verbose    # Show detailed command output
```

**Pipeline steps:**

1. Prerequisite checks (Node.js 24+, npm, AWS CLI, CDK)
2. AWS credential verification (`sts get-caller-identity`) — aborts if the account doesn't match `AWS_ACCOUNT_ID_<ENV>`
3. Load and validate `.env` (all required variables present, no placeholders). In GitHub Actions (`CI=true`) there is no `.env`: the same variables come from the GitHub environment, unsuffixed
4. `npm ci` at the repo root (all workspaces), then `npm audit --audit-level=high`
5. API build (esbuild → `api/dist/`)
6. API tests (vitest, skippable with `--skip-tests`)
7. CDK synth with environment context variables (per-environment secret ARN, domains)
8. CDK deploy all stacks (if environment flag provided; `--require-approval never`, so IAM changes are reviewed in PRs)
9. Fetch Cognito outputs from CloudFormation stack
10. Build frontend with `VITE_*` env vars baked in
11. S3 sync of `web/dist/` to frontend bucket
12. CloudFront cache invalidation

### Environments

| Environment | Deploy Flag | CDK Context | Stack Prefix |
|-------------|-------------|-------------|--------------|
| staging | `--stage` | `-c environment=staging` | `PawsitiveMileage-staging-` |
| production | `--prod --yes` | `-c environment=production` | `PawsitiveMileage-production-` |

Both environments live in the dedicated PawsitiveMileage AWS account (`376784708284`, us-east-1); every stack is pinned to it via `-c account`. Each environment gets its own set of stacks, DynamoDB tables, S3 buckets, Cognito user pool, and API Gateway. Resource names are prefixed with `{RESOURCE_PREFIX}-{environment}`.

### CDK Context Variables

The deploy script passes all configuration to CDK via context flags:

```bash
npx cdk deploy --all \
  -c environment=staging \
  -c account=376784708284 \
  -c googleClientId="..." \
  -c googleClientSecretArn="arn:aws:secretsmanager:..." \
  -c apiCertificateArn="..." \
  -c frontendCertificateArn="..." \
  -c authCertificateArn="..." \
  -c frontendDomain="staging.pawsitivemileage.app" \
  -c apiDomain="api-staging.pawsitivemileage.app" \
  -c authDomain="auth-staging.pawsitivemileage.app" \
  -c resourcePrefix="pawsitivemileage-app-staging" \
  -c enableMonitoring=true
```

### Custom Domains

1. Provision an ACM certificate in **us-east-1** for the apex + wildcard (`pawsitivemileage.app`, `*.pawsitivemileage.app`)
2. Set `ACM_CERTIFICATE_ARN` in `.env`
3. Set the `FRONTEND_DOMAIN_*`, `API_DOMAIN_*`, and `AUTH_DOMAIN_*` variables
4. **Before the first deploy**, make sure the apex (`pawsitivemileage.app`) resolves to an A record — Cognito refuses to create an `auth.*` custom domain otherwise (a proxied placeholder works until production points the apex at CloudFront)
5. After deploying, create the CNAME records `deploy.sh` prints:
   - frontend → CloudFront distribution, **proxied**
   - API → API Gateway regional domain, **proxied**
   - auth → Cognito CloudFront target, **DNS-only** (grey cloud)
6. For CloudFlare: set SSL mode to Full (Strict)

> **CloudFlare note:** ACM certificate DNS validation requires either temporarily disabling the proxy or using CNAME validation records that work through the proxy.

> **CloudFlare caching note:** CloudFlare's proxy adds its own caching layer on top of CloudFront. After deploying changes that affect CloudFront behaviors or error responses, you may need to purge the CloudFlare cache as well (Caching → Configuration → Purge Cache in the CloudFlare dashboard). CloudFront cache invalidations alone won't clear stale responses cached by CloudFlare.

### Google OAuth Setup

1. Go to [Google Cloud Console → APIs & Services → Credentials](https://console.cloud.google.com/apis/credentials)
2. Create OAuth client ID → Web application
3. Add authorized JavaScript origins and redirect URIs for each environment:

| Environment | Authorized Origin | Redirect URI |
|-------------|-------------------|--------------|
| Staging | `https://auth-staging.pawsitivemileage.app` | `https://auth-staging.pawsitivemileage.app/oauth2/idpresponse` |
| Production | `https://auth.pawsitivemileage.app` | `https://auth.pawsitivemileage.app/oauth2/idpresponse` |

4. Save the Client ID to `.env` as `GOOGLE_CLIENT_ID`
5. Store the Client Secret in AWS Secrets Manager (see [step 3 in Getting Started](#3-store-google-oauth-secret-in-secrets-manager)) and set the ARN in `.env`

---

## API Reference

Base URL: `https://{apiDomain}/v1`

All endpoints require a valid Cognito JWT in the `Authorization: Bearer <token>` header. Admin endpoints additionally verify the `isAdmin` flag from the user's DynamoDB profile.

Responses follow a consistent envelope format:
- Success: `{ "data": <payload>, "requestId": "<id>" }`
- Error: `{ "error": "<message>", "code": "<ERROR_CODE>", "requestId": "<id>" }`

Error codes: `VALIDATION_ERROR` (400), `UNAUTHORIZED` (401), `FORBIDDEN` (403), `NOT_FOUND` (404), `CONFLICT` (409), `INTERNAL_ERROR` (500).

### User Profile

| Method | Path | Description |
|--------|------|-------------|
| GET | `/v1/user/profile` | Get current user profile (auto-creates on first call) |
| PUT | `/v1/user/profile` | Update display name and preferences |
| DELETE | `/v1/user/profile` | Delete account with cascading deletion of all vehicles, fillups, maintenance records, and S3 photos |

### Vehicles

| Method | Path | Description |
|--------|------|-------------|
| GET | `/v1/vehicles` | List all vehicles for the authenticated user |
| POST | `/v1/vehicles` | Create vehicle (nickname, make, model, year required) |
| GET | `/v1/vehicles/{vehicleId}` | Get vehicle details |
| PUT | `/v1/vehicles/{vehicleId}` | Update vehicle fields |
| PATCH | `/v1/vehicles/{vehicleId}/archive` | Toggle archive status |

### Fillups

| Method | Path | Description |
|--------|------|-------------|
| GET | `/v1/vehicles/{vehicleId}/fillups` | List fillups (sorted by date descending) |
| POST | `/v1/vehicles/{vehicleId}/fillups` | Create fillup (date, currencySpent, gallonsAdded, odometerReading required) |
| GET | `/v1/vehicles/{vehicleId}/fillups/{fillupId}` | Get single fillup with derived metrics |
| PUT | `/v1/vehicles/{vehicleId}/fillups/{fillupId}` | Update fillup (triggers metric recalculation) |
| DELETE | `/v1/vehicles/{vehicleId}/fillups/{fillupId}` | Delete fillup (triggers metric recalculation for subsequent fillups) |

### Maintenance

| Method | Path | Description |
|--------|------|-------------|
| GET | `/v1/vehicles/{vehicleId}/maintenance` | List maintenance records |
| POST | `/v1/vehicles/{vehicleId}/maintenance` | Create record (schemaId or customTypeName, datePerformed, odometerAtService, cost) |
| PUT | `/v1/vehicles/{vehicleId}/maintenance/{recordId}` | Update record |
| DELETE | `/v1/vehicles/{vehicleId}/maintenance/{recordId}` | Delete record |
| GET | `/v1/vehicles/{vehicleId}/maintenance/reminders` | Get upcoming maintenance reminders based on intervals and current odometer |
| GET | `/v1/vehicles/{vehicleId}/maintenance/schemas` | List active maintenance types (available to the owner and shared users) |

### Analytics

| Method | Path | Description |
|--------|------|-------------|
| GET | `/v1/vehicles/{vehicleId}/analytics` | Dashboard metrics (MPG trend, spending, cost per mile) |
| GET | `/v1/vehicles/{vehicleId}/analytics/yoy` | Year-over-year comparison |
| POST | `/v1/vehicles/{vehicleId}/summary-card` | Generate shareable summary card |

### Export

| Method | Path | Description |
|--------|------|-------------|
| GET | `/v1/vehicles/{vehicleId}/export/fillups` | Export fillups as CSV (optional date range query params) |
| GET | `/v1/vehicles/{vehicleId}/export/maintenance` | Export maintenance as CSV |
| POST | `/v1/vehicles/{vehicleId}/export/pdf` | Generate PDF report (uploaded to exports bucket, returns presigned download URL) |

### Upload

| Method | Path | Description |
|--------|------|-------------|
| POST | `/v1/upload/presign` | Get S3 presigned upload URL. Body: `{ uploadType, vehicleId, filename, contentType, fileSize? }`. Returns `{ url, key, expiresIn }` |

S3 keys follow the pattern: `{ownerUserId}/{vehicleId}/{uploadType}/{ulid}-{filename}`, where `uploadType` is `vehicle-photo`, `receipt-photo` or `csv-import`. Every file is stored under the **vehicle owner's** ID — including receipts uploaded by someone the vehicle is shared with — so a vehicle's files stay with the owner and are removed with the owner's account. Presign requires upload rights for the vehicle: receipts need record-write access (owner, or a `fuel`/`maintenance`/`full` share), vehicle photos are owner-only, and CSV imports need the owner or a `full` share. The ULID keeps same-named uploads from overwriting each other; keys written before it was added (`…/{uploadType}/{filename}`, including older receipts stored under a shared user's ID) still work, because records store the full key. When a fill-up, maintenance record or vehicle is created or updated with a *new* photo key, the key must sit under the vehicle owner's prefix for that vehicle and type, so a record can't point at — or later delete — another user's object. An unchanged key is always accepted. Presigned upload URLs enforce a 10 MB maximum file size via `Content-Length` header signing.

### Import & Recalculate

| Method | Path | Description |
|--------|------|-------------|
| POST | `/v1/vehicles/{vehicleId}/import/{type}` | Import Fuelly CSV (type: `fuelups` or `maintenance`). Body: `{ s3Key }` — must be the caller's own `csv-import` upload for this vehicle. Returns import result with counts |
| POST | `/v1/vehicles/{vehicleId}/recalculate` | Recalculate all derived metrics for a vehicle's fillups. Returns `{ recalculatedCount }` |

### Sharing

| Method | Path | Description |
|--------|------|-------------|
| GET | `/v1/vehicles/shared` | List vehicles shared with the current user (looks up by email) |
| GET | `/v1/vehicles/{vehicleId}/sharing` | List all shares for a vehicle (owner only) |
| POST | `/v1/vehicles/{vehicleId}/sharing` | Create or update a share. Body: `{ email, permission }`. Permission: `readonly`, `fuel` (fuel & maintenance), `full`. `maintenance` is accepted for backward compatibility and behaves like `fuel` |
| DELETE | `/v1/vehicles/{vehicleId}/sharing/{shareId}` | Revoke a share (owner only) |

### Admin (requires `isAdmin: true`)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/v1/admin/users` | List all users with vehicle/fillup counts |
| PATCH | `/v1/admin/users/{userId}/admin` | Toggle admin role on a user |
| GET | `/v1/admin/schemas` | List all maintenance schemas |
| POST | `/v1/admin/schemas` | Create schema (name, description, defaultMileageInterval, defaultTimeIntervalDays, category) |
| PUT | `/v1/admin/schemas/{schemaId}` | Update schema |
| PATCH | `/v1/admin/schemas/{schemaId}/active` | Toggle active status |
| GET | `/v1/admin/stats` | Platform statistics (total users, vehicles, fillups, maintenance records) |

---

## Data Model

### DynamoDB Tables

All tables use on-demand billing and have Point-in-Time Recovery (PITR) enabled. Production tables have `RETAIN` removal policy; non-production tables use `DESTROY`.

| Table | Partition Key | Sort Key | GSIs | Purpose |
|-------|--------------|----------|------|---------|
| `pawsitivemileage-users-{env}` | `userId` (S) | — | GSI1: `GSI1PK` / `GSI1SK` | User profiles |
| `pawsitivemileage-vehicles-{env}` | `userId` (S) | `vehicleId` (S) | GSI1: `GSI1PK` / `GSI1SK` | Vehicle records |
| `pawsitivemileage-fillups-{env}` | `vehicleId` (S) | `fillupDateId` (S) | GSI1: `GSI1PK` / `GSI1SK`, GSI2: `GSI2PK` / `GSI2SK` | Fillup records |
| `pawsitivemileage-maintenance-{env}` | `vehicleId` (S) | `serviceDateId` (S) | GSI1: `GSI1PK` / `GSI1SK` | Maintenance records |
| `pawsitivemileage-schemas-{env}` | `schemaId` (S) | — | — | Maintenance schemas (global) |
| `pawsitivemileage-sharing-{env}` | `ownerUserId` (S) | `vehicleId#sharedEmail` (S) | GSI1: `GSI1PK` / `GSI1SK` | Vehicle sharing records |

### GSI Access Patterns

- **GSI1 (Users):** `GSI1PK="USERS"`, `GSI1SK=createdAt` — Admin listing of all users
- **GSI1 (Vehicles):** `GSI1PK="VEHICLES"`, `GSI1SK=createdAt` — Admin listing of all vehicles
- **GSI1 (Fillups):** `GSI1PK=userId`, `GSI1SK=date` — All fillups for a user across vehicles
- **GSI2 (Fillups):** `GSI2PK="FILLUPS"`, `GSI2SK=date` — Global fillup listing by date (admin stats)
- **GSI1 (Maintenance):** `GSI1PK=userId`, `GSI1SK=datePerformed` — All maintenance for a user
- **GSI1 (Sharing):** `GSI1PK=sharedEmail`, `GSI1SK=vehicleId` — All vehicles shared with an email address

### Key Data Types

**Fillup derived metrics** (auto-calculated on create/update):
- `pricePerGallon`: `currencySpent / gallonsAdded`
- `milesSinceLastFillup`: `currentOdometer - previousOdometer`
- `mpg`: `totalMiles / totalGallons` (null for partial fills; accumulates across partial fills until next full fill)
- `costPerMile`: `currencySpent / milesSinceLastFillup`
- `daysSinceLastFillup`: calendar days between fillups

**Maintenance reminders** (calculated on-the-fly):
- Mileage-based: triggers when within 500 miles of next service
- Time-based: triggers when within 30 days of next service
- Overdue detection: negative remaining values

---

## Authentication

### Flow

1. User clicks "Sign in with Google" on the login page
2. `signInWithRedirect({ provider: 'Google' })` redirects to Cognito Hosted UI
3. Cognito redirects to Google OAuth consent screen
4. Google redirects back to Cognito with auth code
5. Cognito exchanges code for tokens, creates/updates user in the User Pool
6. Cognito redirects to `{frontendDomain}/callback` with tokens
7. Amplify JS stores tokens in browser storage
8. `AuthProvider` fetches user attributes and profile (including admin flag from DynamoDB)
9. `apiClient` automatically injects the ID token into all API requests

### Sign Out

The sign-out flow manually constructs the Cognito logout URL to work around an Amplify v6 issue where it sends `logout_uri` instead of `redirect_uri` (which Cognito rejects). Both parameters are included for compatibility.

### Route Protection

- `ProtectedRoute` — Redirects unauthenticated users to `/login`
- `AdminRoute` — Redirects non-admin users (checks `isAdmin` from AuthProvider context)
- Public routes: `/login`, `/callback`, `/privacy`, `/terms`

### Cognito Configuration

- User Pool with email sign-in, Google as sole identity provider
- OAuth scopes: `openid`, `email`, `profile`, `aws.cognito.signin.user.admin`
- Authorization code grant flow (PKCE)
- No client secret (SPA client)
- Non-production environments include `http://localhost:5173` in callback/logout URLs

---

## Frontend Architecture

### Stack

- **React 19** with TypeScript, rendered via `ReactDOM.createRoot`
- **Vite 8** for development (HMR) and production builds
- **React Router v8** with `createBrowserRouter` — element-based route definitions, no loader/action patterns currently used
- **TanStack Query v5** for server state (5-minute stale time, single retry, no refetch on window focus)
- **Tailwind CSS v4** with the Vite plugin (`@tailwindcss/vite`)
- **shadcn/ui** components built on Radix primitives (alert, badge, button, card, dialog, input, label, select, separator, switch, table, tabs, textarea)
- **Recharts 3.x** for analytics charts
- **Leaflet + react-leaflet** for fillup location maps and location picker

### App Structure

```
main.tsx → configureAmplify() → render App
App.tsx  → QueryClientProvider → AuthProvider → RouterProvider
```

The `AuthProvider` wraps the entire app and provides `useAuth()` hook with: `user`, `isAuthenticated`, `isAdmin`, `isLoading`, `signIn()`, `signOut()`.

### API Client

`web/src/api/client.ts` provides a typed `apiClient<T>(path, options)` function that:
1. Fetches the current auth token from Amplify
2. Injects `Authorization: Bearer <token>` and `Content-Type: application/json`
3. Unwraps the `{ data, requestId }` response envelope
4. Throws typed `ApiError` on non-2xx responses

### Pages

| Route | Page | Auth |
|-------|------|------|
| `/login` | LoginPage | Public |
| `/callback` | Redirect → `/garage` | Public |
| `/privacy` | PrivacyPolicyPage | Public |
| `/terms` | TermsOfServicePage | Public |
| `/garage` | GaragePage | Protected |
| `/vehicles/:vehicleId` | VehicleDetailPage | Protected |
| `/vehicles/:vehicleId/fillups/new` | AddFillupPage | Protected |
| `/vehicles/:vehicleId/maintenance/new` | AddMaintenancePage | Protected |
| `/vehicles/:vehicleId/analytics` | AnalyticsPage | Protected |
| `/vehicles/:vehicleId/export` | ExportPage | Protected |
| `/account` | AccountPage | Protected |
| `/admin/users` | AdminUsersPage | Admin |
| `/admin/schemas` | AdminSchemasPage | Admin |
| `/admin/stats` | AdminStatsPage | Admin |
| `*` | NotFoundPage | Public |

---

## Backend Architecture

### Lambda Functions

Each API route group maps to a dedicated Lambda function. All functions share the same configuration via the `AppFunction` CDK construct:

| Function | Handler File | Purpose | DynamoDB Access | S3 Access |
|----------|-------------|---------|----------------|-----------|
| userProfile | `userProfile.ts` | Profile CRUD, cascading account deletion | Users, Vehicles, Fillups, Maintenance (RW) | Photos (RW) |
| vehicleCrud | `vehicleCrud.ts` | Vehicle CRUD, archive/unarchive | Vehicles (RW), Users (R), Sharing (R) | Photos (RW) |
| fillupCrud | `fillupCrud.ts` | Fillup CRUD with derived metric calculation and recalculation | Fillups (RW), Vehicles (R), Users (R), Sharing (R) | Photos (RW) |
| maintenanceCrud | `maintenanceCrud.ts` | Maintenance CRUD, reminder calculation | Maintenance (RW), Vehicles (R), Schemas (R), Users (R), Sharing (R) | Photos (RW) |
| analytics | `analytics.ts` | Dashboard metrics, YoY comparison, summary cards | Fillups (R), Maintenance (R), Vehicles (R), Users (R), Sharing (R) | — |
| exportData | `exportData.ts` | CSV/PDF export generation | Fillups (R), Maintenance (R), Vehicles (R), Users (R), Sharing (R) | Exports (RW) |
| importData | `importData.ts` | Fuelly CSV import (fuelups + maintenance), metrics recalculation | Fillups (RW), Maintenance (RW), Vehicles (R), Users (R), Sharing (R) | Photos (R) |
| presignUrl | `presignUrl.ts` | S3 presigned URL generation for uploads | — | Photos (R/Put) |
| sharingCrud | `sharingCrud.ts` | Vehicle sharing CRUD, shared vehicle listing | Sharing (RW), Vehicles (R), Users (R) | — |
| adminUsers | `adminUsers.ts` | User listing, admin role toggle | Users (RW), Vehicles (R), Fillups (R) | — |
| adminSchemas | `adminSchemas.ts` | Maintenance schema CRUD | Schemas (RW) | — |
| adminStats | `adminStats.ts` | Platform-wide statistics | All tables (R) | — |

### Function Configuration

- **Runtime:** Node.js 24.x
- **Memory:** 256 MB
- **Timeout:** 30 seconds
- **Tracing:** AWS X-Ray active
- **Bundling:** CDK NodejsFunction with esbuild (ESM output, minified, tree-shaking, source maps)
- **Logging:** Structured JSON to stdout → CloudWatch Logs
  - Retention: 1 week (non-production), 3 months (production)
  - Removal: DESTROY (non-production), RETAIN (production)

### Shared Libraries (`api/src/lib/`)

- **`dynamo.ts`** — Singleton `DynamoDBDocumentClient` (reused across warm invocations), `getTableName()` helper
- **`auth.ts`** — `getUserId()` extracts Cognito `sub` claim from API Gateway JWT authorizer event
- **`authSharing.ts`** — `getUserEmail()`, `getSharedPermission()`, `isOperationAllowed()`, `verifyAccess()` — shared vehicle authorization helpers used by all data handlers
- **`response.ts`** — `success(data, requestId)` and `error(code, message, requestId)` response builders
- **`validation.ts`** — `validateRequired()`, `validateTypes()`, `validateRange()`, `validateStringLength()`, `validateCoordinates()`, `sanitizeFilename()`, `parseBody()` (with 64 KB size limit) for request validation
- **`logger.ts`** — `createLogger(handler)` returns structured JSON logger with `info()`, `warn()`, `error()` methods
- **`metrics.ts`** — `calculateDerivedMetrics()` for single fillup, `recalculateAllMetrics()` for full sequence recalculation with partial fill accumulation
- **`reminders.ts`** — `calculateReminder()` with 500-mile and 30-day thresholds
- **`csv-parser.ts`** — `parseFuelupsCsv()` and `parseMaintenanceCsv()` for Fuelly CSV import with field mapping, validation, and skip logic
- **`s3.ts`** — `getPresignedUploadUrl()`, `getPresignedDownloadUrl()`, `uploadObject()`, `buildS3Key()`

---

## Infrastructure

### CDK Stacks

5 core stacks deployed per environment with explicit dependency ordering, plus an optional Monitoring stack:

```
Auth ─────────┐
Database ─────┼──▶ API ──▶ Frontend
Storage ──────┘         ──▶ Monitoring (optional)
```

| Stack | ID Pattern | Resources |
|-------|-----------|-----------|
| Auth | `PawsitiveMileage-{env}-Auth` | Cognito User Pool, Google IdP, App Client, Hosted UI Domain |
| Database | `PawsitiveMileage-{env}-Database` | 6 DynamoDB TableV2 (on-demand, PITR), 7 GSIs. Production: termination protection + RETAIN |
| Storage | `PawsitiveMileage-{env}-Storage` | S3 Photos bucket (CORS, presigned uploads), S3 Exports bucket (7-day lifecycle). Production: termination protection + RETAIN |
| API | `PawsitiveMileage-{env}-Api` | API Gateway v2 HTTP API, 12 Lambda functions (AppFunction construct), JWT authorizer, custom domain, 30+ routes |
| Frontend | `PawsitiveMileage-{env}-Frontend` | S3 frontend bucket, CloudFront distribution (OAC, TLS 1.2, SPA 403/404 → index.html), custom domain |
| Monitoring | `PawsitiveMileage-{env}-Monitoring` | CloudWatch Dashboard with API latency (p50/p95/p99), request count, 4xx/5xx errors, Lambda duration/errors, DynamoDB read/write capacity. **Optional** — enable via CDK context: `-c enableMonitoring=true` |

### Resource Tagging

All resources are tagged with:
- `Environment`: test / staging / production
- `Project`: PawsitiveMileage
- `ManagedBy`: CDK

### Environment-Specific Behavior

| Aspect | Non-Production | Production |
|--------|---------------|------------|
| DynamoDB removal policy | DESTROY | RETAIN |
| S3 removal policy | DESTROY (auto-delete objects) | RETAIN |
| Log retention | 1 week | 3 months |
| Log removal policy | DESTROY | RETAIN |
| CORS origins | Frontend domain + `localhost:5173` | Frontend domain only |
| Cognito callback URLs | Frontend domain + `localhost:5173` | Frontend domain only |
| Termination protection | Off | On (Database, Storage stacks) |

---

## CLI Tools

| Script | Purpose | Docs |
|--------|---------|------|
| `cli/src/migrate-account.ts` (`npm run migrate -w cli -- …`) | Account migration, cutover and lock | [docs/account-migration.md](docs/account-migration.md) |
| `cli/src/parity-check.ts` | Post-migration parity and write smoke tests | [docs/account-migration.md](docs/account-migration.md) |
| `cli/src/release/version.ts` | Next semantic version from conventional commits (used by GitHub Actions) | [docs/ci-cd.md#versioning](docs/ci-cd.md#versioning) |
| `cli/src/backfill-gsi2.ts` | Backfill GSI2 attributes on fillups | below |
| `cli/src/backfill-is-business.ts` | Backfill `isBusiness=false` on fillups (same `FILLUPS_TABLE` / `DRY_RUN` usage as below) | — |

### GSI2 Backfill Script (`cli/src/backfill-gsi2.ts`)

Backfills `GSI2PK` and `GSI2SK` attributes on fillup items that were written before the GSI2 index was added. Required for admin stats queries that use GSI2.

```bash
cd cli

# Preview changes (dry run)
FILLUPS_TABLE=pawsitivemileage-fillups-test DRY_RUN=true npx tsx src/backfill-gsi2.ts

# Execute backfill
FILLUPS_TABLE=pawsitivemileage-fillups-test npx tsx src/backfill-gsi2.ts

# With custom region
AWS_REGION=us-west-2 FILLUPS_TABLE=pawsitivemileage-fillups-test npx tsx src/backfill-gsi2.ts
```

The script scans the entire Fillups table, identifies items missing GSI2 attributes, and adds `GSI2PK="FILLUPS"` and `GSI2SK={date}` to each.

---

## Testing

```bash
# Run all tests (api, web, cli, infra) — what CI runs
npm test

# One workspace
npm test -w api
npm test -w web

# API with coverage
cd api && npx vitest run --coverage

# Type checking (tsc --noEmit per workspace) — must be clean
npm run lint --workspaces --if-present
```

`./unit-test.sh` still runs the API and frontend suites only.

### Test Stack

- **Vitest 5.x** as the test runner across all packages
- **fast-check 4.x** for property-based testing (API metrics, reminders)
- **@testing-library/react** + **jsdom** for frontend component tests
- **v8** coverage provider

### Test Files

| File | Tests |
|------|-------|
| `api/tests/unit/metrics.test.ts` | Derived metric calculations, partial fill accumulation, edge cases |
| `api/tests/unit/reminders.test.ts` | Reminder threshold logic, overdue detection, mileage/time/both types |
| `api/tests/unit/userProfile.test.ts` | User profile handler tests |
| `api/tests/unit/validation.test.ts` | Input validation, range checks, coordinate validation, filename sanitization |
| `api/tests/unit/csv-parser.test.ts` | Fuelly CSV import parsing (fuelups + maintenance) |
| `api/tests/unit/s3.test.ts` | S3 key construction |
| `api/tests/unit/authSharing.test.ts` | Sharing authorization logic |
| `web/tests/unit/*.test.ts(x)` | API client, admin API paths, metric formatting, photo URLs, sharing permissions |
| `web/tests/components/*.test.tsx` | AppVersion, PaginationControls, ReminderBanner |
| `cli/tests/remap.test.ts` | Account-migration user-ID remapping |
| `cli/tests/version.test.ts` | Release version calculation from conventional commits |
| `infra/test/*.test.ts` | Stack synthesis, Cognito auth config, GitHub OIDC deploy roles |

### Coverage Configuration

API coverage includes `src/**/*.ts` but excludes `src/handlers/**/*.ts` (handlers are tested via integration/e2e, not unit tests).

---

## Monitoring

### CloudWatch Dashboard

The Monitoring stack is optional and must be explicitly enabled via CDK context (`-c enableMonitoring=true`). When enabled, each environment gets a CloudWatch dashboard (`{prefix}-dashboard`) with:

- **API Latency** — p50, p95, p99 latency from API Gateway (5-minute periods)
- **API Request Count & Errors** — Total requests, 4xx errors, 5xx errors
- **Lambda Duration p95** — Per-function duration at p95
- **Lambda Errors** — Per-function error count
- **DynamoDB Read Capacity** — Consumed read capacity units per table
- **DynamoDB Write Capacity** — Consumed write capacity units per table

### Logging

All Lambda functions use structured JSON logging via `createLogger()`:

```json
{
  "level": "INFO",
  "message": "Fillup created",
  "requestId": "abc-123",
  "userId": "user-456",
  "handler": "fillupCrud",
  "timestamp": "2026-02-15T12:00:00.000Z"
}
```

Error entries include `error.name`, `error.message`, and `error.stack`.

### X-Ray Tracing

All Lambda functions have active X-Ray tracing enabled for distributed request tracing across Lambda → DynamoDB → S3.

---

## Cost Estimate

At ~1,000 monthly active users in us-east-1:

| Scenario | Monthly | Annual |
|----------|---------|--------|
| With AWS free tier | ~$1.52 | ~$18 |
| Without free tier | ~$11.73 | ~$141 |

Top cost drivers without free tier: Cognito ($5.50, free under 10K MAU), CloudWatch Dashboard ($3), DynamoDB PITR ($1), CloudFront ($1.35).

See [docs/cost.md](docs/cost.md) for the full per-service breakdown with pricing sources and scaling projections.

---

## Sample Data

`SampleData/FuelEfficency.csv` contains 19 real-world fillup records (Aug 2024 – Feb 2026) with columns:

```
Date, Spend, Gallons, Odometer, Miles, MPG, Price Per Gallon
```

Useful for development seeding and testing metric calculations.

---

## Security

A full security assessment is documented in [docs/security.md](docs/security.md). 11 of 14 findings have been remediated, and one (F-12, no interactive IAM approval on deploy) is an accepted risk.

### Key security measures

- Google OAuth client secret stored in AWS Secrets Manager (never passed as plaintext via CDK context or CLI args). The CDK Auth stack reads it at deploy time via `cdk.SecretValue.secretsManager()`
- Per-environment Secrets Manager ARN variables (`GOOGLE_CLIENT_SECRET_ARN_STAGING`, `_PRODUCTION`) allow environment isolation
- API request body size limit (64 KB) enforced at the application level via `parseBody()`
- String length validation on all user-supplied text fields across all handlers
- Location coordinate range validation (lat: -90 to 90, lng: -180 to 180)
- CSV export formula injection protection (prefixes dangerous characters with single quote)
- Presigned URL filename sanitization and content type whitelist (JPEG, PNG, WebP, HEIC only)
- API Gateway throttling (100 burst / 50 requests per second)
- CloudFront security response headers (CSP, HSTS, X-Frame-Options, X-Content-Type-Options, Referrer-Policy)
- Production stack trace suppression in Lambda logs
- `npm audit --audit-level=high` runs on every PR (a separate CI job) and after `npm ci` in `deploy.sh`
- GitHub Actions reaches AWS through OIDC with per-environment deploy roles; there are no AWS keys in GitHub ([docs/ci-cd.md](docs/ci-cd.md))

### Remaining items (not yet addressed)

- F-08: Dedicated admin action audit trail (new feature, deferred)
- F-14: DynamoDB table name prefix uses hardcoded value instead of `config.resourcePrefix` (breaking change, requires data migration)

---

## License

This project is licensed under the [GNU Affero General Public License v3.0](LICENSE) (AGPL-3.0).
