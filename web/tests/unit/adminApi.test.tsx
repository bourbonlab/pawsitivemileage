import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ReactNode } from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('@/api/client', () => ({
  apiClient: vi.fn().mockResolvedValue({}),
}));

import { apiClient } from '@/api/client';
import { useToggleAdmin } from '@/api/admin';

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

describe('useToggleAdmin', () => {
  beforeEach(() => {
    vi.mocked(apiClient).mockClear();
  });

  it('PATCHes the /admin sub-route that the API defines', async () => {
    const { result } = renderHook(() => useToggleAdmin(), { wrapper });

    result.current.mutate({ userId: 'user-1', isAdmin: true });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(apiClient).toHaveBeenCalledWith('/v1/admin/users/user-1/admin', {
      method: 'PATCH',
      body: JSON.stringify({ isAdmin: true }),
    });
  });
});
