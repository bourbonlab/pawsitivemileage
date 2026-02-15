#!/usr/bin/env npx tsx
/**
 * Backfill GSI2PK / GSI2SK on all fillup items in the Fillups table.
 *
 * The admin stats dashboard queries GSI2 (GSI2PK="FILLUPS", GSI2SK=date)
 * but older fillup items were written without these attributes.
 * This script scans the entire table and adds them where missing.
 *
 * Usage:
 *   FILLUPS_TABLE=pawsitivemileage-fillups-dev npx tsx src/backfill-gsi2.ts
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
  console.error('Usage: FILLUPS_TABLE=pawsitivemileage-fillups-dev npx tsx src/backfill-gsi2.ts');
  process.exit(1);
}

const client = new DynamoDBClient({ region: REGION });
const docClient = DynamoDBDocumentClient.from(client);

interface FillupItem {
  vehicleId: string;
  fillupDateId: string;
  date?: string;
  GSI2PK?: string;
  GSI2SK?: string;
}

async function run(): Promise<void> {
  console.log(`Backfilling GSI2 attributes on table: ${TABLE_NAME}`);
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
      ProjectionExpression: 'vehicleId, fillupDateId, #d, GSI2PK, GSI2SK',
      ExpressionAttributeNames: { '#d': 'date' },
      ExclusiveStartKey: lastKey,
    }));

    const items = (result.Items ?? []) as FillupItem[];
    scanned += items.length;

    for (const item of items) {
      // Already has GSI2 attributes — skip
      if (item.GSI2PK && item.GSI2SK) {
        skipped++;
        continue;
      }

      // Extract date from the item or from the sort key (fillupDateId = "YYYY-MM-DD#ulid")
      const date = item.date ?? item.fillupDateId?.split('#')[0];
      if (!date) {
        console.warn(`  SKIP (no date): vehicleId=${item.vehicleId} fillupDateId=${item.fillupDateId}`);
        skipped++;
        continue;
      }

      if (DRY_RUN) {
        console.log(`  Would update: vehicleId=${item.vehicleId} fillupDateId=${item.fillupDateId} → GSI2SK=${date}`);
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
          UpdateExpression: 'SET GSI2PK = :pk, GSI2SK = :sk',
          ExpressionAttributeValues: {
            ':pk': 'FILLUPS',
            ':sk': date,
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
