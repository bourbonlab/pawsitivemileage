#!/usr/bin/env npx tsx
/**
 * Migrate PawsitiveMileage from the legacy AWS account to the dedicated account.
 *
 * A new Cognito user pool issues new subs, and the sub is the app's user ID
 * (DynamoDB keys/GSIs, S3 key prefixes, stored photo keys). For each Google
 * user in the source pool this script pre-creates a user in the target pool and
 * links their Google identity to it, so their next Google sign-in lands in that
 * user. It then mirrors every table and photo with old subs rewritten to new ones.
 *
 * Re-runnable by design — rehearse as often as needed, then run once more during
 * the cutover outage. Each run makes the target an exact mirror of the source:
 * items and photos in the target that didn't come from the source (e.g. created
 * while testing a rehearsal) are deleted. Once the target is live, `complete`
 * locks it so `migrate` can never overwrite real data.
 *
 * The source account is only read — except `freeze`/`unfreeze`, which set the
 * source Lambdas' reserved concurrency to 0 (and back) to stop writes during cutover.
 *
 * Usage (from cli/, see docs/account-migration.md for the full runbook):
 *   npx tsx src/migrate-account.ts migrate  --env staging --dry-run    # plan only, no writes
 *   npx tsx src/migrate-account.ts migrate  --env staging              # users + tables + photos, then verify
 *   npx tsx src/migrate-account.ts verify   --env staging              # compare source vs target
 *   npx tsx src/migrate-account.ts freeze   --env production --yes     # stop writes to the old app
 *   npx tsx src/migrate-account.ts migrate  --env production --final --yes  # requires a frozen source
 *   npx tsx src/migrate-account.ts complete --env production --yes     # lock target after go-live
 *   npx tsx src/migrate-account.ts unfreeze --env production --yes     # roll back the freeze
 *
 * Options (defaults in brackets):
 *   --source-profile [bourbonlab-root]   --source-account [817281265012]
 *   --target-profile [pawsitivemileage]  --target-account [376784708284]
 *   --source-prefix  [pawsitivemileage-<env>]   --target-prefix [pawsitivemileage-app-<env>]
 *   --mapping-out    [~/.pawsitivemileage-migration/<env>-user-map.json]  (contains emails; mode 600)
 *   --final          refuse to run unless every source Lambda is frozen
 *   --yes            required for any command that writes when --env production
 */
