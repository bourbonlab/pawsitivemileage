import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { OperationBody } from '@pawsitivemileage/sdk';
import { api } from './client';

type FillupUpdate = OperationBody<'updateFillup'>;

export function useFillups(vehicleId: string | undefined) {
  return useQuery({
    queryKey: ['fillups', vehicleId],
    queryFn: () => api.listFillups({ params: { vehicleId: vehicleId! } }),
    enabled: !!vehicleId,
  });
}

export function useFillup(vehicleId: string | undefined, fillupId: string | undefined) {
  return useQuery({
    queryKey: ['fillups', vehicleId, fillupId],
    queryFn: () => api.getFillup({ params: { vehicleId: vehicleId!, fillupId: fillupId! } }),
    enabled: !!vehicleId && !!fillupId,
  });
}

export function useCreateFillup(vehicleId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: OperationBody<'createFillup'>) => api.createFillup({ params: { vehicleId }, body: data }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['fillups', vehicleId] });
      qc.invalidateQueries({ queryKey: ['vehicles', vehicleId] });
    },
  });
}

export function useUpdateFillup(vehicleId: string, fillupId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: FillupUpdate) => api.updateFillup({ params: { vehicleId, fillupId }, body: data }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['fillups', vehicleId] });
      qc.invalidateQueries({ queryKey: ['vehicles', vehicleId] });
    },
  });
}

export function useEditFillup(vehicleId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ fillupId, data }: { fillupId: string; data: FillupUpdate }) =>
      api.updateFillup({ params: { vehicleId, fillupId }, body: data }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['fillups', vehicleId] });
      qc.invalidateQueries({ queryKey: ['vehicles', vehicleId] });
      qc.invalidateQueries({ queryKey: ['analytics', vehicleId] });
    },
  });
}

export function useDeleteFillup(vehicleId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (fillupId: string) => api.deleteFillup({ params: { vehicleId, fillupId } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['fillups', vehicleId] });
      qc.invalidateQueries({ queryKey: ['vehicles', vehicleId] });
    },
  });
}
