import { type ReactNode } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { LayoutShell } from './components/LayoutShell';
import { Card, CardContent, CardHeader, CardTitle } from './components/ui/card';
import { getMockRole, type UserRole } from './lib/api';
import { BADirectoryPage } from './pages/BADirectoryPage';
import { BAProfilePage } from './pages/BAProfilePage';
import { DashboardPage } from './pages/DashboardPage';
import { ManagerInboxPage } from './pages/ManagerInboxPage';
import { MyRequestsPage } from './pages/MyRequestsPage';
import { MySchedulePage } from './pages/MySchedulePage';
import { NotificationsPage } from './pages/NotificationsPage';
import { ReportsPage } from './pages/ReportsPage';
import { TimelinePage } from './pages/TimelinePage';

export function App() {
  return (
    <LayoutShell>
      <Routes>
        <Route path="/" element={<HomeRedirect />} />
        <Route
          path="/manager/dashboard"
          element={
            <RequireRole roles={['BA_MANAGER', 'ADMIN']}>
              <DashboardPage />
            </RequireRole>
          }
        />
        <Route path="/timeline" element={<TimelinePage />} />
        <Route path="/my-schedule" element={<MySchedulePage />} />
        <Route path="/my-requests" element={<MyRequestsPage />} />
        <Route
          path="/manager/inbox"
          element={
            <RequireRole roles={['BA_MANAGER', 'ADMIN']}>
              <ManagerInboxPage />
            </RequireRole>
          }
        />
        <Route path="/crm/ba" element={<BADirectoryPage />} />
        <Route path="/crm/ba/:id" element={<BAProfilePage />} />
        <Route
          path="/reports"
          element={
            <RequireRole roles={['BA_MANAGER', 'ADMIN']}>
              <ReportsPage />
            </RequireRole>
          }
        />
        <Route path="/notifications" element={<NotificationsPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </LayoutShell>
  );
}

function HomeRedirect() {
  const role = getMockRole();

  if (role === 'BA_MANAGER' || role === 'ADMIN') {
    return <Navigate to="/manager/dashboard" replace />;
  }

  if (role === 'PM_PO') {
    return <Navigate to="/my-requests" replace />;
  }

  return <Navigate to="/my-schedule" replace />;
}

function RequireRole({ roles, children }: { roles: UserRole[]; children: ReactNode }) {
  const role = getMockRole();

  if (!roles.includes(role)) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Access denied</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-slate-600">
          Current mock role does not have permission to view this page.
        </CardContent>
      </Card>
    );
  }

  return <>{children}</>;
}
