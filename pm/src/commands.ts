/**
 * pm commands that call the API. Each takes a Context (the SDK client and an output function),
 * so they can be tested with a fake client.
 */
import { randomUUID } from 'node:crypto';
import { existsSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ApiError, type Client } from '@pawsitivemileage/sdk';
import { fixed, miles, money, parseNumber, resolveVehicle, table, today, UsageError } from './format.js';

export interface Context {
  api: Client;
  out: (text: string) => void;
  json: boolean;
  env: string;
  fetch: typeof fetch;
  cwd: string;
  now: () => Date;
}

type Values = Record<string, string | boolean | undefined>;
type Option = { type: 'string' | 'boolean'; short?: string };

export interface Command {
  usage: string;
  summary: string;
  options?: Record<string, Option>;
  run: (ctx: Context, args: string[], values: Values) => Promise<void>;
}

const str = (v: string | boolean | undefined) => (typeof v === 'string' ? v : undefined);

function print(ctx: Context, data: unknown, text: () => string): void {
  ctx.out(ctx.json ? JSON.stringify(data, null, 2) : text());
}

/**
 * Run a create, retrying once with the same Idempotency-Key if the outcome is unknown (network
 * error or 5xx), so a retry can't record the same fill-up twice (#24).
 */
async function createOnce<T>(create: (idempotencyKey: string) => Promise<T>): Promise<T> {
  const key = randomUUID();
  try {
    return await create(key);
  } catch (err) {
    if (err instanceof ApiError && (err.code === 'NETWORK_ERROR' || err.status >= 500)) return create(key);
    throw err;
  }
}

function limitOf(values: Values): number | undefined {
  if (values.all) return undefined;
  const limit = parseNumber('limit', str(values.limit)) ?? 10;
  if (!Number.isInteger(limit) || limit < 1 || limit > 500) throw new UsageError('--limit must be a whole number from 1 to 500');
  return limit;
}

type PageQuery = { limit: number; order: 'desc'; cursor?: string };

/** Newest first: --limit N (default 10), or --all, fetched 500 at a time following nextCursor (#26) */
async function newest<T>(values: Values, fetchPage: (query: PageQuery) => Promise<{ items: T[]; nextCursor?: string }>): Promise<T[]> {
  const limit = limitOf(values);
  if (limit !== undefined) return (await fetchPage({ limit, order: 'desc' })).items;
  const items: T[] = [];
  let cursor: string | undefined;
  do {
    const page = await fetchPage({ limit: 500, order: 'desc', ...(cursor && { cursor }) });
    items.push(...page.items);
    cursor = page.nextCursor;
  } while (cursor);
  return items;
}

const LIST_OPTIONS: Record<string, Option> = { limit: { type: 'string', short: 'n' }, all: { type: 'boolean' } };

