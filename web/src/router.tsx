import { lazy, Suspense } from 'react';
import { createBrowserRouter, Navigate } from 'react-router';
import { ProtectedRoute } from './auth/ProtectedRoute';
import { AdminRoute } from './auth/AdminRoute';
import { Layout } from './components/Layout';

// Eager-load the login page (first thing users see)
import LoginPage from './pages/LoginPage';

// Lazy-load everything else
const GaragePage = lazy(() => import('./pages/GaragePage'));
const VehicleDetailPage = lazy(() => import('./pages/VehicleDetailPage'));
const AddFillupPage = lazy(() => import('./pages/AddFillupPage'));
const AddMaintenancePage = lazy(() => import('./pages/AddMaintenancePage'));
const AnalyticsPage = lazy(() => import('./pages/AnalyticsPage'));
const ExportPage = lazy(() => import('./pages/ExportPage'));
const AccountPage = lazy(() => import('./pages/AccountPage'));
const AdminUsersPage = lazy(() => import('./pages/AdminUsersPage'));
const AdminSchemasPage = lazy(() => import('./pages/AdminSchemasPage'));
const AdminStatsPage = lazy(() => import('./pages/AdminStatsPage'));
const PrivacyPolicyPage = lazy(() => import('./pages/PrivacyPolicyPage'));
const TermsOfServicePage = lazy(() => import('./pages/TermsOfServicePage'));
const NotFoundPage = lazy(() => import('./pages/NotFoundPage'));

function SuspenseLayout({ children }: { children: React.ReactNode }) {
  return (
    <ProtectedRoute>
      <Layout>
        <Suspense fallback={<div className="flex items-center justify-center min-h-[50vh] text-muted-foreground">Loading…</div>}>
          {children}
        </Suspense>
      </Layout>
    </ProtectedRoute>
  );
}

function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <AdminRoute>
      <Layout>
        <Suspense fallback={<div className="flex items-center justify-center min-h-[50vh] text-muted-foreground">Loading…</div>}>
          {children}
        </Suspense>
      </Layout>
    </AdminRoute>
  );
}

export const router = createBrowserRouter([
  {
    path: '/',
    element: <Navigate to="/garage" replace />,
  },
  {
    path: '/login',
    element: <LoginPage />,
  },
  {
    path: '/callback',
    element: <Navigate to="/garage" replace />,
  },
  {
    path: '/privacy',
    element: (
      <Suspense fallback={null}>
        <PrivacyPolicyPage />
      </Suspense>
    ),
  },
  {
    path: '/terms',
    element: (
      <Suspense fallback={null}>
        <TermsOfServicePage />
      </Suspense>
    ),
  },
  {
    path: '/garage',
    element: <SuspenseLayout><GaragePage /></SuspenseLayout>,
  },
  {
    path: '/vehicles/:vehicleId',
    element: <SuspenseLayout><VehicleDetailPage /></SuspenseLayout>,
  },
  {
    path: '/vehicles/:vehicleId/fillups/new',
    element: <SuspenseLayout><AddFillupPage /></SuspenseLayout>,
  },
  {
    path: '/vehicles/:vehicleId/maintenance/new',
    element: <SuspenseLayout><AddMaintenancePage /></SuspenseLayout>,
  },
  {
    path: '/vehicles/:vehicleId/analytics',
    element: <SuspenseLayout><AnalyticsPage /></SuspenseLayout>,
  },
  {
    path: '/vehicles/:vehicleId/export',
    element: <SuspenseLayout><ExportPage /></SuspenseLayout>,
  },
  {
    path: '/admin/users',
    element: <AdminLayout><AdminUsersPage /></AdminLayout>,
  },
  {
    path: '/admin/schemas',
    element: <AdminLayout><AdminSchemasPage /></AdminLayout>,
  },
  {
    path: '/admin/stats',
    element: <AdminLayout><AdminStatsPage /></AdminLayout>,
  },
  {
    path: '/account',
    element: <SuspenseLayout><AccountPage /></SuspenseLayout>,
  },
  {
    path: '*',
    element: (
      <Suspense fallback={null}>
        <NotFoundPage />
      </Suspense>
    ),
  },
]);
