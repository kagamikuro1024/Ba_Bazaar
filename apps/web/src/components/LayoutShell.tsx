import { useState, type ReactNode } from 'react';
import {
  BarChart3,
  CalendarDays,
  ClipboardList,
  FolderKanban,
  Home,
  Inbox,
  Bell,
  Users
} from 'lucide-react';
import { NavLink } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch, getMockRole, setMockRole, type NotificationItem, type UserRole } from '@/lib/api';
import { Button } from './ui/button';
import { Card } from './ui/card';

type LayoutShellProps = {
  children: ReactNode;
};

const navigation: Array<{
  to: string;
  label: string;
  icon: typeof Home;
  roles: UserRole[];
}> = [
  { to: '/', label: 'Dashboard', icon: Home, roles: ['BA_MANAGER', 'PM_PO', 'BA'] },
  { to: '/timeline', label: 'Timeline', icon: CalendarDays, roles: ['BA_MANAGER', 'PM_PO', 'BA'] },
  { to: '/my-schedule', label: 'My Schedule', icon: ClipboardList, roles: ['BA'] },
  { to: '/my-requests', label: 'My Requests', icon: FolderKanban, roles: ['PM_PO'] },
  { to: '/manager/inbox', label: 'Manager Inbox', icon: Inbox, roles: ['BA_MANAGER'] },
  { to: '/crm/ba', label: 'BA Directory', icon: Users, roles: ['BA_MANAGER', 'PM_PO', 'BA'] },
  { to: '/reports', label: 'Reports', icon: BarChart3, roles: ['BA_MANAGER'] },
  { to: '/notifications', label: 'Notifications', icon: Bell, roles: ['BA_MANAGER', 'PM_PO', 'BA'] }
];

export function LayoutShell({ children }: LayoutShellProps) {
  const queryClient = useQueryClient();
  const [role, setRole] = useState(getMockRole());
  const notifications = useQuery({
    queryKey: ['notifications', role],
    queryFn: () => apiFetch<NotificationItem[]>('/api/notifications')
  });
  const me = useQuery({
    queryKey: ['me', role],
    queryFn: () => apiFetch<{ user: { full_name: string; role: UserRole } }>('/api/me')
  });
  const unreadCount = notifications.data?.filter((item) => !item.read_at).length ?? 0;

  function handleRoleChange(nextRole: UserRole) {
    setMockRole(nextRole);
    setRole(nextRole);
    void queryClient.invalidateQueries();
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-[1440px] items-center justify-between px-4 py-4 sm:px-6">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-blue-700">
              BA Bazaar
            </p>
            <h1 className="text-xl font-bold text-slate-950">Booking + CRM</h1>
          </div>
          <div className="flex items-center gap-3">
            <div className="relative">
              <Button variant="secondary" size="icon" aria-label="Notifications">
                <Bell className="h-4 w-4" />
              </Button>
              {unreadCount > 0 ? (
                <span className="absolute -right-1 -top-1 rounded-full bg-rose-600 px-1.5 text-[10px] font-bold text-white">
                  {unreadCount}
                </span>
              ) : null}
            </div>
            <div className="hidden text-right text-xs text-slate-500 sm:block">
              <p className="font-semibold text-slate-700">
                {me.data?.user.full_name ?? 'Mock user'}
              </p>
              <p>{role.replace('_', ' ')}</p>
            </div>
            <select
              value={role}
              onChange={(event) => handleRoleChange(event.target.value as UserRole)}
              className="h-9 rounded-md border border-slate-200 bg-white px-2 text-sm font-medium text-slate-700"
              aria-label="Mock role switcher"
            >
              <option value="BA_MANAGER">BA Manager</option>
              <option value="PM_PO">PM/PO</option>
              <option value="BA">BA</option>
            </select>
          </div>
        </div>
      </header>

      <div className="mx-auto grid max-w-[1440px] gap-5 px-4 py-5 sm:px-6 lg:grid-cols-[260px_minmax(0,1fr)]">
        <Card className="h-fit p-2">
          <nav className="grid gap-1" aria-label="Main navigation">
            {navigation.filter((item) => item.roles.includes(role)).map((item) => {
              const Icon = item.icon;

              return (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.to === '/'}
                  className={({ isActive }) =>
                    [
                      'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
                      isActive
                        ? 'bg-blue-50 text-blue-700'
                        : 'text-slate-600 hover:bg-slate-100 hover:text-slate-950'
                    ].join(' ')
                  }
                >
                  <Icon className="h-4 w-4" aria-hidden="true" />
                  <span>{item.label}</span>
                </NavLink>
              );
            })}
          </nav>
        </Card>

        <main>{children}</main>
      </div>
    </div>
  );
}
