import { Routes, Route, Navigate } from 'react-router-dom'
import DashboardPage from '@/app/page'
import CustomersPage from '@/app/customers/page'
import UsersPage from '@/app/users/page'
import EscalationsPage from '@/app/escalations/page'
import SettingsPage from '@/app/settings/page'
import { OnboardingPending } from '@/components/onboarding-pending'
import { Login } from './pages/Login'
import { ProtectedRoute } from './components/ProtectedRoute'

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route
        path="/"
        element={
          <ProtectedRoute>
            <DashboardPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/customers"
        element={
          <ProtectedRoute>
            <CustomersPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/customers/:customerId"
        element={
          <ProtectedRoute>
            <CustomersPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/customers/:customerId/:tab"
        element={
          <ProtectedRoute>
            <CustomersPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/customers/:customerId/emails/:emailId"
        element={
          <ProtectedRoute>
            <CustomersPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/users"
        element={
          <ProtectedRoute>
            <UsersPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/users/:userId"
        element={
          <ProtectedRoute>
            <UsersPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/escalations"
        element={
          <ProtectedRoute>
            <EscalationsPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/escalations/:emailId"
        element={
          <ProtectedRoute>
            <EscalationsPage />
          </ProtectedRoute>
        }
      />
      {/* Redirect old integrations route to settings */}
      <Route
        path="/integrations"
        element={<Navigate to="/settings?tab=integrations" replace />}
      />
      {/* Preview route for the onboarding-pending screen — exercised in dev
          / visual review until the real gate trigger is wired in. */}
      <Route
        path="/preview/onboarding"
        element={
          <ProtectedRoute>
            <OnboardingPending />
          </ProtectedRoute>
        }
      />
      <Route
        path="/settings"
        element={
          <ProtectedRoute>
            <SettingsPage />
          </ProtectedRoute>
        }
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
