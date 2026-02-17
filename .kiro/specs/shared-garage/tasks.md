# Implementation Plan: Shared Garage

## Overview

Implement vehicle sharing by email address with permission-based access control. The work proceeds bottom-up: types → CDK infrastructure → backend auth helper → sharing CRUD handler → extend existing handlers → frontend API wrapper → frontend components → integration wiring.

## Tasks

- [x] 1. Define shared types and data model
  - [x] 1.1 Create `api/src/types/sharing.ts` with `SharePermission`, `ShareRecord`, and `SharedVehicle` interfaces
    - Export `SharePermission` type union: `'readonly' | 'fuel' | 'maintenance' | 'full'`
    - Export `ShareRecord` interface with all DynamoDB attributes: `shareId`, `ownerUserId`, `sharedEmail`, `vehicleId`, `permission`, `createdAt`, `updatedAt`
    - Export `SharedVehicle` interface for the GET `/v1/vehicles/shared` response shape
    - Re-export from `api/src/types/index.ts`
    - _Requirements: 8.1_

  - [x] 1.2 Create `web/src/types/sharing.ts` mirroring the API types for frontend use
    - Mirror `SharePermission`, `ShareRecord`, `SharedVehicle` types
    - Re-export from `web/src/types/index.ts`
    - _Requirements: 8.1_

- [x] 2. Add Sharing Table to CDK infrastructure
  - [x] 2.1 Add `sharingTable` to `DatabaseStack` in `infra/lib/stacks/database-stack.ts`
    - Table name: `pawsitivemileage-sharing-{env}`
    - PK: `ownerUserId` (String), SK: `vehicleId#sharedEmail` (String, named `vehicleEmailKey`)
    - GSI1: PK = `GSI1PK` (sharedEmail), SK = `GSI1SK` (vehicleId)
    - On-demand billing, PITR enabled, environment-appropriate removal policy
    - Add `CfnOutput` for the table name
    - _Requirements: 8.2, 8.3, 8.4_

  - [x] 2.2 Add `sharingCrud` Lambda to `ApiStack` in `infra/lib/stacks/api-stack.ts`
    - Add `sharingCrud` to the `functionDefs` array
    - Add `SHARING_TABLE` to `sharedEnv` using `databaseStack.sharingTable.tableName`
    - Grant `sharingTable` read/write to `sharingCrud` Lambda
    - Grant `sharingTable` read to `fillupCrud` and `maintenanceCrud` Lambdas (for shared access checks)
    - Grant `usersTable` read to `sharingCrud` Lambda (for email lookup and owner display name)
    - Grant `vehiclesTable` read to `sharingCrud` Lambda (for vehicle data in shared vehicles response)
    - Add `SHARING_TABLE` env var to `fillupCrud` and `maintenanceCrud` Lambdas
    - Add `USERS_TABLE` env var is already shared; confirm `sharingCrud` receives it
    - _Requirements: 8.4_

  - [x] 2.3 Add API Gateway routes for sharing endpoints in `ApiStack`
    - `GET /v1/vehicles/shared` → `sharingCrud`
    - `GET /v1/vehicles/{vehicleId}/sharing` → `sharingCrud`
    - `POST /v1/vehicles/{vehicleId}/sharing` → `sharingCrud`
    - `DELETE /v1/vehicles/{vehicleId}/sharing/{shareId}` → `sharingCrud`
    - All routes use JWT authorizer
    - _Requirements: 1.1, 2.1, 3.1, 4.1_

- [x] 3. Implement backend authorization helper
  - [x] 3.1 Create `api/src/lib/authSharing.ts` with shared access authorization functions
    - `getUserEmail(userId)`: Query Users table by userId, return email (lowercase, trimmed)
    - `getSharedPermission(userEmail, vehicleId)`: Query Sharing table GSI1 with `GSI1PK = userEmail` and `GSI1SK = vehicleId`, return `SharedPermission | null`
    - `isOperationAllowed(permission, operation)`: Pure function implementing the permission matrix — `readonly` allows only `read`; `fuel` allows `read` + `write-fuel`; `maintenance` allows `read` + `write-maintenance`; `full` allows all
    - `verifyAccess(userId, vehicleId, requiredOperation)`: Combined check — first verify ownership via Vehicles table, if not owner then look up email and check shared permission. Return `{ allowed, isOwner }`
    - Use existing `docClient` from `api/src/lib/dynamo.ts` and `SHARING_TABLE`, `USERS_TABLE`, `VEHICLES_TABLE` env vars
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6_

  - [ ]* 3.2 Write property test for `isOperationAllowed` permission matrix
    - **Property 1: Permission matrix correctness**
    - *For any* permission level and operation type, `isOperationAllowed` returns true if and only if the permission matrix allows that operation (readonly → read only; fuel → read + write-fuel; maintenance → read + write-maintenance; full → all)
    - Use fast-check to generate all combinations of permission × operation
    - Test file: `api/tests/unit/authSharing.test.ts`
    - **Validates: Requirements 5.1, 5.2, 5.3, 5.4**

  - [ ]* 3.3 Write property test for `isOperationAllowed` deny behavior
    - **Property 2: Denied operations are forbidden**
    - *For any* permission level and operation type where `isOperationAllowed` returns false, the operation must be one that the permission matrix explicitly denies (e.g., `readonly` denies all writes, `fuel` denies `write-maintenance`)
    - Use fast-check to exhaustively verify the deny side of the matrix
    - Test file: `api/tests/unit/authSharing.test.ts`
    - **Validates: Requirements 5.5, 5.6**

