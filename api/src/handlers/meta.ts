import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { ulid } from 'ulid';
import { success, error } from '../lib/response.js';
import { createLogger } from '../lib/logger.js';

const logger = createLogger('meta');

/** Used when MIN_CLIENT_VERSIONS is unset or invalid */
const DEFAULT_MINIMUM_VERSIONS: Record<string, string> = { android: '1.0.0', ios: '1.0.0', cli: '0.1.0' };

function parseJsonObject<T>(raw: string | undefined, name: string, fallback: T): T {
  if (!raw) return fallback;
  try {
    const value = JSON.parse(raw);
    if (value && typeof value === 'object' && !Array.isArray(value)) return value as T;
  } catch {
    // fall through to the fallback
  }
  logger.warn(`${name} is not a JSON object; using defaults`, 'config', 'system');
  return fallback;
}

/**
 * Public client metadata (#23). Installed apps call this before signing in, to learn whether
 * their version is still supported and which features are on. Configured per environment in
 * infra/lib/client-metadata.ts (Lambda environment), so changing a value is a normal deploy.
 */
export function buildMeta(env: NodeJS.ProcessEnv, now = new Date()) {
  const site = `https://${env.FRONTEND_DOMAIN}`;
  return {
    apiVersion: 'v1' as const,
    minimumVersions: parseJsonObject<Record<string, string>>(env.MIN_CLIENT_VERSIONS, 'MIN_CLIENT_VERSIONS', DEFAULT_MINIMUM_VERSIONS),
    features: parseJsonObject<Record<string, boolean>>(env.FEATURE_FLAGS, 'FEATURE_FLAGS', {}),
    links: {
      privacyPolicy: `${site}/privacy`,
      terms: `${site}/terms`,
      accountDeletion: `${site}/account`,
    },
    serverTime: now.toISOString(),
    // Native sign-in configuration (#22); omitted when the environment doesn't provide it
    ...(env.AUTH_CONFIG && { auth: parseJsonObject<Record<string, unknown>>(env.AUTH_CONFIG, 'AUTH_CONFIG', {}) }),
  };
}

export const handler = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
  const requestId = event.requestContext?.requestId ?? ulid();
  if (event.requestContext?.http?.method !== 'GET') {
    return error('VALIDATION_ERROR', 'Unsupported operation', requestId);
  }
  return success(buildMeta(process.env), requestId);
};
