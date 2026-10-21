import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mkdtempSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NotSignedInError, SessionStore, tokenProvider, type Session } from '../src/session.js';

const auth = {
  issuer: 'https://issuer', domain: 'auth.example.app', scopes: ['openid'],
  clients: { cli: { clientId: 'cli123', redirectUri: 'http://localhost:47815/callback', logoutUri: 'http://localhost:47815/signout' } },
};
const session = (expiresAt: number): Session => ({
  env: 'staging', apiUrl: 'https://api.example.app', auth, tokens: { accessToken: 'old', refreshToken: 'r1', expiresAt },
});

let dir: string;
let store: SessionStore;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'pm-test-'));
  store = new SessionStore(dir);
});

describe('SessionStore', () => {
  it('writes sessions owner-only and remembers the last environment', () => {
    store.save(session(0));
    store.setDefaultEnv('staging');
    expect(statSync(join(dir, 'session-staging.json')).mode & 0o777).toBe(0o600);
    expect(statSync(dir).mode & 0o777).toBe(0o700);
    expect(store.resolveEnv(undefined, {})).toBe('staging');
    expect(store.resolveEnv(undefined, { PM_ENV: 'production' })).toBe('production');
    expect(store.resolveEnv('production', { PM_ENV: 'staging' })).toBe('production');
    expect(new SessionStore(join(dir, 'empty')).resolveEnv(undefined, {})).toBe('production');
  });
});

describe('tokenProvider', () => {
  it('returns the stored access token while it is fresh', async () => {
    store.save(session(10 * 60_000));
    const fetchMock = vi.fn();
    expect(await tokenProvider(store, 'staging', fetchMock as never, () => 0)()).toBe('old');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('refreshes once (shared by concurrent calls) and saves the new token', async () => {
    store.save(session(30_000)); // within the 60 s margin
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ access_token: 'new', expires_in: 3600 })));
    const getToken = tokenProvider(store, 'staging', fetchMock as never, () => 0);
    expect(await Promise.all([getToken(), getToken()])).toEqual(['new', 'new']);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(store.load('staging')?.tokens).toMatchObject({ accessToken: 'new', refreshToken: 'r1' });
  });

  it('asks for pm login when not signed in or the refresh token expired', async () => {
    await expect(tokenProvider(store, 'staging')()).rejects.toThrow(NotSignedInError);
    store.save(session(0));
    const expired = vi.fn(async () => new Response(JSON.stringify({ error: 'invalid_grant' }), { status: 400 }));
    await expect(tokenProvider(store, 'staging', expired as never, () => 0)()).rejects.toThrow('Session expired. Run: pm login --env staging');
  });
});
