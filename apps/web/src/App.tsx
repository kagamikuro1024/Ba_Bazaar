import { Navigate, Route, Routes } from 'react-router-dom';
import { LayoutShell } from './components/LayoutShell';
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
        <Route path="/" element={<DashboardPage />} />
        <Route path="/timeline" element={<TimelinePage />} />
        <Route path="/my-schedule" element={<MySchedulePage />} />
        <Route path="/my-requests" element={<MyRequestsPage />} />
        <Route path="/manager/inbox" element={<ManagerInboxPage />} />
        <Route path="/crm/ba" element={<BADirectoryPage />} />
        <Route path="/crm/ba/:id" element={<BAProfilePage />} />
        <Route path="/reports" element={<ReportsPage />} />
        <Route path="/notifications" element={<NotificationsPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </LayoutShell>
  );
}
