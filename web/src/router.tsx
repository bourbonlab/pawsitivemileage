import { createBrowserRouter, Navigate } from 'react-router';
import { ProtectedRoute } from './auth/ProtectedRoute';
import { AdminRoute } from './auth/AdminRoute';
import LoginPage from './pages/LoginPage';
import GaragePage from './pages/GaragePage';
import VehicleDetailPage from './pages/VehicleDetailPage';
import AddFillupPage from './pages/AddFillupPage';
import AddMaintenancePage from './pages/AddMaintenancePage';
import AnalyticsPage from './pages/AnalyticsPage';
import ExportPage from './pages/ExportPage';
import AdminUsersPage from './pages/AdminUsersPage';
import AdminSchemasPage from './pages/AdminSchemasPage';
import AdminStatsPage from './pages/AdminStatsPage';
import AccountPage from './pages/AccountPage';

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
    path: '/garage',
    element: (
      <ProtectedRoute>
        <GaragePage />
      </ProtectedRoute>
    ),
  },
  {
    path: '/vehicles/:vehicleId',
    element: (
      <ProtectedRoute>
        <VehicleDetailPage />
      </ProtectedRoute>
    ),
  },
  {
    path: '/vehicles/:vehicleId/fillups/new',
    element: (
      <ProtectedRoute>
        <AddFillupPage />
      </ProtectedRoute>
    ),
  },
  {
    path: '/vehicles/:vehicleId/maintenance/new',
    element: (
      <ProtectedRoute>
        <AddMaintenancePage />
      </ProtectedRoute>
    ),
  },
  {
    path: '/vehicles/:vehicleId/analytics',
    element: (
      <ProtectedRoute>
        <AnalyticsPage />
      </ProtectedRoute>
    ),
  },
  {
    path: '/vehicles/:vehicleId/export',
    element: (
      <ProtectedRoute>
        <ExportPage />
      </ProtectedRoute>
    ),
  },
  {
    path: '/admin/users',
    element: (
      <AdminRoute>
        <AdminUsersPage />
      </AdminRoute>
    ),
  },
  {
    path: '/admin/schemas',
    element: (
      <AdminRoute>
        <AdminSchemasPage />
      </AdminRoute>
    ),
  },
  {
    path: '/admin/stats',
    element: (
      <AdminRoute>
        <AdminStatsPage />
      </AdminRoute>
    ),
  },
  {
    path: '/account',
    element: (
      <ProtectedRoute>
        <AccountPage />
      </ProtectedRoute>
    ),
  },
]);
