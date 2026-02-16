# Requirements Document

## Introduction

This feature enables PawsitiveMileage users to import historical fuel and maintenance data from Fuelly, a popular fuel tracking application, via CSV file upload. It also provides a "Recalculate" action on the vehicle detail page to recompute all derived fillup metrics after bulk imports or manual corrections.

## Glossary

- **Import_Handler**: The Lambda function responsible for parsing uploaded CSV files and writing records to DynamoDB
- **CSV_Parser**: The module that reads and validates Fuelly CSV data, transforming rows into PawsitiveMileage data structures
- **Fuelly_Fuelups_CSV**: The CSV export format from Fuelly containing fillup records with columns: car_name, model, mpg, odometer, miles, gallons, price, city_percentage, fuelup_date, date_added, tags, notes, missed_fuelup, partial_fuelup, latitude, longitude, brand
- **Fuelly_Maintenance_CSV**: The CSV export format from Fuelly containing maintenance records with columns: car_name, model, odometer, price, service_date, date_added, tags, service_type, sub_service_types, notes, latitude, longitude
- **Import_Result**: A summary object returned after an import operation containing counts of imported, skipped, and failed records along with any error details
- **Recalculate_Handler**: The API endpoint that triggers a full recalculation of all derived metrics for a vehicle's fillups
- **Metrics_Engine**: The existing `metrics.ts` module that computes derived fillup metrics (MPG, cost per mile, price per gallon, miles since last fillup, days since last fillup)
- **Presign_Flow**: The existing presigned URL upload mechanism using the Photos S3 bucket and `presignUrl.ts` handler

## Requirements

### Requirement 1: CSV File Upload

**User Story:** As a user, I want to upload a Fuelly CSV export file to PawsitiveMileage, so that I can begin importing my historical data.

#### Acceptance Criteria

1. WHEN a user selects a CSV file for upload, THE Presign_Flow SHALL generate a presigned URL with a `csv-import` upload type targeting the Photos S3 bucket
2. WHEN a CSV file is uploaded, THE Presign_Flow SHALL accept `text/csv` as a valid content type in addition to existing image types
3. THE Presign_Flow SHALL store uploaded CSV files using the S3 key pattern `{userId}/{vehicleId}/csv-import/{filename}`
4. IF a user attempts to upload a file that is not a valid CSV, THEN THE Import_Handler SHALL return a descriptive error indicating the file format is invalid

### Requirement 2: Fuelly Fuelups CSV Parsing

**User Story:** As a user, I want PawsitiveMileage to correctly parse my Fuelly fuelups CSV export, so that my historical fillup data is accurately imported.

#### Acceptance Criteria

1. WHEN a Fuelly_Fuelups_CSV file is provided, THE CSV_Parser SHALL parse each row and map columns to PawsitiveMileage fillup fields: `fuelup_date` → `date`, `gallons` → `gallonsAdded`, `odometer` → `odometerReading`, `partial_fuelup` → `isPartialFill` (0=false, 1=true)
2. WHEN a Fuelly_Fuelups_CSV row contains a `price` value, THE CSV_Parser SHALL calculate `currencySpent` as `gallons * price`
3. WHEN a Fuelly_Fuelups_CSV row contains `latitude` and `longitude` values, THE CSV_Parser SHALL map them to `locationLat` and `locationLng` on the fillup record
4. WHEN a Fuelly_Fuelups_CSV row contains a `notes` value, THE CSV_Parser SHALL map it to the `notes` field on the fillup record
5. WHEN a Fuelly_Fuelups_CSV row has `mpg` equal to 0 and `miles` equal to 0, THE CSV_Parser SHALL treat the row as the baseline entry (first fillup for the vehicle)
6. IF a Fuelly_Fuelups_CSV row has an empty or zero `gallons` value, THEN THE CSV_Parser SHALL skip the row and include it in the skipped count of the Import_Result
7. IF a Fuelly_Fuelups_CSV row has an empty or invalid `fuelup_date`, THEN THE CSV_Parser SHALL skip the row and include it in the skipped count of the Import_Result
8. IF a Fuelly_Fuelups_CSV row has an empty or zero `odometer` value, THEN THE CSV_Parser SHALL skip the row and include it in the skipped count of the Import_Result

### Requirement 3: Fuelly Maintenance CSV Parsing

**User Story:** As a user, I want PawsitiveMileage to correctly parse my Fuelly maintenance CSV export, so that my historical service records are accurately imported.

#### Acceptance Criteria

1. WHEN a Fuelly_Maintenance_CSV file is provided, THE CSV_Parser SHALL parse each row and map columns to PawsitiveMileage maintenance fields: `service_date` → `datePerformed`, `odometer` → `odometerAtService`, `price` → `cost`, `notes` → `notes`
2. WHEN a Fuelly_Maintenance_CSV row has a `service_type` of "service" or "note", THE CSV_Parser SHALL map it to a `customTypeName` derived from `sub_service_types` if present, or set `customTypeName` to "Other" if `sub_service_types` is empty
3. WHEN a Fuelly_Maintenance_CSV row has an empty `price`, THE CSV_Parser SHALL set `cost` to 0
4. WHEN a Fuelly_Maintenance_CSV row has an empty `odometer`, THE CSV_Parser SHALL set `odometerAtService` to 0
5. IF a Fuelly_Maintenance_CSV row has an empty or invalid `service_date`, THEN THE CSV_Parser SHALL skip the row and include it in the skipped count of the Import_Result

