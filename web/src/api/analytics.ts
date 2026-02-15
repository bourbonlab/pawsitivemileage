import { useQuery, useMutation } from '@tanstack/react-query';
import { apiClient } from './client';

export interface AnalyticsDashboard {
  mpgOverTime: { date: string; mpg: number }[];
  monthlySpending: { month: string; totalSpent: number }[];
  costPerMileTrend: { date: string; costPerMile: number }[];
  pricePerGallonTrend: { date: string; pricePerGallon: number }[];
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

interface YearOverYearSummary {
  year: string;
  totalSpent: number;
  totalGallons: number;
  averageMpg: number | null;
  totalMiles: number;
  maintenanceCost: number;
  trends?: {
    totalSpent: 'up' | 'down' | 'flat';
    totalGallons: 'up' | 'down' | 'flat';
    averageMpg: 'up' | 'down' | 'flat';
    totalMiles: 'up' | 'down' | 'flat';
    maintenanceCost: 'up' | 'down' | 'flat';
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
    queryFn: async () => {
      const raw = await apiClient<{ summaries: YearOverYearSummary[] }>(
        `/v1/vehicles/${vehicleId}/analytics/yoy`,
      );

      const summaries = raw.summaries ?? [];
      if (summaries.length === 0) {
        return { years: [], trends: { spending: 'flat', mpg: 'flat', miles: 'flat' } } as YearOverYear;
      }

      // Use the most recent year's trends for the top-level indicators
      const latest = summaries[summaries.length - 1];
      return {
        years: summaries.map((s) => ({
          year: Number(s.year),
          totalSpent: s.totalSpent,
          totalGallons: s.totalGallons,
          averageMpg: s.averageMpg ?? 0,
          totalMiles: s.totalMiles,
          maintenanceCost: s.maintenanceCost,
        })),
        trends: {
          spending: latest.trends?.totalSpent ?? 'flat',
          mpg: latest.trends?.averageMpg ?? 'flat',
          miles: latest.trends?.totalMiles ?? 'flat',
        },
      } as YearOverYear;
    },
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
