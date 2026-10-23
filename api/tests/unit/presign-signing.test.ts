import { describe, it, expect, beforeAll } from 'vitest';

// Real SDK signing with dummy credentials (no network): checks what S3 will enforce on the PUT
beforeAll(() => {
  process.env.AWS_REGION = 'us-east-1';
  process.env.AWS_ACCESS_KEY_ID = 'AKIDEXAMPLE';
  process.env.AWS_SECRET_ACCESS_KEY = 'test-secret';
});

describe('getPresignedUploadUrl', () => {
  it('signs Content-Type and Content-Length, so S3 rejects any other type or size', async () => {
    const { getPresignedUploadUrl } = await import('../../src/lib/s3');
    const url = new URL(await getPresignedUploadUrl('photos', 'u/v/receipt-photo/x-r.png', 'image/png', 2048, 900));

    expect(url.searchParams.get('X-Amz-SignedHeaders')?.split(';')).toEqual(['content-length', 'content-type', 'host']);
    expect(url.searchParams.get('X-Amz-Expires')).toBe('900');
  });

  it('puts no precomputed checksum in the URL (it would be the empty body\'s, and fail the real PUT)', async () => {
    const { getPresignedUploadUrl } = await import('../../src/lib/s3');
    const url = new URL(await getPresignedUploadUrl('photos', 'k', 'text/csv', 10, 60));

    expect([...url.searchParams.keys()].filter((k) => /checksum/i.test(k))).toEqual([]);
  });
});
