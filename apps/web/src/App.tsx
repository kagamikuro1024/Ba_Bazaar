import { type ReactNode } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { AuthProvider, useAuth } from './auth/AuthProvider';
import { roleHomePath } from './auth/routes';
import { LayoutShell } from './components/LayoutShell';
import { GlobalFabProvider } from './context/GlobalFabContext';
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

// Admin imports
import { AdminDashboardPage } from './pages/admin/AdminDashboardPage';
import { AdminUsersPage } from './pages/admin/AdminUsersPage';
import { AdminAuditLogsPage } from './pages/admin/AdminAuditLogsPage';
import { AIObservabilityPage } from './pages/admin/AIObservabilityPage';
import { AISessionsPage } from './pages/admin/AISessionsPage';
import { AIToolCallsPage } from './pages/admin/AIToolCallsPage';
import { AIErrorsPage } from './pages/admin/AIErrorsPage';
import { AIFeedbackPage } from './pages/admin/AIFeedbackPage';
import { AIFeatureFlagsPage } from './pages/admin/AIFeatureFlagsPage';
import { AISettingsPage } from './pages/admin/AISettingsPage';

export function App() {
  return (
    <AuthProvider>
      <GlobalFabProvider>
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
        <Route path="/dashboard" element={<ProtectedPage><LayoutShell suppressPageHeader><DashboardPage /></LayoutShell></ProtectedPage>} />
        <Route path="/timeline" element={<ProtectedPage><LayoutShell suppressPageHeader><TimelinePage /></LayoutShell></ProtectedPage>} />
        <Route path="/my-schedule" element={<ProtectedPage><LayoutShell><MySchedulePage /></LayoutShell></ProtectedPage>} />
        <Route path="/my-requests" element={<ProtectedPage><LayoutShell><MyRequestsPage /></LayoutShell></ProtectedPage>} />
        <Route path="/action-center" element={<RedirectPreserveSearch to="/manager/action-center" />} />
        <Route path="/manager/inbox" element={<RedirectPreserveSearch to="/manager/action-center" />} />
        <Route
          path="/manager/action-center"
          element={
            <ProtectedPage>
              <LayoutShell suppressPageHeader>
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
              <LayoutShell suppressPageHeader>
                <RequireRole roles={['BA_MANAGER', 'ADMIN']}>
                  <ReportsPage />
                </RequireRole>
              </LayoutShell>
            </ProtectedPage>
          }
        />
        <Route path="/notifications" element={<ProtectedPage><LayoutShell suppressPageHeader><NotificationsManagerPage /></LayoutShell></ProtectedPage>} />
        
        {/* Admin Routes */}
        <Route path="/admin/dashboard" element={<ProtectedPage><LayoutShell suppressPageHeader><RequireRole roles={['IT_ADMIN']}><AdminDashboardPage /></RequireRole></LayoutShell></ProtectedPage>} />
        <Route path="/admin/users" element={<ProtectedPage><LayoutShell suppressPageHeader><RequireRole roles={['IT_ADMIN']}><AdminUsersPage /></RequireRole></LayoutShell></ProtectedPage>} />
        <Route path="/admin/audit-logs" element={<ProtectedPage><LayoutShell suppressPageHeader><RequireRole roles={['IT_ADMIN']}><AdminAuditLogsPage /></RequireRole></LayoutShell></ProtectedPage>} />
        <Route path="/admin/ai/observability" element={<ProtectedPage><LayoutShell suppressPageHeader><RequireRole roles={['IT_ADMIN']}><AIObservabilityPage /></RequireRole></LayoutShell></ProtectedPage>} />
        <Route path="/admin/ai/sessions" element={<ProtectedPage><LayoutShell suppressPageHeader><RequireRole roles={['IT_ADMIN']}><AISessionsPage /></RequireRole></LayoutShell></ProtectedPage>} />
        <Route path="/admin/ai/tool-calls" element={<ProtectedPage><LayoutShell suppressPageHeader><RequireRole roles={['IT_ADMIN']}><AIToolCallsPage /></RequireRole></LayoutShell></ProtectedPage>} />
        <Route path="/admin/ai/errors" element={<ProtectedPage><LayoutShell suppressPageHeader><RequireRole roles={['IT_ADMIN']}><AIErrorsPage /></RequireRole></LayoutShell></ProtectedPage>} />
        <Route path="/admin/ai/feedback" element={<ProtectedPage><LayoutShell suppressPageHeader><RequireRole roles={['IT_ADMIN']}><AIFeedbackPage /></RequireRole></LayoutShell></ProtectedPage>} />
        <Route path="/admin/ai/feature-flags" element={<ProtectedPage><LayoutShell suppressPageHeader><RequireRole roles={['IT_ADMIN']}><AIFeatureFlagsPage /></RequireRole></LayoutShell></ProtectedPage>} />
        <Route path="/admin/ai/settings" element={<ProtectedPage><LayoutShell suppressPageHeader><RequireRole roles={['IT_ADMIN']}><AISettingsPage /></RequireRole></LayoutShell></ProtectedPage>} />
        
        <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </GlobalFabProvider>
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
