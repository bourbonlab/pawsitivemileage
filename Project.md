# PawsitiveMileage — Project Charter

## 1. Project Overview

PawsitiveMileage is a serverless vehicle fuel tracking and maintenance management application. The application enables vehicle owners to log fuel purchases with minimal input and automatically calculates key metrics such as miles per gallon (MPG), cost per mile, miles between fillups, and price per gallon. Beyond fuel tracking, the platform provides flexible maintenance tracking with administrator-configurable maintenance schemas, analytics dashboards, and reporting tools to give users a complete picture of their vehicle ownership costs.

The application is designed as a mobile-first responsive web application with a well-structured API layer that supports future native mobile app development. All infrastructure is serverless to minimize operational overhead and keep costs proportional to actual usage.

## 2. Goals & Objectives

- Provide a simple, fast way to log fuel purchases with minimal required input (Date, Currency Spent, Gallons Added, Odometer Reading)
- Automatically calculate derived metrics: MPG, miles between fillups, price per gallon, cost per mile
- Support multiple vehicles per user through a "Garage" feature
- Offer flexible, admin-configurable maintenance tracking with reminder capabilities
- Deliver analytics and reporting that help users understand their vehicle costs over time
- Build a mobile-first web experience with APIs structured for future native mobile development
- Keep infrastructure costs near-zero at low usage through serverless architecture
- Use latest available runtimes and frameworks to minimize future refactoring

## 3. Target Users

- Individual vehicle owners who want to track fuel economy and spending
- Multi-vehicle households wanting a unified view of all vehicle costs
- Cost-conscious drivers interested in trends and optimization
- Platform administrators who manage maintenance schemas and monitor platform health

**Initial Scale**: Less than 1,000 users. Architecture should scale gracefully beyond this without redesign.

## 4. Project Structure

The codebase is organized into four distinct components:

```
pawsitive-mileage/
├── web/          # React frontend application
├── api/          # Lambda function handlers and API logic
├── infra/        # AWS CDK infrastructure-as-code
├── cli/          # Administrative CLI tools and scripts
├── SampleData/   # Sample datasets for development and testing
└── Project.md    # This document
```

### 4.1 Web Frontend (`web/`)
- Mobile-first responsive React application
- TypeScript throughout
- Hosted on S3 with CloudFront distribution
- Custom domain: **pawsitivemileage.bourbonlab.net**
- Authentication via AWS Cognito hosted UI with Google identity provider
- Progressive enhancement for location services (geolocation API)

### 4.2 API Backend (`api/`)
- AWS Lambda functions bundled with esbuild for minimal cold starts
- Node.js 24.x runtime (latest LTS, supported until April 2028)
- API Gateway v2 (HTTP API) with custom domain: **pawsitivemileageapi.bourbonlab.net**
- API versioning from day one: all routes prefixed with `/v1/`
- Structured for future mobile client consumption
- Request validation and error handling middleware

### 4.3 Infrastructure (`infra/`)
- AWS CDK in TypeScript
- All infrastructure defined as code — no manual console configuration
- Separate stacks for: Auth, Database, API, Frontend, Storage, Monitoring
- Environment-aware deployments (dev, staging, prod)

### 4.4 CLI & Tools (`cli/`)
- Administrative scripts for platform management
- Data migration and seeding tools
- Maintenance schema management utilities
- Development helper scripts

## 5. Feature Specifications

### 5.1 Authentication & User Management

**Authentication Flow**:
- AWS Cognito User Pool as the identity provider
- Google OAuth 2.0 as the sole login provider
- Cognito Hosted UI for login/signup flow
- JWT tokens for API authorization
- Token refresh handled transparently by the frontend

**User Profiles**:
- Automatically created on first login from Cognito attributes
- Fields: userId, email, displayName, createdAt, updatedAt
- Admin flag (boolean) stored as a custom Cognito attribute or in DynamoDB
- Admin flag is set manually by existing admins — not self-assignable

**Admin Capabilities**:
- View all user accounts and usage statistics
- Global reporting across all users (anonymized/aggregated)
- Create, modify, and delete maintenance schemas (global templates)
- Manage global application settings
- Access CloudWatch monitoring dashboards

### 5.2 Garage — Vehicle Management

Users manage their vehicles through a "Garage" interface.

**Vehicle Registration**:
- Required fields: nickname, make, model, year
- Optional fields: trim, color, VIN, license plate, tank size (gallons), fuel type, photo
- Tank size enables range estimation features
- EPA-rated MPG can be stored for comparison against actual performance

**Vehicle Lifecycle**:
- Active vehicles appear in the main garage view
- Vehicles can be archived (sold, retired, totaled) without deleting historical data
- Archived vehicles and their data remain accessible in a separate "archived" view
- Vehicles can be unarchived if needed

**Vehicle Photos**:
- Upload via S3 presigned URLs
- Displayed in garage UI as vehicle card thumbnails
- Stored in a dedicated S3 bucket with user-scoped prefixes

### 5.3 Fuel Fillup Tracking

