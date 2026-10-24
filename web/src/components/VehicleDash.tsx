import { Link } from 'react-router';
import { ArrowRight, Fuel, Wrench } from 'lucide-react';
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Gauge, Odometer } from '@/components/Instruments';
import { mostUrgent, reminderDue } from '@/components/VehicleCard';
import { Button } from '@/components/ui/button';
import { relativeDay, sortFillupsByDate, vehicleStats, type MetricStat } from '@/lib/vehicle-stats';
import { cn } from '@/lib/utils';
import type { Fillup, Reminder } from '@pawsitivemileage/sdk';

interface VehicleDashProps {
  vehicleId: string;
  fillups: Fillup[];
  reminders: Reminder[];
  canEdit: boolean;
  onShowFillups: () => void;
  onShowService: () => void;
}

/** The vehicle's instrument cluster: odometer, three gauges, fuel economy, service and recent fillups */
export function VehicleDash({ vehicleId, fillups, reminders, canEdit, onShowFillups, onShowService }: VehicleDashProps) {
  const stats = vehicleStats(fillups);

  if (!fillups.length) {
    return (
      <Panel className="flex flex-col items-center gap-3 py-14 text-center">
        <Fuel className="size-9 text-muted-foreground" aria-hidden="true" />
        <div>
          <p className="font-semibold">No fillups yet</p>
          <p className="text-sm text-muted-foreground">Log a fillup and the gauges come to life.</p>
        </div>
        {canEdit && (
          <Button asChild>
            <Link to={`/vehicles/${vehicleId}/fillups/new`}>Log your first fillup</Link>
          </Button>
        )}
      </Panel>
    );
  }

  return (
    <div className="flex flex-col gap-3 sm:gap-4">
      <div className="grid grid-cols-3 gap-3 sm:gap-4 xl:grid-cols-[minmax(0,1.3fr)_repeat(3,minmax(0,1fr))]">
        <Panel className="col-span-3 flex flex-col justify-between gap-2.5 xl:col-span-1">
          <Caption>Odometer</Caption>
          <Odometer miles={stats.odometer ?? 0} />
          {stats.lastFillupDate && (
            <p className="font-mono text-xs text-muted-foreground">Last fillup {relativeDay(stats.lastFillupDate)}</p>
          )}
        </Panel>
        <GaugeTile
          label="MPG"
          stat={stats.mpg}
          digits={1}
          color="var(--chart-1)"
          note={(s) => <Trend delta={s.latest - s.average} digits={1} higherIsBetter />}
        />
        <GaugeTile
          label="$ / gallon"
          stat={stats.pricePerGallon}
          digits={2}
          color="var(--chart-2)"
          note={(s) => <>avg ${s.average.toFixed(2)}</>}
        />
        <GaugeTile
          label="$ / mile"
          stat={stats.costPerMile}
          digits={2}
          trimLeadingZero
          color="var(--chart-3)"
          note={() => <>${Math.round(stats.spentThisMonth).toLocaleString()} this mo.</>}
        />
      </div>

      <div className="grid gap-3 sm:gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
        <Panel>
          <div className="flex items-baseline justify-between gap-2">
            <h2 className="text-[15px] font-bold">Fuel economy</h2>
            {stats.mpgSeries.length > 0 && (
              <span className="font-mono text-xs text-muted-foreground">
                {stats.mpgSeries.length} tank{stats.mpgSeries.length === 1 ? '' : 's'} · since {shortDate(stats.mpgSeries[0].date, true)}
              </span>
            )}
          </div>
          {stats.mpgSeries.length > 1 ? (
            <MpgArea data={stats.mpgSeries} />
          ) : (
            <p className="py-12 text-center text-sm text-muted-foreground">Two full tanks in, the trend line appears here.</p>
          )}
        </Panel>

        <div className="flex flex-col gap-3 sm:gap-4">
          <ServicePanel reminders={reminders} onShowService={onShowService} />
          <Panel className="grid grid-cols-2 gap-3">
            <div>
              <Caption>Spent this month</Caption>
              <p className="font-mono text-xl font-semibold tabular-nums">${stats.spentThisMonth.toFixed(2)}</p>
            </div>
            <div>
              <Caption>Fillups logged</Caption>
              <p className="font-mono text-xl font-semibold tabular-nums">{stats.fillupCount}</p>
            </div>
          </Panel>
        </div>
      </div>

      <RecentFillups fillups={fillups} onShowAll={onShowFillups} />
    </div>
  );
}

