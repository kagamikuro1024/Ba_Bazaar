import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode
} from 'react';
import {
  BarChart3,
  CalendarDays,
  ClipboardList,
  FolderKanban,
  Home,
  Bell,
  Check,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Inbox,
  Search,
  Users,
  Plus,
  X
} from 'lucide-react';
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/auth/AuthProvider';
import { apiFetch, type NotificationItem, type User, type UserRole } from '@/lib/api';
import { Button } from './ui/button';
import { Card, CardContent } from './ui/card';
import { BookingModal } from './BookingModal';
import { useInboxDirty } from '@/lib/unsaved-changes';
import {
  GlobalSearchModal,
  globalSearchStorage,
  type PageItem
} from './GlobalSearchModal';

type LayoutShellProps = {
  children: ReactNode;
  /**
   * If true, suppress the LayoutShell's auto-injected page title/intro.
   * Set this on pages that render their own <PageHeader /> from
   * @/components to avoid duplicate titles.
   */
  suppressPageHeader?: boolean;
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
  '/manager/action-center': {
    title: 'Action Center',
    body: 'Review, assign and resolve BA booking requests.'
  },
  '/crm/ba': {
    title: 'BA Directory',
    body: 'Browse BA profiles, skills, levels, and availability. Use the directory to understand who can be booked.'
  },
  '/crm/ba/profile': {
    title: 'BA Profile',
    body: 'Review BA details, booking history, utilization, skills, notes, and profile status.'
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
  {
    to: '/dashboard',
    label: 'Dashboard',
    icon: Home,
    roles: ['BA_MANAGER', 'PM_PO', 'BA', 'ADMIN']
  },
  {
    to: '/manager/action-center',
    label: 'Action Center',
    icon: Inbox,
    roles: ['BA_MANAGER', 'ADMIN']
  },
  {
    to: '/timeline',
    label: 'Timeline',
    icon: CalendarDays,
    roles: ['BA_MANAGER', 'PM_PO', 'BA', 'ADMIN']
  },
  { to: '/my-schedule', label: 'My Schedule', icon: ClipboardList, roles: ['BA'] },
  { to: '/my-requests', label: 'My Requests', icon: FolderKanban, roles: ['PM_PO'] },
  {
    to: '/crm/ba',
    label: 'BA Directory',
    icon: Users,
    roles: ['BA_MANAGER', 'PM_PO', 'BA', 'ADMIN']
  },
  { to: '/reports', label: 'Reports', icon: BarChart3, roles: ['BA_MANAGER', 'ADMIN'] }
];

function getIntroKey(pathname: string) {
  if (pathname === '/manager/inbox' || pathname === '/action-center')
    return '/manager/action-center';
  if (pathname.startsWith('/crm/ba/')) return '/crm/ba/profile';
  return pageIntros[pathname] ? pathname : '';
}

function getPageHeader(introKey: string, role?: UserRole): PageIntro | undefined {
  if (!introKey) return undefined;

  if (introKey === '/dashboard') {
    if (role === 'BA_MANAGER' || role === 'ADMIN') {
      return {
        title: 'Manager Dashboard',
        body: 'Requests waiting for action'
      };
    }

    if (role === 'BA') {
      return {
        title: 'BA Dashboard',
        body: 'Your assigned work and schedule status'
      };
    }

    return {
      title: 'PM/PO Dashboard',
      body: 'Your booking requests and decisions'
    };
  }

  return pageIntros[introKey];
}

function monthRangeForSummary() {
  const now = new Date();
  const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const to = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0));
  return {
    from: from.toISOString().slice(0, 10),
    to: to.toISOString().slice(0, 10)
  };
}

