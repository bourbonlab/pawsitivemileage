# Requirements Document

## Introduction

This specification covers two related enhancements to the PawsitiveMileage application: (1) surfacing VIN and license plate fields in the vehicle UI for quick reference during service calls and parts lookups, and (2) adding client-side pagination to the fillup and maintenance record lists to improve usability on vehicles with many records.

## Glossary

- **Garage_Page**: The page listing all of a user's vehicles as cards (`/garage`)
- **Vehicle_Detail_Page**: The page showing a single vehicle's info, fillups, and maintenance (`/vehicles/{vehicleId}`)
- **Vehicle_Card**: A clickable card on the Garage_Page representing a single vehicle
- **Vehicle_Header_Card**: The card at the top of the Vehicle_Detail_Page showing vehicle photo, name, year/make/model
- **Add_Vehicle_Dialog**: The dialog for creating a new vehicle from the Garage_Page
- **Edit_Vehicle_Dialog**: The dialog for editing vehicle details from the Vehicle_Detail_Page
- **Fillup_List**: The table component displaying fillup records for a vehicle
- **Maintenance_List**: The table component displaying maintenance records for a vehicle
- **Page_Size_Selector**: A dropdown control allowing the user to choose how many records to display per page
- **Pagination_Controls**: Navigation controls (previous/next, page indicators) for moving between pages of records

## Requirements

### Requirement 1: VIN and License Plate in Add/Edit Vehicle Dialogs

**User Story:** As a vehicle owner, I want to enter VIN and license plate when adding or editing a vehicle, so that I have this information readily available for service calls and parts ordering.

#### Acceptance Criteria

1. WHEN a user opens the Add_Vehicle_Dialog, THE Add_Vehicle_Dialog SHALL display optional input fields for VIN and license plate
2. WHEN a user opens the Edit_Vehicle_Dialog, THE Edit_Vehicle_Dialog SHALL display input fields for VIN and license plate pre-populated with existing values
3. WHEN a user submits the Add_Vehicle_Dialog with VIN and license plate values, THE Add_Vehicle_Dialog SHALL include those values in the vehicle creation request
4. WHEN a user submits the Edit_Vehicle_Dialog with updated VIN or license plate values, THE Edit_Vehicle_Dialog SHALL include those values in the vehicle update request
5. IF a user provides a VIN longer than 17 characters, THEN THE Add_Vehicle_Dialog SHALL prevent submission and display a validation message
6. IF a user provides a license plate longer than 20 characters, THEN THE Edit_Vehicle_Dialog SHALL prevent submission and display a validation message

### Requirement 2: VIN and License Plate Display on Vehicle Cards

**User Story:** As a vehicle owner, I want to see VIN and license plate on my vehicle cards, so that I can quickly reference this information without opening the vehicle detail page.

#### Acceptance Criteria

1. WHEN a vehicle has a VIN value, THE Vehicle_Card SHALL display the VIN below the year/make/model line
2. WHEN a vehicle has a license plate value, THE Vehicle_Card SHALL display the license plate below the year/make/model line
3. WHEN a vehicle has neither VIN nor license plate, THE Vehicle_Card SHALL display without additional lines and maintain its current layout

### Requirement 3: VIN and License Plate Display on Vehicle Detail Header

**User Story:** As a vehicle owner, I want to see VIN and license plate on the vehicle detail page header, so that I can reference this information while viewing fillups and maintenance records.

#### Acceptance Criteria

1. WHEN a vehicle has a VIN value, THE Vehicle_Header_Card SHALL display the VIN in the vehicle information area
2. WHEN a vehicle has a license plate value, THE Vehicle_Header_Card SHALL display the license plate in the vehicle information area
3. WHEN a vehicle has neither VIN nor license plate, THE Vehicle_Header_Card SHALL display without additional fields and maintain its current layout

### Requirement 4: Fillup List Pagination

**User Story:** As a vehicle owner, I want to paginate through my fillup records, so that I can navigate long lists without excessive scrolling on both web and mobile.

#### Acceptance Criteria

1. THE Fillup_List SHALL display a default of 10 records per page
2. THE Fillup_List SHALL provide a Page_Size_Selector with options of 10, 20, 50, and 100 records per page
3. WHEN the user changes the Page_Size_Selector value, THE Fillup_List SHALL update the displayed records to match the selected page size and reset to the first page
4. THE Fillup_List SHALL display Pagination_Controls below the table showing current page, total pages, and previous/next navigation buttons
5. WHEN the user is on the first page, THE Fillup_List SHALL disable the previous page button
6. WHEN the user is on the last page, THE Fillup_List SHALL disable the next page button
7. WHEN the user changes the sort order, THE Fillup_List SHALL reset to the first page and apply pagination to the newly sorted data
8. WHEN a vehicle has fewer records than the selected page size, THE Fillup_List SHALL display all records on a single page without Pagination_Controls

### Requirement 5: Maintenance List Pagination

**User Story:** As a vehicle owner, I want to paginate through my maintenance records, so that I can navigate long lists without excessive scrolling on both web and mobile.

#### Acceptance Criteria

1. THE Maintenance_List SHALL display a default of 10 records per page
2. THE Maintenance_List SHALL provide a Page_Size_Selector with options of 10, 20, 50, and 100 records per page
3. WHEN the user changes the Page_Size_Selector value, THE Maintenance_List SHALL update the displayed records to match the selected page size and reset to the first page
4. THE Maintenance_List SHALL display Pagination_Controls below the table showing current page, total pages, and previous/next navigation buttons
5. WHEN the user is on the first page, THE Maintenance_List SHALL disable the previous page button
6. WHEN the user is on the last page, THE Maintenance_List SHALL disable the next page button
7. WHEN the user changes the sort order, THE Maintenance_List SHALL reset to the first page and apply pagination to the newly sorted data
8. WHEN a vehicle has fewer records than the selected page size, THE Maintenance_List SHALL display all records on a single page without Pagination_Controls
