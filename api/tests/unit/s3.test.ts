import { describe, it, expect } from 'vitest';
import { buildS3Key } from '../../src/lib/s3';

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
