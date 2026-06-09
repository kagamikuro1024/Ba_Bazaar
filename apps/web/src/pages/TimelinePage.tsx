import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent,
  type WheelEvent
} from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import {
  addDays,
  addMonths,
  differenceInCalendarDays,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isSameDay,
  parseISO,
  startOfMonth,
  startOfQuarter,
  startOfWeek,
} from 'date-fns';
import { AlertTriangle, ChevronDown, ChevronLeft, ChevronRight, Plus } from 'lucide-react';
import { useAuth } from '@/auth/AuthProvider';
import { apiFetch, type BAProfile, type Booking, type Project } from '@/lib/api';
import { CAPACITY_OPTIONS, parseCapacityPercent } from '@/lib/capacity';
import { BAIdentity, StatusBadge } from '@/components/common';
import { BookingModal } from '@/components/BookingModal';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Modal } from '@/components/ui/modal';
import { LoadingScreen } from '@/components/ui/loading-screen';
import { capacityColor, formatDate } from '@/lib/format';
import { cn } from '@/lib/utils';

type RequestDraft = {
  ba_id: string;
  start_date: string;
  end_date: string;
  direct: boolean;
  project_id?: string;
};

type DraftSelection = {
  ba_id: string;
  start: Date;
  end: Date;
};

type ActiveDraftSelection = DraftSelection & {
  pointerId: number;
};

type DragScrollState = {
  pointerId: number;
  startX: number;
  startScrollLeft: number;
};

type CapacityDetail = {
  ba_id: string;
  daily: Array<{
    date: string;
    approved_capacity: number;
    pending_capacity: number;
    risk_capacity: number;
  }>;
  max_approved_capacity: number;
  max_pending_capacity: number;
  max_risk_capacity: number;
  has_overbook_risk: boolean;
};

type TimelineViewMode = 'week' | 'month' | 'quarter';

type TimelineColumn = {
  id: string;
  label: string;
  subLabel: string;
  start: Date;
  end: Date;
};

function usePrefersCoarsePointer() {
  const [isCoarsePointer, setIsCoarsePointer] = useState(() =>
    typeof window === 'undefined'
      ? false
      : window.matchMedia('(pointer: coarse)').matches
  );

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    const mediaQuery = window.matchMedia('(pointer: coarse)');
    const handleChange = () => setIsCoarsePointer(mediaQuery.matches);
    handleChange();

    mediaQuery.addEventListener('change', handleChange);
    return () => mediaQuery.removeEventListener('change', handleChange);
  }, []);

  return isCoarsePointer;
}

const initialWeek = startOfWeek(new Date(), { weekStartsOn: 1 });
const baInfoColumnWidth = 260;
const mobileDayMinWidth = 70;
const mobileCompactScrollThreshold = mobileDayMinWidth * 3;
const bookingLaneHeight = 36;
const desktopBarBaseTop = 16;
const mobileBarBaseTop = 58;
const timelineViewModeStorageKey = 'ba-bazaar-timeline-view-mode';

function dayCellBackground(isAlternateRow: boolean) {
  return isAlternateRow
    ? 'bg-[repeating-linear-gradient(-45deg,#eff6ff,#eff6ff_6px,#dbeafe_6px,#dbeafe_12px)]'
    : 'bg-[repeating-linear-gradient(-45deg,#f8fafc,#f8fafc_6px,#eef2f7_6px,#eef2f7_12px)]';
}

function bookingBarClass(status: Booking['status'], hasOverbookRisk = false) {
  if (hasOverbookRisk && (status === 'APPROVED' || status === 'IN_PROGRESS' || status === 'PENDING')) {
    return 'border border-rose-500 bg-rose-600 text-white shadow-rose-200';
  }

  switch (status) {
    case 'PENDING':
      return 'border border-dashed border-amber-400 bg-amber-100 text-amber-800';
    case 'COMPLETED':
      return 'border border-emerald-200 bg-emerald-100/90 text-emerald-800';
    case 'CANCELLED':
      return 'border border-rose-200 bg-rose-100/80 text-rose-700';
    case 'REJECTED':
      return 'border border-gray-300 bg-gray-100 text-gray-700 opacity-80';
    default:
      return 'bg-blue-600 text-white';
  }
}

type BookingLayout = {
  booking: Booking;
  leftPercent: number;
  widthPercent: number;
  lane: number;
};

function computeBookingLayouts(columns: TimelineColumn[], bookings: Booking[]): BookingLayout[] {
  if (columns.length === 0) return [];
  const first = columns[0].start;
  const last = columns[columns.length - 1].end;

  const visible = bookings
    .map((booking) => {
      const rawStart = parseISO(booking.start_date);
      const rawEnd = parseISO(booking.end_date);
      const start = rawStart < first ? first : rawStart;
      const end = rawEnd > last ? last : rawEnd;
      if (end < first || start > last) return null;
      return { booking, start, end };
    })
    .filter(
      (item): item is {
        booking: Booking;
        start: Date;
        end: Date;
      } => item !== null
    )
    .sort((a, b) => {
      const byStart = a.start.getTime() - b.start.getTime();
      if (byStart !== 0) return byStart;
      return a.end.getTime() - b.end.getTime();
    });

  const laneEndDays: number[] = [];
  const layouts: BookingLayout[] = [];
  const totalDays = differenceInCalendarDays(last, first) + 1;

  for (const item of visible) {
    const leftDay = differenceInCalendarDays(item.start, first);
    const visibleDays = differenceInCalendarDays(item.end, item.start) + 1;
    const endDay = leftDay + visibleDays - 1;
    const leftPercent = (leftDay / totalDays) * 100;
    const widthPercent = (visibleDays / totalDays) * 100;

    let lane = laneEndDays.findIndex((laneEnd) => laneEnd < leftDay);
    if (lane === -1) {
      lane = laneEndDays.length;
      laneEndDays.push(endDay);
    } else {
      laneEndDays[lane] = endDay;
    }

    layouts.push({ booking: item.booking, leftPercent, widthPercent, lane });
  }

  return layouts;
}

