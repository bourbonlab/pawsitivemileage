# Requirements Document

## Introduction

PawsitiveMileage is a serverless vehicle fuel tracking and maintenance management application. It enables vehicle owners to log fuel purchases with minimal input (date, spend, gallons, odometer) and automatically calculates key metrics such as MPG, cost per mile, miles between fillups, and price per gallon. The platform also provides flexible maintenance tracking with admin-configurable schemas, analytics dashboards, year-over-year comparisons, shareable summary cards, and data export capabilities. The application is built as a mobile-first responsive web app on AWS serverless infrastructure (Lambda, DynamoDB, S3, Cognito, CloudFront) with a React/TypeScript frontend, designed to keep costs near-zero at low usage while scaling gracefully.

## Glossary

- **Application**: The PawsitiveMileage web application as a whole
- **User**: An authenticated individual who owns and manages vehicles, fillups, and maintenance records
- **Admin**: A User with the admin flag set, granting access to platform management features
- **Garage**: The collection of vehicles belonging to a User
- **Vehicle**: A registered automobile with associated metadata (nickname, make, model, year, etc.)
- **Fillup**: A fuel purchase record containing date, spend, gallons, and odometer reading
- **Partial_Fill**: A Fillup where the fuel tank was not completely filled, flagged by the User
- **Derived_Metrics**: Automatically calculated values from Fillup data: MPG, cost per mile, miles since last fillup, price per gallon, days since last fillup
- **Maintenance_Schema**: An Admin-defined global template for a maintenance type (e.g., Oil Change) with default intervals
- **Maintenance_Record**: A User-created log of a maintenance service performed on a Vehicle
- **Reminder**: A notification displayed in the UI when a Vehicle approaches a maintenance interval threshold
- **Analytics_Dashboard**: The per-vehicle view displaying charts and trends for fuel and maintenance data
- **Summary_Card**: A shareable image summarizing a Vehicle's annual statistics
- **Presigned_URL**: A time-limited S3 URL that allows direct file upload from the browser
- **DynamoDB_Table**: A DynamoDB table dedicated to a specific entity type or group of related entities
- **JWT**: JSON Web Token issued by Cognito for API authorization
- **API_Gateway**: AWS API Gateway v2 (HTTP API) serving as the entry point for all backend requests

## Requirements

### Requirement 1: User Authentication

**User Story:** As a vehicle owner, I want to sign in using my Google account, so that I can securely access my vehicle data without creating a separate username and password.

#### Acceptance Criteria

1. WHEN a User navigates to the Application and is not authenticated, THE Application SHALL redirect the User to the Cognito hosted UI login page with Google as the identity provider
2. WHEN a User completes Google OAuth authentication successfully, THE Application SHALL receive a valid JWT and store it for subsequent API requests
3. WHEN a User authenticates for the first time, THE Application SHALL create a user profile record containing userId, email, displayName, createdAt, and updatedAt fields
4. WHEN a JWT expires, THE Application SHALL transparently refresh the token without requiring the User to re-authenticate
5. IF a token refresh fails, THEN THE Application SHALL redirect the User to the login page
6. WHEN a User chooses to log out, THE Application SHALL clear all local tokens and redirect to the login page

### Requirement 2: Vehicle Management (Garage)

**User Story:** As a vehicle owner, I want to add, edit, archive, and view my vehicles in a garage interface, so that I can manage multiple vehicles and their associated data.

#### Acceptance Criteria

1. WHEN a User adds a Vehicle, THE Application SHALL require nickname, make, model, and year, and optionally accept trim, color, VIN, license plate, tank size, fuel type, and photo
2. WHEN a User edits a Vehicle, THE Application SHALL update the Vehicle record and reflect changes immediately in the Garage view
3. WHEN a User archives a Vehicle, THE Application SHALL remove the Vehicle from the active Garage view while preserving all historical Fillup and Maintenance_Record data
4. WHEN a User views the Garage, THE Application SHALL display all active Vehicles with their photos and key metadata
5. WHEN a User views the archived section, THE Application SHALL display all archived Vehicles with their historical data accessible
6. WHEN a User unarchives a Vehicle, THE Application SHALL restore the Vehicle to the active Garage view
7. WHEN a User uploads a Vehicle photo, THE Application SHALL generate a Presigned_URL, upload the photo to S3 with a user-scoped prefix, and display the photo as the Vehicle card thumbnail