- [x] 4. Checkpoint - Verify infrastructure and auth helper
  - Ensure all tests pass, ask the user if questions arise.
  - Run `cd api && npm test` and `cd infra && npx cdk synth` to verify no compilation errors

- [x] 5. Implement sharing CRUD handler
  - [x] 5.1 Create `api/src/handlers/sharingCrud.ts` — route dispatcher and create/upsert share
    - Export `handler` following the existing pattern (switch on method + path)
    - Implement `POST /v1/vehicles/{vehicleId}/sharing`:
      - Validate request body: `email` (valid format, lowercase, trimmed), `permission` (one of the four values)
      - Reject if email matches owner's own email (call `getUserEmail`) → VALIDATION_ERROR
      - Verify caller owns the vehicle via `verifyVehicleOwnership`→ FORBIDDEN if not
      - Check for existing share (query table with PK=ownerUserId, SK=`vehicleId#email`); if exists, update permission + updatedAt; if not, create new record with ULID shareId
      - Set GSI1PK = sharedEmail, GSI1SK = vehicleId
      - Return created/updated ShareRecord
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6_

  - [x] 5.2 Implement list and delete share operations in `sharingCrud.ts`
    - `GET /v1/vehicles/{vehicleId}/sharing` (owner only):
      - Verify caller owns the vehicle → FORBIDDEN if not
      - Query table with PK=ownerUserId, SK begins_with `vehicleId#`
      - Return array of ShareRecords
    - `DELETE /v1/vehicles/{vehicleId}/sharing/{shareId}`:
      - Verify caller owns the vehicle → FORBIDDEN if not
      - Look up the share by scanning owner's shares for matching shareId → NOT_FOUND if missing
      - Delete the item, return success
    - _Requirements: 2.1, 2.3, 2.4, 3.1, 3.2, 3.3_

  - [x] 5.3 Implement `GET /v1/vehicles/shared` in `sharingCrud.ts` — list vehicles shared with current user
    - Look up caller's email via `getUserEmail(userId)`
    - Query GSI1 with GSI1PK = email (lowercase)
    - For each ShareRecord, batch-get the vehicle from Vehicles table
    - Filter out archived vehicles (where `archivedAt` is set)
    - For each vehicle, look up owner's display name from Users table
    - Return array of `SharedVehicle` objects (vehicle summary + ownerDisplayName + permission + shareId)
    - _Requirements: 4.1, 4.2, 4.3_

  - [ ]* 5.4 Write unit tests for `sharingCrud` handler
    - Test self-share rejection (email matches owner)
    - Test invalid email format rejection
    - Test upsert behavior (existing share gets permission updated, not duplicated)
    - Test NOT_FOUND on deleting nonexistent share
    - Test FORBIDDEN when non-owner tries to list/create/delete shares
    - Test archived vehicles are excluded from shared vehicles list
    - Test file: `api/tests/unit/sharingCrud.test.ts`
    - _Requirements: 1.2, 1.4, 1.5, 2.4, 3.2, 3.3, 4.3_

- [x] 6. Extend existing handlers with shared access
  - [x] 6.1 Update `api/src/handlers/fillupCrud.ts` to support shared vehicle access
    - Import `verifyAccess` from `authSharing.ts`
    - In `listFillups` and `getFillup`: after ownership check fails, call `verifyAccess(userId, vehicleId, 'read')` — allow if shared access grants read
    - In `createFillup` and `updateFillup`: after ownership check fails, call `verifyAccess(userId, vehicleId, 'write-fuel')` — allow if shared access grants fuel write
    - In `deleteFillup`: after ownership check fails, call `verifyAccess(userId, vehicleId, 'write-fuel')` — allow if shared access grants fuel write
    - Preserve existing owner-only behavior when no shared access exists
    - _Requirements: 5.1, 5.2, 5.4, 5.5_

  - [x] 6.2 Update `api/src/handlers/maintenanceCrud.ts` to support shared vehicle access
    - Import `verifyAccess` from `authSharing.ts`
    - In read operations (list, get, reminders): after ownership check fails, call `verifyAccess(userId, vehicleId, 'read')` — allow if shared access grants read
    - In write operations (create, update, delete): after ownership check fails, call `verifyAccess(userId, vehicleId, 'write-maintenance')` — allow if shared access grants maintenance write
    - Preserve existing owner-only behavior when no shared access exists
    - _Requirements: 5.1, 5.3, 5.4, 5.5_

  - [ ]* 6.3 Write property test for shared access enforcement across handlers
    - **Property 3: Shared access permission enforcement**
    - *For any* permission level and operation (read fillups, write fillups, read maintenance, write maintenance), the handler allows the operation if and only if `isOperationAllowed(permission, operation)` returns true
    - Use fast-check to generate random permission × operation combinations and verify handler behavior matches the permission matrix
    - Test file: `api/tests/unit/authSharing.test.ts`
    - **Validates: Requirements 5.1, 5.2, 5.3, 5.4, 5.5**

