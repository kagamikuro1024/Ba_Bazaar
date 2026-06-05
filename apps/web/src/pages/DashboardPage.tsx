import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  AlertCircle,
  ArrowRight,
  CalendarRange,
  ClipboardList,
  Sparkles,
  UserRound,
  UsersRound
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { useAuth } from '@/auth/AuthProvider';
import {
  apiFetch,
  getManagerRequestMessage,
  getManagerRequestState,
  getRequestType,
  type Booking
} from '@/lib/api';
import { formatDate } from '@/lib/format';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

type CapacitySummary = {
  items: Array<{
    ba_id: string;
    risk_capacity: number;
  }>;
};

const stateLabelMap = {
  PENDING: 'Pending',
  NEEDS_ASSIGNMENT: 'Needs assignment',
  NEED_VERIFICATION: 'Need verification',
  APPROVED: 'Approved',
  REJECTED: 'Rejected',
  IN_PROGRESS: 'In progress',
  COMPLETED: 'Completed',
  CANCELLED: 'Cancelled'
} as const;

export function DashboardPage() {
  const { user } = useAuth();
  const role = user?.role;
  const isManagerDashboard = role === 'BA_MANAGER' || role === 'ADMIN';
  const isBaDashboard = role === 'BA';
  const dashboardCopy = isManagerDashboard
    ? {
        title: 'Manager Dashboard',
        subtitle: 'Requests waiting for action',
        loading: 'Loading manager dashboard...',
        error: 'Could not load manager dashboard. Check API connection and retry.'
      }
    : isBaDashboard
      ? {
          title: 'BA Dashboard',
          subtitle: 'Your assigned work and schedule status',
          loading: 'Loading your dashboard...',
          error: 'Could not load your dashboard. Check API connection and retry.'
        }
      : {
          title: 'PM/PO Dashboard',
          subtitle: 'Your booking requests and decisions',
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

  const dashboardData = useMemo(() => {
    const allBookings = bookings.data ?? [];
    const pending = allBookings.filter((booking) => booking.status === 'PENDING');
    const approved = allBookings.filter(
      (booking) => booking.status === 'APPROVED' || booking.status === 'IN_PROGRESS'
    );
    const completed = allBookings.filter((booking) => booking.status === 'COMPLETED');
    const rejectedOrCancelled = allBookings.filter(
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
    const upcoming = [...allBookings]
      .filter((booking) => booking.status !== 'CANCELLED' && booking.status !== 'REJECTED')
      .sort((left, right) => new Date(left.start_date).getTime() - new Date(right.start_date).getTime())
      .slice(0, 4);
    const needsActionNow = [...pending]
      .sort((left, right) => {
        const leftScore = getPriorityScore(left);
        const rightScore = getPriorityScore(right);
        if (leftScore !== rightScore) {
          return rightScore - leftScore;
        }

        return new Date(left.start_date).getTime() - new Date(right.start_date).getTime();
      })
      .slice(0, 4);

    return {
      allBookings,
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
      needsActionNow
    };
  }, [bookings.data, summary.data]);

  const cards = isManagerDashboard
    ? [
        {
          title: 'Pending Requests',
          count: dashboardData.pending.length,
          description: 'Need your review',
          icon: ClipboardList,
          to: '/manager/inbox?status=PENDING'
        },
        {
          title: 'Specific BA Requests',
          count: dashboardData.specific.length,
          description: 'Pre-assigned to a BA',
          icon: UserRound,
          to: '/manager/inbox?type=SPECIFIC_BA'
        },
        {
          title: 'Open Requests',
          count: dashboardData.open.length,
          description: 'BA not assigned yet',
          icon: UsersRound,
          to: '/manager/inbox?type=OPEN_REQUEST'
        },
        {
          title: 'Urgent',
          count: dashboardData.urgent.length,
          description: 'High priority',
          icon: AlertCircle,
          to: '/manager/inbox?priority=URGENT'
        }
      ]
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

  const isLoading = bookings.isLoading || (isManagerDashboard && summary.isLoading);
  const hasError = bookings.error || (isManagerDashboard && summary.error);

  return (
    <div className="grid gap-5">
      <div>
        <h1 className="text-2xl font-bold text-slate-950">{dashboardCopy.title}</h1>
        <p className="mt-1 text-sm text-slate-500">{dashboardCopy.subtitle}</p>
      </div>

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

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
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
                      item.title === 'Urgent' || item.title === 'Rejected / Cancelled'
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

      {isManagerDashboard ? (
        <>
          <Card>
            <CardHeader className="pb-4">
              <CardTitle className="text-base">Needs action now</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3">
              {dashboardData.needsActionNow.map((booking) => (
                <ManagerActionRow key={booking.id} booking={booking} />
              ))}

              {dashboardData.needsActionNow.length === 0 ? (
                <div className="rounded-xl border border-dashed border-slate-200 p-5 text-sm text-slate-500">
                  No requests currently need manager action.
                </div>
              ) : null}
            </CardContent>
          </Card>

          <div className="grid gap-4 xl:grid-cols-3">
            <PreviewPanel
              title="Specific BA Requests"
              items={dashboardData.specific.slice(0, 3)}
              emptyText="No specific BA requests."
              to="/manager/inbox?type=SPECIFIC_BA"
            />
            <PreviewPanel
              title="Open Requests"
              items={dashboardData.open.slice(0, 3)}
              emptyText="No open requests."
              to="/manager/inbox?type=OPEN_REQUEST"
            />
            <Card>
              <CardHeader className="pb-4">
                <CardTitle className="text-base">Alerts</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-3">
                <AlertRow
                  icon={Sparkles}
                  text={`${dashboardData.verificationCount} request${dashboardData.verificationCount === 1 ? '' : 's'} need verification`}
                  tone="warning"
                  to="/manager/inbox?needsVerification=true"
                  cta="Open verification requests"
                />
                <AlertRow
                  icon={AlertCircle}
                  text={`${dashboardData.overbookCount} request${dashboardData.overbookCount === 1 ? '' : 's'} may cause overbook`}
                  tone="danger"
                  to="/manager/inbox?overbookRisk=true"
                  cta="Open overbook-risk requests"
                />
              </CardContent>
            </Card>
          </div>
        </>
      ) : (
        <Card>
          <CardHeader className="pb-4">
            <CardTitle className="text-base">
              {isBaDashboard ? 'Your upcoming assignments' : 'Your recent requests'}
            </CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3">
            {dashboardData.upcoming.map((booking) => (
              <UserBookingRow key={booking.id} booking={booking} role={role} />
            ))}

            {dashboardData.upcoming.length === 0 ? (
              <div className="rounded-xl border border-dashed border-slate-200 p-5 text-sm text-slate-500">
                {isBaDashboard
                  ? 'No assignments are currently on your schedule.'
                  : 'No booking requests found for your account.'}
              </div>
            ) : null}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
function ManagerActionRow({ booking }: { booking: Booking }) {
  return (
    <div className="grid gap-4 rounded-xl border border-slate-200 p-4 md:grid-cols-[minmax(0,1fr)_minmax(180px,180px)_minmax(220px,220px)_auto] md:items-center">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <p className="truncate text-base font-semibold text-slate-950">{booking.title}</p>
          <RequestTypeBadge booking={booking} />
          <RequestStateBadge booking={booking} />
        </div>
        <p className="mt-2 text-sm font-medium text-blue-700">
          {getManagerRequestMessage(booking)}
        </p>
      </div>

      <MetaItem label="Requester" value={booking.requester.full_name} />
      <MetaItem
        label="Date range"
        value={`${formatDate(booking.start_date)} - ${formatDate(booking.end_date)}`}
      />

      <Link to={`/manager/inbox?requestId=${booking.id}`}>
        <span className="inline-flex h-10 items-center justify-center rounded-md border border-blue-200 bg-blue-50 px-4 text-sm font-semibold text-blue-700 transition hover:bg-blue-100">
          Open in Manager Inbox <ArrowRight className="ml-2 h-4 w-4" />
        </span>
      </Link>
    </div>
  );
}

function UserBookingRow({ booking, role }: { booking: Booking; role?: string }) {
  const target = role === 'BA' ? '/my-schedule' : `/my-requests?requestId=${booking.id}`;

  return (
    <Link to={target}>
      <div className="grid gap-4 rounded-xl border border-slate-200 p-4 transition hover:border-blue-200 hover:bg-blue-50/40 md:grid-cols-[minmax(0,1fr)_minmax(180px,180px)_minmax(220px,220px)_auto] md:items-center">
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
        <span className="inline-flex h-10 items-center justify-center rounded-md border border-blue-200 bg-blue-50 px-4 text-sm font-semibold text-blue-700">
          View details <ArrowRight className="ml-2 h-4 w-4" />
        </span>
      </div>
    </Link>
  );
}

function PreviewPanel({
  title,
  items,
  emptyText,
  to
}: {
  title: string;
  items: Booking[];
  emptyText: string;
  to: string;
}) {
  return (
    <Card>
      <CardHeader className="pb-4">
        <CardTitle className="text-base">{title}</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-3">
        {items.length === 0 ? (
          <p className="text-sm text-slate-500">{emptyText}</p>
        ) : (
          items.map((booking) => (
            <div key={booking.id} className="flex items-center justify-between gap-3 text-sm">
              <div className="min-w-0">
                <p className="truncate font-medium text-slate-950">{booking.title}</p>
              </div>
              <RequestStateBadge booking={booking} />
            </div>
          ))
        )}
        <Link to={to} className="mt-2 inline-flex items-center text-sm font-semibold text-blue-700">
          View all in Manager Inbox <ArrowRight className="ml-2 h-4 w-4" />
        </Link>
      </CardContent>
    </Card>
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

function AlertRow({
  icon: Icon,
  text,
  tone,
  to,
  cta
}: {
  icon: typeof AlertCircle;
  text: string;
  tone: 'warning' | 'danger';
  to: string;
  cta: string;
}) {
  return (
    <Link
      to={to}
      className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 px-3 py-3 transition hover:border-slate-300 hover:bg-slate-50"
    >
      <div className="flex items-center gap-3">
        <div
          className={
            tone === 'danger'
              ? 'rounded-full bg-rose-50 p-2 text-rose-600'
              : 'rounded-full bg-amber-50 p-2 text-amber-600'
          }
        >
          <Icon className="h-4 w-4" />
        </div>
        <p className="text-sm text-slate-700">{text}</p>
      </div>
      <span className="inline-flex items-center text-sm font-semibold text-blue-700">
        {cta} <ArrowRight className="ml-2 h-4 w-4" />
      </span>
    </Link>
  );
}

function RequestTypeBadge({ booking }: { booking: Booking }) {
  return (
    <Badge tone={getRequestType(booking) === 'SPECIFIC_BA' ? 'info' : 'success'}>
      {getRequestType(booking) === 'SPECIFIC_BA' ? 'Specific BA' : 'Open Request'}
    </Badge>
  );
}

function RequestStateBadge({ booking }: { booking: Booking }) {
  const state = getManagerRequestState(booking);
  const tone =
    state === 'PENDING'
      ? 'warning'
      : state === 'NEEDS_ASSIGNMENT' || state === 'NEED_VERIFICATION'
        ? 'warning'
        : state === 'APPROVED' || state === 'COMPLETED'
          ? 'success'
          : state === 'REJECTED' || state === 'CANCELLED'
            ? 'danger'
            : 'neutral';

  return <Badge tone={tone}>{stateLabelMap[state]}</Badge>;
}

function getPriorityScore(booking: Booking) {
  const state = getManagerRequestState(booking);
  let score = booking.priority === 'URGENT' ? 100 : booking.priority === 'HIGH' ? 60 : 30;

  if (state === 'NEED_VERIFICATION') {
    score += 25;
  }

  if (state === 'NEEDS_ASSIGNMENT') {
    score += 15;
  }

  if (getRequestType(booking) === 'SPECIFIC_BA') {
    score += 10;
  }

  return score;
}