/* ------------------------------------------------------------------ */

export function Panel({ className, ...props }: React.ComponentProps<'div'>) {
  return <div className={cn('rounded-2xl border bg-card p-4 text-card-foreground sm:px-5 sm:py-[18px]', className)} {...props} />;
}

function Caption({ children }: { children: React.ReactNode }) {
  return <div className="text-xs text-muted-foreground">{children}</div>;
}

function GaugeTile({
  label, stat, digits, color, note, trimLeadingZero = false,
}: {
  label: string;
  stat: MetricStat | null;
  digits: number;
  color: string;
  note: (stat: MetricStat) => React.ReactNode;
  trimLeadingZero?: boolean;
}) {
  let value = stat ? stat.latest.toFixed(digits) : '—';
  if (trimLeadingZero && value.startsWith('0.')) value = value.slice(1);

  return (
    <Panel className="flex flex-col items-center gap-2 px-2 text-center xl:flex-row xl:gap-3.5 xl:px-5 xl:text-left">
      <Gauge
        fraction={stat ? 0.12 + 0.88 * stat.position : 0}
        value={value}
        color={color}
        label={label}
        className="size-[72px] sm:size-[84px]"
      />
      <div className="min-w-0">
        <Caption>{label}</Caption>
        {stat && <div className="mt-0.5 truncate font-mono text-[11px] text-muted-foreground sm:text-xs">{note(stat)}</div>}
      </div>
    </Panel>
  );
}

function Trend({ delta, digits, higherIsBetter }: { delta: number; digits: number; higherIsBetter: boolean }) {
  if (Math.abs(delta) < 10 ** -digits / 2) return <>at avg</>;
  const good = delta > 0 === higherIsBetter;
  return (
    <span className={good ? 'text-success' : 'text-warning'}>
      {delta > 0 ? '▲' : '▼'} {Math.abs(delta).toFixed(digits)} vs avg
    </span>
  );
}

function MpgArea({ data }: { data: { date: string; mpg: number }[] }) {
  return (
    <div className="mt-3 h-44 sm:h-52">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 6, right: 16, bottom: 0, left: -18 }}>
          <defs>
            <linearGradient id="mpg-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--chart-1)" stopOpacity={0.35} />
              <stop offset="100%" stopColor="var(--chart-1)" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid vertical={false} />
          <XAxis
            dataKey="date"
            tickLine={false}
            axisLine={false}
            tick={{ fontSize: 11 }}
            minTickGap={36}
            tickFormatter={(v: string) => shortDate(v, true)}
          />
          <YAxis
            tickLine={false}
            axisLine={false}
            tick={{ fontSize: 11 }}
            width={44}
            domain={['auto', 'auto']}
            tickFormatter={(v: number) => v.toFixed(0)}
          />
          <Tooltip
            formatter={(value) => [`${Number(value ?? 0).toFixed(1)} mpg`, 'MPG']}
            labelFormatter={(label) => shortDate(String(label), false)}
            cursor={{ stroke: 'var(--muted-foreground)', strokeDasharray: '3 3' }}
          />
          <Area
            type="monotone"
            dataKey="mpg"
            stroke="var(--chart-1)"
            strokeWidth={2.5}
            fill="url(#mpg-fill)"
            dot={false}
            activeDot={{ r: 4, strokeWidth: 0, fill: 'var(--chart-1)' }}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

