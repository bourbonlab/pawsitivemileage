# Tech Stack & Build

## Frontend (`web/`)
- React 19.x with TypeScript
- Vite 7.x (build tool)
- React Router v7 (loader/action patterns)
- TanStack Query v5 (server state)
- shadcn/ui v4 (component library, mobile-first)
- Recharts v2.x (charts)
- AWS Amplify JS v6.x (Cognito auth integration)

## Backend (`api/`)
- AWS Lambda, Node.js 24.x runtime
- esbuild for bundling (minimal cold starts)
- API Gateway v2 (HTTP API), JWT authorizer
- All routes prefixed `/v1/`
- Single-purpose Lambda per route

## Infrastructure (`infra/`)
- AWS CDK in TypeScript
- Separate stacks: Auth, Database, API, Frontend, Storage, Monitoring
- Environment-aware: dev, staging, prod

## Data
- DynamoDB single-table design (PK/SK composite keys, GSIs)
- S3 for photos, receipts, static hosting, exports
- CloudFront CDN for frontend

## Auth
- AWS Cognito with Google OAuth 2.0
- Cognito Hosted UI, JWT tokens

## DNS
- CloudFlare (proxied, Full Strict SSL)

## Common Commands
```bash
# Frontend
cd web && npm install && npm run dev      # local dev server
cd web && npm run build                   # production build

# CDK
cd infra && npm install
cd infra && npx cdk synth                 # synthesize stacks
cd infra && npx cdk deploy --all          # deploy all stacks

# API (Lambda)
cd api && npm install
cd api && npm run build                   # esbuild bundle
cd api && npm test                        # run tests
```

## Conventions
- TypeScript everywhere (frontend, backend, infra)
- Structured JSON logging in Lambda functions
- Environment variables for config (table names, bucket names)
- Use latest stable runtimes and libraries to minimize future refactoring
