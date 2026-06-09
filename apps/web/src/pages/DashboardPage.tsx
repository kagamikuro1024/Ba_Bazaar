import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  AlertCircle,
  ArrowRight,
  BarChart3,
  CalendarRange,
  ClipboardList,
  Gauge,
  Plus,
  Sparkles,
  UserRound,
  UsersRound
} from 'lucide-react';
import {
  endOfMonth,
  endOfQuarter,
  endOfWeek,
  format,
  parseISO,
  startOfMonth,
  startOfQuarter,
  startOfWeek
} from 'date-fns';
import { Link } from 'react-router-dom';
import { useAuth } from '@/auth/AuthProvider';
import {
  apiFetch,
  getManagerRequestState,
  getRequestType,
  type Booking,
  type ManagerDashboardSummary
} from '@/lib/api';
import {
  capacityBadgeTone,
  capacityLabelText,
  formatDate,
  priorityTone
} from '@/lib/format';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';

type TimeframeMode = 'week' | 'month' | 'quarter' | 'custom';

type CapacitySummary = {
  items: Array<{
    ba_id: string;
    risk_capacity: number;
  }>;
};

type ManagerActionItem =
  | {
      id: string;
      kind: 'booking';
      type: 'PENDING_REQUEST' | 'UNASSIGNED_REQUEST' | 'URGENT_REQUEST' | 'CAPACITY_RISK';
      priority: Booking['priority'];
      project: string;
      requester: string;
      dateRange: string;
      capacity: string;
      assignedBa: string;
      flag: 'URGENT' | 'UNASSIGNED' | 'CAPACITY_RISK' | 'PENDING';
      actionLabel: string;
      actionTo: string;
      booking: Booking;
    }
  | {
      id: string;
      kind: 'ba';
      type: 'OVERBOOKED_BA' | 'BENCH_BA';
      priority: 'HIGH' | 'LOW';
      project: string;
      requester: string;
      dateRange: string;
      capacity: string;
      assignedBa: string;
      flag: 'OVERBOOKED' | 'BENCH';
      actionLabel: string;
      actionTo: string;
    };