The core feature of the application. Users provide minimal input and the system calculates everything else.

**Required Input Per Fillup**:
- Date (defaults to current date/time)
- Total currency spent (e.g., $45.50)
- Gallons added (e.g., 12.5)
- Current odometer reading (e.g., 45,230)

**Automatically Calculated Fields**:
- Price per gallon: `currencySpent / gallonsAdded`
- Miles since last fillup: `currentOdometer - previousOdometer`
- MPG: `milesSinceLastFillup / gallonsAdded`
- Cost per mile: `currencySpent / milesSinceLastFillup`
- Days since last fillup: `currentDate - previousFillupDate`

**Optional Input**:
- Location (gas station) — see Section 5.5
- Receipt photo upload
- Notes (free text)
- Partial fill flag (affects MPG calculation — MPG should not be calculated for partial fills, only accumulated until next full fill)

**Receipt Photos**:
- Upload directly from camera or photo library
- Stored in S3 with presigned upload URLs
- Associated with the fillup record via S3 key reference
- Viewable from fillup detail view

### 5.4 Maintenance Tracking

A flexible system where administrators define maintenance types and users track them per vehicle.

**Admin-Configurable Maintenance Schemas (Templates)**:
- Administrators create and manage global maintenance types
- Each schema defines: name, description, default mileage interval, default time interval (days), category
- Examples: Oil Change (every 5,000 miles / 180 days), Tire Rotation (every 7,500 miles / 365 days), Brake Inspection, Air Filter, Transmission Fluid, etc.
- Schemas can be added, modified, or deactivated by admins at any time
- New schemas become available to all users immediately

**User Maintenance Records**:
- Users select from available maintenance schemas when logging maintenance
- Per-record fields: date performed, odometer at service, cost, location (optional), notes, receipt photo (optional)
- Users can customize intervals per vehicle (override the global defaults)
- Custom/one-off maintenance entries allowed (not tied to a schema)

**Maintenance Reminders**:
- Based on mileage interval: triggers when current odometer approaches next service mileage
- Based on time interval: triggers when current date approaches next service date
- Reminders calculated from the last recorded service of that type for that vehicle
- Displayed in the UI as upcoming maintenance items
- Future enhancement: push notifications / email reminders

### 5.5 Location Services

Location tracking for fillup stations is entirely optional.

**Location Input Methods** (in order of preference):
1. Browser geolocation API — auto-detect current location with user permission
2. Map picker — interactive map to drop a pin
3. Manual address entry — type in an address or station name

**Location Data Stored**:
- Latitude and longitude
- Station name (if provided or resolved)
- Address (if provided or resolved via reverse geocoding)

**Location Features**:
- Fuel price trends at frequently visited stations
- Map view of fillup history
- Future: station price comparison

### 5.6 Analytics & Reporting

**Per-Vehicle Analytics**:
- MPG over time (line chart)
- Monthly fuel spending (bar chart)
- Cost per mile trends (fuel only, maintenance only, combined)
- Miles driven per month
- Fuel price trends at frequent stations
- Fillup frequency patterns

**Year-Over-Year Comparisons**:
- Side-by-side annual summaries: total spent, total gallons, average MPG, total miles, maintenance costs
- Trend indicators (up/down arrows, percentage changes)
- Available for each vehicle individually

**Shareable Summary Cards**:
- "2026 in Review" style cards for each vehicle
- Key stats: total miles, total fuel cost, average MPG, number of fillups, total maintenance cost
- Visually designed for sharing on social media or messaging
- Generated as images (server-side rendering or canvas-based)
- Shareable via direct link or downloadable image

**Data Export**:
- CSV export of fillup history (per vehicle or all vehicles)
- CSV export of maintenance history
- PDF report generation with charts and summaries
- Export scoped by date range

**Admin Reporting**:
- Total registered users and active users
- Aggregate platform statistics (total fillups logged, total vehicles, etc.)
- Usage trends over time
- CloudWatch dashboards for API latency, error rates, Lambda invocations, DynamoDB capacity

### 5.7 Admin Panel

A dedicated section of the web application accessible only to users with the admin flag.

**User Management**:
- View list of all registered users
- View per-user statistics (vehicle count, fillup count, last active)
- Ability to set/remove admin flag on other users

**Maintenance Schema Management**:
- CRUD interface for global maintenance schemas
- Preview how schemas appear to end users
- Activate/deactivate schemas without deletion

**Global Settings**:
- Application-level configuration (future use)
- Feature flags (future use)

**Platform Monitoring**:
- Embedded CloudWatch dashboard widgets or links to CloudWatch console
- Key metrics: API request count, error rate, p50/p95/p99 latency, Lambda cold starts, DynamoDB consumed capacity

## 6. Technical Architecture

### 6.1 AWS Services

| Service | Purpose |
|---------|---------|
| **Cognito** | User authentication with Google identity provider |
| **API Gateway v2** | HTTP API with custom domain, JWT authorizer, versioned routes |
| **Lambda** | All backend compute, esbuild-bundled, Node.js 24.x |
| **DynamoDB** | Primary database for all application data |
| **S3** | Receipt photos, vehicle photos, frontend static hosting, export files |
| **CloudFront** | CDN for frontend static assets |
| **CloudWatch** | Logging, metrics, alarms, admin dashboards |
| **CDK** | Infrastructure as code for all resources |