### Requirement 4: Import Processing

**User Story:** As a user, I want the import process to handle my data reliably and give me clear feedback, so that I know exactly what was imported and what was skipped.

#### Acceptance Criteria

1. WHEN an import is triggered, THE Import_Handler SHALL download the CSV file from S3, parse it, and write valid records to DynamoDB
2. WHEN writing fillup records, THE Import_Handler SHALL sort records by `fuelup_date` ascending and assign sort keys in chronological order
3. WHEN writing fillup records, THE Import_Handler SHALL use DynamoDB batch write operations to insert records efficiently
4. WHEN writing maintenance records, THE Import_Handler SHALL use DynamoDB batch write operations to insert records efficiently
5. WHEN an import completes, THE Import_Handler SHALL return an Import_Result containing the total rows processed, the count of successfully imported records, the count of skipped records, and a list of skip reasons
6. WHEN writing fillup records, THE Import_Handler SHALL populate GSI keys (GSI1PK, GSI1SK, GSI2PK, GSI2SK) consistent with the existing fillup data model
7. WHEN writing maintenance records, THE Import_Handler SHALL populate GSI keys (GSI1PK, GSI1SK) consistent with the existing maintenance data model
8. IF a DynamoDB write fails for a record, THEN THE Import_Handler SHALL continue processing remaining records and include the failure in the Import_Result error details

### Requirement 5: Duplicate Prevention

**User Story:** As a user, I want the import to avoid creating duplicate records if I accidentally import the same file twice, so that my data stays clean.

#### Acceptance Criteria

1. WHEN importing fillup records, THE Import_Handler SHALL check for existing fillups with the same `date` and `odometerReading` for the target vehicle and skip duplicates
2. WHEN importing maintenance records, THE Import_Handler SHALL check for existing records with the same `datePerformed` and `odometerAtService` for the target vehicle and skip duplicates
3. WHEN a duplicate is detected, THE Import_Handler SHALL include the duplicate in the skipped count of the Import_Result with a reason of "duplicate"

### Requirement 6: Metrics Recalculation

**User Story:** As a user, I want to recalculate all derived metrics for a vehicle after importing data, so that MPG, cost per mile, and other calculated fields are accurate across the full history.

#### Acceptance Criteria

1. WHEN a user triggers a recalculation for a vehicle, THE Recalculate_Handler SHALL fetch all fillups for the vehicle sorted by date ascending
2. WHEN recalculating, THE Metrics_Engine SHALL recompute all derived metrics (pricePerGallon, milesSinceLastFillup, mpg, costPerMile, daysSinceLastFillup) for each fillup in chronological order, correctly handling partial fill accumulation
3. WHEN recalculation completes, THE Recalculate_Handler SHALL write all updated fillup records back to DynamoDB
4. WHEN recalculation completes, THE Recalculate_Handler SHALL return the count of fillups that were recalculated

### Requirement 7: Import User Interface

**User Story:** As a user, I want a clear interface to select my Fuelly CSV file, choose the import type, and see the results, so that the import process is straightforward.

#### Acceptance Criteria

1. WHEN a user navigates to the vehicle detail page, THE System SHALL display an "Import Data" action
2. WHEN a user clicks "Import Data", THE System SHALL present a dialog allowing the user to select the CSV type (Fuelups or Maintenance) and choose a file
3. WHEN an import is in progress, THE System SHALL display a loading indicator with a message describing the current operation
4. WHEN an import completes successfully, THE System SHALL display the Import_Result summary showing imported count, skipped count, and any error details
5. IF an import fails, THEN THE System SHALL display a descriptive error message to the user

### Requirement 8: Recalculate User Interface

**User Story:** As a user, I want a "Recalculate" button on the vehicle detail page, so that I can trigger a full metrics recalculation after imports or manual corrections.

#### Acceptance Criteria

1. WHEN a user navigates to the vehicle detail page, THE System SHALL display a "Recalculate Metrics" action
2. WHEN a user clicks "Recalculate Metrics", THE System SHALL call the Recalculate_Handler API and display a loading indicator
3. WHEN recalculation completes, THE System SHALL display a success message with the count of recalculated fillups and refresh the displayed fillup data
4. IF recalculation fails, THEN THE System SHALL display a descriptive error message to the user

### Requirement 9: Import API Endpoint

**User Story:** As a developer, I want a dedicated API endpoint for CSV imports, so that the import logic is cleanly separated from existing CRUD operations.

#### Acceptance Criteria

1. THE Import_Handler SHALL expose a POST endpoint at `/v1/vehicles/{vehicleId}/import/{type}` where `type` is either `fuelups` or `maintenance`
2. THE Import_Handler SHALL accept a JSON body containing the S3 key of the uploaded CSV file
3. THE Import_Handler SHALL verify that the authenticated user owns the target vehicle before processing the import
4. THE Recalculate_Handler SHALL expose a POST endpoint at `/v1/vehicles/{vehicleId}/recalculate`
5. THE Recalculate_Handler SHALL verify that the authenticated user owns the target vehicle before processing the recalculation
