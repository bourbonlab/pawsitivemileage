import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { ulid } from 'ulid';
import { getUserId } from '../lib/auth.js';
import { success, error } from '../lib/response.js';
import { parseBody, validateRequired } from '../lib/validation.js';
import { createLogger } from '../lib/logger.js';
import { buildS3Key, getPresignedUploadUrl } from '../lib/s3.js';

const logger = createLogger('presignUrl');

const ALLOWED_UPLOAD_TYPES = ['vehicle-photo', 'receipt-photo'] as const;
type UploadType = (typeof ALLOWED_UPLOAD_TYPES)[number];

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

    // Validate required fields
    const requiredErrors = validateRequired(body, ['uploadType', 'vehicleId', 'filename', 'contentType']);
    if (requiredErrors.length > 0) {
      return error('VALIDATION_ERROR', requiredErrors.map(e => e.message).join(', '), requestId);
    }

    const uploadType = body.uploadType as string;
    const vehicleId = body.vehicleId as string;
    const filename = body.filename as string;
    const contentType = body.contentType as string;

    // Validate uploadType is one of the allowed values
    if (!ALLOWED_UPLOAD_TYPES.includes(uploadType as UploadType)) {
      return error('VALIDATION_ERROR', `uploadType must be one of: ${ALLOWED_UPLOAD_TYPES.join(', ')}`, requestId);
    }

    const bucket = process.env.PHOTOS_BUCKET;
    if (!bucket) {
      logger.error('PHOTOS_BUCKET environment variable not set', requestId, userId);
      return error('INTERNAL_ERROR', 'An internal error occurred', requestId);
    }

    // Build user-scoped S3 key: {userId}/{vehicleId}/{type}/{filename}
    const key = buildS3Key(userId, vehicleId, uploadType, filename);

    logger.info(`Generating presigned URL for ${uploadType}`, requestId, userId);

    const url = await getPresignedUploadUrl(bucket, key, contentType, PRESIGN_EXPIRATION_SECONDS);

    return success({ url, key, expiresIn: PRESIGN_EXPIRATION_SECONDS }, requestId);
  } catch (err) {
    logger.error('Unhandled error in presignUrl', requestId, userId, err);
    return error('INTERNAL_ERROR', 'An internal error occurred', requestId);
  }
};