### 6.2 API Design

**Base URL**: `https://pawsitivemileageapi.bourbonlab.net/v1`

**Resource Structure**:
```
/v1/vehicles                    # CRUD for vehicles
/v1/vehicles/{vehicleId}/fillups    # CRUD for fillups per vehicle
/v1/vehicles/{vehicleId}/maintenance # CRUD for maintenance per vehicle
/v1/vehicles/{vehicleId}/analytics   # Analytics endpoints per vehicle
/v1/vehicles/{vehicleId}/export      # Export endpoints per vehicle
/v1/user/profile                # User profile management
/v1/admin/users                 # Admin: user management
/v1/admin/schemas               # Admin: maintenance schema management
/v1/admin/stats                 # Admin: platform statistics
/v1/upload/presign              # Presigned URL generation for S3 uploads
```

**Authentication**: All endpoints require a valid Cognito JWT in the Authorization header. Admin endpoints additionally verify the admin flag.

**API Versioning**: All routes are prefixed with `/v1/`. When breaking changes are needed, a `/v2/` prefix will be introduced while maintaining `/v1/` for backward compatibility.

### 6.3 DynamoDB Data Model

Single-table design with composite keys to support all access patterns efficiently.

**Primary Key Structure**: `PK` (partition key) + `SK` (sort key)

**Key Access Patterns**:
- Get all vehicles for a user: `PK=USER#{userId}, SK=begins_with(VEHICLE#)`
- Get all fillups for a vehicle: `PK=VEHICLE#{vehicleId}, SK=begins_with(FILLUP#)`
- Get all maintenance for a vehicle: `PK=VEHICLE#{vehicleId}, SK=begins_with(MAINT#)`
- Get all maintenance schemas: `PK=SCHEMA, SK=begins_with(MAINT#)`
- Get user profile: `PK=USER#{userId}, SK=PROFILE`

**GSI (Global Secondary Index)**:
- GSI1: For admin queries across all users
- GSI2: For time-based queries (fillups by date range)

### 6.4 DNS & Domain Configuration

DNS is hosted in CloudFlare and will be proxied through CloudFlare.

| Domain | Target | Purpose |
|--------|--------|---------|
| `pawsitivemileage.bourbonlab.net` | CloudFront distribution | Web frontend |
| `pawsitivemileageapi.bourbonlab.net` | API Gateway custom domain | API backend |

**CloudFlare Configuration**:
- CNAME records pointing to AWS resources
- Proxy enabled (orange cloud) for CDN and DDoS protection
- SSL mode: Full (Strict) — CloudFlare validates the origin certificate
- Note: ACM certificate validation requires temporary DNS proxy disable or use of CNAME validation records

### 6.5 Frontend Architecture

- React 19.x with TypeScript
- Vite 7.x as the build tool
- React Router v7 for client-side routing (with loader/action patterns)
- TanStack Query v5 for server state management
- shadcn/ui v4 component library for consistent mobile-first UI
- Recharts v2.x for analytics charts (stable; v3 still in alpha)
- AWS Amplify JS v6.x for Cognito authentication integration
- Responsive design: mobile-first, works well on tablet and desktop

### 6.6 Lambda Function Architecture

- Each API route maps to a dedicated Lambda function (single-purpose)
- Functions bundled with esbuild for minimal deployment size
- Shared utility layer for common code (DynamoDB client, auth helpers, response formatting)
- Node.js 24.x runtime (latest LTS, supported until April 2028)
- Environment variables for configuration (table names, bucket names, etc.)
- Structured JSON logging for CloudWatch

## 7. Data Retention & Privacy

- All user data retained indefinitely (no rolling window)
- Users can delete their account and all associated data (GDPR-style right to deletion)
- Vehicle archival preserves all historical data
- S3 objects (photos) follow the same lifecycle as their parent records
- No data shared between users unless explicitly granted via the Shared Garage feature (permission-based access control via Sharing table)

## 8. Future Considerations

These items are out of scope for the initial build but should be considered in architectural decisions:

- Native mobile applications (iOS/Android) consuming the same API
- Push notifications for maintenance reminders
- Fuel station price comparison and recommendations
- Trip tracking with per-trip cost summaries
- Social features (compare MPG with friends, community averages)
- Integration with OBD-II devices for automatic odometer reading
- Multi-currency support for international users
- Dark mode theme
- Offline-first PWA capabilities

## 9. Success Criteria

- Users can register, add vehicles, and log fillups in under 60 seconds
- Calculated metrics (MPG, cost per mile) are accurate and update in real-time
- Application loads in under 2 seconds on mobile networks
- Monthly AWS costs remain under $10 for the initial user base (<1,000 users)
- API response times under 200ms p95 for standard CRUD operations
- Zero-downtime deployments via CDK
