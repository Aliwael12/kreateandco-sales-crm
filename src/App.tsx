import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider } from '@/context/AuthContext'
import { ToastProvider } from '@/components/ui/Toast'
import { MerchantDetailProvider } from '@/context/MerchantDetailContext'
import { DateRangeProvider } from '@/context/DateRangeContext'
import RequireAuth from '@/components/layout/RequireAuth'
import AppShell from '@/components/layout/AppShell'
import LoginPage from '@/pages/LoginPage'
import DashboardPage from '@/pages/DashboardPage'
import MyProjectsPage from '@/pages/MyProjectsPage'
import PipelinePage from '@/pages/PipelinePage'
import AllMerchantsPage from '@/pages/AllMerchantsPage'
import RemindersPage from '@/pages/RemindersPage'
import TasksPage from '@/pages/TasksPage'
import ActivitiesPage from '@/pages/ActivitiesPage'
import AdminPage from '@/pages/AdminPage'
import SettingsPage from '@/pages/SettingsPage'

export default function App() {
  return (
    <AuthProvider>
      <ToastProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/login" element={<LoginPage />} />

            <Route
              element={
                <RequireAuth>
                  <DateRangeProvider>
                    <MerchantDetailProvider>
                      <AppShell />
                    </MerchantDetailProvider>
                  </DateRangeProvider>
                </RequireAuth>
              }
            >
              <Route index element={<DashboardPage />} />
              <Route path="my-projects" element={<MyProjectsPage />} />
              <Route path="pipeline" element={<PipelinePage />} />
              <Route path="merchants" element={<AllMerchantsPage />} />
              <Route path="reminders" element={<RemindersPage />} />
              <Route path="tasks" element={<TasksPage />} />
              <Route path="activities" element={<ActivitiesPage />} />
              <Route path="admin" element={<AdminPage />} />
              <Route path="settings" element={<SettingsPage />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Route>
          </Routes>
        </BrowserRouter>
      </ToastProvider>
    </AuthProvider>
  )
}
