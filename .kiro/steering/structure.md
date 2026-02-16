# Project Structure

```
pawsitive-mileage/
├── web/                    # React frontend (Vite + TypeScript)
│   ├── src/
│   │   ├── api/            # Typed fetch wrappers (client.ts, vehicles.ts, fillups.ts, maintenance.ts, analytics.ts, upload.ts, import.ts, admin.ts)
│   │   ├── auth/           # Amplify config, AuthProvider, ProtectedRoute, AdminRoute
│   │   ├── components/     # UI components (Layout, VehicleCard, FillupList, FillupMap, MaintenanceList, ReminderBanner, SummaryCard, PhotoUpload, ImportDialog, LocationPicker, DetailPeekDialog)
│   │   │   ├── charts/     # Recharts: MpgChart, SpendingChart, CostPerMileChart, CostPerGallonChart
│   │   │   └── ui/         # shadcn/ui primitives (alert, badge, button, card, dialog, input, label, select, separator, switch, table, tabs, textarea)
│   │   ├── lib/            # utils.ts (cn() helper), metrics.ts (client-side formatting)
│   │   ├── pages/          # 14 route pages (Login, Garage, VehicleDetail, AddFillup, AddMaintenance, Analytics, Export, Account, AdminUsers, AdminSchemas, AdminStats, Privacy, Terms, NotFound)
│   │   ├── types/          # TypeScript types (mirrors api/src/types/)
│   │   ├── App.tsx         # Root: QueryClientProvider → AuthProvider → RouterProvider
│   │   ├── router.tsx      # React Router v7 route definitions
│   │   ├── main.tsx        # Entry: configureAmplify() → render
│   │   └── app.css         # Global styles (Tailwind CSS v4)
│   └── public/             # Static assets (WebLogo.png)
│
├── api/                    # Lambda handlers (Node.js 24.x + esbuild)
│   ├── src/
│   │   ├── handlers/       # 11 handlers: userProfile, vehicleCrud, fillupCrud, maintenanceCrud, analytics, exportData, importData, presignUrl, adminUsers, adminSchemas, adminStats
│   │   ├── lib/            # Shared: dynamo.ts, auth.ts, response.ts, validation.ts, logger.ts, metrics.ts, reminders.ts, csv-parser.ts, s3.ts
│   │   └── types/          # Shared types: api.ts, user.ts, vehicle.ts, fillup.ts, maintenance.ts, schema.ts, config.ts, index.ts
│   └── tests/unit/         # metrics.test.ts, reminders.test.ts, userProfile.test.ts
│
├── infra/                  # AWS CDK infrastructure-as-code
│   ├── bin/app.ts          # CDK app entry: stack wiring + dependency ordering
│   └── lib/
│       ├── config.ts       # Environment configs (test, staging, production) with CDK context overrides
│       ├── tags.ts         # Resource tagging (Environment, Project, ManagedBy)
│       ├── constructs/
│       │   └── lambda-function.ts  # AppFunction construct (NodejsFunction + LogGroup + X-Ray)
│       └── stacks/         # auth-stack, database-stack, storage-stack, api-stack, frontend-stack, monitoring-stack
│
├── cli/                    # Admin CLI tools
│   └── src/
│       ├── index.ts        # Entry point placeholder
│       └── backfill-gsi2.ts # Backfill GSI2PK/GSI2SK on fillup items
│
├── SampleData/FuelEfficency.csv  # 19 real-world fillup records (Aug 2024 – Feb 2026)
├── docs/cost.md                  # Detailed AWS cost estimate breakdown
├── deploy.sh                     # Full CI/CD pipeline script
├── Project.md                    # Complete project charter and specification
├── tsconfig.base.json            # Shared TS config (ES2022, strict, bundler resolution)
├── .env.example                  # Environment variable template
└── LICENSE                       # GNU AGPL v3
```

## Component Boundaries

