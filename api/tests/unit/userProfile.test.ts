import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { APIGatewayProxyEventV2 } from 'aws-lambda';

// Mock DynamoDB
const mockSend = vi.fn();
vi.mock('@aws-sdk/client-dynamodb', () => {
  return {
    DynamoDBClient: class FakeDynamoDBClient {},
  };
});
vi.mock('@aws-sdk/lib-dynamodb', () => {
  return {
    DynamoDBDocumentClient: {
      from: () => ({ send: mockSend }),
    },
    GetCommand: class GetCommand { constructor(public input: unknown) {} },
    PutCommand: class PutCommand { constructor(public input: unknown) {} },
    DeleteCommand: class DeleteCommand { constructor(public input: unknown) {} },
    QueryCommand: class QueryCommand { constructor(public input: unknown) {} },
    BatchWriteCommand: class BatchWriteCommand { constructor(public input: unknown) {} },
  };
});

// Mock S3
const mockS3Send = vi.fn();
vi.mock('@aws-sdk/client-s3', () => {
  return {
    S3Client: class FakeS3Client {
      send = mockS3Send;
    },
    ListObjectsV2Command: class ListObjectsV2Command { constructor(public input: unknown) {} },
    DeleteObjectsCommand: class DeleteObjectsCommand { constructor(public input: unknown) {} },
  };
});

// Set env vars before importing handler
process.env.USERS_TABLE = 'users-test';
process.env.VEHICLES_TABLE = 'vehicles-test';
process.env.FILLUPS_TABLE = 'fillups-test';
process.env.MAINTENANCE_TABLE = 'maintenance-test';
process.env.PHOTOS_BUCKET = 'photos-test';

import { handler } from '../../src/handlers/userProfile';

function makeEvent(overrides: Partial<APIGatewayProxyEventV2> & { method: string }): APIGatewayProxyEventV2 {
  const { method, ...rest } = overrides;
  return {
    version: '2.0',
    routeKey: `${method} /v1/user/profile`,
    rawPath: '/v1/user/profile',
    rawQueryString: '',
    headers: {},
    isBase64Encoded: false,
    requestContext: {
      accountId: '123',
      apiId: 'api',
      domainName: 'api.example.com',
      domainPrefix: 'api',
      http: { method, path: '/v1/user/profile', protocol: 'HTTP/1.1', sourceIp: '127.0.0.1', userAgent: 'test' },
      requestId: 'test-request-id',
      routeKey: `${method} /v1/user/profile`,
      stage: '$default',
      time: '01/Jan/2024:00:00:00 +0000',
      timeEpoch: 1704067200000,
      authorizer: {
        jwt: {
          claims: { sub: 'user-123', email: 'test@example.com', name: 'Test User' },
          scopes: [],
        },
      },
    },
    ...rest,
  } as unknown as APIGatewayProxyEventV2;
}

function parseResponse(result: { statusCode: number; body: string }) {
  return { statusCode: result.statusCode, body: JSON.parse(result.body) };
}

