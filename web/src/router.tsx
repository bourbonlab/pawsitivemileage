import { createBrowserRouter, Navigate } from 'react-router';
import { ProtectedRoute } from './auth/ProtectedRoute';
import { AdminRoute } from './auth/AdminRoute';
import { Layout } from './components/Layout';
import LoginPage from './pages/LoginPage';
import PrivacyPolicyPage from './pages/PrivacyPolicyPage';
import TermsOfServicePage from './pages/TermsOfServicePage';
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
import NotFoundPage from './pages/NotFoundPage';

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
    element: <PrivacyPolicyPage />,
  },
  {
    path: '/terms',
    element: <TermsOfServicePage />,
  },
  {
    path: '/garage',
    element: (
      <ProtectedRoute>
        <Layout>
          <GaragePage />
        </Layout>
      </ProtectedRoute>
    ),
  },
  {
    path: '/vehicles/:vehicleId',
    element: (
      <ProtectedRoute>
        <Layout>
          <VehicleDetailPage />
        </Layout>
      </ProtectedRoute>
    ),
  },
  {
    path: '/vehicles/:vehicleId/fillups/new',
    element: (
      <ProtectedRoute>
        <Layout>
          <AddFillupPage />
        </Layout>
      </ProtectedRoute>
    ),
  },
  {
    path: '/vehicles/:vehicleId/maintenance/new',
    element: (
      <ProtectedRoute>
        <Layout>
          <AddMaintenancePage />
        </Layout>
      </ProtectedRoute>
    ),
  },
  {
    path: '/vehicles/:vehicleId/analytics',
    element: (
      <ProtectedRoute>
        <Layout>
          <AnalyticsPage />
        </Layout>
      </ProtectedRoute>
    ),
  },
  {
    path: '/vehicles/:vehicleId/export',
    element: (
      <ProtectedRoute>
        <Layout>
          <ExportPage />
        </Layout>
      </ProtectedRoute>
    ),
  },
  {
    path: '/admin/users',
    element: (
      <AdminRoute>
        <Layout>
          <AdminUsersPage />
        </Layout>
      </AdminRoute>
    ),
  },
  {
    path: '/admin/schemas',
    element: (
      <AdminRoute>
        <Layout>
          <AdminSchemasPage />
        </Layout>
      </AdminRoute>
    ),
  },
  {
    path: '/admin/stats',
    element: (
      <AdminRoute>
        <Layout>
          <AdminStatsPage />
        </Layout>
      </AdminRoute>
    ),
  },
  {
    path: '/account',
    element: (
      <ProtectedRoute>
        <Layout>
          <AccountPage />
        </Layout>
      </ProtectedRoute>
    ),
  },
  {
    path: '*',
    element: <NotFoundPage />,
  },
]);
