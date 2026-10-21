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

/**
 * Email and display name for a new profile (#22). The web sends ID tokens, which carry them as
 * claims. Native clients send access tokens, which don't, so they come from Cognito's
 * /oauth2/userInfo, called with the caller's own token. Null when that lookup fails, so the
 * caller can refuse rather than create a profile without an email.
 */
export async function getIdentity(event: AuthEvent, fetchImpl: typeof fetch = fetch): Promise<{ email: string; name: string } | null> {
  const claims = event.requestContext?.authorizer?.jwt?.claims ?? {};
  if (claims.token_use !== 'access') {
    return { email: claims.email ?? '', name: claims.name ?? claims.email ?? '' };
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
    const info = await res.json() as { email?: unknown; name?: unknown };
    if (typeof info.email !== 'string' || !info.email) return null;
    return { email: info.email, name: typeof info.name === 'string' && info.name ? info.name : info.email };
  } catch (err) {
    logger.warn(`userInfo failed: ${err instanceof Error ? err.message : String(err)}`, 'auth', claims.sub ?? 'unknown');
    return null;
  }
}
