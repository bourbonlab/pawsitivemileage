import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from './client';
import type { Vehicle } from '../types';

type VehicleInput = Omit<Vehicle, 'userId' | 'vehicleId' | 'isArchived' | 'createdAt' | 'updatedAt'>;

export function useVehicles(filter?: 'active' | 'archived') {
  return useQuery({
    queryKey: ['vehicles', filter],
    queryFn: () => {
      const params = filter ? `?status=${filter}` : '';
      return apiClient<Vehicle[]>(`/v1/vehicles${params}`);
    },
  });
}

export function useVehicle(vehicleId: string | undefined) {
  return useQuery({
    queryKey: ['vehicles', vehicleId],
    queryFn: () => apiClient<Vehicle>(`/v1/vehicles/${vehicleId}`),
    enabled: !!vehicleId,
  });
}

export function useCreateVehicle() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: VehicleInput) =>
      apiClient<Vehicle>('/v1/vehicles', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['vehicles'] });
    },
  });
}

export function useUpdateVehicle(vehicleId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: Partial<VehicleInput>) =>
      apiClient<Vehicle>(`/v1/vehicles/${vehicleId}`, {
        method: 'PUT',
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['vehicles'] });
    },
  });
}

export function useArchiveVehicle(vehicleId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (archive: boolean) =>
      apiClient<Vehicle>(`/v1/vehicles/${vehicleId}/archive`, {
        method: 'PATCH',
        body: JSON.stringify({ isArchived: archive }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['vehicles'] });
    },
  });
}