- `web/` — UI only. No direct AWS SDK calls except Amplify for auth. Communicates with backend via REST API through `apiClient`.
- `api/` — Business logic. Each Lambda is single-purpose, one per API route group. Shared utilities in `lib/` for DynamoDB client, auth helpers, response formatting, validation, logging, metric calculations, reminders, S3 operations.
- `infra/` — All AWS resources defined in CDK. No manual console configuration. 6 stacks separated by concern with explicit dependency ordering.
- `cli/` — Standalone scripts for admin tasks, data migration, and backfills. Run via `npx tsx`.
- `SampleData/` — Reference data. `FuelEfficency.csv` columns: Date, Spend, Gallons, Odometer, Miles, MPG, Price Per Gallon.

## API Route → Handler Mapping

All routes under `/v1/`, JWT-authorized via API Gateway v2.

| Route Pattern | Handler | Methods |
|---------------|---------|---------|
| `/v1/user/profile` | `userProfile.ts` | GET, PUT, DELETE |
| `/v1/vehicles`, `/v1/vehicles/{vehicleId}`, `/v1/vehicles/{vehicleId}/archive` | `vehicleCrud.ts` | GET, POST, PUT, PATCH |
| `/v1/vehicles/{vehicleId}/fillups`, `/v1/vehicles/{vehicleId}/fillups/{fillupId}` | `fillupCrud.ts` | GET, POST, PUT, DELETE |
| `/v1/vehicles/{vehicleId}/maintenance`, `/v1/vehicles/{vehicleId}/maintenance/{recordId}`, `/v1/vehicles/{vehicleId}/maintenance/reminders` | `maintenanceCrud.ts` | GET, POST, PUT, DELETE |
| `/v1/vehicles/{vehicleId}/analytics`, `/v1/vehicles/{vehicleId}/analytics/yoy`, `/v1/vehicles/{vehicleId}/summary-card` | `analytics.ts` | GET, POST |
| `/v1/vehicles/{vehicleId}/export/fillups`, `/v1/vehicles/{vehicleId}/export/maintenance`, `/v1/vehicles/{vehicleId}/export/pdf` | `exportData.ts` | GET, POST |
| `/v1/upload/presign` | `presignUrl.ts` | POST |
| `/v1/vehicles/{vehicleId}/import/{type}` | `importData.ts` | POST |
| `/v1/vehicles/{vehicleId}/recalculate` | `importData.ts` | POST |
| `/v1/admin/users`, `/v1/admin/users/{userId}/admin` | `adminUsers.ts` | GET, PATCH |
| `/v1/admin/schemas`, `/v1/admin/schemas/{schemaId}`, `/v1/admin/schemas/{schemaId}/active` | `adminSchemas.ts` | GET, POST, PUT, PATCH |
| `/v1/admin/stats` | `adminStats.ts` | GET |

## Data Model (DynamoDB)

5 tables, all on-demand billing with PITR enabled. Production tables use RETAIN removal policy.

| Table | PK | SK | GSIs |
|-------|----|----|------|
| `{prefix}-users-{env}` | `userId` | — | GSI1: `GSI1PK`/`GSI1SK` (admin user listing) |
| `{prefix}-vehicles-{env}` | `userId` | `vehicleId` | GSI1: `GSI1PK`/`GSI1SK` (admin vehicle listing) |
| `{prefix}-fillups-{env}` | `vehicleId` | `fillupDateId` | GSI1: `GSI1PK`/`GSI1SK` (user's fillups across vehicles), GSI2: `GSI2PK`/`GSI2SK` (global fillup listing) |
| `{prefix}-maintenance-{env}` | `vehicleId` | `serviceDateId` | GSI1: `GSI1PK`/`GSI1SK` (user's maintenance across vehicles) |
| `{prefix}-schemas-{env}` | `schemaId` | — | — |

### Fillup Derived Metrics (auto-calculated)
- `pricePerGallon`: currencySpent / gallonsAdded
- `milesSinceLastFillup`: currentOdometer - previousOdometer
- `mpg`: totalMiles / totalGallons (null for partial fills; accumulates until next full fill)
- `costPerMile`: currencySpent / milesSinceLastFillup
- `daysSinceLastFillup`: calendar days between fillups

### Maintenance Reminders (calculated on-the-fly)
- Mileage-based: triggers within 500 miles of next service
- Time-based: triggers within 30 days of next service
- Overdue detection: negative remaining values