### Requirement 3: Fuel Fillup Tracking

**User Story:** As a vehicle owner, I want to log fuel purchases with minimal input and have the system automatically calculate fuel economy metrics, so that I can track my vehicle's efficiency without manual math.

#### Acceptance Criteria

1. WHEN a User creates a Fillup, THE Application SHALL require date (defaulting to current date/time), total currency spent, gallons added, and current odometer reading
2. WHEN a Fillup is saved and a previous Fillup exists for the same Vehicle, THE Application SHALL calculate and store Derived_Metrics: price per gallon (currencySpent / gallonsAdded), miles since last fillup (currentOdometer - previousOdometer), MPG (milesSinceLastFillup / gallonsAdded), cost per mile (currencySpent / milesSinceLastFillup), and days since last fillup (currentDate - previousFillupDate)
3. WHEN a Fillup is the first Fillup for a Vehicle, THE Application SHALL calculate price per gallon only and leave miles-dependent Derived_Metrics empty
4. WHEN a User flags a Fillup as a Partial_Fill, THE Application SHALL skip MPG calculation for that Fillup and accumulate gallons and miles until the next non-partial Fillup
5. WHEN a non-partial Fillup follows one or more Partial_Fill records, THE Application SHALL calculate MPG using the accumulated gallons and accumulated miles since the last non-partial Fillup
6. WHEN a User edits or deletes a Fillup, THE Application SHALL recalculate Derived_Metrics for all subsequent Fillups of that Vehicle
7. WHEN a User uploads a receipt photo with a Fillup, THE Application SHALL generate a Presigned_URL, store the photo in S3, and associate the S3 key with the Fillup record
8. WHEN a User views a Fillup detail, THE Application SHALL display all input fields, all Derived_Metrics, the receipt photo (if present), and any notes
9. WHEN a User provides an odometer reading less than or equal to the previous Fillup's odometer, THE Application SHALL reject the Fillup and display a validation error

### Requirement 4: Maintenance Tracking

**User Story:** As a vehicle owner, I want to log maintenance services and receive reminders based on mileage and time intervals, so that I can keep my vehicles properly maintained.

#### Acceptance Criteria

1. WHEN an Admin creates a Maintenance_Schema, THE Application SHALL store the schema with name, description, default mileage interval, default time interval (days), and category, and make the schema available to all Users immediately
2. WHEN an Admin modifies a Maintenance_Schema, THE Application SHALL update the schema and reflect changes for all Users
3. WHEN an Admin deactivates a Maintenance_Schema, THE Application SHALL hide the schema from new Maintenance_Record creation while preserving existing records that reference the schema
4. WHEN a User logs a Maintenance_Record, THE Application SHALL allow selection from active Maintenance_Schemas and capture date performed, odometer at service, cost, optional location, optional notes, and optional receipt photo
5. WHEN a User logs a custom Maintenance_Record not tied to a Maintenance_Schema, THE Application SHALL allow free-text entry of the maintenance type name along with all standard record fields
6. WHEN a User customizes maintenance intervals for a specific Vehicle, THE Application SHALL use the custom intervals instead of the Maintenance_Schema defaults for Reminder calculations on that Vehicle
7. WHEN a Vehicle's current odometer approaches the next service mileage threshold for a Maintenance_Schema, THE Application SHALL display a Reminder in the UI
8. WHEN the current date approaches the next service date threshold for a Maintenance_Schema, THE Application SHALL display a time-based Reminder in the UI
9. WHEN a User views maintenance history for a Vehicle, THE Application SHALL display all Maintenance_Records in chronological order with schema name, date, odometer, and cost

### Requirement 5: Location Services

