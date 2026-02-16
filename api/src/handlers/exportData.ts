import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { GetCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { ulid } from 'ulid';
import { getDocClient, getTableName } from '../lib/dynamo.js';
import { getUserId } from '../lib/auth.js';
import { success, error } from '../lib/response.js';
import { parseBody } from '../lib/validation.js';
import { createLogger } from '../lib/logger.js';
import { uploadObject, getPresignedDownloadUrl } from '../lib/s3.js';
import type { Fillup } from '../types/fillup.js';
import type { MaintenanceRecord } from '../types/maintenance.js';
import type { Vehicle } from '../types/vehicle.js';

const logger = createLogger('exportData');

export const handler = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
  const requestId = event.requestContext?.requestId ?? ulid();
  const userId = getUserId(event as Parameters<typeof getUserId>[0]);

  if (!userId) {
    return error('UNAUTHORIZED', 'Missing authentication', requestId);
  }

  const method = event.requestContext?.http?.method;
  const vehicleId = event.pathParameters?.vehicleId;
  const path = event.rawPath ?? '';

  if (!vehicleId) {
    return error('VALIDATION_ERROR', 'vehicleId is required', requestId);
  }

  try {
    // Verify vehicle ownership
    const vehicle = await getVehicle(userId, vehicleId);
    if (!vehicle) {
      return error('NOT_FOUND', 'Vehicle not found', requestId);
    }

    const startDate = event.queryStringParameters?.startDate ?? null;
    const endDate = event.queryStringParameters?.endDate ?? null;

    // GET /v1/vehicles/{vehicleId}/export/fillups
    if (method === 'GET' && path.endsWith('/export/fillups')) {
      return await handleExportFillups(userId, vehicleId, startDate, endDate, requestId);
    }

    // GET /v1/vehicles/{vehicleId}/export/maintenance
    if (method === 'GET' && path.endsWith('/export/maintenance')) {
      return await handleExportMaintenance(userId, vehicleId, startDate, endDate, requestId);
    }

    // POST /v1/vehicles/{vehicleId}/export/pdf
    if (method === 'POST' && path.endsWith('/export/pdf')) {
      const body = parseBody(event.body);
      const pdfStartDate = (body?.startDate as string) ?? null;
      const pdfEndDate = (body?.endDate as string) ?? null;
      return await handleExportPdf(userId, vehicleId, vehicle, pdfStartDate, pdfEndDate, requestId);
    }

    return error('VALIDATION_ERROR', 'Unsupported operation', requestId);
  } catch (err) {
    logger.error('Unhandled error in exportData', requestId, userId, err);
    return error('INTERNAL_ERROR', 'An internal error occurred', requestId);
  }
};


// ── Helpers ──────────────────────────────────────────────────────────────────

async function getVehicle(userId: string, vehicleId: string): Promise<Vehicle | null> {
  const docClient = getDocClient();
  const tableName = getTableName('VEHICLES_TABLE');
  const result = await docClient.send(new GetCommand({
    TableName: tableName,
    Key: { userId, vehicleId },
  }));
  return (result.Item as Vehicle) ?? null;
}

async function fetchFillups(vehicleId: string, startDate: string | null, endDate: string | null): Promise<Fillup[]> {
  const docClient = getDocClient();
  const tableName = getTableName('FILLUPS_TABLE');
  const items: Fillup[] = [];
  let lastKey: Record<string, unknown> | undefined;

  do {
    const result = await docClient.send(new QueryCommand({
      TableName: tableName,
      KeyConditionExpression: 'vehicleId = :vid',
      ExpressionAttributeValues: { ':vid': vehicleId },
      ExclusiveStartKey: lastKey,
    }));
    if (result.Items) items.push(...(result.Items as Fillup[]));
    lastKey = result.LastEvaluatedKey as Record<string, unknown> | undefined;
  } while (lastKey);

  items.sort((a, b) => a.date.localeCompare(b.date));

  return filterByDateRange(items, (f) => f.date, startDate, endDate);
}

