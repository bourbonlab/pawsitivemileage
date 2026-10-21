/** pm's version: sent as X-Client and checked against /v1/meta's minimumVersions.cli. Keep in step with package.json. */
export const VERSION = '0.1.0';

/** True when semver `version` is lower than `minimum` (major.minor.patch, numeric) */
export function isOlder(version: string, minimum: string): boolean {
  const a = version.split('.').map(Number);
  const b = minimum.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) < (b[i] ?? 0);
  }
  return false;
}
