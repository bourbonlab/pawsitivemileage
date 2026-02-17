# Requirements Document

## Introduction

The Shared Garage feature allows PawsitiveMileage users to share one or more of their vehicles with other people by email address. Shared users can view or edit fuel and maintenance records based on granted permissions. This enables families and multi-driver households to collaboratively track vehicle data without requiring separate accounts for each vehicle. A new DynamoDB table tracks sharing relationships, and the Garage page displays shared vehicles in a dedicated section below the user's own vehicles.

## Glossary

- **Owner**: The PawsitiveMileage user who owns a vehicle and initiates sharing.
- **Shared_User**: A person identified by email address who has been granted access to one or more of an Owner's vehicles.
- **Share_Record**: A DynamoDB item representing a sharing relationship between an Owner, a Shared_User email, a vehicle, and a permission set.
- **Permission_Set**: The access level granted to a Shared_User for a specific vehicle. One of: `readonly`, `fuel`, `maintenance`, or `full` (fuel and maintenance).
- **Sharing_API**: The set of API endpoints under `/v1/sharing/` that manage Share_Records.
- **Sharing_Table**: The DynamoDB table (`{prefix}-sharing-{env}`) that stores Share_Records.
- **Garage_Page**: The frontend page that displays the user's vehicles and shared vehicles.
- **Shared_Garage_Section**: The section of the Garage_Page that displays vehicles shared with the current user.
- **Sharing_Management_UI**: The frontend interface where an Owner manages sharing for a vehicle.

## Requirements

### Requirement 1: Create a Share

**User Story:** As a vehicle owner, I want to share a vehicle with another person by email address, so that they can view or help track fuel and maintenance data.

#### Acceptance Criteria

1. WHEN an Owner submits a share request with a valid email address, a vehicle ID, and a Permission_Set, THE Sharing_API SHALL create a Share_Record in the Sharing_Table and return the created record.
2. WHEN an Owner submits a share request with an email address that matches the Owner's own email, THE Sharing_API SHALL reject the request with a VALIDATION_ERROR.
3. WHEN an Owner submits a share request for a vehicle the Owner does not own, THE Sharing_API SHALL reject the request with a FORBIDDEN error.
4. WHEN an Owner submits a share request with an invalid email format, THE Sharing_API SHALL reject the request with a VALIDATION_ERROR.
5. WHEN an Owner submits a share request for a vehicle and email combination that already has a Share_Record, THE Sharing_API SHALL update the existing Permission_Set rather than creating a duplicate.
6. THE Sharing_API SHALL NOT verify whether the shared email address belongs to a registered PawsitiveMileage user.

### Requirement 2: List and Manage Shares

**User Story:** As a vehicle owner, I want to see all the people I've shared my vehicles with and their permissions, so that I can manage access.

#### Acceptance Criteria

1. WHEN an Owner requests the list of shares for a vehicle, THE Sharing_API SHALL return all Share_Records for that vehicle including email addresses and Permission_Sets.
2. WHEN an Owner requests the list of all shares across all vehicles, THE Sharing_API SHALL return all Share_Records owned by that user grouped by vehicle.
3. WHEN an Owner updates the Permission_Set on an existing Share_Record, THE Sharing_API SHALL persist the updated Permission_Set and return the updated record.
4. WHEN an Owner requests shares for a vehicle the Owner does not own, THE Sharing_API SHALL reject the request with a FORBIDDEN error.

### Requirement 3: Revoke a Share

**User Story:** As a vehicle owner, I want to remove a person's access to my vehicle at any time, so that I can control who sees my data.

#### Acceptance Criteria

1. WHEN an Owner deletes a Share_Record, THE Sharing_API SHALL remove the Share_Record from the Sharing_Table and return a success response.
2. WHEN an Owner attempts to delete a Share_Record that does not exist, THE Sharing_API SHALL return a NOT_FOUND error.
3. WHEN an Owner attempts to delete a Share_Record for a vehicle the Owner does not own, THE Sharing_API SHALL reject the request with a FORBIDDEN error.

### Requirement 4: View Shared Vehicles

**User Story:** As a shared user, I want to see vehicles that have been shared with me, so that I can view or contribute to their tracking data.

#### Acceptance Criteria

