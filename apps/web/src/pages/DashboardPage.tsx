import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  AlertCircle,
  ArrowRight,
  BarChart3,
  CalendarRange,
  ClipboardList,
  Gauge,
  Sparkles,
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
import { PageHeader, StatCard } from '@/components';
import { cn } from '@/lib/utils';

type DashboardLLMSummary = {
  summary: string;
  bullets: Array<{
    text: string;
    citations: string[];
    highlights?: string[];
  }>;
  citations: Array<{
    id: string;
    label: string;
    value: string;
  }>;
  provider: 'deepseek' | 'fallback';
  grounded: boolean;
  reason?: string;
  cached?: boolean;
};

type TimeframeMode = 'week' | 'month' | 'quarter' | 'custom';
type AttentionFilter = 'ALL' | ManagerAttentionFlag;
type AttentionSort = 'PRIORITY' | 'OLDEST' | 'NEWEST';

type CapacitySummary = {
  items: Array<{
    ba_id: string;
    risk_capacity: number;
  }>;
};

type ManagerAttentionFlag =
  | 'NEEDS_ASSIGNMENT'
  | 'CAPACITY_RISK'
  | 'PENDING_REVIEW'
  | 'OVERBOOKED';

type ManagerActionItem =
  | {
      id: string;
      kind: 'booking';
      priority: Booking['priority'];
      project: string;
      requester: string;
      dateRange: string;
      assignedBa: string;
      flag: ManagerAttentionFlag;
      actionLabel: string;
      actionTo: string;
      booking: Booking;
    }
  | {
      id: string;
      kind: 'ba';
      priority: 'URGENT';
      project: string;
      requester: string;
      dateRange: string;
      assignedBa: string;
      flag: Extract<ManagerAttentionFlag, 'OVERBOOKED'>;
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
  const todayKey = useMemo(() => format(new Date(), 'yyyy-MM-dd'), []);

  const dashboardCopy = isManagerDashboard
    ? {
        eyebrow: 'Manager workspace',
        title: 'Manager Dashboard',
        description: 'See what needs manager action first, then jump into the action list.',
        loading: 'Loading manager dashboard...',
        error: 'Could not load manager dashboard. Check API connection and retry.'
      }
    : isBaDashboard
      ? {
          eyebrow: 'BA workspace',
          title: 'BA Dashboard',
          description: 'Track active assignments, upcoming work, and recent schedule changes.',
          loading: 'Loading your dashboard...',
          error: 'Could not load your dashboard. Check API connection and retry.'
        }
      : {
          eyebrow: 'Requester workspace',
          title: 'PM/PO Dashboard',
          description: 'Review your booking requests and follow their approval status.',
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
  const managerLLMSummary = useQuery({
    queryKey: ['manager-dashboard-llm-summary', managerRange.from, managerRange.to],
    queryFn: () =>
      apiFetch<DashboardLLMSummary>(
        `/api/dashboard/manager-summary/llm?from=${managerRange.from}&to=${managerRange.to}`
      ),
    enabled: isManagerDashboard && Boolean(managerSummary.data)
  });

  const dashboardData = useMemo(() => {
    const allBookings = bookings.data ?? [];
    const timeframeBookings = isManagerDashboard
      ? allBookings.filter((booking) =>
          rangesOverlap(
            booking.start_date,
            booking.end_date,
            managerRange.from,
            managerRange.to
          )
        )
      : allBookings;
    const pending = timeframeBookings.filter((booking) => booking.status === 'PENDING');
    const approved = timeframeBookings.filter(
      (booking) => booking.status === 'APPROVED' || booking.status === 'IN_PROGRESS'
    );
    const completed = timeframeBookings.filter(
      (booking) => booking.status === 'COMPLETED'
    );
    const currentAssignments = timeframeBookings
      .filter(
        (booking) =>
          booking.start_date.slice(0, 10) <= todayKey &&
          booking.end_date.slice(0, 10) >= todayKey &&
          (booking.status === 'APPROVED' || booking.status === 'IN_PROGRESS')
      )
      .sort(
        (left, right) =>
          new Date(left.end_date).getTime() - new Date(right.end_date).getTime()
      );
    const upcomingWork = timeframeBookings
      .filter(
        (booking) =>
          booking.start_date.slice(0, 10) > todayKey &&
          booking.status === 'APPROVED'
      )
      .sort(
        (left, right) =>
          new Date(left.start_date).getTime() - new Date(right.start_date).getTime()
      );
    const completedWork = timeframeBookings
      .filter(
        (booking) =>
          booking.status === 'COMPLETED' ||
          ((booking.status === 'APPROVED' || booking.status === 'IN_PROGRESS') &&
            booking.end_date.slice(0, 10) < todayKey)
      )
      .sort(
        (left, right) =>
          new Date(right.end_date).getTime() - new Date(left.end_date).getTime()
      );
    const rejectedOrCancelled = timeframeBookings.filter(
      (booking) => booking.status === 'REJECTED' || booking.status === 'CANCELLED'
    );
    const specific = pending.filter(
      (booking) => getRequestType(booking) === 'SPECIFIC_BA'
    );
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
    const overbookCount = pending.filter(
      (booking) => booking.ba_id && byRiskBa.has(booking.ba_id)
    ).length;
    const upcoming = isBaDashboard
      ? upcomingWork.slice(0, 4)
      : [...timeframeBookings]
          .sort(
            (left, right) =>
              new Date(right.created_at).getTime() -
              new Date(left.created_at).getTime()
          )
          .slice(0, 4);
    const actionItems = buildManagerActionItems(
      pending,
      managerSummary.data,
      managerRange
    );

    return {
      timeframeBookings,
      pending,
      approved,
      completed,
      currentAssignments,
      upcomingWork,
      completedWork,
      rejectedOrCancelled,
      specific,
      open,
      urgent,
      verificationCount,
      overbookCount,
      upcoming,
      actionItems
    };
  }, [
    bookings.data,
    isBaDashboard,
    isManagerDashboard,
    managerRange,
    managerSummary.data,
    summary.data,
    todayKey
  ]);

  const cards = isManagerDashboard
    ? []
    : isBaDashboard
      ? [
          {
            title: 'Active Assignments',
            count: dashboardData.currentAssignments.length,
            description: 'Running today',
            icon: CalendarRange,
            to: '/my-schedule?tab=current'
          },
          {
            title: 'Upcoming Work',
            count: dashboardData.upcomingWork.length,
            description: 'Future approved work',
            icon: ClipboardList,
            to: '/my-schedule?tab=upcoming'
          },
          {
            title: 'Completed',
            count: dashboardData.completedWork.length,
            description: 'Finished assignments',
            icon: Sparkles,
            to: '/my-schedule?tab=completed'
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
    bookings.error || (isManagerDashboard && (summary.error || managerSummary.error));

  return (
    <div className="grid gap-5">
      <PageHeader
        eyebrow={dashboardCopy.eyebrow}
        title={dashboardCopy.title}
        description={dashboardCopy.description}
        actions={
          isManagerDashboard ? (
            <ManagerDashboardHeaderActions
              timeframeMode={timeframeMode}
              customFrom={customFrom}
              customTo={customTo}
              onTimeframeModeChange={setTimeframeMode}
              onCustomFromChange={setCustomFrom}
              onCustomToChange={setCustomTo}
            />
          ) : null
        }
      />

      {isLoading ? (
        <Card>
          <CardContent className="p-5 text-sm text-slate-600">
            {dashboardCopy.loading}
          </CardContent>
        </Card>
      ) : null}

      {hasError ? (
        <Card>
          <CardContent className="p-5 text-sm text-rose-700">
            {dashboardCopy.error}
          </CardContent>
        </Card>
      ) : null}

      {isManagerDashboard ? (
        <ManagerDashboard
          actions={dashboardData.actionItems}
          summary={managerSummary.data}
          llmSummary={managerLLMSummary.data}
          llmSummaryLoading={managerLLMSummary.isLoading}
        />
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {cards.map((item) => {
              const Icon = item.icon;

              return (
                <Link key={item.title} to={item.to}>
                  <StatCard
                    label={item.title}
                    value={String(item.count)}
                    hint={item.description}
                    icon={Icon}
                    tone={item.title === 'Rejected / Cancelled' ? 'danger' : 'info'}
                    className="h-full"
                  />
                </Link>
              );
            })}
          </div>

          <Card>
            <CardContent className="grid gap-3 p-5">
              <h2 className="text-base font-semibold text-slate-950">
                {isBaDashboard ? 'Upcoming Work' : 'Your recent requests'}
              </h2>
              {dashboardData.upcoming.map((booking) => (
                <UserBookingRow key={booking.id} booking={booking} role={role} />
              ))}

              {dashboardData.upcoming.length === 0 ? (
                <div className="rounded-lg border border-dashed border-slate-200 p-5 text-sm text-slate-500">
                  {isBaDashboard
                    ? 'No upcoming approved work has been assigned yet.'
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

function ManagerDashboardHeaderActions({
  timeframeMode,
  customFrom,
  customTo,
  onTimeframeModeChange,
  onCustomFromChange,
  onCustomToChange
}: {
  timeframeMode: TimeframeMode;
  customFrom: string;
  customTo: string;
  onTimeframeModeChange: (mode: TimeframeMode) => void;
  onCustomFromChange: (value: string) => void;
  onCustomToChange: (value: string) => void;
}) {
  return (
    <div className="flex w-full flex-wrap items-center justify-end gap-2">
      <div className="grid w-full grid-cols-4 rounded-xl border border-slate-200 bg-slate-100 p-1 sm:w-auto sm:rounded-md">
        {(['week', 'month', 'quarter', 'custom'] as const).map((mode) => (
          <button
            key={mode}
            type="button"
            onClick={() => onTimeframeModeChange(mode)}
            className={cn(
              'rounded-md px-2 py-1.5 text-[11px] font-semibold capitalize transition-colors sm:text-sm',
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
            className="h-9 w-full min-w-0 rounded-xl border border-slate-200 px-2 text-sm sm:w-auto sm:rounded-md"
          />
          <input
            type="date"
            value={customTo}
            onChange={(event) => onCustomToChange(event.target.value)}
            className="h-9 w-full min-w-0 rounded-xl border border-slate-200 px-2 text-sm sm:w-auto sm:rounded-md"
          />
        </>
      ) : null}
      <Button variant="secondary" asChild className="w-full sm:w-auto">
        <Link to="/reports">View reports</Link>
      </Button>
    </div>
  );
}

function ManagerDashboard({
  actions,
  summary,
  llmSummary,
  llmSummaryLoading
}: {
  actions: ManagerActionItem[];
  summary?: ManagerDashboardSummary;
  llmSummary?: DashboardLLMSummary;
  llmSummaryLoading?: boolean;
}) {
  const team = summary?.team;
  const [attentionFilter, setAttentionFilter] = useState<AttentionFilter>('ALL');
  const [attentionSort, setAttentionSort] = useState<AttentionSort>('PRIORITY');
  const attentionCounts = useMemo(
    () => ({
      all: actions.length,
      needsAssignment: actions.filter((item) => item.flag === 'NEEDS_ASSIGNMENT')
        .length,
      capacityRisk: actions.filter((item) => item.flag === 'CAPACITY_RISK').length,
      overbooked: actions.filter((item) => item.flag === 'OVERBOOKED').length,
      pendingReview: actions.filter((item) => item.flag === 'PENDING_REVIEW').length
    }),
    [actions]
  );
  const filteredAttention = useMemo(() => {
    const filtered =
      attentionFilter === 'ALL'
        ? actions
        : actions.filter((item) => item.flag === attentionFilter);

    return [...filtered].sort((left, right) => {
      if (attentionSort === 'OLDEST') {
        return getManagerActionCreatedAt(left) - getManagerActionCreatedAt(right);
      }

      if (attentionSort === 'NEWEST') {
        return getManagerActionCreatedAt(right) - getManagerActionCreatedAt(left);
      }

      return (
        getManagerActionPriorityRank(right) - getManagerActionPriorityRank(left) ||
        getManagerActionScore(right) - getManagerActionScore(left) ||
        getManagerActionCreatedAt(left) - getManagerActionCreatedAt(right)
      );
    });
  }, [actions, attentionFilter, attentionSort]);
  const needsAttention = filteredAttention.slice(0, 5);
  const timeframeLabel = summary
    ? `${formatDate(summary.timeframe.from)} - ${formatDate(summary.timeframe.to)}`
    : 'Current timeframe';
  const attentionTabs: Array<{ value: AttentionFilter; label: string; count: number }> = [
    { value: 'ALL', label: 'All', count: attentionCounts.all },
    {
      value: 'NEEDS_ASSIGNMENT',
      label: 'Needs assignment',
      count: attentionCounts.needsAssignment
    },
    { value: 'CAPACITY_RISK', label: 'Capacity risk', count: attentionCounts.capacityRisk },
    { value: 'PENDING_REVIEW', label: 'Pending review', count: attentionCounts.pendingReview },
    { value: 'OVERBOOKED', label: 'Overbooked', count: attentionCounts.overbooked }
  ];

  return (
    <>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
        <StatCard
          label="Attention"
          value={String(attentionCounts.all)}
          hint="All action items"
          icon={ClipboardList}
          tone="info"
          active={attentionFilter === 'ALL'}
          onClick={() => setAttentionFilter('ALL')}
        />
        <StatCard
          label="Unassigned"
          value={String(attentionCounts.needsAssignment)}
          hint="Needs BA"
          icon={UsersRound}
          tone="warning"
          active={attentionFilter === 'NEEDS_ASSIGNMENT'}
          onClick={() => setAttentionFilter('NEEDS_ASSIGNMENT')}
        />
        <StatCard
          label="Capacity risk"
          value={String(attentionCounts.capacityRisk)}
          hint="Over 100% bookings"
          icon={AlertCircle}
          tone="warning"
          active={attentionFilter === 'CAPACITY_RISK'}
          onClick={() => setAttentionFilter('CAPACITY_RISK')}
        />
        <StatCard
          label="Overbooked"
          value={String(attentionCounts.overbooked)}
          hint="Timeline risk"
          icon={AlertCircle}
          tone="danger"
          active={attentionFilter === 'OVERBOOKED'}
          onClick={() => setAttentionFilter('OVERBOOKED')}
        />
        <StatCard
          label="Utilization"
          value={`${team?.team_utilization_percent ?? 0}%`}
          hint={`${team?.total_ba ?? 0} active BA`}
          icon={Gauge}
          tone="success"
        />
        <StatCard
          label="Man-days"
          value={String(team?.total_man_days ?? 0)}
          hint="Booked this period"
          icon={BarChart3}
          tone="info"
        />
      </div>

      <ManagerAISummary summary={llmSummary} isLoading={llmSummaryLoading} />

      <div className="grid items-stretch gap-4 xl:grid-cols-[minmax(0,1.45fr)_minmax(280px,0.55fr)] 2xl:grid-cols-[minmax(0,1.35fr)_minmax(320px,0.65fr)]">
        <Card className="h-full">
          <CardContent className="flex h-full flex-col p-0">
            <div className="flex flex-col gap-3 border-b border-slate-200 px-4 py-3 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <h2 className="text-base font-semibold text-slate-950">
                  Needs Attention
                </h2>
                <p className="mt-1 text-xs text-slate-500">
                  Top 5 manager actions for {timeframeLabel}.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm text-slate-500">Sort by</span>
                <select
                  value={attentionSort}
                  onChange={(event) =>
                    setAttentionSort(event.target.value as AttentionSort)
                  }
                  className="h-9 rounded-md border border-slate-200 bg-white px-3 text-sm"
                >
                  <option value="PRIORITY">Priority</option>
                  <option value="OLDEST">Oldest first</option>
                  <option value="NEWEST">Newest first</option>
                </select>
              </div>
            </div>
            <div className="flex flex-wrap gap-2 border-b border-slate-100 px-4 py-3">
              {attentionTabs.map((tab) => (
                <button
                  key={tab.value}
                  type="button"
                  onClick={() => setAttentionFilter(tab.value)}
                  className={cn(
                    'inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm font-semibold transition-colors',
                    attentionFilter === tab.value
                      ? 'border-blue-300 bg-blue-50 text-blue-700'
                      : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:text-slate-950'
                  )}
                >
                  {tab.label}
                  <span className="rounded-full bg-white/80 px-1.5 text-xs">
                    {tab.count}
                  </span>
                </button>
              ))}
            </div>
            <div className="hidden grid-cols-[88px_minmax(0,1.45fr)_minmax(0,0.9fr)_minmax(0,0.9fr)_124px_108px_156px] gap-3 border-b border-slate-100 bg-slate-50 px-4 py-2 text-xs font-semibold uppercase text-slate-500 xl:grid">
              <span>Priority</span>
              <span>Project</span>
              <span>Requester</span>
              <span>BA</span>
              <span>Date Range</span>
              <span>Reason</span>
              <span className="text-right">Action</span>
            </div>
            <div className="flex flex-1 flex-col divide-y divide-slate-100">
              {needsAttention.map((item) => (
                <ManagerActionRow key={item.id} item={item} />
              ))}
              {filteredAttention.length === 0 ? (
                <div className="flex flex-1 items-center p-5 text-sm text-slate-500">
                  No manager actions match this filter.
                </div>
              ) : null}
            </div>
            {filteredAttention.length > needsAttention.length ? (
              <div className="border-t border-slate-100 px-4 py-3 text-sm">
                <Link
                  to="/manager/action-center"
                  className="inline-flex items-center font-semibold text-blue-700"
                >
                  Review {filteredAttention.length - needsAttention.length} more in
                  Action Center
                  <ArrowRight className="ml-1 h-4 w-4" />
                </Link>
              </div>
            ) : null}
          </CardContent>
        </Card>

        <ManagerAlertRail counts={attentionCounts} summary={summary} />
      </div>

      <div className="grid gap-4">
        <Card>
          <CardContent className="grid gap-4 p-5">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-base font-semibold text-slate-950">
                Project Effort Distribution
              </h2>
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
                <p className="text-sm text-slate-500">
                  No approved effort in this timeframe.
                </p>
              ) : null}
            </div>
          </CardContent>
        </Card>
      </div>
    </>
  );
}

function renderHighlightedText(text: string, highlights: string[] = [], citations: string[] = []) {
  const semanticHighlights = buildSemanticHighlights(text, citations);
  const uniqueHighlights = Array.from(
    new Set([...semanticHighlights, ...highlights.map((item) => item.trim())].filter((item) => item && text.includes(item)))
  ).slice(0, 8);

  if (uniqueHighlights.length === 0) return text;

  const pattern = new RegExp(`(${uniqueHighlights.map(escapeRegex).join('|')})`, 'gi');
  return text.split(pattern).map((part, index) => {
    const matchedHighlight = uniqueHighlights.find(
      (highlight) => highlight.toLowerCase() === part.toLowerCase()
    );

    return matchedHighlight ? (
      <mark key={`${part}-${index}`} className={cn('rounded px-1 font-semibold', highlightTone(part, citations))}>
        {part}
      </mark>
    ) : (
      part
    );
  });
}

function buildSemanticHighlights(text: string, citations: string[]) {
  const terms: string[] = [];
  const lower = text.toLowerCase();

  if (citations.includes('C5') || citations.includes('C6')) {
    if (lower.includes('overbooked')) terms.push('overbooked');
    if (lower.includes('overbook risk')) terms.push('Overbook risk');
  }
  if (citations.includes('C5') || citations.includes('C7')) {
    if (lower.includes('bench')) terms.push('bench');
  }
  if (citations.includes('C4')) {
    if (lower.includes('urgent')) terms.push('urgent');
    if (lower.includes('unassigned')) terms.push('unassigned');
  }
  if (citations.includes('C2') || citations.includes('C3')) {
    const percentages = text.match(/\b\d+(?:\.\d+)?%\b/g) ?? [];
    const manDays = text.match(/\b\d+(?:\.\d+)?\s+man-days?\b/gi) ?? [];
    terms.push(...percentages, ...manDays);
  }

  return terms;
}

function highlightTone(value: string, citations: string[]) {
  const lower = value.toLowerCase();
  if (lower.includes('overbook')) return 'bg-rose-100 text-rose-800 ring-1 ring-rose-200';
  if (lower.includes('bench')) return 'bg-sky-100 text-sky-800 ring-1 ring-sky-200';
  if (lower.includes('urgent')) return 'bg-amber-100 text-amber-900 ring-1 ring-amber-200';
  if (lower.includes('unassigned')) return 'bg-violet-100 text-violet-800 ring-1 ring-violet-200';
  if (citations.includes('C2') || citations.includes('C3')) return 'bg-emerald-100 text-emerald-800 ring-1 ring-emerald-200';
  return 'bg-amber-100 text-amber-900 ring-1 ring-amber-200';
}

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function ManagerAISummary({
  summary,
  isLoading
}: {
  summary?: DashboardLLMSummary;
  isLoading?: boolean;
}) {
  if (isLoading) {
    return (
      <Card className="overflow-hidden border-blue-100 bg-gradient-to-br from-blue-50 via-white to-cyan-50">
        <CardContent className="relative grid gap-4 p-5">
          <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(110deg,transparent_20%,rgba(59,130,246,0.16)_45%,transparent_70%)] animate-[dashboard-shimmer_1.8s_ease-in-out_infinite]" />
          <div className="relative flex items-start gap-3">
            <div className="grid h-10 w-10 place-items-center rounded-2xl bg-blue-600 text-white shadow-lg shadow-blue-200">
              <Sparkles className="h-5 w-5 animate-pulse" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <h2 className="text-base font-semibold text-slate-950">Grounding AI summary</h2>
                <span className="relative flex h-2.5 w-2.5">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-blue-400 opacity-75" />
                  <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-blue-500" />
                </span>
              </div>
              <p className="mt-1 text-sm text-slate-600">
                Checking dashboard facts, drafting cited bullets, then validating every claim.
              </p>
            </div>
          </div>
          <div className="relative grid gap-2">
            {['Collecting metrics', 'Writing cited bullets', 'Verifying citation IDs'].map((label, index) => (
              <div key={label} className="flex items-center gap-3 rounded-lg border border-blue-100 bg-white/80 p-3">
                <span className="h-2 w-2 rounded-full bg-blue-500 animate-[dashboard-dot_1.2s_ease-in-out_infinite]" style={{ animationDelay: `${index * 160}ms` }} />
                <span className="text-sm font-medium text-slate-700">{label}</span>
                <span className="ml-auto h-2 w-24 overflow-hidden rounded-full bg-slate-100">
                  <span className="block h-full w-1/2 rounded-full bg-blue-400 animate-[dashboard-progress_1.5s_ease-in-out_infinite]" style={{ animationDelay: `${index * 120}ms` }} />
                </span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!summary) return null;

  const citationMap = new Map(summary.citations.map((citation) => [citation.id, citation]));

  return (
    <Card className="border-blue-100 bg-gradient-to-br from-blue-50/80 to-white">
      <CardContent className="grid gap-4 p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-blue-600" />
              <h2 className="text-base font-semibold text-slate-950">Grounded AI Summary</h2>
            </div>
            <p className="mt-1 text-sm text-slate-600">{summary.summary}</p>
          </div>
          <Badge tone={summary.provider === 'deepseek' ? 'info' : 'neutral'}>
            {summary.provider === 'deepseek' ? 'DeepSeek' : 'Fallback'} · {summary.cached ? 'cached' : 'cited'}
          </Badge>
        </div>
        {summary.provider === 'fallback' && summary.reason ? (
          <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
            LLM unavailable: {summary.reason}
          </p>
        ) : null}
        <div className="grid gap-2">
          {summary.bullets.map((bullet) => (
            <div key={bullet.text} className="rounded-lg border border-blue-100 bg-white/80 p-3 text-sm text-slate-700">
              <p>{renderHighlightedText(bullet.text, bullet.highlights, bullet.citations)}</p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {bullet.citations.map((id) => {
                  const citation = citationMap.get(id);
                  return citation ? (
                    <span key={id} className="rounded-full bg-blue-50 px-2 py-0.5 text-[11px] font-semibold text-blue-700">
                      {id}: {citation.label}
                    </span>
                  ) : null;
                })}
              </div>
            </div>
          ))}
        </div>
        <details className="text-xs text-slate-500">
          <summary className="cursor-pointer font-semibold text-slate-600">View grounding data</summary>
          <div className="mt-2 grid gap-1 sm:grid-cols-2">
            {summary.citations.map((citation) => (
              <p key={citation.id} className="rounded-md bg-white/70 px-2 py-1">
                <span className="font-semibold text-slate-700">{citation.id} {citation.label}:</span> {citation.value}
              </p>
            ))}
          </div>
        </details>
      </CardContent>
    </Card>
  );
}

function ManagerAlertRail({
  counts,
  summary
}: {
  counts: {
    all: number;
    needsAssignment: number;
    capacityRisk: number;
    overbooked: number;
    pendingReview: number;
  };
  summary?: ManagerDashboardSummary;
}) {
  const watchlist = (summary?.ba_utilization ?? [])
    .filter((row) => row.capacity_label === 'OVERBOOKED' || row.capacity_label === 'BENCH')
    .slice(0, 4);

  return (
    <Card>
      <CardContent className="grid gap-4 p-5">
        <div>
          <h2 className="text-base font-semibold text-slate-950">Alerts</h2>
          <p className="mt-1 text-sm text-slate-500">
            Read-only shortcuts into the work queues.
          </p>
        </div>
        <div className="grid gap-2">
          <ManagerAlertLink
            tone="danger"
            title={`${counts.overbooked} overbooked BA`}
            description="Open the timeline to inspect workload conflicts."
            to="/timeline"
          />
          <ManagerAlertLink
            tone="warning"
            title={`${counts.capacityRisk} capacity risk request`}
            description="Review requests that may exceed available capacity."
            to="/manager/action-center?overbookRisk=true"
          />
          <ManagerAlertLink
            tone="warning"
            title={`${counts.needsAssignment} request needs assignment`}
            description="Assign a BA before approval."
            to="/manager/action-center?type=OPEN_REQUEST"
          />
          <ManagerAlertLink
            tone="info"
            title={`${counts.pendingReview} pending review`}
            description="Review pending booking context."
            to="/manager/action-center?status=PENDING"
          />
        </div>
        <div className="grid gap-2 border-t border-slate-100 pt-4">
          <h3 className="text-sm font-semibold text-slate-800">
            Utilization watchlist
          </h3>
          {watchlist.map((row) => (
            <Link
              key={row.ba_id}
              to={`/crm/ba/${row.ba_id}`}
              className="flex items-center justify-between gap-3 rounded-md border border-slate-200 px-3 py-2 text-sm hover:border-blue-200 hover:bg-blue-50/50"
            >
              <span className="min-w-0 truncate font-medium text-slate-800">
                {row.ba_name}
              </span>
              <Badge tone={capacityBadgeTone(row.capacity_label)}>
                {capacityLabelText(row.capacity_label)}
              </Badge>
            </Link>
          ))}
          {watchlist.length === 0 ? (
            <p className="rounded-md border border-dashed border-slate-200 px-3 py-2 text-sm text-slate-500">
              No utilization alerts in this timeframe.
            </p>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}

function ManagerAlertLink({
  tone,
  title,
  description,
  to
}: {
  tone: 'danger' | 'warning' | 'info';
  title: string;
  description: string;
  to: string;
}) {
  const dotClass = {
    danger: 'bg-rose-500',
    warning: 'bg-amber-500',
    info: 'bg-blue-500'
  }[tone];

  return (
    <Link
      to={to}
      className="flex gap-3 rounded-lg border border-slate-200 p-3 transition hover:border-blue-200 hover:bg-blue-50/40"
    >
      <span className={cn('mt-1 h-2.5 w-2.5 shrink-0 rounded-full', dotClass)} />
      <span className="min-w-0">
        <span className="block text-sm font-semibold text-slate-950">{title}</span>
        <span className="mt-1 block text-xs leading-5 text-slate-500">
          {description}
        </span>
      </span>
    </Link>
  );
}

function ManagerActionRow({ item }: { item: ManagerActionItem }) {
  return (
    <div className="grid gap-3 px-4 py-4 text-sm xl:grid-cols-[88px_minmax(0,1.45fr)_minmax(0,0.9fr)_minmax(0,0.9fr)_124px_108px_156px] xl:items-center">
      <Badge tone={priorityTone(item.priority)}>{item.priority}</Badge>
      <span className="min-w-0 truncate font-medium text-slate-950">{item.project}</span>
      <span className="min-w-0 truncate text-slate-600">{item.requester}</span>
      <span className="min-w-0 truncate text-slate-600">{item.assignedBa}</span>
      <span className="text-slate-600">{item.dateRange}</span>
      <Badge
        tone={
          item.flag === 'OVERBOOKED'
            ? 'danger'
            : item.flag === 'CAPACITY_RISK' || item.flag === 'NEEDS_ASSIGNMENT'
              ? 'warning'
              : 'info'
        }
      >
        {formatManagerFlag(item.flag)}
      </Badge>
        <div className="flex flex-wrap justify-start gap-2 xl:justify-end">
          <Button size="sm" asChild>
            <Link to={item.actionTo}>
              {item.actionLabel}
              <ArrowRight className="h-4 w-4" />
            </Link>
          </Button>
        </div>
    </div>
  );
}

function UserBookingRow({ booking, role }: { booking: Booking; role?: string }) {
  const target =
    role === 'BA'
      ? `/my-schedule?tab=upcoming&bookingId=${booking.id}`
      : `/my-requests?requestId=${booking.id}`;

  return (
    <Link to={target}>
      <div className="grid gap-4 rounded-lg border border-slate-200 p-4 transition hover:border-blue-200 hover:bg-blue-50/40 xl:grid-cols-[minmax(0,1fr)_minmax(180px,180px)_minmax(220px,220px)_auto] xl:items-center">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="truncate text-base font-semibold text-slate-950">
              {booking.title}
            </p>
            <Badge>{booking.status.replace('_', ' ')}</Badge>
          </div>
          <p className="mt-2 text-sm text-slate-500">{booking.project.name}</p>
        </div>

        <MetaItem
          label={role === 'BA' ? 'Requester' : 'BA'}
          value={
            role === 'BA'
              ? booking.requester.full_name
              : (booking.ba?.full_name ?? 'Auto assign')
          }
        />
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
  range: { from: string; to: string }
): ManagerActionItem[] {
  const utilizationByBa = new Map(
    (summary?.ba_utilization ?? []).map((row) => [row.ba_id, row])
  );
  const bookingActions: ManagerActionItem[] = pendingBookings.map((booking) => {
    const state = getManagerRequestState(booking);
    const isUnassigned = !booking.ba_id;
    const utilization = booking.ba_id ? utilizationByBa.get(booking.ba_id) : undefined;
    const hasCapacityRisk = Boolean(
      utilization &&
      utilization.approved_capacity <= 100 &&
      utilization.approved_capacity + booking.capacity_percent > 100
    );
    const flag = hasCapacityRisk
      ? 'CAPACITY_RISK'
      : isUnassigned || state === 'NEEDS_ASSIGNMENT'
        ? 'NEEDS_ASSIGNMENT'
        : 'PENDING_REVIEW';

    return {
      id: `booking-${booking.id}`,
      kind: 'booking',
      priority: booking.priority,
      project: booking.project.name,
      requester: booking.requester.full_name,
      dateRange: `${formatDate(booking.start_date)} - ${formatDate(booking.end_date)}`,
      assignedBa: booking.ba?.full_name ?? 'Unassigned',
      flag,
      actionLabel:
        flag === 'NEEDS_ASSIGNMENT'
          ? 'Assign BA'
          : flag === 'CAPACITY_RISK'
            ? 'Review capacity'
            : 'Review request',
      actionTo: `/manager/action-center?requestId=${booking.id}`,
      booking
    };
  });

  const utilizationRows = summary?.ba_utilization ?? [];
  const overbookedActions: ManagerActionItem[] = utilizationRows
    .filter((row) => row.approved_capacity > 100)
    .map((row) => ({
      id: `overbooked-${row.ba_id}`,
      kind: 'ba',
      priority: 'URGENT',
      project: summarizeProjectNames(row.current_projects),
      requester: 'Capacity monitor',
      dateRange: `${formatDate(range.from)} - ${formatDate(range.to)}`,
      assignedBa: row.ba_name,
      flag: 'OVERBOOKED',
      actionLabel: 'View Timeline',
      actionTo: `/timeline?baId=${row.ba_id}`
    }));

  return [...bookingActions, ...overbookedActions]
    .filter(
      (item) =>
        item.flag === 'OVERBOOKED' ||
        item.flag === 'CAPACITY_RISK' ||
        item.flag === 'NEEDS_ASSIGNMENT' ||
        (item.kind === 'booking' && item.booking.status === 'PENDING')
    )
    .sort(
      (left, right) =>
        getManagerActionPriorityRank(right) - getManagerActionPriorityRank(left) ||
        getManagerActionScore(right) - getManagerActionScore(left) ||
        getManagerActionCreatedAt(left) - getManagerActionCreatedAt(right)
    );
}

function getManagerActionPriorityRank(item: ManagerActionItem) {
  if (item.priority === 'URGENT') return 3;
  if (item.priority === 'HIGH') return 2;
  return 1;
}

function getManagerActionScore(item: ManagerActionItem) {
  let score = 0;
  if (item.flag === 'OVERBOOKED') score += 600;
  if (item.flag === 'CAPACITY_RISK') score += 500;
  if (item.flag === 'NEEDS_ASSIGNMENT') score += 300;
  if (item.flag === 'PENDING_REVIEW') score += 150;
  if (item.kind === 'booking') {
    score += 100;
    score += item.priority === 'URGENT' ? 40 : item.priority === 'HIGH' ? 30 : 0;
  }
  return score;
}

function getManagerActionCreatedAt(item: ManagerActionItem) {
  return item.kind === 'booking' ? new Date(item.booking.created_at).getTime() : 0;
}

function formatManagerFlag(flag: ManagerActionItem['flag']) {
  if (flag === 'CAPACITY_RISK') return 'Capacity Risk';
  if (flag === 'OVERBOOKED') return 'Overbooked';
  if (flag === 'NEEDS_ASSIGNMENT') return 'Needs Assignment';
  return 'Pending Review';
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

function resolveDashboardRange(
  mode: TimeframeMode,
  customFrom: string,
  customTo: string
) {
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

function rangesOverlap(
  firstStart: string,
  firstEnd: string,
  secondStart: string,
  secondEnd: string
) {
  return (
    parseISO(firstStart) <= parseISO(secondEnd) &&
    parseISO(firstEnd) >= parseISO(secondStart)
  );
}
