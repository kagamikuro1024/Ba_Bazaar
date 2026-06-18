import { createPortal } from 'react-dom';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
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
  Sparkles,
  Users,
  Plus,
  X,
  Cpu,
  FileText,
  ShieldCheck
} from 'lucide-react';
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/auth/AuthProvider';
import { apiFetch, type NotificationItem, type User, type UserRole } from '@/lib/api';
import { Button } from './ui/button';
import { Card, CardContent } from './ui/card';
import { BookingModal } from './BookingModal';
import { CreateBAModal } from './CreateBAModal';
import { useGlobalFab } from '@/context/GlobalFabContext';
import { useInboxDirty } from '@/lib/unsaved-changes';
import { cn } from '@/lib/utils';
import {
  GlobalSearchModal,
  globalSearchStorage,
  type PageItem,
  type PaletteMode
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
  },
  '/admin/dashboard': {
    title: 'IT Admin Dashboard',
    body: 'Overview of users, system status, and system audit logs.'
  },
  '/admin/users': {
    title: 'User Management',
    body: 'Enable, disable, or change roles for system users.'
  },
  '/admin/audit-logs': {
    title: 'System Audit Logs',
    body: 'Review system mutations, background actions, and security logs.'
  },
  '/admin/ai/observability': {
    title: 'AI Observability',
    body: 'Monitor LLM session traces, tool calls, costs, and token usage.'
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
  { to: '/reports', label: 'Reports', icon: BarChart3, roles: ['BA_MANAGER', 'ADMIN'] },
  {
    to: '/admin/dashboard',
    label: 'Admin Dashboard',
    icon: ShieldCheck,
    roles: ['IT_ADMIN']
  },
  {
    to: '/admin/users',
    label: 'User Management',
    icon: Users,
    roles: ['IT_ADMIN']
  },
  {
    to: '/admin/audit-logs',
    label: 'System Audit Logs',
    icon: FileText,
    roles: ['IT_ADMIN']
  },
  {
    to: '/admin/ai/observability',
    label: 'AI Observability',
    icon: Cpu,
    roles: ['IT_ADMIN']
  }
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
        body: 'Manager action items, capacity and team metrics.'
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
  const { user, accessToken, logout } = useAuth();
  const role = user?.role;
  const { setVisible } = useGlobalFab();
  const [notificationOpen, setNotificationOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [bookingModalOpen, setBookingModalOpen] = useState(false);
  const [createBaModalOpen, setCreateBaModalOpen] = useState(false);
  const [pendingNavPath, setPendingNavPath] = useState('');
  const [navActionPending, setNavActionPending] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [paletteMode, setPaletteMode] = useState<PaletteMode>('search');
  const [recentSearches, setRecentSearches] = useState<string[]>(() =>
    globalSearchStorage.load()
  );
  const collapsedNotificationRef = useRef<HTMLDivElement | null>(null);
  const desktopNotificationRef = useRef<HTMLDivElement | null>(null);
  const notificationPanelRef = useRef<HTMLDivElement | null>(null);
  const [notificationPanelPos, setNotificationPanelPos] = useState<{ top?: number; bottom?: number; left: number } | null>(null);
  const mobileUserMenuRef = useRef<HTMLDivElement | null>(null);
  const collapsedUserMenuRef = useRef<HTMLDivElement | null>(null);
  const desktopUserMenuRef = useRef<HTMLDivElement | null>(null);
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
  const canCreateBa = role === 'BA_MANAGER';
  const actionCenterPendingCount = managerSummary.data?.actions?.pending_requests ?? 0;
  const displayRole = role?.replace('_', ' ') ?? '';
  const pageHeader = getPageHeader(introKey, role);
  const isBaDirectoryPage = location.pathname === '/crm/ba';
  const isMyRequestsPage = location.pathname === '/my-requests';
  const isTimelinePage = location.pathname === '/timeline';
  const showMobileCreateBookingFab =
    canCreateBooking && (isTimelinePage || isMyRequestsPage);
  const showMobileCreateBaFab = canCreateBa && isBaDirectoryPage;

  const mobileNavigation = useMemo(() => {
    const priority = [
      '/dashboard',
      '/admin/dashboard',
      '/admin/users',
      '/admin/audit-logs',
      '/admin/ai/observability',
      '/manager/action-center',
      '/timeline',
      '/crm/ba',
      '/my-schedule',
      '/my-requests',
      '/reports'
    ];
    return [...visibleNavigation]
      .sort((a, b) => priority.indexOf(a.to) - priority.indexOf(b.to))
      .slice(0, 4);
  }, [visibleNavigation]);

  const setCollapsedNotificationRootRef = useCallback((node: HTMLDivElement | null) => {
    collapsedNotificationRef.current = node;
  }, []);

  const setDesktopNotificationRootRef = useCallback((node: HTMLDivElement | null) => {
    desktopNotificationRef.current = node;
  }, []);

  const setMobileUserMenuRootRef = useCallback((node: HTMLDivElement | null) => {
    mobileUserMenuRef.current = node;
  }, []);

  const setCollapsedUserMenuRootRef = useCallback((node: HTMLDivElement | null) => {
    collapsedUserMenuRef.current = node;
  }, []);

  const setDesktopUserMenuRootRef = useCallback((node: HTMLDivElement | null) => {
    desktopUserMenuRef.current = node;
  }, []);

  const toggleNotificationPanel = useCallback(() => {
    setUserMenuOpen(false);
    setNotificationOpen((current) => {
      if (!current) {
        const root =
          desktopNotificationRef.current ?? collapsedNotificationRef.current;
        const rect = root?.getBoundingClientRect();
        if (rect) {
          setNotificationPanelPos(
            sidebarCollapsed
              ? { bottom: window.innerHeight - rect.bottom, left: rect.right + 12 }
              : { bottom: window.innerHeight - rect.top + 12, left: rect.left }
          );
        }
      } else {
        setNotificationPanelPos(null);
      }
      return !current;
    });
  }, [sidebarCollapsed]);

  useEffect(() => {
    setNotificationOpen(false);
    setUserMenuOpen(false);
  }, [location.pathname, role]);

  useEffect(() => {
    globalSearchStorage.save(recentSearches);
  }, [recentSearches]);

  useEffect(() => {
    const isAnyModalOpen = bookingModalOpen || createBaModalOpen || searchOpen || notificationOpen;
    setVisible(!isAnyModalOpen);
  }, [bookingModalOpen, createBaModalOpen, searchOpen, notificationOpen, setVisible]);

  useEffect(() => {
    function handleKeydown(event: KeyboardEvent) {
      const isMetaK = (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k';
      if (isMetaK) {
        event.preventDefault();
        setPaletteMode('search');
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
      const insideNotificationRoot = [
        collapsedNotificationRef.current,
        desktopNotificationRef.current
      ].some((node) => node?.contains(target));
      const insideUserMenuRoot = [
        mobileUserMenuRef.current,
        collapsedUserMenuRef.current,
        desktopUserMenuRef.current
      ].some((node) => node?.contains(target));

      if (
        insideNotificationRoot ||
        notificationPanelRef.current?.contains(target) ||
        insideUserMenuRoot
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

  const openPalette = useCallback((mode: PaletteMode = 'search') => {
    setPaletteMode(mode);
    setSearchOpen(true);
  }, []);

  return (
    <div className="isolate min-h-screen bg-slate-50 lg:flex lg:flex-row">
      <header className="sticky top-0 z-30 border-b border-slate-200/80 bg-white/95 backdrop-blur lg:hidden">
        <div className="flex items-center justify-between gap-2 px-3 py-2.5">
          <Link to="/dashboard" className="flex min-w-0 items-center justify-center">
            <img
              src="/logo-blue.png"
              alt="BA Bazaar"
              className="h-9 w-auto shrink-0 object-contain"
            />
          </Link>
          <div className="flex shrink-0 items-center gap-1.5">
            <button
              type="button"
              onClick={() => openPalette('ai')}
              className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-blue-200 bg-blue-50 text-blue-600 transition hover:border-blue-300 hover:bg-blue-100"
              aria-label="Ask AI"
            >
              <Sparkles className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => openPalette('search')}
              className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-slate-200 bg-slate-50 text-slate-600 transition hover:border-slate-300 hover:bg-white"
              aria-label="Open global search"
            >
              <Search className="h-4 w-4" />
            </button>
            <Link
              to="/notifications"
              className="relative inline-flex h-9 w-9 items-center justify-center rounded-full border border-slate-200 bg-slate-50 text-slate-600 transition hover:border-slate-300 hover:bg-white"
              aria-label="Notifications"
            >
              <Bell className="h-4 w-4" />
              {unreadCount > 0 ? (
                <span className="absolute -right-1 -top-1 rounded-full bg-rose-600 px-1.5 text-[10px] font-bold text-white">
                  {unreadCount}
                </span>
              ) : null}
            </Link>
            <span
              className="mx-0.5 h-5 w-px shrink-0 rounded-full bg-slate-200"
              aria-hidden="true"
            />
            <div ref={setMobileUserMenuRootRef} className="relative">
              <UserAvatarButton
                user={user}
                userMenuOpen={userMenuOpen}
                onClick={() => {
                  setNotificationOpen(false);
                  setUserMenuOpen((current) => !current);
                }}
              />
              {userMenuOpen ? (
                <Card className="absolute right-0 top-[3.25rem] z-[70] w-56 shadow-lg">
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

      <aside
        className="relative sticky top-0 z-40 hidden h-screen min-h-0 flex-col border-r border-slate-200 bg-white lg:flex lg:transition-all lg:duration-300 lg:ease-[cubic-bezier(0.22,1,0.36,1)]"
        style={{
          width: sidebarCollapsed ? '72px' : '288px',
          minWidth: sidebarCollapsed ? '72px' : '288px',
          maxWidth: sidebarCollapsed ? '72px' : '288px'
        }}
      >
        <div
          className={[
            'flex min-h-0 w-full min-w-0 max-w-full flex-1 flex-col gap-3 overflow-x-hidden py-4 transition-[padding,gap] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]',
            sidebarCollapsed ? 'px-2' : 'px-3'
          ].join(' ')}
        >
          <div className={cn("flex justify-center pb-3", sidebarCollapsed ? "mb-3 px-0" : "px-2")}>
            <Link
              to="/dashboard"
              className={cn(
                "flex min-w-0 items-center justify-center",
                sidebarCollapsed ? "overflow-hidden rounded-lg" : ""
              )}
              title="BA Bazaar"
              style={sidebarCollapsed ? { width: '40px', height: '40px' } : undefined}
            >
              <img
                src={sidebarCollapsed ? "/favicon.png" : "/logo-blue.png"}
                alt="BA Bazaar"
                className={cn(
                  "object-contain",
                  sidebarCollapsed ? "h-full w-full object-cover" : "h-16 w-auto"
                )}
              />
            </Link>
          </div>

          <div
            className={cn(
              "grid w-full min-w-0 max-w-full grid-cols-[minmax(0,1fr)] gap-2",
              sidebarCollapsed ? "justify-items-center" : ""
            )}
          >
            <button
              type="button"
              onClick={() => openPalette('search')}
              className={cn(
                "box-border flex min-w-0 max-w-full items-center border border-slate-200 bg-slate-50 text-slate-500 transition hover:border-slate-300 hover:bg-white",
                sidebarCollapsed
                  ? "h-10 w-10 justify-center rounded-2xl px-0 py-0"
                  : "w-full justify-self-stretch gap-3 rounded-lg px-3 py-2 text-left text-sm"
              )}
              aria-label="Open global search"
              title={sidebarCollapsed ? "Search" : undefined}
            >
              <Search className="h-4 w-4 shrink-0 text-slate-400" />
              {sidebarCollapsed ? null : (
                <>
                  <span className="min-w-0 flex-1 truncate text-left">
                    Search requests, BAs, pages...
                  </span>
                  <span className="rounded-lg border border-slate-200 bg-white px-2 py-0.5 text-[11px] font-semibold text-slate-400 shrink-0">
                    Ctrl K
                  </span>
                </>
              )}
            </button>

            <button
              type="button"
              onClick={() => openPalette('ai')}
              className={cn(
                "box-border flex min-w-0 max-w-full items-center border border-blue-200 text-blue-700 transition",
                sidebarCollapsed
                  ? "h-10 w-10 justify-center rounded-2xl bg-blue-50 px-0 py-0 hover:border-blue-300 hover:bg-blue-100"
                  : "w-full justify-self-stretch gap-3 rounded-lg bg-gradient-to-r from-blue-50 to-white px-3 py-2 text-left text-sm font-semibold hover:border-blue-300 hover:from-blue-100"
              )}
              aria-label="Ask AI assistant"
              title={sidebarCollapsed ? "Ask AI" : undefined}
            >
              <Sparkles className="h-4 w-4 shrink-0 text-blue-600" />
              {sidebarCollapsed ? null : (
                <span className="min-w-0 flex-1 truncate text-left">Ask AI</span>
              )}
            </button>
          </div>

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
                          ? 'h-10 w-10 justify-center rounded-lg px-0 py-0'
                          : 'gap-3 rounded-lg px-3 py-2',
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
                      ? 'mx-auto h-10 w-10 justify-center rounded-lg px-0 py-0'
                      : 'w-full gap-3 rounded-lg px-3 py-2'
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
                <div ref={setCollapsedNotificationRootRef} className="relative">
                  <Button
                    variant="secondary"
                    size="icon"
                    aria-label="Notifications"
                    aria-expanded={notificationOpen}
                    onClick={toggleNotificationPanel}
                  >
                    <Bell className="h-4 w-4" />
                  </Button>
                  {unreadCount > 0 ? (
                    <span className="absolute -right-1 -top-1 rounded-full bg-rose-600 px-1.5 text-[10px] font-bold text-white">
                      {unreadCount}
                    </span>
                  ) : null}
                </div>
                <div ref={setCollapsedUserMenuRootRef} className="relative">
                  <UserAvatarButton
                    user={user}
                    userMenuOpen={userMenuOpen}
                    onClick={() => {
                      setNotificationOpen(false);
                      setUserMenuOpen((current) => !current);
                    }}
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
                <div ref={setDesktopUserMenuRootRef} className="relative min-w-0 flex-1">
                  <div
                    className={cn(
                      'flex w-full items-center gap-2 rounded-lg border px-2.5 py-2 transition',
                      userMenuOpen
                        ? 'border-slate-300 bg-slate-100 text-slate-950'
                        : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50'
                    )}
                  >
                    <button
                      type="button"
                      aria-label="User menu"
                      aria-expanded={userMenuOpen}
                      onClick={() => {
                        setNotificationOpen(false);
                        setUserMenuOpen((current) => !current);
                      }}
                      className="flex min-w-0 flex-1 items-center gap-2 text-left"
                    >
                      <span className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-full border border-slate-200 bg-slate-100">
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
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold text-slate-700">
                          {me.data?.user.full_name ?? user?.full_name ?? 'Authenticated user'}
                        </p>
                        <p className="truncate text-xs text-slate-500">{displayRole}</p>
                      </div>
                    </button>
                    <span className="h-5 w-px shrink-0 rounded-full bg-slate-200" aria-hidden="true" />
                    <div ref={setDesktopNotificationRootRef} className="relative shrink-0">
                      <button
                        type="button"
                        aria-label="Notifications"
                        aria-expanded={notificationOpen}
                        onClick={(event) => {
                          event.stopPropagation();
                          toggleNotificationPanel();
                        }}
                        className="relative inline-flex h-8 w-8 items-center justify-center rounded-full text-slate-500 transition hover:bg-white hover:text-slate-700"
                      >
                        <Bell className="h-4 w-4" />
                        {unreadCount > 0 ? (
                          <span className="absolute -right-1 -top-1 rounded-full bg-rose-600 px-1.5 text-[10px] font-bold text-white">
                            {unreadCount}
                          </span>
                        ) : null}
                      </button>
                    </div>
                  </div>
                  {userMenuOpen ? (
                    <Card className="absolute bottom-[3.25rem] left-0 z-[70] w-56 shadow-lg">
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
        <button
          type="button"
          onClick={() => setSidebarCollapsed((current) => !current)}
          className="absolute -right-[18px] top-1/2 z-10 inline-flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500 shadow-sm transition-all duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] hover:bg-slate-100 hover:text-slate-950"
          title={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          aria-label={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {sidebarCollapsed ? (
            <ChevronsRight className="h-4 w-4" aria-hidden="true" />
          ) : (
            <ChevronsLeft className="h-4 w-4" aria-hidden="true" />
          )}
        </button>
      </aside>

      <div className="min-w-0 flex-1 px-3 pb-36 pt-4 sm:px-6 lg:pb-5 lg:pt-5 xl:px-6 2xl:px-8">
        <main className="mx-auto grid min-w-0 w-full max-w-[1560px] gap-4 sm:gap-5">
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
        className={[
          'fixed bottom-4 left-4 right-4 z-40 border border-slate-200/90 bg-white/95 p-1 shadow-2xl shadow-slate-900/15 backdrop-blur lg:hidden',
          'rounded-full'
        ].join(' ')}
        aria-label="Mobile navigation"
      >
        <div className="grid grid-cols-4 gap-1.5">
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
                      'relative flex min-w-0 flex-col items-center justify-center gap-0.5 rounded-full px-2 py-2 text-center transition-colors',
                      isActive
                        ? 'bg-blue-50 text-blue-700'
                        : 'text-slate-500 hover:bg-slate-100 hover:text-slate-950'
                    ].join(' ')}
                  >
                    <div className="relative flex h-6 w-10 items-center justify-center">
                      <Icon className="h-5 w-5" aria-hidden="true" />
                      {item.to === '/notifications' && unreadCount > 0 ? (
                        <span className="absolute right-1.5 top-0 inline-flex h-4 min-w-4 -translate-y-1/4 translate-x-1/4 items-center justify-center rounded-full bg-rose-600 px-1 text-[10px] font-bold leading-none text-white ring-2 ring-white">
                          {unreadCount}
                        </span>
                      ) : null}
                    </div>
                    <span className="max-w-full truncate text-[10px] font-semibold leading-tight">
                      {item.to === '/dashboard' ? (
                        <>
                          <span className="sm:hidden">Dash</span>
                          <span className="hidden sm:inline">Dashboard</span>
                        </>
                      ) : (
                        item.label.replace('Action Center', 'Actions').replace('BA Directory', 'BAs')
                      )}
                    </span>
                  </div>
                )}
              </NavLink>
            );
          })}
        </div>
      </nav>

      {showMobileCreateBookingFab && !showMobileCreateBaFab ? (
        <button
          type="button"
          onClick={() => setBookingModalOpen(true)}
          className="fixed bottom-24 right-4 z-40 flex h-12 items-center justify-center gap-2 rounded-full bg-blue-600 px-4 text-white shadow-lg shadow-blue-600/40 transition-all hover:bg-blue-700 active:scale-95 lg:hidden"
          aria-label="Create Booking Request"
        >
          <Plus className="h-6 w-6" strokeWidth={3} />
          <span className="text-sm font-semibold">
            {location.pathname === '/timeline'
              ? 'New booking'
              : isMyRequestsPage
                ? 'New booking'
                : 'Create'}
          </span>
        </button>
      ) : null}

      {showMobileCreateBaFab ? (
        <button
          type="button"
          onClick={() => setCreateBaModalOpen(true)}
          className="fixed bottom-24 right-4 z-40 flex h-12 items-center justify-center gap-2 rounded-full bg-blue-600 px-4 text-white shadow-lg shadow-blue-600/40 transition-all hover:bg-blue-700 active:scale-95 lg:hidden"
          aria-label="Create BA"
        >
          <Plus className="h-6 w-6" strokeWidth={3} />
          <span className="text-sm font-semibold">Create BA</span>
        </button>
      ) : null}


      {canCreateBooking && (
        <BookingModal
          open={bookingModalOpen}
          onClose={() => setBookingModalOpen(false)}
        />
      )}

      {canCreateBa && (
        <CreateBAModal
          open={createBaModalOpen}
          onClose={() => setCreateBaModalOpen(false)}
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
        accessToken={accessToken}
        userId={user?.id}
        initialMode={paletteMode}
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
            <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Changes summary
              </p>
              {inboxDirty.summary.length > 0 ? (
                <ul className="mt-2 grid gap-1 text-sm text-slate-700">
                  {inboxDirty.summary.map((item) => (
                    <li
                      key={item.id}
                      className="flex items-center gap-2 rounded-lg bg-white px-2 py-1"
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

      {introOpen && intro && !suppressPageHeader ? (
        <div className="rounded-2xl border border-blue-100 bg-blue-50/80 p-3 sm:p-4 shadow-sm">
          <div className="flex items-start gap-3">
            <div className="min-w-0 flex-1">
              <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-blue-700">
                First visit
              </p>
              <h2 className="mt-0.5 text-base font-semibold text-slate-950 sm:text-lg">
                {intro.title}
              </h2>
              <p className="mt-1 text-sm leading-5 text-slate-600">{intro.body}</p>
            </div>
            <button
              type="button"
              onClick={dismissIntro}
              className="-m-1 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-slate-400 hover:bg-white hover:text-slate-700"
              aria-label="Dismiss intro"
            >
              ×
            </button>
          </div>
        </div>
      ) : null}
      {notificationOpen && notificationPanelPos
        ? createPortal(
          <Card
            ref={notificationPanelRef}
            className="fixed z-[100] w-96 shadow-lg"
            style={notificationPanelPos}
          >
            <CardContent className="p-0">
              <NotificationPanel
                unreadCount={unreadCount}
                recentNotifications={recentNotifications}
                resolveNotificationPath={resolveNotificationPath}
                markRead={(id) => markRead.mutate(id)}
                onViewAll={() => setNotificationOpen(false)}
              />
            </CardContent>
          </Card>,
          document.body
        )
        : null}
    </div>
  );
}

function NotificationPanel({
  unreadCount,
  recentNotifications,
  resolveNotificationPath,
  markRead,
  onViewAll
}: {
  unreadCount: number;
  recentNotifications: NotificationItem[];
  resolveNotificationPath: (item: NotificationItem) => string;
  markRead: (id: string) => void;
  onViewAll: () => void;
}) {
  return (
    <>
      <div className="flex items-center justify-between border-b px-4 py-3">
        <div>
          <p className="text-sm font-semibold text-slate-950">Notifications</p>
          <p className="text-xs text-slate-500">{unreadCount} unread</p>
        </div>
        <Button variant="ghost" size="sm" asChild>
          <Link to="/notifications" onClick={onViewAll}>
            View all
          </Link>
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
                onViewAll();
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
