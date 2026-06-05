import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  BarChart3,
  CalendarDays,
  ClipboardList,
  FolderKanban,
  Home,
  Inbox,
  Bell,
  ChevronRight,
  Users,
  Plus
} from 'lucide-react';
import { Link, NavLink, useLocation } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/auth/AuthProvider';
import { apiFetch, type NotificationItem, type UserRole } from '@/lib/api';
import { Button } from './ui/button';
import { Card, CardContent } from './ui/card';
import { BookingModal } from './BookingModal';

type LayoutShellProps = {
  children: ReactNode;
};

type PageIntro = {
  title: string;
  body: string;
};

const pageIntros: Record<string, PageIntro> = {
  '/dashboard': {
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
    body: 'Review, prioritize, and resolve booking requests in one focused workspace.'
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
    { to: '/dashboard', label: 'Dashboard', icon: Home, roles: ['BA_MANAGER', 'PM_PO', 'BA', 'ADMIN'] },
    { to: '/timeline', label: 'Timeline', icon: CalendarDays, roles: ['BA_MANAGER', 'PM_PO', 'BA', 'ADMIN'] },
    { to: '/my-schedule', label: 'My Schedule', icon: ClipboardList, roles: ['BA'] },
    { to: '/my-requests', label: 'My Requests', icon: FolderKanban, roles: ['PM_PO'] },
    { to: '/manager/inbox', label: 'Manager Inbox', icon: Inbox, roles: ['BA_MANAGER', 'ADMIN'] },
    { to: '/crm/ba', label: 'BA Directory', icon: Users, roles: ['BA_MANAGER', 'BA', 'ADMIN'] },
    { to: '/reports', label: 'Reports', icon: BarChart3, roles: ['BA_MANAGER', 'ADMIN'] },
    { to: '/notifications', label: 'Notifications', icon: Bell, roles: ['BA_MANAGER', 'PM_PO', 'BA', 'ADMIN'] }
  ];

function getIntroKey(pathname: string) {
  if (pathname.startsWith('/crm/ba/')) return '/crm/ba';
  return pageIntros[pathname] ? pathname : '';
}

export function LayoutShell({ children }: LayoutShellProps) {
  const queryClient = useQueryClient();
  const { user, logout } = useAuth();
  const role = user?.role;
  const [notificationOpen, setNotificationOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [bookingModalOpen, setBookingModalOpen] = useState(false);
  const notificationRef = useRef<HTMLDivElement>(null);
  const userMenuRef = useRef<HTMLDivElement>(null);
  const location = useLocation();
  const introKey = getIntroKey(location.pathname);
  const intro = introKey ? pageIntros[introKey] : undefined;
  const storageKey = introKey ? `ba-bazaar:intro:${introKey}` : '';
  const [introOpen, setIntroOpen] = useState(false);
  const notifications = useQuery({
    queryKey: ['notifications', user?.id],
    queryFn: () => apiFetch<NotificationItem[]>('/api/notifications'),
    enabled: Boolean(user)
  });
  const markRead = useMutation({
    mutationFn: (id: string) => apiFetch(`/api/notifications/${id}/read`, { method: 'POST' }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['notifications'] })
  });
  const me = useQuery({
    queryKey: ['me', user?.id],
    queryFn: () => apiFetch<{ user: { full_name: string; role: UserRole } }>('/api/me'),
    enabled: Boolean(user)
  });
  const unreadCount = notifications.data?.filter((item) => !item.read_at).length ?? 0;
  const recentNotifications = (notifications.data ?? []).slice(0, 5);
  const visibleNavigation = role ? navigation.filter((item) => item.roles.includes(role)) : [];
  const canCreateBooking = role === 'BA_MANAGER' || role === 'PM_PO';
  const displayRole = role?.replace('_', ' ') ?? '';
  const mobileNavigation = useMemo(() => {
    if (role === 'BA_MANAGER' || role === 'ADMIN') {
      return visibleNavigation.filter((item) => item.to !== '/reports');
    }

    return visibleNavigation;
  }, [role, visibleNavigation]);

  useEffect(() => {
    setNotificationOpen(false);
    setUserMenuOpen(false);
  }, [location.pathname, role]);

  useEffect(() => {
    if (!notificationOpen && !userMenuOpen) {
      return;
    }

    function handlePointerDown(event: PointerEvent) {
      const target = event.target as Node;

      if (notificationRef.current?.contains(target) || userMenuRef.current?.contains(target)) {
        return;
      }

      setNotificationOpen(false);
      setUserMenuOpen(false);
    }

    document.addEventListener('pointerdown', handlePointerDown);
    return () => document.removeEventListener('pointerdown', handlePointerDown);
  }, [notificationOpen, userMenuOpen]);

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

  function resolveNotificationPath(item: NotificationItem) {
    if (item.type === 'BOOKING_REJECTED' || item.type === 'BOOKING_CANCELLED') {
      return '/my-requests';
    }

    if (item.related_entity_type === 'Booking') {
      if (role === 'BA_MANAGER' || role === 'ADMIN') {
        return '/manager/inbox';
      }

      return role === 'BA' ? '/my-schedule' : '/notifications';
    }

    return '/notifications';
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-[1440px] items-center justify-between px-4 py-4 sm:px-6 xl:max-w-[1500px] 2xl:max-w-[1880px]">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-blue-700">
              BA Bazaar
            </p>
            <h1 className="text-xl font-bold text-slate-950">Booking + CRM</h1>
          </div>
          <div className="flex items-center gap-3">
            <div ref={notificationRef} className="relative hidden sm:block">
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
                    <div
                      className="max-h-96 overflow-y-auto overscroll-contain"
                      onWheel={(event) => event.stopPropagation()}
                    >
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
                {me.data?.user.full_name ?? user?.full_name ?? 'Authenticated user'}
              </p>
              <p>{displayRole}</p>
            </div>
            <div ref={userMenuRef} className="relative">
              <button
                type="button"
                aria-label="User menu"
                aria-expanded={userMenuOpen}
                className="flex h-10 w-10 items-center justify-center overflow-hidden rounded-full border border-slate-200 bg-slate-100 transition hover:border-slate-300"
                onClick={() => setUserMenuOpen((current) => !current)}
              >
                {user?.avatar_url ? (
                  <img src={user.avatar_url} alt="" className="h-full w-full object-cover" />
                ) : (
                  <span className="text-sm font-semibold text-slate-700">
                    {(user?.full_name ?? 'U')
                      .split(' ')
                      .map((part) => part[0])
                      .slice(0, 2)
                      .join('')}
                  </span>
                )}
              </button>
              {userMenuOpen ? (
                <Card className="absolute right-0 top-12 z-50 w-56 shadow-lg">
                  <CardContent className="p-2">
                    <div className="border-b border-slate-100 px-2 py-2">
                      <p className="truncate text-sm font-semibold text-slate-950">
                        {me.data?.user.full_name ?? user?.full_name ?? 'Authenticated user'}
                      </p>
                      <p className="text-xs text-slate-500">{displayRole}</p>
                    </div>
                    <Button
                      variant="ghost"
                      className="mt-1 w-full justify-start"
                      onClick={async () => {
                        setUserMenuOpen(false);
                        await logout();
                        await queryClient.invalidateQueries();
                      }}
                    >
                      Logout
                    </Button>
                  </CardContent>
                </Card>
              ) : null}
            </div>
          </div>
        </div>
      </header>

      <div className="mx-auto grid max-w-[1440px] gap-5 px-4 pb-28 pt-5 sm:px-6 lg:grid-cols-[260px_minmax(0,1fr)] lg:pb-5 xl:max-w-[1500px] 2xl:max-w-[1880px]">
        <Card className="sticky top-[5.75rem] hidden max-h-[calc(100vh-7rem)] overflow-y-auto p-2 lg:block">
          <nav className="grid gap-1" aria-label="Main navigation">
            {visibleNavigation.map((item) => {
              const Icon = item.icon;

              return (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end
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
          {canCreateBooking ? (
            <div className="mt-2 border-t pt-2">
              <button
                type="button"
                onClick={() => setBookingModalOpen(true)}
                className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-blue-600 transition-colors hover:bg-blue-50"
              >
                <Plus className="h-4 w-4" aria-hidden="true" />
                <span>Create Booking</span>
              </button>
            </div>
          ) : null}
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
              <NavLink key={item.to} to={item.to} end className="min-w-0 flex-1">
                {({ isActive }) => (
                  <div
                    className={[
                      'relative flex min-w-0 flex-col items-center justify-center gap-1 rounded-2xl px-2 py-2 text-center transition-colors',
                      isActive
                        ? 'text-blue-600'
                        : 'text-slate-500 hover:bg-slate-100 hover:text-slate-950'
                    ].join(' ')}
                  >
                    <div className="relative flex h-8 w-12 items-center justify-center">
                      <Icon className="h-5 w-5" aria-hidden="true" />
                      {item.to === '/notifications' && unreadCount > 0 ? (
                        <span className="absolute right-1.5 top-0 inline-flex h-4 min-w-4 -translate-y-1/4 translate-x-1/4 items-center justify-center rounded-full bg-rose-600 px-1 text-[10px] font-bold leading-none text-white ring-2 ring-white">
                          {unreadCount}
                        </span>
                      ) : null}
                    </div>
                  </div>
                )}
              </NavLink>
            );
          })}
        </div>
      </nav>

      {canCreateBooking ? (
        <button
          type="button"
          onClick={() => setBookingModalOpen(true)}
          className="fixed bottom-24 right-6 z-50 flex h-14 w-14 items-center justify-center rounded-full bg-blue-600 text-white shadow-lg shadow-blue-600/40 transition-all hover:bg-blue-700 active:scale-95 lg:hidden"
          aria-label="Create Booking Request"
        >
          <Plus className="h-6 w-6" strokeWidth={3} />
        </button>
      ) : null}

      {canCreateBooking && (
        <BookingModal open={bookingModalOpen} onClose={() => setBookingModalOpen(false)} />
      )}

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
