import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

let s3Client: S3Client | null = null;

function getS3Client(): S3Client {
  if (!s3Client) {
    // No automatic CRC32 checksums: newer SDKs would put an empty body's checksum into presigned
    // PUT URLs, which S3 then rejects for the real file. Lambda uses the runtime's SDK version,
    // so this keeps uploads independent of it.
    s3Client = new S3Client({ requestChecksumCalculation: 'WHEN_REQUIRED' });
  }
  return s3Client;
}

/**
 * Build a user-scoped S3 object key.
 * Format: {userId}/{vehicleId}/{type}/{uniqueId}-{filename}
 *
 * The unique ID (a ULID) keeps two uploads with the same filename — e.g. two
 * receipts named `receipt.pdf` on the same vehicle — from overwriting each other.
 * Keys written before it was added (`{type}/{filename}`) remain valid: records
 * store the full key, and nothing parses keys back into parts on read.
 */
export function buildS3Key(userId: string, vehicleId: string, type: string, uniqueId: string, filename: string): string {
  return `${userId}/${vehicleId}/${type}/${uniqueId}-${filename}`;
}

/**
 * True when the key sits directly under `{userId}/{vehicleId}/{type}/` (as built by
 * buildS3Key, or the older un-prefixed form) — no nested paths or traversal.
 * `userId` is the vehicle owner: presignUrl stores every upload under the owner's ID.
 *
 * Pass `vehicleId: null` when the vehicle doesn't exist yet (vehicle create),
 * which accepts any single vehicle segment under the user ID.
 */
export function isOwnUploadKey(key: string, userId: string, vehicleId: string | null, type: string): boolean {
  if (key.includes('..')) return false;
  const parts = key.split('/');
  if (parts.length !== 4) return false;
  const [owner, vehicle, keyType, filename] = parts;
  return owner === userId
    && (vehicleId === null ? vehicle.length > 0 : vehicle === vehicleId)
    && keyType === type
    && filename.length > 0;
}

/** True when the key is a CSV import uploaded for this vehicle (stored under its owner's ID). */
export function isOwnCsvImportKey(key: string, ownerUserId: string, vehicleId: string): boolean {
  return isOwnUploadKey(key, ownerUserId, vehicleId, 'csv-import');
}

/**
 * Validate a photo key submitted on a create/update. Unchanged keys are always
 * accepted — edit forms send the current key back, and it may predate unique keys
 * or have been stored under a shared user's ID before uploads moved to the owner.
 * A new key must be under the vehicle owner's upload prefix for this vehicle, so a
 * record can't point at (and later delete) another user's object.
 */
export function isAcceptablePhotoKey(
  key: string,
  existingKey: string | undefined,
  ownerUserId: string,
  vehicleId: string | null,
  type: 'vehicle-photo' | 'receipt-photo',
): boolean {
  return key === existingKey || isOwnUploadKey(key, ownerUserId, vehicleId, type);
}

/**
 * Validation error for a photo-key request field, or null when it's acceptable.
 * Absent and `null` (meaning "remove the photo") always pass.
 */
export function photoKeyFieldError(
  field: string,
  value: unknown,
  existingKey: string | undefined,
  ownerUserId: string,
  vehicleId: string | null,
  type: 'vehicle-photo' | 'receipt-photo',
): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value === 'string' && isAcceptablePhotoKey(value, existingKey, ownerUserId, vehicleId, type)) return null;
  return `${field} must be a key returned by /v1/upload/presign for this vehicle`;
}

/**
 * Generate a presigned PUT URL for uploading an object to S3.
 *
 * Content-Type and Content-Length are signed, so S3 refuses (403) a PUT with any other type or
 * size. Unsigned, a client could store e.g. text/html (served from the app's own origin at
 * /photos/…) or a file far over the size limit.
 */
export async function getPresignedUploadUrl(
  bucket: string,
  key: string,
  contentType: string,
  contentLength: number,
  expiresInSeconds = 300,
): Promise<string> {
  const command = new PutObjectCommand({ Bucket: bucket, Key: key, ContentType: contentType, ContentLength: contentLength });
  return getSignedUrl(getS3Client(), command, {
    expiresIn: expiresInSeconds,
    signableHeaders: new Set(['content-type', 'content-length']),
  });
}

/**
 * Upload an object (string or Buffer) directly to S3.
 */
export async function uploadObject(
  bucket: string,
  key: string,
  body: string | Buffer,
  contentType: string,
): Promise<void> {
  const command = new PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ContentType: contentType });
  await getS3Client().send(command);
}

/**
 * Generate a presigned GET URL for downloading an object from S3.
 */
export async function getPresignedDownloadUrl(
  bucket: string,
  key: string,
  expiresInSeconds = 3600,
): Promise<string> {
  const command = new GetObjectCommand({ Bucket: bucket, Key: key });
  return getSignedUrl(getS3Client(), command, { expiresIn: expiresInSeconds });
}

/**
 * Delete an object from S3.
 */
export async function deleteObject(bucket: string, key: string): Promise<void> {
  const command = new DeleteObjectCommand({ Bucket: bucket, Key: key });
  await getS3Client().send(command);
}
