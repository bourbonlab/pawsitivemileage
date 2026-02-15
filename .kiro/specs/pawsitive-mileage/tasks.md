# Implementation Plan: PawsitiveMileage

## Overview

This plan implements PawsitiveMileage incrementally, starting with shared infrastructure and core data models, then building the core fillup tracking feature, followed by vehicle management, maintenance tracking, analytics, admin panel, and frontend. Each task builds on previous work, with property tests and unit tests wired in close to implementation.

## Tasks

- [x] 1. Initialize project structure and shared foundations
  - [x] 1.1 Scaffold project directories and install dependencies
    - Create `web/`, `api/`, `infra/`, `cli/` directories with package.json files
    - Install core dependencies: React 19, Vite 7, TypeScript, shadcn/ui v4, TanStack Query v5, React Router v7, Recharts, AWS Amplify v6 (web); esbuild, aws-sdk v3, ulid (api); aws-cdk-lib (infra)
    - Install test dependencies: vitest, fast-check, @testing-library/react
    - Configure tsconfig.json for each package with shared base config
    - Configure vitest.config.ts for api and web packages
    - _Requirements: 10.1_

  - [x] 1.2 Create shared TypeScript type definitions
    - Create `api/src/types/user.ts`, `vehicle.ts`, `fillup.ts`, `maintenance.ts`, `schema.ts` with all interfaces from the design document
    - Create a shared types package or copy types to `web/src/types/` for frontend use
    - _Requirements: 9.1_

  - [x] 1.3 Implement API shared utilities
    - Create `api/src/lib/response.ts` — standardized API response formatting (success and error responses with requestId)
    - Create `api/src/lib/logger.ts` — structured JSON logger with level, message, requestId, userId, handler, timestamp
    - Create `api/src/lib/auth.ts` — extract userId from API Gateway JWT authorizer claims
    - Create `api/src/lib/validation.ts` — request body validation helpers (required fields, type checks, numeric ranges)
    - Create `api/src/lib/dynamo.ts` — DynamoDB document client factory with table name resolution from environment variables
    - Create `api/src/lib/s3.ts` — S3 client and presigned URL generation with user-scoped key prefixes
    - _Requirements: 8.4, 8.5, 2.7, 3.7_

  - [ ]* 1.4 Write unit tests for shared utilities
    - Test response formatting produces correct status codes and body structure
    - Test logger outputs valid structured JSON
    - Test auth helper extracts userId from mock JWT claims
    - Test validation helpers for required fields, type checks, and range validation
    - Test S3 key generation includes user-scoped prefix
    - _Requirements: 8.4, 8.5_

- [x] 2. Implement CDK infrastructure stacks
  - [x] 2.1 Create CDK app entry point and environment configuration
    - Create `infra/bin/app.ts` reading environment parameter from context
    - Create `infra/lib/config.ts` with EnvironmentConfig for test, staging, production (domains, resource prefixes, tags)
    - Create `infra/lib/tags.ts` helper to apply Environment, Project, ManagedBy tags to all resources
    - _Requirements: 10.1, 10.3, 10.4, 10.9_

  - [x] 2.2 Create Auth stack
    - Create `infra/lib/stacks/auth-stack.ts` with Cognito User Pool, Google identity provider, app client, hosted UI domain
    - Configure JWT issuer and audience for API Gateway authorizer
    - Apply environment-specific naming and tags
    - _Requirements: 1.1, 1.2, 10.3, 10.4_

  - [x] 2.3 Create Database stack
    - Create `infra/lib/stacks/database-stack.ts` with five DynamoDB tables: Users, Vehicles, Fillups, Maintenance, Schemas
    - Configure partition keys, sort keys, and GSIs as defined in the design data models
    - Apply environment-specific table naming (e.g., `pawsitivemileage-fillups-{env}`) and tags
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 9.6, 10.3, 10.4_

  - [x] 2.4 Create Storage stack
    - Create `infra/lib/stacks/storage-stack.ts` with three S3 buckets: photos, frontend static hosting, exports
    - Configure CORS for presigned URL uploads on the photos bucket
    - Apply environment-specific naming and tags
    - _Requirements: 2.7, 3.7, 10.3, 10.4_

  - [x] 2.5 Create API stack with Lambda functions and API Gateway
    - Create `infra/lib/stacks/api-stack.ts` with API Gateway v2 HTTP API
    - Create `infra/lib/constructs/lambda-function.ts` reusable construct with Node.js 24.x runtime, esbuild bundling, environment variables, and default settings
    - Define all Lambda functions (vehicleCrud, fillupCrud, maintenanceCrud, analytics, exportData, presignUrl, userProfile, adminUsers, adminSchemas, adminStats)
    - Configure JWT authorizer on API Gateway using Cognito issuer/audience
    - Map all routes from the design endpoint table to Lambda functions
    - Configure custom domain (environment-specific) on API Gateway
    - Apply tags
    - _Requirements: 8.1, 8.2, 8.3, 10.4, 10.5, 10.6, 10.7_

  - [x] 2.6 Create Frontend stack
    - Create `infra/lib/stacks/frontend-stack.ts` with S3 bucket deployment and CloudFront distribution
    - Configure custom domain (environment-specific) on CloudFront
    - Apply tags
    - _Requirements: 10.3, 10.4, 10.5, 10.6, 10.7_

  - [x] 2.7 Create Monitoring stack
    - Create `infra/lib/stacks/monitoring-stack.ts` with CloudWatch dashboard for API latency, error rates, Lambda cold starts, DynamoDB capacity
    - Apply tags
    - _Requirements: 7.5, 10.3_

  - [ ]* 2.8 Write CDK assertion tests
    - Test that all stacks create expected resources with correct properties
    - Test that resource names include environment suffix
    - Test that all resources have required tags (Environment, Project, ManagedBy)
    - Test that API Gateway has JWT authorizer configured
    - _Requirements: 10.1, 10.3, 10.4_