- [x] 7. Checkpoint - Verify backend is complete
  - Ensure all tests pass, ask the user if questions arise.
  - Run `cd api && npm test` and `cd infra && npx cdk synth`

- [x] 8. Implement frontend API wrapper and hooks
  - [x] 8.1 Create `web/src/api/sharing.ts` with TanStack Query hooks
    - `useSharedVehicles()`: `GET /v1/vehicles/shared`, returns `SharedVehicle[]`
    - `useVehicleShares(vehicleId)`: `GET /v1/vehicles/{vehicleId}/sharing`, returns `ShareRecord[]`
    - `useCreateShare(vehicleId)`: `POST /v1/vehicles/{vehicleId}/sharing`, mutation that invalidates vehicle shares query on success
    - `useDeleteShare(vehicleId)`: `DELETE /v1/vehicles/{vehicleId}/sharing/{shareId}`, mutation that invalidates vehicle shares query on success
    - Follow existing patterns in `web/src/api/vehicles.ts` and `web/src/api/fillups.ts`
    - _Requirements: 1.1, 2.1, 3.1, 4.1_

- [x] 9. Implement frontend components
  - [x] 9.1 Create `web/src/components/SharedGarageSection.tsx`
    - Call `useSharedVehicles()` to fetch shared vehicles
    - Render below the existing vehicle tabs on the Garage page
    - Display each shared vehicle using the existing `VehicleCard` layout with an added permission badge (shadcn Badge) and owner display name
    - Show "No vehicles have been shared with you" message when list is empty
    - On click, navigate to `/vehicles/{vehicleId}` (existing VehicleDetailPage)
    - _Requirements: 6.1, 6.2, 6.3, 6.4_

  - [x] 9.2 Create `web/src/components/SharingManagementDialog.tsx`
    - shadcn Dialog triggered from VehicleDetailPage (owner only)
    - Display table of current shares: email, permission (as Badge), delete button per row
    - Add-share form: email input + permission Select (readonly/fuel/maintenance/full) + Add button
    - Inline permission editing via Select dropdown that calls `useCreateShare` (upsert)
    - Delete button calls `useDeleteShare`
    - Display API errors inline without losing form state
    - Use `useVehicleShares(vehicleId)` for the share list
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5_

- [x] 10. Wire components into existing pages
  - [x] 10.1 Add `SharedGarageSection` to `web/src/pages/GaragePage.tsx`
    - Import and render `SharedGarageSection` below the existing vehicle tabs/grid
    - _Requirements: 6.1_

  - [x] 10.2 Add sharing management button to `web/src/pages/VehicleDetailPage.tsx`
    - Add a "Manage Sharing" button (visible only to vehicle owner)
    - Wire it to open `SharingManagementDialog` with the current vehicleId
    - For shared users: hide vehicle edit, archive, delete, and sharing management controls based on permission from the shared vehicles query
    - _Requirements: 5.6, 7.1_

  - [x] 10.3 Update `web/src/pages/AddFillupPage.tsx` and `web/src/pages/AddMaintenancePage.tsx` for shared access
    - If the user is accessing a shared vehicle, check permission before rendering the form
    - Redirect or show error if the user's permission doesn't allow the write operation
    - _Requirements: 5.1, 5.2, 5.3, 5.4_

- [x] 11. Final checkpoint - Full integration verification
  - Ensure all tests pass, ask the user if questions arise.
  - Run `cd api && npm test`, `cd infra && npx cdk synth`, `cd web && npm run lint`
  - Verify the complete flow: owner creates share → shared user sees vehicle → shared user can read/write per permission → owner revokes share → shared user loses access

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- The `isOperationAllowed` function is a pure function ideal for exhaustive property-based testing with fast-check
- Existing handlers (`fillupCrud`, `maintenanceCrud`) are extended in-place rather than duplicated
- Frontend reuses existing pages (VehicleDetailPage, AddFillupPage, etc.) — no duplicate pages needed
- The `SHARING_TABLE` env var must be added to `fillupCrud` and `maintenanceCrud` Lambdas in CDK for the `authSharing` helper to work from those handlers