describe('userProfile handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockS3Send.mockReset();
  });

  describe('authentication', () => {
    it('returns 401 when userId is missing from JWT', async () => {
      const event = makeEvent({ method: 'GET' });
      // Remove the authorizer claims
      (event.requestContext as Record<string, unknown>).authorizer = {};

      const result = await handler(event);
      const { statusCode, body } = parseResponse(result as { statusCode: number; body: string });

      expect(statusCode).toBe(401);
      expect(body.code).toBe('UNAUTHORIZED');
    });
  });

  describe('unsupported method', () => {
    it('returns 400 for unsupported HTTP methods', async () => {
      const event = makeEvent({ method: 'POST' });

      const result = await handler(event);
      const { statusCode, body } = parseResponse(result as { statusCode: number; body: string });

      expect(statusCode).toBe(400);
      expect(body.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('GET /v1/user/profile', () => {
    it('returns existing profile when found', async () => {
      const existingUser = {
        userId: 'user-123',
        email: 'test@example.com',
        displayName: 'Test User',
        isAdmin: false,
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
      };

      mockSend.mockResolvedValueOnce({ Item: existingUser });

      const event = makeEvent({ method: 'GET' });
      const result = await handler(event);
      const { statusCode, body } = parseResponse(result as { statusCode: number; body: string });

      expect(statusCode).toBe(200);
      expect(body.data).toEqual(existingUser);
    });

    it('auto-creates profile from JWT claims when not found (Req 1.3, Property 26)', async () => {
      // GetCommand returns no item
      mockSend.mockResolvedValueOnce({ Item: undefined });
      // PutCommand succeeds
      mockSend.mockResolvedValueOnce({});

      const event = makeEvent({ method: 'GET' });
      const result = await handler(event);
      const { statusCode, body } = parseResponse(result as { statusCode: number; body: string });

      expect(statusCode).toBe(201);
      expect(body.data.userId).toBe('user-123');
      expect(body.data.email).toBe('test@example.com');
      expect(body.data.displayName).toBe('Test User');
      expect(body.data.isAdmin).toBe(false);
      expect(body.data.createdAt).toBeDefined();
      expect(body.data.updatedAt).toBeDefined();
    });

    it('uses email as displayName fallback when name claim is missing', async () => {
      mockSend.mockResolvedValueOnce({ Item: undefined });
      mockSend.mockResolvedValueOnce({});

      const event = makeEvent({ method: 'GET' });
      // Remove the name claim
      const claims = (event.requestContext as any).authorizer.jwt.claims;
      delete claims.name;

      const result = await handler(event);
      const { statusCode, body } = parseResponse(result as { statusCode: number; body: string });

      expect(statusCode).toBe(201);
      expect(body.data.displayName).toBe('test@example.com');
    });
  });

  describe('PUT /v1/user/profile', () => {
    it('updates displayName successfully', async () => {
      const existingUser = {
        userId: 'user-123',
        email: 'test@example.com',
        displayName: 'Old Name',
        isAdmin: false,
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
      };

      // GetCommand returns existing user
      mockSend.mockResolvedValueOnce({ Item: existingUser });
      // PutCommand succeeds
      mockSend.mockResolvedValueOnce({});

      const event = makeEvent({
        method: 'PUT',
        body: JSON.stringify({ displayName: 'New Name' }),
      });

      const result = await handler(event);
      const { statusCode, body } = parseResponse(result as { statusCode: number; body: string });

      expect(statusCode).toBe(200);
      expect(body.data.displayName).toBe('New Name');
      expect(body.data.email).toBe('test@example.com');
      expect(body.data.isAdmin).toBe(false);
    });

    it('returns 400 when body is missing', async () => {
      const event = makeEvent({ method: 'PUT' });

      const result = await handler(event);
      const { statusCode, body } = parseResponse(result as { statusCode: number; body: string });

      expect(statusCode).toBe(400);
      expect(body.code).toBe('VALIDATION_ERROR');
    });

    it('returns 400 when displayName is empty', async () => {
      const event = makeEvent({
        method: 'PUT',
        body: JSON.stringify({ displayName: '  ' }),
      });

      const result = await handler(event);
      const { statusCode, body } = parseResponse(result as { statusCode: number; body: string });

      expect(statusCode).toBe(400);
      expect(body.code).toBe('VALIDATION_ERROR');
    });

    it('returns 400 when displayName is not a string', async () => {
      const event = makeEvent({
        method: 'PUT',
        body: JSON.stringify({ displayName: 123 }),
      });

      const result = await handler(event);
      const { statusCode, body } = parseResponse(result as { statusCode: number; body: string });

      expect(statusCode).toBe(400);
    });

    it('returns 404 when user profile does not exist', async () => {
      mockSend.mockResolvedValueOnce({ Item: undefined });

      const event = makeEvent({
        method: 'PUT',
        body: JSON.stringify({ displayName: 'New Name' }),
      });

      const result = await handler(event);
      const { statusCode, body } = parseResponse(result as { statusCode: number; body: string });

      expect(statusCode).toBe(404);
      expect(body.code).toBe('NOT_FOUND');
    });
  });

  describe('DELETE /v1/user/profile', () => {
    it('returns 404 when user profile does not exist', async () => {
      mockSend.mockResolvedValueOnce({ Item: undefined });

      const event = makeEvent({ method: 'DELETE' });
      const result = await handler(event);
      const { statusCode, body } = parseResponse(result as { statusCode: number; body: string });

      expect(statusCode).toBe(404);
      expect(body.code).toBe('NOT_FOUND');
    });

    it('deletes user with no vehicles (Req 11.1)', async () => {
      // GetCommand: user exists
      mockSend.mockResolvedValueOnce({
        Item: { userId: 'user-123', email: 'test@example.com', displayName: 'Test', isAdmin: false },
      });
      // QueryCommand: no vehicles
      mockSend.mockResolvedValueOnce({ Items: [] });
      // S3 ListObjectsV2: no objects
      mockS3Send.mockResolvedValueOnce({ Contents: [], IsTruncated: false });
      // DeleteCommand: delete user profile
      mockSend.mockResolvedValueOnce({});

      const event = makeEvent({ method: 'DELETE' });
      const result = await handler(event);
      const { statusCode, body } = parseResponse(result as { statusCode: number; body: string });

      expect(statusCode).toBe(200);
      expect(body.data.message).toContain('deleted');
    });

    it('cascades deletion across vehicles, fillups, maintenance, and S3 (Req 11.1, 11.3, Property 25)', async () => {
      // GetCommand: user exists
      mockSend.mockResolvedValueOnce({
        Item: { userId: 'user-123', email: 'test@example.com', displayName: 'Test', isAdmin: false },
      });
      // QueryCommand: 2 vehicles
      mockSend.mockResolvedValueOnce({ Items: [{ vehicleId: 'v1' }, { vehicleId: 'v2' }] });

      // For vehicle v1: query fillups (1 fillup)
      mockSend.mockResolvedValueOnce({
        Items: [{ vehicleId: 'v1', fillupDateId: '2024-01-01#f1' }],
      });
      // BatchWrite for v1 fillups
      mockSend.mockResolvedValueOnce({ UnprocessedItems: {} });
      // For vehicle v1: query maintenance (empty)
      mockSend.mockResolvedValueOnce({ Items: [] });

      // For vehicle v2: query fillups (empty)
      mockSend.mockResolvedValueOnce({ Items: [] });
      // For vehicle v2: query maintenance (1 record)
      mockSend.mockResolvedValueOnce({
        Items: [{ vehicleId: 'v2', serviceDateId: '2024-02-01#m1' }],
      });
      // BatchWrite for v2 maintenance
      mockSend.mockResolvedValueOnce({ UnprocessedItems: {} });

      // BatchWrite for vehicles
      mockSend.mockResolvedValueOnce({ UnprocessedItems: {} });

      // S3 ListObjectsV2: some objects
      mockS3Send.mockResolvedValueOnce({
        Contents: [{ Key: 'user-123/v1/photo/img.jpg' }],
        IsTruncated: false,
      });
      // S3 DeleteObjects
      mockS3Send.mockResolvedValueOnce({});

      // DeleteCommand: delete user profile
      mockSend.mockResolvedValueOnce({});

      const event = makeEvent({ method: 'DELETE' });
      const result = await handler(event);
      const { statusCode, body } = parseResponse(result as { statusCode: number; body: string });

      expect(statusCode).toBe(200);
      expect(body.data.message).toContain('deleted');

      // Verify DynamoDB calls were made (Get + Query vehicles + queries/deletes for each vehicle + batch vehicles + delete user)
      expect(mockSend).toHaveBeenCalled();
      // Verify S3 calls were made
      expect(mockS3Send).toHaveBeenCalled();
    });
  });

  describe('error handling', () => {
    it('returns 500 on unhandled errors (Property 24)', async () => {
      mockSend.mockRejectedValueOnce(new Error('DynamoDB connection failed'));

      const event = makeEvent({ method: 'GET' });
      const result = await handler(event);
      const { statusCode, body } = parseResponse(result as { statusCode: number; body: string });

      expect(statusCode).toBe(500);
      expect(body.code).toBe('INTERNAL_ERROR');
      expect(body.error).toBe('An internal error occurred');
    });
  });
});