import { randomBytes } from 'node:crypto';
import { chmodSync, mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { parseArgs } from 'node:util';
import {
  BatchWriteItemCommand, DescribeTableCommand, DynamoDBClient, paginateScan, type WriteRequest,
} from '@aws-sdk/client-dynamodb';
import {
  AdminCreateUserCommand, AdminDeleteUserCommand, AdminGetUserCommand, AdminLinkProviderForUserCommand,
  AdminSetUserPasswordCommand, CognitoIdentityProviderClient, paginateListUserPools, paginateListUsers,
  type AttributeType, type UserType,
} from '@aws-sdk/client-cognito-identity-provider';
import {
  DeleteFunctionConcurrencyCommand, GetFunctionConcurrencyCommand, LambdaClient, paginateListFunctions,
  PutFunctionConcurrencyCommand,
} from '@aws-sdk/client-lambda';
import {
  DeleteObjectsCommand, GetObjectCommand, paginateListObjectsV2, PutObjectCommand, S3Client, type _Object,
} from '@aws-sdk/client-s3';
import { GetParameterCommand, PutParameterCommand, SSMClient } from '@aws-sdk/client-ssm';
import { GetCallerIdentityCommand, STSClient } from '@aws-sdk/client-sts';
import {
  canonical, findUnmappedUserIds, KEY_ATTRS, keyString, remapItem, remapString, s3KeyOwner, TABLES, tableName,
  unmappedUuids, type Item, type TableName,
} from './migrate/remap.js';

const REGION = 'us-east-1';

// ── Arguments ───────────────────────────────────────────────────────────────

const { positionals, values: opts } = parseArgs({
  allowPositionals: true,
  options: {
    env: { type: 'string' },
    'source-profile': { type: 'string', default: 'bourbonlab-root' },
    'source-account': { type: 'string', default: '817281265012' },
    'target-profile': { type: 'string', default: 'pawsitivemileage' },
    'target-account': { type: 'string', default: '376784708284' },
    'source-prefix': { type: 'string' },
    'target-prefix': { type: 'string' },
    'mapping-out': { type: 'string' },
    'dry-run': { type: 'boolean', default: false },
    final: { type: 'boolean', default: false },
    yes: { type: 'boolean', default: false },
  },
});

const COMMANDS = ['migrate', 'verify', 'freeze', 'unfreeze', 'complete'] as const;
type Command = (typeof COMMANDS)[number];
const command = positionals[0] as Command;
const env = opts.env ?? '';
if (!COMMANDS.includes(command) || !['staging', 'production'].includes(env)) {
  console.error(`Usage: npx tsx src/migrate-account.ts <${COMMANDS.join('|')}> --env <staging|production> [--dry-run] [--final] [--yes]`);
  process.exit(1);
}
const DRY_RUN = opts['dry-run'];
const writes = command !== 'verify' && !(command === 'migrate' && DRY_RUN);
if (writes && env === 'production' && !opts.yes) {
  console.error(`Refusing to run "${command}" against production without --yes.`);
  process.exit(1);
}

const sourcePrefix = opts['source-prefix'] ?? `pawsitivemileage-${env}`;
const targetPrefix = opts['target-prefix'] ?? `pawsitivemileage-app-${env}`;
const mappingOut = opts['mapping-out'] ?? join(homedir(), '.pawsitivemileage-migration', `${env}-user-map.json`);
/** Set in the target account by `complete`; while present, `migrate` refuses to run */
const LOCK_PARAMETER = `/pawsitivemileage/${env}/migration/cutover-complete`;

const clients = (profile: string) => ({
  profile,
  sts: new STSClient({ region: REGION, profile }),
  ddb: new DynamoDBClient({ region: REGION, profile }),
  cognito: new CognitoIdentityProviderClient({ region: REGION, profile }),
  s3: new S3Client({ region: REGION, profile }),
  lambda: new LambdaClient({ region: REGION, profile }),
  ssm: new SSMClient({ region: REGION, profile }),
});
const source = clients(opts['source-profile']!);
const target = clients(opts['target-profile']!);
type Side = typeof source;

// ── Helpers ─────────────────────────────────────────────────────────────────

/** Mask emails in console output: someone@gmail.com → s***@gmail.com */
const mask = (email: string) => email.replace(/^(.).*(@.*)$/, '$1***$2');
const attr = (attrs: AttributeType[] | undefined, name: string) => attrs?.find((a) => a.Name === name)?.Value;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const chunks = <T>(list: T[], size: number): T[][] =>
  Array.from({ length: Math.ceil(list.length / size) }, (_, i) => list.slice(i * size, i * size + size));

async function assertAccount(side: Side, expected: string, label: string): Promise<void> {
  const { Account } = await side.sts.send(new GetCallerIdentityCommand({}));
  if (Account !== expected) {
    throw new Error(`${label} profile "${side.profile}" is account ${Account}, expected ${expected}`);
  }
  console.log(`  ${label}: ${Account} (profile ${side.profile})`);
}

async function findPoolId(side: Side, name: string): Promise<string> {
  for await (const page of paginateListUserPools({ client: side.cognito }, { MaxResults: 60 })) {
    const pool = page.UserPools?.find((p) => p.Name === name);
    if (pool?.Id) return pool.Id;
  }
  throw new Error(`User pool "${name}" not found in ${side.profile}`);
}

async function listUsers(side: Side, poolId: string): Promise<UserType[]> {
  const users: UserType[] = [];
  for await (const page of paginateListUsers({ client: side.cognito }, { UserPoolId: poolId })) users.push(...(page.Users ?? []));
  return users;
}

async function scanTable(side: Side, name: string): Promise<Item[]> {
  const items: Item[] = [];
  // ConsistentRead so verify sees writes made moments earlier
  for await (const page of paginateScan({ client: side.ddb }, { TableName: name, ConsistentRead: true })) items.push(...(page.Items ?? []));
  return items;
}

async function listObjects(side: Side, bucket: string): Promise<_Object[]> {
  const objects: _Object[] = [];
  for await (const page of paginateListObjectsV2({ client: side.s3 }, { Bucket: bucket })) objects.push(...(page.Contents ?? []));
  return objects;
}

async function sourceFunctionNames(): Promise<string[]> {
  const names: string[] = [];
  for await (const page of paginateListFunctions({ client: source.lambda }, {})) {
    for (const fn of page.Functions ?? []) if (fn.FunctionName?.startsWith(`${sourcePrefix}-`)) names.push(fn.FunctionName);
  }
  if (!names.length) throw new Error(`No Lambda functions named ${sourcePrefix}-* in the source account`);
  return names;
}

async function lockedAt(): Promise<string | undefined> {
  try {
    const { Parameter } = await target.ssm.send(new GetParameterCommand({ Name: LOCK_PARAMETER }));
    return Parameter?.Value;
  } catch (err) {
    if ((err as Error).name === 'ParameterNotFound') return undefined;
    throw err;
  }
}

interface Identity { providerName: string; userId: string }
const identities = (attrs: AttributeType[] | undefined): Identity[] =>
  JSON.parse(attr(attrs, 'identities') ?? '[]') as Identity[];

/** Google user ID of a federated user, from `identities` (fallback: the `Google_<id>` username). */
function googleUserId(user: UserType): string | undefined {
  const google = identities(user.Attributes).find((i) => i.providerName === 'Google');
  if (google) return google.userId;
  return user.Username?.startsWith('Google_') ? user.Username.slice('Google_'.length) : undefined;
}

const isLinked = (attrs: AttributeType[] | undefined, googleId: string) =>
  identities(attrs).some((i) => i.providerName === 'Google' && i.userId === googleId);

interface SourceUser { sub: string; email: string; name?: string; picture?: string; googleId: string }

async function loadSourceUsers(poolId: string): Promise<SourceUser[]> {
  return (await listUsers(source, poolId)).map((u) => {
    const googleId = googleUserId(u);
    const sub = attr(u.Attributes, 'sub');
    const email = attr(u.Attributes, 'email');
    if (!googleId || !sub || !email) {
      throw new Error(`Source user ${u.Username} is not a Google-federated user with sub and email — only Google sign-in users can be migrated`);
    }
    return { sub: sub.toLowerCase(), email, name: attr(u.Attributes, 'name'), picture: attr(u.Attributes, 'picture'), googleId };
  });
}

/**
 * Target-pool state for one source user: the pre-created (native) user it maps to —
 * matched by linked Google identity first, so rehearsal users are found on every
 * re-run, then by email — and a separate federated `Google_<id>` user left behind by
 * a sign-in before the identity was linked, if any.
 */
function matchTargetUser(user: SourceUser, targetUsers: UserType[]) {
  const natives = targetUsers.filter((u) => u.UserStatus !== 'EXTERNAL_PROVIDER');
  const native = natives.find((u) => isLinked(u.Attributes, user.googleId))
    ?? natives.find((u) => attr(u.Attributes, 'email')?.toLowerCase() === user.email.toLowerCase());
  const federated = targetUsers.find((u) => u.UserStatus === 'EXTERNAL_PROVIDER' && googleUserId(u) === user.googleId);
  return { native, federated };
}

/** A strong random password nobody knows — password sign-in isn't enabled on the app client. */
const unusablePassword = () => `${randomBytes(48).toString('base64url')}aA1!`;

// ── Context shared by commands ──────────────────────────────────────────────

async function loadContext() {
  console.log('Accounts');
  await assertAccount(source, opts['source-account']!, 'source');
  await assertAccount(target, opts['target-account']!, 'target');
  if (opts['source-account'] === opts['target-account']) throw new Error('Source and target accounts must differ');

  const sourcePoolId = await findPoolId(source, `${sourcePrefix}-userpool`);
  const targetPoolId = await findPoolId(target, `${targetPrefix}-userpool`);
  const sourceBucket = `${sourcePrefix}-photos`;
  const targetBucket = `${targetPrefix}-photos`;
  for (const table of TABLES) await target.ddb.send(new DescribeTableCommand({ TableName: tableName(table, env) }));
  console.log(`  pools:   ${sourcePoolId} → ${targetPoolId}`);
  console.log(`  photos:  ${sourceBucket} → ${targetBucket}`);
  console.log(`  tables:  pawsitivemileage-<table>-${env} (both accounts)`);
  return { sourcePoolId, targetPoolId, sourceBucket, targetBucket };
}

type Context = Awaited<ReturnType<typeof loadContext>>;

// ── migrate ─────────────────────────────────────────────────────────────────

async function migrate(ctx: Context): Promise<void> {
  const locked = await lockedAt();
  if (locked) {
    throw new Error(`Cutover for ${env} was completed at ${locked} (${LOCK_PARAMETER}). The target is live — migrating again would overwrite real data.`);
  }
  if (opts.final) {
    const unfrozen: string[] = [];
    for (const FunctionName of await sourceFunctionNames()) {
      const { ReservedConcurrentExecutions } = await source.lambda.send(new GetFunctionConcurrencyCommand({ FunctionName }));
      if (ReservedConcurrentExecutions !== 0) unfrozen.push(FunctionName);
    }
    if (unfrozen.length) throw new Error(`--final requires a frozen source; still accepting writes:\n  ${unfrozen.join('\n  ')}\nRun: freeze --env ${env}`);
    console.log('  source:  frozen ✔');
  } else {
    console.log('  source:  live (rehearsal — writes during the run may show up as differences in verify)');
  }

  const sourceUsers = await loadSourceUsers(ctx.sourcePoolId);
  const knownSubs = new Set(sourceUsers.map((u) => u.sub));
  console.log(`\nSource: ${sourceUsers.length} users`);

  // 1. Validate source data before changing anything
  const sourceData = new Map<TableName, Item[]>();
  const orphans: string[] = [];
  for (const table of TABLES) {
    const items = await scanTable(source, tableName(table, env));
    sourceData.set(table, items);
    for (const item of items) {
      for (const p of findUnmappedUserIds(table, item, knownSubs)) orphans.push(`${table}.${p.attribute} = ${p.value}`);
    }
  }
  const sourceObjects = await listObjects(source, ctx.sourceBucket);
  for (const o of sourceObjects) if (!knownSubs.has(s3KeyOwner(o.Key!).toLowerCase())) orphans.push(`s3://${ctx.sourceBucket}/${o.Key}`);
  if (orphans.length) {
    throw new Error(`Data owned by users missing from the source pool:\n  ${orphans.join('\n  ')}`);
  }
  for (const table of TABLES) console.log(`  ${table.padEnd(12)} ${sourceData.get(table)!.length} items`);
  console.log(`  photos       ${sourceObjects.length} objects`);

  // 2. Users: remove pre-link sign-in leftovers, find-or-create, link Google identity
  console.log('\nUsers');
  let targetUsers = await listUsers(target, ctx.targetPoolId);
  const map = new Map<string, string>();
  const mappingRecord: Array<{ email: string; oldSub: string; newSub: string; googleId: string }> = [];
  const matchedUsernames = new Set<string>();

  for (const user of sourceUsers) {
    const label = mask(user.email);
    const { native, federated } = matchTargetUser(user, targetUsers);

    // A federated Google_<id> user blocks linking; its data (if any) is removed by the mirror step below
    if (federated) {
      if (DRY_RUN) {
        console.log(`  ${label}: would remove separate Google user ${federated.Username} (signed in before linking)`);
      } else {
        await target.cognito.send(new AdminDeleteUserCommand({ UserPoolId: ctx.targetPoolId, Username: federated.Username! }));
        targetUsers = targetUsers.filter((u) => u.Username !== federated.Username);
        console.log(`  ${label}: removed separate Google user ${federated.Username} (signed in before linking)`);
      }
    }

    let nativeUser = native;
    if (!nativeUser) {
      if (DRY_RUN) {
        console.log(`  ${label}: would create user and link Google identity`);
        map.set(user.sub, `pending-${user.sub}`); // placeholder so dry-run counts stay accurate
        continue;
      }
      const { User } = await target.cognito.send(new AdminCreateUserCommand({
        UserPoolId: ctx.targetPoolId,
        Username: user.email,
        MessageAction: 'SUPPRESS',
        UserAttributes: [
          { Name: 'email', Value: user.email },
          { Name: 'email_verified', Value: 'true' },
          ...(user.name ? [{ Name: 'name', Value: user.name }] : []),
          ...(user.picture ? [{ Name: 'picture', Value: user.picture }] : []),
        ],
      }));
      nativeUser = User!;
      console.log(`  ${label}: created`);
    }
    matchedUsernames.add(nativeUser.Username!);

    if (nativeUser.UserStatus !== 'CONFIRMED' && !DRY_RUN) {
      await target.cognito.send(new AdminSetUserPasswordCommand({
        UserPoolId: ctx.targetPoolId, Username: nativeUser.Username!, Password: unusablePassword(), Permanent: true,
      }));
    }

    const current = await target.cognito.send(new AdminGetUserCommand({ UserPoolId: ctx.targetPoolId, Username: nativeUser.Username! }));
    if (isLinked(current.UserAttributes, user.googleId)) {
      console.log(`  ${label}: linked ✔`);
    } else if (DRY_RUN) {
      console.log(`  ${label}: would link Google identity to existing user`);
    } else {
      await target.cognito.send(new AdminLinkProviderForUserCommand({
        UserPoolId: ctx.targetPoolId,
        DestinationUser: { ProviderName: 'Cognito', ProviderAttributeValue: nativeUser.Username! },
        SourceUser: { ProviderName: 'Google', ProviderAttributeName: 'Cognito_Subject', ProviderAttributeValue: user.googleId },
      }));
      console.log(`  ${label}: linked Google identity`);
    }

    const newSub = attr(current.UserAttributes, 'sub')!.toLowerCase();
    map.set(user.sub, newSub);
    mappingRecord.push({ email: user.email, oldSub: user.sub, newSub, googleId: user.googleId });
  }
  const unmatched = targetUsers.filter((u) => u.UserStatus !== 'EXTERNAL_PROVIDER' && !matchedUsernames.has(u.Username!));
  const strayFederated = targetUsers.filter((u) => u.UserStatus === 'EXTERNAL_PROVIDER'
    && !sourceUsers.some((s) => s.googleId === googleUserId(u)));
  if (unmatched.length + strayFederated.length) {
    console.log(`  note: ${unmatched.length + strayFederated.length} target user(s) aren't in the source; they stay in the pool, but their data is removed by the mirror`);
  }

  if (!DRY_RUN) {
    mkdirSync(dirname(mappingOut), { recursive: true, mode: 0o700 });
    writeFileSync(mappingOut, JSON.stringify({ env, migratedAt: new Date().toISOString(), users: mappingRecord }, null, 2) + '\n');
    chmodSync(mappingOut, 0o600);
    console.log(`  mapping written to ${mappingOut}`);
  }

  // 3. Tables — write every source item, then delete target items that didn't come from the source
  console.log('\nTables');
  for (const table of TABLES) {
    const name = tableName(table, env);
    const items = sourceData.get(table)!.map((item) => remapItem(item, map));
    const expectedKeys = new Set(items.map((item) => keyString(table, item)));
    const stale = (await scanTable(target, name)).filter((item) => !expectedKeys.has(keyString(table, item)));
    if (DRY_RUN) {
      console.log(`  ${table.padEnd(12)} would write ${items.length}, delete ${stale.length}`);
      continue;
    }
    await batchWrite(name, items.map((Item) => ({ PutRequest: { Item } })));
    await batchWrite(name, stale.map((item) => ({
      DeleteRequest: { Key: Object.fromEntries(KEY_ATTRS[table].map((k) => [k, item[k]])) },
    })));
    console.log(`  ${table.padEnd(12)} wrote ${items.length}, deleted ${stale.length}`);
  }
  const otherUuids = new Set([...sourceData.values()].flat().flatMap((item) => unmappedUuids(item, map)));
  if (otherUuids.size) console.log(`  note: ${otherUuids.size} UUID(s) in data aren't user IDs (e.g. photo filenames) and are left unchanged`);

  // 4. Photos — copy new/changed objects, then delete target objects that didn't come from the source
  console.log('\nPhotos');
  const targetObjects = new Map((await listObjects(target, ctx.targetBucket)).map((o) => [o.Key!, o]));
  const expectedKeys = new Set<string>();
  let copied = 0;
  let unchanged = 0;
  for (const object of sourceObjects) {
    const newKey = remapString(object.Key!, map);
    expectedKeys.add(newKey);
    const existing = targetObjects.get(newKey);
    if (existing?.ETag === object.ETag && existing?.Size === object.Size) {
      unchanged++;
      continue;
    }
    copied++;
    if (DRY_RUN) continue;
    const got = await source.s3.send(new GetObjectCommand({ Bucket: ctx.sourceBucket, Key: object.Key! }));
    await target.s3.send(new PutObjectCommand({
      Bucket: ctx.targetBucket,
      Key: newKey,
      Body: await got.Body!.transformToByteArray(),
      ContentType: got.ContentType,
      CacheControl: got.CacheControl,
      ContentDisposition: got.ContentDisposition,
      Metadata: got.Metadata,
    }));
  }
  const staleObjects = [...targetObjects.keys()].filter((key) => !expectedKeys.has(key));
  if (!DRY_RUN) {
    for (const batch of chunks(staleObjects, 1000)) {
      const { Errors } = await target.s3.send(new DeleteObjectsCommand({
        Bucket: ctx.targetBucket, Delete: { Objects: batch.map((Key) => ({ Key })), Quiet: true },
      }));
      if (Errors?.length) throw new Error(`Failed to delete ${Errors.length} stale photo(s): ${Errors[0].Key} ${Errors[0].Message}`);
    }
  }
  console.log(`  ${DRY_RUN ? 'would copy' : 'copied'} ${copied}, unchanged ${unchanged}, ${DRY_RUN ? 'would delete' : 'deleted'} ${staleObjects.length}`);

  if (DRY_RUN) {
    console.log('\nDry run complete — nothing was written.');
    return;
  }
  await verify(ctx);
}

async function batchWrite(name: string, requests: WriteRequest[]): Promise<void> {
  for (const batch of chunks(requests, 25)) {
    let pending = batch;
    for (let attempt = 0; pending.length; attempt++) {
      if (attempt > 8) throw new Error(`${name}: gave up on ${pending.length} unprocessed items`);
      if (attempt) await sleep(100 * 2 ** attempt);
      const { UnprocessedItems } = await target.ddb.send(new BatchWriteItemCommand({ RequestItems: { [name]: pending } }));
      pending = UnprocessedItems?.[name] ?? [];
    }
  }
}

// ── verify ──────────────────────────────────────────────────────────────────

/** Returns true when the target mirrors the source exactly. */
async function verify(ctx: Context): Promise<boolean> {
  console.log('\nVerify');
  const sourceUsers = await loadSourceUsers(ctx.sourcePoolId);
  const targetUsers = await listUsers(target, ctx.targetPoolId);
  const problems: string[] = [];
  const map = new Map<string, string>();

  for (const user of sourceUsers) {
    const { native, federated } = matchTargetUser(user, targetUsers);
    const label = mask(user.email);
    if (!native) { problems.push(`${label}: no user in target pool`); continue; }
    if (!isLinked(native.Attributes, user.googleId)) problems.push(`${label}: Google identity not linked`);
    if (federated) problems.push(`${label}: separate Google user ${federated.Username} exists (sign-ins would bypass the link)`);
    map.set(user.sub, attr(native.Attributes, 'sub')!.toLowerCase());
  }
  console.log(`  users        ${map.size}/${sourceUsers.length} mapped and linked`);

  const perUser = new Map<string, Record<string, number>>();
  for (const table of TABLES) {
    const expected = new Map((await scanTable(source, tableName(table, env)))
      .map((item) => remapItem(item, map)).map((item) => [keyString(table, item), canonical(item)]));
    const actual = new Map((await scanTable(target, tableName(table, env))).map((item) => [keyString(table, item), item]));
    let missing = 0, different = 0, extra = 0;
    for (const [key, want] of expected) {
      const got = actual.get(key);
      if (!got) missing++;
      else if (canonical(got) !== want) different++;
    }
    for (const [key, item] of actual) {
      if (!expected.has(key)) extra++;
      const owner = item.userId?.S ?? item.ownerUserId?.S;
      if (owner) {
        const counts = perUser.get(owner) ?? {};
        counts[table] = (counts[table] ?? 0) + 1;
        perUser.set(owner, counts);
      }
    }
    console.log(`  ${table.padEnd(12)} source ${expected.size}, target ${actual.size}, missing ${missing}, different ${different}, extra ${extra}`);
    if (missing || different || extra) problems.push(`${table}: ${missing} missing, ${different} different, ${extra} extra`);
  }

  const targetObjects = new Map((await listObjects(target, ctx.targetBucket)).map((o) => [o.Key!, o]));
  const sourceObjects = await listObjects(source, ctx.sourceBucket);
  const expectedKeys = new Set<string>();
  let photoProblems = 0;
  for (const object of sourceObjects) {
    const key = remapString(object.Key!, map);
    expectedKeys.add(key);
    const got = targetObjects.get(key);
    const sameEtag = object.ETag?.includes('-') || got?.ETag === object.ETag; // multipart ETags aren't content hashes
    if (!got || got.Size !== object.Size || !sameEtag) photoProblems++;
  }
  const extraPhotos = [...targetObjects.keys()].filter((key) => !expectedKeys.has(key)).length;
  console.log(`  photos       source ${sourceObjects.length}, target ${targetObjects.size}, missing/different ${photoProblems}, extra ${extraPhotos}`);
  if (photoProblems || extraPhotos) problems.push(`photos: ${photoProblems} missing or different, ${extraPhotos} extra`);

  const byNewSub = new Map([...map].map(([oldSub, newSub]) => [newSub, sourceUsers.find((u) => u.sub === oldSub)!]));
  for (const [owner, counts] of perUser) {
    const who = byNewSub.get(owner.toLowerCase());
    console.log(`    ${who ? mask(who.email) : owner}: ${Object.entries(counts).map(([t, n]) => `${t} ${n}`).join(', ')}`);
  }

  const locked = await lockedAt();
  console.log(`  lock         ${locked ? `cutover completed ${locked}` : 'not set (target can still be re-migrated)'}`);

  if (problems.length) {
    console.error(`\nVERIFY FAILED:\n  ${problems.join('\n  ')}`);
    process.exitCode = 2;
    return false;
  }
  console.log('\nVerify passed — target mirrors source.');
  return true;
}

// ── freeze / unfreeze / complete ────────────────────────────────────────────

async function setSourceFrozen(frozen: boolean): Promise<void> {
  await assertAccount(source, opts['source-account']!, 'source');
  const names = await sourceFunctionNames();
  for (const FunctionName of names) {
    if (frozen) await source.lambda.send(new PutFunctionConcurrencyCommand({ FunctionName, ReservedConcurrentExecutions: 0 }));
    else await source.lambda.send(new DeleteFunctionConcurrencyCommand({ FunctionName }));
    console.log(`  ${frozen ? 'frozen' : 'unfrozen'}: ${FunctionName}`);
  }
  console.log(frozen
    ? `\n${names.length} source functions frozen — the old app's API now rejects every call.`
    : `\n${names.length} source functions unfrozen — the old app accepts writes again.`);
}

async function complete(ctx: Context): Promise<void> {
  if (!(await verify(ctx))) throw new Error('Not locking: verify must pass first.');
  const at = new Date().toISOString();
  await target.ssm.send(new PutParameterCommand({
    Name: LOCK_PARAMETER,
    Value: at,
    Type: 'String',
    Description: 'PawsitiveMileage account migration cutover completed; migrate-account.ts refuses to run while set',
  }));
  console.log(`\nLocked: ${LOCK_PARAMETER} = ${at}. migrate will refuse to run for ${env}.`);
}

// ── main ────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log(`${command} — ${env}${DRY_RUN ? ' (dry run)' : ''}${opts.final ? ' (final)' : ''}\n`);
  if (command === 'freeze' || command === 'unfreeze') return setSourceFrozen(command === 'freeze');
  const ctx = await loadContext();
  if (command === 'migrate') return migrate(ctx);
  if (command === 'complete') return complete(ctx);
  await verify(ctx);
}

main().catch((err) => {
  console.error(`\nFailed: ${err instanceof Error ? err.message : err}`);
  process.exit(1);
});
