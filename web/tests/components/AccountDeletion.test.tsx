import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';

vi.mock('@/auth/AuthProvider', () => ({
  useAuth: () => ({ signOut: vi.fn(), isAdmin: false, user: { email: 'a@example.com' }, isAuthenticated: true, isLoading: false }),
}));
vi.mock('@/components/AppVersion', () => ({ AppVersion: () => null }));
vi.mock('@/api/vehicles', () => ({ useVehicles: () => ({ data: [] }) }));
vi.mock('@/api/sharing', () => ({ useSharedVehicles: () => ({ data: [] }) }));
vi.mock('@/lib/useTheme', () => ({ useTheme: () => ({ isDark: false, toggle: vi.fn() }) }));

import DeleteAccountInfoPage from '@/pages/DeleteAccountInfoPage';
import { Layout } from '@/components/Layout';

describe('account deletion is discoverable', () => {
  it('the public page names the app and gives web and Android steps without signing in', () => {
    vi.stubEnv('VITE_SUPPORT_EMAIL', 'support@example.com');
    render(<MemoryRouter><DeleteAccountInfoPage /></MemoryRouter>);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Delete your PawsitiveMileage account');
    expect(screen.getByRole('heading', { name: 'On the web' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'In the Android app' })).toBeInTheDocument();
    expect(screen.getByText(/up to 35 days/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'support@example.com' })).toHaveAttribute('href', expect.stringContaining('mailto:support@example.com'));
    vi.unstubAllEnvs();
  });

  it('every signed-in user (not only admins) gets an Account link, and the footer links the deletion page', () => {
    render(<MemoryRouter><Layout><p>content</p></Layout></MemoryRouter>);
    expect(screen.getByRole('link', { name: 'Account' })).toHaveAttribute('href', '/account');
    expect(screen.queryByRole('link', { name: 'Admin' })).toBeNull();
    expect(screen.getByRole('link', { name: 'Delete account' })).toHaveAttribute('href', '/delete-account');
  });
});
