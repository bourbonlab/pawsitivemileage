/**
 * pm's local state: which environment to use, and the signed-in session per environment.
 * Sessions hold OAuth tokens, so files are written owner-only (0600 in a 0700 directory).
 */
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { AuthError, refreshTokens, type AuthConfig, type Tokens } from './auth.js';

export const ENVIRONMENTS: Record<string, string> = {
  production: 'https://api.pawsitivemileage.app',
  staging: 'https://api-staging.pawsitivemileage.app',
};

export interface Session {
  env: string;
  apiUrl: string;
  auth: AuthConfig;
  tokens: Tokens;
}

export function configDir(env: NodeJS.ProcessEnv = process.env): string {
  return env.PM_CONFIG_DIR ?? join(env.XDG_CONFIG_HOME ?? join(homedir(), '.config'), 'pawsitivemileage');
}

function writePrivate(path: string, value: unknown): void {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  chmodSync(path, 0o600); // writeFileSync's mode only applies when creating the file
}

function readJson<T>(path: string): T | undefined {
  if (!existsSync(path)) return undefined;
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as T;
  } catch {
    return undefined;
  }
}

export class SessionStore {
  constructor(private readonly dir = configDir()) {}

  private ensureDir(): void {
    mkdirSync(this.dir, { recursive: true, mode: 0o700 });
  }

  private sessionPath(env: string): string {
    return join(this.dir, `session-${env}.json`);
  }

  /** Environment from --env, then PM_ENV, then the last `pm login`, then production */
  resolveEnv(flag?: string, env: NodeJS.ProcessEnv = process.env): string {
    return flag ?? env.PM_ENV ?? readJson<{ env?: string }>(join(this.dir, 'config.json'))?.env ?? 'production';
  }

  setDefaultEnv(env: string): void {
    this.ensureDir();
    writePrivate(join(this.dir, 'config.json'), { env });
  }

  load(env: string): Session | undefined {
    return readJson<Session>(this.sessionPath(env));
  }

  save(session: Session): void {
    this.ensureDir();
    writePrivate(this.sessionPath(session.env), session);
  }

  remove(env: string): void {
    rmSync(this.sessionPath(env), { force: true });
  }
}

export class NotSignedInError extends Error {
  constructor(env: string, reason = 'Not signed in') {
    super(`${reason}. Run: pm login${env === 'production' ? '' : ` --env ${env}`}`);
    this.name = 'NotSignedInError';
  }
}

/**
 * A getToken for the SDK: the session's access token, refreshed (and saved) when it expires
 * within a minute. Concurrent calls share one refresh.
 */
export function tokenProvider(store: SessionStore, env: string, fetchImpl: typeof fetch = fetch, now = () => Date.now()) {
  let refreshing: Promise<string> | undefined;
  return async (): Promise<string> => {
    const session = store.load(env);
    if (!session) throw new NotSignedInError(env);
    if (session.tokens.expiresAt - 60_000 > now()) return session.tokens.accessToken;

    refreshing ??= (async () => {
      try {
        const tokens = await refreshTokens(session.auth, session.auth.clients.cli, session.tokens, fetchImpl, now());
        store.save({ ...session, tokens });
        return tokens.accessToken;
      } catch (err) {
        if (err instanceof AuthError && err.code === 'invalid_grant') throw new NotSignedInError(env, 'Session expired');
        throw err;
      } finally {
        refreshing = undefined;
      }
    })();
    return refreshing;
  };
}
