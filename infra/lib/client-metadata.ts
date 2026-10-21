/**
 * What GET /v1/meta tells clients (#23). Raise a minimum version here to stop older installed
 * apps (they show an "update required" screen); flip a flag to turn a feature on or off. Changes
 * ship with a normal deploy.
 *
 * Versions are semver strings. Platforms without a released client still get a value so clients
 * can parse the response uniformly.
 */
export const CLIENT_METADATA = {
  minimumVersions: {
    android: '1.0.0',
    ios: '1.0.0',
    cli: '0.1.0',
  },
  features: {} as Record<string, boolean>,
};

/**
 * Redirect URIs for the native app clients (#22). Each environment has its own Cognito clients;
 * Android also gets its own scheme per environment so a staging build installed next to the
 * production app doesn't catch its sign-in redirects. The CLI listens on a fixed loopback port.
 */
export const CLI_LOOPBACK_PORT = 47815;

export function nativeRedirects(envName: string) {
  const scheme = envName === 'production' ? 'app.pawsitivemileage' : `app.pawsitivemileage.${envName}`;
  return {
    android: { callback: `${scheme}://callback`, logout: `${scheme}://signout` },
    cli: { callback: `http://localhost:${CLI_LOOPBACK_PORT}/callback`, logout: `http://localhost:${CLI_LOOPBACK_PORT}/signout` },
  };
}

/** Scopes the native clients may request: identity only, no Cognito user-admin APIs */
export const NATIVE_SCOPES = ['openid', 'email', 'profile'];
