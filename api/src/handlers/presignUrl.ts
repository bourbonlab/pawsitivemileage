import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { ulid } from 'ulid';
import { getUserId } from '../lib/auth.js';
import { success, error } from '../lib/response.js';
import { parseBody, sanitizeFilename } from '../lib/validation.js';
import { validate } from '../lib/contract.js';
import { PresignRequest } from '@pawsitivemileage/contracts';
import { createLogger } from '../lib/logger.js';
import { buildS3Key, getPresignedUploadUrl } from '../lib/s3.js';
import { uploadAllowed, verifyAccess } from '../lib/authSharing.js';

const logger = createLogger('presignUrl');

const PRESIGN_EXPIRATION_SECONDS = 900; // 15 minutes

export const handler = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
  const requestId = event.requestContext?.requestId ?? ulid();
  const userId = getUserId(event as unknown as Parameters<typeof getUserId>[0]);

  if (!userId) {
    return error('UNAUTHORIZED', 'Missing authentication', requestId);
  }

  const method = event.requestContext?.http?.method;

  if (method !== 'POST') {
    return error('VALIDATION_ERROR', 'Unsupported operation', requestId);
  }

  try {

    const body = parseBody(event.body);
    if (!body) {
      return error('VALIDATION_ERROR', 'Invalid or missing request body', requestId);
    }

    // Validate against the API contract (#18): required fields, upload/content types, fileSize
    const valid = validate(PresignRequest, body);
    if (!valid.ok) {
      return error('VALIDATION_ERROR', valid.message, requestId);
    }

    const { uploadType } = valid.data;
    const vehicleId = body.vehicleId as string;
    const filename = body.filename as string;
    const contentType = body.contentType as string;

    // Sanitize filename to prevent path traversal and malformed S3 keys
    const sanitizedFilename = sanitizeFilename(filename);
    if (!sanitizedFilename) {
      return error('VALIDATION_ERROR', 'filename contains no valid characters', requestId);
    }

    const bucket = process.env.PHOTOS_BUCKET;
    if (!bucket) {
      logger.error('PHOTOS_BUCKET environment variable not set', requestId, userId);
      return error('INTERNAL_ERROR', 'An internal error occurred', requestId);
    }

    // Files are stored under the vehicle owner's ID, so a shared user's uploads stay with the
    // owner's data (and are removed with the owner's account, not the uploader's).
    const access = await verifyAccess(userId, vehicleId, 'write-fuel');
    if (!access.ownerUserId || !uploadAllowed(uploadType, access)) {
      return error('FORBIDDEN', 'You do not have permission to upload files for this vehicle', requestId);
    }

    // {ownerUserId}/{vehicleId}/{type}/{ulid}-{filename} — the ULID keeps same-named uploads
    // from overwriting each other.
    const key = buildS3Key(access.ownerUserId, vehicleId, uploadType, ulid(), sanitizedFilename);

    logger.info(`Generating presigned URL for ${uploadType}`, requestId, userId);

    const url = await getPresignedUploadUrl(bucket, key, contentType, PRESIGN_EXPIRATION_SECONDS);

    return success({ url, key, expiresIn: PRESIGN_EXPIRATION_SECONDS }, requestId);
  } catch (err) {
    logger.error('Unhandled error in presignUrl', requestId, userId, err);
    return error('INTERNAL_ERROR', 'An internal error occurred', requestId);
  }
};
