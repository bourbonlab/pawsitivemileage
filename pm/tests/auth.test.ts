import { describe, it, expect, vi } from 'vitest';
import { authorizeUrl, AuthError, codeChallenge, exchangeCode, listenForCallback, pkcePair, refreshTokens } from '../src/auth.js';

const auth = {
  issuer: 'https://cognito-idp.us-east-1.amazonaws.com/us-east-1_abc',
  domain: 'auth-staging.example.app',
  scopes: ['openid', 'email', 'profile'],
  clients: { cli: { clientId: 'cli123', redirectUri: 'http://localhost:47915/callback', logoutUri: 'http://localhost:47915/signout' } },
};
const client = auth.clients.cli;
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

describe('PKCE', () => {
  it('matches the RFC 7636 S256 example', () => {
    expect(codeChallenge('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
  });

  it('makes a fresh 43-character verifier each time', () => {
    const a = pkcePair();
    expect(a.verifier).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(a.challenge).toBe(codeChallenge(a.verifier));
    expect(pkcePair().verifier).not.toBe(a.verifier);
  });

  it('builds the Hosted UI authorize URL for the code flow straight to Google', () => {
    const url = new URL(authorizeUrl(auth, client, { state: 's1', challenge: 'c1' }));
    expect(url.origin + url.pathname).toBe('https://auth-staging.example.app/oauth2/authorize');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      response_type: 'code', client_id: 'cli123', redirect_uri: 'http://localhost:47915/callback', scope: 'openid email profile',
      state: 's1', code_challenge: 'c1', code_challenge_method: 'S256', identity_provider: 'Google',
    });
  });
});

describe('token endpoint', () => {
  it('exchanges the code with the verifier and records the expiry', async () => {
    const fetchMock = vi.fn(async () => json({ access_token: 'a1', id_token: 'i1', refresh_token: 'r1', expires_in: 3600 }));
    const tokens = await exchangeCode(auth, client, 'code1', 'verifier1', fetchMock as never, 1_000);
    expect(tokens).toEqual({ accessToken: 'a1', idToken: 'i1', refreshToken: 'r1', expiresAt: 1_000 + 3_600_000 });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://auth-staging.example.app/oauth2/token');
    expect(Object.fromEntries(new URLSearchParams(init.body as string))).toEqual({
      grant_type: 'authorization_code', client_id: 'cli123', code: 'code1', redirect_uri: 'http://localhost:47915/callback', code_verifier: 'verifier1',
    });
  });

  it('keeps the refresh token when Cognito does not rotate it', async () => {
    const fetchMock = vi.fn(async () => json({ access_token: 'a2', expires_in: 60 }));
    const tokens = await refreshTokens(auth, client, { accessToken: 'a1', refreshToken: 'r1', expiresAt: 0 }, fetchMock as never, 0);
    expect(tokens).toMatchObject({ accessToken: 'a2', refreshToken: 'r1', expiresAt: 60_000 });
  });

  it('surfaces token errors with their OAuth code', async () => {
    const fetchMock = vi.fn(async () => json({ error: 'invalid_grant', error_description: 'Refresh Token has expired' }, 400));
    const err = await refreshTokens(auth, client, { accessToken: 'a', refreshToken: 'r', expiresAt: 0 }, fetchMock as never).catch((e) => e);
    expect(err).toBeInstanceOf(AuthError);
    expect(err).toMatchObject({ code: 'invalid_grant', message: 'Refresh Token has expired' });
  });
});

describe('loopback redirect', () => {
  it('resolves with the code when the state matches', async () => {
    const listener = await listenForCallback(client.redirectUri, 'state-1');
    const res = await fetch('http://127.0.0.1:47915/callback?code=abc&state=state-1');
    expect(res.status).toBe(200);
    await expect(listener.code).resolves.toBe('abc');
  });

  it('rejects a response for a different sign-in, and errors from Cognito', async () => {
    const forged = await listenForCallback(client.redirectUri, 'state-2');
    const rejected = expect(forged.code).rejects.toThrow('State mismatch');
    expect((await fetch('http://127.0.0.1:47915/callback?code=abc&state=other')).status).toBe(400);
    await rejected;

    const denied = await listenForCallback(client.redirectUri, 'state-3');
    const deniedErr = expect(denied.code).rejects.toThrow('User cancelled');
    await fetch('http://127.0.0.1:47915/callback?error=access_denied&error_description=User%20cancelled&state=state-3');
    await deniedErr;
  });

  it('ignores other paths (favicon) and keeps waiting', async () => {
    const listener = await listenForCallback(client.redirectUri, 'state-4');
    expect((await fetch('http://127.0.0.1:47915/favicon.ico')).status).toBe(404);
    await fetch('http://127.0.0.1:47915/callback?code=xyz&state=state-4');
    await expect(listener.code).resolves.toBe('xyz');
  });
});
