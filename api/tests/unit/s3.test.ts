import { describe, it, expect } from 'vitest';
import { buildS3Key, isAcceptablePhotoKey, isOwnCsvImportKey, isOwnUploadKey, photoKeyFieldError } from '../../src/lib/s3';

const ID = '01JABCDEFGHJKMNPQRSTVWXYZ0';

describe('buildS3Key', () => {
  it('builds a correctly formatted key with a unique prefix on the filename', () => {
    expect(buildS3Key('user-1', 'vehicle-1', 'receipt-photo', ID, 'receipt.jpg'))
      .toBe(`user-1/vehicle-1/receipt-photo/${ID}-receipt.jpg`);
  });

  it('preserves special characters in filename', () => {
    expect(buildS3Key('u1', 'v1', 'receipt-photo', ID, 'my file (1).pdf'))
      .toBe(`u1/v1/receipt-photo/${ID}-my file (1).pdf`);
  });

  it('gives same-named uploads different keys', () => {
    expect(buildS3Key('u1', 'v1', 'receipt-photo', '01JAAAAAAAAAAAAAAAAAAAAAAA', 'receipt.pdf'))
      .not.toBe(buildS3Key('u1', 'v1', 'receipt-photo', '01JBBBBBBBBBBBBBBBBBBBBBBB', 'receipt.pdf'));
  });
});

describe('isOwnCsvImportKey', () => {
  it('accepts a csv-import key for the same user and vehicle', () => {
    expect(isOwnCsvImportKey(`u1/v1/csv-import/${ID}-fuelly.csv`, 'u1', 'v1')).toBe(true);
  });

  it('accepts a csv-import key in the older un-prefixed form', () => {
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

describe('isOwnUploadKey', () => {
  it('accepts any single vehicle segment when vehicleId is null (vehicle create)', () => {
    expect(isOwnUploadKey(`u1/v9/vehicle-photo/${ID}-car.jpg`, 'u1', null, 'vehicle-photo')).toBe(true);
    expect(isOwnUploadKey(`u1//vehicle-photo/${ID}-car.jpg`, 'u1', null, 'vehicle-photo')).toBe(false);
    expect(isOwnUploadKey(`u2/v9/vehicle-photo/${ID}-car.jpg`, 'u1', null, 'vehicle-photo')).toBe(false);
  });
});

describe('isAcceptablePhotoKey', () => {
  // Before uploads moved under the owner, a shared user's receipt was stored under their own ID
  const legacyShareeKey = 'sharee/v1/receipt-photo/receipt.pdf';

  it('accepts an unchanged key even if it predates unique keys or sits under a shared user', () => {
    // Edit forms send the current key back; editing such a record must not be rejected
    expect(isAcceptablePhotoKey(legacyShareeKey, legacyShareeKey, 'owner', 'v1', 'receipt-photo')).toBe(true);
  });

  it("accepts a new key under the vehicle owner's upload prefix for this vehicle", () => {
    expect(isAcceptablePhotoKey(`owner/v1/receipt-photo/${ID}-r.pdf`, legacyShareeKey, 'owner', 'v1', 'receipt-photo')).toBe(true);
  });

  it("rejects a new key under anyone but the vehicle owner, including the uploader's own prefix", () => {
    expect(isAcceptablePhotoKey(`sharee/v1/receipt-photo/${ID}-r.pdf`, undefined, 'owner', 'v1', 'receipt-photo')).toBe(false);
    expect(isAcceptablePhotoKey('victim/v7/receipt-photo/private.pdf', undefined, 'owner', 'v1', 'receipt-photo')).toBe(false);
  });

  it('rejects a key of the wrong upload type', () => {
    expect(isAcceptablePhotoKey(`u1/v1/csv-import/${ID}-x.csv`, undefined, 'u1', 'v1', 'receipt-photo')).toBe(false);
  });
});

describe('photoKeyFieldError', () => {
  it('passes absent and null (remove) values', () => {
    expect(photoKeyFieldError('receiptPhotoKey', undefined, undefined, 'u1', 'v1', 'receipt-photo')).toBeNull();
    expect(photoKeyFieldError('receiptPhotoKey', null, 'u1/v1/receipt-photo/r.pdf', 'u1', 'v1', 'receipt-photo')).toBeNull();
  });

  it('rejects non-string values and foreign keys with a field-specific message', () => {
    expect(photoKeyFieldError('receiptPhotoKey', 42, undefined, 'u1', 'v1', 'receipt-photo')).toMatch(/^receiptPhotoKey must be/);
    expect(photoKeyFieldError('photoKey', 'u2/v1/vehicle-photo/x.jpg', undefined, 'u1', 'v1', 'vehicle-photo')).toMatch(/^photoKey must be/);
  });
});
