import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from './client';
import type { Fillup } from '../types';

type FillupCreate = {
  date: string;
  currencySpent: number;
  gallonsAdded: number;
  odometerReading: number;
  isPartialFill?: boolean;
  locationLat?: number;
  locationLng?: number;
  stationName?: string;
  address?: string;
  receiptPhotoKey?: string;
  notes?: string;
};

type FillupUpdate = Partial<FillupCreate>;

export function useFillups(vehicleId: string | undefined) {
  return useQuery({
    queryKey: ['fillups', vehicleId],
    queryFn: () => apiClient<Fillup[]>(`/v1/vehicles/${vehicleId}/fillups`),
    enabled: !!vehicleId,
  });
}

export function useFillup(vehicleId: string | undefined, fillupId: string | undefined) {
  return useQuery({
    queryKey: ['fillups', vehicleId, fillupId],
    queryFn: () => apiClient<Fillup>(`/v1/vehicles/${vehicleId}/fillups/${fillupId}`),
    enabled: !!vehicleId && !!fillupId,
  });
}

export function useCreateFillup(vehicleId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: FillupCreate) =>
      apiClient<Fillup>(`/v1/vehicles/${vehicleId}/fillups`, {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['fillups', vehicleId] });
      qc.invalidateQueries({ queryKey: ['vehicles', vehicleId] });
    },
  });
}

export function useUpdateFillup(vehicleId: string, fillupId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: FillupUpdate) =>
      apiClient<Fillup>(`/v1/vehicles/${vehicleId}/fillups/${fillupId}`, {
        method: 'PUT',
        body: JSON.stringify(data),
      }),
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
      apiClient<Fillup>(`/v1/vehicles/${vehicleId}/fillups/${fillupId}`, {
        method: 'PUT',
        body: JSON.stringify(data),
      }),
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
    mutationFn: (fillupId: string) =>
      apiClient<void>(`/v1/vehicles/${vehicleId}/fillups/${fillupId}`, {
        method: 'DELETE',
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['fillups', vehicleId] });
      qc.invalidateQueries({ queryKey: ['vehicles', vehicleId] });
    },
  });
}