- [x] 3. Checkpoint — Verify infrastructure
  - Ensure all CDK tests pass, synthesize all stacks for each environment, ask the user if questions arise.

- [x] 4. Implement core fillup tracking (backend)
  - [x] 4.1 Implement derived metrics calculation engine
    - Create `api/src/lib/metrics.ts` with `calculateDerivedMetrics` function
    - Handle: standard two-fillup calculation, first fillup (price per gallon only), partial fill accumulation, full fill after partials
    - Create `recalculateAllMetrics(fillups: Fillup[]): Fillup[]` that processes an ordered sequence and recalculates all derived metrics
    - _Requirements: 3.2, 3.3, 3.4, 3.5, 3.6_

  - [ ]* 4.2 Write property tests for derived metrics calculation
    - **Property 1: Derived metrics formula correctness**
    - **Validates: Requirements 3.2**
    - **Property 2: First fillup produces only price per gallon**
    - **Validates: Requirements 3.3**
    - **Property 3: Partial fill accumulation**
    - **Validates: Requirements 3.4, 3.5**
    - **Property 5: Fillup edit/delete triggers recalculation consistency**
    - **Validates: Requirements 3.6**

  - [ ]* 4.3 Write unit tests for derived metrics with sample data
    - Use values from SampleData/FuelEfficency.csv as concrete test cases
    - Test first fillup (8/8/2024 record — no previous, only price per gallon)
    - Test standard calculation (8/29/2024 record — 145 miles, 10.7 MPG, $4.06/gal)
    - Test edge cases: very small gallons, very large odometer gaps
    - _Requirements: 3.2, 3.3_

  - [x] 4.4 Implement fillup CRUD Lambda handler
    - Create `api/src/handlers/fillupCrud.ts` handling GET (list), GET (detail), POST (create), PUT (update), DELETE
    - On POST: validate input (date, currencySpent, gallonsAdded, odometerReading), enforce odometer monotonicity, calculate derived metrics, store in Fillups table
    - On PUT/DELETE: recalculate derived metrics for all subsequent fillups using `recalculateAllMetrics`
    - Scope all queries to authenticated userId via vehicleId ownership check
    - _Requirements: 3.1, 3.2, 3.6, 3.9, 8.4_

  - [ ]* 4.5 Write property tests for fillup validation
    - **Property 4: Odometer monotonicity validation**
    - **Validates: Requirements 3.9**
    - **Property 16: Fillup input validation**
    - **Validates: Requirements 3.1**

