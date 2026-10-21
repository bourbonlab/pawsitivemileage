import { afterEach, describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AppVersion } from '@/components/AppVersion';

describe('AppVersion', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('renders nothing when no version was built in', () => {
    vi.stubEnv('VITE_APP_VERSION', '');
    const { container } = render(<AppVersion />);
    expect(container.innerHTML).toBe('');
  });

  it('links a release version to its GitHub release', () => {
    vi.stubEnv('VITE_APP_VERSION', 'v1.4.0');
    vi.stubEnv('VITE_SOURCE_CODE_URL', 'https://github.com/owner/repo/');
    render(<AppVersion />);
    expect(screen.getByRole('link', { name: 'v1.4.0' })).toHaveAttribute(
      'href',
      'https://github.com/owner/repo/releases/tag/v1.4.0',
    );
  });

  it('shows a local build version as plain text', () => {
    vi.stubEnv('VITE_APP_VERSION', 'v1.4.0-3-gabc1234-dirty');
    vi.stubEnv('VITE_SOURCE_CODE_URL', 'https://github.com/owner/repo');
    render(<AppVersion />);
    expect(screen.getByText('v1.4.0-3-gabc1234-dirty')).toBeInTheDocument();
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('shows the version as text when there is no source URL', () => {
    vi.stubEnv('VITE_APP_VERSION', 'v1.4.0');
    vi.stubEnv('VITE_SOURCE_CODE_URL', '');
    render(<AppVersion />);
    expect(screen.getByText('v1.4.0')).toBeInTheDocument();
    expect(screen.queryByRole('link')).toBeNull();
  });
});
