import { useCallback, useEffect, useMemo, useState } from 'react';

interface UsePaginationOptions {
  defaultPageSize?: number;
}

interface UsePaginationResult<T> {
  pageItems: T[];
  currentPage: number;
  totalPages: number;
  pageSize: number;
  setPage: (page: number) => void;
  setPageSize: (size: number) => void;
  resetPage: () => void;
}

const STORAGE_KEY = 'pm-page-size';
const VALID_SIZES = [10, 20, 50, 100];

function getStoredPageSize(fallback: number): number {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const n = Number(stored);
      if (VALID_SIZES.includes(n)) return n;
    }
  } catch { /* private browsing */ }
  return fallback;
}

export function usePagination<T>(
  items: T[],
  options?: UsePaginationOptions,
): UsePaginationResult<T> {
  const defaultSize = options?.defaultPageSize ?? 10;
  const [pageSize, setPageSizeState] = useState(() => getStoredPageSize(defaultSize));
  const [currentPage, setCurrentPage] = useState(1);

  const totalPages = Math.max(1, Math.ceil(items.length / pageSize));

  // Clamp currentPage when items shrink or pageSize changes
  useEffect(() => {
    setCurrentPage((prev) => Math.min(prev, totalPages));
  }, [totalPages]);

  const setPage = useCallback(
    (page: number) => {
      setCurrentPage(Math.max(1, Math.min(page, totalPages)));
    },
    [totalPages],
  );

  const setPageSize = useCallback((size: number) => {
    setPageSizeState(size);
    setCurrentPage(1);
    try { localStorage.setItem(STORAGE_KEY, String(size)); } catch { /* ignore */ }
  }, []);

  const resetPage = useCallback(() => {
    setCurrentPage(1);
  }, []);

  const pageItems = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return items.slice(start, start + pageSize);
  }, [items, currentPage, pageSize]);

  return {
    pageItems,
    currentPage,
    totalPages,
    pageSize,
    setPage,
    setPageSize,
    resetPage,
  };
}