async function fetchMaintenance(vehicleId: string, startDate: string | null, endDate: string | null): Promise<MaintenanceRecord[]> {
  const docClient = getDocClient();
  const tableName = getTableName('MAINTENANCE_TABLE');
  const items: MaintenanceRecord[] = [];
  let lastKey: Record<string, unknown> | undefined;

  do {
    const result = await docClient.send(new QueryCommand({
      TableName: tableName,
      KeyConditionExpression: 'vehicleId = :vid',
      ExpressionAttributeValues: { ':vid': vehicleId },
      ExclusiveStartKey: lastKey,
    }));
    if (result.Items) items.push(...(result.Items as MaintenanceRecord[]));
    lastKey = result.LastEvaluatedKey as Record<string, unknown> | undefined;
  } while (lastKey);

  items.sort((a, b) => a.datePerformed.localeCompare(b.datePerformed));

  return filterByDateRange(items, (m) => m.datePerformed, startDate, endDate);
}

function filterByDateRange<T>(items: T[], getDate: (item: T) => string, startDate: string | null, endDate: string | null): T[] {
  let filtered = items;
  if (startDate) {
    filtered = filtered.filter((item) => getDate(item) >= startDate);
  }
  if (endDate) {
    filtered = filtered.filter((item) => getDate(item) <= endDate);
  }
  return filtered;
}


// ── CSV Helpers ──────────────────────────────────────────────────────────────

/**
 * Escape a CSV field value. Wraps in double quotes if the value contains
 * commas, double quotes, or newlines. Internal double quotes are doubled.
 */