function ServicePanel({ reminders, onShowService }: { reminders: Reminder[]; onShowService: () => void }) {
  const sorted = [...reminders].sort((a, b) => (mostUrgent([a, b]) === a ? -1 : 1)).slice(0, 3);
  return (
    <Panel className="flex flex-col gap-2.5 text-[13px]">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-bold">Service</h2>
        <button type="button" onClick={onShowService} className="text-xs font-semibold text-brand hover:underline">
          View all
        </button>
      </div>
      {sorted.length ? (
        sorted.map((r) => (
          <div key={r.schemaName} className="flex items-center justify-between gap-2">
            <span className="truncate">{r.schemaName}</span>
            <span
              className={cn(
                'shrink-0 rounded-md px-2 py-0.5 font-mono text-xs',
                r.isOverdue ? 'bg-destructive/15 text-destructive' : 'text-muted-foreground',
              )}
            >
              {reminderDue(r).replace('due ', '')}
            </span>
          </div>
        ))
      ) : (
        <p className="flex items-center gap-2 text-muted-foreground">
          <Wrench className="size-4" aria-hidden="true" /> No reminders. Log service to start tracking.
        </p>
      )}
    </Panel>
  );
}

function RecentFillups({ fillups, onShowAll }: { fillups: Fillup[]; onShowAll: () => void }) {
  const recent = sortFillupsByDate(fillups).reverse().slice(0, 5);
  return (
    <div className="overflow-hidden rounded-2xl border bg-card">
      <div className="flex items-center justify-between px-4 py-3.5 sm:px-5">
        <h2 className="text-[15px] font-bold">Recent fillups</h2>
        <button type="button" onClick={onShowAll} className="flex items-center gap-1 text-[13px] font-semibold text-brand hover:underline">
          All {fillups.length} <ArrowRight className="size-3.5" aria-hidden="true" />
        </button>
      </div>
      <div className="hidden grid-cols-[110px_repeat(5,minmax(0,1fr))] gap-3 border-y px-5 py-2.5 text-[11px] font-semibold tracking-[0.06em] text-muted-foreground uppercase sm:grid">
        <span>Date</span>
        <span className="text-right">Odometer</span>
        <span className="text-right">Miles</span>
        <span className="text-right">Gallons</span>
        <span className="text-right">Cost</span>
        <span className="text-right">MPG</span>
      </div>
      <ul>
        {recent.map((f) => (
          <li
            key={f.fillupId}
            className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 border-t px-4 py-3 font-mono text-[13px] tabular-nums first:border-t-0 sm:grid-cols-[110px_repeat(5,minmax(0,1fr))] sm:border-t sm:px-5 sm:py-2.5 sm:first:border-t-0"
          >
            <span className="font-sans font-semibold">{shortDate(f.date, false)}</span>
            <span className="hidden text-right sm:block">{f.odometerReading.toLocaleString()}</span>
            <span className="hidden text-right text-muted-foreground sm:block">{f.milesSinceLastFillup?.toLocaleString() ?? '—'}</span>
            <span className="hidden text-right sm:block">{f.gallonsAdded.toFixed(2)}</span>
            <span className="text-right">${f.currencySpent.toFixed(2)}</span>
            {/* Phones: odometer and gallons collapse into one line under the date */}
            <span className="text-xs text-muted-foreground sm:hidden">
              {f.odometerReading.toLocaleString()} mi · {f.gallonsAdded.toFixed(2)} gal
            </span>
            <span className="text-right text-brand">
              {f.mpg != null ? f.mpg.toFixed(1) : '—'}
              <span className="ml-1 text-muted-foreground sm:hidden">mpg</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function shortDate(iso: string, withYear: boolean): string {
  const d = new Date(iso + 'T00:00:00');
  return withYear
    ? d.toLocaleDateString('en-US', { month: 'short', year: '2-digit' }).replace(' ', " '")
    : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}