- [x] 5. Implement vehicle management (backend)
  - [x] 5.1 Implement vehicle CRUD Lambda handler
    - Create `api/src/handlers/vehicleCrud.ts` handling GET (list with active/archived filter), POST (create), GET (detail), PUT (update), PATCH (archive/unarchive)
    - On POST: validate required fields (nickname, make, model, year), generate vehicleId (ULID), store in Vehicles table
    - On PATCH archive: set isArchived flag without deleting associated data
    - Scope all queries to authenticated userId
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 8.4_

  - [ ]* 5.2 Write property tests for vehicle management
    - **Property 6: Vehicle validation requires all mandatory fields**
    - **Validates: Requirements 2.1**
    - **Property 7: Archive/unarchive round-trip**
    - **Validates: Requirements 2.3, 2.6**
    - **Property 8: Active/archived vehicle filtering**
    - **Validates: Requirements 2.4, 2.5**
    - **Property 9: Vehicle edit round-trip**
    - **Validates: Requirements 2.2**

  - [x] 5.3 Implement presigned URL Lambda handler
    - Create `api/src/handlers/presignUrl.ts` handling POST to generate presigned S3 upload URLs
    - Accept upload type (vehicle-photo, receipt-photo), vehicleId, and optional fillupId
    - Generate user-scoped S3 key: `{userId}/{vehicleId}/{type}/{filename}`
    - Return presigned PUT URL with expiration
    - _Requirements: 2.7, 3.7_

  - [ ]* 5.4 Write property test for S3 key user-scoping
    - **Property 10: S3 key user-scoping**
    - **Validates: Requirements 2.7, 3.7**

- [x] 6. Implement user profile and authentication (backend)
  - [x] 6.1 Implement user profile Lambda handler
    - Create `api/src/handlers/userProfile.ts` handling GET (profile), PUT (update), DELETE (account deletion)
    - On first GET (profile not found): create profile from JWT claims (userId, email, displayName)
    - On DELETE: cascade delete all user's vehicles, fillups, maintenance records, and S3 objects
    - _Requirements: 1.3, 11.1, 11.3_

  - [ ]* 6.2 Write property tests for user profile and deletion
    - **Property 25: Cascading account deletion**
    - **Validates: Requirements 11.1, 11.3**
    - **Property 26: User profile creation completeness**
    - **Validates: Requirements 1.3**

- [x] 7. Checkpoint — Verify core backend
  - Ensure all tests pass, ask the user if questions arise.

- [x] 8. Implement maintenance tracking (backend)
  - [x] 8.1 Implement admin schemas Lambda handler
    - Create `api/src/handlers/adminSchemas.ts` handling GET (list), POST (create), PUT (update), PATCH (activate/deactivate)
    - Verify admin flag on all requests
    - Store schemas in Schemas table with ULID schemaId
    - _Requirements: 4.1, 4.2, 4.3, 7.1_

  - [ ]* 8.2 Write property tests for maintenance schemas
    - **Property 11: Maintenance schema CRUD round-trip**
    - **Validates: Requirements 4.1, 4.2**
    - **Property 12: Deactivated schema exclusion**
    - **Validates: Requirements 4.3**

  - [x] 8.3 Implement maintenance CRUD Lambda handler
    - Create `api/src/handlers/maintenanceCrud.ts` handling GET (list), POST (create), PUT (update), DELETE, GET reminders
    - On POST: validate input, allow schema-based or custom maintenance records
    - Implement reminder calculation using `calculateReminder` from design
    - Support custom interval overrides from vehicle's maintenanceOverrides
    - _Requirements: 4.4, 4.5, 4.6, 4.7, 4.8, 4.9_

  - [ ]* 8.4 Write property tests for maintenance and reminders
    - **Property 13: Maintenance record creation with schema reference**
    - **Validates: Requirements 4.4**
    - **Property 14: Reminder calculation correctness**
    - **Validates: Requirements 4.6, 4.7, 4.8**
    - **Property 15: Maintenance and fillup records sorted by date**
    - **Validates: Requirements 4.9, 9.3, 9.4**

