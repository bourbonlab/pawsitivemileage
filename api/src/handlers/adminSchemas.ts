import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { GetCommand, PutCommand, ScanCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { ulid } from 'ulid';
import { getDocClient, getTableName } from '../lib/dynamo.js';
import { getUserId } from '../lib/auth.js';
import { success, error } from '../lib/response.js';
import { parseBody, validateRequired, validateTypes } from '../lib/validation.js';
import { createLogger } from '../lib/logger.js';
import type { MaintenanceSchema } from '../types/schema.js';

const logger = createLogger('adminSchemas');

export const handler = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
  const requestId = event.requestContext?.requestId ?? ulid();
  const userId = getUserId(event as unknown as Parameters<typeof getUserId>[0]);

  if (!userId) {
    return error('UNAUTHORIZED', 'Missing authentication', requestId);
  }

  try {
    // Verify admin flag for all requests
    const isAdmin = await checkIsAdmin(userId);
    if (!isAdmin) {
      logger.warn('Non-admin user attempted admin schemas access', requestId, userId);
      return error('FORBIDDEN', 'Admin access required', requestId);
    }

    const method = event.requestContext?.http?.method;
    const schemaId = event.pathParameters?.schemaId;
    const path = event.rawPath ?? '';
    const isActiveRoute = path.endsWith('/active');

    // GET /v1/admin/schemas — list schemas
    if (method === 'GET' && !schemaId) {
      return await listSchemas(requestId, userId);
    }

    // POST /v1/admin/schemas — create schema
    if (method === 'POST' && !schemaId) {
      return await createSchema(event, requestId, userId);
    }

    // PUT /v1/admin/schemas/{schemaId} — update schema
    if (method === 'PUT' && schemaId && !isActiveRoute) {
      return await updateSchema(event, schemaId, requestId, userId);
    }

    // PATCH /v1/admin/schemas/{schemaId}/active — activate/deactivate
    if (method === 'PATCH' && schemaId && isActiveRoute) {
      return await toggleActive(event, schemaId, requestId, userId);
    }

    return error('VALIDATION_ERROR', 'Unsupported operation', requestId);
  } catch (err) {
    logger.error('Unhandled error in adminSchemas', requestId, userId, err);
    return error('INTERNAL_ERROR', 'An internal error occurred', requestId);
  }
};


/**
 * Check if the user has the isAdmin flag set in the Users table.
 */
async function checkIsAdmin(userId: string): Promise<boolean> {
  const tableName = getTableName('USERS_TABLE');
  const docClient = getDocClient();

  const result = await docClient.send(
    new GetCommand({
      TableName: tableName,
      Key: { userId },
      ProjectionExpression: 'isAdmin',
    }),
  );

  return result.Item?.isAdmin === true;
}

/**
 * GET /v1/admin/schemas
 * List all maintenance schemas. Admins see all; scan is fine for a small table.
 */
async function listSchemas(
  requestId: string,
  userId: string,
): Promise<APIGatewayProxyResultV2> {
  const tableName = getTableName('SCHEMAS_TABLE');
  const docClient = getDocClient();

  const result = await docClient.send(
    new ScanCommand({ TableName: tableName }),
  );

  const schemas = (result.Items ?? []) as MaintenanceSchema[];

  logger.info(`Listed ${schemas.length} schemas`, requestId, userId);
  return success(schemas, requestId);
}

/**
 * POST /v1/admin/schemas
 * Create a new maintenance schema. Required: name, description, category.
 */
async function createSchema(
  event: APIGatewayProxyEventV2,
  requestId: string,
  userId: string,
): Promise<APIGatewayProxyResultV2> {
  const body = parseBody(event.body);
  if (!body) {
    return error('VALIDATION_ERROR', 'Invalid or missing request body', requestId);
  }

  const requiredErrors = validateRequired(body, ['name', 'description', 'category']);
  if (requiredErrors.length > 0) {
    return error('VALIDATION_ERROR', requiredErrors.map((e) => e.message).join(', '), requestId);
  }

  const typeErrors = validateTypes(body, {
    name: 'string',
    description: 'string',
    category: 'string',
  });
  if (typeErrors.length > 0) {
    return error('VALIDATION_ERROR', typeErrors.map((e) => e.message).join(', '), requestId);
  }

  // Validate optional numeric fields
  if (body.defaultMileageInterval !== undefined && body.defaultMileageInterval !== null) {
    if (typeof body.defaultMileageInterval !== 'number' || body.defaultMileageInterval <= 0) {
      return error('VALIDATION_ERROR', 'defaultMileageInterval must be a positive number', requestId);
    }
  }
  if (body.defaultTimeIntervalDays !== undefined && body.defaultTimeIntervalDays !== null) {
    if (typeof body.defaultTimeIntervalDays !== 'number' || body.defaultTimeIntervalDays <= 0) {
      return error('VALIDATION_ERROR', 'defaultTimeIntervalDays must be a positive number', requestId);
    }
  }

  const now = new Date().toISOString();
  const schemaId = ulid();

  const schema: MaintenanceSchema = {
    schemaId,
    name: body.name as string,
    description: body.description as string,
    defaultMileageInterval: (body.defaultMileageInterval as number) ?? null,
    defaultTimeIntervalDays: (body.defaultTimeIntervalDays as number) ?? null,
    category: body.category as string,
    isActive: true,
    createdAt: now,
    updatedAt: now,
  };

  const tableName = getTableName('SCHEMAS_TABLE');
  const docClient = getDocClient();

  await docClient.send(
    new PutCommand({
      TableName: tableName,
      Item: schema,
    }),
  );

  logger.info(`Created schema ${schemaId}: ${schema.name}`, requestId, userId);
  return success(schema, requestId, 201);
}

