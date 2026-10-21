import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ReactNode } from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// A real SDK client over a fake fetch, so these tests check the requests the web actually sends
const fetchMock = vi.hoisted(() => vi.fn(async (_url: string, _init?: RequestInit) =>
  new Response(JSON.stringify({ data: {}, requestId: 'r' }), { status: 200 })));
vi.mock('@/api/client', async () => {
  const { createClient } = await import('@pawsitivemileage/sdk');
  return { api: createClient({ baseUrl: 'https://api.test', getToken: () => 'token', fetch: fetchMock as unknown as typeof fetch }) };
});

import { useToggleAdmin, useToggleSchemaActive } from '@/api/admin';

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

const SCHEMA_ID = '01KHKHBG12P5BK5724XW7X0D30';

describe('admin mutations', () => {
  beforeEach(() => {
    fetchMock.mockClear();
  });

  it('useToggleAdmin PATCHes the /admin sub-route that the API defines', async () => {
    const { result } = renderHook(() => useToggleAdmin(), { wrapper });
    result.current.mutate({ userId: 'user-1', isAdmin: true });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.test/v1/admin/users/user-1/admin');
    expect(init?.method).toBe('PATCH');
    expect(JSON.parse(init?.body as string)).toEqual({ isAdmin: true });
  });

  it('useToggleSchemaActive PATCHes /active (it used to PATCH the schema itself, a 404)', async () => {
    const { result } = renderHook(() => useToggleSchemaActive(SCHEMA_ID), { wrapper });
    result.current.mutate(false);

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`https://api.test/v1/admin/schemas/${SCHEMA_ID}/active`);
    expect(init?.method).toBe('PATCH');
    expect(JSON.parse(init?.body as string)).toEqual({ isActive: false });
  });
});
