import { Navigate } from 'react-router';
import { useAuth } from './AuthProvider';
import type { ReactNode } from 'react';

export function AdminRoute({ children }: { children: ReactNode }) {
  const { isAuthenticated, isAdmin, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  if (!isAdmin) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4">
        <h1 className="text-4xl font-bold">403</h1>
        <p className="text-muted-foreground">
          Forbidden — You do not have permission to access this page.
        </p>
      </div>
    );
  }

  return <>{children}</>;
}
