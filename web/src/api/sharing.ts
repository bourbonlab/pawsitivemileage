import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { OperationBody } from '@pawsitivemileage/sdk';
import { api } from './client';

export function useSharedVehicles() {
  return useQuery({
    queryKey: ['sharedVehicles'],
    queryFn: () => api.listSharedVehicles(),
  });
}

export function useVehicleShares(vehicleId: string) {
  return useQuery({
    queryKey: ['vehicleShares', vehicleId],
    queryFn: () => api.listShares({ params: { vehicleId } }),
    enabled: !!vehicleId,
  });
}

export function useCreateShare(vehicleId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: OperationBody<'shareVehicle'>) => api.shareVehicle({ params: { vehicleId }, body: data }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['vehicleShares', vehicleId] });
      qc.invalidateQueries({ queryKey: ['sharedVehicles'] });
    },
  });
}

export function useDeleteShare(vehicleId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ shareId }: { shareId: string }) => api.unshareVehicle({ params: { vehicleId, shareId } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['vehicleShares', vehicleId] });
      qc.invalidateQueries({ queryKey: ['sharedVehicles'] });
    },
  });
}
