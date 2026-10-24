import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Fillup } from '@pawsitivemileage/sdk';

vi.mock('@/components/PhotoUpload', () => ({ PhotoUpload: () => null }));
vi.mock('@/components/LocationPicker', () => ({ LocationPicker: () => null }));

import { FillupList } from '@/components/FillupList';

const fillup = {
  vehicleId: '01J0000000000000000000000V',
  fillupId: '01J0000000000000000000000F',
  userId: '00000000-0000-0000-0000-000000000000',
  date: '2026-10-20',
  currencySpent: 60,
  gallonsAdded: 12.5,
  odometerReading: 11657,
  isPartialFill: false,
  isBusiness: false,
  pricePerGallon: 4.8,
  milesSinceLastFillup: 300,
  mpg: 24,
  costPerMile: 0.2,
  daysSinceLastFillup: 9,
  stationName: 'Sheetz',
  notes: 'Topped off before the trip',
  createdAt: '2026-10-20T00:00:00Z',
  updatedAt: '2026-10-20T00:00:00Z',
} as Fillup;

function renderList(readOnly: boolean) {
  return render(
    <FillupList
      fillups={[fillup]}
      vehicleId={fillup.vehicleId}
      onDelete={vi.fn()}
      onEdit={vi.fn()}
      readOnly={readOnly}
    />,
  );
}

describe('record details', () => {
  it('every fillup has a View button that shows notes, location and figures without editing', async () => {
    renderList(false);
    // One View button per layout (phone cards and desktop table); CSS hides one of them
    await userEvent.click(screen.getAllByRole('button', { name: /View fillup from/ })[0]);

    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('Topped off before the trip')).toBeInTheDocument();
    expect(within(dialog).getByText('Sheetz')).toBeInTheDocument();
    expect(within(dialog).getByText('11,657')).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: /Edit/ })).toBeInTheDocument();
  });

  it('read-only viewers can open details but get no Edit button', async () => {
    renderList(true);
    await userEvent.click(screen.getAllByRole('button', { name: /View fillup from/ })[0]);

    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('Topped off before the trip')).toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: /Edit/ })).toBeNull();
  });
});
