import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

let s3Client: S3Client | null = null;

function getS3Client(): S3Client {
  if (!s3Client) {
    s3Client = new S3Client({});
  }
  return s3Client;
}

/**
 * Build a user-scoped S3 object key.
 * Format: {userId}/{vehicleId}/{type}/{filename}
 */
export function buildS3Key(userId: string, vehicleId: string, type: string, filename: string): string {
  return `${userId}/${vehicleId}/${type}/${filename}`;
}

/**
 * True when the key is a CSV import the given user uploaded for this vehicle,
 * i.e. `{userId}/{vehicleId}/csv-import/{filename}` as built by buildS3Key.
 */
export function isOwnCsvImportKey(key: string, userId: string, vehicleId: string): boolean {
  const prefix = buildS3Key(userId, vehicleId, 'csv-import', '');
  const filename = key.slice(prefix.length);
  return key.startsWith(prefix) && filename.length > 0 && !filename.includes('/') && !key.includes('..');
}

/**
 * Generate a presigned PUT URL for uploading an object to S3.
 */
export async function getPresignedUploadUrl(
  bucket: string,
  key: string,
  contentType: string,
  expiresInSeconds = 300,
): Promise<string> {
  const command = new PutObjectCommand({ Bucket: bucket, Key: key, ContentType: contentType });
  return getSignedUrl(getS3Client(), command, { expiresIn: expiresInSeconds });
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
