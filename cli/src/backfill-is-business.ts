#!/usr/bin/env npx tsx
/**
 * Backfill isBusiness=false on all fillup items in the Fillups table.
 *
 * Existing fillups were created before the isBusiness field was added.
 * This script scans the entire table and sets isBusiness=false where missing.
 *
 * Usage:
 *   FILLUPS_TABLE=pawsitivemileage-fillups-dev npx tsx src/backfill-is-business.ts
 *
 * Optional:
 *   AWS_REGION=us-east-1 (defaults to us-east-1)
 *   DRY_RUN=true         (preview changes without writing)
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, ScanCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';

const TABLE_NAME = process.env.FILLUPS_TABLE;
const REGION = process.env.AWS_REGION ?? 'us-east-1';
const DRY_RUN = process.env.DRY_RUN === 'true';

if (!TABLE_NAME) {
  console.error('Error: FILLUPS_TABLE environment variable is required.');
  console.error('Usage: FILLUPS_TABLE=pawsitivemileage-fillups-dev npx tsx src/backfill-is-business.ts');
  process.exit(1);
}

const client = new DynamoDBClient({ region: REGION });
const docClient = DynamoDBDocumentClient.from(client);

interface FillupItem {
  vehicleId: string;
  fillupDateId: string;
  isBusiness?: boolean;
}

async function run(): Promise<void> {
  console.log(`Backfilling isBusiness=false on table: ${TABLE_NAME}`);
  console.log(`Region: ${REGION}`);
  if (DRY_RUN) console.log('DRY RUN — no writes will be performed.\n');

  let scanned = 0;
  let updated = 0;
  let skipped = 0;
  let errors = 0;
  let lastKey: Record<string, unknown> | undefined;

  do {
    const result = await docClient.send(new ScanCommand({
      TableName: TABLE_NAME,
      ProjectionExpression: 'vehicleId, fillupDateId, isBusiness',
      ExclusiveStartKey: lastKey,
    }));

    const items = (result.Items ?? []) as FillupItem[];
    scanned += items.length;

    for (const item of items) {
      if (item.isBusiness !== undefined) {
        skipped++;
        continue;
      }

      if (DRY_RUN) {
        console.log(`  Would update: vehicleId=${item.vehicleId} fillupDateId=${item.fillupDateId} → isBusiness=false`);
        updated++;
        continue;
      }

      try {
        await docClient.send(new UpdateCommand({
          TableName: TABLE_NAME,
          Key: {
            vehicleId: item.vehicleId,
            fillupDateId: item.fillupDateId,
          },
          UpdateExpression: 'SET isBusiness = :val',
          ExpressionAttributeValues: {
            ':val': false,
          },
        }));
        updated++;
      } catch (err) {
        errors++;
        console.error(`  ERROR updating vehicleId=${item.vehicleId} fillupDateId=${item.fillupDateId}:`, err);
      }
    }

    lastKey = result.LastEvaluatedKey;
    process.stdout.write(`\r  Scanned: ${scanned} | Updated: ${updated} | Skipped: ${skipped} | Errors: ${errors}`);
  } while (lastKey);

  console.log('\n\nDone.');
  console.log(`  Total scanned: ${scanned}`);
  console.log(`  Updated:       ${updated}`);
  console.log(`  Skipped:       ${skipped}`);
  console.log(`  Errors:        ${errors}`);
}

run().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
