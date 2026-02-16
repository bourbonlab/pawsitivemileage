// CSV Parser for Fuelly export files
// Pure functions — no side effects, no DynamoDB calls

export interface ParsedFuelup {
  date: string;
  currencySpent: number;
  gallonsAdded: number;
  odometerReading: number;
  isPartialFill: boolean;
  locationLat?: number;
  locationLng?: number;
  notes?: string;
}

export interface ParsedMaintenance {
  datePerformed: string;
  odometerAtService: number;
  cost: number;
  customTypeName: string;
  notes?: string;
}

export interface SkippedRow {
  rowNumber: number;
  reason: string;
}

export interface ParseResult<T> {
  records: T[];
  skipped: SkippedRow[];
  totalRows: number;
}

/**
 * Parse a CSV string into rows of field arrays, handling quoted fields
 * and commas within quotes.
 */
function parseCsvRows(csvContent: string): string[][] {
  const rows: string[][] = [];
  const lines = csvContent.split('\n');

  let currentRow: string[] = [];
  let currentField = '';
  let inQuotes = false;

  for (const line of lines) {
    for (let i = 0; i < line.length; i++) {
      const char = line[i];

      if (inQuotes) {
        if (char === '"') {
          // Check for escaped quote ("")
          if (i + 1 < line.length && line[i + 1] === '"') {
            currentField += '"';
            i++; // skip next quote
          } else {
            inQuotes = false;
          }
        } else {
          currentField += char;
        }
      } else {
        if (char === '"') {
          inQuotes = true;
        } else if (char === ',') {
          currentRow.push(currentField.trim());
          currentField = '';
        } else {
          currentField += char;
        }
      }
    }

    if (inQuotes) {
      // Field spans multiple lines — add newline and continue
      currentField += '\n';
    } else {
      currentRow.push(currentField.trim());
      currentField = '';
      // Only add non-empty rows (skip blank lines)
      if (currentRow.length > 1 || (currentRow.length === 1 && currentRow[0] !== '')) {
        rows.push(currentRow);
      }
      currentRow = [];
    }
  }

  // Handle any remaining content
  if (currentRow.length > 0 || currentField !== '') {
    currentRow.push(currentField.trim());
    if (currentRow.length > 1 || (currentRow.length === 1 && currentRow[0] !== '')) {
      rows.push(currentRow);
    }
  }

  return rows;
}

/**
 * Build a column-name → index map from the header row.
 * Trims whitespace and lowercases column names for resilient matching.
 */
function buildColumnMap(headerRow: string[]): Map<string, number> {
  const map = new Map<string, number>();
  for (let i = 0; i < headerRow.length; i++) {
    map.set(headerRow[i].toLowerCase().trim(), i);
  }
  return map;
}

/**
 * Get a field value from a row by column name, returning empty string if missing.
 */
function getField(row: string[], columnMap: Map<string, number>, columnName: string): string {
  const index = columnMap.get(columnName.toLowerCase());
  if (index === undefined || index >= row.length) return '';
  return row[index].trim();
}

/**
 * Check if a date string is a valid ISO 8601 date (YYYY-MM-DD).
 */
function isValidDate(dateStr: string): boolean {
  if (!dateStr) return false;
  const match = /^\d{4}-\d{2}-\d{2}$/.exec(dateStr);
  if (!match) return false;
  const d = new Date(dateStr + 'T00:00:00Z');
  return !isNaN(d.getTime());
}

/**
 * Parse a Fuelly fuelups CSV export into PawsitiveMileage fillup records.
 *
 * Skips rows with:
 * - Empty or zero gallons
 * - Empty or invalid fuelup_date
 * - Empty or zero odometer
 */
