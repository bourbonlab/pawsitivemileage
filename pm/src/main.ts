import { randomBytes } from 'node:crypto';
import { parseArgs } from 'node:util';
import { ApiError, createClient } from '@pawsitivemileage/sdk';
import { authorizeUrl, AuthError, exchangeCode, listenForCallback, openBrowser, pkcePair, revokeTokens } from './auth.js';
import { commands, type Command } from './commands.js';
import { UsageError } from './format.js';
import { ENVIRONMENTS, NotSignedInError, SessionStore, tokenProvider } from './session.js';
import { isOlder, VERSION } from './version.js';

export interface Deps {
  out: (text: string) => void;
  err: (text: string) => void;
  store: SessionStore;
  fetch: typeof fetch;
  openBrowser: (url: string) => void;
  now: () => Date;
  cwd: string;
}

const GLOBAL_OPTIONS = {
  env: { type: 'string' },
  'api-url': { type: 'string' },
  json: { type: 'boolean' },
  help: { type: 'boolean', short: 'h' },
} as const;

const SESSION_COMMANDS: Record<string, Command> = {
  login: {
    usage: 'pm login [--env production|staging] [--api-url URL] [--no-browser]',
    summary: 'Sign in with Google (opens your browser)',
    options: { 'no-browser': { type: 'boolean' } },
    run: async () => undefined, // handled in main: needs the store, not an API client
  },
  logout: { usage: 'pm logout [--env ENV]', summary: 'Sign out and revoke this device\'s session', run: async () => undefined },
};

const ALIASES: Record<string, string> = { fillup: 'fillups', 'fillups add': 'fillup add', reminder: 'reminders', vehicle: 'vehicles' };

function helpText(): string {
  const all = { ...SESSION_COMMANDS, ...commands };
  const width = Math.max(...Object.keys(all).map((k) => k.length));
  return [
    `pm ${VERSION}: PawsitiveMileage from the command line`,
    '',
    'Usage: pm <command> [options]',
    '',
    ...Object.entries(all).map(([name, c]) => `  ${name.padEnd(width)}  ${c.summary}`),
    '',
    'Global options: --env production|staging (default: your last login), --json, --help',
    'A vehicle is its nickname (or a unique prefix) or ID; with only one vehicle it can be left out.',
  ].join('\n');
}

/** Split argv into the command name and the rest: "fillup add" is one command */
function findCommand(argv: string[]): { name?: string; rest: string[] } {
  if (!argv[0] || argv[0].startsWith('-')) return { rest: argv };
  const two = ALIASES[`${argv[0]} ${argv[1]}`] ?? `${argv[0]} ${argv[1]}`;
  if (argv[1] && (two in commands)) return { name: two, rest: argv.slice(2) };
  return { name: ALIASES[argv[0]] ?? argv[0], rest: argv.slice(1) };
}

function apiUrlFor(env: string, override?: string): string {
  const url = override ?? ENVIRONMENTS[env];
  if (!url) throw new UsageError(`Unknown environment "${env}" (use ${Object.keys(ENVIRONMENTS).join(' or ')}, or --api-url)`);
  return url.replace(/\/+$/, '');
}

const clientHeaders = { 'X-Client': `cli/${VERSION}` };

async function login(deps: Deps, env: string, apiUrl: string, noBrowser: boolean): Promise<void> {
  const anonymous = createClient({ baseUrl: apiUrl, getToken: () => undefined, fetch: deps.fetch, headers: clientHeaders });
  const meta = await anonymous.getMeta();
  const minimum = meta.minimumVersions.cli;
  if (minimum && isOlder(VERSION, minimum)) throw new Error(`pm ${VERSION} is no longer supported; update to ${minimum} or later`);
  const auth = meta.auth;
  const client = auth?.clients.cli;
  if (!auth || !client) throw new Error(`${apiUrl} doesn't offer command-line sign-in`);

  const { verifier, challenge } = pkcePair();
  const state = randomBytes(16).toString('base64url');
  const listener = await listenForCallback(client.redirectUri, state);
  const url = authorizeUrl(auth, client, { state, challenge });
  deps.err(`Sign in to PawsitiveMileage (${env}) in your browser. If it doesn't open, visit:\n\n  ${url}\n`);
  if (!noBrowser) deps.openBrowser(url);

  let tokens;
  try {
    tokens = await exchangeCode(auth, client, await listener.code, verifier, deps.fetch, deps.now().getTime());
  } finally {
    listener.close();
  }
  deps.store.save({ env, apiUrl, auth, tokens });
  deps.store.setDefaultEnv(env);

  // First sign-in creates the profile (from Cognito's userInfo, since this is an access token)
  const api = createClient({ baseUrl: apiUrl, getToken: tokenProvider(deps.store, env, deps.fetch), fetch: deps.fetch, headers: clientHeaders });
  const profile = await api.getProfile();
  deps.out(`Signed in as ${profile.displayName} <${profile.email}> on ${env}.`);
}

