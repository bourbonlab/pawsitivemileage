import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from './client';

interface ImportResult {
  totalRows: number;
  imported: number;
  skipped: number;
  duplicates: number;
  errors: string[];
}

interface RecalculateResult {
  recalculatedCount: number;
}

export function useImportCsv(vehicleId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ type, s3Key }: { type: 'fuelups' | 'maintenance'; s3Key: string }) =>
      apiClient<ImportResult>(`/v1/vehicles/${vehicleId}/import/${type}`, {
        method: 'POST',
        body: JSON.stringify({ s3Key }),
      }),
    onSuccess: (_data, variables) => {
      if (variables.type === 'fuelups') {
        qc.invalidateQueries({ queryKey: ['fillups', vehicleId] });
      } else {
        qc.invalidateQueries({ queryKey: ['maintenance', vehicleId] });
        qc.invalidateQueries({ queryKey: ['reminders', vehicleId] });
      }
    },
  });
}

export function useRecalculateMetrics(vehicleId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      apiClient<RecalculateResult>(`/v1/vehicles/${vehicleId}/recalculate`, {
        method: 'POST',
        body: JSON.stringify({}),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['fillups', vehicleId] });
      qc.invalidateQueries({ queryKey: ['analytics', vehicleId] });
    },
  });
}
