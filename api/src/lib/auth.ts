import { createLogger } from './logger.js';

const logger = createLogger('auth');

type AuthEvent = {
  headers?: Record<string, string | undefined>;
  requestContext?: { authorizer?: { jwt?: { claims?: Record<string, string> } } };
};

/**
 * Extract the authenticated userId from an API Gateway v2 JWT authorizer event.
 * Returns the Cognito `sub` claim (present in both ID and access tokens).
 */
export function getUserId(event: AuthEvent): string | null {
  return event.requestContext?.authorizer?.jwt?.claims?.sub ?? null;
}

export interface Identity {
  email: string;
  name: string;
  /**
   * Cognito's email_verified for this user: false once the email has been changed and not yet
   * verified, undefined when the token or userInfo doesn't say.
   */
  emailVerified?: boolean;
}

/** email_verified arrives as "true"/"false" in JWT claims and as a string or boolean from userInfo */
function parseVerified(value: unknown): boolean | undefined {
  if (value === true || value === 'true') return true;
  if (value === false || value === 'false') return false;
  return undefined;
}

/**
 * Email and display name for a new profile (#22). The web sends ID tokens, which carry them as
 * claims. Native clients send access tokens, which don't, so they come from Cognito's
 * /oauth2/userInfo, called with the caller's own token. Null when that lookup fails, so the
 * caller can refuse rather than create a profile without an email.
 *
 * Shares are granted by email, so the caller must also refuse an email that isn't verified
 * (`emailVerified: false`): otherwise a user who changed their Cognito email to someone else's
 * address would receive that person's shares.
 */
export async function getIdentity(event: AuthEvent, fetchImpl: typeof fetch = fetch): Promise<Identity | null> {
  const claims = event.requestContext?.authorizer?.jwt?.claims ?? {};
  if (claims.token_use !== 'access') {
    return { email: claims.email ?? '', name: claims.name ?? claims.email ?? '', emailVerified: parseVerified(claims.email_verified) };
  }

  const domain = process.env.AUTH_DOMAIN;
  const token = event.headers?.authorization?.replace(/^Bearer\s+/i, '');
  if (!domain || !token) {
    logger.warn('Access token without AUTH_DOMAIN or Authorization header', 'auth', claims.sub ?? 'unknown');
    return null;
  }
  try {
    const res = await fetchImpl(`https://${domain}/oauth2/userInfo`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) {
      logger.warn(`userInfo returned ${res.status}`, 'auth', claims.sub ?? 'unknown');
      return null;
    }
    const info = await res.json() as { email?: unknown; name?: unknown; email_verified?: unknown };
    if (typeof info.email !== 'string' || !info.email) return null;
    return {
      email: info.email,
      name: typeof info.name === 'string' && info.name ? info.name : info.email,
      emailVerified: parseVerified(info.email_verified),
    };
  } catch (err) {
    logger.warn(`userInfo failed: ${err instanceof Error ? err.message : String(err)}`, 'auth', claims.sub ?? 'unknown');
    return null;
  }
}
