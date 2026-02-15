import type { ReminderInput, Reminder } from '../types/maintenance.js';

/** Threshold: show mileage reminder when within 500 miles */
const MILEAGE_THRESHOLD = 500;
/** Threshold: show time reminder when within 30 days */
const TIME_THRESHOLD_DAYS = 30;

/**
 * Calculate the number of days between two ISO 8601 date strings.
 * Returns a positive number if `to` is after `from`.
 */
function daysBetween(from: string, to: string): number {
  const msPerDay = 86_400_000;
  const fromDate = new Date(from);
  const toDate = new Date(to);
  return Math.floor((toDate.getTime() - fromDate.getTime()) / msPerDay);
}

/**
 * Calculate a maintenance reminder based on the last service record and current vehicle state.
 *
 * Returns a Reminder if the vehicle is within threshold (or overdue) for either
 * mileage or time intervals. Returns null if no reminder is needed.
 *
 * Implements the design doc's calculateReminder logic:
 * - mileageRemaining = (lastServiceOdometer + mileageInterval) - currentOdometer
 * - daysRemaining = timeIntervalDays - daysSince(lastServiceDate, currentDate)
 * - Only generates a reminder if within 500 miles or 30 days (or overdue)
 *
 * Validates: Requirements 4.6, 4.7, 4.8
 */
export function calculateReminder(input: ReminderInput): Reminder | null {
  const mileageRemaining = input.mileageInterval !== null
    ? (input.lastServiceOdometer + input.mileageInterval) - input.currentOdometer
    : null;

  const daysRemaining = input.timeIntervalDays !== null
    ? input.timeIntervalDays - daysBetween(input.lastServiceDate, input.currentDate)
    : null;

  const mileageApproaching = mileageRemaining !== null && mileageRemaining <= MILEAGE_THRESHOLD;
  const timeApproaching = daysRemaining !== null && daysRemaining <= TIME_THRESHOLD_DAYS;

  if (!mileageApproaching && !timeApproaching) return null;

  return {
    schemaName: input.schemaName,
    type: mileageApproaching && timeApproaching ? 'both' : mileageApproaching ? 'mileage' : 'time',
    mileageRemaining,
    daysRemaining,
    isOverdue: (mileageRemaining !== null && mileageRemaining < 0) || (daysRemaining !== null && daysRemaining < 0),
  };
}
