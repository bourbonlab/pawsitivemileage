import { describe, it, expect } from 'vitest';
import { calculateReminder } from '../../src/lib/reminders';
import type { ReminderInput } from '../../src/types/maintenance';

describe('calculateReminder', () => {
  const baseInput: ReminderInput = {
    schemaName: 'Oil Change',
    mileageInterval: 5000,
    timeIntervalDays: 180,
    lastServiceOdometer: 40000,
    lastServiceDate: '2024-06-01',
    currentOdometer: 44600,
    currentDate: '2024-11-15',
  };

  it('returns a mileage reminder when within 500 miles of threshold', () => {
    // 40000 + 5000 - 44600 = 400 miles remaining (within 500 threshold)
    // Time: 180 - daysBetween(2024-06-01, 2024-08-01) = 180 - 61 = 119 (not within 30)
    const input: ReminderInput = {
      ...baseInput,
      currentDate: '2024-08-01',
    };
    const result = calculateReminder(input);
    expect(result).not.toBeNull();
    expect(result!.mileageRemaining).toBe(400);
    expect(result!.type).toBe('mileage');
    expect(result!.isOverdue).toBe(false);
  });

  it('returns a time reminder when within 30 days of threshold', () => {
    // 180 days from 2024-06-01 = 2024-11-28, current = 2024-11-15 → 13 days remaining
    // But mileage: 40000 + 5000 - 42000 = 3000 (not within 500)
    const input: ReminderInput = {
      ...baseInput,
      currentOdometer: 42000,
      currentDate: '2024-11-15',
    };
    const result = calculateReminder(input);
    expect(result).not.toBeNull();
    expect(result!.type).toBe('time');
    expect(result!.daysRemaining).toBeLessThanOrEqual(30);
    expect(result!.isOverdue).toBe(false);
  });

  it('returns type "both" when both mileage and time are approaching', () => {
    // Mileage: 40000 + 5000 - 44600 = 400 (within 500)
    // Time: 180 - daysBetween(2024-06-01, 2024-11-20) = 180 - 172 = 8 (within 30)
    const input: ReminderInput = {
      ...baseInput,
      currentDate: '2024-11-20',
    };
    const result = calculateReminder(input);
    expect(result).not.toBeNull();
    expect(result!.type).toBe('both');
  });

  it('returns null when neither threshold is approaching', () => {
    // Mileage: 40000 + 5000 - 41000 = 4000 (not within 500)
    // Time: 180 - daysBetween(2024-06-01, 2024-07-01) = 180 - 30 = 150 (not within 30)
    const input: ReminderInput = {
      ...baseInput,
      currentOdometer: 41000,
      currentDate: '2024-07-01',
    };
    const result = calculateReminder(input);
    expect(result).toBeNull();
  });

  it('marks overdue when mileage is past threshold', () => {
    // 40000 + 5000 - 46000 = -1000 (overdue)
    const input: ReminderInput = {
      ...baseInput,
      currentOdometer: 46000,
    };
    const result = calculateReminder(input);
    expect(result).not.toBeNull();
    expect(result!.mileageRemaining).toBe(-1000);
    expect(result!.isOverdue).toBe(true);
  });

  it('marks overdue when time is past threshold', () => {
    // 180 - daysBetween(2024-06-01, 2025-01-15) = 180 - 228 = -48 (overdue)
    const input: ReminderInput = {
      ...baseInput,
      currentOdometer: 42000, // not within mileage threshold
      currentDate: '2025-01-15',
    };
    const result = calculateReminder(input);
    expect(result).not.toBeNull();
    expect(result!.daysRemaining).toBeLessThan(0);
    expect(result!.isOverdue).toBe(true);
  });

  it('handles mileage-only schema (no time interval)', () => {
    const input: ReminderInput = {
      ...baseInput,
      timeIntervalDays: null,
    };
    const result = calculateReminder(input);
    expect(result).not.toBeNull();
    expect(result!.type).toBe('mileage');
    expect(result!.daysRemaining).toBeNull();
  });

  it('handles time-only schema (no mileage interval)', () => {
    const input: ReminderInput = {
      ...baseInput,
      mileageInterval: null,
      currentDate: '2024-11-20',
    };
    const result = calculateReminder(input);
    expect(result).not.toBeNull();
    expect(result!.type).toBe('time');
    expect(result!.mileageRemaining).toBeNull();
  });

  it('returns null when both intervals are null', () => {
    const input: ReminderInput = {
      ...baseInput,
      mileageInterval: null,
      timeIntervalDays: null,
    };
    const result = calculateReminder(input);
    expect(result).toBeNull();
  });
});
