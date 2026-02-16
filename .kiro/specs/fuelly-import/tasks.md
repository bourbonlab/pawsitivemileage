# Implementation Plan: Fuelly CSV Import & Metrics Recalculation

## Overview

Implement CSV import from Fuelly (fuelups and maintenance) and a metrics recalculation endpoint. The work builds incrementally: CSV parser → import handler → presign changes → infrastructure → frontend UI.

## Tasks

- [x] 1. Implement CSV parser module
  - [x] 1.1 Create `api/src/lib/csv-parser.ts` with `parseFuelupsCsv()` function
    - Parse CSV content string into rows, handling quoted fields and commas within quotes
    - Map Fuelly fuelup columns to `ParsedFuelup` interface: `fuelup_date` → `date`, `gallons` → `gallonsAdded`, `odometer` → `odometerReading`, `partial_fuelup` → `isPartialFill`, `latitude`/`longitude` → `locationLat`/`locationLng`, `notes` → `notes`
    - Calculate `currencySpent` as `gallons * price`
    - Skip rows with empty/zero gallons, empty/invalid date, or empty/zero odometer — add to `skipped` array with reason
    - Return `ParseResult<ParsedFuelup>` with `records`, `skipped`, and `totalRows`
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8_

  - [x] 1.2 Add `parseMaintenanceCsv()` function to `api/src/lib/csv-parser.ts`
    - Map Fuelly maintenance columns to `ParsedMaintenance` interface: `service_date` → `datePerformed`, `odometer` → `odometerAtService` (default 0), `price` → `cost` (default 0), `notes` → `notes`
    - Derive `customTypeName` from `sub_service_types` (humanize: replace underscores with spaces, title-case each word) or set to "Other" if empty
    - Skip rows with empty/invalid `service_date`
    - Handle multi-line notes within quoted CSV fields
    - Return `ParseResult<ParsedMaintenance>`
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5_

  - [ ]* 1.3 Write property tests for CSV parser (fuelups)
    - **Property 1: Fuelup CSV round-trip field mapping**
    - **Property 2: Currency spent calculation**
    - **Property 3: Invalid fuelup rows are skipped**
    - **Validates: Requirements 2.1, 2.2, 2.3, 2.4, 2.6, 2.7, 2.8**

  - [ ]* 1.4 Write property tests for CSV parser (maintenance)
    - **Property 4: Maintenance CSV field mapping with defaults**
    - **Validates: Requirements 3.1, 3.2, 3.3, 3.4**

  - [ ]* 1.5 Write unit tests for CSV parser
    - Test parsing actual `SampleData/fuelly-fuelups.csv` — verify 107 total rows, baseline entry (mpg=0, miles=0) is valid
    - Test parsing actual `SampleData/fuelly-maint.csv` — verify 26 total rows, multi-line notes preserved
    - Test empty CSV and headers-only CSV return zero records
    - _Requirements: 2.1, 2.5, 3.1_

