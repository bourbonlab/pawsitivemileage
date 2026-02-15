import { useQuery, useMutation } from '@tanstack/react-query';
import { apiClient } from './client';

export interface AnalyticsDashboard {
  mpgOverTime: { date: string; mpg: number }[];
  monthlySpending: { month: string; total: number }[];
  costPerMileTrend: { date: string; costPerMile: number }[];
  milesPerMonth: { month: string; miles: number }[];
  fillupFrequency: { month: string; count: number }[];
}

export interface YearOverYear {
  years: {
    year: number;
    totalSpent: number;
    totalGallons: number;
    averageMpg: number;
    totalMiles: number;
    maintenanceCost: number;
  }[];
  trends: {
    spending: 'up' | 'down' | 'flat';
    mpg: 'up' | 'down' | 'flat';
    miles: 'up' | 'down' | 'flat';
  };
}

export interface SummaryCardData {
  year: number;
  totalMiles: number;
  totalFuelCost: number;
  averageMpg: number | null;
  fillupCount: number;
  totalMaintenanceCost: number;
}

export function useAnalyticsDashboard(vehicleId: string | undefined) {
  return useQuery({
    queryKey: ['analytics', vehicleId],
    queryFn: () =>
      apiClient<AnalyticsDashboard>(`/v1/vehicles/${vehicleId}/analytics`),
    enabled: !!vehicleId,
  });
}

export function useYearOverYear(vehicleId: string | undefined) {
  return useQuery({
    queryKey: ['analytics', vehicleId, 'yoy'],
    queryFn: () =>
      apiClient<YearOverYear>(`/v1/vehicles/${vehicleId}/analytics/yoy`),
    enabled: !!vehicleId,
  });
}

export function useGenerateSummaryCard(vehicleId: string) {
  return useMutation({
    mutationFn: (year: number) =>
      apiClient<SummaryCardData>(
        `/v1/vehicles/${vehicleId}/summary-card`,
        { method: 'POST', body: JSON.stringify({ year }) },
      ),
  });
}
