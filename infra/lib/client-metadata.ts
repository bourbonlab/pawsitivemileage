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
