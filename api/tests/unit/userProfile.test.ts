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

// Mock Cognito (account deletion removes the sign-in user)
const mockCognitoSend = vi.fn();
vi.mock('@aws-sdk/client-cognito-identity-provider', () => ({
  CognitoIdentityProviderClient: class FakeCognito { send = mockCognitoSend; },
  ListUsersCommand: class ListUsersCommand { constructor(public input: unknown) {} },
  AdminDeleteUserCommand: class AdminDeleteUserCommand { constructor(public input: unknown) {} },
}));

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
    mockSend.mockReset(); // the delete tests install routing implementations
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
    type Cmd = { constructor: { name: string }; input: Record<string, any> };
    const cognitoCalls: Cmd[] = [];

    /** Answers by command and table, like the real tables would, and records every write */
    function serveAccount(profile: Record<string, unknown> | undefined) {
      const batchDeletes: Record<string, unknown[]> = {};
      mockSend.mockImplementation(async (cmd: Cmd) => {
        const { TableName: table, IndexName: index } = cmd.input;
        switch (cmd.constructor.name) {
          case 'GetCommand': return { Item: profile };
          case 'QueryCommand':
            if (table === 'sharing-test' && index === 'GSI1') return { Items: [{ ownerUserId: 'mom', vehicleEmailKey: 'v9#test@example.com' }] };
            if (table === 'sharing-test') return { Items: [{ ownerUserId: 'user-123', vehicleEmailKey: 'v1#friend@example.com' }] };
            if (table === 'vehicles-test') return { Items: [{ vehicleId: 'v1' }] };
            if (table === 'fillups-test') return { Items: [{ vehicleId: 'v1', fillupDateId: '2024-01-01#f1' }] };
            if (table === 'maintenance-test') return { Items: [{ vehicleId: 'v1', serviceDateId: '2024-02-01#m1' }] };
            return { Items: [] };
          case 'BatchWriteCommand':
            for (const [t, reqs] of Object.entries(cmd.input.RequestItems as Record<string, Array<{ DeleteRequest: { Key: unknown } }>>)) {
              (batchDeletes[t] ??= []).push(...reqs.map((r) => r.DeleteRequest.Key));
            }
            return { UnprocessedItems: {} };
          default: return {};
        }
      });
      mockS3Send.mockImplementation(async (cmd: Cmd) =>
        cmd.constructor.name === 'ListObjectsV2Command' ? { Contents: [{ Key: `${cmd.input.Prefix}x` }], IsTruncated: false } : {});
      mockCognitoSend.mockImplementation(async (cmd: Cmd) => {
        cognitoCalls.push(cmd);
        return cmd.constructor.name === 'ListUsersCommand' ? { Users: [{ Username: 'google_123' }] } : {};
      });
      return batchDeletes;
    }

    beforeEach(() => {
      cognitoCalls.length = 0;
      process.env.SHARING_TABLE = 'sharing-test';
      process.env.EXPORTS_BUCKET = 'exports-test';
      process.env.USER_POOL_ID = 'us-east-1_pool';
    });

    it('deletes vehicles, records, shares both ways, photos, exports, the profile and the Cognito user', async () => {
      const deleted = serveAccount({ userId: 'user-123', email: 'Test@Example.com', displayName: 'Test', isAdmin: false });
      const { statusCode, body } = parseResponse(await handler(makeEvent({ method: 'DELETE' })) as { statusCode: number; body: string });
      expect(statusCode).toBe(200);
      expect(body.data.message).toContain('deleted');

      expect(deleted['sharing-test']).toEqual([
        { ownerUserId: 'user-123', vehicleEmailKey: 'v1#friend@example.com' },
        { ownerUserId: 'mom', vehicleEmailKey: 'v9#test@example.com' },
      ]);
      expect(deleted['fillups-test']).toEqual([{ vehicleId: 'v1', fillupDateId: '2024-01-01#f1' }]);
      expect(deleted['maintenance-test']).toEqual([{ vehicleId: 'v1', serviceDateId: '2024-02-01#m1' }]);
      expect(deleted['vehicles-test']).toEqual([{ userId: 'user-123', vehicleId: 'v1' }]);

      const shareQuery = mockSend.mock.calls.map(([c]) => c as Cmd).find((c) => c.input.IndexName === 'GSI1')!;
      expect(shareQuery.input.ExpressionAttributeValues[':email']).toBe('test@example.com'); // stored lowercased

      const prefixes = mockS3Send.mock.calls.map(([c]) => c as Cmd).filter((c) => c.constructor.name === 'ListObjectsV2Command').map((c) => `${c.input.Bucket}:${c.input.Prefix}`);
      expect(prefixes).toEqual(['photos-test:user-123/', 'exports-test:exports/user-123/']);

      expect(mockSend.mock.calls.map(([c]) => c as Cmd).some((c) => c.constructor.name === 'DeleteCommand' && c.input.TableName === 'users-test')).toBe(true);
      expect(cognitoCalls.map((c) => c.constructor.name)).toEqual(['ListUsersCommand', 'AdminDeleteUserCommand']);
      expect(cognitoCalls[0].input.Filter).toBe('sub = "user-123"');
      expect(cognitoCalls[1].input).toEqual({ UserPoolId: 'us-east-1_pool', Username: 'google_123' });
    });

    it('finishes a retry when the profile is already gone (no 404)', async () => {
      serveAccount(undefined);
      const { statusCode } = parseResponse(await handler(makeEvent({ method: 'DELETE' })) as { statusCode: number; body: string });
      expect(statusCode).toBe(200);
      // The email comes from the token claims, so shares to this user are still found
      expect(mockSend.mock.calls.some(([c]) => (c as Cmd).input.IndexName === 'GSI1')).toBe(true);
      expect(cognitoCalls.map((c) => c.constructor.name)).toContain('AdminDeleteUserCommand');
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

describe('profile auto-create from an access token (#22)', () => {
  const accessEvent = () => {
    const event = makeEvent({ method: 'GET' });
    (event.requestContext as unknown as { authorizer: unknown }).authorizer = {
      jwt: { claims: { sub: 'user-123', token_use: 'access', client_id: 'cli123', scope: 'openid email profile' }, scopes: [] },
    };
    event.headers = { authorization: 'Bearer access-token-value' };
    return event;
  };
  const putItems = () => mockSend.mock.calls.map(([cmd]) => cmd).filter((c) => c.constructor.name === 'PutCommand').map((c) => c.input.Item);

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.AUTH_DOMAIN = 'auth-staging.example.app';
  });

  it('reads email and name from /oauth2/userInfo with the caller\'s token', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(JSON.stringify({ sub: 'user-123', email: 'native@example.com', name: 'Native User' })));
    mockSend.mockResolvedValueOnce({ Item: undefined }).mockResolvedValueOnce({});

    const { statusCode, body } = parseResponse(await handler(accessEvent()) as { statusCode: number; body: string });
    expect(statusCode).toBe(201);
    expect(body.data).toMatchObject({ email: 'native@example.com', displayName: 'Native User' });
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe('https://auth-staging.example.app/oauth2/userInfo');
    expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer access-token-value');
    expect(putItems()[0]).toMatchObject({ email: 'native@example.com' });
    fetchSpy.mockRestore();
  });

  it('refuses to create a profile without an email when userInfo fails', async () => {
    for (const reply of [new Response('{}', { status: 401 }), new Response(JSON.stringify({ sub: 'user-123' }))]) {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(reply);
      mockSend.mockReset();
      mockSend.mockResolvedValueOnce({ Item: undefined });
      const { statusCode } = parseResponse(await handler(accessEvent()) as { statusCode: number; body: string });
      expect(statusCode).toBe(500);
      expect(putItems()).toHaveLength(0);
      fetchSpy.mockRestore();
    }
  });

  it('does not call userInfo for an existing profile', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    mockSend.mockResolvedValueOnce({ Item: { userId: 'user-123', email: 'x@example.com' } });
    expect((await handler(accessEvent()) as { statusCode: number }).statusCode).toBe(200);
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});
