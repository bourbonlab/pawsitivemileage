// Semantic versions from conventional commits. Runs directly on Node 24 (type stripping),
// with no install, so GitHub Actions can call it before `npm ci`:
//
//   node cli/src/release/version.ts next              # version for HEAD, as JSON
//   node cli/src/release/version.ts pr --base <sha> --title "<PR title>"   # PR check, Markdown
//
// Rules, applied to every commit since the last vX.Y.Z tag (merge commits contribute the
// PR title, which GitHub puts in their body):
//   - `type!:` or a `BREAKING CHANGE:` footer → major
//   - `feat:` → minor
//   - anything else → patch (every merge to main deploys, so every merge is a release)

import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export type Bump = 'major' | 'minor' | 'patch';

/** First release when the repo has no version tags yet. */
export const INITIAL_VERSION = '1.0.0';

export const CONVENTIONAL_TYPES = [
  'feat', 'fix', 'perf', 'refactor', 'chore', 'docs', 'test', 'build', 'ci', 'style', 'revert',
];

const HEADER = /^(?<type>[a-z]+)(?:\((?<scope>[^()\r\n]+)\))?(?<breaking>!)?: \S/;
const BREAKING_FOOTER = /^BREAKING[ -]CHANGE: /m;
const SEMVER_TAG = /^v(\d+)\.(\d+)\.(\d+)$/;
const RANK: Record<Bump, number> = { patch: 0, minor: 1, major: 2 };

export interface Header {
  type: string;
  scope?: string;
  breaking: boolean;
}

/** Parses a conventional commit header (`type(scope)!: description`); null if it isn't one. */
export function parseHeader(line: string): Header | null {
  const match = HEADER.exec(line.trim());
  if (!match?.groups || !CONVENTIONAL_TYPES.includes(match.groups.type)) return null;
  return { type: match.groups.type, scope: match.groups.scope, breaking: Boolean(match.groups.breaking) };
}

/**
 * The header that describes a commit. For a GitHub merge commit ("Merge pull request #N from …")
 * that's the PR title, which GitHub writes as the first line of the body.
 */
export function effectiveHeader(message: string): string {
  const [subject = '', ...rest] = message.trim().split('\n');
  if (/^Merge (pull request|branch|remote-tracking branch|[0-9a-f]{7,} into)/.test(subject)) {
    return rest.find((l) => l.trim() !== '')?.trim() ?? subject;
  }
  return subject;
}

export function bumpForMessage(message: string): Bump {
  const header = parseHeader(effectiveHeader(message));
  if (header?.breaking || BREAKING_FOOTER.test(message)) return 'major';
  if (header?.type === 'feat') return 'minor';
  return 'patch';
}

/** Largest bump across the commits; null when there are none (nothing new to release). */
export function bumpForMessages(messages: string[]): Bump | null {
  let bump: Bump | null = null;
  for (const message of messages) {
    const b = bumpForMessage(message);
    if (bump === null || RANK[b] > RANK[bump]) bump = b;
  }
  return bump;
}

export function increment(version: string, bump: Bump): string {
  const match = SEMVER_TAG.exec(`v${version}`);
  if (!match) throw new Error(`Not a semantic version: ${version}`);
  const [major, minor, patch] = match.slice(1).map(Number);
  if (bump === 'major') return `${major + 1}.0.0`;
  if (bump === 'minor') return `${major}.${minor + 1}.0`;
  return `${major}.${minor}.${patch + 1}`;
}

/** Next version after `latest` (null when untagged) for the given commit messages. */
export function nextVersion(latest: string | null, messages: string[]): { version: string; bump: Bump | null } {
  if (latest === null) return { version: INITIAL_VERSION, bump: null };
  const bump = bumpForMessages(messages);
  return { version: bump ? increment(latest, bump) : latest, bump };
}

// ── git ─────────────────────────────────────────────────────────────────────

function git(...args: string[]): string {
  return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

/** Nearest vX.Y.Z tag reachable from `ref`, without the `v`; null if there is none. */
function latestTag(ref: string): string | null {
  try {
    return git('describe', '--tags', '--abbrev=0', '--match', 'v[0-9]*.[0-9]*.[0-9]*', ref).slice(1);
  } catch {
    return null;
  }
}

function tagAt(ref: string): string | null {
  const tags = git('tag', '--points-at', ref, '--list', 'v[0-9]*.[0-9]*.[0-9]*').split('\n');
  return tags.find((t) => SEMVER_TAG.test(t))?.slice(1) ?? null;
}

function messagesSince(latest: string | null, ref: string): string[] {
  const range = latest === null ? ref : `v${latest}..${ref}`;
  return git('log', '--format=%B%x1e', range).split('\x1e').map((m) => m.trim()).filter(Boolean);
}

// ── commands ────────────────────────────────────────────────────────────────

/** Version for HEAD. A HEAD that is already tagged keeps its version, so re-runs are idempotent. */
function cmdNext(): void {
  const existing = tagAt('HEAD');
  if (existing) {
    console.log(JSON.stringify({ version: existing, tag: `v${existing}`, isNew: false, bump: null }));
    return;
  }
  const latest = latestTag('HEAD');
  const { version, bump } = nextVersion(latest, messagesSince(latest, 'HEAD'));
  console.log(JSON.stringify({ version, tag: `v${version}`, isNew: version !== latest, bump, previous: latest }));
}

/** PR check: the title must be a conventional commit; prints the version a merge would produce. */
function cmdPr(base: string, title: string): number {
  const header = parseHeader(title);
  if (!header) {
    console.log([
      '### ❌ PR title is not a conventional commit',
      '',
      `\`${title}\``,
      '',
      'Use `type(scope): description`, with `!` after the type for a breaking change. Types: ' +
        CONVENTIONAL_TYPES.map((t) => `\`${t}\``).join(', ') + '.',
      'The title becomes the merge commit message and decides the version bump.',
    ].join('\n'));
    return 1;
  }
  const latest = latestTag(base);
  // HEAD is GitHub's merge of the PR into base; the title stands in for the final merge commit
  const messages = [...messagesSince(latest, 'HEAD').filter((m) => !/^Merge [0-9a-f]{7,} into /.test(m)), title];
  const { version, bump } = nextVersion(latest, messages);
  const why = latest === null ? 'first release' : `${bump} bump from v${latest}`;
  console.log(`### Merging this PR releases **v${version}** (${why})`);
  return 0;
}

function arg(name: string): string {
  const i = process.argv.indexOf(`--${name}`);
  const value = i >= 0 ? process.argv[i + 1] : undefined;
  if (value === undefined) throw new Error(`Missing --${name}`);
  return value;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const command = process.argv[2];
  if (command === 'next') {
    cmdNext();
  } else if (command === 'pr') {
    process.exitCode = cmdPr(arg('base'), arg('title'));
  } else {
    console.error('Usage: version.ts next | pr --base <sha> --title <title>');
    process.exitCode = 2;
  }
}
