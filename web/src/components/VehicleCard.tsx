import { Link } from 'react-router';
import { Car, ChevronRight } from 'lucide-react';
import { useFillups } from '@/api/fillups';
import { useReminders } from '@/api/maintenance';
import { relativeDay, vehicleStats } from '@/lib/vehicle-stats';
import { cn } from '@/lib/utils';
import type { Reminder, Vehicle } from '@pawsitivemileage/sdk';

interface VehicleCardProps {
  vehicle: Pick<Vehicle, 'vehicleId' | 'nickname' | 'year' | 'make' | 'model' | 'photoKey' | 'vin' | 'licensePlate'>;
  /** Shown next to the name (e.g. a shared vehicle's permission) */
  badge?: React.ReactNode;
  /** Replaces the VIN / plate line (e.g. "Shared by Sam") */
  note?: string;
  className?: string;
}

/** Garage card: photo, identity, a three-up stat strip and the most pressing service reminder */
export function VehicleCard({ vehicle, badge, note, className }: VehicleCardProps) {
  const fillups = useFillups(vehicle.vehicleId);
  const reminders = useReminders(vehicle.vehicleId);
  const stats = fillups.data ? vehicleStats(fillups.data) : null;
  const reminder = mostUrgent(reminders.data);

  return (
    <Link
      to={`/vehicles/${vehicle.vehicleId}`}
      aria-label={`View ${vehicle.nickname}`}
      className={cn(
        'group grid gap-4 rounded-2xl border bg-card p-3 text-card-foreground transition-colors hover:border-ring/60 sm:grid-cols-[176px_minmax(0,1fr)] sm:p-4',
        className,
      )}
    >
      <VehiclePhoto photoKey={vehicle.photoKey ?? undefined} className="h-40 sm:h-full sm:min-h-36" />

      <div className="flex min-w-0 flex-col gap-3 px-1 pb-1 sm:p-0">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <p className="truncate text-xl font-bold tracking-tight">{vehicle.nickname}</p>
              {badge}
            </div>
            <p className="truncate text-sm text-muted-foreground">
              {vehicle.year} {vehicle.make} {vehicle.model}
            </p>
            {note ? (
              <p className="mt-0.5 truncate text-xs text-muted-foreground/80">{note}</p>
            ) : (vehicle.vin || vehicle.licensePlate) && (
              <p className="mt-0.5 truncate font-mono text-[11px] text-muted-foreground/80">
                {[vehicle.vin && `VIN ${vehicle.vin}`, vehicle.licensePlate].filter(Boolean).join(' · ')}
              </p>
            )}
          </div>
          <ChevronRight className="mt-1 size-5 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
        </div>

        <dl className="grid grid-cols-3 gap-px overflow-hidden rounded-xl border bg-border">
          <Stat label="Odometer" value={stats?.odometer != null ? stats.odometer.toLocaleString() : '—'} />
          <Stat label="Avg MPG" value={stats?.mpg ? stats.mpg.average.toFixed(1) : '—'} />
          <Stat label="Last fillup" value={stats?.lastFillupDate ? shortRelative(stats.lastFillupDate) : '—'} />
        </dl>

        {reminder && <ReminderChip reminder={reminder} />}
      </div>
    </Link>
  );
}

export function VehiclePhoto({ photoKey, className }: { photoKey?: string; className?: string }) {
  return (
    <div
      className={cn(
        'grid place-items-center overflow-hidden rounded-xl bg-[repeating-linear-gradient(135deg,var(--muted)_0_10px,var(--border)_10px_20px)]',
        className,
      )}
    >
      {photoKey ? (
        <img src={`/photos/${photoKey}`} alt="" className="size-full object-cover" />
      ) : (
        <Car className="size-10 text-muted-foreground/70" aria-hidden="true" />
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-card px-3 py-2.5">
      <dt className="text-[11px] text-muted-foreground sm:text-xs">{label}</dt>
      <dd className="truncate font-mono text-base font-semibold tabular-nums sm:text-lg">{value}</dd>
    </div>
  );
}

function ReminderChip({ reminder }: { reminder: Reminder }) {
  return (
    <div
      className={cn(
        'flex items-center gap-2.5 rounded-xl px-3 py-2 text-[13px]',
        reminder.isOverdue ? 'bg-destructive/12 text-destructive' : 'bg-brand-soft',
      )}
    >
      <span
        className={cn('size-2 shrink-0 rounded-full', reminder.isOverdue ? 'bg-destructive' : 'bg-warning')}
        aria-hidden="true"
      />
      <span className="truncate">
        {reminder.schemaName} {reminderDue(reminder)}
      </span>
    </div>
  );
}

/** Overdue first, then the fewest miles (or days) to go */
export function mostUrgent(reminders: Reminder[] | undefined): Reminder | undefined {
  if (!reminders?.length) return undefined;
  const score = (r: Reminder) => Math.min(r.mileageRemaining ?? Infinity, (r.daysRemaining ?? Infinity) * 30);
  return [...reminders].sort((a, b) => Number(b.isOverdue) - Number(a.isOverdue) || score(a) - score(b))[0];
}

export function reminderDue(r: Reminder): string {
  if (r.mileageRemaining != null) {
    const miles = Math.abs(r.mileageRemaining).toLocaleString();
    return r.mileageRemaining < 0 ? `${miles} mi over` : `due in ${miles} mi`;
  }
  if (r.daysRemaining != null) {
    const days = Math.abs(r.daysRemaining);
    const unit = `day${days === 1 ? '' : 's'}`;
    return r.daysRemaining < 0 ? `${days} ${unit} over` : `due in ${days} ${unit}`;
  }
  return r.isOverdue ? 'overdue' : 'coming up';
}

function shortRelative(date: string): string {
  const text = relativeDay(date);
  if (text.includes(',')) {
    return new Date(date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }
  return text.replace(' days ago', 'd ago');
}
