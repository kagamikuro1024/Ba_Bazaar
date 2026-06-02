import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  BarChart3,
  CalendarDays,
  ClipboardList,
  FolderKanban,
  Home,
  Inbox,
  Bell,
  ChevronRight,
  Users
} from 'lucide-react';
import { Link, NavLink, useLocation } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch, getMockRole, setMockRole, type NotificationItem, type UserRole } from '@/lib/api';
import { Button } from './ui/button';
import { Card, CardContent } from './ui/card';

type LayoutShellProps = {
  children: ReactNode;
};

type PageIntro = {
  title: string;
  body: string;
};

const pageIntros: Record<string, PageIntro> = {
  '/': {
    title: 'Dashboard',
    body: 'Use this overview to monitor BA capacity, utilization rules, and shortcuts into the main booking workflow.'
  },
  '/timeline': {
    title: 'Timeline',
    body: 'Plan BA workload on the Gantt timeline. Filter by BA or project, move between weeks or months, and create booking requests from open date slots.'
  },
  '/my-schedule': {
    title: 'My Schedule',
    body: 'Review your assigned bookings, upcoming work, and any schedule changes that affect your workload.'
  },
  '/my-requests': {
    title: 'My Requests',
    body: 'Track booking requests you created, including pending approvals, rejected requests, and completed decisions.'
  },
  '/manager/inbox': {
    title: 'Manager Inbox',
    body: 'Review pending booking requests, check capacity risks, and approve or reject work allocations.'
  },
  '/crm/ba': {
    title: 'BA Directory',
    body: 'Browse BA profiles, skills, levels, and availability. Use the directory to understand who can be booked.'
  },
  '/reports': {
    title: 'Reports',
    body: 'Analyze utilization by month, search BA rows, paginate large result sets, and export CSV reports.'
  },
  '/notifications': {
    title: 'Notifications',
    body: 'See booking updates, approval decisions, and workflow alerts in one place.'
  }
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

function getIntroKey(pathname: string) {
  if (pathname.startsWith('/crm/ba/')) return '/crm/ba';
  return pageIntros[pathname] ? pathname : '';
}

export function LayoutShell({ children }: LayoutShellProps) {
  const queryClient = useQueryClient();
  const [role, setRole] = useState(getMockRole());
  const [notificationOpen, setNotificationOpen] = useState(false);
  const location = useLocation();
  const introKey = getIntroKey(location.pathname);
  const intro = introKey ? pageIntros[introKey] : undefined;
  const storageKey = introKey ? `ba-bazaar:intro:${introKey}` : '';
  const [introOpen, setIntroOpen] = useState(false);
  const notifications = useQuery({
    queryKey: ['notifications', role],
    queryFn: () => apiFetch<NotificationItem[]>('/api/notifications')
  });
  const markRead = useMutation({
    mutationFn: (id: string) => apiFetch(`/api/notifications/${id}/read`, { method: 'POST' }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['notifications'] })
  });
  const me = useQuery({
    queryKey: ['me', role],
    queryFn: () => apiFetch<{ user: { full_name: string; role: UserRole } }>('/api/me')
  });
  const unreadCount = notifications.data?.filter((item) => !item.read_at).length ?? 0;
  const recentNotifications = (notifications.data ?? []).slice(0, 5);
  const visibleNavigation = navigation.filter((item) => item.roles.includes(role));
  const mobileNavigation = useMemo(() => {
    const timelineItem = visibleNavigation.find((item) => item.to === '/timeline');
    const otherItems = visibleNavigation.filter((item) => item.to !== '/timeline');
    if (!timelineItem) return visibleNavigation;

    const middleIndex = Math.floor(otherItems.length / 2);
    return [
      ...otherItems.slice(0, middleIndex),
      timelineItem,
      ...otherItems.slice(middleIndex)
    ];
  }, [visibleNavigation]);

  useEffect(() => {
    setNotificationOpen(false);
  }, [location.pathname, role]);

  useEffect(() => {
    if (!intro || !storageKey) {
      setIntroOpen(false);
      return;
    }

    setIntroOpen(window.localStorage.getItem(storageKey) !== 'seen');
  }, [intro, storageKey]);

  function dismissIntro() {
    if (storageKey) {
      window.localStorage.setItem(storageKey, 'seen');
    }
    setIntroOpen(false);
  }

  function handleRoleChange(nextRole: UserRole) {
    setMockRole(nextRole);
    setRole(nextRole);
    void queryClient.invalidateQueries();
  }

  function resolveNotificationPath(item: NotificationItem) {
    if (item.type === 'BOOKING_REJECTED' || item.type === 'BOOKING_CANCELLED') {
      return '/my-requests';
    }

    if (item.related_entity_type === 'Booking') {
      return role === 'BA' ? '/my-schedule' : '/notifications';
    }

    return '/notifications';
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-[1440px] items-center justify-between px-4 py-4 sm:px-6 xl:max-w-[1500px] 2xl:max-w-[1880px]">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-blue-700">
              BA Bazaar
            </p>
            <h1 className="text-xl font-bold text-slate-950">Booking + CRM</h1>
          </div>
          <div className="flex items-center gap-3">
            <div className="relative hidden sm:block">
              <Button
                variant="secondary"
                size="icon"
                aria-label="Notifications"
                aria-expanded={notificationOpen}
                onClick={() => setNotificationOpen((current) => !current)}
              >
                <Bell className="h-4 w-4" />
              </Button>
              {unreadCount > 0 ? (
                <span className="absolute -right-1 -top-1 rounded-full bg-rose-600 px-1.5 text-[10px] font-bold text-white">
                  {unreadCount}
                </span>
              ) : null}
              {notificationOpen ? (
                <Card className="absolute right-0 top-12 z-50 w-[min(24rem,calc(100vw-2rem))] shadow-lg">
                  <CardContent className="p-0">
                    <div className="flex items-center justify-between border-b px-4 py-3">
                      <div>
                        <p className="text-sm font-semibold text-slate-950">Notifications</p>
                        <p className="text-xs text-slate-500">{unreadCount} unread</p>
                      </div>
                      <Button variant="ghost" size="sm" asChild>
                        <Link to="/notifications">View all</Link>
                      </Button>
                    </div>
                    <div className="max-h-96 overflow-y-auto">
                      {recentNotifications.length === 0 ? (
                        <div className="p-4 text-sm text-slate-600">No notifications yet.</div>
                      ) : (
                        recentNotifications.map((item) => (
                          <Link
                            key={item.id}
                            to={resolveNotificationPath(item)}
                            className="block border-b px-4 py-3 last:border-b-0 hover:bg-slate-50"
                            onClick={() => {
                              if (!item.read_at) {
                                markRead.mutate(item.id);
                              }
                            }}
                          >
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0">
                                <p className="text-sm font-semibold text-slate-950">{item.title}</p>
                                <p className="mt-1 whitespace-pre-line text-sm text-slate-600">
                                  {item.message}
                                </p>
                              </div>
                              <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
                            </div>
                          </Link>
                        ))
                      )}
                    </div>
                  </CardContent>
                </Card>
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

      <div className="mx-auto grid max-w-[1440px] gap-5 px-4 pb-28 pt-5 sm:px-6 lg:grid-cols-[260px_minmax(0,1fr)] lg:pb-5 xl:max-w-[1500px] 2xl:max-w-[1880px]">
        <Card className="hidden h-fit p-2 lg:block">
          <nav className="grid gap-1" aria-label="Main navigation">
            {visibleNavigation.map((item) => {
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

      <nav
        className="fixed inset-x-3 bottom-3 z-40 rounded-3xl border border-slate-200 bg-white p-2 shadow-2xl shadow-slate-900/12 lg:hidden"
        aria-label="Mobile navigation"
      >
        <div className="flex items-stretch justify-around gap-1">
          {mobileNavigation.map((item) => {
            const Icon = item.icon;

            return (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.to === '/'}
                className="min-w-0 flex-1"
              >
                {({ isActive }) => (
                  <div
                    className={[
                      'relative flex min-w-0 flex-col items-center justify-center gap-1 rounded-2xl px-2 py-2 text-center transition-colors',
                      isActive
                        ? 'bg-blue-50 text-blue-700'
                        : 'text-slate-500 hover:bg-slate-100 hover:text-slate-950'
                    ].join(' ')}
                  >
                    <div
                      className={[
                        'relative flex h-8 w-12 items-center justify-center rounded-full transition-colors',
                        isActive ? 'bg-white shadow-sm ring-1 ring-blue-100' : 'bg-transparent'
                      ].join(' ')}
                    >
                      <Icon className="h-5 w-5" aria-hidden="true" />
                      {item.to === '/notifications' && unreadCount > 0 ? (
                        <span className="absolute -right-1 -top-1 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-600 px-1 text-[10px] font-bold leading-none text-white ring-2 ring-white">
                          {unreadCount}
                        </span>
                      ) : null}
                    </div>
                    <span className="block w-full truncate text-[11px] font-medium leading-none">
                      {item.label}
                    </span>
                  </div>
                )}
              </NavLink>
            );
          })}
        </div>
      </nav>

      {introOpen && intro ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/30 p-4">
          <Card className="w-full max-w-md shadow-2xl">
            <CardContent className="grid gap-4 p-5">
              <div>
                <p className="text-xs font-bold uppercase text-blue-700">First visit</p>
                <h2 className="mt-1 text-xl font-bold text-slate-950">{intro.title}</h2>
                <p className="mt-2 text-sm leading-6 text-slate-600">{intro.body}</p>
              </div>
              <Button onClick={dismissIntro}>Got it</Button>
            </CardContent>
          </Card>
        </div>
      ) : null}
    </div>
  );
}
