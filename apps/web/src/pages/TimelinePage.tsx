import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent,
  type WheelEvent
} from 'react';
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
import { ChevronDown, ChevronLeft, ChevronRight, Plus } from 'lucide-react';
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

function bookingBarClass(status: Booking['status']) {
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
  const role = user?.role ?? 'BA';
  const [viewMode, setViewMode] = useState<'week' | 'month'>(() => {
    if (typeof window === 'undefined') {
      return 'week';
    }

    const stored = window.localStorage.getItem(timelineViewModeStorageKey);
    return stored === 'month' ? 'month' : 'week';
  });
  const [anchorDate, setAnchorDate] = useState(initialWeek);
  const [baFilter, setBaFilter] = useState('');
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
  const allowDragSelection = canCreateBooking && !prefersCoarsePointer;
  const currentDate = useMemo(() => new Date(), []);

  useEffect(() => {
    if (!isMobile) {
      setCompactMobileInfo(false);
    }
  }, [isMobile]);

  useEffect(() => {
    window.localStorage.setItem(timelineViewModeStorageKey, viewMode);
  }, [viewMode]);

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
    queryFn: () =>
      apiFetch<{
        average_capacity: number;
        counts: Record<string, number>;
        items: Array<{ ba_id: string; approved_capacity: number; risk_capacity: number }>;
      }>('/api/capacity/summary')
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
          desktopRowMinHeight: computeRowMinHeight(
            days,
            baBookings,
            desktopBarBaseTop,
            72
          ),
          mobileRowMinHeight: computeRowMinHeight(days, baBookings, mobileBarBaseTop, 120)
        };
      }),
    [days, visibleBas, visibleBookings]
  );

  const move = (direction: number) =>
    setAnchorDate((current) =>
      viewMode === 'week'
        ? addDays(current, direction * 7)
        : addMonths(current, direction)
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
            {(bas.data ?? []).map((ba) => (
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
              <div className="grid w-full grid-cols-2 rounded-md border border-slate-200 bg-slate-100 p-1 sm:inline-flex sm:w-auto">
                {(['week', 'month'] as const).map((mode) => (
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
                        isSameDay(day, currentDate) &&
                          'bg-blue-50 text-blue-700 ring-1 ring-inset ring-blue-300'
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
                      isSameDay(day, currentDate) &&
                        'bg-blue-50 text-blue-700 ring-1 ring-inset ring-blue-300'
                    )}
                  >
                    <div>
                      <div>{format(day, 'EEE')}</div>
                      <div>{format(day, 'dd/MM')}</div>
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
                      allowDragSelection={allowDragSelection}
                      activeSelection={
                        activeSelection?.ba_id === ba.id ? activeSelection : null
                      }
                      onSelectionStart={beginSelection}
                      onSelectionMove={updateSelection}
                      onSelectionEnd={finishSelection}
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
                    <span
                      className={cn(
                        'text-sm font-bold',
                        capacityColor(capacity?.risk_capacity ?? 0)
                      )}
                    >
                      {capacity?.risk_capacity ?? 0}%
                    </span>
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
  allowDragSelection,
  activeSelection,
  onSelectionStart,
  onSelectionMove,
  onSelectionEnd,
  onEmptyClick,
  onBookingClick
}: {
  ba: BAProfile;
  days: Date[];
  bookings: Booking[];
  rowMinHeight: number;
  isAlternateRow: boolean;
  canCreateBooking: boolean;
  allowDragSelection: boolean;
  activeSelection: DraftSelection | null;
  onSelectionStart: (baId: string, day: Date, pointerId: number) => void;
  onSelectionMove: (baId: string, day: Date, pointerId: number) => void;
  onSelectionEnd: (pointerId: number) => void;
  onEmptyClick: (date: Date) => void;
  onBookingClick: (booking: Booking) => void;
}) {
  const layouts = computeBookingLayouts(days, bookings);
  const selectedRange = activeSelection ? sortSelectionRange(activeSelection) : null;

  return (
    <>
      <div
        className={cn('border-b border-r', isAlternateRow ? 'bg-sky-50' : 'bg-white')}
        style={{ height: rowMinHeight }}
        aria-hidden="true"
      />
      <div className="relative col-span-full hidden" />
      {days.map((day) => {
        const isSelected = Boolean(
          selectedRange && day >= selectedRange.start && day <= selectedRange.end
        );

        return (
          <button
            key={`${ba.id}-${day.toISOString()}`}
            className={cn(
              'group select-none border-b border-r p-1 text-left text-xs text-slate-400',
              dayCellBackground(isAlternateRow),
              canCreateBooking ? 'hover:bg-blue-50' : 'cursor-default',
              isSelected && 'bg-blue-100 ring-2 ring-inset ring-blue-400'
            )}
            style={{ minHeight: rowMinHeight }}
            onPointerDown={(event) => {
              if (!allowDragSelection || event.button !== 0) return;
              onSelectionStart(ba.id, day, event.pointerId);
            }}
            onPointerEnter={(event) => {
              if (allowDragSelection && event.buttons === 1)
                onSelectionMove(ba.id, day, event.pointerId);
            }}
            onPointerUp={(event) => {
              if (allowDragSelection) onSelectionEnd(event.pointerId);
            }}
            onPointerCancel={(event) => {
              if (allowDragSelection) onSelectionEnd(event.pointerId);
            }}
            onClick={(event) => {
              if (canCreateBooking && event.detail === 0) onEmptyClick(day);
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
        style={{ gridColumn: `2 / span ${days.length}` }}
      >
        <div
          className="relative"
          style={{ minHeight: rowMinHeight, marginTop: -rowMinHeight }}
        >
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
            'group select-none border-b border-r border-slate-200 p-1 pt-12 text-left text-xs text-slate-400',
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
        <div
          className="relative"
          style={{ minHeight: rowMinHeight, marginTop: -rowMinHeight }}
        >
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

function BookingDetailModal({
  booking,
  onClose,
  onDone
}: {
  booking: Booking | null;
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
        {isManagerRole &&
        (booking.status === 'APPROVED' || booking.status === 'IN_PROGRESS') ? (
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
