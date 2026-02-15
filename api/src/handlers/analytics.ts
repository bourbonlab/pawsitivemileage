import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { GetCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { ulid } from 'ulid';
import { getDocClient, getTableName } from '../lib/dynamo.js';
import { getUserId } from '../lib/auth.js';
import { success, error } from '../lib/response.js';
import { parseBody } from '../lib/validation.js';
import { createLogger } from '../lib/logger.js';
import type { Fillup } from '../types/fillup.js';
import type { MaintenanceRecord } from '../types/maintenance.js';
import type { Vehicle } from '../types/vehicle.js';

const logger = createLogger('analytics');

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

    // POST /v1/vehicles/{vehicleId}/summary-card
    if (method === 'POST' && path.endsWith('/summary-card')) {
      return await handleSummaryCard(event, vehicleId, requestId, userId);
    }

    // GET /v1/vehicles/{vehicleId}/analytics/yoy
    if (method === 'GET' && path.endsWith('/analytics/yoy')) {
      return await handleYearOverYear(vehicleId, requestId, userId);
    }

    // GET /v1/vehicles/{vehicleId}/analytics
    if (method === 'GET' && path.endsWith('/analytics')) {
      return await handleDashboard(vehicleId, requestId, userId);
    }

    return error('VALIDATION_ERROR', 'Unsupported operation', requestId);
  } catch (err) {
    logger.error('Unhandled error in analytics', requestId, userId, err);
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

async function fetchAllFillups(vehicleId: string): Promise<Fillup[]> {
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

  // Sort by date ascending (SK is fillupDate#fillupId so query order is correct, but be safe)
  items.sort((a, b) => a.date.localeCompare(b.date));
  return items;
}

async function fetchAllMaintenance(vehicleId: string): Promise<MaintenanceRecord[]> {
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
  return items;
}

function toYearMonth(dateStr: string): string {
  return dateStr.slice(0, 7); // "YYYY-MM"
}

function toYear(dateStr: string): string {
  return dateStr.slice(0, 4); // "YYYY"
}


// ── GET /v1/vehicles/{vehicleId}/analytics ───────────────────────────────────

async function handleDashboard(
  vehicleId: string,
  requestId: string,
  userId: string,
): Promise<APIGatewayProxyResultV2> {
  logger.info('Fetching analytics dashboard', requestId, userId);

  const fillups = await fetchAllFillups(vehicleId);

  // MPG over time — only fillups with non-null mpg
  const mpgOverTime = fillups
    .filter((f) => f.mpg !== null && f.mpg !== undefined)
    .map((f) => ({ date: f.date, mpg: f.mpg as number }));

  // Monthly spending — group by YYYY-MM, sum currencySpent
  const spendingMap = new Map<string, number>();
  for (const f of fillups) {
    const month = toYearMonth(f.date);
    spendingMap.set(month, (spendingMap.get(month) ?? 0) + f.currencySpent);
  }
  const monthlySpending = Array.from(spendingMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, totalSpent]) => ({ month, totalSpent: Math.round(totalSpent * 100) / 100 }));

  // Cost per mile trend — only fillups with non-null costPerMile
  const costPerMileTrend = fillups
    .filter((f) => f.costPerMile !== null && f.costPerMile !== undefined)
    .map((f) => ({ date: f.date, costPerMile: f.costPerMile as number }));

  // Miles per month — compute from odometer differences within each month
  const milesMap = new Map<string, { minOdo: number; maxOdo: number }>();
  for (const f of fillups) {
    const month = toYearMonth(f.date);
    const existing = milesMap.get(month);
    if (!existing) {
      milesMap.set(month, { minOdo: f.odometerReading, maxOdo: f.odometerReading });
    } else {
      existing.minOdo = Math.min(existing.minOdo, f.odometerReading);
      existing.maxOdo = Math.max(existing.maxOdo, f.odometerReading);
    }
  }
  const milesPerMonth = Array.from(milesMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, { minOdo, maxOdo }]) => ({ month, miles: maxOdo - minOdo }));

  // Fillup frequency — count per month
  const freqMap = new Map<string, number>();
  for (const f of fillups) {
    const month = toYearMonth(f.date);
    freqMap.set(month, (freqMap.get(month) ?? 0) + 1);
  }
  const fillupFrequency = Array.from(freqMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, count]) => ({ month, count }));

  return success({
    mpgOverTime,
    monthlySpending,
    costPerMileTrend,
    milesPerMonth,
    fillupFrequency,
  }, requestId);
}


// ── GET /v1/vehicles/{vehicleId}/analytics/yoy ───────────────────────────────

interface YearSummary {
  year: string;
  totalSpent: number;
  totalGallons: number;
  averageMpg: number | null;
  totalMiles: number;
  maintenanceCost: number;
  trends: {
    totalSpent: 'up' | 'down' | 'flat';
    totalGallons: 'up' | 'down' | 'flat';
    averageMpg: 'up' | 'down' | 'flat';
    totalMiles: 'up' | 'down' | 'flat';
    maintenanceCost: 'up' | 'down' | 'flat';
  };
}

function trendIndicator(current: number, previous: number): 'up' | 'down' | 'flat' {
  if (current > previous) return 'up';
  if (current < previous) return 'down';
  return 'flat';
}