export function DashboardPage() {
  const { user } = useAuth();
  const role = user?.role;
  const isManagerDashboard = role === 'BA_MANAGER' || role === 'ADMIN';
  const isBaDashboard = role === 'BA';
  const [timeframeMode, setTimeframeMode] = useState<TimeframeMode>('month');
  const initialMonth = useMemo(() => {
    const now = new Date();
    return {
      from: format(startOfMonth(now), 'yyyy-MM-dd'),
      to: format(endOfMonth(now), 'yyyy-MM-dd')
    };
  }, []);
  const [customFrom, setCustomFrom] = useState(initialMonth.from);
  const [customTo, setCustomTo] = useState(initialMonth.to);
  const managerRange = useMemo(
    () => resolveDashboardRange(timeframeMode, customFrom, customTo),
    [customFrom, customTo, timeframeMode]
  );

  const dashboardCopy = isManagerDashboard
    ? {
        title: 'Manager Dashboard',
        loading: 'Loading manager dashboard...',
        error: 'Could not load manager dashboard. Check API connection and retry.'
      }
    : isBaDashboard
      ? {
          title: 'BA Dashboard',
          loading: 'Loading your dashboard...',
          error: 'Could not load your dashboard. Check API connection and retry.'
        }
      : {
          title: 'PM/PO Dashboard',
          loading: 'Loading your dashboard...',
          error: 'Could not load your dashboard. Check API connection and retry.'
        };

  const bookingsEndpoint = isManagerDashboard
    ? '/api/bookings'
    : isBaDashboard
      ? '/api/bookings/my-schedule'
      : '/api/bookings/my-requests';

  const bookings = useQuery({
    queryKey: ['dashboard-bookings', role, user?.id, bookingsEndpoint],
    queryFn: () => apiFetch<Booking[]>(bookingsEndpoint),
    enabled: Boolean(user)
  });
  const summary = useQuery({
    queryKey: ['dashboard-capacity', role],
    queryFn: () => apiFetch<CapacitySummary>('/api/capacity/summary'),
    enabled: isManagerDashboard
  });
  const managerSummary = useQuery({
    queryKey: ['manager-dashboard-summary', managerRange.from, managerRange.to],
    queryFn: () =>
      apiFetch<ManagerDashboardSummary>(
        `/api/dashboard/manager-summary?from=${managerRange.from}&to=${managerRange.to}`
      ),
    enabled: isManagerDashboard
  });

  const dashboardData = useMemo(() => {
    const allBookings = bookings.data ?? [];
    const timeframeBookings = isManagerDashboard
      ? allBookings.filter((booking) =>
          rangesOverlap(booking.start_date, booking.end_date, managerRange.from, managerRange.to)
        )
      : allBookings;
    const pending = timeframeBookings.filter((booking) => booking.status === 'PENDING');
    const approved = timeframeBookings.filter(
      (booking) => booking.status === 'APPROVED' || booking.status === 'IN_PROGRESS'
    );
    const completed = timeframeBookings.filter((booking) => booking.status === 'COMPLETED');
    const rejectedOrCancelled = timeframeBookings.filter(
      (booking) => booking.status === 'REJECTED' || booking.status === 'CANCELLED'
    );
    const specific = pending.filter((booking) => getRequestType(booking) === 'SPECIFIC_BA');
    const open = pending.filter((booking) => getRequestType(booking) === 'OPEN_REQUEST');
    const urgent = pending.filter((booking) => booking.priority === 'URGENT');
    const byRiskBa = new Set(
      (summary.data?.items ?? [])
        .filter((item) => item.risk_capacity > 100)
        .map((item) => item.ba_id)
    );
    const verificationCount = pending.filter(
      (booking) => getManagerRequestState(booking) === 'NEED_VERIFICATION'
    ).length;
    const overbookCount = pending.filter((booking) => booking.ba_id && byRiskBa.has(booking.ba_id)).length;
    const upcoming = [...timeframeBookings]
      .filter((booking) => booking.status !== 'CANCELLED' && booking.status !== 'REJECTED')
      .sort((left, right) => new Date(left.start_date).getTime() - new Date(right.start_date).getTime())
      .slice(0, 4);
    const actionItems = buildManagerActionItems(
      pending,
      managerSummary.data,
      managerRange,
      byRiskBa
    );

    return {
      timeframeBookings,
      pending,
      approved,
      completed,
      rejectedOrCancelled,
      specific,
      open,
      urgent,
      verificationCount,
      overbookCount,
      upcoming,
      actionItems
    };
  }, [bookings.data, isManagerDashboard, managerRange, managerSummary.data, summary.data]);

  const cards = isManagerDashboard
    ? []
    : isBaDashboard
      ? [
          {
            title: 'Active Assignments',
            count: dashboardData.approved.length,
            description: 'Approved or in progress',
            icon: CalendarRange,
            to: '/my-schedule'
          },
          {
            title: 'Upcoming Work',
            count: dashboardData.upcoming.length,
            description: 'Visible on your schedule',
            icon: ClipboardList,
            to: '/my-schedule'
          },
          {
            title: 'Completed',
            count: dashboardData.completed.length,
            description: 'Finished assignments',
            icon: Sparkles,
            to: '/my-schedule'
          }
        ]
      : [
          {
            title: 'Pending Requests',
            count: dashboardData.pending.length,
            description: 'Awaiting manager review',
            icon: ClipboardList,
            to: '/my-requests?status=PENDING'
          },
          {
            title: 'Approved Requests',
            count: dashboardData.approved.length,
            description: 'Ready or in progress',
            icon: CalendarRange,
            to: '/my-requests?status=APPROVED'
          },
          {
            title: 'Rejected / Cancelled',
            count: dashboardData.rejectedOrCancelled.length,
            description: 'Closed without approval',
            icon: AlertCircle,
            to: '/my-requests'
          }
        ];

  const isLoading =
    bookings.isLoading ||
    (isManagerDashboard && (summary.isLoading || managerSummary.isLoading));
  const hasError =
    bookings.error ||
    (isManagerDashboard && (summary.error || managerSummary.error));

  return (
    <div className="grid gap-5">
      {isLoading ? (
        <Card>
          <CardContent className="p-5 text-sm text-slate-600">{dashboardCopy.loading}</CardContent>
        </Card>
      ) : null}

      {hasError ? (
        <Card>
          <CardContent className="p-5 text-sm text-rose-700">{dashboardCopy.error}</CardContent>
        </Card>
      ) : null}

      {isManagerDashboard ? (
        <ManagerDashboard
          actions={dashboardData.actionItems}
          summary={managerSummary.data}
          timeframeMode={timeframeMode}
          customFrom={customFrom}
          customTo={customTo}
          onTimeframeModeChange={setTimeframeMode}
          onCustomFromChange={setCustomFrom}
          onCustomToChange={setCustomTo}
        />
      ) : (
        <>
          {!isBaDashboard ? (
            <div className="flex flex-col gap-3 rounded-lg border border-blue-100 bg-blue-50 p-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-sm font-semibold text-blue-950">Create a BA booking request</p>
                <p className="mt-1 text-sm text-blue-700">
                  Request a specific BA or leave it open for manager assignment.
                </p>
              </div>
              <Button asChild>
                <Link to="/timeline">
                  <Plus className="h-4 w-4" /> Create Request
                </Link>
              </Button>
            </div>
          ) : null}

          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {cards.map((item) => {
              const Icon = item.icon;

              return (
                <Link key={item.title} to={item.to}>
                  <Card className="h-full transition hover:-translate-y-0.5 hover:shadow-md">
                    <CardContent className="flex items-start justify-between p-5">
                      <div>
                        <p className="text-sm font-medium text-slate-500">{item.title}</p>
                        <p className="mt-2 text-3xl font-bold text-slate-950">{item.count}</p>
                        <p className="mt-2 text-sm text-slate-500">{item.description}</p>
                      </div>
                      <Icon
                        className={
                          item.title === 'Rejected / Cancelled'
                            ? 'h-6 w-6 text-rose-500'
                            : 'h-6 w-6 text-blue-600'
                        }
                      />
                    </CardContent>
                  </Card>
                </Link>
              );
            })}
          </div>

          <Card>
            <CardContent className="grid gap-3 p-5">
              <h2 className="text-base font-semibold text-slate-950">
                {isBaDashboard ? 'Your upcoming assignments' : 'Your recent requests'}
              </h2>
              {dashboardData.upcoming.map((booking) => (
                <UserBookingRow key={booking.id} booking={booking} role={role} />
              ))}

              {dashboardData.upcoming.length === 0 ? (
                <div className="rounded-lg border border-dashed border-slate-200 p-5 text-sm text-slate-500">
                  {isBaDashboard
                    ? 'No assignments are currently on your schedule.'
                    : 'No booking requests found for your account.'}
                </div>
              ) : null}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

function ManagerDashboard({
  actions,
  summary,
  timeframeMode,
  customFrom,
  customTo,
  onTimeframeModeChange,
  onCustomFromChange,
  onCustomToChange
}: {
  actions: ManagerActionItem[];
  summary?: ManagerDashboardSummary;
  timeframeMode: TimeframeMode;
  customFrom: string;
  customTo: string;
  onTimeframeModeChange: (mode: TimeframeMode) => void;
  onCustomFromChange: (value: string) => void;
  onCustomToChange: (value: string) => void;
}) {
  const team = summary?.team;
  const actionCounts = summary?.actions;

  return (
    <>
      <div className="flex flex-col gap-3 rounded-lg border border-slate-200 bg-white p-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <p className="text-sm font-semibold text-slate-950">Action-first command center</p>
          <p className="mt-1 text-sm text-slate-500">
            {summary
              ? `${formatDate(summary.timeframe.from)} - ${formatDate(summary.timeframe.to)}`
              : 'Select a timeframe to load manager actions'}
          </p>
        </div>
        <div className="grid gap-2 sm:grid-cols-[auto_auto_auto] lg:flex lg:items-center">
          <div className="grid grid-cols-4 rounded-md border border-slate-200 bg-slate-100 p-1">
            {(['week', 'month', 'quarter', 'custom'] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => onTimeframeModeChange(mode)}
                className={cn(
                  'rounded-md px-2 py-1.5 text-xs font-semibold capitalize transition-colors sm:text-sm',
                  timeframeMode === mode
                    ? 'bg-white text-slate-950 shadow-sm'
                    : 'text-slate-600 hover:text-slate-950'
                )}
              >
                {mode}
              </button>
            ))}
          </div>
          {timeframeMode === 'custom' ? (
            <>
              <input
                type="date"
                value={customFrom}
                onChange={(event) => onCustomFromChange(event.target.value)}
                className="h-9 rounded-md border border-slate-200 px-2 text-sm"
              />
              <input
                type="date"
                value={customTo}
                onChange={(event) => onCustomToChange(event.target.value)}
                className="h-9 rounded-md border border-slate-200 px-2 text-sm"
              />
            </>
          ) : null}
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
        <MetricTile
          title="Pending Requests"
          value={actionCounts?.pending_requests ?? 0}
          hint="Need review"
          icon={ClipboardList}
          tone="warning"
          to="/manager/action-center?status=PENDING"
        />
        <MetricTile
          title="Unassigned"
          value={actionCounts?.unassigned_requests ?? 0}
          hint="Needs BA"
          icon={UsersRound}
          tone="warning"
          to="/manager/action-center?type=OPEN_REQUEST"
        />
        <MetricTile
          title="Overbooked BA"
          value={actionCounts?.overbooked_ba ?? 0}
          hint="Capacity risk"
          icon={AlertCircle}
          tone="danger"
          to="/timeline"
        />
        <MetricTile
          title="Bench BA"
          value={actionCounts?.bench_ba ?? 0}
          hint={`${team?.bench_rate_percent ?? 0}% bench rate`}
          icon={UserRound}
          tone="neutral"
          to="/crm/ba"
        />
        <MetricTile
          title="Team Utilization"
          value={`${team?.team_utilization_percent ?? 0}%`}
          hint={`${team?.total_ba ?? 0} active BA`}
          icon={Gauge}
          tone="success"
          to="/reports"
        />
        <MetricTile
          title="Man-days"
          value={team?.total_man_days ?? 0}
          hint="Booked this period"
          icon={BarChart3}
          tone="info"
          to="/reports"
        />
      </div>

      <Card>
        <CardContent className="p-0">
          <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
            <div>
              <h2 className="text-base font-semibold text-slate-950">Priority Action List</h2>
              <p className="mt-1 text-xs text-slate-500">
                Urgent, unassigned, overbooked and bench cases appear first.
              </p>
            </div>
            <Button variant="secondary" size="sm" asChild>
              <Link to="/manager/action-center">Open Action Center</Link>
            </Button>
          </div>
          <div className="hidden grid-cols-[115px_105px_minmax(0,1.2fr)_minmax(0,1fr)_150px_110px_minmax(0,1fr)_105px_125px] gap-3 border-b border-slate-100 bg-slate-50 px-4 py-2 text-xs font-semibold uppercase text-slate-500 xl:grid">
            <span>Type</span>
            <span>Priority</span>
            <span>Project</span>
            <span>Requester</span>
            <span>Date Range</span>
            <span>Capacity</span>
            <span>Assigned BA</span>
            <span>Flag</span>
            <span>Action</span>
          </div>
          <div className="divide-y divide-slate-100">
            {actions.slice(0, 12).map((item) => (
              <ManagerActionRow key={item.id} item={item} />
            ))}
            {actions.length === 0 ? (
              <div className="p-5 text-sm text-slate-500">No manager actions in this timeframe.</div>
            ) : null}
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(320px,0.8fr)]">
        <Card>
          <CardContent className="grid gap-4 p-5">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-base font-semibold text-slate-950">Project Effort Distribution</h2>
              <Badge tone="info">{summary?.project_effort.length ?? 0} projects</Badge>
            </div>
            <div className="grid gap-3">
              {(summary?.project_effort ?? []).slice(0, 6).map((project) => (
                <div key={project.project_id} className="grid gap-2">
                  <div className="flex items-center justify-between gap-3 text-sm">
                    <div className="flex min-w-0 items-center gap-2">
                      <span
                        className="h-2.5 w-2.5 rounded-full"
                        style={{ backgroundColor: project.color }}
                      />
                      <span className="truncate font-medium text-slate-800">
                        {project.project_name}
                      </span>
                    </div>
                    <span className="shrink-0 text-slate-600">
                      {project.man_days} md · {project.allocation_percent}%
                    </span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-slate-100">
                    <div
                      className="h-full rounded-full bg-blue-600"
                      style={{ width: `${Math.min(100, project.allocation_percent)}%` }}
                    />
                  </div>
                </div>
              ))}
              {summary?.project_effort.length === 0 ? (
                <p className="text-sm text-slate-500">No approved effort in this timeframe.</p>
              ) : null}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="grid gap-4 p-5">
            <h2 className="text-base font-semibold text-slate-950">Capacity Distribution</h2>
            <div className="grid gap-2 text-sm">
              {summary
                ? Object.entries(summary.capacity_distribution).map(([label, count]) => (
                    <div key={label} className="flex items-center justify-between rounded-md bg-slate-50 px-3 py-2">
                      <span className="capitalize text-slate-600">{label.replace('_', ' ')}</span>
                      <span className="font-semibold text-slate-950">{count}</span>
                    </div>
                  ))
                : null}
            </div>
            <div className="grid gap-2">
              <h3 className="text-sm font-semibold text-slate-800">Utilization watchlist</h3>
              {(summary?.ba_utilization ?? [])
                .filter((row) => row.capacity_label === 'OVERBOOKED' || row.capacity_label === 'BENCH')
                .slice(0, 5)
                .map((row) => (
                  <Link
                    key={row.ba_id}
                    to={`/crm/ba/${row.ba_id}`}
                    className="flex items-center justify-between gap-3 rounded-md border border-slate-200 px-3 py-2 text-sm hover:border-blue-200 hover:bg-blue-50/50"
                  >
                    <span className="min-w-0 truncate font-medium text-slate-800">{row.ba_name}</span>
                    <Badge tone={capacityBadgeTone(row.capacity_label)}>
                      {capacityLabelText(row.capacity_label)}
                    </Badge>
                  </Link>
                ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </>
  );
}

function MetricTile({
  title,
  value,
  hint,
  icon: Icon,
  tone,
  to
}: {
  title: string;
  value: number | string;
  hint: string;
  icon: typeof ClipboardList;
  tone: 'warning' | 'danger' | 'neutral' | 'success' | 'info';
  to: string;
}) {
  const toneClass = {
    warning: 'text-amber-700 bg-amber-50',
    danger: 'text-rose-700 bg-rose-50',
    neutral: 'text-slate-700 bg-slate-100',
    success: 'text-emerald-700 bg-emerald-50',
    info: 'text-blue-700 bg-blue-50'
  }[tone];

  return (
    <Link to={to} className="rounded-lg border border-slate-200 bg-white p-4 transition hover:border-blue-200 hover:shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase text-slate-500">{title}</p>
          <p className="mt-2 text-2xl font-bold text-slate-950">{value}</p>
          <p className="mt-1 text-xs text-slate-500">{hint}</p>
        </div>
        <span className={cn('rounded-md p-2', toneClass)}>
          <Icon className="h-4 w-4" />
        </span>
      </div>
    </Link>
  );
}

function ManagerActionRow({ item }: { item: ManagerActionItem }) {
  return (
    <div className="grid gap-3 px-4 py-3 text-sm xl:grid-cols-[115px_105px_minmax(0,1.2fr)_minmax(0,1fr)_150px_110px_minmax(0,1fr)_105px_125px] xl:items-center">
      <div className="flex flex-wrap items-center gap-2 xl:block">
        <Badge tone={item.flag === 'OVERBOOKED' || item.flag === 'URGENT' ? 'danger' : item.flag === 'BENCH' ? 'neutral' : 'warning'}>
          {item.type.replace('_', ' ')}
        </Badge>
        <span className="text-xs text-slate-500 xl:hidden">{item.dateRange}</span>
      </div>
      <Badge tone={priorityTone(item.priority)}>{item.priority}</Badge>
      <span className="min-w-0 truncate font-medium text-slate-950">{item.project}</span>
      <span className="min-w-0 truncate text-slate-600">{item.requester}</span>
      <span className="hidden text-slate-600 xl:block">{item.dateRange}</span>
      <span className="font-semibold text-slate-800">{item.capacity}</span>
      <span className="min-w-0 truncate text-slate-600">{item.assignedBa}</span>
      <Badge tone={item.flag === 'OVERBOOKED' || item.flag === 'URGENT' ? 'danger' : item.flag === 'BENCH' ? 'neutral' : 'warning'}>
        {item.flag}
      </Badge>
      <Link to={item.actionTo} className="inline-flex items-center font-semibold text-blue-700">
        {item.actionLabel} <ArrowRight className="ml-1 h-4 w-4" />
      </Link>
    </div>
  );
}

function UserBookingRow({ booking, role }: { booking: Booking; role?: string }) {
  const target = role === 'BA' ? '/my-schedule' : `/my-requests?requestId=${booking.id}`;

  return (
    <Link to={target}>
      <div className="grid gap-4 rounded-lg border border-slate-200 p-4 transition hover:border-blue-200 hover:bg-blue-50/40 xl:grid-cols-[minmax(0,1fr)_minmax(180px,180px)_minmax(220px,220px)_auto] xl:items-center">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="truncate text-base font-semibold text-slate-950">{booking.title}</p>
            <Badge>{booking.status.replace('_', ' ')}</Badge>
          </div>
          <p className="mt-2 text-sm text-slate-500">{booking.project.name}</p>
        </div>

        <MetaItem label={role === 'BA' ? 'Requester' : 'BA'} value={role === 'BA' ? booking.requester.full_name : booking.ba?.full_name ?? 'Auto assign'} />
        <MetaItem
          label="Date range"
          value={`${formatDate(booking.start_date)} - ${formatDate(booking.end_date)}`}
        />
        <span className="inline-flex h-10 w-full items-center justify-center rounded-md border border-blue-200 bg-blue-50 px-4 text-sm font-semibold text-blue-700 sm:w-auto xl:justify-self-end">
          View details <ArrowRight className="ml-2 h-4 w-4" />
        </span>
      </div>
    </Link>
  );
}

function MetaItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-w-0 items-start gap-2 text-sm text-slate-500">
      <CalendarRange className="mt-0.5 h-4 w-4 text-slate-400" />
      <div className="min-w-0">
        <p className="text-xs uppercase tracking-wide text-slate-400">{label}</p>
        <p className="truncate text-sm text-slate-600">{value}</p>
      </div>
    </div>
  );
}

function buildManagerActionItems(
  pendingBookings: Booking[],
  summary: ManagerDashboardSummary | undefined,
  range: { from: string; to: string },
  riskBaIds: Set<string>
): ManagerActionItem[] {
  const bookingActions: ManagerActionItem[] = pendingBookings.map((booking) => {
    const state = getManagerRequestState(booking);
    const isUrgent = booking.priority === 'URGENT';
    const isUnassigned = !booking.ba_id;
    const hasCapacityRisk = Boolean(booking.ba_id && riskBaIds.has(booking.ba_id));
    const type = isUrgent
      ? 'URGENT_REQUEST'
      : isUnassigned
        ? 'UNASSIGNED_REQUEST'
        : hasCapacityRisk
          ? 'CAPACITY_RISK'
          : 'PENDING_REQUEST';
    const flag = isUrgent
      ? 'URGENT'
      : isUnassigned
        ? 'UNASSIGNED'
        : hasCapacityRisk
          ? 'CAPACITY_RISK'
          : 'PENDING';

    return {
      id: `booking-${booking.id}`,
      kind: 'booking',
      type,
      priority: booking.priority,
      project: booking.project.name,
      requester: booking.requester.full_name,
      dateRange: `${formatDate(booking.start_date)} - ${formatDate(booking.end_date)}`,
      capacity: `${booking.capacity_percent}%`,
      assignedBa: booking.ba?.full_name ?? 'Unassigned',
      flag,
      actionLabel: state === 'NEEDS_ASSIGNMENT' ? 'Assign BA' : 'Review',
      actionTo: `/manager/action-center?requestId=${booking.id}`,
      booking
    };
  });

  const utilizationRows = summary?.ba_utilization ?? [];
  const overbookedActions: ManagerActionItem[] = utilizationRows
    .filter((row) => row.capacity_label === 'OVERBOOKED')
    .map((row) => ({
      id: `overbooked-${row.ba_id}`,
      kind: 'ba',
      type: 'OVERBOOKED_BA',
      priority: 'HIGH',
      project: summarizeProjectNames(row.current_projects),
      requester: 'Capacity monitor',
      dateRange: `${formatDate(range.from)} - ${formatDate(range.to)}`,
      capacity: `${row.risk_capacity}%`,
      assignedBa: row.ba_name,
      flag: 'OVERBOOKED',
      actionLabel: 'View Timeline',
      actionTo: `/timeline?baId=${row.ba_id}`
    }));
  const benchActions: ManagerActionItem[] = utilizationRows
    .filter((row) => row.capacity_label === 'BENCH')
    .map((row) => ({
      id: `bench-${row.ba_id}`,
      kind: 'ba',
      type: 'BENCH_BA',
      priority: 'LOW',
      project: 'No active allocation',
      requester: 'Capacity monitor',
      dateRange: `${formatDate(range.from)} - ${formatDate(range.to)}`,
      capacity: '0%',
      assignedBa: row.ba_name,
      flag: 'BENCH',
      actionLabel: 'View BA',
      actionTo: `/crm/ba/${row.ba_id}`
    }));

  return [...bookingActions, ...overbookedActions, ...benchActions].sort(
    (left, right) => getManagerActionScore(right) - getManagerActionScore(left)
  );
}

function getManagerActionScore(item: ManagerActionItem) {
  let score = 0;
  if (item.flag === 'URGENT') score += 100;
  if (item.flag === 'UNASSIGNED') score += 80;
  if (item.flag === 'OVERBOOKED' || item.flag === 'CAPACITY_RISK') score += 70;
  if (item.flag === 'BENCH') score += 30;
  if (item.kind === 'booking') {
    score += item.priority === 'HIGH' ? 20 : item.priority === 'MEDIUM' ? 10 : 0;
  }
  return score;
}

function summarizeProjectNames(
  projects: ManagerDashboardSummary['ba_utilization'][number]['current_projects']
) {
  if (projects.length === 0) {
    return 'No active allocation';
  }

  return projects
    .slice(0, 2)
    .map((project) => `${project.project_name} ${project.capacity_percent}%`)
    .join(', ');
}

function resolveDashboardRange(mode: TimeframeMode, customFrom: string, customTo: string) {
  const now = new Date();

  if (mode === 'week') {
    return {
      from: format(startOfWeek(now, { weekStartsOn: 1 }), 'yyyy-MM-dd'),
      to: format(endOfWeek(now, { weekStartsOn: 1 }), 'yyyy-MM-dd')
    };
  }

  if (mode === 'quarter') {
    return {
      from: format(startOfQuarter(now), 'yyyy-MM-dd'),
      to: format(endOfQuarter(now), 'yyyy-MM-dd')
    };
  }

  if (mode === 'custom') {
    return {
      from: customFrom,
      to: customTo
    };
  }

  return {
    from: format(startOfMonth(now), 'yyyy-MM-dd'),
    to: format(endOfMonth(now), 'yyyy-MM-dd')
  };
}

function rangesOverlap(firstStart: string, firstEnd: string, secondStart: string, secondEnd: string) {
  return parseISO(firstStart) <= parseISO(secondEnd) && parseISO(firstEnd) >= parseISO(secondStart);
}

