import { describe, it, expect } from 'vitest';
import {
  parseFuelupsCsv,
  parseMaintenanceCsv,
  humanizeSubServiceTypes,
} from '../../src/lib/csv-parser';

describe('parseFuelupsCsv', () => {
  const header = 'fuelup_date,gallons,odometer,price,partial_fuelup,latitude,longitude,notes';

  it('parses a valid fuelup row', () => {
    const csv = `${header}\n2024-08-08,13.5,44800,3.37,0,38.5,-77.3,Shell station`;
    const result = parseFuelupsCsv(csv);

    expect(result.totalRows).toBe(1);
    expect(result.records).toHaveLength(1);
    expect(result.skipped).toHaveLength(0);

    const record = result.records[0];
    expect(record.date).toBe('2024-08-08');
    expect(record.gallonsAdded).toBe(13.5);
    expect(record.odometerReading).toBe(44800);
    expect(record.currencySpent).toBeCloseTo(13.5 * 3.37, 3);
    expect(record.isPartialFill).toBe(false);
    expect(record.locationLat).toBe(38.5);
    expect(record.locationLng).toBe(-77.3);
    expect(record.notes).toBe('Shell station');
  });

  it('parses partial fill flag', () => {
    const csv = `${header}\n2024-08-08,5.0,44800,3.50,1,,,`;
    const result = parseFuelupsCsv(csv);
    expect(result.records[0].isPartialFill).toBe(true);
  });

  it('omits optional fields when empty', () => {
    const csv = `${header}\n2024-08-08,13.5,44800,3.37,0,,,`;
    const record = parseFuelupsCsv(csv).records[0];
    expect(record.locationLat).toBeUndefined();
    expect(record.locationLng).toBeUndefined();
    expect(record.notes).toBeUndefined();
  });

  it('defaults currencySpent to 0 when price is empty', () => {
    const csv = `${header}\n2024-08-08,13.5,44800,,0,,,`;
    const record = parseFuelupsCsv(csv).records[0];
    expect(record.currencySpent).toBe(0);
  });

  it('skips rows with invalid date', () => {
    const csv = `${header}\nbad-date,13.5,44800,3.37,0,,,`;
    const result = parseFuelupsCsv(csv);
    expect(result.records).toHaveLength(0);
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0].reason).toContain('fuelup_date');
  });

  it('skips rows with empty date', () => {
    const csv = `${header}\n,13.5,44800,3.37,0,,,`;
    const result = parseFuelupsCsv(csv);
    expect(result.records).toHaveLength(0);
    expect(result.skipped[0].reason).toContain('fuelup_date');
  });

  it('skips rows with zero gallons', () => {
    const csv = `${header}\n2024-08-08,0,44800,3.37,0,,,`;
    const result = parseFuelupsCsv(csv);
    expect(result.records).toHaveLength(0);
    expect(result.skipped[0].reason).toContain('gallons');
  });

  it('skips rows with empty gallons', () => {
    const csv = `${header}\n2024-08-08,,44800,3.37,0,,,`;
    const result = parseFuelupsCsv(csv);
    expect(result.records).toHaveLength(0);
    expect(result.skipped[0].reason).toContain('gallons');
  });

  it('skips rows with zero odometer', () => {
    const csv = `${header}\n2024-08-08,13.5,0,3.37,0,,,`;
    const result = parseFuelupsCsv(csv);
    expect(result.records).toHaveLength(0);
    expect(result.skipped[0].reason).toContain('odometer');
  });

  it('skips rows with empty odometer', () => {
    const csv = `${header}\n2024-08-08,13.5,,3.37,0,,,`;
    const result = parseFuelupsCsv(csv);
    expect(result.records).toHaveLength(0);
    expect(result.skipped[0].reason).toContain('odometer');
  });

  it('returns empty result for empty CSV', () => {
    const result = parseFuelupsCsv('');
    expect(result.records).toHaveLength(0);
    expect(result.skipped).toHaveLength(0);
    expect(result.totalRows).toBe(0);
  });

  it('returns empty result for header-only CSV', () => {
    const result = parseFuelupsCsv(header);
    expect(result.records).toHaveLength(0);
    expect(result.totalRows).toBe(0);
  });

  it('parses multiple rows with mixed valid and invalid', () => {
    const csv = [
      header,
      '2024-08-08,13.5,44800,3.37,0,,,',
      'bad-date,10.0,45000,3.50,0,,,',
      '2024-08-15,10.0,45000,3.50,0,,,',
    ].join('\n');

    const result = parseFuelupsCsv(csv);
    expect(result.totalRows).toBe(3);
    expect(result.records).toHaveLength(2);
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0].rowNumber).toBe(3); // row 3 in the file (1-indexed, after header)
  });

  it('handles quoted fields with commas', () => {
    const csv = `${header}\n2024-08-08,13.5,44800,3.37,0,,,"Got gas, went home"`;
    const record = parseFuelupsCsv(csv).records[0];
    expect(record.notes).toBe('Got gas, went home');
  });

  it('handles case-insensitive headers', () => {
    const upperHeader = 'Fuelup_Date,Gallons,Odometer,Price,Partial_Fuelup,Latitude,Longitude,Notes';
    const csv = `${upperHeader}\n2024-08-08,13.5,44800,3.37,0,,,`;
    const result = parseFuelupsCsv(csv);
    expect(result.records).toHaveLength(1);
  });
});