function computeRowMinHeight(
  columns: TimelineColumn[],
  bookings: Booking[],
  barBaseTop: number,
  minHeight: number
) {
  const layouts = computeBookingLayouts(columns, bookings);
  const laneCount = Math.max(1, ...layouts.map((item) => item.lane + 1));
  return Math.max(minHeight, barBaseTop + laneCount * bookingLaneHeight + 10);
}

function buildTimelineColumns(viewMode: TimelineViewMode, anchorDate: Date): TimelineColumn[] {
  if (viewMode === 'month') {
    const start = startOfMonth(anchorDate);
    const end = endOfMonth(start);
    const columns: TimelineColumn[] = [];
    let cursor = startOfWeek(start, { weekStartsOn: 1 });
    let weekIndex = 1;

    while (cursor <= end) {
      const weekStart = cursor < start ? start : cursor;
      const weekEnd = endOfWeek(cursor, { weekStartsOn: 1 }) > end
        ? end
        : endOfWeek(cursor, { weekStartsOn: 1 });
      columns.push({
        id: `week-${weekIndex}-${format(weekStart, 'yyyy-MM-dd')}`,
        label: `Week ${weekIndex}`,
        subLabel: `${format(weekStart, 'dd/MM')} - ${format(weekEnd, 'dd/MM')}`,
        start: weekStart,
        end: weekEnd
      });
      cursor = addDays(endOfWeek(cursor, { weekStartsOn: 1 }), 1);
      weekIndex += 1;
    }

    return columns;
  }

  if (viewMode === 'quarter') {
    const start = startOfQuarter(anchorDate);
    return [0, 1, 2].map((offset) => {
      const monthStart = addMonths(start, offset);
      const monthEnd = endOfMonth(monthStart);
      return {
        id: `month-${format(monthStart, 'yyyy-MM')}`,
        label: format(monthStart, 'MMM'),
        subLabel: format(monthStart, 'yyyy'),
        start: monthStart,
        end: monthEnd
      };
    });
  }

  return eachDayOfInterval({ start: anchorDate, end: addDays(anchorDate, 6) }).map((day) => ({
    id: format(day, 'yyyy-MM-dd'),
    label: format(day, 'EEE'),
    subLabel: format(day, 'dd/MM'),
    start: day,
    end: day
  }));
}

function sortSelectionRange(selection: DraftSelection) {
  return selection.start <= selection.end
    ? { start: selection.start, end: selection.end }
    : { start: selection.end, end: selection.start };
}

function isTextSelectionTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  if (target.closest('[data-allow-scroll-drag="true"]')) {
    return false;
  }

  return Boolean(target.closest('button, a, input, select, textarea'));
}

