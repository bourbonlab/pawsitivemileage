import { AlertTriangle, Clock, Gauge } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import type { Reminder } from '@pawsitivemileage/sdk';

interface ReminderBannerProps {
  reminders: Reminder[];
}

export function ReminderBanner({ reminders }: ReminderBannerProps) {
  if (!reminders.length) return null;

  const overdue = reminders.filter((r) => r.isOverdue);
  const upcoming = reminders.filter((r) => !r.isOverdue);

  return (
    <div className="flex flex-col gap-2">
      {overdue.map((r) => (
        <Alert key={r.schemaName} variant="destructive">
          <AlertTriangle className="size-4" />
          <AlertTitle>Overdue: {r.schemaName}</AlertTitle>
          <AlertDescription>{formatReminderDetail(r)}</AlertDescription>
        </Alert>
      ))}
      {upcoming.map((r) => (
        <Alert key={r.schemaName} className="border-yellow-500 text-yellow-700 dark:text-yellow-400 [&>svg]:text-yellow-600 dark:[&>svg]:text-yellow-400">
          <Clock className="size-4" />
          <AlertTitle>Upcoming: {r.schemaName}</AlertTitle>
          <AlertDescription>{formatReminderDetail(r)}</AlertDescription>
        </Alert>
      ))}
    </div>
  );
}

function formatReminderDetail(r: Reminder): string {
  const parts: string[] = [];

  if (r.mileageRemaining !== null) {
    const icon = r.mileageRemaining < 0 ? 'overdue by' : 'in';
    const miles = Math.abs(r.mileageRemaining).toLocaleString();
    parts.push(`${icon} ${miles} miles`);
  }

  if (r.daysRemaining !== null) {
    const icon = r.daysRemaining < 0 ? 'overdue by' : 'in';
    const days = Math.abs(r.daysRemaining);
    parts.push(`${icon} ${days} day${days !== 1 ? 's' : ''}`);
  }

  return parts.join(' · ');
}