export function LayoutShell({ children, suppressPageHeader = false }: LayoutShellProps) {
  const queryClient = useQueryClient();
  const { user, logout } = useAuth();
  const role = user?.role;
  const [notificationOpen, setNotificationOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [bookingModalOpen, setBookingModalOpen] = useState(false);
  const [pendingNavPath, setPendingNavPath] = useState('');
  const [navActionPending, setNavActionPending] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [recentSearches, setRecentSearches] = useState<string[]>(() =>
    globalSearchStorage.load()
  );
  const notificationRef = useRef<HTMLDivElement>(null);
  const userMenuRef = useRef<HTMLDivElement>(null);
  const location = useLocation();
  const navigate = useNavigate();
  const inboxDirty = useInboxDirty();
  const introKey = getIntroKey(location.pathname);
  const intro = introKey ? pageIntros[introKey] : undefined;
  const storageKey = introKey ? `ba-bazaar:intro:${introKey}` : '';
  const [introOpen, setIntroOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    if (typeof window === 'undefined') {
      return false;
    }

    return window.localStorage.getItem('ba-bazaar:sidebar-collapsed') === 'true';
  });
  const notifications = useQuery({
    queryKey: ['notifications', user?.id],
    queryFn: () => apiFetch<NotificationItem[]>('/api/notifications'),
    enabled: Boolean(user)
  });
  const managerSummaryRange = useMemo(() => monthRangeForSummary(), []);
  const managerSummary = useQuery({
    queryKey: ['layout-manager-summary', managerSummaryRange.from, managerSummaryRange.to],
    queryFn: () =>
      apiFetch<{
        actions?: {
          pending_requests?: number;
        };
      }>(
        `/api/dashboard/manager-summary?from=${managerSummaryRange.from}&to=${managerSummaryRange.to}`
      ),
    enabled: role === 'BA_MANAGER' || role === 'ADMIN'
  });
  const markRead = useMutation({
    mutationFn: (id: string) =>
      apiFetch(`/api/notifications/${id}/read`, { method: 'POST' }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['notifications'] })
  });
  const me = useQuery({
    queryKey: ['me', user?.id],
    queryFn: () => apiFetch<{ user: { full_name: string; role: UserRole } }>('/api/me'),
    enabled: Boolean(user)
  });
  const unreadCount = notifications.data?.filter((item) => !item.read_at).length ?? 0;
  const recentNotifications = (notifications.data ?? []).slice(0, 5);
  const visibleNavigation = useMemo(
    () => (role ? navigation.filter((item) => item.roles.includes(role)) : []),
    [role]
  );
  const canCreateBooking = role === 'BA_MANAGER' || role === 'PM_PO';
  const actionCenterPendingCount = managerSummary.data?.actions?.pending_requests ?? 0;
  const displayRole = role?.replace('_', ' ') ?? '';
  const pageHeader = getPageHeader(introKey, role);
  const mobileNavigation = useMemo(() => visibleNavigation, [visibleNavigation]);

  useEffect(() => {
    setNotificationOpen(false);
    setUserMenuOpen(false);
  }, [location.pathname, role]);

  useEffect(() => {
    globalSearchStorage.save(recentSearches);
  }, [recentSearches]);

  useEffect(() => {
    function handleKeydown(event: KeyboardEvent) {
      const isMetaK = (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k';
      if (isMetaK) {
        event.preventDefault();
        setSearchOpen(true);
        return;
      }

      if (!searchOpen) {
        return;
      }

      if (event.key === 'Escape') {
        event.preventDefault();
        setSearchOpen(false);
        return;
      }
    }

    window.addEventListener('keydown', handleKeydown);
    return () => window.removeEventListener('keydown', handleKeydown);
  }, [searchOpen]);

  useEffect(() => {
    window.localStorage.setItem(
      'ba-bazaar:sidebar-collapsed',
      sidebarCollapsed ? 'true' : 'false'
    );
  }, [sidebarCollapsed]);

  useEffect(() => {
    if (!notificationOpen && !userMenuOpen) {
      return;
    }

    function handlePointerDown(event: PointerEvent) {
      const target = event.target as Node;

      if (
        notificationRef.current?.contains(target) ||
        userMenuRef.current?.contains(target)
      ) {
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
    const id = item.related_entity_id;
    if (item.related_entity_type === 'Booking' && id) {
      if (role === 'BA_MANAGER' || role === 'ADMIN') {
        return `/notifications?bookingId=${id}`;
      }
      if (role === 'PM_PO') {
        return `/my-requests?bookingId=${id}`;
      }
      if (role === 'BA') {
        return `/my-schedule?bookingId=${id}`;
      }
    }

    if (item.type === 'BOOKING_REJECTED' || item.type === 'BOOKING_CANCELLED') {
      return id ? `/my-requests?bookingId=${id}` : '/my-requests';
    }

    return '/notifications';
  }

  const pageSearchItems = useMemo<PageItem[]>(
    () =>
      visibleNavigation.map((item) => ({
        to: item.to,
        label: item.label,
        meta: pageIntros[item.to]?.body
      })),
    [visibleNavigation]
  );

  const commitRecentSearch = useCallback((term: string) => {
    const cleaned = term.trim();
    if (!cleaned) return;
    setRecentSearches((current) =>
      [cleaned, ...current.filter((value) => value !== cleaned)].slice(
        0,
        globalSearchStorage.limit
      )
    );
  }, []);

  return (
    <div
      className="isolate min-h-screen bg-slate-50 lg:grid lg:grid-cols-[var(--sidebar-width)_minmax(0,1fr)]"
      style={
        { '--sidebar-width': sidebarCollapsed ? '72px' : '288px' } as CSSProperties
      }
    >
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white lg:hidden">
        <div className="flex items-center justify-between gap-3 px-4 py-3">
          <Link to="/dashboard" className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-wide text-blue-700">
              BA Bazaar
            </p>
            <p className="truncate text-lg font-bold text-slate-950">Booking + CRM</p>
          </Link>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setSearchOpen(true)}
              className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-slate-200 bg-slate-50 text-slate-600 transition hover:border-slate-300 hover:bg-white"
              aria-label="Open global search"
            >
              <Search className="h-4 w-4" />
            </button>
            <Link
              to="/notifications"
              className="relative inline-flex h-10 w-10 items-center justify-center rounded-full border border-slate-200 bg-slate-50 text-slate-600 transition hover:border-slate-300 hover:bg-white"
              aria-label="Notifications"
            >
              <Bell className="h-4 w-4" />
              {unreadCount > 0 ? (
                <span className="absolute -right-1 -top-1 rounded-full bg-rose-600 px-1.5 text-[10px] font-bold text-white">
                  {unreadCount}
                </span>
              ) : null}
            </Link>
            <div ref={userMenuRef} className="relative">
              <UserAvatarButton
                user={user}
                userMenuOpen={userMenuOpen}
                onClick={() => setUserMenuOpen((current) => !current)}
              />
              {userMenuOpen ? (
                <Card className="absolute right-0 top-12 z-[70] w-56 shadow-lg">
                  <CardContent className="p-2">
                    <UserMenuContent
                      fullName={me.data?.user.full_name ?? user?.full_name}
                      displayRole={displayRole}
                      onLogout={async () => {
                        setUserMenuOpen(false);
                        await logout();
                        await queryClient.invalidateQueries();
                      }}
                    />
                  </CardContent>
                </Card>
              ) : null}
            </div>
          </div>
        </div>
      </header>

      <aside className="sticky top-0 z-40 hidden h-screen min-h-0 flex-col border-r border-slate-200 bg-white lg:flex">
        <div
          className={[
            'flex min-h-0 flex-1 flex-col gap-3 py-4',
            sidebarCollapsed ? 'px-2' : 'px-3'
          ].join(' ')}
        >
          <div
            className={[
              'flex',
              sidebarCollapsed
                ? 'flex-col items-center gap-2 px-0'
                : 'items-start justify-between gap-2 px-2'
            ].join(' ')}
          >
            {sidebarCollapsed ? (
              <Link
                to="/dashboard"
                className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-50 text-sm font-bold text-blue-700"
                title="BA Bazaar"
              >
                BA
              </Link>
            ) : (
              <Link to="/dashboard" className="min-w-0">
                <p className="text-xs font-semibold uppercase tracking-wide text-blue-700">
                  BA Bazaar
                </p>
                <p className="truncate text-xl font-bold text-slate-950">
                  Booking + CRM
                </p>
              </Link>
            )}
            <button
              type="button"
              onClick={() => setSidebarCollapsed((current) => !current)}
              className={[
                'inline-flex items-center justify-center text-slate-500 transition hover:bg-slate-100 hover:text-slate-950',
                sidebarCollapsed ? 'h-8 w-8 rounded-full' : 'h-9 w-9 rounded-md'
              ].join(' ')}
              title={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
              aria-label={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            >
              {sidebarCollapsed ? (
                <ChevronsRight className="h-4 w-4" aria-hidden="true" />
              ) : (
                <ChevronsLeft className="h-4 w-4" aria-hidden="true" />
              )}
            </button>
          </div>

            <button
              type="button"
              onClick={() => setSearchOpen(true)}
              className={[
                'flex items-center rounded-xl border border-slate-200 bg-slate-50 text-left text-sm text-slate-500 transition hover:border-slate-300 hover:bg-white',
                sidebarCollapsed
                  ? 'h-10 w-10 self-center justify-center rounded-2xl px-0 py-0'
                  : 'gap-3 px-3 py-2'
              ].join(' ')}
              aria-label="Open global search"
              title={sidebarCollapsed ? 'Search' : undefined}
            >
            <Search className="h-4 w-4 shrink-0 text-slate-400" />
            {sidebarCollapsed ? null : (
              <>
                <span className="min-w-0 flex-1 truncate">
                  Search requests, BAs, pages...
                </span>
                <span className="rounded-md border border-slate-200 bg-white px-2 py-0.5 text-[11px] font-semibold text-slate-400">
                  Ctrl K
                </span>
              </>
            )}
          </button>

          <div className="min-h-0 flex-1 overflow-y-auto">
            {sidebarCollapsed ? null : (
              <p className="px-3 pb-2 pt-1 text-[10px] font-bold uppercase tracking-wider text-slate-400">
                Menu
              </p>
            )}
            <nav
              className={['grid gap-1', sidebarCollapsed ? 'justify-items-center' : ''].join(' ')}
              aria-label="Main navigation"
            >
              {visibleNavigation.map((item) => {
                const Icon = item.icon;

                return (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    end
                    title={sidebarCollapsed ? item.label : undefined}
                    onClick={(event) => {
                      if (inboxDirty.dirty && item.to !== location.pathname) {
                        event.preventDefault();
                        setPendingNavPath(item.to);
                      }
                    }}
                    className={({ isActive }) =>
                      [
                        'flex items-center text-sm font-medium transition-colors',
                        sidebarCollapsed
                          ? 'h-10 w-10 justify-center rounded-xl px-0 py-0'
                          : 'gap-3 rounded-md px-3 py-2',
                        isActive
                          ? 'bg-blue-50 text-blue-700'
                          : 'text-slate-600 hover:bg-slate-100 hover:text-slate-950'
                      ].join(' ')
                    }
                  >
                    <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                    {sidebarCollapsed ? null : (
                      <span className="min-w-0 flex-1 truncate">{item.label}</span>
                    )}
                    {!sidebarCollapsed &&
                    item.to === '/manager/action-center' &&
                    actionCenterPendingCount > 0 ? (
                      <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-blue-600 px-1.5 text-[10px] font-bold leading-none text-white">
                        {actionCenterPendingCount > 99 ? '99+' : actionCenterPendingCount}
                      </span>
                    ) : null}
                  </NavLink>
                );
              })}
            </nav>
            {canCreateBooking ? (
              <div className="mt-3 border-t border-slate-200 pt-3">
                <button
                  type="button"
                  onClick={() => setBookingModalOpen(true)}
                  className={[
                    'flex items-center text-sm font-semibold text-blue-600 transition-colors hover:bg-blue-50',
                    sidebarCollapsed
                      ? 'mx-auto h-10 w-10 justify-center rounded-xl px-0 py-0'
                      : 'w-full gap-3 rounded-md px-3 py-2'
                  ].join(' ')}
                  title={sidebarCollapsed ? 'Create Booking' : undefined}
                >
                  <Plus className="h-4 w-4 shrink-0" aria-hidden="true" />
                  {sidebarCollapsed ? null : <span>Create Booking</span>}
                </button>
              </div>
            ) : null}
          </div>

          <div className="relative border-t border-slate-200 pt-3">
            {sidebarCollapsed ? (
              <div className="grid justify-items-center gap-2">
                <div ref={notificationRef} className="relative">
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
                    <Card className="absolute bottom-0 left-full z-[70] ml-3 w-96 shadow-lg">
                      <CardContent className="p-0">
                        <NotificationPanel
                          unreadCount={unreadCount}
                          recentNotifications={recentNotifications}
                          resolveNotificationPath={resolveNotificationPath}
                          markRead={(id) => markRead.mutate(id)}
                        />
                      </CardContent>
                    </Card>
                  ) : null}
                </div>
                <div ref={userMenuRef} className="relative">
                  <UserAvatarButton
                    user={user}
                    userMenuOpen={userMenuOpen}
                    onClick={() => setUserMenuOpen((current) => !current)}
                  />
                  {userMenuOpen ? (
                    <Card className="absolute bottom-0 left-full z-[70] ml-3 w-56 shadow-lg">
                      <CardContent className="p-2">
                        <UserMenuContent
                          fullName={me.data?.user.full_name ?? user?.full_name}
                          displayRole={displayRole}
                          onLogout={async () => {
                            setUserMenuOpen(false);
                            await logout();
                            await queryClient.invalidateQueries();
                          }}
                        />
                      </CardContent>
                    </Card>
                  ) : null}
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <UserAvatarButton
                  user={user}
                  userMenuOpen={userMenuOpen}
                  onClick={() => setUserMenuOpen((current) => !current)}
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-slate-700">
                    {me.data?.user.full_name ?? user?.full_name ?? 'Authenticated user'}
                  </p>
                  <p className="truncate text-xs text-slate-500">{displayRole}</p>
                </div>
                <div ref={notificationRef} className="relative">
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
                    <Card className="absolute bottom-12 left-0 z-[70] w-96 shadow-lg">
                      <CardContent className="p-0">
                        <NotificationPanel
                          unreadCount={unreadCount}
                          recentNotifications={recentNotifications}
                          resolveNotificationPath={resolveNotificationPath}
                          markRead={(id) => markRead.mutate(id)}
                        />
                      </CardContent>
                    </Card>
                  ) : null}
                </div>
                <div ref={userMenuRef} className="relative">
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="User menu"
                    aria-expanded={userMenuOpen}
                    onClick={() => setUserMenuOpen((current) => !current)}
                  >
                    <ChevronRight className="h-4 w-4 rotate-90" />
                  </Button>
                  {userMenuOpen ? (
                    <Card className="absolute bottom-12 right-0 z-[70] w-56 shadow-lg">
                      <CardContent className="p-2">
                        <UserMenuContent
                          fullName={me.data?.user.full_name ?? user?.full_name}
                          displayRole={displayRole}
                          onLogout={async () => {
                            setUserMenuOpen(false);
                            await logout();
                            await queryClient.invalidateQueries();
                          }}
                        />
                      </CardContent>
                    </Card>
                  ) : null}
                </div>
              </div>
            )}
          </div>
        </div>
      </aside>

      <div className="min-w-0 px-4 pb-28 pt-5 sm:px-6 lg:pb-5 xl:px-6 2xl:px-8">
        <main className="grid min-w-0 w-full gap-5">
          {/*
            Page-level header is owned by each page via <PageHeader />
            from @/components. LayoutShell still injects a fallback
            title/intro for pages that haven't migrated yet — pages can
            opt out with `suppressPageHeader` to avoid duplicates.
          */}
          {!suppressPageHeader && pageHeader ? (
            <div>
              <h1 className="text-2xl font-bold text-slate-950">{pageHeader.title}</h1>
              <p className="mt-1 text-sm text-slate-500">{pageHeader.body}</p>
            </div>
          ) : null}
          {children}
        </main>
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
                end
                className="min-w-0 flex-1"
                onClick={(event) => {
                  if (inboxDirty.dirty && item.to !== location.pathname) {
                    event.preventDefault();
                    setPendingNavPath(item.to);
                  }
                }}
              >
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
        <BookingModal
          open={bookingModalOpen}
          onClose={() => setBookingModalOpen(false)}
        />
      )}

      <GlobalSearchModal
        open={searchOpen}
        onClose={() => setSearchOpen(false)}
        role={role}
        pageItems={pageSearchItems}
        recentSearches={recentSearches}
        onCommitRecent={commitRecentSearch}
        onClearRecent={() => setRecentSearches([])}
        onTriggerCreateBooking={() => setBookingModalOpen(true)}
      />

      {pendingNavPath ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/30 p-4">
          <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold text-slate-950">
                  Unsaved changes
                </h2>
                <p className="mt-1 text-sm text-slate-600">
                  Review these edits before leaving Action Center.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setPendingNavPath('')}
                className="rounded-full p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                aria-label="Close unsaved changes dialog"
              >
                ×
              </button>
            </div>
            <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Changes summary
              </p>
              {inboxDirty.summary.length > 0 ? (
                <ul className="mt-2 grid gap-1 text-sm text-slate-700">
                  {inboxDirty.summary.map((item) => (
                    <li
                      key={item.id}
                      className="flex items-center gap-2 rounded-md bg-white px-2 py-1"
                    >
                      <span className="min-w-0 flex-1">{item.label}</span>
                      <button
                        type="button"
                        disabled={navActionPending || !item.approve}
                        onClick={async () => {
                          setNavActionPending(true);
                          try {
                            await item.approve?.();
                            await queryClient.invalidateQueries();
                          } finally {
                            setNavActionPending(false);
                          }
                        }}
                        className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-emerald-600 hover:bg-emerald-50 disabled:opacity-40"
                        aria-label={`Approve ${item.label}`}
                      >
                        <Check className="h-4 w-4" aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        disabled={navActionPending || !item.reject}
                        onClick={async () => {
                          setNavActionPending(true);
                          try {
                            await item.reject?.();
                            await queryClient.invalidateQueries();
                          } finally {
                            setNavActionPending(false);
                          }
                        }}
                        className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-rose-600 hover:bg-rose-50 disabled:opacity-40"
                        aria-label={`Reject ${item.label}`}
                      >
                        <X className="h-4 w-4" aria-hidden="true" />
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-2 text-sm text-slate-600">
                  There are unsaved edits in this review.
                </p>
              )}
            </div>
            <div className="mt-5 grid gap-2 sm:grid-cols-2">
              <Button
                type="button"
                disabled={navActionPending || !inboxDirty.approveAndLeave}
                onClick={async () => {
                  const nextPath = pendingNavPath;
                  setNavActionPending(true);
                  try {
                    await inboxDirty.approveAndLeave?.();
                    setPendingNavPath('');
                    navigate(nextPath);
                  } finally {
                    setNavActionPending(false);
                  }
                }}
              >
                {navActionPending ? 'Working...' : 'Approve and leave'}
              </Button>
              <Button
                type="button"
                variant="secondary"
                className="border-rose-200 text-rose-700 hover:bg-rose-50 hover:text-rose-800"
                disabled={navActionPending || !inboxDirty.rejectAndLeave}
                onClick={async () => {
                  const nextPath = pendingNavPath;
                  setNavActionPending(true);
                  try {
                    await inboxDirty.rejectAndLeave?.();
                    setPendingNavPath('');
                    navigate(nextPath);
                  } finally {
                    setNavActionPending(false);
                  }
                }}
              >
                {navActionPending ? 'Working...' : 'Reject and leave'}
              </Button>
              <Button
                type="button"
                variant="secondary"
                onClick={() => setPendingNavPath('')}
                disabled={navActionPending}
              >
                Stay here
              </Button>
              <Button
                type="button"
                variant="secondary"
                className="border-slate-300 text-slate-600 hover:bg-slate-50 hover:text-slate-900"
                disabled={navActionPending}
                onClick={() => {
                  const nextPath = pendingNavPath;
                  setPendingNavPath('');
                  navigate(nextPath);
                }}
              >
                Leave anyway
              </Button>
            </div>
          </div>
        </div>
      ) : null}

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

function NotificationPanel({
  unreadCount,
  recentNotifications,
  resolveNotificationPath,
  markRead
}: {
  unreadCount: number;
  recentNotifications: NotificationItem[];
  resolveNotificationPath: (item: NotificationItem) => string;
  markRead: (id: string) => void;
}) {
  return (
    <>
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
                  markRead(item.id);
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
    </>
  );
}

function UserAvatarButton({
  user,
  userMenuOpen,
  onClick
}: {
  user?: User | null;
  userMenuOpen: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label="User menu"
      aria-expanded={userMenuOpen}
      className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-full border border-slate-200 bg-slate-100 transition hover:border-slate-300"
      onClick={onClick}
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
  );
}

function UserMenuContent({
  fullName,
  displayRole,
  onLogout
}: {
  fullName?: string;
  displayRole: string;
  onLogout: () => void | Promise<void>;
}) {
  return (
    <>
      <div className="border-b border-slate-100 px-2 py-2">
        <p className="truncate text-sm font-semibold text-slate-950">
          {fullName ?? 'Authenticated user'}
        </p>
        <p className="text-xs text-slate-500">{displayRole}</p>
      </div>
      <Button variant="ghost" className="mt-1 w-full justify-start" onClick={onLogout}>
        Logout
      </Button>
    </>
  );
}
