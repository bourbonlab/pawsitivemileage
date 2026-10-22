import { useEffect, useState } from 'react';
import { Smartphone } from 'lucide-react';

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

export interface AndroidRelease {
  version: string;
  url: string;
  bytes?: number;
}

const APK_URL = /^\/downloads\/[\w.-]+\.apk$/;
let androidRequest: Promise<AndroidRelease | null> | undefined;

/**
 * The Android APK offered for download until the app is on Google Play: /downloads/android.json,
 * published by production deploys. Null when there is none (staging and local dev serve the
 * site's HTML there, which isn't JSON).
 */
export function fetchAndroidRelease(): Promise<AndroidRelease | null> {
  androidRequest ??= fetch('/downloads/android.json', { cache: 'no-cache' })
    .then((res) => (res.ok ? res.json() : null))
    .then((body: { version?: unknown; url?: unknown; bytes?: unknown } | null) =>
      typeof body?.version === 'string' && typeof body.url === 'string' && APK_URL.test(body.url)
        ? { version: body.version, url: body.url, bytes: typeof body.bytes === 'number' ? body.bytes : undefined }
        : null,
    )
    .catch(() => null);
  return androidRequest;
}

/** Test hook: forget the cached requests. */
export function resetAppVersionForTests() {
  versionRequest = undefined;
  androidRequest = undefined;
}

function AndroidDownload({ release, className }: { release: AndroidRelease; className?: string }) {
  const size = release.bytes ? ` · ${(release.bytes / 1024 / 1024).toFixed(1)} MB` : '';
  const label = `Download the Android app (${release.version}${size})`;
  return (
    <a href={release.url} download className={className} title={label} aria-label={label}>
      <Smartphone className="size-3.5" aria-hidden="true" />
    </a>
  );
}

/**
 * Footer release version. A release version (vX.Y.Z) links to its GitHub release; local deploys
 * show `git describe` output as text. When production publishes an APK, a phone icon next to it
 * downloads the Android app.
 */
export function AppVersion({ className }: { className?: string }) {
  const [version, setVersion] = useState<string | null>(null);
  const [android, setAndroid] = useState<AndroidRelease | null>(null);

  useEffect(() => {
    let active = true;
    fetchAppVersion().then((v) => {
      if (active) setVersion(v);
    });
    fetchAndroidRelease().then((a) => {
      if (active) setAndroid(a);
    });
    return () => {
      active = false;
    };
  }, []);

  if (!version && !android) return null;
  return (
    <span className="inline-flex items-center gap-1.5">
      {version && <VersionText version={version} className={className} />}
      {android && <AndroidDownload release={android} className={className} />}
    </span>
  );
}

function VersionText({ version, className }: { version: string; className?: string }) {
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
