import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router-dom';
import { CalendarRange, Clock, UserRound } from 'lucide-react';
import { apiFetch, type Booking, type PaginatedResponse } from '@/lib/api';
import { StatusBadge } from '@/components/common';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { LoadingScreen } from '@/components/ui/loading-screen';
import { formatDate, priorityTone } from '@/lib/format';

type ScheduleTab = 'current' | 'upcoming' | 'completed' | 'all';

const tabLabels: Record<ScheduleTab, string> = {
  current: 'Current',
  upcoming: 'Upcoming',
  completed: 'Completed',
  all: 'All'
};

const SCHEDULE_PAGE_SIZE = 50;

export function MySchedulePage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const targetBookingId = searchParams.get('bookingId');
  const requestedTab = parseScheduleTab(searchParams.get('tab'));
  const todayKey = useMemo(() => toDateKey(new Date()), []);
  const [page] = useState(1);
  const schedule = useQuery({
    queryKey: ['my-schedule', page],
    queryFn: () => apiFetch<PaginatedResponse<Booking>>(`/api/bookings/my-schedule?page=${page}&page_size=${SCHEDULE_PAGE_SIZE}`),
    placeholderData: (previous) => previous
  });

  const grouped = useMemo(() => {
    const bookings = schedule.data?.items ?? [];
    const current = bookings
      .filter(
        (booking) =>
          booking.start_date.slice(0, 10) <= todayKey &&
          booking.end_date.slice(0, 10) >= todayKey &&
          (booking.status === 'APPROVED' || booking.status === 'IN_PROGRESS')
      )
      .sort(byStartDateAsc);
    const upcoming = bookings
      .filter(
        (booking) =>
          booking.start_date.slice(0, 10) > todayKey && booking.status === 'APPROVED'
      )
      .sort(byStartDateAsc);
    const completed = bookings
      .filter(
        (booking) =>
          booking.status === 'COMPLETED' ||
          ((booking.status === 'APPROVED' || booking.status === 'IN_PROGRESS') &&
            booking.end_date.slice(0, 10) < todayKey)
      )
      .sort(byEndDateDesc);
    const all = [...bookings].sort(byStartDateAsc);

    return { current, upcoming, completed, all };
  }, [schedule.data, todayKey]);

  const activeTab =
    requestedTab ??
    (grouped.current.length > 0
      ? 'current'
      : grouped.upcoming.length > 0
        ? 'upcoming'
        : 'current');
  const visibleBookings = grouped[activeTab];

  function setTab(tab: ScheduleTab) {
    const params = new URLSearchParams(searchParams);
    params.set('tab', tab);
    params.delete('bookingId');
    setSearchParams(params);
  }

  return (
    <div className="grid gap-5">
      {schedule.isLoading ? <LoadingScreen message="Loading your schedule" /> : null}
      {schedule.error ? (
        <Card>
          <CardContent className="p-5 text-sm text-rose-700">
            Could not load schedule. Check API connection and retry.
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardContent className="flex items-center gap-2 overflow-x-auto p-2.5 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden sm:flex-wrap sm:overflow-x-visible">
          {(Object.keys(tabLabels) as ScheduleTab[]).map((tab) => (
            <button
              key={tab}
              type="button"
              onClick={() => setTab(tab)}
              className={[
                'inline-flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-[11px] font-semibold transition sm:text-sm',
                activeTab === tab
                  ? 'bg-blue-600 text-white shadow-sm'
                  : 'text-slate-600 hover:bg-slate-100 hover:text-slate-950'
              ].join(' ')}
            >
              <span>{tabLabels[tab]}</span>
              <span className={activeTab === tab ? 'opacity-80' : 'text-slate-400'}>
                {grouped[tab].length}
              </span>
            </button>
          ))}
        </CardContent>
      </Card>

      <div className="grid gap-4">
        {visibleBookings.map((booking) => (
          <ScheduleCard
            key={booking.id}
            booking={booking}
            todayKey={todayKey}
            highlighted={booking.id === targetBookingId}
            mode={activeTab}
          />
        ))}
        {!schedule.isLoading && visibleBookings.length === 0 ? (
          <Card>
            <CardContent className="p-5 text-sm text-slate-600">
              {emptyScheduleText(activeTab)}
            </CardContent>
          </Card>
        ) : null}
      </div>
    </div>
  );
}

function ScheduleCard({
  booking,
  todayKey,
  highlighted,
  mode
}: {
  booking: Booking;
  todayKey: string;
  highlighted: boolean;
  mode: ScheduleTab;
}) {
  const daysRemaining = Math.max(
    0,
    Math.ceil(
      (new Date(`${booking.end_date.slice(0, 10)}T00:00:00`).getTime() -
        new Date(`${todayKey}T00:00:00`).getTime()) /
        86_400_000
    )
  );

  return (
    <Card className={highlighted ? 'ring-2 ring-blue-600 ring-offset-2' : ''}>
      <CardContent className="grid gap-4 p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="truncate text-base font-semibold text-slate-950">
                {booking.title || booking.project.name}
              </h3>
              <StatusBadge status={booking.status} />
              <Badge tone={priorityTone(booking.priority)}>{booking.priority}</Badge>
            </div>
            <p className="mt-1 text-sm font-medium text-slate-700">
              {booking.project.name}
            </p>
          </div>
          <Badge tone="info">{booking.capacity_percent}% capacity</Badge>
        </div>

        <p className="text-sm leading-6 text-slate-600">{booking.description}</p>

        <div className="grid gap-3 text-sm text-slate-600 md:grid-cols-3">
          <ScheduleMeta
            icon={CalendarRange}
            label="Date range"
            value={`${formatDate(booking.start_date)} - ${formatDate(booking.end_date)}`}
          />
          <ScheduleMeta
            icon={UserRound}
            label="Requester"
            value={booking.requester.full_name}
          />
          <ScheduleMeta
            icon={Clock}
            label={mode === 'current' ? 'Remaining' : 'Timing'}
            value={
              mode === 'current'
                ? `${daysRemaining} day${daysRemaining === 1 ? '' : 's'} left`
                : mode === 'upcoming'
                  ? `Starts ${formatDate(booking.start_date)}`
                  : `Ended ${formatDate(booking.end_date)}`
            }
          />
        </div>

        <div className="flex justify-end">
          <Button type="button" variant="secondary" size="sm" asChild>
            <Link to={`/my-schedule?tab=${mode}&bookingId=${booking.id}`}>
              View details
            </Link>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function ScheduleMeta({
  icon: Icon,
  label,
  value
}: {
  icon: typeof CalendarRange;
  label: string;
  value: string;
}) {
  return (
    <div className="flex min-w-0 gap-2 rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2">
      <Icon className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
      <div className="min-w-0">
        <p className="text-xs font-semibold uppercase text-slate-400">{label}</p>
        <p className="truncate text-sm font-medium text-slate-700">{value}</p>
      </div>
    </div>
  );
}

function parseScheduleTab(value: string | null): ScheduleTab | null {
  return value === 'current' ||
    value === 'upcoming' ||
    value === 'completed' ||
    value === 'all'
    ? value
    : null;
}

function byStartDateAsc(left: Booking, right: Booking) {
  return new Date(left.start_date).getTime() - new Date(right.start_date).getTime();
}

function byEndDateDesc(left: Booking, right: Booking) {
  return new Date(right.end_date).getTime() - new Date(left.end_date).getTime();
}

function toDateKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(
    date.getDate()
  ).padStart(2, '0')}`;
}

function emptyScheduleText(tab: ScheduleTab) {
  if (tab === 'current') {
    return 'No current assigned work is active today.';
  }

  if (tab === 'upcoming') {
    return 'No upcoming approved work has been assigned yet.';
  }

  if (tab === 'completed') {
    return 'No completed work is available yet.';
  }

  return 'No assigned bookings yet.';
}
