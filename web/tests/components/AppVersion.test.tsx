import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { AppVersion, resetAppVersionForTests } from '@/components/AppVersion';

function serveVersion(response: Response | Error) {
  const fetchMock = vi.fn(() =>
    response instanceof Error ? Promise.reject(response) : Promise.resolve(response),
  );
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });

describe('AppVersion', () => {
  beforeEach(() => {
    resetAppVersionForTests();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('links a release version to its GitHub release', async () => {
    serveVersion(json({ version: 'v1.4.0' }));
    vi.stubEnv('VITE_SOURCE_CODE_URL', 'https://github.com/owner/repo/');
    render(<AppVersion />);
    expect(await screen.findByRole('link', { name: 'v1.4.0' })).toHaveAttribute(
      'href',
      'https://github.com/owner/repo/releases/tag/v1.4.0',
    );
  });

  it('reads /version.json without the HTTP cache', async () => {
    const fetchMock = serveVersion(json({ version: 'v1.4.0' }));
    render(<AppVersion />);
    await screen.findByText('v1.4.0');
    expect(fetchMock).toHaveBeenCalledWith('/version.json', { cache: 'no-cache' });
  });

  it('fetches once for several footers on the page', async () => {
    const fetchMock = serveVersion(json({ version: 'v1.4.0' }));
    render(
      <>
        <AppVersion />
        <AppVersion />
      </>,
    );
    await waitFor(() => expect(screen.getAllByText('v1.4.0')).toHaveLength(2));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('shows a local build version as plain text', async () => {
    serveVersion(json({ version: 'v1.4.0-3-gabc1234-dirty' }));
    vi.stubEnv('VITE_SOURCE_CODE_URL', 'https://github.com/owner/repo');
    render(<AppVersion />);
    expect(await screen.findByText('v1.4.0-3-gabc1234-dirty')).toBeInTheDocument();
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('shows the version as text when there is no source URL', async () => {
    serveVersion(json({ version: 'v1.4.0' }));
    vi.stubEnv('VITE_SOURCE_CODE_URL', '');
    render(<AppVersion />);
    expect(await screen.findByText('v1.4.0')).toBeInTheDocument();
    expect(screen.queryByRole('link')).toBeNull();
  });

  it.each([
    ['a missing file', new Response('not found', { status: 404 })],
    ['a non-JSON response (SPA fallback)', new Response('<!doctype html>', { status: 200 })],
    ['a network error', new Error('offline')],
    ['an empty version', json({ version: '' })],
  ])('renders nothing for %s', async (_case, response) => {
    const fetchMock = serveVersion(response);
    const { container } = render(<AppVersion />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 0));
    expect(container.innerHTML).toBe('');
  });
});
