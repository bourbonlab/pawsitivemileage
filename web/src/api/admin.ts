import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { OperationBody, OperationResult } from '@pawsitivemileage/sdk';
import { api } from './client';

export type AdminUserStats = OperationResult<'adminListUsers'>[number];

export function useAdminUsers() {
  return useQuery({
    queryKey: ['admin', 'users'],
    queryFn: () => api.adminListUsers(),
  });
}

export function useToggleAdmin() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ userId, isAdmin }: { userId: string; isAdmin: boolean }) =>
      api.adminSetAdmin({ params: { userId }, body: { isAdmin } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'users'] });
    },
  });
}

export function useAdminSchemas() {
  return useQuery({
    queryKey: ['admin', 'schemas'],
    queryFn: () => api.adminListSchemas(),
  });
}

export function useCreateSchema() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: OperationBody<'adminCreateSchema'>) => api.adminCreateSchema({ body: data }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'schemas'] });
    },
  });
}

export function useUpdateSchema(schemaId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: OperationBody<'adminUpdateSchema'>) => api.adminUpdateSchema({ params: { schemaId }, body: data }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'schemas'] });
    },
  });
}

/** PATCH /v1/admin/schemas/{schemaId}/active (the web used to PATCH the schema itself, a 404) */
export function useToggleSchemaActive(schemaId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (isActive: boolean) => api.adminSetSchemaActive({ params: { schemaId }, body: { isActive } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin', 'schemas'] });
    },
  });
}

export function useAdminStats() {
  return useQuery({
    queryKey: ['admin', 'stats'],
    queryFn: () => api.adminStats(),
  });
}
