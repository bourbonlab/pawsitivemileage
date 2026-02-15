import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from './client';
import type { MaintenanceRecord, Reminder } from '../types';

type MaintenanceCreate = {
  schemaId?: string;
  schemaName?: string;
  customTypeName?: string;
  datePerformed: string;
  odometerAtService: number;
  cost: number;
  location?: string;
  notes?: string;
  receiptPhotoKey?: string;
};

type MaintenanceUpdate = Partial<MaintenanceCreate>;

export function useMaintenanceRecords(vehicleId: string | undefined) {
  return useQuery({
    queryKey: ['maintenance', vehicleId],
    queryFn: () =>
      apiClient<MaintenanceRecord[]>(`/v1/vehicles/${vehicleId}/maintenance`),
    enabled: !!vehicleId,
  });
}

export function useMaintenanceRecord(
  vehicleId: string | undefined,
  recordId: string | undefined,
) {
  return useQuery({
    queryKey: ['maintenance', vehicleId, recordId],
    queryFn: () =>
      apiClient<MaintenanceRecord>(
        `/v1/vehicles/${vehicleId}/maintenance/${recordId}`,
      ),
    enabled: !!vehicleId && !!recordId,
  });
}

export function useReminders(vehicleId: string | undefined) {
  return useQuery({
    queryKey: ['reminders', vehicleId],
    queryFn: () =>
      apiClient<Reminder[]>(`/v1/vehicles/${vehicleId}/maintenance/reminders`),
    enabled: !!vehicleId,
  });
}

export function useCreateMaintenance(vehicleId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: MaintenanceCreate) =>
      apiClient<MaintenanceRecord>(`/v1/vehicles/${vehicleId}/maintenance`, {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['maintenance', vehicleId] });
      qc.invalidateQueries({ queryKey: ['reminders', vehicleId] });
    },
  });
}

export function useUpdateMaintenance(vehicleId: string, recordId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: MaintenanceUpdate) =>
      apiClient<MaintenanceRecord>(
        `/v1/vehicles/${vehicleId}/maintenance/${recordId}`,
        { method: 'PUT', body: JSON.stringify(data) },
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['maintenance', vehicleId] });
      qc.invalidateQueries({ queryKey: ['reminders', vehicleId] });
    },
  });
}

export function useDeleteMaintenance(vehicleId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (recordId: string) =>
      apiClient<void>(
        `/v1/vehicles/${vehicleId}/maintenance/${recordId}`,
        { method: 'DELETE' },
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['maintenance', vehicleId] });
      qc.invalidateQueries({ queryKey: ['reminders', vehicleId] });
    },
  });
}