function escapeCsvField(value: unknown): string {
  if (value === null || value === undefined) return '';
  const str = String(value);
  if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function buildCsvRow(values: unknown[]): string {
  return values.map(escapeCsvField).join(',');
}

function getExportsBucket(): string {
  const name = process.env.EXPORTS_BUCKET;
  if (!name) throw new Error('Missing environment variable: EXPORTS_BUCKET');
  return name;
}


// ── Export Fillups CSV ───────────────────────────────────────────────────────

const FILLUP_CSV_HEADERS = [
  'date', 'currencySpent', 'gallonsAdded', 'odometerReading', 'isPartialFill', 'isBusiness',
  'pricePerGallon', 'milesSinceLastFillup', 'mpg', 'costPerMile',
  'daysSinceLastFillup', 'stationName', 'address', 'notes',
];

async function handleExportFillups(
  userId: string,
  vehicleId: string,
  startDate: string | null,
  endDate: string | null,
  requestId: string,
): Promise<APIGatewayProxyResultV2> {
  logger.info('Exporting fillups CSV', requestId, userId);

  const fillups = await fetchFillups(vehicleId, startDate, endDate);

  const rows = [buildCsvRow(FILLUP_CSV_HEADERS)];
  for (const f of fillups) {
    rows.push(buildCsvRow([
      f.date, f.currencySpent, f.gallonsAdded, f.odometerReading, f.isPartialFill, f.isBusiness ?? false,
      f.pricePerGallon, f.milesSinceLastFillup, f.mpg, f.costPerMile,
      f.daysSinceLastFillup, f.stationName ?? '', f.address ?? '', f.notes ?? '',
    ]));
  }

  const csv = rows.join('\n');
  const bucket = getExportsBucket();
  const key = `exports/${userId}/${vehicleId}/fillups-${ulid()}.csv`;

  await uploadObject(bucket, key, csv, 'text/csv');
  const downloadUrl = await getPresignedDownloadUrl(bucket, key);

  return success({ downloadUrl, recordCount: fillups.length }, requestId);
}


// ── Export Maintenance CSV ───────────────────────────────────────────────────

const MAINTENANCE_CSV_HEADERS = [
  'datePerformed', 'schemaName', 'customTypeName', 'odometerAtService',
  'cost', 'location', 'notes',
];

async function handleExportMaintenance(
  userId: string,
  vehicleId: string,
  startDate: string | null,
  endDate: string | null,
  requestId: string,
): Promise<APIGatewayProxyResultV2> {
  logger.info('Exporting maintenance CSV', requestId, userId);

  const records = await fetchMaintenance(vehicleId, startDate, endDate);

  const rows = [buildCsvRow(MAINTENANCE_CSV_HEADERS)];
  for (const m of records) {
    rows.push(buildCsvRow([
      m.datePerformed, m.schemaName ?? '', m.customTypeName ?? '',
      m.odometerAtService, m.cost, m.location ?? '', m.notes ?? '',
    ]));
  }

  const csv = rows.join('\n');
  const bucket = getExportsBucket();
  const key = `exports/${userId}/${vehicleId}/maintenance-${ulid()}.csv`;

  await uploadObject(bucket, key, csv, 'text/csv');
  const downloadUrl = await getPresignedDownloadUrl(bucket, key);

  return success({ downloadUrl, recordCount: records.length }, requestId);
}


// ── Export PDF Report ────────────────────────────────────────────────────────

async function handleExportPdf(
  userId: string,
  vehicleId: string,
  vehicle: Vehicle,
  startDate: string | null,
  endDate: string | null,
  requestId: string,
): Promise<APIGatewayProxyResultV2> {
  logger.info('Generating PDF report data', requestId, userId);

  const [fillups, maintenance] = await Promise.all([
    fetchFillups(vehicleId, startDate, endDate),
    fetchMaintenance(vehicleId, startDate, endDate),
  ]);

  // Fuel summary
  const totalFuelSpent = fillups.reduce((sum, f) => sum + f.currencySpent, 0);
  const totalGallons = fillups.reduce((sum, f) => sum + f.gallonsAdded, 0);
  const mpgValues = fillups.filter((f) => f.mpg !== null && f.mpg !== undefined).map((f) => f.mpg as number);
  const averageMpg = mpgValues.length > 0
    ? mpgValues.reduce((sum, v) => sum + v, 0) / mpgValues.length
    : null;

  let totalMiles = 0;
  if (fillups.length >= 2) {
    const odometers = fillups.map((f) => f.odometerReading);
    totalMiles = Math.max(...odometers) - Math.min(...odometers);
  }

  // Maintenance summary
  const totalMaintenanceCost = maintenance.reduce((sum, m) => sum + m.cost, 0);

  // Monthly spending breakdown
  const monthlySpending = new Map<string, number>();
  for (const f of fillups) {
    const month = f.date.slice(0, 7);
    monthlySpending.set(month, (monthlySpending.get(month) ?? 0) + f.currencySpent);
  }

  // MPG over time for chart data
  const mpgOverTime = fillups
    .filter((f) => f.mpg !== null && f.mpg !== undefined)
    .map((f) => ({ date: f.date, mpg: f.mpg as number }));

  const reportData = {
    vehicle: {
      nickname: vehicle.nickname,
      make: vehicle.make,
      model: vehicle.model,
      year: vehicle.year,
    },
    dateRange: {
      startDate: startDate ?? (fillups.length > 0 ? fillups[0].date : null),
      endDate: endDate ?? (fillups.length > 0 ? fillups[fillups.length - 1].date : null),
    },
    fuelSummary: {
      totalSpent: Math.round(totalFuelSpent * 100) / 100,
      totalGallons: Math.round(totalGallons * 100) / 100,
      averageMpg: averageMpg !== null ? Math.round(averageMpg * 100) / 100 : null,
      totalMiles,
      fillupCount: fillups.length,
    },
    maintenanceSummary: {
      totalCost: Math.round(totalMaintenanceCost * 100) / 100,
      recordCount: maintenance.length,
    },
    charts: {
      mpgOverTime,
      monthlySpending: Array.from(monthlySpending.entries())
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([month, totalSpent]) => ({ month, totalSpent: Math.round(totalSpent * 100) / 100 })),
    },
    note: 'PDF rendering is handled client-side. Use this structured data to generate the PDF report.',
  };

  // Store the report JSON in S3 as well for later retrieval
  const bucket = getExportsBucket();
  const key = `exports/${userId}/${vehicleId}/report-${ulid()}.json`;
  await uploadObject(bucket, key, JSON.stringify(reportData), 'application/json');
  const downloadUrl = await getPresignedDownloadUrl(bucket, key);

  return success({ ...reportData, downloadUrl }, requestId);
}