/**
 * PUT /v1/admin/schemas/{schemaId}
 * Update schema fields: name, description, defaultMileageInterval, defaultTimeIntervalDays, category.
 */
async function updateSchema(
  event: APIGatewayProxyEventV2,
  schemaId: string,
  requestId: string,
  userId: string,
): Promise<APIGatewayProxyResultV2> {
  const body = parseBody(event.body);
  if (!body) {
    return error('VALIDATION_ERROR', 'Invalid or missing request body', requestId);
  }

  const tableName = getTableName('SCHEMAS_TABLE');
  const docClient = getDocClient();

  // Verify schema exists
  const existing = await docClient.send(
    new GetCommand({
      TableName: tableName,
      Key: { schemaId },
    }),
  );

  if (!existing.Item) {
    return error('NOT_FOUND', 'Schema not found', requestId);
  }

  // Validate types for provided fields
  const typeErrors = validateTypes(body, {
    name: 'string',
    description: 'string',
    category: 'string',
  });
  if (typeErrors.length > 0) {
    return error('VALIDATION_ERROR', typeErrors.map((e) => e.message).join(', '), requestId);
  }

  // Validate optional numeric fields
  if (body.defaultMileageInterval !== undefined && body.defaultMileageInterval !== null) {
    if (typeof body.defaultMileageInterval !== 'number' || body.defaultMileageInterval <= 0) {
      return error('VALIDATION_ERROR', 'defaultMileageInterval must be a positive number', requestId);
    }
  }
  if (body.defaultTimeIntervalDays !== undefined && body.defaultTimeIntervalDays !== null) {
    if (typeof body.defaultTimeIntervalDays !== 'number' || body.defaultTimeIntervalDays <= 0) {
      return error('VALIDATION_ERROR', 'defaultTimeIntervalDays must be a positive number', requestId);
    }
  }

  // Build update expression from allowed fields
  const allowedFields = ['name', 'description', 'defaultMileageInterval', 'defaultTimeIntervalDays', 'category'];

  const updates: string[] = [];
  const expressionNames: Record<string, string> = {};
  const expressionValues: Record<string, unknown> = {};

  for (const field of allowedFields) {
    if (body[field] !== undefined) {
      updates.push(`#${field} = :${field}`);
      expressionNames[`#${field}`] = field;
      expressionValues[`:${field}`] = body[field];
    }
  }

  if (updates.length === 0) {
    return error('VALIDATION_ERROR', 'No valid fields to update', requestId);
  }

  const now = new Date().toISOString();
  updates.push('#updatedAt = :updatedAt');
  expressionNames['#updatedAt'] = 'updatedAt';
  expressionValues[':updatedAt'] = now;

  const result = await docClient.send(
    new UpdateCommand({
      TableName: tableName,
      Key: { schemaId },
      UpdateExpression: `SET ${updates.join(', ')}`,
      ExpressionAttributeNames: expressionNames,
      ExpressionAttributeValues: expressionValues,
      ReturnValues: 'ALL_NEW',
    }),
  );

  logger.info(`Updated schema ${schemaId}`, requestId, userId);
  return success(result.Attributes as MaintenanceSchema, requestId);
}

/**
 * PATCH /v1/admin/schemas/{schemaId}/active
 * Activate or deactivate a schema. Body: { "isActive": true/false }
 */
async function toggleActive(
  event: APIGatewayProxyEventV2,
  schemaId: string,
  requestId: string,
  userId: string,
): Promise<APIGatewayProxyResultV2> {
  const body = parseBody(event.body);
  if (!body || typeof body.isActive !== 'boolean') {
    return error('VALIDATION_ERROR', 'Request body must contain isActive (boolean)', requestId);
  }

  const tableName = getTableName('SCHEMAS_TABLE');
  const docClient = getDocClient();

  // Verify schema exists
  const existing = await docClient.send(
    new GetCommand({
      TableName: tableName,
      Key: { schemaId },
    }),
  );

  if (!existing.Item) {
    return error('NOT_FOUND', 'Schema not found', requestId);
  }

  const now = new Date().toISOString();

  const result = await docClient.send(
    new UpdateCommand({
      TableName: tableName,
      Key: { schemaId },
      UpdateExpression: 'SET #isActive = :isActive, #updatedAt = :updatedAt',
      ExpressionAttributeNames: {
        '#isActive': 'isActive',
        '#updatedAt': 'updatedAt',
      },
      ExpressionAttributeValues: {
        ':isActive': body.isActive,
        ':updatedAt': now,
      },
      ReturnValues: 'ALL_NEW',
    }),
  );

  const action = body.isActive ? 'Activated' : 'Deactivated';
  logger.info(`${action} schema ${schemaId}`, requestId, userId);
  return success(result.Attributes as MaintenanceSchema, requestId);
}
