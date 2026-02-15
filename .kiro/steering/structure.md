# Project Structure

```
pawsitive-mileage/
├── web/              # React frontend (Vite + TypeScript)
├── api/              # Lambda function handlers (Node.js 24.x, esbuild)
├── infra/            # AWS CDK infrastructure-as-code (TypeScript)
├── cli/              # Admin CLI tools and scripts
├── SampleData/       # Sample datasets (CSV) for dev and testing
├── Project.md        # Full project charter and specification
├── StartingPrompt    # Original project prompt
└── .kiro/
    ├── specs/        # Feature specifications (requirements, design, tasks)
    └── steering/     # Steering rules for AI assistant context
```

## Component Boundaries
- `web/` — UI only. No direct AWS SDK calls except Amplify for auth. Communicates with backend via REST API.
- `api/` — Business logic lives here. Each Lambda is single-purpose, one per API route. Shared utilities for DynamoDB client, auth helpers, response formatting.
- `infra/` — All AWS resources defined in CDK. No manual console configuration. Stacks are separated by concern (Auth, Database, API, Frontend, Storage, Monitoring).
- `cli/` — Standalone scripts for admin tasks, data migration, seeding, and maintenance schema management.
- `SampleData/` — Reference data files. `FuelEfficency.csv` contains real-world fillup data with columns: Date, Spend, Gallons, Odometer, Miles, MPG, Price Per Gallon.

## API Route Layout
All routes under `/v1/`:
- `/v1/vehicles` — vehicle CRUD
- `/v1/vehicles/{vehicleId}/fillups` — fillup CRUD
- `/v1/vehicles/{vehicleId}/maintenance` — maintenance CRUD
- `/v1/vehicles/{vehicleId}/analytics` — per-vehicle analytics
- `/v1/vehicles/{vehicleId}/export` — data export
- `/v1/user/profile` — user profile
- `/v1/admin/*` — admin endpoints (users, schemas, stats)
- `/v1/upload/presign` — S3 presigned URL generation