**User Story:** As a vehicle owner, I want to optionally record where I fill up, so that I can track fuel prices at specific stations and view my fillup history on a map.

#### Acceptance Criteria

1. WHEN a User creates a Fillup and grants geolocation permission, THE Application SHALL auto-detect the current location using the browser geolocation API and pre-fill latitude and longitude
2. WHERE the browser geolocation API is unavailable or permission is denied, THE Application SHALL offer a map picker and manual address entry as alternative location input methods
3. WHEN location data is provided with a Fillup, THE Application SHALL store latitude, longitude, station name (if provided), and address (if provided or resolved)
4. WHEN a User views fillup history with location data, THE Application SHALL offer a map view displaying fillup locations

### Requirement 6: Analytics and Reporting

**User Story:** As a vehicle owner, I want to view charts and trends of my fuel economy and costs, compare year-over-year performance, and export my data, so that I can understand and optimize my vehicle ownership costs.

#### Acceptance Criteria

1. WHEN a User views the Analytics_Dashboard for a Vehicle, THE Application SHALL display MPG over time (line chart), monthly fuel spending (bar chart), cost per mile trends, miles driven per month, and fillup frequency patterns
2. WHEN a User requests year-over-year comparison for a Vehicle, THE Application SHALL display side-by-side annual summaries including total spent, total gallons, average MPG, total miles, and maintenance costs with trend indicators
3. WHEN a User generates a Summary_Card for a Vehicle, THE Application SHALL produce a shareable image containing total miles, total fuel cost, average MPG, number of fillups, and total maintenance cost for the selected year
4. WHEN a User shares a Summary_Card, THE Application SHALL provide a direct link and a downloadable image
5. WHEN a User exports fillup data, THE Application SHALL generate a CSV file containing all Fillup fields and Derived_Metrics, scoped by the selected Vehicle(s) and date range
6. WHEN a User exports maintenance data, THE Application SHALL generate a CSV file containing all Maintenance_Record fields, scoped by the selected Vehicle(s) and date range
7. WHEN a User requests a PDF report, THE Application SHALL generate a PDF containing charts and summary statistics for the selected Vehicle(s) and date range

### Requirement 7: Admin Panel

**User Story:** As a platform administrator, I want to manage users, maintenance schemas, and monitor platform health, so that I can maintain service quality and support users.

#### Acceptance Criteria

1. WHEN a non-Admin User attempts to access Admin endpoints, THE API_Gateway SHALL return a 403 Forbidden response
2. WHEN an Admin views the user management section, THE Application SHALL display a list of all registered Users with vehicle count, fillup count, and last active date
3. WHEN an Admin sets or removes the admin flag on a User, THE Application SHALL update the flag and the target User's permissions SHALL take effect on the next API request
4. WHEN an Admin views platform statistics, THE Application SHALL display total registered users, active users, total fillups logged, total vehicles, and usage trends over time
5. WHEN an Admin accesses the monitoring section, THE Application SHALL display key metrics including API request count, error rate, p50/p95/p99 latency, Lambda cold starts, and DynamoDB consumed capacity

### Requirement 8: API Design and Authorization

**User Story:** As a developer, I want a versioned, secure REST API with consistent patterns, so that the backend supports the web frontend and future mobile clients.

#### Acceptance Criteria

1. THE API_Gateway SHALL prefix all routes with `/v1/` for versioning
2. WHEN an API request is received, THE API_Gateway SHALL validate the JWT in the Authorization header before invoking the Lambda function
3. IF an API request contains an invalid or missing JWT, THEN THE API_Gateway SHALL return a 401 Unauthorized response
4. WHEN a Lambda function processes a request, THE Lambda function SHALL scope all DynamoDB queries to the authenticated User's userId to enforce tenant isolation
5. IF a Lambda function encounters an unhandled error, THEN THE Lambda function SHALL log the error in structured JSON format and return a 500 response with a generic error message
6. THE API_Gateway SHALL respond to standard CRUD operations within 200ms at the p95 latency level

### Requirement 9: Data Storage

