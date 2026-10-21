import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { OperationBody } from '@pawsitivemileage/sdk';
import { api } from './client';

export function useVehicles(filter?: 'active' | 'archived') {
  return useQuery({
    queryKey: ['vehicles', filter],
    queryFn: () => api.listVehicles({ query: filter ? { status: filter } : undefined }),
  });
}

export function useVehicle(vehicleId: string | undefined) {
  return useQuery({
    queryKey: ['vehicles', vehicleId],
    queryFn: () => api.getVehicle({ params: { vehicleId: vehicleId! } }),
    enabled: !!vehicleId,
  });
}

export function useCreateVehicle() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: OperationBody<'createVehicle'>) => api.createVehicle({ body: data }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['vehicles'] });
    },
  });
}

export function useUpdateVehicle(vehicleId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: OperationBody<'updateVehicle'>) => api.updateVehicle({ params: { vehicleId }, body: data }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['vehicles'] });
    },
  });
}

export function useArchiveVehicle(vehicleId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (archive: boolean) => api.archiveVehicle({ params: { vehicleId }, body: { isArchived: archive } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['vehicles'] });
    },
  });
}
