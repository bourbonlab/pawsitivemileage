const RELEASE_VERSION = /^v\d+\.\d+\.\d+$/;

/**
 * Release version baked in at build time (VITE_APP_VERSION, set by deploy.sh). A release
 * version (vX.Y.Z) links to its GitHub release; local builds show `git describe` output as text.
 */
export function AppVersion({ className }: { className?: string }) {
  const version = import.meta.env.VITE_APP_VERSION;
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