export const commands: Record<string, Command> = {
  whoami: {
    usage: 'pm whoami',
    summary: 'Show the signed-in account',
    run: async (ctx) => {
      const profile = await ctx.api.getProfile();
      print(ctx, profile, () => `${profile.displayName} <${profile.email}> on ${ctx.env}${profile.isAdmin ? ' (admin)' : ''}`);
    },
  },

  vehicles: {
    usage: 'pm vehicles [--all | --archived]',
    summary: 'List your vehicles and those shared with you',
    options: { all: { type: 'boolean' }, archived: { type: 'boolean' } },
    run: async (ctx, _args, values) => {
      const status = values.all ? 'all' : values.archived ? 'archived' : 'active';
      const [owned, shared] = await Promise.all([
        ctx.api.listVehicles({ query: { status } }),
        values.archived ? Promise.resolve([]) : ctx.api.listSharedVehicles(),
      ]);
      print(ctx, { vehicles: owned, shared }, () => {
        const rows = [
          ...owned.map((v) => [v.nickname, `${v.year} ${v.make} ${v.model}`, v.isArchived ? 'archived' : 'active', v.vehicleId]),
          ...shared.map((s) => [s.vehicle.nickname, `${s.vehicle.year} ${s.vehicle.make} ${s.vehicle.model}`, `shared by ${s.ownerDisplayName} (${s.permission})`, s.vehicle.vehicleId]),
        ];
        return rows.length ? table(['NICKNAME', 'VEHICLE', 'STATUS', 'ID'], rows) : 'No vehicles.';
      });
    },
  },

  fillups: {
    usage: 'pm fillups [vehicle] [--limit N | --all]',
    summary: 'Recent fill-ups, newest first (default 10)',
    options: LIST_OPTIONS,
    run: async (ctx, [ref], values) => {
      const vehicle = await resolveVehicle(ctx.api, ref);
      const items = await newest(values, (query) => ctx.api.page('listFillups', { params: { vehicleId: vehicle.vehicleId }, query }));
      print(ctx, items, () => items.length
        ? table(['DATE', 'ODOMETER', 'GALLONS', 'COST', '$/GAL', 'MPG'],
          items.map((f) => [f.date, miles(f.odometerReading), fixed(f.gallonsAdded, 3), money(f.currencySpent), money(f.pricePerGallon), `${fixed(f.mpg)}${f.isPartialFill ? ' (partial)' : ''}`]),
          [1, 2, 3, 4])
        : `No fill-ups for ${vehicle.nickname} yet.`);
    },
  },

  'fillup add': {
    usage: 'pm fillup add [vehicle] --gallons G --cost C --odometer O [--date YYYY-MM-DD] [--partial] [--business] [--station NAME] [--notes TEXT]',
    summary: 'Record a fill-up (date defaults to today)',
    options: {
      gallons: { type: 'string', short: 'g' }, cost: { type: 'string', short: 'c' }, odometer: { type: 'string', short: 'o' },
      date: { type: 'string', short: 'd' }, partial: { type: 'boolean' }, business: { type: 'boolean' },
      station: { type: 'string' }, notes: { type: 'string' },
    },
    run: async (ctx, [ref], values) => {
      const body = {
        date: str(values.date) ?? today(ctx.now()),
        gallonsAdded: parseNumber('gallons', str(values.gallons), { required: true })!,
        currencySpent: parseNumber('cost', str(values.cost), { required: true })!,
        odometerReading: parseNumber('odometer', str(values.odometer), { required: true })!,
        isPartialFill: values.partial === true,
        isBusiness: values.business === true,
        ...(str(values.station) && { stationName: str(values.station) }),
        ...(str(values.notes) && { notes: str(values.notes) }),
      };
      const vehicle = await resolveVehicle(ctx.api, ref);
      const fillup = await createOnce((idempotencyKey) => ctx.api.createFillup({ params: { vehicleId: vehicle.vehicleId }, body, idempotencyKey }));
      print(ctx, fillup, () => {
        const mpg = fillup.mpg != null ? `, ${fixed(fillup.mpg)} mpg` : '';
        return `Added fill-up to ${vehicle.nickname} on ${fillup.date}: ${fixed(fillup.gallonsAdded, 3)} gal, ${money(fillup.currencySpent)}${mpg}`;
      });
    },
  },

  maintenance: {
    usage: 'pm maintenance [vehicle] [--limit N | --all]',
    summary: 'Recent maintenance, newest first (default 10)',
    options: LIST_OPTIONS,
    run: async (ctx, [ref], values) => {
      const vehicle = await resolveVehicle(ctx.api, ref);
      const items = await newest(values, (query) => ctx.api.page('listMaintenance', { params: { vehicleId: vehicle.vehicleId }, query }));
      print(ctx, items, () => items.length
        ? table(['DATE', 'ODOMETER', 'TYPE', 'COST'],
          items.map((m) => [m.datePerformed, miles(m.odometerAtService), m.schemaName ?? m.customTypeName ?? '—', money(m.cost)]),
          [1, 3])
        : `No maintenance for ${vehicle.nickname} yet.`);
    },
  },

  'maintenance add': {
    usage: 'pm maintenance add [vehicle] --type TYPE --odometer O --cost C [--date YYYY-MM-DD] [--notes TEXT]',
    summary: 'Record maintenance; TYPE is a maintenance type name (e.g. "Oil Change") or your own',
    options: {
      type: { type: 'string', short: 't' }, odometer: { type: 'string', short: 'o' }, cost: { type: 'string', short: 'c' },
      date: { type: 'string', short: 'd' }, notes: { type: 'string' },
    },
    run: async (ctx, [ref], values) => {
      const type = str(values.type);
      if (!type) throw new UsageError('--type is required');
      const odometerAtService = parseNumber('odometer', str(values.odometer), { required: true })!;
      const cost = parseNumber('cost', str(values.cost), { required: true })!;
      const vehicle = await resolveVehicle(ctx.api, ref);
      const schemas = await ctx.api.listVehicleSchemas({ params: { vehicleId: vehicle.vehicleId } });
      const schema = schemas.find((s) => s.name.toLowerCase() === type.toLowerCase());
      const body = {
        ...(schema ? { schemaId: schema.schemaId } : { customTypeName: type }),
        datePerformed: str(values.date) ?? today(ctx.now()),
        odometerAtService,
        cost,
        ...(str(values.notes) && { notes: str(values.notes) }),
      };
      const record = await createOnce((idempotencyKey) => ctx.api.createMaintenance({ params: { vehicleId: vehicle.vehicleId }, body, idempotencyKey }));
      print(ctx, record, () =>
        `Added ${record.schemaName ?? record.customTypeName} to ${vehicle.nickname} on ${record.datePerformed}: ${money(record.cost)}${schema ? '' : ' (custom type)'}`);
    },
  },

  reminders: {
    usage: 'pm reminders [vehicle]',
    summary: 'Upcoming and overdue maintenance',
    run: async (ctx, [ref]) => {
      const vehicle = await resolveVehicle(ctx.api, ref);
      const reminders = await ctx.api.listReminders({ params: { vehicleId: vehicle.vehicleId } });
      print(ctx, reminders, () => {
        if (!reminders.length) return `No reminders for ${vehicle.nickname}.`;
        const due = (r: (typeof reminders)[number]) => {
          const parts = [
            r.mileageRemaining != null && `${miles(Math.abs(r.mileageRemaining))} mi ${r.mileageRemaining < 0 ? 'over' : 'left'}`,
            r.daysRemaining != null && `${Math.abs(r.daysRemaining)} days ${r.daysRemaining < 0 ? 'over' : 'left'}`,
          ].filter(Boolean);
          return parts.join(', ') || '—';
        };
        return table(['TYPE', 'STATUS', 'DUE'], reminders.map((r) => [r.schemaName, r.isOverdue ? 'OVERDUE' : 'ok', due(r)]));
      });
    },
  },

  export: {
    usage: 'pm export [vehicle] fillups|maintenance [--from YYYY-MM-DD] [--to YYYY-MM-DD] [--out FILE] [--force]',
    summary: 'Download fill-ups or maintenance as CSV',
    options: { from: { type: 'string' }, to: { type: 'string' }, out: { type: 'string', short: 'o' }, force: { type: 'boolean' } },
    run: async (ctx, args, values) => {
      const kind = args.find((a) => a === 'fillups' || a === 'maintenance');
      if (!kind) throw new UsageError('Say what to export: fillups or maintenance');
      const vehicle = await resolveVehicle(ctx.api, args.find((a) => a !== kind));
      const query = { startDate: str(values.from), endDate: str(values.to) };
      const result = kind === 'fillups'
        ? await ctx.api.exportFillups({ params: { vehicleId: vehicle.vehicleId }, query })
        : await ctx.api.exportMaintenance({ params: { vehicleId: vehicle.vehicleId }, query });

      const slug = vehicle.nickname.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'vehicle';
      const path = resolve(ctx.cwd, str(values.out) ?? `${slug}-${kind}.csv`);
      if (existsSync(path) && !values.force) throw new UsageError(`${path} exists; pass --force to overwrite`);
      const res = await ctx.fetch(result.downloadUrl);
      if (!res.ok) throw new Error(`Download failed: HTTP ${res.status}`);
      writeFileSync(path, Buffer.from(await res.arrayBuffer()));
      print(ctx, { path, recordCount: result.recordCount }, () => `Saved ${result.recordCount} ${kind === 'fillups' ? 'fill-ups' : 'maintenance records'} to ${path}`);
    },
  },
};
