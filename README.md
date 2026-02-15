# 🐾 PawsitiveMileage

A serverless vehicle fuel tracking and maintenance management application built on AWS. Users log fuel purchases with minimal input and the system auto-calculates MPG, cost per mile, price per gallon, and miles between fillups.

Built with React, AWS Lambda, DynamoDB, and CDK — designed to run for under $12/month at 1,000 users.

---

## Table of Contents

- [Features](#features)
- [Architecture](#architecture)
- [Project Structure](#project-structure)
- [Tech Stack](#tech-stack)
- [Prerequisites](#prerequisites)
- [Getting Started](#getting-started)
- [Environment Variables](#environment-variables)
- [Deployment](#deployment)
- [API Reference](#api-reference)
- [Testing](#testing)
- [Infrastructure](#infrastructure)
- [Cost Estimate](#cost-estimate)
- [Sample Data](#sample-data)
- [License](#license)

---

## Features

**Fuel Tracking**
- Log fillups with date, amount spent, gallons, and odometer reading
- Auto-calculated MPG, cost per mile, price per gallon, miles between fillups
- Partial fill support (defers MPG calculation until next full fill)
- Receipt photo uploads via S3 presigned URLs
- Optional location tagging (browser geolocation, map picker, or manual entry)

**Garage / Multi-Vehicle**
- Add unlimited vehicles with make, model, year, photo, and specs
- Archive/unarchive vehicles without losing historical data
- Per-vehicle fillup and maintenance history

**Maintenance Tracking**
- Admin-configurable maintenance schemas (Oil Change, Tire Rotation, etc.)
- Per-vehicle maintenance records with cost, odometer, and receipt photos
- Mileage-based and time-based reminder calculations
- Custom one-off maintenance entries

**Analytics & Reporting**
- MPG over time, monthly spending, cost per mile trend charts
- Year-over-year comparisons with percentage change indicators
- Shareable summary cards (annual vehicle stats)
- CSV and PDF data export with date range filtering

**Admin Panel**
- User management with admin role assignment
- Maintenance schema CRUD with activate/deactivate
- Platform-wide statistics (total users, vehicles, fillups)
- CloudWatch monitoring dashboard

**Auth**
- Google OAuth 2.0 via AWS Cognito Hosted UI
- JWT-based API authorization
- Role-based access control (user vs admin)

---

## Architecture

```
┌─────────────┐     ┌──────────────┐     ┌─────────────────┐
│  CloudFlare  │────▶│  CloudFront  │────▶│   S3 (Frontend)  │
│  (DNS/Proxy) │     │  (CDN/TLS)   │     │   React SPA      │
└─────────────┘     └──────────────┘     └─────────────────┘
       │
       │            ┌──────────────┐     ┌─────────────────┐
       └───────────▶│ API Gateway  │────▶│  Lambda (×10)    │
                    │ HTTP API v2  │     │  Node.js 22.x    │
                    │ JWT Auth     │     └────────┬────────┘
                    └──────────────┘              │
                                                  ▼
                    ┌──────────────┐     ┌─────────────────┐
                    │   Cognito    │     │   DynamoDB (×5)  │
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

All infrastructure is serverless — zero cost when idle, scales automatically.

---

## Project Structure

```
pawsitive-mileage/
├── web/                    # React frontend (Vite + TypeScript)
│   ├── src/
│   │   ├── api/            # API client functions (vehicles, fillups, etc.)
│   │   ├── auth/           # Amplify config, AuthProvider, route guards
│   │   ├── components/     # UI components, charts, shadcn/ui primitives
│   │   ├── lib/            # Utilities (metrics calculations, helpers)
│   │   ├── pages/          # Route pages (Garage, Analytics, Admin, etc.)
│   │   ├── types/          # TypeScript type definitions
│   │   ├── App.tsx         # Root component (QueryClient + Auth + Router)
│   │   ├── router.tsx      # React Router v7 route definitions
│   │   └── main.tsx        # Entry point
│   └── tests/              # Frontend tests
│
├── api/                    # Lambda handlers (Node.js + esbuild)
│   ├── src/
│   │   ├── handlers/       # One handler per API route group
│   │   ├── lib/            # Shared utilities (DynamoDB, auth, S3, validation)
│   │   └── types/          # Shared type definitions
│   └── tests/              # API unit + property-based tests
│
├── infra/                  # AWS CDK infrastructure-as-code
│   ├── bin/app.ts          # CDK app entry point
│   └── lib/
│       ├── config.ts       # Environment configs (test, staging, production)
│       ├── tags.ts         # Resource tagging utility
│       ├── constructs/     # Reusable constructs (AppFunction)
│       └── stacks/         # CDK stacks (Auth, Database, API, Frontend, etc.)
│
├── cli/                    # Admin CLI tools and scripts
├── SampleData/             # Sample fuel efficiency CSV data
├── docs/                   # Documentation
│   └── cost.md             # AWS cost estimate breakdown
├── deploy.sh               # CI/CD deploy script
├── Project.md              # Full project charter and specification
└── tsconfig.base.json      # Shared TypeScript config
```

---

## Tech Stack

| Layer | Technology | Version |
|-------|-----------|---------|
| Frontend | React | 19.x |
| Build | Vite | 7.x |
| Routing | React Router | v7 |
| Server State | TanStack Query | v5 |
| UI Components | shadcn/ui + Radix | v4 |
| Charts | Recharts | 2.x |
| Styling | Tailwind CSS | 4.x |
| Auth (client) | AWS Amplify JS | v6 |
| Backend Runtime | Node.js on Lambda | 24.x |
| Bundler | esbuild | 0.27.x |
| Database | DynamoDB | On-demand |
| Infrastructure | AWS CDK | 2.x |
| Language | TypeScript | 5.9.x |
| Testing | Vitest + fast-check | 4.x / 4.x |

---

## Prerequisites

- **Node.js** 24+ ([nodejs.org](https://nodejs.org/))
- **npm** (comes with Node.js)
- **AWS CLI** v2 ([install guide](https://docs.aws.amazon.com/cli/latest/userguide/install-cliv2.html))
- **AWS CDK CLI** (`npm install -g aws-cdk` or use via `npx`)
- **AWS credentials** configured (`aws configure` or environment variables)
- **Google OAuth credentials** (Client ID + Secret for Cognito identity provider)

---

## Getting Started

### 1. Clone and install

```bash
git clone <repository-url>
cd pawsitive-mileage

# Install all workspaces
cd api && npm install --yes && cd ..
cd web && npm install --yes && cd ..
cd infra && npm install --yes && cd ..
```

### 2. Configure environment variables

Create `web/.env.local` for local frontend development:

```env
VITE_API_URL=https://pawsitivemileageapitest.bourbonlab.net
VITE_COGNITO_USER_POOL_ID=us-east-1_XXXXXXXXX
VITE_COGNITO_APP_CLIENT_ID=xxxxxxxxxxxxxxxxxxxxxxxxxx
VITE_COGNITO_DOMAIN=pawsitivemileage-test.auth.us-east-1.amazoncognito.com
```

These values come from CDK stack outputs after your first deployment.

### 3. Run locally

```bash
# Frontend dev server (hot reload)
cd web && npm run dev

# API build (esbuild bundle)
cd api && npm run build

# Run API tests
cd api && npm test
```

The frontend dev server runs at `http://localhost:5173`. API calls proxy to the deployed test environment.

### 4. Deploy infrastructure

```bash
# Synthesize CloudFormation templates (no deploy)
cd infra && npx cdk synth -c environment=test

# Deploy all stacks to test
cd infra && npx cdk deploy --all -c environment=test
```

Or use the deploy script:

```bash
./deploy.sh --test    # Full pipeline: install → build → test → synth → deploy
```

---

## Environment Variables

### Frontend (`web/.env.local`)

| Variable | Description |
|----------|-------------|
| `VITE_API_URL` | API Gateway endpoint URL |
| `VITE_COGNITO_USER_POOL_ID` | Cognito User Pool ID |
| `VITE_COGNITO_APP_CLIENT_ID` | Cognito App Client ID |
| `VITE_COGNITO_DOMAIN` | Cognito Hosted UI domain |

### Lambda (set automatically by CDK)

| Variable | Description |
|----------|-------------|
| `USERS_TABLE` | DynamoDB Users table name |
| `VEHICLES_TABLE` | DynamoDB Vehicles table name |
| `FILLUPS_TABLE` | DynamoDB Fillups table name |
| `MAINTENANCE_TABLE` | DynamoDB Maintenance table name |
| `SCHEMAS_TABLE` | DynamoDB Schemas table name |
| `PHOTOS_BUCKET` | S3 photos bucket name |
| `EXPORTS_BUCKET` | S3 exports bucket name |
| `FRONTEND_DOMAIN` | Frontend domain (for CORS) |
| `ENVIRONMENT` | Current environment name |

---

## Deployment

### Deploy Script

The `deploy.sh` script handles the full CI/CD pipeline:

```bash
./deploy.sh              # Install, build, test, synth only (no deploy)
./deploy.sh --test       # Deploy to test environment
./deploy.sh --stage      # Deploy to staging environment
./deploy.sh --prod --yes # Deploy to production

# Options
./deploy.sh --skip-tests # Skip test suite
./deploy.sh --verbose    # Show detailed output
```

The script performs:
1. Prerequisite checks (Node.js 22+, npm, AWS CLI, CDK)
2. AWS credential verification
3. `npm install` in api/, web/, infra/
4. API build (esbuild) and tests (vitest)
5. Frontend build (Vite)
6. CDK synth with environment context
7. CDK deploy (if environment flag provided)

Production deploys require the `--yes` flag as a safety gate.

### Environments

| Environment | Frontend Domain | API Domain | CDK Context |
|-------------|----------------|------------|-------------|
| test | `pawsitivemileagetest.bourbonlab.net` | `pawsitivemileageapitest.bourbonlab.net` | `-c environment=test` |
| staging | `pawsitivemileagestaging.bourbonlab.net` | `pawsitivemileageapistaging.bourbonlab.net` | `-c environment=staging` |
| production | `pawsitivemileage.bourbonlab.net` | `pawsitivemileageapi.bourbonlab.net` | `-c environment=production` |

### Custom Domains

Custom domains require pre-provisioned ACM certificates. Pass the ARNs via CDK context:

```bash
npx cdk deploy --all \
  -c environment=production \
  -c googleClientId=YOUR_GOOGLE_CLIENT_ID \
  -c googleClientSecret=YOUR_GOOGLE_CLIENT_SECRET
```

The wildcard ACM certificate (`arn:aws:acm:us-east-1:817281265012:certificate/71b9761c-8a43-4303-8d0b-77d6e4231864`) is configured in `infra/cdk.json` and passed automatically by `deploy.sh` — no need to specify it manually.

DNS is managed in CloudFlare with proxy enabled (Full Strict SSL).

---

## API Reference

Base URL: `https://{apiDomain}/v1`

All endpoints require a valid JWT in the `Authorization: Bearer <token>` header.

### User Profile

| Method | Path | Description |
|--------|------|-------------|
| GET | `/v1/user/profile` | Get current user profile |
| PUT | `/v1/user/profile` | Update profile |
| DELETE | `/v1/user/profile` | Delete account (cascading) |

### Vehicles

| Method | Path | Description |
|--------|------|-------------|
| GET | `/v1/vehicles` | List all vehicles |
| POST | `/v1/vehicles` | Create vehicle |
| GET | `/v1/vehicles/{vehicleId}` | Get vehicle details |
| PUT | `/v1/vehicles/{vehicleId}` | Update vehicle |
| PATCH | `/v1/vehicles/{vehicleId}/archive` | Archive/unarchive |

### Fillups

| Method | Path | Description |
|--------|------|-------------|
| GET | `/v1/vehicles/{vehicleId}/fillups` | List fillups |
| POST | `/v1/vehicles/{vehicleId}/fillups` | Create fillup |
| GET | `/v1/vehicles/{vehicleId}/fillups/{fillupId}` | Get fillup |
| PUT | `/v1/vehicles/{vehicleId}/fillups/{fillupId}` | Update fillup |
| DELETE | `/v1/vehicles/{vehicleId}/fillups/{fillupId}` | Delete fillup |

### Maintenance

| Method | Path | Description |
|--------|------|-------------|
| GET | `/v1/vehicles/{vehicleId}/maintenance` | List records |
| POST | `/v1/vehicles/{vehicleId}/maintenance` | Create record |
| PUT | `/v1/vehicles/{vehicleId}/maintenance/{recordId}` | Update record |
| DELETE | `/v1/vehicles/{vehicleId}/maintenance/{recordId}` | Delete record |
| GET | `/v1/vehicles/{vehicleId}/reminders` | Get upcoming reminders |

### Analytics

| Method | Path | Description |
|--------|------|-------------|
| GET | `/v1/vehicles/{vehicleId}/analytics` | Dashboard metrics |
| GET | `/v1/vehicles/{vehicleId}/analytics/yoy` | Year-over-year comparison |
| POST | `/v1/vehicles/{vehicleId}/summary-card` | Generate summary card |

### Export

| Method | Path | Description |
|--------|------|-------------|
| GET | `/v1/vehicles/{vehicleId}/export/fillups` | Export fillups CSV |
| GET | `/v1/vehicles/{vehicleId}/export/maintenance` | Export maintenance CSV |
| POST | `/v1/vehicles/{vehicleId}/export/pdf` | Generate PDF report |

### Upload

| Method | Path | Description |
|--------|------|-------------|
| POST | `/v1/upload/presign` | Get S3 presigned upload URL |

### Admin

| Method | Path | Description |
|--------|------|-------------|
| GET | `/v1/admin/users` | List all users |
| PATCH | `/v1/admin/users/{userId}/admin` | Toggle admin role |
| GET | `/v1/admin/schemas` | List maintenance schemas |
| POST | `/v1/admin/schemas` | Create schema |
| PUT | `/v1/admin/schemas/{schemaId}` | Update schema |
| PATCH | `/v1/admin/schemas/{schemaId}/active` | Activate/deactivate |
| GET | `/v1/admin/stats` | Platform statistics |

---

## Testing

```bash
# API tests (unit + property-based)
cd api && npm test

# Frontend tests
cd web && npm test

# With coverage
cd api && npx vitest run --coverage
cd web && npx vitest run --coverage
```

The project uses [Vitest](https://vitest.dev/) as the test runner and [fast-check](https://fast-check.dev/) for property-based testing.

Test files:
- `api/tests/unit/` — API unit tests (metrics, reminders, user profile)
- `web/tests/` — Frontend component tests

---

## Infrastructure

### CDK Stacks

| Stack | Resources |
|-------|-----------|
| Auth | Cognito User Pool, Google IdP, App Client, Hosted UI Domain |
| Database | 5 DynamoDB tables (Users, Vehicles, Fillups, Maintenance, Schemas) with GSIs and PITR |
| Storage | 3 S3 buckets (Photos, Exports with 7-day lifecycle, Frontend) |
| API | API Gateway v2 HTTP API, 10 Lambda functions, JWT authorizer, IAM permissions |
| Frontend | S3 bucket + CloudFront distribution with OAC, SPA error handling |
| Monitoring | CloudWatch Dashboard (API latency, Lambda errors/duration, DynamoDB capacity) |

### DynamoDB Tables

| Table | Partition Key | Sort Key | GSIs |
|-------|--------------|----------|------|
| Users | `userId` | — | GSI1 (admin listing) |
| Vehicles | `userId` | `vehicleId` | GSI1 (admin listing) |
| Fillups | `vehicleId` | `fillupDateId` | GSI1 (by user), GSI2 (global by date) |
| Maintenance | `vehicleId` | `serviceDateId` | GSI1 (by user) |
| Schemas | `schemaId` | — | — |

### Lambda Functions

| Function | Purpose | DynamoDB Access | S3 Access |
|----------|---------|----------------|-----------|
| userProfile | Profile CRUD, account deletion | Users, Vehicles, Fillups, Maintenance (RW) | Photos (RW) |
| vehicleCrud | Vehicle CRUD, archive | Vehicles (RW) | Photos (RW) |
| fillupCrud | Fillup CRUD with metrics | Fillups (RW), Vehicles (R) | Photos (RW) |
| maintenanceCrud | Maintenance CRUD, reminders | Maintenance (RW), Vehicles (R), Schemas (R) | Photos (RW) |
| analytics | Dashboard, YoY, summary cards | Fillups (R), Maintenance (R), Vehicles (R) | — |
| exportData | CSV/PDF export | Fillups (R), Maintenance (R), Vehicles (R) | Exports (RW) |
| presignUrl | S3 presigned URLs | — | Photos (R/Put) |
| adminUsers | User management | Users (RW), Vehicles (R), Fillups (R) | — |
| adminSchemas | Schema CRUD | Schemas (RW) | — |
| adminStats | Platform statistics | All tables (R) | — |

All functions: 256 MB memory, 30s timeout, Node.js 24.x, X-Ray tracing, structured JSON logging.

---

## Cost Estimate

At ~1,000 monthly active users in us-east-1:

| Scenario | Monthly | Annual |
|----------|---------|--------|
| With AWS free tier | ~$1.52 | ~$18 |
| Without free tier | ~$11.73 | ~$141 |

Top cost drivers: Cognito ($5.50, free under 10K MAU), CloudWatch Dashboard ($3), DynamoDB PITR ($1).

See [docs/cost.md](docs/cost.md) for the full per-service breakdown with pricing sources.

---

## Sample Data

`SampleData/FuelEfficency.csv` contains 19 real-world fillup records (Aug 2024 – Feb 2026) with columns:

```
Date, Spend, Gallons, Odometer, Miles, MPG, Price Per Gallon
```

Useful for development seeding and testing metric calculations.

---

## License

See [LICENSE](LICENSE) for details.
