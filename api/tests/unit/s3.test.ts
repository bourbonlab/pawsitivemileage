import { describe, it, expect } from 'vitest';
import { buildS3Key, isOwnCsvImportKey } from '../../src/lib/s3';

describe('buildS3Key', () => {
  it('builds a correctly formatted key', () => {
    expect(buildS3Key('user-1', 'vehicle-1', 'photo', 'receipt.jpg'))
      .toBe('user-1/vehicle-1/photo/receipt.jpg');
  });

  it('preserves special characters in filename', () => {
    expect(buildS3Key('u1', 'v1', 'receipt', 'my file (1).pdf'))
      .toBe('u1/v1/receipt/my file (1).pdf');
  });

  it('handles empty type segment', () => {
    expect(buildS3Key('u1', 'v1', '', 'file.jpg'))
      .toBe('u1/v1//file.jpg');
  });
});

describe('isOwnCsvImportKey', () => {
  it('accepts a csv-import key for the same user and vehicle', () => {
    expect(isOwnCsvImportKey('u1/v1/csv-import/fuelly.csv', 'u1', 'v1')).toBe(true);
  });

  it('rejects a key belonging to another user', () => {
    expect(isOwnCsvImportKey('u2/v1/csv-import/fuelly.csv', 'u1', 'v1')).toBe(false);
  });

  it('rejects a key for another vehicle', () => {
    expect(isOwnCsvImportKey('u1/v2/csv-import/fuelly.csv', 'u1', 'v1')).toBe(false);
  });

  it('rejects non-csv-import upload types', () => {
    expect(isOwnCsvImportKey('u1/v1/receipt-photo/receipt.jpg', 'u1', 'v1')).toBe(false);
  });

  it('rejects a bare prefix with no filename', () => {
    expect(isOwnCsvImportKey('u1/v1/csv-import/', 'u1', 'v1')).toBe(false);
  });

  it('rejects nested paths and traversal', () => {
    expect(isOwnCsvImportKey('u1/v1/csv-import/a/b.csv', 'u1', 'v1')).toBe(false);
    expect(isOwnCsvImportKey('u1/v1/csv-import/../../u2/v9/csv-import/x.csv', 'u1', 'v1')).toBe(false);
  });

  it('rejects a user id that is only a prefix of the key owner', () => {
    expect(isOwnCsvImportKey('u10/v1/csv-import/fuelly.csv', 'u1', 'v1')).toBe(false);
  });
});