async function logout(deps: Deps, env: string): Promise<void> {
  const session = deps.store.load(env);
  if (!session) {
    deps.out(`Not signed in on ${env}.`);
    return;
  }
  await revokeTokens(session.auth, session.auth.clients.cli, session.tokens, deps.fetch);
  deps.store.remove(env);
  deps.out(`Signed out of ${env}.`);
}

/** Run pm with these arguments; resolves with the exit code */
export async function main(argv: string[], deps: Deps): Promise<number> {
  const { name, rest } = findCommand(argv);
  if (!name) {
    if (argv.includes('--version') || argv.includes('-v')) {
      deps.out(VERSION);
      return 0;
    }
    deps.out(helpText());
    return argv.length && !argv.some((a) => a === '--help' || a === '-h') ? 2 : 0;
  }
  const command = SESSION_COMMANDS[name] ?? commands[name];
  if (!command) {
    deps.err(`Unknown command "${name}".\n\n${helpText()}`);
    return 2;
  }

  try {
    const { values, positionals } = parseArgs({
      args: rest,
      options: { ...GLOBAL_OPTIONS, ...command.options },
      allowPositionals: true,
      strict: true,
    });
    if (values.help) {
      deps.out(`${command.summary}\n\nUsage: ${command.usage}`);
      return 0;
    }
    const env = deps.store.resolveEnv(values.env as string | undefined);

    if (name === 'login') {
      await login(deps, env, apiUrlFor(env, values['api-url'] as string | undefined), (values as Record<string, unknown>)['no-browser'] === true);
      return 0;
    }
    if (name === 'logout') {
      await logout(deps, env);
      return 0;
    }

    const session = deps.store.load(env);
    if (!session) throw new NotSignedInError(env);
    const api = createClient({
      baseUrl: session.apiUrl,
      getToken: tokenProvider(deps.store, env, deps.fetch, () => deps.now().getTime()),
      fetch: deps.fetch,
      headers: clientHeaders,
      validateRequests: true,
    });
    await command.run({ api, out: deps.out, json: values.json === true, env, fetch: deps.fetch, cwd: deps.cwd, now: deps.now }, positionals, values);
    return 0;
  } catch (err) {
    return report(deps, err, command);
  }
}

function report(deps: Deps, err: unknown, command: Command): number {
  if (err instanceof UsageError || (err as { code?: string })?.code?.startsWith('ERR_PARSE_ARGS')) {
    deps.err(`${(err as Error).message}\n\nUsage: ${command.usage}`);
    return 2;
  }
  if (err instanceof ApiError) {
    const hint = err.status === 401 ? ' Run: pm login' : '';
    const ref = err.requestId ? ` (request ${err.requestId})` : '';
    deps.err(`Error: ${err.message}${ref}.${hint}`);
    return 1;
  }
  if (err instanceof NotSignedInError || err instanceof AuthError) {
    deps.err(err.message);
    return 1;
  }
  deps.err(`Error: ${err instanceof Error ? err.message : String(err)}`);
  return 1;
}

export const defaultDeps = (): Deps => ({
  out: (text) => process.stdout.write(`${text}\n`),
  err: (text) => process.stderr.write(`${text}\n`),
  store: new SessionStore(),
  fetch: globalThis.fetch.bind(globalThis),
  openBrowser,
  now: () => new Date(),
  cwd: process.cwd(),
});
