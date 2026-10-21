import { describe, it, expect } from 'vitest';
import {
  bumpForMessage, bumpForMessages, effectiveHeader, increment, nextVersion, parseHeader, INITIAL_VERSION,
} from '../src/release/version.js';

describe('parseHeader', () => {
  it.each([
    ['feat: add VIN field', { type: 'feat', scope: undefined, breaking: false }],
    ['fix(api): reject foreign keys', { type: 'fix', scope: 'api', breaking: false }],
    ['feat(web)!: drop legacy routes', { type: 'feat', scope: 'web', breaking: true }],
    ['chore!: require Node 26', { type: 'chore', scope: undefined, breaking: true }],
  ])('parses %s', (line, expected) => {
    expect(parseHeader(line)).toEqual(expected);
  });

  it.each([
    'Add VIN field',
    'feat:missing space',
    'feat: ',
    'Feat: capitalised type',
    'feature: unknown type',
    'feat(): empty scope',
    'Merge pull request #4 from bourbonlab/feat/x',
  ])('rejects %s', (line) => {
    expect(parseHeader(line)).toBeNull();
  });
});

describe('effectiveHeader', () => {
  it('uses the PR title from a GitHub merge commit body', () => {
    const merge = 'Merge pull request #6 from bourbonlab/fix/ci-cloudflare-secret\n\nfix(ci): pass environment secrets';
    expect(effectiveHeader(merge)).toBe('fix(ci): pass environment secrets');
  });

  it('uses the subject of an ordinary commit', () => {
    expect(effectiveHeader('feat: thing\n\n- detail')).toBe('feat: thing');
  });
});

describe('bumpForMessage', () => {
  it.each([
    ['fix: x', 'patch'],
    ['feat: x', 'minor'],
    ['feat!: x', 'major'],
    ['refactor: x\n\nBREAKING CHANGE: config renamed', 'major'],
    ['docs: x', 'patch'],
    ['chore(deps): bump', 'patch'],
    ['not conventional at all', 'patch'],
    ['Merge pull request #9 from o/feat/y\n\nfeat(web): add version to footer', 'minor'],
  ])('%s → %s', (message, bump) => {
    expect(bumpForMessage(message)).toBe(bump);
  });

  it('ignores "BREAKING CHANGE" outside a footer line', () => {
    expect(bumpForMessage('fix: mention a BREAKING CHANGE: in prose')).toBe('patch');
  });
});

describe('bumpForMessages', () => {
  it('takes the largest bump', () => {
    expect(bumpForMessages(['fix: a', 'feat: b', 'docs: c'])).toBe('minor');
    expect(bumpForMessages(['fix: a', 'perf!: b'])).toBe('major');
  });

  it('is null with no commits', () => {
    expect(bumpForMessages([])).toBeNull();
  });
});

describe('increment', () => {
  it('resets lower components', () => {
    expect(increment('1.4.2', 'patch')).toBe('1.4.3');
    expect(increment('1.4.2', 'minor')).toBe('1.5.0');
    expect(increment('1.4.2', 'major')).toBe('2.0.0');
  });

  it('rejects non-semver input', () => {
    expect(() => increment('1.4', 'patch')).toThrow();
  });
});

describe('nextVersion', () => {
  it('starts at the initial version when untagged, whatever the commits', () => {
    expect(nextVersion(null, ['feat!: everything'])).toEqual({ version: INITIAL_VERSION, bump: null });
    expect(INITIAL_VERSION).toBe('1.0.0');
  });

  it('bumps from the latest tag', () => {
    expect(nextVersion('1.0.0', ['fix: a', 'feat: b'])).toEqual({ version: '1.1.0', bump: 'minor' });
  });

  it('keeps the version when nothing is new', () => {
    expect(nextVersion('1.2.3', [])).toEqual({ version: '1.2.3', bump: null });
  });
});
