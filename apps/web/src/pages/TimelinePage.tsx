import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  addDays,
  addMonths,
  differenceInCalendarDays,
  eachDayOfInterval,
  endOfMonth,
  format,
  isSameDay,
  parseISO,
  startOfWeek,
  startOfMonth
} from 'date-fns';
import { ChevronLeft, ChevronRight, Plus } from 'lucide-react';
import {
  apiFetch,
  getMockRole,
  type BAProfile,
  type Booking,
  type BookingPriority,
  type Project
} from '@/lib/api';
import { BAIdentity, Field, StatusBadge } from '@/components/common';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Modal } from '@/components/ui/modal';
import { capacityColor, formatDate } from '@/lib/format';
import { cn } from '@/lib/utils';

type RequestDraft = {
  ba_id: string;
  start_date: string;
  end_date: string;
  direct: boolean;
};

type RangeCheck = {
  has_overbook_risk_after_request: boolean;
  daily: Array<{
    date: string;
    approved_capacity: number;
    pending_capacity: number;
    requested_capacity: number;
    risk_after_request: number;
  }>;
};

const initialWeek = startOfWeek(new Date(), { weekStartsOn: 1 });
const baInfoColumnWidth = 260;
const mobileDayMinWidth = 70;
const mobileCompactScrollThreshold = mobileDayMinWidth * 3;
const bookingLaneHeight = 36;
const desktopBarBaseTop = 16;
const mobileBarBaseTop = 58;

function dayCellBackground(isAlternateRow: boolean) {
  return isAlternateRow
    ? 'bg-[repeating-linear-gradient(-45deg,#eff6ff,#eff6ff_6px,#dbeafe_6px,#dbeafe_12px)]'
    : 'bg-[repeating-linear-gradient(-45deg,#f8fafc,#f8fafc_6px,#eef2f7_6px,#eef2f7_12px)]';
}

function bookingBarClass(status: Booking['status']) {
  switch (status) {
    case 'PENDING':
      return 'border border-dashed border-amber-400 bg-amber-100 text-amber-800';
    case 'REJECTED':
      return 'border border-gray-300 bg-gray-100 text-gray-700 opacity-80';
    default:
      return 'bg-blue-600 text-white';
  }
}

type BookingLayout = {
  booking: Booking;
  left: number;
  span: number;
  lane: number;
};

function computeBookingLayouts(days: Date[], bookings: Booking[]): BookingLayout[] {
  if (days.length === 0) return [];
  const first = days[0];
  const last = days[days.length - 1];

  const visible = bookings
    .map((booking) => {
      const rawStart = parseISO(booking.start_date);
      const rawEnd = parseISO(booking.end_date);
      const start = rawStart < first ? first : rawStart;
      const end = rawEnd > last ? last : rawEnd;
      if (end < first || start > last) return null;
      return { booking, start, end };
    })
    .filter((item): item is { booking: Booking; start: Date; end: Date } => item !== null)
    .sort((a, b) => {
      const byStart = a.start.getTime() - b.start.getTime();
      if (byStart !== 0) return byStart;
      return a.end.getTime() - b.end.getTime();
    });

  const laneEndDays: number[] = [];
  const layouts: BookingLayout[] = [];

  for (const item of visible) {
    const left = Math.max(0, differenceInCalendarDays(item.start, first));
    const span = differenceInCalendarDays(item.end, item.start) + 1;
    const endDay = left + span - 1;

    let lane = laneEndDays.findIndex((laneEnd) => laneEnd < left);
    if (lane === -1) {
      lane = laneEndDays.length;
      laneEndDays.push(endDay);
    } else {
      laneEndDays[lane] = endDay;
    }

    layouts.push({ booking: item.booking, left, span, lane });
  }

  return layouts;
}

function computeRowMinHeight(
  days: Date[],
  bookings: Booking[],
  barBaseTop: number,
  minHeight: number
) {
  const layouts = computeBookingLayouts(days, bookings);
  const laneCount = Math.max(1, ...layouts.map((item) => item.lane + 1));
  return Math.max(minHeight, barBaseTop + laneCount * bookingLaneHeight + 10);
}

