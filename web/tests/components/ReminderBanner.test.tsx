import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ReminderBanner } from '@/components/ReminderBanner';
import type { Reminder } from '@pawsitivemileage/sdk';

describe('ReminderBanner', () => {
  it('renders nothing when reminders array is empty', () => {
    const { container } = render(<ReminderBanner reminders={[]} />);
    expect(container.innerHTML).toBe('');
  });

  it('renders an overdue reminder with destructive styling', () => {
    const reminders: Reminder[] = [
      {
        schemaName: 'Oil Change',
        type: 'mileage',
        mileageRemaining: -200,
        daysRemaining: null,
        isOverdue: true,
      },
    ];

    render(<ReminderBanner reminders={reminders} />);

    expect(screen.getByText('Overdue: Oil Change')).toBeInTheDocument();
    expect(screen.getByText('overdue by 200 miles')).toBeInTheDocument();
  });

  it('renders an upcoming reminder', () => {
    const reminders: Reminder[] = [
      {
        schemaName: 'Tire Rotation',
        type: 'mileage',
        mileageRemaining: 300,
        daysRemaining: null,
        isOverdue: false,
      },
    ];

    render(<ReminderBanner reminders={reminders} />);

    expect(screen.getByText('Upcoming: Tire Rotation')).toBeInTheDocument();
    expect(screen.getByText('in 300 miles')).toBeInTheDocument();
  });

  it('renders time-based reminder with correct pluralization', () => {
    const reminders: Reminder[] = [
      {
        schemaName: 'Inspection',
        type: 'time',
        mileageRemaining: null,
        daysRemaining: 1,
        isOverdue: false,
      },
    ];

    render(<ReminderBanner reminders={reminders} />);

    expect(screen.getByText('in 1 day')).toBeInTheDocument();
  });

  it('renders plural days correctly', () => {
    const reminders: Reminder[] = [
      {
        schemaName: 'Inspection',
        type: 'time',
        mileageRemaining: null,
        daysRemaining: 15,
        isOverdue: false,
      },
    ];

    render(<ReminderBanner reminders={reminders} />);

    expect(screen.getByText('in 15 days')).toBeInTheDocument();
  });

  it('renders both mileage and time info when both are present', () => {
    const reminders: Reminder[] = [
      {
        schemaName: 'Oil Change',
        type: 'both',
        mileageRemaining: 400,
        daysRemaining: 20,
        isOverdue: false,
      },
    ];

    render(<ReminderBanner reminders={reminders} />);

    expect(screen.getByText('in 400 miles · in 20 days')).toBeInTheDocument();
  });

  it('renders overdue time-based reminder', () => {
    const reminders: Reminder[] = [
      {
        schemaName: 'Brake Check',
        type: 'time',
        mileageRemaining: null,
        daysRemaining: -5,
        isOverdue: true,
      },
    ];

    render(<ReminderBanner reminders={reminders} />);

    expect(screen.getByText('Overdue: Brake Check')).toBeInTheDocument();
    expect(screen.getByText('overdue by 5 days')).toBeInTheDocument();
  });

  it('separates overdue and upcoming reminders', () => {
    const reminders: Reminder[] = [
      {
        schemaName: 'Oil Change',
        type: 'mileage',
        mileageRemaining: -100,
        daysRemaining: null,
        isOverdue: true,
      },
      {
        schemaName: 'Tire Rotation',
        type: 'mileage',
        mileageRemaining: 400,
        daysRemaining: null,
        isOverdue: false,
      },
    ];

    render(<ReminderBanner reminders={reminders} />);

    expect(screen.getByText('Overdue: Oil Change')).toBeInTheDocument();
    expect(screen.getByText('Upcoming: Tire Rotation')).toBeInTheDocument();
  });
});
