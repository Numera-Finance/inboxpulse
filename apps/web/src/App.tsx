import { Routes, Route, Navigate, useLocation, useParams } from 'react-router-dom'
import DashboardPage from '@/app/page'
import CustomersPage from '@/app/customers/page'
import UsersPage from '@/app/users/page'
import TasksPage from '@/app/tasks/page'
import SettingsPage from '@/app/settings/page'
import { Login } from './pages/Login'
import { ProtectedRoute } from './components/ProtectedRoute'

// Preserve query string + :taskId path param when redirecting the legacy
// /escalations* routes to /tasks*. Old notification email links and
// bookmarks land here.
function EscalationsRedirect() {
  const { taskId } = useParams<{ taskId?: string }>()
  const { search } = useLocation()
  const target = taskId ? `/tasks/${taskId}${search}` : `/tasks${search}`
  return <Navigate to={target} replace />
}

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
        path="/tasks"
        element={
          <ProtectedRoute>
            <TasksPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/tasks/:taskId"
        element={
          <ProtectedRoute>
            <TasksPage />
          </ProtectedRoute>
        }
      />
      {/* Legacy /escalations URLs (notification emails, bookmarks) -> /tasks */}
      <Route path="/escalations" element={<EscalationsRedirect />} />
      <Route path="/escalations/:taskId" element={<EscalationsRedirect />} />
      {/* Redirect old integrations route to settings */}
      <Route
        path="/integrations"
        element={<Navigate to="/settings?tab=integrations" replace />}
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