- [x] 9. Implement admin panel and analytics (backend)
  - [x] 9.1 Implement admin users Lambda handler
    - Create `api/src/handlers/adminUsers.ts` handling GET (list users with stats), PATCH (set/remove admin flag)
    - Verify admin flag on all requests
    - Query Users table GSI1 for listing, aggregate vehicle/fillup counts per user
    - _Requirements: 7.1, 7.2, 7.3_

  - [x] 9.2 Implement admin stats Lambda handler
    - Create `api/src/handlers/adminStats.ts` handling GET (platform statistics)
    - Aggregate total users, active users, total fillups, total vehicles from GSIs
    - _Requirements: 7.4_

  - [ ]* 9.3 Write property tests for admin authorization and stats
    - **Property 21: Admin authorization enforcement**
    - **Validates: Requirements 7.1**
    - **Property 22: Admin flag toggle round-trip**
    - **Validates: Requirements 7.3**

  - [x] 9.4 Implement analytics Lambda handler
    - Create `api/src/handlers/analytics.ts` handling GET (dashboard data), GET (year-over-year), POST (summary card)
    - Compute MPG over time, monthly spending, cost per mile trends, miles per month from Fillups table
    - Compute year-over-year summaries with trend indicators
    - Generate summary card data (image generation can use canvas or server-side rendering)
    - _Requirements: 6.1, 6.2, 6.3_

  - [ ]* 9.5 Write property tests for analytics
    - **Property 17: Analytics aggregation correctness**
    - **Validates: Requirements 6.1**
    - **Property 18: Year-over-year comparison correctness**
    - **Validates: Requirements 6.2**
    - **Property 19: Summary card data completeness**
    - **Validates: Requirements 6.3**

  - [x] 9.6 Implement export Lambda handler
    - Create `api/src/handlers/exportData.ts` handling GET (fillup CSV), GET (maintenance CSV), POST (PDF report)
    - Generate CSV with all fields and derived metrics, scoped by vehicle and date range
    - Generate PDF with charts and summary statistics
    - Store exports in S3 exports bucket and return presigned download URL
    - _Requirements: 6.5, 6.6, 6.7_

  - [ ]* 9.7 Write property tests for CSV export
    - **Property 20: CSV export data completeness**
    - **Validates: Requirements 6.5, 6.6**

- [x] 10. Checkpoint — Verify full backend
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 11. Implement tenant isolation and error handling tests
  - [ ]* 11.1 Write property tests for tenant isolation and error handling
    - **Property 23: Tenant isolation**
    - **Validates: Requirements 8.4, 9.2, 11.2**
    - **Property 24: Error handler returns generic 500**
    - **Validates: Requirements 8.5**

- [x] 12. Implement frontend — Auth and routing
  - [x] 12.1 Set up Vite project with React 19 and configure routing
    - Initialize Vite 7 project in `web/` with React 19 and TypeScript
    - Install and configure shadcn/ui v4
    - Set up React Router v7 with route definitions for all pages
    - Configure TanStack Query v5 provider
    - _Requirements: 12.1, 12.4, 12.5_

  - [x] 12.2 Implement authentication flow
    - Create `web/src/auth/AuthProvider.tsx` using AWS Amplify v6 for Cognito integration
    - Create `web/src/auth/ProtectedRoute.tsx` — redirects to Cognito hosted UI if not authenticated
    - Create `web/src/auth/AdminRoute.tsx` — checks admin flag, shows 403 if not admin
    - Configure Amplify with Cognito User Pool ID, App Client ID, and hosted UI domain
    - Handle token storage, transparent refresh, and logout
    - _Requirements: 1.1, 1.2, 1.4, 1.5, 1.6_

  - [x] 12.3 Create API client layer
    - Create `web/src/api/client.ts` — fetch wrapper that injects JWT from Amplify auth session
    - Create TanStack Query hooks for each API resource: `web/src/api/vehicles.ts`, `fillups.ts`, `maintenance.ts`, `analytics.ts`, `admin.ts`, `upload.ts`
    - Configure query invalidation patterns for mutations
    - _Requirements: 12.4_

- [x] 13. Implement frontend — Garage and Vehicle pages
  - [x] 13.1 Build Garage page
    - Create `web/src/pages/GaragePage.tsx` with active/archived vehicle tabs
    - Create `web/src/components/VehicleCard.tsx` showing photo thumbnail, nickname, make/model/year
    - Add "Add Vehicle" button opening a form dialog
    - _Requirements: 2.1, 2.4, 2.5_

  - [x] 13.2 Build Vehicle detail page
    - Create `web/src/pages/VehicleDetailPage.tsx` with vehicle info, fillup list, maintenance list, and reminder banner
    - Create `web/src/components/FillupList.tsx` — sortable table of fillups with derived metrics
    - Create `web/src/components/MaintenanceList.tsx` — sortable table of maintenance records
    - Create `web/src/components/ReminderBanner.tsx` — displays upcoming maintenance reminders
    - Wire edit, archive/unarchive, and delete actions
    - _Requirements: 2.2, 2.3, 2.6, 3.8, 4.9_

  - [x] 13.3 Build photo upload component
    - Create `web/src/components/PhotoUpload.tsx` — requests presigned URL, uploads file directly to S3, returns S3 key
    - Support camera capture and file picker on mobile
    - Use for both vehicle photos and receipt photos
    - _Requirements: 2.7, 3.7_