async function handleYearOverYear(
  vehicleId: string,
  requestId: string,
  userId: string,
): Promise<APIGatewayProxyResultV2> {
  logger.info('Fetching year-over-year analytics', requestId, userId);

  const [fillups, maintenance] = await Promise.all([
    fetchAllFillups(vehicleId),
    fetchAllMaintenance(vehicleId),
  ]);

  // Group fillups by year
  const fillupsByYear = new Map<string, Fillup[]>();
  for (const f of fillups) {
    const year = toYear(f.date);
    const arr = fillupsByYear.get(year) ?? [];
    arr.push(f);
    fillupsByYear.set(year, arr);
  }

  // Group maintenance by year
  const maintByYear = new Map<string, MaintenanceRecord[]>();
  for (const m of maintenance) {
    const year = toYear(m.datePerformed);
    const arr = maintByYear.get(year) ?? [];
    arr.push(m);
    maintByYear.set(year, arr);
  }

  // Collect all years
  const allYears = new Set([...fillupsByYear.keys(), ...maintByYear.keys()]);
  const sortedYears = Array.from(allYears).sort();

  // Build per-year summaries
  const rawSummaries = sortedYears.map((year) => {
    const yFillups = fillupsByYear.get(year) ?? [];
    const yMaint = maintByYear.get(year) ?? [];

    const totalSpent = yFillups.reduce((sum, f) => sum + f.currencySpent, 0);
    const totalGallons = yFillups.reduce((sum, f) => sum + f.gallonsAdded, 0);

    const mpgValues = yFillups.filter((f) => f.mpg !== null && f.mpg !== undefined).map((f) => f.mpg as number);
    const averageMpg = mpgValues.length > 0
      ? mpgValues.reduce((sum, v) => sum + v, 0) / mpgValues.length
      : null;

    // Total miles: max odometer - min odometer for the year
    let totalMiles = 0;
    if (yFillups.length >= 2) {
      const odometers = yFillups.map((f) => f.odometerReading);
      totalMiles = Math.max(...odometers) - Math.min(...odometers);
    }

    const maintenanceCost = yMaint.reduce((sum, m) => sum + m.cost, 0);

    return {
      year,
      totalSpent: Math.round(totalSpent * 100) / 100,
      totalGallons: Math.round(totalGallons * 100) / 100,
      averageMpg: averageMpg !== null ? Math.round(averageMpg * 100) / 100 : null,
      totalMiles,
      maintenanceCost: Math.round(maintenanceCost * 100) / 100,
    };
  });

  // Add trend indicators (compare to previous year)
  const summaries: YearSummary[] = rawSummaries.map((current, idx) => {
    if (idx === 0) {
      return {
        ...current,
        trends: {
          totalSpent: 'flat' as const,
          totalGallons: 'flat' as const,
          averageMpg: 'flat' as const,
          totalMiles: 'flat' as const,
          maintenanceCost: 'flat' as const,
        },
      };
    }

    const prev = rawSummaries[idx - 1];
    return {
      ...current,
      trends: {
        totalSpent: trendIndicator(current.totalSpent, prev.totalSpent),
        totalGallons: trendIndicator(current.totalGallons, prev.totalGallons),
        averageMpg: trendIndicator(current.averageMpg ?? 0, prev.averageMpg ?? 0),
        totalMiles: trendIndicator(current.totalMiles, prev.totalMiles),
        maintenanceCost: trendIndicator(current.maintenanceCost, prev.maintenanceCost),
      },
    };
  });

  return success({ summaries }, requestId);
}


// ── POST /v1/vehicles/{vehicleId}/summary-card ───────────────────────────────

async function handleSummaryCard(
  event: APIGatewayProxyEventV2,
  vehicleId: string,
  requestId: string,
  userId: string,
): Promise<APIGatewayProxyResultV2> {
  const body = parseBody(event.body);
  if (!body || typeof body.year !== 'number') {
    return error('VALIDATION_ERROR', 'year is required and must be a number', requestId);
  }

  const year = String(body.year);
  logger.info(`Generating summary card for year ${year}`, requestId, userId);

  const [fillups, maintenance] = await Promise.all([
    fetchAllFillups(vehicleId),
    fetchAllMaintenance(vehicleId),
  ]);

  // Filter to the requested year
  const yearFillups = fillups.filter((f) => toYear(f.date) === year);
  const yearMaint = maintenance.filter((m) => toYear(m.datePerformed) === year);

  // Total miles: max odometer - min odometer for the year
  let totalMiles = 0;
  if (yearFillups.length >= 2) {
    const odometers = yearFillups.map((f) => f.odometerReading);
    totalMiles = Math.max(...odometers) - Math.min(...odometers);
  }

  const totalFuelCost = yearFillups.reduce((sum, f) => sum + f.currencySpent, 0);

  const mpgValues = yearFillups
    .filter((f) => f.mpg !== null && f.mpg !== undefined)
    .map((f) => f.mpg as number);
  const averageMpg = mpgValues.length > 0
    ? mpgValues.reduce((sum, v) => sum + v, 0) / mpgValues.length
    : null;

  const fillupCount = yearFillups.length;
  const totalMaintenanceCost = yearMaint.reduce((sum, m) => sum + m.cost, 0);

  return success({
    year: Number(year),
    totalMiles,
    totalFuelCost: Math.round(totalFuelCost * 100) / 100,
    averageMpg: averageMpg !== null ? Math.round(averageMpg * 100) / 100 : null,
    fillupCount,
    totalMaintenanceCost: Math.round(totalMaintenanceCost * 100) / 100,
  }, requestId);
}
