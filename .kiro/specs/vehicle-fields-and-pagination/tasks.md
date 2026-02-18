# Implementation Plan: Vehicle Fields and Pagination

## Overview

Frontend-only changes across two features: (1) surface existing VIN and license plate fields in vehicle dialogs and cards, and (2) add client-side pagination to fillup and maintenance list components via a shared `usePagination` hook and `PaginationControls` component.

## Tasks

- [x] 1. Add VIN and license plate fields to vehicle dialogs
  - [x] 1.1 Add VIN and license plate inputs to AddVehicleDialog in `web/src/pages/GaragePage.tsx`
    - Add optional `<Input>` fields for VIN (maxLength 17, placeholder "e.g. 1HGBH41JXMN109186") and license plate (maxLength 20, placeholder "e.g. ABC-1234")
    - Include `vin` and `licensePlate` in the `createVehicle.mutateAsync()` payload
    - _Requirements: 1.1, 1.3, 1.5_
  - [x] 1.2 Add VIN and license plate inputs to EditVehicleDialog in `web/src/pages/VehicleDetailPage.tsx`
    - Add optional `<Input>` fields for VIN (maxLength 17) and license plate (maxLength 20)
    - Pre-populate with `vehicle.vin` and `vehicle.licensePlate` defaultValues
    - Include `vin` and `licensePlate` in the `updateVehicle.mutate()` payload
    - _Requirements: 1.2, 1.4, 1.6_

- [x] 2. Display VIN and license plate on vehicle cards
  - [x] 2.1 Update VehicleCard in `web/src/components/VehicleCard.tsx`
    - Below the year/make/model `<p>`, conditionally render VIN and license plate in muted small text
    - Only show each field if it has a value; show nothing extra if both are absent
    - _Requirements: 2.1, 2.2, 2.3_
  - [x] 2.2 Update Vehicle Header Card in `web/src/pages/VehicleDetailPage.tsx`
    - Below the year/make/model `<p>` in the header card section, conditionally render VIN and license plate
    - Use muted text styling consistent with existing vehicle info
    - _Requirements: 3.1, 3.2, 3.3_

- [x] 3. Checkpoint — VIN and license plate feature
  - Ensure all VIN/license plate changes work correctly, ask the user if questions arise.

- [x] 4. Implement pagination hook and controls
  - [x] 4.1 Create `usePagination` hook in `web/src/lib/use-pagination.ts`
    - Implement the hook per the design interface: accepts items array and optional defaultPageSize (default 10)
    - Returns pageItems, currentPage, totalPages, pageSize, setPage, setPageSize, resetPage
    - Clamp currentPage to valid bounds when items or pageSize change
    - Memoize pageItems slice
    - _Requirements: 4.1, 4.3, 4.5, 4.6, 4.7, 4.8, 5.1, 5.3, 5.5, 5.6, 5.7, 5.8_
  - [ ]* 4.2 Write property tests for usePagination hook in `web/tests/unit/use-pagination.test.ts`
    - **Property 1: Page slice size is bounded by page size**
    - **Validates: Requirements 4.1, 5.1**
    - **Property 2: Changing page size resets to first page**
    - **Validates: Requirements 4.3, 4.7, 5.3, 5.7**
    - **Property 3: All items are partitioned across pages without loss or duplication**
    - **Validates: Requirements 4.1, 4.3, 5.1, 5.3**
    - **Property 4: Single page when items fit within page size**
    - **Validates: Requirements 4.8, 5.8**
    - **Property 5: Current page is always within valid bounds**
    - **Validates: Requirements 4.5, 4.6, 5.5, 5.6**
  - [x] 4.3 Create `PaginationControls` component in `web/src/components/PaginationControls.tsx`
    - Render page size Select (options: 10, 20, 50, 100), "Page X of Y" text, prev/next Buttons
    - Disable prev on page 1, disable next on last page
    - Hide entirely when totalPages <= 1
    - Use shadcn/ui Select and Button components
    - _Requirements: 4.4, 4.5, 4.6, 4.8, 5.4, 5.5, 5.6, 5.8_

- [x] 5. Integrate pagination into list components
  - [x] 5.1 Add pagination to FillupList in `web/src/components/FillupList.tsx`
    - Import and use `usePagination` hook on the sorted array
    - Render only `pageItems` in the table body instead of `sorted`
    - Call `resetPage()` when sort field or direction changes
    - Add `PaginationControls` below the table
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 4.8_
  - [x] 5.2 Add pagination to MaintenanceList in `web/src/components/MaintenanceList.tsx`
    - Same integration as FillupList: usePagination on sorted array, render pageItems, resetPage on sort change, PaginationControls below table
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 5.8_

- [x] 6. Final checkpoint — All features complete
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- No backend changes needed — VIN and license plate are already supported in the API
- The `usePagination` hook is the core testable unit; property tests target it directly
- Pagination is client-side since per-vehicle record counts are typically < 1,000
