import { describe, it, expect } from 'vitest';
import { photoKeyFilename } from '../../src/lib/photos';

describe('photoKeyFilename', () => {
  it('strips the unique prefix from current keys', () => {
    expect(photoKeyFilename('u1/v1/receipt-photo/01JABCDEFGHJKMNPQRSTVWXYZ0-receipt.pdf')).toBe('receipt.pdf');
  });

  it('returns the filename unchanged for keys written before unique prefixes', () => {
    expect(photoKeyFilename('u1/v1/receipt-photo/receipt.pdf')).toBe('receipt.pdf');
  });

  it('keeps filenames that merely start with a dash-separated word', () => {
    expect(photoKeyFilename('u1/v1/receipt-photo/oil-change.pdf')).toBe('oil-change.pdf');
    expect(photoKeyFilename('u1/v1/vehicle-photo/5c6d7e8f-1234-4abc-9def-0123456789ab-1_all.jpg'))
      .toBe('5c6d7e8f-1234-4abc-9def-0123456789ab-1_all.jpg');
  });
});
