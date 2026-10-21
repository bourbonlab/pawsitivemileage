import { useQuery, useMutation } from '@tanstack/react-query';
import type { OperationResult } from '@pawsitivemileage/sdk';
import { api } from './client';

export type YearOverYear = OperationResult<'getYearOverYear'>;
export type SummaryCardData = OperationResult<'getSummaryCard'>;

export function useAnalyticsDashboard(vehicleId: string | undefined) {
  return useQuery({
    queryKey: ['analytics', vehicleId],
    queryFn: () => api.getAnalytics({ params: { vehicleId: vehicleId! } }),
    enabled: !!vehicleId,
  });
}

/** Per-year summaries, oldest first; each carries its trends compared with the previous year */
export function useYearOverYear(vehicleId: string | undefined) {
  return useQuery({
    queryKey: ['analytics', vehicleId, 'yoy'],
    queryFn: () => api.getYearOverYear({ params: { vehicleId: vehicleId! } }),
    enabled: !!vehicleId,
  });
}

export function useGenerateSummaryCard(vehicleId: string) {
  return useMutation({
    mutationFn: (year: number) => api.getSummaryCard({ params: { vehicleId }, body: { year } }),
  });
}
