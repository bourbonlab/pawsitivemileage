import type { Client } from '@pawsitivemileage/sdk';

/** A mistake in how pm was called: printed with a hint, exit code 2 */
export class UsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UsageError';
  }
}

/** Plain aligned columns; `right` lists the columns to right-align (numbers) */
export function table(headers: string[], rows: string[][], right: number[] = []): string {
  const widths = headers.map((h, i) => Math.max(h.length, ...rows.map((r) => (r[i] ?? '').length)));
  const line = (cells: string[]) =>
    cells.map((c, i) => (right.includes(i) ? c.padStart(widths[i]) : c.padEnd(widths[i]))).join('  ').trimEnd();
  return [line(headers), ...rows.map(line)].join('\n');
}

export const money = (n: number | null | undefined) => (n == null ? '—' : `$${n.toFixed(2)}`);
export const fixed = (n: number | null | undefined, digits = 1) => (n == null ? '—' : n.toFixed(digits));
export const miles = (n: number | null | undefined) => (n == null ? '—' : Math.round(n).toLocaleString('en-US'));

export function parseNumber(name: string, value: string | undefined, { required = false } = {}): number | undefined {
  if (value === undefined) {
    if (required) throw new UsageError(`--${name} is required`);
    return undefined;
  }
  const n = Number(value.replace(/[$,]/g, ''));
  if (!Number.isFinite(n)) throw new UsageError(`--${name} must be a number (got "${value}")`);
  return n;
}

/** Today in the local time zone, as YYYY-MM-DD (what a fill-up "date" means to the user) */
export function today(now = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

export interface VehicleRef {
  vehicleId: string;
  nickname: string;
  shared: boolean;
}

/**
 * Find a vehicle by ID, nickname (case-insensitive) or unique nickname prefix, among the user's
 * vehicles (archived included) and those shared with them. With no reference, the only active
 * vehicle is used.
 */
export async function resolveVehicle(api: Client, ref: string | undefined): Promise<VehicleRef> {
  const [owned, shared] = await Promise.all([api.listVehicles({ query: { status: 'all' } }), api.listSharedVehicles()]);
  const all: Array<VehicleRef & { isArchived: boolean }> = [
    ...owned.map((v) => ({ vehicleId: v.vehicleId, nickname: v.nickname, shared: false, isArchived: v.isArchived })),
    ...shared.map((s) => ({ vehicleId: s.vehicle.vehicleId, nickname: s.vehicle.nickname, shared: true, isArchived: false })),
  ];
  const strip = ({ isArchived: _a, ...v }: VehicleRef & { isArchived: boolean }): VehicleRef => v;
  const names = (list: typeof all) => list.map((v) => `"${v.nickname}"`).join(', ');

  if (!ref) {
    const active = all.filter((v) => !v.isArchived);
    if (active.length === 1) return strip(active[0]);
    throw new UsageError(active.length ? `Which vehicle? ${names(active)}` : 'No vehicles yet; add one in the web app');
  }
  const lower = ref.toLowerCase();
  const match =
    all.find((v) => v.vehicleId === ref)
    ?? all.find((v) => v.nickname.toLowerCase() === lower)
    ?? (() => {
      const prefixed = all.filter((v) => v.nickname.toLowerCase().startsWith(lower));
      if (prefixed.length > 1) throw new UsageError(`"${ref}" matches ${names(prefixed)}`);
      return prefixed[0];
    })();
  if (!match) throw new UsageError(`No vehicle "${ref}". Yours: ${names(all) || 'none'}`);
  return strip(match);
}