- [x] 2. Checkpoint - Ensure CSV parser tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 3. Implement import data handler
  - [x] 3.1 Create `api/src/handlers/importData.ts` with route handler structure
    - Handle `POST /v1/vehicles/{vehicleId}/import/{type}` where type is `fuelups` or `maintenance`
    - Handle `POST /v1/vehicles/{vehicleId}/recalculate`
    - Extract `vehicleId` and `type` from path parameters
    - Verify vehicle ownership using existing pattern (query Vehicles table for userId + vehicleId)
    - Parse JSON body to extract `s3Key`
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5_

  - [x] 3.2 Implement fuelup import logic in `importData.ts`
    - Download CSV from S3 using `GetObjectCommand` on Photos bucket
    - Call `parseFuelupsCsv()` to get parsed records
    - Sort parsed records by date ascending
    - Fetch existing fillups for the vehicle to check for duplicates (same date + odometerReading)
    - Generate ULID for each new fillup, build DynamoDB items with GSI keys (GSI1PK=userId, GSI1SK=date, GSI2PK="FILLUPS", GSI2SK=date)
    - Set all derived metrics to `null` (user should run recalculate after import)
    - Batch write in chunks of 25 using `BatchWriteCommand` with unprocessed item retry
    - Return `ImportResult` with counts
    - _Requirements: 4.1, 4.2, 4.3, 4.5, 4.6, 4.8, 5.1, 5.3_

  - [x] 3.3 Implement maintenance import logic in `importData.ts`
    - Download CSV from S3, call `parseMaintenanceCsv()`
    - Fetch existing maintenance records for duplicate check (same datePerformed + odometerAtService)
    - Generate ULID for each new record, build DynamoDB items with GSI keys (GSI1PK=userId, GSI1SK=datePerformed)
    - Batch write in chunks of 25
    - Return `ImportResult` with counts
    - _Requirements: 4.1, 4.4, 4.5, 4.7, 4.8, 5.2, 5.3_

  - [x] 3.4 Implement recalculate endpoint in `importData.ts`
    - Fetch all fillups for the vehicle sorted by date ascending
    - Call `recalculateAllMetrics()` from `api/src/lib/metrics.ts`
    - Write all updated fillups back to DynamoDB using batch writes
    - Return `{ recalculatedCount }` in response
    - _Requirements: 6.1, 6.2, 6.3, 6.4_

  - [ ]* 3.5 Write property tests for import logic
    - **Property 5: Parsed fillups are sorted chronologically**
    - **Property 6: Import result count invariant**
    - **Property 7: Duplicate detection prevents re-import**
    - **Validates: Requirements 4.2, 4.5, 5.1, 5.2, 5.3**

  - [ ]* 3.6 Write unit tests for import handler
    - Test vehicle ownership rejection
    - Test missing s3Key validation error
    - Test invalid import type validation error
    - _Requirements: 9.2, 9.3, 9.5_

- [x] 4. Update presign URL handler for CSV uploads
  - Add `csv-import` to `ALLOWED_UPLOAD_TYPES` in `api/src/handlers/presignUrl.ts`
  - Add `text/csv` to `ALLOWED_CONTENT_TYPES` in `api/src/handlers/presignUrl.ts`
  - Update the `UploadType` type union accordingly
  - _Requirements: 1.1, 1.2, 1.3_

- [x] 5. Checkpoint - Ensure all backend tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 6. Update infrastructure for import handler
  - [x] 6.1 Add `importData` Lambda function to `infra/lib/stacks/api-stack.ts`
    - Add to `functionDefs` array with name `importData` and description
    - Grant read/write on Fillups and Maintenance tables
    - Grant read on Vehicles table (ownership check)
    - Grant read on Photos S3 bucket (download CSV files)
    - _Requirements: 9.1, 9.4_

  - [x] 6.2 Add API Gateway routes for import and recalculate
    - `POST /v1/vehicles/{vehicleId}/import/{type}` → `importData` Lambda
    - `POST /v1/vehicles/{vehicleId}/recalculate` → `importData` Lambda
    - Both routes use the existing JWT authorizer
    - _Requirements: 9.1, 9.4_

- [x] 7. Implement frontend import and recalculate
  - [x] 7.1 Create `web/src/api/import.ts` with TanStack Query mutations
    - `useImportCsv(vehicleId)` — POST to `/v1/vehicles/{vehicleId}/import/{type}` with `{ s3Key }`
    - `useRecalculateMetrics(vehicleId)` — POST to `/v1/vehicles/{vehicleId}/recalculate`
    - Update `web/src/api/upload.ts` to support `csv-import` upload type and `text/csv` content type
    - _Requirements: 7.2, 8.2_

  - [x] 7.2 Create `web/src/components/ImportDialog.tsx`
    - Dialog with select for CSV type (Fuelups / Maintenance) and file input accepting `.csv`
    - Upload flow: get presigned URL → upload to S3 → call import API
    - State machine: idle → uploading → importing → success/error
    - Display ImportResult summary on success (imported, skipped, duplicates, errors)
    - Display error message on failure
    - _Requirements: 7.2, 7.3, 7.4, 7.5_

  - [x] 7.3 Add Import and Recalculate actions to `web/src/pages/VehicleDetailPage.tsx`
    - Add "Import Data" button that opens ImportDialog
    - Add "Recalculate Metrics" button that calls recalculate API with loading state
    - Show success toast with recalculated count, invalidate fillups query to refresh data
    - _Requirements: 7.1, 8.1, 8.2, 8.3, 8.4_

- [x] 8. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties using fast-check
- Unit tests validate specific examples and edge cases
- Derived metrics are set to `null` during import — the user triggers recalculation separately via the "Recalculate Metrics" button
