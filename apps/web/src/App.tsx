import { type ReactNode } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { AuthProvider, useAuth } from './auth/AuthProvider';
import { roleHomePath } from './auth/routes';
import { LayoutShell } from './components/LayoutShell';
import { Card, CardContent, CardHeader, CardTitle } from './components/ui/card';
import { type UserRole } from './lib/api';
import { BADirectoryPage } from './pages/BADirectoryPage';
import { BAProfilePage } from './pages/BAProfilePage';
import { DashboardPage } from './pages/DashboardPage';
import { LandingPage } from './pages/LandingPage';
import { LoginPage } from './pages/LoginPage';
import { ManagerInboxPage } from './pages/ManagerInboxPage';
import { MyRequestsPage } from './pages/MyRequestsPage';
import { MySchedulePage } from './pages/MySchedulePage';
import { NotificationsManagerPage } from './pages/NotificationsManagerPage';
import { RegisterPage } from './pages/RegisterPage';
import { ReportsPage } from './pages/ReportsPage';
import { TimelinePage } from './pages/TimelinePage';

export function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route
          path="/login"
          element={
            <PublicOnlyRoute>
              <LoginPage />
            </PublicOnlyRoute>
          }
        />
        <Route
          path="/register"
          element={
            <PublicOnlyRoute>
              <RegisterPage />
            </PublicOnlyRoute>
          }
        />
        <Route path="/" element={<LandingPage />} />
        <Route path="/dashboard" element={<ProtectedPage><LayoutShell><DashboardPage /></LayoutShell></ProtectedPage>} />
        <Route path="/timeline" element={<ProtectedPage><LayoutShell><TimelinePage /></LayoutShell></ProtectedPage>} />
        <Route path="/my-schedule" element={<ProtectedPage><LayoutShell><MySchedulePage /></LayoutShell></ProtectedPage>} />
        <Route path="/my-requests" element={<ProtectedPage><LayoutShell><MyRequestsPage /></LayoutShell></ProtectedPage>} />
        <Route path="/action-center" element={<RedirectPreserveSearch to="/manager/action-center" />} />
        <Route path="/manager/inbox" element={<RedirectPreserveSearch to="/manager/action-center" />} />
        <Route
          path="/manager/action-center"
          element={
            <ProtectedPage>
              <LayoutShell>
                <RequireRole roles={['BA_MANAGER', 'ADMIN']}>
                  <ManagerInboxPage />
                </RequireRole>
              </LayoutShell>
            </ProtectedPage>
          }
        />
        <Route
          path="/crm/ba"
          element={
            <ProtectedPage>
              <LayoutShell suppressPageHeader>
                <RequireRole roles={['BA_MANAGER', 'PM_PO', 'BA', 'ADMIN']}>
                  <BADirectoryPage />
                </RequireRole>
              </LayoutShell>
            </ProtectedPage>
          }
        />
        <Route
          path="/crm/ba/:id"
          element={
            <ProtectedPage>
              <LayoutShell>
                <RequireRole roles={['BA_MANAGER', 'PM_PO', 'BA', 'ADMIN']}>
                  <BAProfilePage />
                </RequireRole>
              </LayoutShell>
            </ProtectedPage>
          }
        />
        <Route
          path="/reports"
          element={
            <ProtectedPage>
              <LayoutShell>
                <RequireRole roles={['BA_MANAGER', 'ADMIN']}>
                  <ReportsPage />
                </RequireRole>
              </LayoutShell>
            </ProtectedPage>
          }
        />
        <Route path="/notifications" element={<ProtectedPage><LayoutShell><NotificationsManagerPage /></LayoutShell></ProtectedPage>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AuthProvider>
  );
}

function ProtectedPage({ children }: { children: ReactNode }) {
  const { isAuthenticated, isReady } = useAuth();

  if (!isReady) {
    return null;
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  return <>{children}</>;
}

function RedirectPreserveSearch({ to }: { to: string }) {
  const location = useLocation();
  return <Navigate to={`${to}${location.search}`} replace />;
}

function PublicOnlyRoute({ children }: { children: ReactNode }) {
  const { isAuthenticated, isReady, user } = useAuth();

  if (!isReady) {
    return null;
  }

  if (isAuthenticated && user) {
    return <Navigate to={roleHomePath(user.role)} replace />;
  }

  return <>{children}</>;
}

function RequireRole({ roles, children }: { roles: UserRole[]; children: ReactNode }) {
  const { user } = useAuth();

  if (!user || !roles.includes(user.role)) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Access denied</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-slate-600">
          Your account does not have permission to view this page.
        </CardContent>
      </Card>
    );
  }

  return <>{children}</>;
}