**User Story:** As a developer, I want a well-structured DynamoDB data layer, so that all access patterns are served efficiently with minimal read/write operations.

#### Acceptance Criteria

1. THE Application SHALL store each entity type (User profiles, Vehicles, Fillups, Maintenance_Records, Maintenance_Schemas) in dedicated DynamoDB tables with appropriate partition and sort keys
2. WHEN retrieving all Vehicles for a User, THE Application SHALL query the Vehicles table by userId and return results in a single query
3. WHEN retrieving all Fillups for a Vehicle, THE Application SHALL query the Fillups table by vehicleId and return results sorted by date
4. WHEN retrieving all Maintenance_Records for a Vehicle, THE Application SHALL query the Maintenance table by vehicleId and return results sorted by date
5. WHEN retrieving all Maintenance_Schemas, THE Application SHALL query the Schemas table and return all active schemas
6. THE Application SHALL use Global Secondary Indexes where needed for admin cross-user queries and time-based date range queries

### Requirement 10: Infrastructure and Deployment

**User Story:** As a developer, I want all infrastructure defined as code with environment-aware deployments, resource tagging, and unique naming per environment, so that I can reliably deploy and manage test, staging, and production environments side by side.

#### Acceptance Criteria

1. THE Application SHALL define all AWS resources using AWS CDK in TypeScript with separate stacks for Auth, Database, API, Frontend, Storage, and Monitoring
2. WHEN a deployment is executed, THE CDK SHALL deploy without downtime to the target environment (test, staging, or production)
3. THE CDK SHALL tag all AWS resources with at minimum: Environment (test, staging, production), Project (PawsitiveMileage), and ManagedBy (CDK) tags
4. THE CDK SHALL generate unique resource names per environment by appending the environment name as a suffix (e.g., pawsitivemileage-vehicles-table-test, pawsitivemileage-vehicles-table-staging, pawsitivemileage-vehicles-table-production)
5. WHEN deploying the production environment, THE Application SHALL serve the frontend at pawsitivemileage.bourbonlab.net and the API at pawsitivemileageapi.bourbonlab.net
6. WHEN deploying the staging environment, THE Application SHALL serve the frontend at pawsitivemileagestaging.bourbonlab.net and the API at pawsitivemileageapistaging.bourbonlab.net
7. WHEN deploying the test environment, THE Application SHALL serve the frontend at pawsitivemileagetest.bourbonlab.net and the API at pawsitivemileageapitest.bourbonlab.net
8. THE Application SHALL configure CloudFlare DNS with CNAME records proxied through CloudFlare with SSL mode set to Full (Strict) for each environment
9. THE CDK SHALL accept the target environment as a deployment parameter, enabling the same CDK code to deploy all three environments

### Requirement 11: Data Privacy and Account Management

**User Story:** As a vehicle owner, I want to be able to delete my account and all associated data, so that I have control over my personal information.

#### Acceptance Criteria

1. WHEN a User requests account deletion, THE Application SHALL delete the user profile, all Vehicles, all Fillups, all Maintenance_Records, and all associated S3 objects (photos) belonging to that User
2. THE Application SHALL enforce strict tenant isolation by including the authenticated userId in all DynamoDB queries, preventing any User from accessing another User's data
3. WHEN a Vehicle is deleted or a User account is deleted, THE Application SHALL delete all S3 objects associated with the deleted records

### Requirement 12: Frontend User Experience

**User Story:** As a vehicle owner, I want a fast, mobile-first responsive interface, so that I can quickly log fillups and view my data on any device.

#### Acceptance Criteria

1. THE Application SHALL render a mobile-first responsive layout that adapts to phone, tablet, and desktop screen sizes
2. THE Application SHALL load the initial page in under 2 seconds on mobile networks
3. WHEN a User logs a Fillup, THE Application SHALL complete the flow (input to confirmation) with four or fewer required input fields
4. WHEN server data changes, THE Application SHALL use TanStack Query to cache, synchronize, and update the UI without full page reloads
5. THE Application SHALL use shadcn/ui components for a consistent visual design across all views
