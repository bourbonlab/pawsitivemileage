import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from './client';
import type { User, MaintenanceSchema } from '../types';

export interface AdminUserStats extends User {
  vehicleCount: number;
  fillupCount: number;
  lastActive?: string;
}

interface PlatformStats {
  totalUsers: number;
  activeUsers: number;
  totalFillups: number;
  totalVehicles: number;
}

export function useAdminUsers() {
  return useQuery({
    queryKey: ['admin', 'users'],
    queryFn: () => apiClient<AdminUserStats[]>('/v1/admin/users'),
  });
}

export function useToggleAdmin() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ userId, isAdmin }: { userId: string; isAdmin: boolean }) =>
      apiClient<User>(`/v1/admin/users/${userId}/admin`, {
        method: 'PATCH',
        body: JSON.stringify({ isAdmin }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'users'] });
    },
  });
}

export function useAdminSchemas() {
  return useQuery({
    queryKey: ['admin', 'schemas'],
    queryFn: () => apiClient<MaintenanceSchema[]>('/v1/admin/schemas'),
  });
}

type SchemaInput = Omit<MaintenanceSchema, 'schemaId' | 'isActive' | 'createdAt' | 'updatedAt'>;

export function useCreateSchema() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: SchemaInput) =>
      apiClient<MaintenanceSchema>('/v1/admin/schemas', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'schemas'] });
    },
  });
}

export function useUpdateSchema(schemaId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: Partial<SchemaInput>) =>
      apiClient<MaintenanceSchema>(`/v1/admin/schemas/${schemaId}`, {
        method: 'PUT',
        body: JSON.stringify(data),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'schemas'] });
    },
  });
}

export function useToggleSchemaActive(schemaId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (isActive: boolean) =>
      apiClient<MaintenanceSchema>(`/v1/admin/schemas/${schemaId}`, {
        method: 'PATCH',
        body: JSON.stringify({ isActive }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'schemas'] });
    },
  });
}

export function useAdminStats() {
  return useQuery({
    queryKey: ['admin', 'stats'],
    queryFn: () => apiClient<PlatformStats>('/v1/admin/stats'),
  });
}
