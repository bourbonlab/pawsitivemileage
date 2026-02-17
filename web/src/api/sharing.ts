import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from './client';
import type { SharedVehicle, ShareRecord, SharePermission } from '../types';

export function useSharedVehicles() {
  return useQuery({
    queryKey: ['sharedVehicles'],
    queryFn: () => apiClient<SharedVehicle[]>('/v1/vehicles/shared'),
  });
}

export function useVehicleShares(vehicleId: string) {
  return useQuery({
    queryKey: ['vehicleShares', vehicleId],
    queryFn: () => apiClient<ShareRecord[]>(`/v1/vehicles/${vehicleId}/sharing`),
    enabled: !!vehicleId,
  });
}

export function useCreateShare(vehicleId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { email: string; permission: SharePermission }) =>
      apiClient<ShareRecord>(`/v1/vehicles/${vehicleId}/sharing`, {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['vehicleShares', vehicleId] });
      qc.invalidateQueries({ queryKey: ['sharedVehicles'] });
    },
  });
}

export function useDeleteShare(vehicleId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ shareId }: { shareId: string }) =>
      apiClient<void>(`/v1/vehicles/${vehicleId}/sharing/${shareId}`, {
        method: 'DELETE',
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['vehicleShares', vehicleId] });
      qc.invalidateQueries({ queryKey: ['sharedVehicles'] });
    },
  });
}