function selectionToDraft(selection: DraftSelection): RequestDraft {
  const { start, end } = sortSelectionRange(selection);
  return {
    ba_id: selection.ba_id,
    start_date: format(start, 'yyyy-MM-dd'),
    end_date: format(end, 'yyyy-MM-dd'),
    direct: false
  };
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
  const { user } = useAuth();
  const [searchParams] = useSearchParams();
  const role = user?.role ?? 'BA';
  const [viewMode, setViewMode] = useState<TimelineViewMode>(() => {
    if (typeof window === 'undefined') {
      return 'week';
    }

    const stored = window.localStorage.getItem(timelineViewModeStorageKey);
    return stored === 'month' || stored === 'quarter' ? stored : 'week';
  });
  const [anchorDate, setAnchorDate] = useState(initialWeek);
  const [baFilter, setBaFilter] = useState(() => searchParams.get('baId') ?? '');
  const [projectFilter, setProjectFilter] = useState('');
  const [selectedBooking, setSelectedBooking] = useState<Booking | null>(null);
  const [draft, setDraft] = useState<RequestDraft | null>(null);
  const [activeSelection, setActiveSelection] = useState<ActiveDraftSelection | null>(
    null
  );
  const [successMessage, setSuccessMessage] = useState('');
  const [compactMobileInfo, setCompactMobileInfo] = useState(false);
  const [dragScroll, setDragScroll] = useState<DragScrollState | null>(null);
  const [legendCollapsed, setLegendCollapsed] = useState(false);
  const timelineScrollRef = useRef<HTMLDivElement>(null);
  const canCreateBooking = role === 'PM_PO' || role === 'BA_MANAGER';
  const isMobile = useIsMobile();
  const prefersCoarsePointer = usePrefersCoarsePointer();
  const allowDragSelection = canCreateBooking && !prefersCoarsePointer && viewMode === 'week';
  const currentDate = useMemo(() => new Date(), []);

  useEffect(() => {
    if (!isMobile) {
      setCompactMobileInfo(false);
    }
  }, [isMobile]);

  useEffect(() => {
    window.localStorage.setItem(timelineViewModeStorageKey, viewMode);
  }, [viewMode]);

  const columns = useMemo(() => buildTimelineColumns(viewMode, anchorDate), [anchorDate, viewMode]);
  const timelineStart = columns[0]?.start ?? anchorDate;
  const timelineEnd = columns[columns.length - 1]?.end ?? anchorDate;

  const bas = useQuery({
    queryKey: ['ba-directory', role],
    queryFn: () => apiFetch<BAProfile[]>('/api/ba')
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
    queryKey: ['capacity-summary', role, format(timelineStart, 'yyyy-MM-dd'), format(timelineEnd, 'yyyy-MM-dd')],
    queryFn: () =>
      apiFetch<{
        average_capacity: number;
        counts: Record<string, number>;
        items: Array<{
          ba_id: string;
          approved_capacity: number;
          pending_capacity: number;
          risk_capacity: number;
          capacity_label?: string;
        }>;
      }>(
        `/api/capacity/summary?start_date=${format(timelineStart, 'yyyy-MM-dd')}&end_date=${format(timelineEnd, 'yyyy-MM-dd')}`
      )
  });

  const timelineBas = useMemo(
    () => (bas.data ?? []).filter((ba) => ba.status === 'ACTIVE' || ba.status === 'ON_LEAVE'),
    [bas.data]
  );
  const visibleBas = useMemo(
    () => timelineBas.filter((ba) => !baFilter || ba.id === baFilter),
    [baFilter, timelineBas]
  );

  useEffect(() => {
    if (baFilter && !timelineBas.some((ba) => ba.id === baFilter)) {
      setBaFilter('');
    }
  }, [baFilter, timelineBas]);

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
          desktopRowMinHeight: computeRowMinHeight(
            columns,
            baBookings,
            desktopBarBaseTop,
            72
          ),
          mobileRowMinHeight: computeRowMinHeight(columns, baBookings, mobileBarBaseTop, 120)
        };
      }),
    [columns, visibleBas, visibleBookings]
  );

  const move = (direction: number) =>
    setAnchorDate((current) =>
      viewMode === 'week'
        ? addDays(current, direction * 7)
        : viewMode === 'month'
          ? addMonths(current, direction)
          : addMonths(current, direction * 3)
    );

  function handleTimelineScroll() {
    if (!isMobile) return;
    const nextScrollLeft = timelineScrollRef.current?.scrollLeft ?? 0;
    const nextCompact = nextScrollLeft > mobileCompactScrollThreshold;
    setCompactMobileInfo((current) => (current === nextCompact ? current : nextCompact));
  }

  function handleTimelineWheel(event: WheelEvent<HTMLDivElement>) {
    if (isMobile || !event.shiftKey || event.deltaY === 0) return;
    event.preventDefault();
    event.currentTarget.scrollLeft += event.deltaY;
  }

  function handleMobileIdentityWheel(event: WheelEvent<HTMLButtonElement>) {
    const container = timelineScrollRef.current;
    if (!container) {
      return;
    }

    const delta =
      Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
    if (delta === 0) {
      return;
    }

    event.preventDefault();
    container.scrollLeft += delta;
  }

  function beginSelection(baId: string, day: Date, pointerId: number) {
    setActiveSelection({ ba_id: baId, start: day, end: day, pointerId });
  }

  function updateSelection(baId: string, day: Date, pointerId: number) {
    setActiveSelection((current) => {
      if (!current || current.pointerId !== pointerId || current.ba_id !== baId)
        return current;
      if (isSameDay(current.end, day)) return current;
      return { ...current, end: day };
    });
  }

  function finishSelection(pointerId: number) {
    setActiveSelection((current) => {
      if (!current || current.pointerId !== pointerId) return current;
      setDraft(selectionToDraft(current));
      return null;
    });
  }

  function isSelecting(pointerId: number) {
    return activeSelection?.pointerId === pointerId;
  }

  function beginDragScroll(event: PointerEvent<HTMLDivElement>) {
    if (event.button !== 0 || isTextSelectionTarget(event.target)) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    setDragScroll({
      pointerId: event.pointerId,
      startX: event.clientX,
      startScrollLeft: event.currentTarget.scrollLeft
    });
  }

  function updateDragScroll(event: PointerEvent<HTMLDivElement>) {
    if (
      !dragScroll ||
      dragScroll.pointerId !== event.pointerId ||
      isSelecting(event.pointerId)
    )
      return;
    event.preventDefault();
    event.currentTarget.scrollLeft =
      dragScroll.startScrollLeft - (event.clientX - dragScroll.startX);
  }

  function endDragScroll(pointerId: number) {
    setDragScroll((current) => (current?.pointerId === pointerId ? null : current));
  }

  function openCreateBooking() {
    const today = format(currentDate, 'yyyy-MM-dd');
    setDraft({
      ba_id: '',
      start_date: today,
      end_date: today,
      direct: false,
      project_id: projectFilter || ''
    });
  }

  return (
    <div className="grid gap-5">
      {successMessage ? (
        <div className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm font-medium text-emerald-800">
          {successMessage}
        </div>
      ) : null}
      {bas.isLoading || bookings.isLoading ? (
        <LoadingScreen message="Loading timeline" />
      ) : null}
      {bas.error || bookings.error || projects.error || summary.error ? (
        <Card>
          <CardContent className="p-5 text-sm text-rose-700">
            Could not load timeline data. Check API connection and retry.
          </CardContent>
        </Card>
      ) : null}
      <div>
        <div className="grid w-full gap-2 sm:grid-cols-[minmax(150px,1fr)_minmax(160px,1fr)] lg:flex lg:w-full lg:flex-nowrap lg:items-center">
          <select
            value={baFilter}
            onChange={(event) => setBaFilter(event.target.value)}
            className="h-9 w-full min-w-0 rounded-md border bg-white px-2 text-sm lg:w-48"
          >
            <option value="">All BA</option>
            {timelineBas.map((ba) => (
              <option key={ba.id} value={ba.id}>
                {ba.full_name}
              </option>
            ))}
          </select>
          <select
            value={projectFilter}
            onChange={(event) => setProjectFilter(event.target.value)}
            className="h-9 w-full min-w-0 rounded-md border bg-white px-2 text-sm lg:w-52"
          >
            <option value="">All Projects</option>
            {(projects.data ?? []).map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </select>
          {canCreateBooking ? (
            <Button
              className="hidden lg:ml-auto lg:inline-flex"
              onClick={openCreateBooking}
            >
              <Plus className="h-4 w-4" /> Create booking
            </Button>
          ) : null}
        </div>
      </div>
      <Card className="overflow-hidden">
        <CardHeader className="gap-0 p-0">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 p-6">
            <div className="flex w-full flex-none items-center justify-between gap-2 sm:min-w-fit sm:flex-1 sm:justify-start">
              <Button variant="secondary" size="icon" onClick={() => move(-1)}>
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <Button
                variant="secondary"
                className="flex-1 px-3 sm:flex-none"
                onClick={() => setAnchorDate(initialWeek)}
              >
                Today
              </Button>
              <Button variant="secondary" size="icon" onClick={() => move(1)}>
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
            <div className="flex w-full flex-none items-center justify-between gap-2 text-sm font-medium text-slate-600 sm:min-w-fit sm:flex-1 sm:justify-end">
              <span className="hidden sm:inline">View mode</span>
              <div className="grid w-full grid-cols-3 rounded-md border border-slate-200 bg-slate-100 p-1 sm:inline-flex sm:w-auto">
                {(['week', 'month', 'quarter'] as const).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => setViewMode(mode)}
                    className={cn(
                      'w-full rounded-md px-3 py-1.5 text-sm font-medium capitalize transition-colors',
                      viewMode === mode
                        ? 'bg-white text-slate-950 shadow-sm'
                        : 'text-slate-600 hover:text-slate-950'
                    )}
                  >
                    {mode}
                  </button>
                ))}
              </div>
            </div>
          </div>
          <div className="w-full border-b border-slate-200 bg-slate-50/50 px-6 py-3">
            <button
              type="button"
              onClick={() => setLegendCollapsed((current) => !current)}
              className="flex w-full items-center justify-between text-left text-sm font-medium text-slate-600"
            >
              <span>Legend</span>
              <ChevronDown
                className={cn(
                  'h-4 w-4 transition-transform',
                  legendCollapsed && '-rotate-90'
                )}
              />
            </button>
            {!legendCollapsed ? (
              <div className="mt-3 grid gap-2 text-sm sm:grid-cols-2 xl:grid-cols-3">
                <div className="flex items-center gap-2">
                  <span className="h-4 w-9 rounded bg-blue-600" /> Approved/In progress
                </div>
                <div className="flex items-center gap-2">
                  <span className="h-4 w-9 rounded border border-emerald-200 bg-emerald-100/90" />{' '}
                  Completed
                </div>
                <div className="flex items-center gap-2">
                  <span className="h-4 w-9 rounded border border-dashed border-amber-400 bg-amber-100" />{' '}
                  Pending
                </div>
                <div className="flex items-center gap-2">
                  <span className="h-4 w-9 rounded border border-gray-300 bg-gray-200" />{' '}
                  Rejected
                </div>
                <div className="flex items-center gap-2">
                  <span className="h-4 w-9 rounded border border-rose-200 bg-rose-100/80" />{' '}
                  Cancelled
                </div>
                <div className="flex items-center gap-2">
                  <span className="h-4 w-9 rounded border border-dashed bg-slate-50" />{' '}
                  Available
                </div>
                <div className="flex items-center gap-2">
                  <span className="flex h-4 w-9 items-center justify-center rounded bg-rose-600 text-white">
                    <AlertTriangle className="h-3 w-3" />
                  </span>{' '}
                  Overbooked BA
                </div>
              </div>
            ) : null}
          </div>
        </CardHeader>
        <CardContent className="relative p-0">
          <div
            ref={timelineScrollRef}
            data-timeline-scroll="true"
            className={cn(
              'overflow-x-auto',
              !isMobile && (dragScroll ? 'cursor-grabbing select-none' : 'cursor-grab'),
              activeSelection && 'select-none touch-none'
            )}
            onScroll={handleTimelineScroll}
            onWheel={handleTimelineWheel}
            onPointerDown={beginDragScroll}
            onPointerMove={updateDragScroll}
            onPointerUp={(event) => endDragScroll(event.pointerId)}
            onPointerCancel={(event) => endDragScroll(event.pointerId)}
          >
            <div
              className={cn('grid', !isMobile && 'min-w-[980px]')}
              style={{
                gridTemplateColumns: isMobile
                  ? `repeat(${columns.length}, minmax(${viewMode === 'quarter' ? 112 : mobileDayMinWidth}px, 1fr))`
                  : `${baInfoColumnWidth}px repeat(${columns.length}, minmax(${viewMode === 'week' ? 92 : 132}px, 1fr))`
              }}
            >
              {!isMobile && (
                <>
                  <div className="h-14 border-b border-r bg-white" aria-hidden="true" />
                  {columns.map((column) => (
                    <div
                      key={column.id}
                      className={cn(
                        'grid h-14 place-items-center border-b border-r bg-white p-3 text-center text-xs font-semibold text-slate-600',
                        column.start <= currentDate && column.end >= currentDate &&
                          'bg-blue-50 text-blue-700 ring-1 ring-inset ring-blue-300'
                      )}
                    >
                      <div>
                        <div>{column.label}</div>
                        <div>{column.subLabel}</div>
                      </div>
                    </div>
                  ))}
                </>
              )}
              {isMobile &&
                columns.map((column) => (
                  <div
                    key={column.id}
                    className={cn(
                      'grid h-12 place-items-center border-b border-r bg-white p-2 text-center text-xs font-semibold text-slate-600',
                      column.start <= currentDate && column.end >= currentDate &&
                        'bg-blue-50 text-blue-700 ring-1 ring-inset ring-blue-300'
                    )}
                  >
                    <div>
                      <div>{column.label}</div>
                      <div>{column.subLabel}</div>
                    </div>
                  </div>
                ))}
              {rowData.map(
                (
                  { ba, bookings: baBookings, desktopRowMinHeight, mobileRowMinHeight },
                  index
                ) => {
                  const isAlternateRow = index % 2 === 1;

                  return isMobile ? (
                    <MobileTimelineRow
                      key={ba.id}
                      ba={ba}
                      columns={columns}
                      bookings={baBookings}
                      rowMinHeight={mobileRowMinHeight}
                      isAlternateRow={isAlternateRow}
                      canCreateBooking={canCreateBooking}
                      hasOverbookRisk={
                        (summary.data?.items.find((item) => item.ba_id === ba.id)?.risk_capacity ??
                          0) > 100
                      }
                      onEmptyClick={(column) =>
                        setDraft({
                          ba_id: ba.id,
                          start_date: format(column.start, 'yyyy-MM-dd'),
                          end_date: format(column.end, 'yyyy-MM-dd'),
                          direct: false
                        })
                      }
                      onBookingClick={setSelectedBooking}
                    />
                  ) : (
                    <TimelineRow
                      key={ba.id}
                      ba={ba}
                      columns={columns}
                      bookings={baBookings}
                      rowMinHeight={desktopRowMinHeight}
                      isAlternateRow={isAlternateRow}
                      canCreateBooking={canCreateBooking}
                      allowDragSelection={allowDragSelection}
                      activeSelection={
                        activeSelection?.ba_id === ba.id ? activeSelection : null
                      }
                      onSelectionStart={beginSelection}
                      onSelectionMove={updateSelection}
                      onSelectionEnd={finishSelection}
                      hasOverbookRisk={
                        (summary.data?.items.find((item) => item.ba_id === ba.id)?.risk_capacity ??
                          0) > 100
                      }
                      onEmptyClick={(column) =>
                        setDraft({
                          ba_id: ba.id,
                          start_date: format(column.start, 'yyyy-MM-dd'),
                          end_date: format(column.end, 'yyyy-MM-dd'),
                          direct: false
                        })
                      }
                      onBookingClick={setSelectedBooking}
                    />
                  );
                }
              )}
            </div>
          </div>
          {isMobile ? (
            <div className="pointer-events-none absolute left-0 top-12 z-20">
              {(() => {
                let topOffset = 0;
                return rowData.map(({ ba, mobileRowMinHeight }) => {
                  const capacity = summary.data?.items.find(
                    (item) => item.ba_id === ba.id
                  );
                  const rowTop = topOffset;
                  topOffset += mobileRowMinHeight;

                  return (
                    <div
                      key={ba.id}
                      className="absolute left-0 flex h-12 max-w-[calc(100vw-2rem)] items-center gap-2 px-2"
                      style={{ top: rowTop, width: baInfoColumnWidth }}
                    >
                      <MobileBAIdentity
                        ba={ba}
                        compact={compactMobileInfo}
                        onWheel={handleMobileIdentityWheel}
                      />
                      <span
                        className={cn(
                          'inline-flex shrink-0 items-center gap-1 overflow-hidden rounded-md px-1.5 py-0.5 text-xs font-bold transition-all duration-200 ease-out',
                          (capacity?.risk_capacity ?? 0) > 100 && 'bg-rose-600 text-white',
                          (capacity?.risk_capacity ?? 0) <= 100 &&
                            capacityColor(capacity?.risk_capacity ?? 0),
                          compactMobileInfo
                            ? 'max-w-0 -translate-x-2 opacity-0'
                            : 'max-w-28 translate-x-0 opacity-100'
                        )}
                      >
                        {(capacity?.risk_capacity ?? 0) > 100 ? (
                          <AlertTriangle className="h-3 w-3" />
                        ) : null}
                        {capacity?.risk_capacity ?? 0}%
                        {(capacity?.risk_capacity ?? 0) > 100 ? ' Overbooked' : ''}
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
                    {(capacity?.risk_capacity ?? 0) > 100 ? (
                      <span className="inline-flex items-center gap-1 rounded-md bg-rose-600 px-2 py-1 text-xs font-bold text-white">
                        <AlertTriangle className="h-3 w-3" />
                        {capacity?.risk_capacity ?? 0}% Overbooked
                      </span>
                    ) : (
                      <span
                        className={cn(
                          'text-sm font-bold',
                          capacityColor(capacity?.risk_capacity ?? 0)
                        )}
                      >
                        {capacity?.risk_capacity ?? 0}%
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <BookingModal
        open={Boolean(draft)}
        onClose={() => setDraft(null)}
        onSuccess={() => {
          setDraft(null);
          setSuccessMessage('Booking request submitted.');
          void queryClient.invalidateQueries();
        }}
        initialBaId={draft?.ba_id ?? ''}
        initialProjectId={draft?.project_id ?? ''}
        initialStartDate={draft?.start_date ?? ''}
        initialEndDate={draft?.end_date ?? ''}
      />
      <BookingDetailModal
        booking={selectedBooking}
        allBookings={bookings.data ?? []}
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
  columns,
  bookings,
  rowMinHeight,
  isAlternateRow,
  canCreateBooking,
  allowDragSelection,
  hasOverbookRisk,
  activeSelection,
  onSelectionStart,
  onSelectionMove,
  onSelectionEnd,
  onEmptyClick,
  onBookingClick
}: {
  ba: BAProfile;
  columns: TimelineColumn[];
  bookings: Booking[];
  rowMinHeight: number;
  isAlternateRow: boolean;
  canCreateBooking: boolean;
  allowDragSelection: boolean;
  hasOverbookRisk: boolean;
  activeSelection: DraftSelection | null;
  onSelectionStart: (baId: string, day: Date, pointerId: number) => void;
  onSelectionMove: (baId: string, day: Date, pointerId: number) => void;
  onSelectionEnd: (pointerId: number) => void;
  onEmptyClick: (column: TimelineColumn) => void;
  onBookingClick: (booking: Booking) => void;
}) {
  const layouts = computeBookingLayouts(columns, bookings);
  const selectedRange = activeSelection ? sortSelectionRange(activeSelection) : null;

  return (
    <>
      <div
        className={cn('border-b border-r', isAlternateRow ? 'bg-sky-50' : 'bg-white')}
        style={{ height: rowMinHeight }}
        aria-hidden="true"
      />
      <div className="relative col-span-full hidden" />
      {columns.map((column) => {
        const isSelected = Boolean(
          selectedRange && column.start >= selectedRange.start && column.start <= selectedRange.end
        );

        return (
          <button
            key={`${ba.id}-${column.id}`}
            className={cn(
              'group select-none border-b border-r p-1 text-left text-xs text-slate-400',
              dayCellBackground(isAlternateRow),
              canCreateBooking ? 'hover:bg-blue-50' : 'cursor-default',
              isSelected && 'bg-blue-100 ring-2 ring-inset ring-blue-400'
            )}
            style={{ minHeight: rowMinHeight }}
            onPointerDown={(event) => {
              if (!allowDragSelection || event.button !== 0) return;
              onSelectionStart(ba.id, column.start, event.pointerId);
            }}
            onPointerEnter={(event) => {
              if (allowDragSelection && event.buttons === 1)
                onSelectionMove(ba.id, column.start, event.pointerId);
            }}
            onPointerUp={(event) => {
              if (allowDragSelection) onSelectionEnd(event.pointerId);
            }}
            onPointerCancel={(event) => {
              if (allowDragSelection) onSelectionEnd(event.pointerId);
            }}
            onClick={(event) => {
              if (canCreateBooking && !allowDragSelection && event.detail !== 0) {
                onEmptyClick(column);
              }
            }}
            aria-label={canCreateBooking ? 'Create booking request' : 'Available slot'}
          >
            {canCreateBooking ? (
              <Plus className="mt-5 h-4 w-4 opacity-0 transition group-hover:opacity-100" />
            ) : null}
          </button>
        );
      })}
      <div
        className="pointer-events-none relative grid"
        style={{ gridColumn: `2 / span ${columns.length}` }}
      >
        <div
          className="relative"
          style={{ minHeight: rowMinHeight, marginTop: -rowMinHeight }}
        >
          {layouts.map(({ booking, leftPercent, widthPercent, lane }) => {
            return (
              <button
                key={booking.id}
                className={cn(
                  'pointer-events-auto absolute h-8 truncate rounded-md px-2 text-left text-xs font-semibold shadow-sm transition hover:-translate-y-0.5',
                  bookingBarClass(booking.status, hasOverbookRisk)
                )}
                style={{
                  left: `${leftPercent}%`,
                  width: `max(28px, calc(${widthPercent}% - 8px))`,
                  top: `${desktopBarBaseTop + lane * bookingLaneHeight}px`
                }}
                onClick={() => onBookingClick(booking)}
                aria-label={`${booking.status} booking ${booking.title}`}
              >
                <span className="inline-flex min-w-0 items-center gap-1">
                  {hasOverbookRisk ? <AlertTriangle className="h-3 w-3 shrink-0" /> : null}
                  <span className="truncate">
                    {booking.project.name} · {booking.capacity_percent}%
                    {hasOverbookRisk ? ' · Overbooked' : ''}
                  </span>
                </span>
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
  columns,
  bookings,
  rowMinHeight,
  isAlternateRow,
  canCreateBooking,
  hasOverbookRisk,
  onEmptyClick,
  onBookingClick
}: {
  ba: BAProfile;
  columns: TimelineColumn[];
  bookings: Booking[];
  rowMinHeight: number;
  isAlternateRow: boolean;
  canCreateBooking: boolean;
  hasOverbookRisk: boolean;
  onEmptyClick: (column: TimelineColumn) => void;
  onBookingClick: (booking: Booking) => void;
}) {
  const layouts = computeBookingLayouts(columns, bookings);

  return (
    <>
      {columns.map((column) => (
        <button
          key={`${ba.id}-${column.id}`}
          className={cn(
            'group select-none border-b border-r border-slate-200 p-1 pt-12 text-left text-xs text-slate-400',
            dayCellBackground(isAlternateRow),
            canCreateBooking ? 'hover:bg-blue-50' : 'cursor-default'
          )}
          style={{ minHeight: rowMinHeight }}
          onClick={() => {
            if (canCreateBooking) onEmptyClick(column);
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
        style={{ gridColumn: `1 / span ${columns.length}` }}
      >
        <div
          className="relative"
          style={{ minHeight: rowMinHeight, marginTop: -rowMinHeight }}
        >
          {layouts.map(({ booking, leftPercent, widthPercent, lane }) => {
            return (
              <button
                key={booking.id}
                className={cn(
                  'pointer-events-auto absolute h-8 truncate rounded-md px-2 text-left text-xs font-semibold shadow-sm transition hover:-translate-y-0.5',
                  bookingBarClass(booking.status, hasOverbookRisk)
                )}
                style={{
                  left: `${leftPercent}%`,
                  width: `max(28px, calc(${widthPercent}% - 8px))`,
                  top: `${mobileBarBaseTop + lane * bookingLaneHeight}px`
                }}
                onClick={() => onBookingClick(booking)}
                aria-label={`${booking.status} booking ${booking.title}`}
              >
                <span className="inline-flex min-w-0 items-center gap-1">
                  {hasOverbookRisk ? <AlertTriangle className="h-3 w-3 shrink-0" /> : null}
                  <span className="truncate">
                    {booking.project.name} · {booking.capacity_percent}%
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </>
  );
}
function MobileBAIdentity({
  ba,
  compact,
  onWheel
}: {
  ba: BAProfile;
  compact: boolean;
  onWheel: (event: WheelEvent<HTMLButtonElement>) => void;
}) {
  const initials = ba.full_name
    .split(' ')
    .map((part) => part[0])
    .slice(0, 2)
    .join('');

  return (
    <button
      type="button"
      data-allow-scroll-drag="true"
      className="pointer-events-auto flex min-w-0 items-center gap-2 text-xs"
      onClick={(event) => event.stopPropagation()}
      onWheel={onWheel}
    >
      <span
        className={cn(
          'block shrink-0 overflow-hidden transition-all duration-200 ease-out',
          compact ? 'w-0 -translate-x-2 opacity-0' : 'w-6 translate-x-0 opacity-100'
        )}
      >
        {ba.avatar_url ? (
          <img src={ba.avatar_url} alt="" className="h-6 w-6 rounded-full" />
        ) : (
          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-blue-100 text-[10px] font-bold text-blue-700">
            {initials}
          </span>
        )}
      </span>
      <span className="truncate font-semibold text-slate-950">{ba.full_name}</span>
      <span
        className={cn(
          'inline-flex shrink-0 items-center overflow-hidden whitespace-nowrap leading-none text-slate-500 transition-all duration-200 ease-out',
          compact
            ? 'max-w-0 translate-x-2 opacity-0'
            : 'max-w-20 translate-x-0 opacity-100'
        )}
      >
        - {ba.level}
      </span>
    </button>
  );
}

function rangesOverlap(firstStart: string, firstEnd: string, secondStart: string, secondEnd: string) {
  return parseISO(firstStart) <= parseISO(secondEnd) && parseISO(firstEnd) >= parseISO(secondStart);
}

function BookingDetailModal({
  booking,
  allBookings,
  onClose,
  onDone
}: {
  booking: Booking | null;
  allBookings: Booking[];
  onClose: () => void;
  onDone: () => void;
}) {
  const { user } = useAuth();
  const role = user?.role ?? 'BA';
  const isManagerRole = role === 'BA_MANAGER';
  const [capacityDraft, setCapacityDraft] = useState('50');
  const [decisionKind, setDecisionKind] = useState<'reject' | 'cancel' | null>(null);
  const [decisionReason, setDecisionReason] = useState('');
  const bookingId = booking?.id;
  const bookingCapacity = booking?.capacity_percent;
  const capacityDetail = useQuery({
    queryKey: [
      'timeline-booking-capacity',
      booking?.ba_id,
      booking?.start_date,
      booking?.end_date
    ],
    queryFn: () =>
      apiFetch<CapacityDetail>(
        `/api/capacity/ba/${booking?.ba_id}?start_date=${booking?.start_date}&end_date=${booking?.end_date}`
      ),
    enabled: Boolean(booking?.ba_id && booking?.start_date && booking?.end_date)
  });
  const relatedBookings = useMemo(() => {
    if (!booking?.ba_id) {
      return [];
    }

    return allBookings.filter(
      (item) =>
        item.ba_id === booking.ba_id &&
        item.status !== 'REJECTED' &&
        item.status !== 'CANCELLED' &&
        rangesOverlap(item.start_date, item.end_date, booking.start_date, booking.end_date)
    );
  }, [allBookings, booking]);
  const projectBreakdown = useMemo(() => {
    const projectMap = new Map<
      string,
      {
        project: string;
        capacity: number;
        dateRanges: string[];
      }
    >();

    for (const item of relatedBookings) {
      const current = projectMap.get(item.project_id) ?? {
        project: item.project.name,
        capacity: 0,
        dateRanges: []
      };
      current.capacity += item.capacity_percent;
      current.dateRanges.push(`${formatDate(item.start_date)} - ${formatDate(item.end_date)}`);
      projectMap.set(item.project_id, current);
    }

    return Array.from(projectMap.values()).sort(
      (left, right) => right.capacity - left.capacity
    );
  }, [relatedBookings]);

  useEffect(() => {
    if (!bookingId || bookingCapacity === undefined) {
      return;
    }

    setCapacityDraft(String(bookingCapacity));
    setDecisionKind(null);
    setDecisionReason('');
  }, [bookingId, bookingCapacity]);

  const capacityPercent =
    parseCapacityPercent(capacityDraft) ?? booking?.capacity_percent ?? 50;
  const canEditCapacity = isManagerRole && booking?.status === 'PENDING';
  const capacityChanged = Boolean(
    booking && canEditCapacity && capacityPercent !== booking.capacity_percent
  );
  const now = new Date();
  const todayStr = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-${String(now.getUTCDate()).padStart(2, '0')}`;
  const startStr = booking
    ? (typeof booking.start_date === 'string'
      ? booking.start_date.slice(0, 10)
      : new Date(booking.start_date).toISOString().slice(0, 10))
    : '';
  const canCancel = booking?.status === 'APPROVED' && startStr > todayStr;
  const updateCapacity = useMutation({
    mutationFn: () => {
      if (!booking) {
        return Promise.resolve(null);
      }

      return apiFetch(`/api/bookings/${booking.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ capacity_percent: capacityPercent })
      });
    },
    onSuccess: onDone
  });
  const approve = useMutation({
    mutationFn: async () => {
      if (!booking) {
        return null;
      }

      if (capacityPercent !== booking.capacity_percent) {
        await apiFetch(`/api/bookings/${booking.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ capacity_percent: capacityPercent })
        });
      }

      return apiFetch(`/api/bookings/${booking.id}/approve`, { method: 'POST' });
    },
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

  function submitDecision() {
    const reason = decisionReason.trim();
    if (!decisionKind || !reason) return;

    if (decisionKind === 'reject') {
      reject.mutate(reason);
      return;
    }

    cancel.mutate(reason);
  }

  if (!booking) return null;

  const maxRiskCapacity = capacityDetail.data?.max_risk_capacity ?? 0;
  const isOverbooked = maxRiskCapacity > 100;
  const firstOverbookDay = capacityDetail.data?.daily.find((day) => day.risk_capacity > 100);

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
            <p>
              Capacity: {canEditCapacity ? capacityPercent : booking.capacity_percent}%
            </p>
            <p>Requester: {booking.requester.full_name}</p>
            {booking.notes ? <p>Notes: {booking.notes}</p> : null}
            {booking.reject_reason ? <p>Reject reason: {booking.reject_reason}</p> : null}
            {booking.cancel_reason ? <p>Cancel reason: {booking.cancel_reason}</p> : null}
          </div>
        </div>
        {isOverbooked ? (
          <div className="grid gap-3 rounded-md border border-rose-200 bg-rose-50 p-4 text-rose-950">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="font-semibold">Overbooked capacity</p>
                <p className="mt-1 text-xs text-rose-700">
                  Max risk capacity {maxRiskCapacity}%{firstOverbookDay ? ` on ${formatDate(firstOverbookDay.date)}` : ''}.
                </p>
              </div>
              <AlertTriangle className="h-5 w-5 shrink-0 text-rose-700" />
            </div>
            <div className="grid gap-2 text-sm">
              <p>BA: {booking.ba?.full_name ?? 'Unassigned'}</p>
              <p>
                Selected booking: {booking.project.name} · {booking.capacity_percent}% ·{' '}
                {formatDate(booking.start_date)} - {formatDate(booking.end_date)}
              </p>
              <div className="grid gap-1">
                {projectBreakdown.map((item) => (
                  <div key={item.project} className="rounded-md bg-white/70 px-3 py-2">
                    <p className="font-semibold">{item.project}: {item.capacity}%</p>
                    <p className="mt-1 text-xs text-rose-700">{item.dateRanges.join(', ')}</p>
                  </div>
                ))}
              </div>
              <div className="grid gap-1 text-xs text-rose-700 sm:grid-cols-2">
                <span>Suggested: view available BA</span>
                <span>Suggested: move part of effort</span>
                <span>Suggested: reject pending request</span>
                <span>Suggested: assign different BA</span>
              </div>
            </div>
          </div>
        ) : null}
        {canEditCapacity ? (
          <div className="grid gap-3 rounded-md border p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="font-semibold text-slate-950">Capacity decision</p>
                <p className="mt-1 text-xs text-slate-500">
                  Requested: {booking.capacity_percent}%
                </p>
              </div>
              <span
                className={[
                  'rounded-md px-2 py-1 text-xs font-semibold ring-1 ring-inset',
                  capacityChanged
                    ? 'bg-amber-50 text-amber-700 ring-amber-200'
                    : 'bg-gray-100 text-gray-700 ring-gray-200'
                ].join(' ')}
              >
                {capacityChanged ? 'Edited' : 'Current'}
              </span>
            </div>
            <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
              <div className="grid grid-cols-4 rounded-md border border-slate-200 bg-slate-100 p-1">
                {CAPACITY_OPTIONS.map((option) => (
                  <button
                    key={option}
                    type="button"
                    onClick={() => setCapacityDraft(String(option))}
                    className={[
                      'h-9 rounded-md text-sm font-semibold transition-colors',
                      capacityPercent === option
                        ? 'bg-white text-slate-950 shadow-sm'
                        : 'text-slate-600 hover:text-slate-950'
                    ].join(' ')}
                    disabled={approve.isPending || updateCapacity.isPending}
                  >
                    {option}%
                  </button>
                ))}
              </div>
              <Button
                type="button"
                variant="secondary"
                onClick={() => updateCapacity.mutate()}
                disabled={
                  !capacityChanged || approve.isPending || updateCapacity.isPending
                }
              >
                Save capacity
              </Button>
            </div>
          </div>
        ) : null}
        {isManagerRole && booking.status === 'PENDING' ? (
          <div className="flex gap-2">
            <Button
              onClick={() => approve.mutate()}
              disabled={approve.isPending || updateCapacity.isPending}
            >
              {capacityChanged ? 'Save + approve' : 'Approve'}
            </Button>
            <Button
              variant="secondary"
              onClick={() => {
                setDecisionKind((current) => (current === 'reject' ? null : 'reject'));
                setDecisionReason('');
              }}
              disabled={reject.isPending}
            >
              Reject
            </Button>
          </div>
        ) : null}
        {isManagerRole && canCancel ? (
          <div className="flex gap-2">
            <Button
              variant="secondary"
              onClick={() => {
                setDecisionKind((current) => (current === 'cancel' ? null : 'cancel'));
                setDecisionReason('');
              }}
              disabled={cancel.isPending}
            >
              Cancel booking
            </Button>
          </div>
        ) : null}
        {decisionKind ? (
          <form
            className="grid gap-3 rounded-md border border-slate-200 bg-slate-50 p-4"
            onSubmit={(event) => {
              event.preventDefault();
              submitDecision();
            }}
          >
            <label className="grid gap-2">
              <span className="text-sm font-semibold text-slate-700">
                {decisionKind === 'reject' ? 'Reject reason' : 'Cancel reason'}
              </span>
              <textarea
                value={decisionReason}
                onChange={(event) => setDecisionReason(event.target.value)}
                className="min-h-24 rounded-md border border-slate-200 bg-white p-3 text-sm"
                placeholder={
                  decisionKind === 'reject'
                    ? 'Explain why this pending schedule is rejected...'
                    : 'Explain why this schedule is cancelled...'
                }
                autoFocus
              />
            </label>
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="secondary"
                onClick={() => {
                  setDecisionKind(null);
                  setDecisionReason('');
                }}
                disabled={reject.isPending || cancel.isPending}
              >
                Back
              </Button>
              <Button
                type="submit"
                variant="secondary"
                disabled={!decisionReason.trim() || reject.isPending || cancel.isPending}
              >
                {decisionKind === 'reject'
                  ? reject.isPending
                    ? 'Rejecting...'
                    : 'Confirm reject'
                  : cancel.isPending
                    ? 'Cancelling...'
                    : 'Confirm cancel'}
              </Button>
            </div>
          </form>
        ) : null}
        {approve.error || reject.error || cancel.error || updateCapacity.error ? (
          <div className="rounded-md bg-rose-50 p-3 text-rose-700">
            {
              (approve.error ?? reject.error ?? cancel.error ?? updateCapacity.error)
                ?.message
            }
          </div>
        ) : null}
      </div>
    </Modal>
  );
}