1. WHEN a logged-in user requests shared vehicles, THE Sharing_API SHALL look up Share_Records by the user's email address and return the associated vehicle data with the granted Permission_Set for each vehicle.
2. WHEN a user has no vehicles shared with them, THE Sharing_API SHALL return an empty list.
3. WHEN a Share_Record exists but the associated vehicle has been deleted or archived, THE Sharing_API SHALL exclude that vehicle from the shared vehicles response.

### Requirement 5: Shared Vehicle Access Enforcement

**User Story:** As a system operator, I want shared access permissions to be enforced on all data operations, so that shared users can only perform actions allowed by their Permission_Set.

#### Acceptance Criteria

1. WHEN a Shared_User with `readonly` permission accesses a shared vehicle, THE Sharing_API SHALL allow read operations on fillup and maintenance data and deny all write operations.
2. WHEN a Shared_User with `fuel` permission accesses a shared vehicle, THE Sharing_API SHALL allow read operations on all data and allow write operations only on fillup data.
3. WHEN a Shared_User with `maintenance` permission accesses a shared vehicle, THE Sharing_API SHALL allow read operations on all data and allow write operations only on maintenance data.
4. WHEN a Shared_User with `full` permission accesses a shared vehicle, THE Sharing_API SHALL allow read operations on all data and allow write operations on both fillup and maintenance data.
5. WHEN a Shared_User attempts an operation not permitted by the Permission_Set, THE Sharing_API SHALL reject the request with a FORBIDDEN error.
6. WHEN a Shared_User accesses a shared vehicle, THE Sharing_API SHALL deny vehicle edit, archive, delete, and sharing management operations regardless of Permission_Set.

### Requirement 6: Shared Garage Display

**User Story:** As a user, I want to see shared vehicles in a separate section on my Garage page, so that I can distinguish my own vehicles from shared ones.

#### Acceptance Criteria

1. WHEN the Garage_Page loads, THE Garage_Page SHALL display the Shared_Garage_Section below the user's own vehicle tabs.
2. WHEN shared vehicles exist, THE Shared_Garage_Section SHALL display each shared vehicle with the owner's display name and the granted Permission_Set.
3. WHEN no shared vehicles exist, THE Shared_Garage_Section SHALL display a message indicating no vehicles have been shared with the user.
4. WHEN a user clicks a shared vehicle, THE Garage_Page SHALL navigate to the vehicle detail page with access restricted by the Permission_Set.

### Requirement 7: Sharing Management UI

**User Story:** As a vehicle owner, I want a dedicated interface to manage sharing for my vehicles, so that I can add, update, and remove shared access easily.

#### Acceptance Criteria

1. WHEN an Owner opens the Sharing_Management_UI for a vehicle, THE Sharing_Management_UI SHALL display a table of all current Share_Records with email addresses and Permission_Sets.
2. WHEN an Owner adds a new share via the Sharing_Management_UI, THE Sharing_Management_UI SHALL send a create request to the Sharing_API and update the displayed list on success.
3. WHEN an Owner changes a Permission_Set via the Sharing_Management_UI, THE Sharing_Management_UI SHALL send an update request to the Sharing_API and reflect the change on success.
4. WHEN an Owner removes a share via the Sharing_Management_UI, THE Sharing_Management_UI SHALL send a delete request to the Sharing_API and remove the entry from the displayed list on success.
5. WHEN the Sharing_API returns an error, THE Sharing_Management_UI SHALL display the error message to the Owner without losing form state.

### Requirement 8: Sharing Data Model

**User Story:** As a developer, I want a well-defined data model for sharing records, so that sharing relationships can be queried efficiently by both owner and shared user.

#### Acceptance Criteria

1. THE Sharing_Table SHALL store each Share_Record with the following attributes: shareId (ULID), ownerUserId, sharedEmail, vehicleId, permission, createdAt, and updatedAt.
2. THE Sharing_Table SHALL use ownerUserId as the partition key and a composite of vehicleId and sharedEmail as the sort key, enabling efficient queries for all shares by a given owner.
3. THE Sharing_Table SHALL have a GSI (GSI1) with sharedEmail as the partition key, enabling efficient queries for all vehicles shared with a given email address.
4. THE Sharing_Table SHALL follow the existing project conventions for table naming (`{prefix}-sharing-{env}`), on-demand billing, and PITR.
