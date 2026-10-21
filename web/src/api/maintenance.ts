import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { OperationBody } from '@pawsitivemileage/sdk';
import { api } from './client';

type MaintenanceUpdate = OperationBody<'updateMaintenance'>;

export function useMaintenanceRecords(vehicleId: string | undefined) {
  return useQuery({
    queryKey: ['maintenance', vehicleId],
    queryFn: () => api.listMaintenance({ params: { vehicleId: vehicleId! } }),
    enabled: !!vehicleId,
  });
}

export function useReminders(vehicleId: string | undefined) {
  return useQuery({
    queryKey: ['reminders', vehicleId],
    queryFn: () => api.listReminders({ params: { vehicleId: vehicleId! } }),
    enabled: !!vehicleId,
  });
}

/** Active maintenance types for a vehicle — available to the owner and shared users (not admin-only). */
export function useMaintenanceSchemas(vehicleId: string | undefined) {
  return useQuery({
    queryKey: ['maintenanceSchemas', vehicleId],
    queryFn: () => api.listVehicleSchemas({ params: { vehicleId: vehicleId! } }),
    enabled: !!vehicleId,
  });
}

export function useCreateMaintenance(vehicleId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: OperationBody<'createMaintenance'>) => api.createMaintenance({ params: { vehicleId }, body: data }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['maintenance', vehicleId] });
      qc.invalidateQueries({ queryKey: ['reminders', vehicleId] });
    },
  });
}

export function useUpdateMaintenance(vehicleId: string, recordId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: MaintenanceUpdate) => api.updateMaintenance({ params: { vehicleId, recordId }, body: data }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['maintenance', vehicleId] });
      qc.invalidateQueries({ queryKey: ['reminders', vehicleId] });
    },
  });
}

export function useEditMaintenance(vehicleId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ recordId, data }: { recordId: string; data: MaintenanceUpdate }) =>
      api.updateMaintenance({ params: { vehicleId, recordId }, body: data }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['maintenance', vehicleId] });
      qc.invalidateQueries({ queryKey: ['reminders', vehicleId] });
    },
  });
}

export function useDeleteMaintenance(vehicleId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (recordId: string) => api.deleteMaintenance({ params: { vehicleId, recordId } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['maintenance', vehicleId] });
      qc.invalidateQueries({ queryKey: ['reminders', vehicleId] });
    },
  });
}
