import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
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