export function parseFuelupsCsv(csvContent: string): ParseResult<ParsedFuelup> {
  const rows = parseCsvRows(csvContent);

  if (rows.length === 0) {
    return { records: [], skipped: [], totalRows: 0 };
  }

  const headerRow = rows[0];
  const columnMap = buildColumnMap(headerRow);
  const dataRows = rows.slice(1);
  const totalRows = dataRows.length;

  const records: ParsedFuelup[] = [];
  const skipped: SkippedRow[] = [];

  for (let i = 0; i < dataRows.length; i++) {
    const row = dataRows[i];
    const rowNumber = i + 2; // 1-indexed, +1 for header

    // Parse and validate required fields
    const dateStr = getField(row, columnMap, 'fuelup_date');
    if (!isValidDate(dateStr)) {
      skipped.push({ rowNumber, reason: 'Empty or invalid fuelup_date' });
      continue;
    }

    const gallonsStr = getField(row, columnMap, 'gallons');
    const gallons = parseFloat(gallonsStr);
    if (!gallonsStr || isNaN(gallons) || gallons === 0) {
      skipped.push({ rowNumber, reason: 'Empty or zero gallons' });
      continue;
    }

    const odometerStr = getField(row, columnMap, 'odometer');
    const odometer = parseFloat(odometerStr);
    if (!odometerStr || isNaN(odometer) || odometer === 0) {
      skipped.push({ rowNumber, reason: 'Empty or zero odometer' });
      continue;
    }

    // Calculate currency spent: gallons * price
    const priceStr = getField(row, columnMap, 'price');
    const price = parseFloat(priceStr);
    const currencySpent = !isNaN(price) ? gallons * price : 0;

    // Parse partial fill flag
    const partialStr = getField(row, columnMap, 'partial_fuelup');
    const isPartialFill = partialStr === '1';

    // Build the record
    const record: ParsedFuelup = {
      date: dateStr,
      currencySpent: Math.round(currencySpent * 1000) / 1000,
      gallonsAdded: gallons,
      odometerReading: odometer,
      isPartialFill,
    };

    // Optional fields — only include when non-empty
    const latStr = getField(row, columnMap, 'latitude');
    const lat = parseFloat(latStr);
    if (latStr && !isNaN(lat)) {
      record.locationLat = lat;
    }

    const lngStr = getField(row, columnMap, 'longitude');
    const lng = parseFloat(lngStr);
    if (lngStr && !isNaN(lng)) {
      record.locationLng = lng;
    }

    const notes = getField(row, columnMap, 'notes');
    if (notes) {
      record.notes = notes;
    }

    records.push(record);
  }

  return { records, skipped, totalRows };
}


/**
 * Humanize a Fuelly sub_service_types string.
 * Replaces underscores with spaces and title-cases each word.
 * Multiple types separated by commas are each humanized and joined with ", ".
 * Returns "Other" if the input is empty.
 *
 * Example: "oil_filter,engine_oil" → "Oil Filter, Engine Oil"
 */
export function humanizeSubServiceTypes(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return 'Other';

  return trimmed
    .split(',')
    .map((part) =>
      part
        .trim()
        .replace(/_/g, ' ')
        .replace(/\b\w/g, (c) => c.toUpperCase()),
    )
    .join(', ');
}

/**
 * Parse a Fuelly maintenance CSV export into PawsitiveMileage maintenance records.
 *
 * Skips rows with empty or invalid service_date.
 * Defaults odometer to 0 and price to 0 when empty.
 */
export function parseMaintenanceCsv(csvContent: string): ParseResult<ParsedMaintenance> {
  const rows = parseCsvRows(csvContent);

  if (rows.length === 0) {
    return { records: [], skipped: [], totalRows: 0 };
  }

  const headerRow = rows[0];
  const columnMap = buildColumnMap(headerRow);
  const dataRows = rows.slice(1);
  const totalRows = dataRows.length;

  const records: ParsedMaintenance[] = [];
  const skipped: SkippedRow[] = [];

  for (let i = 0; i < dataRows.length; i++) {
    const row = dataRows[i];
    const rowNumber = i + 2; // 1-indexed, +1 for header

    // Validate service_date
    const dateStr = getField(row, columnMap, 'service_date');
    if (!isValidDate(dateStr)) {
      skipped.push({ rowNumber, reason: 'Empty or invalid service_date' });
      continue;
    }

    // Odometer — default to 0 if empty
    const odometerStr = getField(row, columnMap, 'odometer');
    const odometer = parseFloat(odometerStr);
    const odometerAtService = !odometerStr || isNaN(odometer) ? 0 : odometer;

    // Price — default to 0 if empty
    const priceStr = getField(row, columnMap, 'price');
    const price = parseFloat(priceStr);
    const cost = !priceStr || isNaN(price) ? 0 : price;

    // Derive customTypeName from sub_service_types
    const subServiceTypes = getField(row, columnMap, 'sub_service_types');
    const customTypeName = humanizeSubServiceTypes(subServiceTypes);

    const record: ParsedMaintenance = {
      datePerformed: dateStr,
      odometerAtService,
      cost,
      customTypeName,
    };

    // Optional notes — only include when non-empty
    const notes = getField(row, columnMap, 'notes');
    if (notes) {
      record.notes = notes;
    }

    records.push(record);
  }

  return { records, skipped, totalRows };
}