describe('parseMaintenanceCsv', () => {
  const header = 'service_date,odometer,price,sub_service_types,notes';

  it('parses a valid maintenance row', () => {
    const csv = `${header}\n2024-08-08,44800,45.99,oil_filter,Changed oil`;
    const result = parseMaintenanceCsv(csv);

    expect(result.totalRows).toBe(1);
    expect(result.records).toHaveLength(1);

    const record = result.records[0];
    expect(record.datePerformed).toBe('2024-08-08');
    expect(record.odometerAtService).toBe(44800);
    expect(record.cost).toBe(45.99);
    expect(record.customTypeName).toBe('Oil Filter');
    expect(record.notes).toBe('Changed oil');
  });

  it('defaults odometer to 0 when empty', () => {
    const csv = `${header}\n2024-08-08,,45.99,oil_filter,`;
    const record = parseMaintenanceCsv(csv).records[0];
    expect(record.odometerAtService).toBe(0);
  });

  it('defaults cost to 0 when empty', () => {
    const csv = `${header}\n2024-08-08,44800,,oil_filter,`;
    const record = parseMaintenanceCsv(csv).records[0];
    expect(record.cost).toBe(0);
  });

  it('skips rows with invalid date', () => {
    const csv = `${header}\nnot-a-date,44800,45.99,oil_filter,`;
    const result = parseMaintenanceCsv(csv);
    expect(result.records).toHaveLength(0);
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0].reason).toContain('service_date');
  });

  it('skips rows with empty date', () => {
    const csv = `${header}\n,44800,45.99,oil_filter,`;
    const result = parseMaintenanceCsv(csv);
    expect(result.records).toHaveLength(0);
  });

  it('returns empty result for empty CSV', () => {
    const result = parseMaintenanceCsv('');
    expect(result.records).toHaveLength(0);
    expect(result.totalRows).toBe(0);
  });

  it('omits notes when empty', () => {
    const csv = `${header}\n2024-08-08,44800,45.99,oil_filter,`;
    const record = parseMaintenanceCsv(csv).records[0];
    expect(record.notes).toBeUndefined();
  });

  it('uses "Other" when sub_service_types is empty', () => {
    const csv = `${header}\n2024-08-08,44800,45.99,,`;
    const record = parseMaintenanceCsv(csv).records[0];
    expect(record.customTypeName).toBe('Other');
  });

  it('parses multiple service types', () => {
    const csv = `${header}\n2024-08-08,44800,45.99,"oil_filter,engine_oil",`;
    const record = parseMaintenanceCsv(csv).records[0];
    expect(record.customTypeName).toBe('Oil Filter, Engine Oil');
  });
});

describe('humanizeSubServiceTypes', () => {
  it('title-cases and replaces underscores', () => {
    expect(humanizeSubServiceTypes('oil_filter')).toBe('Oil Filter');
  });

  it('handles multiple comma-separated types', () => {
    expect(humanizeSubServiceTypes('oil_filter,engine_oil')).toBe('Oil Filter, Engine Oil');
  });

  it('returns "Other" for empty string', () => {
    expect(humanizeSubServiceTypes('')).toBe('Other');
  });

  it('returns "Other" for whitespace-only string', () => {
    expect(humanizeSubServiceTypes('   ')).toBe('Other');
  });

  it('handles single word without underscores', () => {
    expect(humanizeSubServiceTypes('brakes')).toBe('Brakes');
  });

  it('trims whitespace around parts', () => {
    expect(humanizeSubServiceTypes(' oil_filter , engine_oil ')).toBe('Oil Filter, Engine Oil');
  });
});
