/**
 * Sign-in for pm: OAuth 2.0 authorization code + PKCE through the Cognito Hosted UI, with a
 * loopback redirect (#22, #27). Everything environment-specific (Hosted UI domain, client ID,
 * redirect URI, scopes) comes from GET /v1/meta, so pm only needs the API base URL.
 */
import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { Meta } from '@pawsitivemileage/sdk';

export type AuthConfig = NonNullable<Meta['auth']>;
export type NativeClient = AuthConfig['clients'][string];

export interface Tokens {
  accessToken: string;
  idToken?: string;
  refreshToken?: string;
  /** Epoch milliseconds when the access token expires */
  expiresAt: number;
}

type Fetch = typeof fetch;

export function pkcePair(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString('base64url');
  return { verifier, challenge: codeChallenge(verifier) };
}

/** RFC 7636 S256: base64url(sha256(verifier)) */
export function codeChallenge(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url');
}

export function authorizeUrl(auth: AuthConfig, client: NativeClient, params: { state: string; challenge: string }): string {
  const query = new URLSearchParams({
    response_type: 'code',
    client_id: client.clientId,
    redirect_uri: client.redirectUri,
    scope: auth.scopes.join(' '),
    state: params.state,
    code_challenge: params.challenge,
    code_challenge_method: 'S256',
    // Google is the only sign-in option, so skip the Hosted UI's provider page
    identity_provider: 'Google',
  });
  return `https://${auth.domain}/oauth2/authorize?${query}`;
}

async function tokenRequest(auth: AuthConfig, form: Record<string, string>, fetchImpl: Fetch, now: number): Promise<Tokens> {
  const res = await fetchImpl(`https://${auth.domain}/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(form).toString(),
  });
  const json = await res.json().catch(() => ({})) as Record<string, unknown>;
  if (!res.ok || typeof json.access_token !== 'string') {
    throw new AuthError(String(json.error_description ?? json.error ?? `token endpoint returned ${res.status}`), String(json.error ?? ''));
  }
  return {
    accessToken: json.access_token,
    idToken: typeof json.id_token === 'string' ? json.id_token : undefined,
    refreshToken: typeof json.refresh_token === 'string' ? json.refresh_token : undefined,
    expiresAt: now + Number(json.expires_in ?? 3600) * 1000,
  };
}

export class AuthError extends Error {
  constructor(message: string, readonly code = '') {
    super(message);
    this.name = 'AuthError';
  }
}

export function exchangeCode(auth: AuthConfig, client: NativeClient, code: string, verifier: string, fetchImpl: Fetch = fetch, now = Date.now()): Promise<Tokens> {
  return tokenRequest(auth, {
    grant_type: 'authorization_code',
    client_id: client.clientId,
    code,
    redirect_uri: client.redirectUri,
    code_verifier: verifier,
  }, fetchImpl, now);
}

/** New access/ID tokens; Cognito doesn't rotate the refresh token, so the old one is kept */
export async function refreshTokens(auth: AuthConfig, client: NativeClient, tokens: Tokens, fetchImpl: Fetch = fetch, now = Date.now()): Promise<Tokens> {
  if (!tokens.refreshToken) throw new AuthError('No refresh token', 'invalid_grant');
  const fresh = await tokenRequest(auth, { grant_type: 'refresh_token', client_id: client.clientId, refresh_token: tokens.refreshToken }, fetchImpl, now);
  return { ...fresh, refreshToken: fresh.refreshToken ?? tokens.refreshToken };
}

/** Revoke the refresh token (and the tokens issued from it). Best effort. */
export async function revokeTokens(auth: AuthConfig, client: NativeClient, tokens: Tokens, fetchImpl: Fetch = fetch): Promise<void> {
  if (!tokens.refreshToken) return;
  await fetchImpl(`https://${auth.domain}/oauth2/revoke`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ token: tokens.refreshToken, client_id: client.clientId }).toString(),
  }).catch(() => undefined);
}

const PAGE = (title: string, body: string) =>
  `<!doctype html><meta charset="utf-8"><title>${title}</title><body style="font:16px system-ui;margin:3em;text-align:center"><h1>${title}</h1><p>${body}</p></body>`;

/**
 * Listen on the redirect URI's loopback port (IPv4 and IPv6, since browsers may resolve
 * "localhost" to either) and resolve with the authorization code. Rejects on a state mismatch,
 * an error from Cognito, or timeout.
 */
export async function listenForCallback(redirectUri: string, state: string, timeoutMs = 5 * 60_000): Promise<{ code: Promise<string>; close: () => void }> {
  const { port, pathname } = new URL(redirectUri);
  const servers: Server[] = [];
  const close = () => servers.forEach((s) => s.close());
  let settle!: { resolve: (code: string) => void; reject: (err: Error) => void };
  const code = new Promise<string>((resolve, reject) => { settle = { resolve, reject }; });
  const timer = setTimeout(() => { close(); settle.reject(new AuthError('Timed out waiting for sign-in')); }, timeoutMs);
  timer.unref();

  const handler = (req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (url.pathname !== pathname) {
      res.writeHead(404).end();
      return;
    }
    const finish = (status: number, title: string, body: string) => {
      res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8', Connection: 'close' }).end(PAGE(title, body));
      clearTimeout(timer);
      close();
    };
    const error = url.searchParams.get('error');
    if (error) {
      finish(400, 'Sign-in failed', 'Return to the terminal for details.');
      settle.reject(new AuthError(url.searchParams.get('error_description') ?? error, error));
    } else if (url.searchParams.get('state') !== state) {
      finish(400, 'Sign-in failed', 'The response did not match this sign-in. Run pm login again.');
      settle.reject(new AuthError('State mismatch in the sign-in response'));
    } else {
      finish(200, 'Signed in to PawsitiveMileage', 'You can close this tab and return to the terminal.');
      settle.resolve(url.searchParams.get('code') ?? '');
    }
  };

  for (const host of ['127.0.0.1', '::1']) {
    const server = createServer(handler);
    try {
      await new Promise<void>((resolve, reject) => {
        server.once('error', reject);
        server.listen(Number(port), host, () => resolve());
      });
      servers.push(server);
    } catch (err) {
      // No IPv6 loopback is fine; a port already in use on IPv4 is not
      if (host === '127.0.0.1') {
        close();
        clearTimeout(timer);
        throw new AuthError(`Can't listen on ${host}:${port} for the sign-in redirect: ${(err as Error).message}`);
      }
    }
  }
  return { code, close: () => { clearTimeout(timer); close(); } };
}

/** Open a URL in the user's browser, best effort (the URL is also printed) */
export function openBrowser(url: string): void {
  const isWsl = process.platform === 'linux' && /microsoft/i.test(safeRead('/proc/version'));
  const [cmd, args] =
    process.platform === 'darwin' ? ['open', [url]]
    : process.platform === 'win32' ? ['cmd', ['/c', 'start', '""', url.replace(/&/g, '^&')]]
    : isWsl ? ['explorer.exe', [url]]
    : ['xdg-open', [url]];
  try {
    const child = spawn(cmd, args as string[], { stdio: 'ignore', detached: true });
    child.on('error', () => undefined);
    child.unref();
  } catch {
    // printed URL is the fallback
  }
}

function safeRead(path: string): string {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return '';
  }
}
