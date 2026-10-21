#!/usr/bin/env npx tsx
/**
 * Relocate photo-bucket files stored under someone other than the vehicle owner (#2).
 *
 * Uploads have been stored under the vehicle owner's ID since Gitea PR #27. Receipts that a
 * shared user uploaded before that are still under the uploader's ID, so deleting the uploader's
 * account would delete the owner's receipt. This moves each one under the owner.
 *
 * Read-only by default: it lists the misplaced references. With --fix, for each one it:
 *   1. copies the object to {owner}/{vehicleId}/{type}/{ulid}-{filename}, keeping Content-Type and metadata
 *   2. points the record at the new key (conditional on it still holding the old key)
 *   3. deletes the old object once no record references it
 * Re-running is safe: moved references are under the owner, so nothing is left to do.
 *
 * Run it against the new account only (376784708284), after the cutover.
 *
 * Usage (from cli/):
 *   npx tsx src/relocate-files.ts --env production              # scan
 *   npx tsx src/relocate-files.ts --env production --fix --yes  # move
 */
import { parseArgs } from 'node:util';
import { CopyObjectCommand, DeleteObjectCommand, HeadObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, ScanCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { GetCallerIdentityCommand, STSClient } from '@aws-sdk/client-sts';
import { ulid } from 'ulid';
import { deletableKeys, planMoves, type KeyField, type Move, type Reference } from './relocate/plan.js';

const TARGET_ACCOUNT = '376784708284';

const { values: opts } = parseArgs({
  options: {
    env: { type: 'string', default: 'staging' },
    profile: { type: 'string', default: 'pawsitivemileage' },
    fix: { type: 'boolean', default: false },
    yes: { type: 'boolean', default: false },
  },
});
const env = opts.env!;
if (opts.fix && env === 'production' && !opts.yes) {
  console.error('Refusing to change production without --yes.');
  process.exit(1);
}

const region = 'us-east-1';
const credentials = { region, profile: opts.profile };
const db = DynamoDBDocumentClient.from(new DynamoDBClient(credentials));
const s3 = new S3Client(credentials);
const table = (name: string) => `pawsitivemileage-${name}-${env}`;
const bucket = `pawsitivemileage-app-${env}-photos`;
const short = (key: string) => key.replace(/^([0-9a-f]{8})[0-9a-f-]{28}/, '$1…');

async function scanAll(tableName: string, projection: string): Promise<Array<Record<string, any>>> {
  const items: Array<Record<string, any>> = [];
  let ExclusiveStartKey: Record<string, unknown> | undefined;
  do {
    const page = await db.send(new ScanCommand({ TableName: tableName, ProjectionExpression: projection, ExclusiveStartKey }));
    items.push(...(page.Items ?? []));
    ExclusiveStartKey = page.LastEvaluatedKey;
  } while (ExclusiveStartKey);
  return items;
}

async function references(): Promise<{ refs: Reference[]; ownerOf: Map<string, string> }> {
  const [vehicles, fillups, maintenance] = await Promise.all([
    scanAll(table('vehicles'), 'userId, vehicleId, photoKey'),
    scanAll(table('fillups'), 'vehicleId, fillupDateId, fillupId, receiptPhotoKey'),
    scanAll(table('maintenance'), 'vehicleId, serviceDateId, recordId, receiptPhotoKey'),
  ]);
  const ownerOf = new Map(vehicles.map((v) => [v.vehicleId as string, v.userId as string]));
  const refs: Reference[] = [];
  const add = (t: Reference['table'], key: Record<string, string>, id: string, vehicleId: string, field: KeyField, objectKey: unknown) => {
    if (typeof objectKey === 'string' && objectKey) refs.push({ table: t, key, id, vehicleId, field, objectKey });
  };
  for (const v of vehicles) add('vehicles', { userId: v.userId, vehicleId: v.vehicleId }, v.vehicleId, v.vehicleId, 'photoKey', v.photoKey);
  for (const f of fillups) add('fillups', { vehicleId: f.vehicleId, fillupDateId: f.fillupDateId }, f.fillupId, f.vehicleId, 'receiptPhotoKey', f.receiptPhotoKey);
  for (const m of maintenance) add('maintenance', { vehicleId: m.vehicleId, serviceDateId: m.serviceDateId }, m.recordId, m.vehicleId, 'receiptPhotoKey', m.receiptPhotoKey);
  return { refs, ownerOf };
}

const copySource = (key: string) => `${bucket}/${key.split('/').map(encodeURIComponent).join('/')}`;

async function objectExists(key: string): Promise<boolean> {
  try {
    await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
    return true;
  } catch (err) {
    if ((err as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode === 404) return false;
    throw err;
  }
}

async function apply(move: Move): Promise<'moved' | 'missing' | 'changed'> {
  if (!(await objectExists(move.newKey))) {
    if (!(await objectExists(move.objectKey))) return 'missing';
    await s3.send(new CopyObjectCommand({ Bucket: bucket, Key: move.newKey, CopySource: copySource(move.objectKey), MetadataDirective: 'COPY' }));
  }
  try {
    await db.send(new UpdateCommand({
      TableName: table(move.table),
      Key: move.key,
      UpdateExpression: 'SET #field = :new',
      ConditionExpression: '#field = :old',
      ExpressionAttributeNames: { '#field': move.field },
      ExpressionAttributeValues: { ':new': move.newKey, ':old': move.objectKey },
    }));
    return 'moved';
  } catch (err) {
    if ((err as Error).name === 'ConditionalCheckFailedException') return 'changed';
    throw err;
  }
}

async function main(): Promise<void> {
  const identity = await new STSClient(credentials).send(new GetCallerIdentityCommand({}));
  if (identity.Account !== TARGET_ACCOUNT) throw new Error(`Profile ${opts.profile} is account ${identity.Account}, not ${TARGET_ACCOUNT}`);
  console.log(`relocate-files — ${env}${opts.fix ? ' (fix)' : ' (scan only)'}\n  bucket: ${bucket}\n`);

  const { refs, ownerOf } = await references();
  const { moves, orphaned } = planMoves(refs, ownerOf, ulid);
  console.log(`${refs.length} file reference(s): ${moves.length} not under the vehicle owner, ${orphaned.length} on a vehicle that no longer exists.`);
  for (const m of moves) console.log(`  ${m.table} ${m.id} ${m.field}: ${short(m.objectKey)} → ${short(m.newKey)}`);
  for (const r of orphaned) console.log(`  orphaned: ${r.table} ${r.id} ${r.field} (vehicle ${r.vehicleId} not found)`);

  if (!opts.fix || moves.length === 0) {
    if (moves.length) console.log('\nRun again with --fix to move them.');
    return;
  }

  const results = { moved: 0, missing: 0, changed: 0 };
  const done: Move[] = [];
  for (const move of moves) {
    const outcome = await apply(move);
    results[outcome]++;
    if (outcome === 'moved') done.push(move);
    else console.log(`  skipped ${move.table} ${move.id}: ${outcome === 'missing' ? 'the file no longer exists' : 'the record changed since the scan'}`);
  }
  // Delete old objects only when no record still points at them (re-scan to be sure)
  const after = await references();
  const stale = deletableKeys(done, after.refs).filter((key) => !after.refs.some((r) => r.objectKey === key));
  for (const key of stale) await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
  console.log(`\nMoved ${results.moved}, skipped ${results.missing + results.changed}; deleted ${stale.length} old object(s).`);
}

main().catch((err) => {
  console.error(`\nFailed: ${err instanceof Error ? err.message : err}`);
  process.exit(1);
});
