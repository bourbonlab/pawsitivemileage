import { describe, it, expect } from 'vitest';
import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import { Meta } from '@pawsitivemileage/contracts';
import { buildMeta, handler } from '../../src/handlers/meta';

const env = (extra: Record<string, string> = {}) => ({ FRONTEND_DOMAIN: 'staging.example.app', ...extra });

describe('buildMeta', () => {
  it('reports configured minimum versions and features, and policy links on the frontend', () => {
    const meta = buildMeta(env({ MIN_CLIENT_VERSIONS: '{"android":"1.2.0","cli":"0.3.0"}', FEATURE_FLAGS: '{"offlineEntry":true}' }), new Date('2026-10-21T12:00:00Z'));
    expect(meta).toEqual({
      apiVersion: 'v1',
      minimumVersions: { android: '1.2.0', cli: '0.3.0' },
      features: { offlineEntry: true },
      links: {
        privacyPolicy: 'https://staging.example.app/privacy',
        terms: 'https://staging.example.app/terms',
        accountDeletion: 'https://staging.example.app/delete-account',
      },
      serverTime: '2026-10-21T12:00:00.000Z',
    });
    expect(Meta.safeParse(meta).success).toBe(true);
  });

  it('includes native sign-in configuration when the environment provides it (#22)', () => {
    const auth = {
      issuer: 'https://cognito-idp.us-east-1.amazonaws.com/us-east-1_abc',
      domain: 'auth-staging.example.app',
      scopes: ['openid', 'email', 'profile'],
      clients: { cli: { clientId: 'cli123', redirectUri: 'http://localhost:47815/callback', logoutUri: 'http://localhost:47815/signout' } },
    };
    const meta = buildMeta(env({ AUTH_CONFIG: JSON.stringify(auth) }));
    expect(meta.auth).toEqual(auth);
    expect(Meta.safeParse(meta).success).toBe(true);
    expect(buildMeta(env())).not.toHaveProperty('auth');
  });

  it('falls back to defaults when the configuration is missing or malformed', () => {
    for (const config of [env(), env({ MIN_CLIENT_VERSIONS: 'not json', FEATURE_FLAGS: '[1,2]' })]) {
      const meta = buildMeta(config);
      expect(meta.minimumVersions).toEqual({ android: '1.0.0', ios: '1.0.0', cli: '0.1.0' });
      expect(meta.features).toEqual({});
    }
  });
});

describe('handler', () => {
  const event = (method: string) => ({ requestContext: { requestId: 'r', http: { method } } }) as unknown as APIGatewayProxyEventV2;

  it('answers GET without authentication', async () => {
    process.env.FRONTEND_DOMAIN = 'staging.example.app';
    const res = await handler(event('GET')) as { statusCode: number; body: string };
    expect(res.statusCode).toBe(200);
    expect(Meta.safeParse(JSON.parse(res.body).data).success).toBe(true);
  });

  it('rejects other methods', async () => {
    expect((await handler(event('POST')) as { statusCode: number }).statusCode).toBe(400);
  });
});
