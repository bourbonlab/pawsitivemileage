# PawsitiveMileage — Product Context

PawsitiveMileage is a serverless vehicle fuel tracking and maintenance management app built on AWS. Users log fuel purchases with minimal input (date, amount spent, gallons, odometer) and the system auto-calculates MPG, cost per mile, price per gallon, and miles between fillups.

License: GNU AGPL v3

## Target Audience

Individual vehicle owners and multi-vehicle households. Initial scale under 1,000 monthly active users. Estimated cost: ~$1.52/month with free tier, ~$11.73/month without.

## Domains & Environments

| Environment | Frontend Domain | API Domain |
|-------------|----------------|------------|
| Test | `pawsitivemileagetest.bourbonlab.net` | `pawsitivemileageapitest.bourbonlab.net` |
| Staging | `pawsitivemileagestaging.bourbonlab.net` | `pawsitivemileageapistaging.bourbonlab.net` |
| Production | `pawsitivemileage.bourbonlab.net` | `pawsitivemileageapi.bourbonlab.net` |

DNS managed in CloudFlare (proxied, Full Strict SSL). ACM wildcard certificate in us-east-1 for TLS on CloudFront and API Gateway custom domains.

## Core Features

**Fuel Tracking**
- Log fillups: date, amount spent, gallons, odometer reading
- Auto-calculated: MPG, cost per mile, price per gallon, miles between fillups
- Partial fill support (defers MPG calculation, accumulates gallons/miles until next full fill)
- Receipt photo uploads via S3 presigned URLs
- Optional location tagging (browser geolocation, Leaflet map picker, or manual entry)

**Garage / Multi-Vehicle**
- Unlimited vehicles with make, model, year, photo, specs (trim, color, VIN, license plate, tank size, fuel type)
- Archive/unarchive without losing historical data
- Per-vehicle fillup and maintenance history

**Maintenance Tracking**
- Admin-configurable maintenance schemas (Oil Change, Tire Rotation, etc.) with mileage and time intervals
- Per-vehicle maintenance records with cost, odometer, receipt photos
- Mileage-based (500-mile threshold) and time-based (30-day threshold) reminder calculations
- Custom one-off maintenance entries not tied to a schema
- Per-vehicle interval overrides for global schemas

**Analytics & Reporting**
- MPG over time, monthly spending, cost per mile, cost per gallon trend charts (Recharts)
- Year-over-year comparisons with percentage change indicators
- Shareable summary cards (annual vehicle stats)
- CSV export for fillups and maintenance with date range filtering
- PDF report generation (uploaded to S3 exports bucket, returns presigned download URL)

**Admin Panel**
- User management with admin role assignment
- Maintenance schema CRUD with activate/deactivate
- Platform-wide statistics (total users, vehicles, fillups, maintenance records)
- CloudWatch monitoring dashboard

## Authentication Flow

1. User clicks "Sign in with Google" → `signInWithRedirect({ provider: 'Google' })`
2. Cognito Hosted UI → Google OAuth consent → Cognito exchanges code for tokens
3. Redirect to `{frontendDomain}/callback` with tokens stored by Amplify JS
4. `AuthProvider` fetches user attributes + admin flag from DynamoDB
5. `apiClient` injects ID token into all API requests automatically

Route protection:
- `ProtectedRoute` — redirects unauthenticated users to `/login`
- `AdminRoute` — redirects non-admin users (checks `isAdmin` from AuthProvider)
- Public routes: `/login`, `/callback`, `/privacy`, `/terms`

Sign-out manually constructs Cognito logout URL (workaround for Amplify v6 `logout_uri` vs `redirect_uri` issue).

## API Response Envelope

All API responses follow a consistent format:
- Success: `{ "data": <payload>, "requestId": "<id>" }`
- Error: `{ "error": "<message>", "code": "<ERROR_CODE>", "requestId": "<id>" }`
- Error codes: `VALIDATION_ERROR` (400), `UNAUTHORIZED` (401), `FORBIDDEN` (403), `NOT_FOUND` (404), `CONFLICT` (409), `INTERNAL_ERROR` (500)
