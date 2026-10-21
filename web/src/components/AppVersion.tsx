import { useEffect, useState } from 'react';

const RELEASE_VERSION = /^v\d+\.\d+\.\d+$/;

let versionRequest: Promise<string | null> | undefined;

/**
 * Release version from /version.json, written by deploy.sh next to the build. It isn't baked into
 * the bundle, so a release that doesn't touch web/ leaves the JS unchanged and its caches warm.
 * Fetched once per page load; null when the file is missing (local dev) or unreadable.
 */
export function fetchAppVersion(): Promise<string | null> {
  versionRequest ??= fetch('/version.json', { cache: 'no-cache' })
    .then((res) => (res.ok ? res.json() : null))
    .then((body: { version?: unknown } | null) =>
      typeof body?.version === 'string' && body.version ? body.version : null,
    )
    .catch(() => null);
  return versionRequest;
}

/** Test hook: forget the cached request. */
export function resetAppVersionForTests() {
  versionRequest = undefined;
}

/**
 * Footer release version. A release version (vX.Y.Z) links to its GitHub release; local deploys
 * show `git describe` output as text.
 */
export function AppVersion({ className }: { className?: string }) {
  const [version, setVersion] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    fetchAppVersion().then((v) => {
      if (active) setVersion(v);
    });
    return () => {
      active = false;
    };
  }, []);

  if (!version) return null;

  const source = import.meta.env.VITE_SOURCE_CODE_URL?.replace(/\/+$/, '');
  if (source && RELEASE_VERSION.test(version)) {
    return (
      <a
        href={`${source}/releases/tag/${version}`}
        target="_blank"
        rel="noopener noreferrer"
        className={className}
        title="Release notes"
      >
        {version}
      </a>
    );
  }
  return <span className={className}>{version}</span>;
}
