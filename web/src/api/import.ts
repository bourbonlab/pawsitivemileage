import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from './client';

export function useImportCsv(vehicleId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ type, s3Key }: { type: 'fuelups' | 'maintenance'; s3Key: string }) =>
      api.importCsv({ params: { vehicleId, type }, body: { s3Key } }),
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
    mutationFn: () => api.recalculateMetrics({ params: { vehicleId } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['fillups', vehicleId] });
      qc.invalidateQueries({ queryKey: ['analytics', vehicleId] });
    },
  });
}