function useIsMobile() {
  const [isMobile, setIsMobile] = useState(() =>
    typeof window === 'undefined' ? false : window.innerWidth < 1024
  );
  useEffect(() => {
    const handler = () => setIsMobile(window.innerWidth < 1024);
    window.addEventListener('resize', handler);
    return () => window.removeEventListener('resize', handler);
  }, []);
  return isMobile;
}

export function TimelinePage() {
  const queryClient = useQueryClient();
  const role = getMockRole();
  const [viewMode, setViewMode] = useState<'week' | 'month'>('week');
  const [anchorDate, setAnchorDate] = useState(initialWeek);
  const [baFilter, setBaFilter] = useState('');
  const [projectFilter, setProjectFilter] = useState('');
  const [selectedBooking, setSelectedBooking] = useState<Booking | null>(null);
  const [draft, setDraft] = useState<RequestDraft | null>(null);
  const [successMessage, setSuccessMessage] = useState('');
  const [compactMobileInfo, setCompactMobileInfo] = useState(false);
  const timelineScrollRef = useRef<HTMLDivElement>(null);
  const canCreateBooking = role !== 'BA';
  const isMobile = useIsMobile();
  const currentDate = useMemo(() => new Date(), []);

  useEffect(() => {
    if (!isMobile) {
      setCompactMobileInfo(false);
    }
  }, [isMobile]);

  const days = useMemo(() => {
    if (viewMode === 'month') {
      const start = startOfMonth(anchorDate);
      return eachDayOfInterval({ start, end: endOfMonth(start) });
    }

    return eachDayOfInterval({ start: anchorDate, end: addDays(anchorDate, 6) });
  }, [anchorDate, viewMode]);

  const bas = useQuery({
    queryKey: ['ba-directory', role],
    queryFn: () => apiFetch<BAProfile[]>('/api/ba')
  });
  const bookableBas = useQuery({
    queryKey: ['bookable-bas', role],
    queryFn: () => apiFetch<BAProfile[]>('/api/ba?bookable=true')
  });
  const projects = useQuery({
    queryKey: ['projects'],
    queryFn: () => apiFetch<Project[]>('/api/projects')
  });
  const bookings = useQuery({
    queryKey: ['bookings', role],
    queryFn: () => apiFetch<Booking[]>('/api/bookings')
  });
  const summary = useQuery({
    queryKey: ['capacity-summary', role],
    queryFn: () => apiFetch<{ average_capacity: number; counts: Record<string, number>; items: Array<{ ba_id: string; approved_capacity: number; risk_capacity: number }> }>('/api/capacity/summary')
  });

  const visibleBas = (bas.data ?? []).filter((ba) => !baFilter || ba.id === baFilter);
  const visibleBookings = (bookings.data ?? []).filter(
    (booking) => !projectFilter || booking.project_id === projectFilter
  );
  const rowData = useMemo(
    () =>
      visibleBas.map((ba) => {
        const baBookings = visibleBookings.filter((booking) => booking.ba_id === ba.id);
        return {
          ba,
          bookings: baBookings,
          desktopRowMinHeight: computeRowMinHeight(days, baBookings, desktopBarBaseTop, 72),
          mobileRowMinHeight: computeRowMinHeight(days, baBookings, mobileBarBaseTop, 120)
        };
      }),
    [days, visibleBas, visibleBookings]
  );

  const move = (direction: number) =>
    setAnchorDate((current) =>
      viewMode === 'week' ? addDays(current, direction * 7) : addMonths(current, direction)
    );

  function handleTimelineScroll() {
    if (!isMobile) return;
    const nextScrollLeft = timelineScrollRef.current?.scrollLeft ?? 0;
    const nextCompact = nextScrollLeft > mobileCompactScrollThreshold;
    setCompactMobileInfo((current) => (current === nextCompact ? current : nextCompact));
  }

  return (
    <div className="grid gap-5">
      {successMessage ? (
        <div className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm font-medium text-emerald-800">
          {successMessage}
        </div>
      ) : null}
      {bas.isLoading || bookings.isLoading ? (
        <Card><CardContent className="p-5 text-sm text-slate-600">Loading timeline...</CardContent></Card>
      ) : null}
      {bas.error || bookings.error || projects.error || summary.error ? (
        <Card><CardContent className="p-5 text-sm text-rose-700">Could not load timeline data. Check API connection and retry.</CardContent></Card>
      ) : null}
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
        <Card className="overflow-hidden">
          <CardHeader className="border-b border-slate-200">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <p className="text-xs font-bold uppercase text-blue-700">1. Resource Timeline</p>
                <CardTitle>Gantt-style BA workload</CardTitle>
              </div>
              <div className="flex flex-wrap gap-2">
                <select
                  value={baFilter}
                  onChange={(event) => setBaFilter(event.target.value)}
                  className="h-9 rounded-md border px-2 text-sm"
                >
                  <option value="">All BA</option>
                  {(bas.data ?? []).map((ba) => (
                    <option key={ba.id} value={ba.id}>
                      {ba.full_name}
                    </option>
                  ))}
                </select>
                <select
                  value={projectFilter}
                  onChange={(event) => setProjectFilter(event.target.value)}
                  className="h-9 rounded-md border px-2 text-sm"
                >
                  <option value="">All Projects</option>
                  {(projects.data ?? []).map((project) => (
                    <option key={project.id} value={project.id}>
                      {project.name}
                    </option>
                  ))}
                </select>
                <select
                  value={viewMode}
                  onChange={(event) => setViewMode(event.target.value as 'week' | 'month')}
                  className="h-9 rounded-md border px-2 text-sm"
                >
                  <option value="week">Week</option>
                  <option value="month">Month</option>
                </select>
                <Button variant="secondary" size="icon" onClick={() => move(-1)}>
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <Button variant="secondary" onClick={() => setAnchorDate(initialWeek)}>
                  Today
                </Button>
                <Button variant="secondary" size="icon" onClick={() => move(1)}>
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent className="relative p-0">
            <div ref={timelineScrollRef} className="overflow-x-auto" onScroll={handleTimelineScroll}>
              <div
                className={cn('grid', !isMobile && 'min-w-[980px]')}
                style={{
                  gridTemplateColumns: isMobile
                    ? `repeat(${days.length}, minmax(${mobileDayMinWidth}px, 1fr))`
                    : `${baInfoColumnWidth}px repeat(${days.length}, minmax(92px, 1fr))`
                }}
              >
                {!isMobile && (
                  <>
                    <div className="h-14 border-b border-r bg-white" aria-hidden="true" />
                    {days.map((day) => (
                      <div
                        key={day.toISOString()}
                        className={cn(
                          'grid h-14 place-items-center border-b border-r bg-white p-3 text-center text-xs font-semibold text-slate-600',
                          isSameDay(day, currentDate) && 'bg-blue-50 text-blue-700 ring-1 ring-inset ring-blue-300'
                        )}
                      >
                        <div>
                          <div>{format(day, 'EEE')}</div>
                          <div>{format(day, 'dd/MM')}</div>
                        </div>
                      </div>
                    ))}
                  </>
                )}
                {isMobile &&
                  days.map((day) => (
                    <div
                      key={day.toISOString()}
                      className={cn(
                        'grid h-12 place-items-center border-b border-r bg-white p-2 text-center text-xs font-semibold text-slate-600',
                        isSameDay(day, currentDate) && 'bg-blue-50 text-blue-700 ring-1 ring-inset ring-blue-300'
                      )}
                    >
                      <div>
                        <div>{format(day, 'EEE')}</div>
                        <div>{format(day, 'dd/MM')}</div>
                      </div>
                    </div>
                  ))}
                {rowData.map(({ ba, bookings: baBookings, desktopRowMinHeight, mobileRowMinHeight }, index) => {
                  const isAlternateRow = index % 2 === 1;

                  return isMobile ? (
                    <MobileTimelineRow
                      key={ba.id}
                      ba={ba}
                      days={days}
                      bookings={baBookings}
                      rowMinHeight={mobileRowMinHeight}
                      isAlternateRow={isAlternateRow}
                      canCreateBooking={canCreateBooking}
                      onEmptyClick={(date) =>
                        setDraft({
                          ba_id: ba.id,
                          start_date: format(date, 'yyyy-MM-dd'),
                          end_date: format(date, 'yyyy-MM-dd'),
                          direct: false
                        })
                      }
                      onBookingClick={setSelectedBooking}
                    />
                  ) : (
                    <TimelineRow
                      key={ba.id}
                      ba={ba}
                      days={days}
                      bookings={baBookings}
                      rowMinHeight={desktopRowMinHeight}
                      isAlternateRow={isAlternateRow}
                      canCreateBooking={canCreateBooking}
                      onEmptyClick={(date) =>
                        setDraft({
                          ba_id: ba.id,
                          start_date: format(date, 'yyyy-MM-dd'),
                          end_date: format(date, 'yyyy-MM-dd'),
                          direct: false
                        })
                      }
                      onBookingClick={setSelectedBooking}
                    />
                  );
                })}
              </div>
            </div>
            {isMobile ? (
              <div className="pointer-events-none absolute left-0 top-12 z-20">
                {(() => {
                  let topOffset = 0;
                  return rowData.map(({ ba, mobileRowMinHeight }) => {
                  const capacity = summary.data?.items.find((item) => item.ba_id === ba.id);
                  const rowTop = topOffset;
                  topOffset += mobileRowMinHeight;

                  return (
                    <div
                      key={ba.id}
                      className="pointer-events-auto absolute left-0 flex h-12 max-w-[calc(100vw-2rem)] items-center gap-2 px-2"
                      style={{ top: rowTop, width: baInfoColumnWidth }}
                      onClick={(event) => event.stopPropagation()}
                      onPointerDown={(event) => event.stopPropagation()}
                    >
                      <MobileBAIdentity ba={ba} compact={compactMobileInfo} />
                      <span
                        className={cn(
                          'shrink-0 overflow-hidden text-xs font-bold transition-all duration-200 ease-out',
                          capacityColor(capacity?.risk_capacity ?? 0),
                          compactMobileInfo
                            ? 'max-w-0 -translate-x-2 opacity-0'
                            : 'max-w-12 translate-x-0 opacity-100'
                        )}
                      >
                        {capacity?.risk_capacity ?? 0}%
                      </span>
                    </div>
                  );
                });
                })()}
              </div>
            ) : (
              <div className="pointer-events-none absolute left-0 top-0 z-20 hidden lg:block">
                <div className="h-14 w-[260px] border-b border-r bg-white p-3 text-xs font-bold uppercase text-slate-500">
                  BA
                </div>
                {rowData.map(({ ba, desktopRowMinHeight }, index) => {
                  const capacity = summary.data?.items.find((item) => item.ba_id === ba.id);
                  const isAlternateRow = index % 2 === 1;

                  return (
                    <div
                      key={ba.id}
                      className={cn(
                        'pointer-events-auto flex w-[260px] items-center justify-between border-b border-r p-2 lg:p-3',
                        isAlternateRow ? 'bg-sky-50' : 'bg-white'
                      )}
                      style={{ height: desktopRowMinHeight }}
                      onClick={(event) => event.stopPropagation()}
                      onPointerDown={(event) => event.stopPropagation()}
                    >
                      <BAIdentity ba={ba} />
                      <span className={cn('text-sm font-bold', capacityColor(capacity?.risk_capacity ?? 0))}>
                        {capacity?.risk_capacity ?? 0}%
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        <aside className="grid gap-4">
          <CapacitySummary summary={summary.data} />
          <Card>
            <CardHeader>
              <CardTitle className="text-sm uppercase">Legend</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-2 text-sm">
              <div className="flex items-center gap-2">
                <span className="h-4 w-9 rounded bg-blue-600" /> Approved/In progress
              </div>
              <div className="flex items-center gap-2">
                <span className="h-4 w-9 rounded border border-dashed border-amber-400 bg-amber-100" /> Pending
              </div>
              <div className="flex items-center gap-2">
                <span className="h-4 w-9 rounded border border-gray-300 bg-gray-200" /> Rejected
              </div>
              <div className="flex items-center gap-2">
                <span className="h-4 w-9 rounded border border-dashed bg-slate-50" /> Available
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-sm uppercase">Capacity Rules</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-2 text-sm text-slate-600">
              <p>Approved capacity cannot exceed 100% for overlapping dates.</p>
              <p>Pending requests are allowed but counted as overbook risk.</p>
              <p>BA Manager decides approve/reject.</p>
            </CardContent>
          </Card>
        </aside>
      </div>

      <WorkflowBand />

      <CreateBookingModal
        draft={draft}
        role={role}
        bas={bookableBas.data ?? []}
        projects={projects.data ?? []}
        onClose={() => setDraft(null)}
        onDone={() => {
          setDraft(null);
          setSuccessMessage('Booking request submitted.');
          void queryClient.invalidateQueries();
        }}
      />
      <BookingDetailModal
        booking={selectedBooking}
        onClose={() => setSelectedBooking(null)}
        onDone={() => {
          setSelectedBooking(null);
          void queryClient.invalidateQueries();
        }}
      />
    </div>
  );
}

function TimelineRow({
  ba,
  days,
  bookings,
  rowMinHeight,
  isAlternateRow,
  canCreateBooking,
  onEmptyClick,
  onBookingClick
}: {
  ba: BAProfile;
  days: Date[];
  bookings: Booking[];
  rowMinHeight: number;
  isAlternateRow: boolean;
  canCreateBooking: boolean;
  onEmptyClick: (date: Date) => void;
  onBookingClick: (booking: Booking) => void;
}) {
  const layouts = computeBookingLayouts(days, bookings);

  return (
    <>
      <div
        className={cn(
          'border-b border-r',
          isAlternateRow ? 'bg-sky-50' : 'bg-white'
        )}
        style={{ height: rowMinHeight }}
        aria-hidden="true"
      />
      <div className="relative col-span-full hidden" />
      {days.map((day) => (
        <button
          key={`${ba.id}-${day.toISOString()}`}
          className={cn(
            'group border-b border-r p-1 text-left text-xs text-slate-400',
            dayCellBackground(isAlternateRow),
            canCreateBooking ? 'hover:bg-blue-50' : 'cursor-default'
          )}
          style={{ minHeight: rowMinHeight }}
          onClick={() => {
            if (canCreateBooking) onEmptyClick(day);
          }}
          aria-label={canCreateBooking ? 'Create booking request' : 'Available slot'}
        >
          {canCreateBooking ? (
            <Plus className="mt-5 h-4 w-4 opacity-0 transition group-hover:opacity-100" />
          ) : null}
        </button>
      ))}
      <div
        className="pointer-events-none relative grid"
        style={{ gridColumn: `2 / span ${days.length}` }}
      >
        <div className="relative" style={{ minHeight: rowMinHeight, marginTop: -rowMinHeight }}>
          {layouts.map(({ booking, left, span, lane }) => {
            return (
              <button
                key={booking.id}
                className={cn(
                  'pointer-events-auto absolute h-8 truncate rounded-md px-2 text-left text-xs font-semibold shadow-sm transition hover:-translate-y-0.5',
                  bookingBarClass(booking.status)
                )}
                style={{
                  left: `${(left / days.length) * 100}%`,
                  width: `calc(${(span / days.length) * 100}% - 8px)`,
                  top: `${desktopBarBaseTop + lane * bookingLaneHeight}px`
                }}
                onClick={() => onBookingClick(booking)}
                aria-label={`${booking.status} booking ${booking.title}`}
              >
                {booking.project.name} · {booking.capacity_percent}%
              </button>
            );
          })}
        </div>
      </div>
    </>
  );
}

function MobileTimelineRow({
  ba,
  days,
  bookings,
  rowMinHeight,
  isAlternateRow,
  canCreateBooking,
  onEmptyClick,
  onBookingClick
}: {
  ba: BAProfile;
  days: Date[];
  bookings: Booking[];
  rowMinHeight: number;
  isAlternateRow: boolean;
  canCreateBooking: boolean;
  onEmptyClick: (date: Date) => void;
  onBookingClick: (booking: Booking) => void;
}) {
  const layouts = computeBookingLayouts(days, bookings);

  return (
    <>
      {days.map((day) => (
        <button
          key={`${ba.id}-${day.toISOString()}`}
          className={cn(
            'group border-b border-r border-slate-200 p-1 pt-12 text-left text-xs text-slate-400',
            dayCellBackground(isAlternateRow),
            canCreateBooking ? 'hover:bg-blue-50' : 'cursor-default'
          )}
          style={{ minHeight: rowMinHeight }}
          onClick={() => {
            if (canCreateBooking) onEmptyClick(day);
          }}
          aria-label={canCreateBooking ? 'Create booking request' : 'Available slot'}
        >
          {canCreateBooking ? (
            <Plus className="mt-5 h-4 w-4 opacity-0 transition group-hover:opacity-100" />
          ) : null}
        </button>
      ))}
      <div
        className="pointer-events-none relative grid"
        style={{ gridColumn: `1 / span ${days.length}` }}
      >
        <div className="relative" style={{ minHeight: rowMinHeight, marginTop: -rowMinHeight }}>
          {layouts.map(({ booking, left, span, lane }) => {
            return (
              <button
                key={booking.id}
                className={cn(
                  'pointer-events-auto absolute h-8 truncate rounded-md px-2 text-left text-xs font-semibold shadow-sm transition hover:-translate-y-0.5',
                  bookingBarClass(booking.status)
                )}
                style={{
                  left: `${(left / days.length) * 100}%`,
                  width: `calc(${(span / days.length) * 100}% - 8px)`,
                  top: `${mobileBarBaseTop + lane * bookingLaneHeight}px`
                }}
                onClick={() => onBookingClick(booking)}
                aria-label={`${booking.status} booking ${booking.title}`}
              >
                {booking.project.name} · {booking.capacity_percent}%
              </button>
            );
          })}
        </div>
      </div>
    </>
  );
}

function MobileBAIdentity({ ba, compact }: { ba: BAProfile; compact: boolean }) {
  const initials = ba.full_name
    .split(' ')
    .map((part) => part[0])
    .slice(0, 2)
    .join('');

  return (
    <div className="flex min-w-0 items-center gap-2 text-xs">
      <span
        className={cn(
          'block shrink-0 overflow-hidden transition-all duration-200 ease-out',
          compact ? 'w-0 -translate-x-2 opacity-0' : 'w-7 translate-x-0 opacity-100'
        )}
      >
        {ba.avatar_url ? (
          <img src={ba.avatar_url} alt="" className="h-7 w-7 rounded-full" />
        ) : (
          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-blue-100 text-[11px] font-bold text-blue-700">
            {initials}
          </span>
        )}
      </span>
      <span className="truncate font-semibold text-slate-950">{ba.full_name}</span>
      <span
        className={cn(
          'shrink-0 overflow-hidden text-slate-500 transition-all duration-200 ease-out',
          compact ? 'max-w-0 translate-x-2 opacity-0' : 'max-w-20 translate-x-0 opacity-100'
        )}
      >
        - {ba.level}
      </span>
    </div>
  );
}

function CapacitySummary({
  summary
}: {
  summary?: { average_capacity: number; counts: Record<string, number> };
}) {
  const average = summary?.average_capacity ?? 0;
  const circumference = 2 * Math.PI * 42;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm uppercase">Capacity Summary</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-4">
        <div className="mx-auto grid h-28 w-28 place-items-center">
          <svg viewBox="0 0 100 100" className="h-28 w-28 -rotate-90">
            <circle cx="50" cy="50" r="42" fill="none" stroke="#e2e8f0" strokeWidth="10" />
            <circle
              cx="50"
              cy="50"
              r="42"
              fill="none"
              stroke="#2563eb"
              strokeWidth="10"
              strokeDasharray={circumference}
              strokeDashoffset={circumference - (Math.min(average, 100) / 100) * circumference}
              strokeLinecap="round"
            />
          </svg>
          <div className="absolute text-center">
            <p className="text-2xl font-bold text-slate-950">{average}%</p>
            <p className="text-xs text-slate-500">Average</p>
          </div>
        </div>
        {[
          ['0-40%', 'Free', summary?.counts.free ?? 0, 'bg-emerald-500'],
          ['40-80%', 'Working', summary?.counts.working ?? 0, 'bg-amber-500'],
          ['80-100%', 'Near full', summary?.counts.near_full ?? 0, 'bg-orange-500'],
          ['>100%', 'Overbook', summary?.counts.overbook ?? 0, 'bg-rose-500']
        ].map(([range, label, count, color]) => (
          <div key={range} className="flex items-center justify-between text-sm">
            <span className="flex items-center gap-2">
              <span className={cn('h-2.5 w-2.5 rounded-full', color as string)} />
              {range} · {label}
            </span>
            <strong>{count} BA</strong>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function CreateBookingModal({
  draft,
  role,
  bas,
  projects,
  onClose,
  onDone
}: {
  draft: RequestDraft | null;
  role: string;
  bas: BAProfile[];
  projects: Project[];
  onClose: () => void;
  onDone: () => void;
}) {
  const [range, setRange] = useState<RequestDraft | null>(draft);
  const [form, setForm] = useState({
    project_id: '',
    title: '',
    description: '',
    notes: '',
    capacity_percent: 50,
    priority: 'MEDIUM' as BookingPriority
  });
  const [localError, setLocalError] = useState('');
  useEffect(() => {
    setRange(draft);
    setLocalError('');
  }, [draft]);
  const capacityCheck = useQuery({
    queryKey: [
      'capacity-range-check',
      range?.ba_id,
      range?.start_date,
      range?.end_date,
      form.capacity_percent
    ],
    queryFn: () =>
      apiFetch<RangeCheck>(
        `/api/capacity/range-check?ba_id=${encodeURIComponent(range?.ba_id ?? '')}&start_date=${range?.start_date}&end_date=${range?.end_date}&capacity_percent=${form.capacity_percent}`
      ),
    enabled: Boolean(range?.ba_id && range.start_date && range.end_date)
  });
  const mutation = useMutation({
    mutationFn: () =>
      apiFetch(range?.direct ? '/api/bookings/direct' : '/api/bookings/request', {
        method: 'POST',
        body: JSON.stringify({
          ...range,
          ...form
        })
      }),
    onSuccess: onDone
  });

  if (!range) return null;

  return (
    <Modal title="Create Booking Request" open={Boolean(draft)} onClose={onClose}>
      <form
        className="grid gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          if (range.end_date < range.start_date) {
            setLocalError('End date must be greater than or equal to start date.');
            return;
          }
          setLocalError('');
          mutation.mutate();
        }}
      >
        <Field label="BA">
          <select
            value={range.ba_id}
            onChange={(event) =>
              setRange({ ...range, ba_id: event.target.value })
            }
            className="h-10 rounded-md border px-3"
          >
            {bas.map((ba) => (
              <option key={ba.id} value={ba.id}>
                {ba.full_name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Project">
          <select
            value={form.project_id}
            onChange={(event) => setForm({ ...form, project_id: event.target.value })}
            className="h-10 rounded-md border px-3"
            required
          >
            <option value="">Select project</option>
            {projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </select>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Start date">
            <input
              type="date"
              value={range.start_date}
              onChange={(event) => setRange({ ...range, start_date: event.target.value })}
              className="h-10 rounded-md border px-3"
              required
            />
          </Field>
          <Field label="End date">
            <input
              type="date"
              value={range.end_date}
              onChange={(event) => setRange({ ...range, end_date: event.target.value })}
              className="h-10 rounded-md border px-3"
              required
            />
          </Field>
        </div>
        <Field label="Title">
          <input
            value={form.title}
            onChange={(event) => setForm({ ...form, title: event.target.value })}
            className="h-10 rounded-md border px-3"
            required
          />
        </Field>
        <Field label="Description">
          <textarea
            value={form.description}
            onChange={(event) => setForm({ ...form, description: event.target.value })}
            className="min-h-24 rounded-md border p-3"
            required
          />
        </Field>
        <Field label="Ghi chú thêm / Notes">
          <textarea
            value={form.notes}
            onChange={(event) => setForm({ ...form, notes: event.target.value })}
            className="min-h-20 rounded-md border p-3"
          />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Capacity">
            <select
              value={form.capacity_percent}
              onChange={(event) => setForm({ ...form, capacity_percent: Number(event.target.value) })}
              className="h-10 rounded-md border px-3"
            >
              <option value={50}>50%</option>
              <option value={100}>100%</option>
            </select>
          </Field>
          <Field label="Priority">
            <select
              value={form.priority}
              onChange={(event) => setForm({ ...form, priority: event.target.value as BookingPriority })}
              className="h-10 rounded-md border px-3"
            >
              <option value="LOW">Low</option>
              <option value="MEDIUM">Medium</option>
              <option value="HIGH">High</option>
              <option value="URGENT">Urgent</option>
            </select>
          </Field>
        </div>
        {role === 'BA_MANAGER' ? (
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={range.direct}
              onChange={(event) => setRange({ ...range, direct: event.target.checked })}
            />
            Create direct approved booking
          </label>
        ) : null}
        {capacityCheck.data?.has_overbook_risk_after_request ? (
          <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
            Overbook risk: selected range may exceed 100% capacity when pending requests are included.
          </div>
        ) : null}
        {localError ? (
          <div className="rounded-md bg-rose-50 p-3 text-sm text-rose-700">
            {localError}
          </div>
        ) : null}
        {mutation.error ? (
          <div className="rounded-md bg-rose-50 p-3 text-sm text-rose-700">
            {mutation.error.message}
          </div>
        ) : null}
        <Button type="submit">{mutation.isPending ? 'Submitting...' : 'Submit Request'}</Button>
      </form>
    </Modal>
  );
}

function BookingDetailModal({
  booking,
  onClose,
  onDone
}: {
  booking: Booking | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const role = getMockRole();
  const approve = useMutation({
    mutationFn: () => apiFetch(`/api/bookings/${booking?.id}/approve`, { method: 'POST' }),
    onSuccess: onDone
  });
  const reject = useMutation({
    mutationFn: (reason: string) =>
      apiFetch(`/api/bookings/${booking?.id}/reject`, {
        method: 'POST',
        body: JSON.stringify({ reject_reason: reason })
      }),
    onSuccess: onDone
  });
  const cancel = useMutation({
    mutationFn: (reason: string) =>
      apiFetch(`/api/bookings/${booking?.id}/cancel`, {
        method: 'POST',
        body: JSON.stringify({ cancel_reason: reason })
      }),
    onSuccess: onDone
  });

  if (!booking) return null;

  return (
    <Modal title="Booking Detail" open={Boolean(booking)} onClose={onClose}>
      <div className="grid gap-4 text-sm">
        <div className="flex items-center justify-between gap-3">
          <BAIdentity ba={booking.ba} />
          <StatusBadge status={booking.status} />
        </div>
        <div className="rounded-md border p-4">
          <h3 className="font-semibold text-slate-950">{booking.title}</h3>
          <p className="mt-1 text-slate-600">{booking.description}</p>
          <div className="mt-3 grid gap-2 text-slate-600">
            <p>Project: {booking.project.name}</p>
            <p>
              Date: {formatDate(booking.start_date)} - {formatDate(booking.end_date)}
            </p>
            <p>Capacity: {booking.capacity_percent}%</p>
            <p>Requester: {booking.requester.full_name}</p>
            {booking.notes ? <p>Notes: {booking.notes}</p> : null}
            {booking.reject_reason ? <p>Reject reason: {booking.reject_reason}</p> : null}
            {booking.cancel_reason ? <p>Cancel reason: {booking.cancel_reason}</p> : null}
          </div>
        </div>
        {role === 'BA_MANAGER' && booking.status === 'PENDING' ? (
          <div className="flex gap-2">
            <Button onClick={() => approve.mutate()}>Approve</Button>
            <Button
              variant="secondary"
              onClick={() => {
                const reason = window.prompt('Reject reason');
                if (reason) reject.mutate(reason);
              }}
            >
              Reject
            </Button>
          </div>
        ) : null}
        {role === 'BA_MANAGER' &&
        (booking.status === 'APPROVED' || booking.status === 'IN_PROGRESS') ? (
          <div className="flex gap-2">
            <Button
              variant="secondary"
              onClick={() => {
                const reason = window.prompt('Cancel reason');
                if (reason) cancel.mutate(reason);
              }}
            >
              Cancel booking
            </Button>
          </div>
        ) : null}
        {approve.error || reject.error || cancel.error ? (
          <div className="rounded-md bg-rose-50 p-3 text-rose-700">
            {(approve.error ?? reject.error ?? cancel.error)?.message}
          </div>
        ) : null}
      </div>
    </Modal>
  );
}

function WorkflowBand() {
  return (
    <Card>
      <CardContent className="grid gap-3 p-5 md:grid-cols-4">
        {[
          ['1', 'PM/PO creates request', 'bg-blue-50 border-blue-100'],
          ['2', 'Request pending', 'bg-amber-50 border-amber-100'],
          ['3', 'Manager approves/rejects', 'bg-violet-50 border-violet-100'],
          ['4', 'Schedule and notifications update', 'bg-emerald-50 border-emerald-100']
        ].map(([step, label, className]) => (
          <div key={step} className={cn('rounded-md border p-4', className)}>
            <Badge tone="info">Step {step}</Badge>
            <p className="mt-3 text-sm font-semibold text-slate-800">{label}</p>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