- [x] 14. Implement frontend — Fillup and Maintenance forms
  - [x] 14.1 Build Add Fillup page
    - Create `web/src/pages/AddFillupPage.tsx` with four required fields: date (default today), currency spent, gallons, odometer
    - Add optional fields: partial fill toggle, location, receipt photo, notes
    - Create `web/src/lib/metrics.ts` — client-side derived metrics preview (mirrors API calculation)
    - Show calculated metrics preview before submission
    - _Requirements: 3.1, 3.2, 3.4, 12.3_

  - [x] 14.2 Build location picker component
    - Create `web/src/components/LocationPicker.tsx` with three input methods: browser geolocation auto-detect, map picker, manual address entry
    - Request geolocation permission, fall back to alternatives if denied
    - _Requirements: 5.1, 5.2, 5.3_

  - [x] 14.3 Build Add Maintenance page
    - Create `web/src/pages/AddMaintenancePage.tsx` with schema selector dropdown, custom type option, date, odometer, cost, optional location/notes/receipt
    - Support custom interval overrides per vehicle
    - _Requirements: 4.4, 4.5, 4.6_

- [x] 15. Implement frontend — Analytics and Export
  - [x] 15.1 Build Analytics page
    - Create `web/src/pages/AnalyticsPage.tsx` with vehicle selector
    - Create `web/src/components/charts/MpgChart.tsx` — MPG over time line chart (Recharts)
    - Create `web/src/components/charts/SpendingChart.tsx` — monthly fuel spending bar chart
    - Create `web/src/components/charts/CostPerMileChart.tsx` — cost per mile trend line
    - Add year-over-year comparison view with trend indicators
    - _Requirements: 6.1, 6.2_

  - [x] 15.2 Build Summary Card and sharing
    - Create `web/src/components/SummaryCard.tsx` — renders annual summary as a shareable card
    - Implement image generation (canvas-based or html2canvas)
    - Add share button (direct link) and download button (PNG image)
    - _Requirements: 6.3, 6.4_

  - [x] 15.3 Build Export page
    - Create `web/src/pages/ExportPage.tsx` with vehicle selector, date range picker, and format options (CSV fillups, CSV maintenance, PDF report)
    - Trigger export API calls and download resulting files
    - _Requirements: 6.5, 6.6, 6.7_

- [x] 16. Implement frontend — Admin Panel
  - [x] 16.1 Build Admin Users page
    - Create `web/src/pages/AdminUsersPage.tsx` — list all users with vehicle count, fillup count, last active
    - Add admin flag toggle per user
    - _Requirements: 7.2, 7.3_

  - [x] 16.2 Build Admin Schemas page
    - Create `web/src/pages/AdminSchemasPage.tsx` — CRUD interface for maintenance schemas
    - Add activate/deactivate toggle
    - Preview how schemas appear to end users
    - _Requirements: 4.1, 4.2, 4.3_

  - [x] 16.3 Build Admin Stats page
    - Create `web/src/pages/AdminStatsPage.tsx` — display platform statistics and monitoring metrics
    - Show total users, active users, total fillups, total vehicles, usage trends
    - Link to or embed CloudWatch dashboard widgets
    - _Requirements: 7.4, 7.5_

- [x] 17. Implement frontend — Map view and fillup history
  - [x] 17.1 Build fillup map view
    - Add map view to fillup history showing fillup locations with markers
    - Display station name and price per gallon on marker click
    - _Requirements: 5.4_

- [x] 18. Implement account management
  - [x] 18.1 Build account settings and deletion
    - Add account settings section with profile display and logout button
    - Add "Delete Account" with confirmation dialog that triggers cascading deletion
    - _Requirements: 1.6, 11.1_

- [x] 19. Final checkpoint — Full integration
  - Ensure all tests pass, verify frontend connects to backend correctly, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties from the design document
- Unit tests validate specific examples (including sample data from FuelEfficency.csv) and edge cases
- The backend is implemented before the frontend to ensure APIs are stable before building UI
- CDK infrastructure is deployed first to establish the AWS environment
