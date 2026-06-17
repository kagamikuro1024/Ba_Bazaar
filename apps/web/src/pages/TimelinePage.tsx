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
  endOfQuarter,
  endOfWeek,
  format,
  isSameDay,
  parseISO,
  startOfMonth,
  startOfQuarter,
  startOfWeek
} from 'date-fns';
import {
  AlertTriangle,
  ArrowUpDown,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Plus,
  Search
} from 'lucide-react';
import { useAuth } from '@/auth/AuthProvider';
import {
  apiFetch,
  type BAProfile,
  type Booking,
  type Project,
  getBookingRequirements
} from '@/lib/api';
import { CAPACITY_OPTIONS, parseCapacityPercent } from '@/lib/capacity';
import { Avatar, BAIdentity, StatusBadge } from '@/components/common';
import { BookingModal } from '@/components/BookingModal';
import { RecommendationDropdown } from '@/components/ba/RecommendationDropdown';
import { PageHeader } from '@/components';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Modal } from '@/components/ui/modal';
import { LoadingScreen } from '@/components/ui/loading-screen';
import { capacityColor, formatDate } from '@/lib/format';
import { cn } from '@/lib/utils';
import { useFabAction, useGlobalFab } from '@/context/GlobalFabContext';

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

type CapacitySummaryItem = {
  ba_id: string;
  approved_capacity: number;
  pending_capacity: number;
  risk_capacity: number;
  utilization_percent: number;
  booked_man_days?: number;
  available_man_days?: number;
  conflict_risk?: boolean;
  invalid_overbook?: boolean;
  capacity_label?: string;
};

type TimelineViewMode = 'week' | 'month' | 'quarter';
type BASortMode = 'name' | 'capacity_desc' | 'capacity_asc';

type TimelineColumn = {
  id: string;
  label: string;
  subLabel: string;
  start: Date;
  end: Date;
};

function usePrefersCoarsePointer() {
  const [isCoarsePointer, setIsCoarsePointer] = useState(() =>
    typeof window === 'undefined' ? false : window.matchMedia('(pointer: coarse)').matches
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
const mobileWeekDayMinWidth = 88;
const mobileMonthColumnMinWidth = 96;
const mobileQuarterColumnMinWidth = 152;
const mobileBaCardWidth = 144;
const mobileBaCardCompactWidth = 84;
const mobileCompactScrollThreshold = mobileWeekDayMinWidth * 2;
const desktopBookingLaneStep = 36;
const mobileBookingLaneStep = 40;
const desktopBarBaseTop = 16;
const mobileBarBaseTop = 58;
const timelineViewModeStorageKey = 'ba-bazaar-timeline-view-mode';

function dayCellBackground(isAlternateRow: boolean) {
  return isAlternateRow
    ? 'bg-[repeating-linear-gradient(-45deg,#eff6ff,#eff6ff_6px,#dbeafe_6px,#dbeafe_12px)]'
    : 'bg-[repeating-linear-gradient(-45deg,#f8fafc,#f8fafc_6px,#eef2f7_6px,#eef2f7_12px)]';
}

function bookingBarClass(status: Booking['status'], hasOverbookRisk = false) {
  if (
    hasOverbookRisk &&
    (status === 'APPROVED' || status === 'IN_PROGRESS' || status === 'PENDING')
  ) {
    return 'border border-rose-500 bg-rose-600 text-white shadow-rose-200';
  }

  switch (status) {
    case 'PENDING':
      return 'border border-dashed border-amber-400 bg-amber-100 text-amber-800';
    case 'COMPLETED':
      return 'border border-emerald-200 bg-emerald-100/90 text-emerald-800';
    case 'CANCELLED':
      return 'border border-slate-200 bg-slate-200 text-slate-400';
    case 'REJECTED':
      return 'border border-rose-200 bg-rose-100/80 text-rose-700';
    default:
      return 'bg-blue-600 text-white';
  }
}

function bookingLabelClass(status: Booking['status']) {
  return status === 'CANCELLED' ? 'line-through' : '';
}

function bookingBarTooltip(booking: Booking) {
  return [
    booking.project.name,
    `${booking.capacity_percent}%`,
    booking.status.replaceAll('_', ' '),
    `${formatDate(booking.start_date)} - ${formatDate(booking.end_date)}`
  ].join(' · ');
}

function bookingBarWidth(widthPercent: number) {
  return `max(28px, ${widthPercent}%)`;
}

type BookingLayout = {
  booking: Booking;
  leftPercent: number;
  widthPercent: number;
  lane: number;
  clippedLeft: boolean;
  clippedRight: boolean;
};

function computeBookingLayouts(
  columns: TimelineColumn[],
  bookings: Booking[]
): BookingLayout[] {
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
      return {
        booking,
        start,
        end,
        clippedLeft: rawStart < first,
        clippedRight: rawEnd > last
      };
    })
    .filter(
      (
        item
      ): item is {
        booking: Booking;
        start: Date;
        end: Date;
        clippedLeft: boolean;
        clippedRight: boolean;
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

    layouts.push({
      booking: item.booking,
      leftPercent,
      widthPercent,
      lane,
      clippedLeft: item.clippedLeft,
      clippedRight: item.clippedRight
    });
  }

  return layouts;
}

function computeRowMinHeight(
  columns: TimelineColumn[],
  bookings: Booking[],
  barBaseTop: number,
  laneStep: number,
  minHeight: number
) {
  const layouts = computeBookingLayouts(columns, bookings);
  const laneCount = Math.max(1, ...layouts.map((item) => item.lane + 1));
  return Math.max(minHeight, barBaseTop + laneCount * laneStep + 10);
}

function buildTimelineColumns(
  viewMode: TimelineViewMode,
  anchorDate: Date
): TimelineColumn[] {
  if (viewMode === 'month') {
    const start = startOfMonth(anchorDate);
    const end = endOfMonth(start);
    const columns: TimelineColumn[] = [];
    let cursor = startOfWeek(start, { weekStartsOn: 1 });
    let weekIndex = 1;

    while (cursor <= end) {
      const weekStart = cursor < start ? start : cursor;
      const weekEnd =
        endOfWeek(cursor, { weekStartsOn: 1 }) > end
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

  return eachDayOfInterval({ start: anchorDate, end: addDays(anchorDate, 6) }).map(
    (day) => ({
      id: format(day, 'yyyy-MM-dd'),
      label: format(day, 'EEE'),
      subLabel: format(day, 'dd/MM'),
      start: day,
      end: day
    })
  );
}

function isCurrentTimelineColumn(column: TimelineColumn, currentDate: Date) {
  const currentKey = format(currentDate, 'yyyy-MM-dd');
  return (
    format(column.start, 'yyyy-MM-dd') <= currentKey &&
    format(column.end, 'yyyy-MM-dd') >= currentKey
  );
}

function formatTimelinePeriodLabel(
  viewMode: TimelineViewMode,
  timelineStart: Date,
  timelineEnd: Date
) {
  if (viewMode === 'week') {
    return `Tuần ${format(timelineStart, 'II')} · ${format(timelineStart, 'dd/MM')} - ${format(
      timelineEnd,
      'dd/MM'
    )}`;
  }

  if (viewMode === 'month') {
    return `Tháng ${format(timelineStart, 'MM/yyyy')}`;
  }

  return `Q${format(timelineStart, 'Q')} · ${format(timelineStart, 'MM/yyyy')} - ${format(
    endOfQuarter(timelineStart),
    'MM/yyyy'
  )}`;
}

void formatTimelinePeriodLabel;

function sortSelectionRange(selection: DraftSelection) {
  return selection.start <= selection.end
    ? { start: selection.start, end: selection.end }
    : { start: selection.end, end: selection.start };
}

function normalizeAnchorDate(viewMode: TimelineViewMode, value: Date) {
  if (viewMode === 'month') {
    return startOfMonth(value);
  }

  if (viewMode === 'quarter') {
    return startOfQuarter(value);
  }

  return startOfWeek(value, { weekStartsOn: 1 });
}

function getCurrentAnchorDate(viewMode: TimelineViewMode) {
  return normalizeAnchorDate(viewMode, new Date());
}

function utilizationPeriodWord(viewMode: TimelineViewMode) {
  return viewMode === 'week'
    ? 'this week'
    : viewMode === 'month'
      ? 'this month'
      : 'this quarter';
}

// Tooltip shown next to the BA utilization %, explaining the man-day basis and
// any pending conflict / invalid-overbook signal for the current view.
function utilizationTooltip(
  viewMode: TimelineViewMode,
  item: CapacitySummaryItem | undefined
) {
  if (!item) {
    return 'No allocation in this period';
  }

  const parts = [
    `Approved utilization ${utilizationPeriodWord(viewMode)}: ${item.utilization_percent ?? 0}%`
  ];
  if (item.available_man_days != null && item.booked_man_days != null) {
    parts.push(
      `${item.booked_man_days}/${item.available_man_days} man-days allocated (weekends excluded)`
    );
  }
  if (item.invalid_overbook) {
    parts.push('Invalid overbook: approved load exceeds 100% (data issue)');
  } else if (item.conflict_risk) {
    parts.push(`Pending conflict risk: up to ${item.risk_capacity}% if all approved`);
  }
  return parts.join(' - ');
}

function formatBaSortMode(sortMode: BASortMode) {
  if (sortMode === 'capacity_desc') {
    return 'Capacity high to low';
  }

  if (sortMode === 'capacity_asc') {
    return 'Capacity low to high';
  }

  return 'A to Z';
}

function formatBaSortModeCompact(sortMode: BASortMode) {
  if (sortMode === 'capacity_desc') {
    return 'High-Low';
  }

  if (sortMode === 'capacity_asc') {
    return 'Low-High';
  }

  return 'A-Z';
}

function buildWeekPickerSections(year: number) {
  return Array.from({ length: 12 }, (_, monthIndex) => {
    const monthStart = new Date(year, monthIndex, 1);
    const monthEnd = endOfMonth(monthStart);
    const weeks: Array<{ start: Date; end: Date; label: string }> = [];
    let cursor = startOfWeek(monthStart, { weekStartsOn: 1 });

    while (cursor <= monthEnd) {
      const weekEnd = endOfWeek(cursor, { weekStartsOn: 1 });
      weeks.push({
        start: cursor,
        end: weekEnd,
        label: `Tuần ${format(cursor, 'II')}`
      });
      cursor = addDays(weekEnd, 1);
    }

    return {
      monthLabel: format(monthStart, 'MMMM yyyy'),
      weeks
    };
  });
}

function formatTimelinePeriodLabelUi(
  viewMode: TimelineViewMode,
  timelineStart: Date,
  timelineEnd: Date
) {
  if (viewMode === 'week') {
    return `Week ${format(timelineStart, 'II')} · ${format(timelineStart, 'dd/MM')} - ${format(
      timelineEnd,
      'dd/MM'
    )}`;
  }

  if (viewMode === 'month') {
    return format(timelineStart, 'MMMM yyyy');
  }

  return `Q${format(timelineStart, 'Q')} · ${format(timelineStart, 'MMM yyyy')} - ${format(
    endOfQuarter(timelineStart),
    'MMM yyyy'
  )}`;
}

function buildWeekPickerSectionsUi(year: number) {
  return Array.from({ length: 12 }, (_, monthIndex) => {
    const monthStart = new Date(year, monthIndex, 1);
    const monthEnd = endOfMonth(monthStart);
    const weeks: Array<{ start: Date; end: Date; label: string }> = [];
    let cursor = startOfWeek(monthStart, { weekStartsOn: 1 });

    while (cursor <= monthEnd) {
      const weekEnd = endOfWeek(cursor, { weekStartsOn: 1 });
      weeks.push({
        start: cursor,
        end: weekEnd,
        label: `Week ${format(cursor, 'II')}`
      });
      cursor = addDays(weekEnd, 1);
    }

    return {
      monthLabel: format(monthStart, 'MMMM yyyy'),
      weeks
    };
  });
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
  const [legendCollapsed, setLegendCollapsed] = useState(true);
  const [baSortMode, setBaSortMode] = useState<BASortMode>('name');
  const [periodPickerOpen, setPeriodPickerOpen] = useState(false);
  const [pickerYear, setPickerYear] = useState(() => Number(format(new Date(), 'yyyy')));

  const isManagerRole = role === 'BA_MANAGER';
  const [activeDrag, setActiveDrag] = useState<{
    booking: Booking;
    sourceBaId: string;
    currentBaId: string;
  } | null>(null);

  const [pendingReassign, setPendingReassign] = useState<{
    booking: Booking;
    sourceBaId: string;
    targetBaId: string;
  } | null>(null);

  const confirmReassign = useMutation({
    mutationFn: () => {
      if (!pendingReassign) return Promise.resolve(null);
      return apiFetch(`/api/bookings/${pendingReassign.booking.id}/assign`, {
        method: 'PATCH',
        body: JSON.stringify({ ba_id: pendingReassign.targetBaId })
      });
    },
    onSuccess: () => {
      setPendingReassign(null);
      void queryClient.invalidateQueries();
    }
  });

  const handleDragStart = (e: React.DragEvent, booking: Booking, baId: string) => {
    setActiveDrag({
      booking,
      sourceBaId: baId,
      currentBaId: baId
    });
    e.dataTransfer.setData('text/plain', booking.id);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragEnd = () => {
    setActiveDrag(null);
  };

  const handleDragEnter = (e: React.DragEvent, targetBaId: string) => {
    e.preventDefault();
    if (activeDrag) {
      setActiveDrag((prev) => (prev ? { ...prev, currentBaId: targetBaId } : null));
    }
  };

  const handleDrop = (e: React.DragEvent, targetBaId: string) => {
    e.preventDefault();
    if (!activeDrag) return;

    const booking = activeDrag.booking;
    const sourceBaId = activeDrag.sourceBaId;

    if (sourceBaId !== targetBaId) {
      setPendingReassign({
        booking,
        sourceBaId,
        targetBaId
      });
    }

    setActiveDrag(null);
  };

  const timelineScrollRef = useRef<HTMLDivElement>(null);
  const periodPickerRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const [isStuck, setIsStuck] = useState(false);
  const canCreateBooking = role === 'PM_PO' || role === 'BA_MANAGER';
  const isMobile = useIsMobile();

  const { setVisible } = useGlobalFab();

  // Hide the FAB when local drawers or detail modals are open
  useEffect(() => {
    const isAnyModalOpen = Boolean(draft) || Boolean(selectedBooking);
    setVisible(!isAnyModalOpen);
    return () => {
      setVisible(true);
    };
  }, [draft, selectedBooking, setVisible]);

  // Register "New booking" primary action for the Speed Dial
  useFabAction(
    canCreateBooking
      ? {
          label: 'New booking',
          icon: <Plus className="h-5 w-5" />,
          onPress: openCreateBooking
        }
      : null,
    [canCreateBooking, openCreateBooking]
  );

  const prefersCoarsePointer = usePrefersCoarsePointer();
  const allowDragSelection =
    canCreateBooking && !prefersCoarsePointer && viewMode === 'week';
  const currentDate = useMemo(() => new Date(), []);
  const effectiveCompactMobileInfo = isMobile && compactMobileInfo;

  useEffect(() => {
    if (!isMobile) {
      setIsStuck(false);
      return;
    }

    function handleScroll() {
      if (!cardRef.current) return;
      const cardTop = cardRef.current.getBoundingClientRect().top;
      setIsStuck(cardTop < 60);
    }

    window.addEventListener('scroll', handleScroll, { passive: true });
    handleScroll();
    return () => window.removeEventListener('scroll', handleScroll);
  }, [isMobile]);

  useEffect(() => {
    if (!isMobile) {
      setCompactMobileInfo(false);
    }
  }, [isMobile]);

  useEffect(() => {
    window.localStorage.setItem(timelineViewModeStorageKey, viewMode);
  }, [viewMode]);

  useEffect(() => {
    setPickerYear(Number(format(anchorDate, 'yyyy')));
  }, [anchorDate]);

  useEffect(() => {
    if (!periodPickerOpen) {
      return;
    }

    function handlePointerDown(event: Event) {
      const target = event.target as Node;
      if (periodPickerRef.current?.contains(target)) {
        return;
      }
      setPeriodPickerOpen(false);
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setPeriodPickerOpen(false);
      }
    }

    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [periodPickerOpen]);

  const columns = useMemo(
    () => buildTimelineColumns(viewMode, anchorDate),
    [anchorDate, viewMode]
  );
  const timelineStart = columns[0]?.start ?? anchorDate;
  const timelineEnd = columns[columns.length - 1]?.end ?? anchorDate;
  const periodLabel = useMemo(
    () => formatTimelinePeriodLabelUi(viewMode, timelineStart, timelineEnd),
    [timelineEnd, timelineStart, viewMode]
  );

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
    queryKey: [
      'capacity-summary',
      role,
      format(timelineStart, 'yyyy-MM-dd'),
      format(timelineEnd, 'yyyy-MM-dd')
    ],
    queryFn: () =>
      apiFetch<{
        average_capacity: number;
        counts: Record<string, number>;
        items: CapacitySummaryItem[];
      }>(
        `/api/capacity/summary?start_date=${format(timelineStart, 'yyyy-MM-dd')}&end_date=${format(timelineEnd, 'yyyy-MM-dd')}`
      )
  });

  const timelineBas = useMemo(
    () =>
      (bas.data ?? []).filter((ba) => ba.status === 'ACTIVE' || ba.status === 'ON_LEAVE'),
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

  const displayBookings = useMemo(() => {
    const activeBookingId = activeDrag?.booking.id || pendingReassign?.booking.id;
    const targetBaId = activeDrag?.currentBaId || pendingReassign?.targetBaId;

    if (!activeBookingId || !targetBaId) {
      return visibleBookings;
    }

    return visibleBookings.map((b) => {
      if (b.id === activeBookingId) {
        return { ...b, ba_id: targetBaId };
      }
      return b;
    });
  }, [visibleBookings, activeDrag, pendingReassign]);

  const capacityByBaId = useMemo(
    () => new Map((summary.data?.items ?? []).map((item) => [item.ba_id, item])),
    [summary.data]
  );
  const sortedVisibleBas = useMemo(() => {
    const basToSort = [...visibleBas];
    if (baSortMode === 'capacity_desc') {
      return basToSort.sort(
        (left, right) =>
          (capacityByBaId.get(right.id)?.utilization_percent ?? 0) -
          (capacityByBaId.get(left.id)?.utilization_percent ?? 0) ||
          left.full_name.localeCompare(right.full_name)
      );
    }

    if (baSortMode === 'capacity_asc') {
      return basToSort.sort(
        (left, right) =>
          (capacityByBaId.get(left.id)?.utilization_percent ?? 0) -
          (capacityByBaId.get(right.id)?.utilization_percent ?? 0) ||
          left.full_name.localeCompare(right.full_name)
      );
    }

    return basToSort.sort((left, right) => left.full_name.localeCompare(right.full_name));
  }, [baSortMode, capacityByBaId, visibleBas]);
  const rowData = useMemo(
    () =>
      sortedVisibleBas.map((ba) => {
        const baBookings = displayBookings.filter((booking) => booking.ba_id === ba.id);
        return {
          ba,
          bookings: baBookings,
          desktopRowMinHeight: computeRowMinHeight(
            columns,
            baBookings,
            desktopBarBaseTop,
            desktopBookingLaneStep,
            72
          ),
          mobileRowMinHeight: computeRowMinHeight(
            columns,
            baBookings,
            viewMode === 'week' ? mobileBarBaseTop : 16,
            mobileBookingLaneStep,
            viewMode === 'week' ? 120 : 72
          )
        };
      }),
    [columns, sortedVisibleBas, displayBookings, viewMode]
  );

  function cycleBaSortMode() {
    setBaSortMode((current) =>
      current === 'name'
        ? 'capacity_desc'
        : current === 'capacity_desc'
          ? 'capacity_asc'
          : 'name'
    );
  }

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
    if (isMobile) return;
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

  function handleSelectPeriod(nextDate: Date) {
    setAnchorDate(normalizeAnchorDate(viewMode, nextDate));
    setPeriodPickerOpen(false);
  }

  return (
    <div className="grid grid-cols-1 gap-5">
      {successMessage ? (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm font-medium text-emerald-800">
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
      <PageHeader
        eyebrow="Planning"
        title="Timeline"
        description="Plan BA workload on the Gantt timeline. Filter by BA or project, move between periods, and review assignment pressure quickly."
      />
      <div>
        <div className="grid w-full gap-2 sm:grid-cols-[minmax(150px,1fr)_minmax(160px,1fr)] lg:flex lg:w-full lg:flex-nowrap lg:items-center">
          <select
            value={baFilter}
            onChange={(event) => setBaFilter(event.target.value)}
            className="h-9 w-full min-w-0 rounded-lg border bg-white px-2 text-sm lg:w-48"
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
            className="h-9 w-full min-w-0 rounded-lg border bg-white px-2 text-sm lg:w-52"
          >
            <option value="">All Projects</option>
            {(projects.data ?? []).map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </select>
          {canCreateBooking ? (
            <Button className="hidden lg:ml-auto lg:inline-flex" onClick={openCreateBooking}>
              <Plus className="h-4 w-4" /> Create booking
            </Button>
          ) : null}
        </div>
      </div>
      {isMobile ? (
        <div className="flex justify-start">
          <button
            type="button"
            onClick={cycleBaSortMode}
            className="inline-flex h-9 items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 shadow-sm transition-colors hover:bg-slate-50 hover:text-slate-950"
            title={`Sort BA by capacity. Current: ${formatBaSortMode(baSortMode)}`}
          >
            <ArrowUpDown className="h-3.5 w-3.5" />
            <span>Sort BA</span>
            <span className="text-[11px] text-slate-400">
              {formatBaSortModeCompact(baSortMode)}
            </span>
          </button>
        </div>
      ) : null}
      <Card ref={cardRef} className="overflow-clip">
        <div className={cn('sticky top-[60px] z-20 flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-white p-4 sm:p-6 lg:static', !isStuck && 'rounded-t-2xl')}>
          <div
            ref={periodPickerRef}
            className="relative flex w-full flex-none items-center justify-between gap-2 sm:min-w-fit sm:flex-1 sm:justify-start"
          >
            <Button variant="secondary" size="icon" onClick={() => move(-1)}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <div className="flex min-w-0 flex-1 items-center gap-2 sm:min-w-56 sm:flex-none">
              <Button
                variant="secondary"
                className="min-w-0 flex-1 justify-between px-2.5 text-xs sm:px-3 sm:text-sm"
                onClick={() => setPeriodPickerOpen((current) => !current)}
              >
                <span className="truncate">{periodLabel}</span>
                <ChevronDown className="h-4 w-4 shrink-0" />
              </Button>
              <Button
                variant="secondary"
                className="shrink-0 px-2.5 text-xs sm:px-3 sm:text-sm"
                onClick={() => setAnchorDate(normalizeAnchorDate(viewMode, new Date()))}
              >
                Today
              </Button>
            </div>
            <Button variant="secondary" size="icon" onClick={() => move(1)}>
              <ChevronRight className="h-4 w-4" />
            </Button>
            {periodPickerOpen ? (
              <PeriodPickerPopover
                viewMode={viewMode}
                pickerYear={pickerYear}
                anchorDate={anchorDate}
                onYearChange={setPickerYear}
                onSelect={handleSelectPeriod}
              />
            ) : null}
          </div>
          <div className="flex w-full flex-none items-center justify-between gap-2 text-sm font-medium text-slate-600 sm:min-w-fit sm:flex-1 sm:justify-end">
            <span className="hidden lg:inline">View mode</span>
            <div className="grid w-full grid-cols-3 rounded-lg border border-slate-200 bg-slate-100 p-1 sm:inline-flex sm:w-auto">
              {(['week', 'month', 'quarter'] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => {
                    setViewMode(mode);
                    setAnchorDate(getCurrentAnchorDate(mode));
                  }}
                  className={cn(
                    'w-full rounded-md px-2 py-1.5 text-[11px] font-semibold capitalize transition-colors sm:px-3 sm:text-sm',
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
        <CardHeader className="gap-0 p-0">
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
              <div className="mt-2 grid gap-1.5 text-xs sm:grid-cols-2 xl:grid-cols-3">
                <div className="flex items-center gap-1.5">
                  <span className="h-3 w-6 rounded bg-blue-600" /> Approved/In progress
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="h-3 w-6 rounded border border-emerald-200 bg-emerald-100/90" />{' '}
                  Completed
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="h-3 w-6 rounded border border-dashed border-amber-400 bg-amber-100" />{' '}
                  Pending
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="h-3 w-6 rounded border border-rose-200 bg-rose-100/80" />{' '}
                  Rejected
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="h-3 w-6 rounded border border-slate-200 bg-slate-200" />{' '}
                  Cancelled
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="flex h-3 w-6 items-center justify-center rounded bg-rose-600 text-white">
                    <AlertTriangle className="h-2 w-2" />
                  </span>{' '}
                  Capacity conflict
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
              'overflow-x-auto overscroll-x-contain pb-2',
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
                  ? `repeat(${columns.length}, minmax(${
                      viewMode === 'quarter'
                        ? mobileQuarterColumnMinWidth
                        : viewMode === 'month'
                          ? mobileMonthColumnMinWidth
                          : mobileWeekDayMinWidth
                    }px, 1fr))`
                  : `${baInfoColumnWidth}px repeat(${columns.length}, minmax(${viewMode === 'week' ? 92 : 132}px, 1fr))`
              }}
            >
              {!isMobile && (
                <>
                  <button
                    type="button"
                    onClick={cycleBaSortMode}
                    className="pointer-events-auto h-14 border-b border-r bg-white p-3 text-left text-xs font-semibold text-slate-600 transition hover:bg-slate-50 hover:text-slate-900"
                    title={`Sort BA by capacity. Current: ${formatBaSortMode(baSortMode)}`}
                  >
                    <span className="flex items-center justify-between gap-2">
                      <span>BA</span>
                      <span className="flex items-center gap-1 text-[10px] text-slate-400">
                        {formatBaSortModeCompact(baSortMode)}
                        <ArrowUpDown className="h-3.5 w-3.5 shrink-0 text-slate-500" />
                      </span>
                    </span>
                  </button>
                  {columns.map((column) => (
                    <div
                      key={column.id}
                      className={cn(
                        'grid h-14 place-items-center border-b border-r bg-white p-3 text-center text-xs font-semibold text-slate-600',
                        isCurrentTimelineColumn(column, currentDate) &&
                        'bg-blue-50/80 text-blue-700'
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
                      'grid h-14 place-items-center border-b border-r bg-white px-2 py-2 text-center text-[11px] font-semibold text-slate-600',
                      isCurrentTimelineColumn(column, currentDate) &&
                      'bg-blue-50/80 text-blue-700'
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
                      viewMode={viewMode}
                      columns={columns}
                      bookings={baBookings}
                      rowMinHeight={mobileRowMinHeight}
                      isAlternateRow={isAlternateRow}
                      canCreateBooking={canCreateBooking}
                      hasOverbookRisk={
                        (summary.data?.items.find((item) => item.ba_id === ba.id)
                          ?.risk_capacity ?? 0) > 100
                      }
                      currentDate={currentDate}
                      riskCapacity={
                        summary.data?.items.find((item) => item.ba_id === ba.id)
                          ?.risk_capacity ?? 0
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
                      viewMode={viewMode}
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
                        (summary.data?.items.find((item) => item.ba_id === ba.id)
                          ?.risk_capacity ?? 0) > 100
                      }
                      currentDate={currentDate}
                      onEmptyClick={(column) =>
                        setDraft({
                          ba_id: ba.id,
                          start_date: format(column.start, 'yyyy-MM-dd'),
                          end_date: format(column.end, 'yyyy-MM-dd'),
                          direct: false
                        })
                      }
                      onBookingClick={setSelectedBooking}
                      isManagerRole={isManagerRole}
                      onDragStart={handleDragStart}
                      onDragEnd={handleDragEnd}
                      onDragEnter={handleDragEnter}
                      onDrop={handleDrop}
                    />
                  );
                }
              )}
            </div>
          </div>
          {isMobile ? (
            <div className="pointer-events-none absolute left-2 top-14 z-10">
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
                      className="absolute left-0"
                      style={{
                        top: rowTop + 6,
                        width: effectiveCompactMobileInfo
                          ? mobileBaCardCompactWidth
                          : mobileBaCardWidth
                      }}
                    >
                      <MobileBAIdentity
                        ba={ba}
                        compact={effectiveCompactMobileInfo}
                        utilization={capacity?.utilization_percent ?? 0}
                        flagged={Boolean(
                          capacity?.conflict_risk || capacity?.invalid_overbook
                        )}
                        tooltip={utilizationTooltip(viewMode, capacity)}
                        onWheel={handleMobileIdentityWheel}
                      />
                    </div>
                  );
                });
              })()}
            </div>
          ) : (
            <div className="pointer-events-none absolute left-0 top-0 z-20 hidden lg:block">
              <button
                type="button"
                onClick={cycleBaSortMode}
                className="pointer-events-auto h-14 w-[260px] border-b border-r bg-white p-3 text-left text-xs font-semibold text-slate-600 transition hover:bg-slate-50 hover:text-slate-900"
                title={`Sort BA by capacity. Current: ${formatBaSortMode(baSortMode)}`}
              >
                <span className="flex items-center justify-between gap-2">
                  <span>BA</span>
                  <span className="flex items-center gap-1 text-[10px] text-slate-400">
                    {formatBaSortModeCompact(baSortMode)}
                    <ArrowUpDown className="h-3.5 w-3.5 shrink-0 text-slate-500" />
                  </span>
                </span>
              </button>
              {rowData.map(({ ba, desktopRowMinHeight }, index) => {
                const capacity = summary.data?.items.find((item) => item.ba_id === ba.id);
                const isAlternateRow = index % 2 === 1;
                const utilization = capacity?.utilization_percent ?? 0;
                const flagged = Boolean(capacity?.invalid_overbook || capacity?.conflict_risk);

                return (
                  <div
                    key={ba.id}
                    className={cn(
                      'pointer-events-auto flex w-[260px] items-center justify-between border-b border-r p-2 lg:p-3',
                      flagged
                        ? 'bg-rose-50 ring-1 ring-inset ring-rose-300'
                        : isAlternateRow
                          ? 'bg-sky-50'
                          : 'bg-white'
                    )}
                    style={{ height: desktopRowMinHeight }}
                    onClick={(event) => event.stopPropagation()}
                    onPointerDown={(event) => event.stopPropagation()}
                  >
                    <BAIdentity ba={ba} showNameTooltip />
                    <span
                      className="flex shrink-0 items-center gap-1.5"
                      title={utilizationTooltip(viewMode, capacity)}
                    >
                      {flagged ? <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-rose-600" /> : null}
                      <span className={cn('text-sm font-bold', capacityColor(utilization))}>
                        {utilization}%
                      </span>
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
        allBookings={bookings.data ?? []}
        allBas={bas.data ?? []}
        capacitySummaryItems={summary.data?.items ?? []}
        onClose={() => setSelectedBooking(null)}
        onDone={() => {
          setSelectedBooking(null);
          void queryClient.invalidateQueries();
        }}
      />
      {pendingReassign && (
        <div className="fixed bottom-6 left-1/2 z-50 flex flex-col gap-3 -translate-x-1/2 rounded-xl border border-slate-200 bg-white p-4 shadow-2xl animate-in fade-in slide-in-from-bottom-4 max-w-lg">
          <div className="flex items-center gap-4">
            <div className="text-sm text-slate-700">
              Confirm reassignment of <strong>{pendingReassign.booking.project.name}</strong> from{' '}
              <strong>{pendingReassign.booking.ba?.full_name ?? 'Unassigned'}</strong> to{' '}
              <strong>{bas.data?.find((ba) => ba.id === pendingReassign.targetBaId)?.full_name ?? 'Unassigned'}</strong>?
            </div>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="secondary"
                onClick={() => setPendingReassign(null)}
                disabled={confirmReassign.isPending}
              >
                Cancel
              </Button>
              <Button
                size="sm"
                onClick={() => confirmReassign.mutate()}
                disabled={confirmReassign.isPending}
              >
                {confirmReassign.isPending ? 'Saving...' : 'Confirm'}
              </Button>
            </div>
          </div>
          {confirmReassign.error && (
            <div className="rounded-lg bg-rose-50 p-2.5 text-xs text-rose-700 border border-rose-100 max-h-24 overflow-y-auto">
              {confirmReassign.error.message}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function TimelineRow({
  ba,
  viewMode,
  columns,
  bookings,
  rowMinHeight,
  isAlternateRow,
  canCreateBooking,
  allowDragSelection,
  hasOverbookRisk,
  currentDate,
  activeSelection,
  onSelectionStart,
  onSelectionMove,
  onSelectionEnd,
  onEmptyClick,
  onBookingClick,
  isManagerRole,
  onDragStart,
  onDragEnd,
  onDragEnter,
  onDrop
}: {
  ba: BAProfile;
  viewMode: TimelineViewMode;
  columns: TimelineColumn[];
  bookings: Booking[];
  rowMinHeight: number;
  isAlternateRow: boolean;
  canCreateBooking: boolean;
  allowDragSelection: boolean;
  hasOverbookRisk: boolean;
  currentDate: Date;
  activeSelection: DraftSelection | null;
  onSelectionStart: (baId: string, day: Date, pointerId: number) => void;
  onSelectionMove: (baId: string, day: Date, pointerId: number) => void;
  onSelectionEnd: (pointerId: number) => void;
  onEmptyClick: (column: TimelineColumn) => void;
  onBookingClick: (booking: Booking) => void;
  isManagerRole?: boolean;
  onDragStart?: (e: React.DragEvent, booking: Booking, baId: string) => void;
  onDragEnd?: (e: React.DragEvent) => void;
  onDragEnter?: (e: React.DragEvent, targetBaId: string) => void;
  onDrop?: (e: React.DragEvent, targetBaId: string) => void;
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
          selectedRange &&
          column.start >= selectedRange.start &&
          column.start <= selectedRange.end
        );

        return (
          <button
            key={`${ba.id}-${column.id}`}
            className={cn(
              'group select-none border-b border-r p-1 text-left text-xs text-slate-400',
              dayCellBackground(isAlternateRow),
              hasOverbookRisk && 'bg-rose-50/60',
              isCurrentTimelineColumn(column, currentDate) &&
              'bg-blue-50/75 text-slate-500',
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
            onDragEnter={(e) => onDragEnter?.(e, ba.id)}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => onDrop?.(e, ba.id)}
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
        onDragEnter={(e) => onDragEnter?.(e, ba.id)}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => onDrop?.(e, ba.id)}
      >
        <div
          className="relative overflow-hidden"
          style={{ minHeight: rowMinHeight, marginTop: -rowMinHeight }}
        >
          {layouts.map(({ booking, leftPercent, widthPercent, lane, clippedLeft, clippedRight }) => {
            const isDraggable = isManagerRole && hasOverbookRisk;
            return (
              <button
                key={booking.id}
                draggable={isDraggable}
                onDragStart={(e) => {
                  if (isDraggable) {
                    onDragStart?.(e, booking, ba.id);
                  }
                }}
                onDragEnd={(e) => {
                  if (isDraggable) {
                    onDragEnd?.(e);
                  }
                }}
                onDragEnter={(e) => onDragEnter?.(e, ba.id)}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => onDrop?.(e, ba.id)}
                className={cn(
                  'pointer-events-auto absolute h-8 truncate rounded-lg px-2 text-left text-xs font-semibold shadow-sm transition',
                  bookingBarClass(booking.status, hasOverbookRisk),
                  clippedLeft && 'rounded-l-none',
                  clippedRight && 'rounded-r-none',
                  isDraggable ? 'cursor-grab active:cursor-grabbing hover:scale-[1.02] hover:-translate-y-0.5' : 'hover:-translate-y-0.5'
                )}
                style={{
                  left: `${leftPercent}%`,
                  width: bookingBarWidth(widthPercent),
                  top: `${desktopBarBaseTop + lane * desktopBookingLaneStep}px`
                }}
                onClick={() => onBookingClick(booking)}
                title={bookingBarTooltip(booking)}
                aria-label={`${booking.status} booking ${booking.title}`}
              >
                <span className="inline-flex min-w-0 items-center gap-1">
                  {hasOverbookRisk ? (
                    <AlertTriangle className="h-3 w-3 shrink-0" />
                  ) : null}
                  <span className={cn('truncate', bookingLabelClass(booking.status))}>
                    {viewMode === 'week' ? (
                      <>
                        {booking.project.name} - {booking.capacity_percent}%
                        {hasOverbookRisk ? ' - Conflict' : ''}
                      </>
                    ) : (
                      `${booking.project.name} - ${booking.capacity_percent}%`
                    )}
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
  viewMode,
  columns,
  bookings,
  rowMinHeight,
  isAlternateRow,
  canCreateBooking,
  hasOverbookRisk,
  currentDate,
  onEmptyClick,
  onBookingClick
}: {
  ba: BAProfile;
  viewMode: TimelineViewMode;
  columns: TimelineColumn[];
  bookings: Booking[];
  rowMinHeight: number;
  isAlternateRow: boolean;
  canCreateBooking: boolean;
  hasOverbookRisk: boolean;
  currentDate: Date;
  riskCapacity: number;
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
            'group select-none border-b border-r border-slate-200 p-1.5 text-left text-[11px] text-slate-400',
            viewMode === 'week' ? 'pt-12' : 'pt-1.5',
            dayCellBackground(isAlternateRow),
            hasOverbookRisk && 'bg-rose-50/60',
            isCurrentTimelineColumn(column, currentDate) &&
            'bg-blue-50/75 text-slate-500',
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
          className="relative overflow-hidden"
          style={{ minHeight: rowMinHeight, marginTop: -rowMinHeight }}
        >
          {layouts.map(({ booking, leftPercent, widthPercent, lane, clippedLeft, clippedRight }) => {
            return (
              <button
                key={booking.id}
                className={cn(
                  'pointer-events-auto absolute h-9 truncate rounded-lg px-2 text-left text-[11px] font-semibold shadow-sm transition hover:-translate-y-0.5',
                  bookingBarClass(booking.status, hasOverbookRisk),
                  clippedLeft && 'rounded-l-none',
                  clippedRight && 'rounded-r-none'
                )}
                style={{
                  left: `${leftPercent}%`,
                  width: bookingBarWidth(widthPercent),
                  top: `${(viewMode === 'week' ? mobileBarBaseTop : 16) + lane * mobileBookingLaneStep}px`
                }}
                onClick={() => onBookingClick(booking)}
                title={bookingBarTooltip(booking)}
                aria-label={`${booking.status} booking ${booking.title}`}
              >
                <span className="inline-flex min-w-0 items-center gap-1.5">
                  {hasOverbookRisk ? (
                    <AlertTriangle className="h-3 w-3 shrink-0" />
                  ) : null}
                  <span className={cn('truncate', bookingLabelClass(booking.status))}>
                    {booking.project.name} - {booking.capacity_percent}%
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
  utilization,
  flagged,
  tooltip,
  onWheel
}: {
  ba: BAProfile;
  compact: boolean;
  utilization: number;
  flagged: boolean;
  tooltip: string;
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
      title={tooltip}
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
      {ba.status === 'ON_LEAVE' && (
        <span className="shrink-0 inline-flex items-center rounded bg-amber-50 px-1 py-0.5 text-[8px] font-medium text-amber-800 ring-1 ring-inset ring-amber-600/20">
          ON LEAVE
        </span>
      )}
      <span
        className={cn(
          'inline-flex shrink-0 items-center overflow-hidden whitespace-nowrap leading-none text-slate-500 transition-all duration-200 ease-out',
          compact ? 'max-w-0 translate-x-2 opacity-0' : 'max-w-20 translate-x-0 opacity-100'
        )}
      >
        - {ba.level}
      </span>
      <span
        className={cn(
          'inline-flex shrink-0 items-center gap-0.5 font-bold',
          capacityColor(utilization)
        )}
      >
        {flagged ? <AlertTriangle className="h-3 w-3 text-rose-600" /> : null}
        {utilization}%
      </span>
    </button>
  );
}

function PeriodPickerPopover({
  viewMode,
  pickerYear,
  anchorDate,
  onYearChange,
  onSelect
}: {
  viewMode: TimelineViewMode;
  pickerYear: number;
  anchorDate: Date;
  onYearChange: (year: number) => void;
  onSelect: (date: Date) => void;
}) {
  const weekSections = useMemo(() => buildWeekPickerSectionsUi(pickerYear), [pickerYear]);

  return (
    <div className="absolute left-0 top-full z-30 mt-3 w-[min(92vw,34rem)] overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl shadow-slate-900/10">
      <div className="flex items-center justify-between gap-3 border-b border-slate-200 bg-slate-50 px-4 py-3">
        <Button variant="secondary" size="sm" onClick={() => onYearChange(pickerYear - 1)}>
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <div className="text-center">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            {viewMode === 'week'
              ? 'Pick a week'
              : viewMode === 'month'
                ? 'Pick a month'
                : 'Pick a quarter'}
          </p>
          <p className="text-base font-bold text-slate-950">{pickerYear}</p>
        </div>
        <Button variant="secondary" size="sm" onClick={() => onYearChange(pickerYear + 1)}>
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>

      <div className="max-h-[24rem] overflow-y-auto p-4">
        {viewMode === 'week' ? (
          <div className="grid gap-4">
            {weekSections.map((section) => (
              <div key={section.monthLabel} className="grid gap-2">
                <p className="text-sm font-semibold text-slate-800">{section.monthLabel}</p>
                <div className="grid gap-2">
                  {section.weeks.map((week) => {
                    const selected =
                      format(startOfWeek(anchorDate, { weekStartsOn: 1 }), 'yyyy-MM-dd') ===
                      format(week.start, 'yyyy-MM-dd');
                    return (
                      <button
                        key={`${section.monthLabel}-${format(week.start, 'yyyy-MM-dd')}`}
                        type="button"
                        onClick={() => onSelect(week.start)}
                        className={cn(
                          'flex items-center justify-between rounded-2xl border px-3 py-2 text-left transition',
                          selected
                            ? 'border-blue-300 bg-blue-50 text-blue-800'
                            : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50'
                        )}
                      >
                        <span className="text-sm font-semibold">{week.label}</span>
                        <span className="text-xs text-slate-500">
                          {format(week.start, 'dd/MM')} - {format(week.end, 'dd/MM')}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        ) : null}

        {viewMode === 'month' ? (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {Array.from({ length: 12 }, (_, monthIndex) => {
              const monthDate = new Date(pickerYear, monthIndex, 1);
              const selected =
                format(startOfMonth(anchorDate), 'yyyy-MM') === format(monthDate, 'yyyy-MM');
              return (
                <button
                  key={format(monthDate, 'yyyy-MM')}
                  type="button"
                  onClick={() => onSelect(monthDate)}
                  className={cn(
                    'rounded-2xl border px-3 py-4 text-left transition',
                    selected
                      ? 'border-blue-300 bg-blue-50 text-blue-800'
                      : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50'
                  )}
                >
                  <p className="text-sm font-semibold">{format(monthDate, 'MMMM')}</p>
                  <p className="mt-1 text-xs text-slate-500">{format(monthDate, 'MM/yyyy')}</p>
                </button>
              );
            })}
          </div>
        ) : null}

        {viewMode === 'quarter' ? (
          <div className="grid gap-3 sm:grid-cols-2">
            {[0, 1, 2, 3].map((quarterIndex) => {
              const quarterDate = startOfQuarter(new Date(pickerYear, quarterIndex * 3, 1));
              const quarterEnd = endOfQuarter(quarterDate);
              const selected =
                format(startOfQuarter(anchorDate), 'yyyy-MM-dd') ===
                format(quarterDate, 'yyyy-MM-dd');
              return (
                <button
                  key={format(quarterDate, 'yyyy-MM-dd')}
                  type="button"
                  onClick={() => onSelect(quarterDate)}
                  className={cn(
                    'rounded-2xl border px-4 py-4 text-left transition',
                    selected
                      ? 'border-blue-300 bg-blue-50 text-blue-800'
                      : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50'
                  )}
                >
                  <p className="text-base font-semibold">Q{format(quarterDate, 'Q')}</p>
                  <p className="mt-1 text-sm text-slate-500">
                    {format(quarterDate, 'MMM yyyy')} - {format(quarterEnd, 'MMM yyyy')}
                  </p>
                </button>
              );
            })}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function PeriodPickerModal({
  open,
  viewMode,
  pickerYear,
  anchorDate,
  onYearChange,
  onClose,
  onSelect
}: {
  open: boolean;
  viewMode: TimelineViewMode;
  pickerYear: number;
  anchorDate: Date;
  onYearChange: (year: number) => void;
  onClose: () => void;
  onSelect: (date: Date) => void;
}) {
  const weekSections = useMemo(() => buildWeekPickerSections(pickerYear), [pickerYear]);

  return (
    <Modal
      title={
        viewMode === 'week'
          ? 'Select week'
          : viewMode === 'month'
            ? 'Select month'
            : 'Select quarter'
      }
      open={open}
      onClose={onClose}
    >
      <div className="grid gap-4">
        <div className="flex items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2">
          <Button variant="secondary" size="sm" onClick={() => onYearChange(pickerYear - 1)}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <div className="text-center">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Timeframe year
            </p>
            <p className="text-lg font-bold text-slate-950">{pickerYear}</p>
          </div>
          <Button variant="secondary" size="sm" onClick={() => onYearChange(pickerYear + 1)}>
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>

        {viewMode === 'week' ? (
          <div className="grid max-h-[60vh] gap-4 overflow-y-auto pr-1">
            {weekSections.map((section) => (
              <div key={section.monthLabel} className="grid gap-2">
                <p className="text-sm font-semibold capitalize text-slate-800">
                  {section.monthLabel}
                </p>
                <div className="grid gap-2">
                  {section.weeks.map((week) => {
                    const selected =
                      format(startOfWeek(anchorDate, { weekStartsOn: 1 }), 'yyyy-MM-dd') ===
                      format(week.start, 'yyyy-MM-dd');
                    return (
                      <button
                        key={`${section.monthLabel}-${format(week.start, 'yyyy-MM-dd')}`}
                        type="button"
                        onClick={() => onSelect(week.start)}
                        className={cn(
                          'flex items-center justify-between rounded-2xl border px-3 py-2 text-left transition',
                          selected
                            ? 'border-blue-300 bg-blue-50 text-blue-800'
                            : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50'
                        )}
                      >
                        <span className="text-sm font-semibold">{week.label}</span>
                        <span className="text-xs text-slate-500">
                          {format(week.start, 'dd/MM')} - {format(week.end, 'dd/MM')}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        ) : null}

        {viewMode === 'month' ? (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {Array.from({ length: 12 }, (_, monthIndex) => {
              const monthDate = new Date(pickerYear, monthIndex, 1);
              const selected =
                format(startOfMonth(anchorDate), 'yyyy-MM') === format(monthDate, 'yyyy-MM');
              return (
                <button
                  key={format(monthDate, 'yyyy-MM')}
                  type="button"
                  onClick={() => onSelect(monthDate)}
                  className={cn(
                    'rounded-2xl border px-3 py-4 text-left transition',
                    selected
                      ? 'border-blue-300 bg-blue-50 text-blue-800'
                      : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50'
                  )}
                >
                  <p className="text-sm font-semibold">{format(monthDate, 'MMMM')}</p>
                  <p className="mt-1 text-xs text-slate-500">{format(monthDate, 'MM/yyyy')}</p>
                </button>
              );
            })}
          </div>
        ) : null}

        {viewMode === 'quarter' ? (
          <div className="grid gap-3 sm:grid-cols-2">
            {[0, 1, 2, 3].map((quarterIndex) => {
              const quarterDate = startOfQuarter(new Date(pickerYear, quarterIndex * 3, 1));
              const quarterEnd = endOfQuarter(quarterDate);
              const selected =
                format(startOfQuarter(anchorDate), 'yyyy-MM-dd') ===
                format(quarterDate, 'yyyy-MM-dd');
              return (
                <button
                  key={format(quarterDate, 'yyyy-MM-dd')}
                  type="button"
                  onClick={() => onSelect(quarterDate)}
                  className={cn(
                    'rounded-2xl border px-4 py-4 text-left transition',
                    selected
                      ? 'border-blue-300 bg-blue-50 text-blue-800'
                      : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50'
                  )}
                >
                  <p className="text-base font-semibold">Q{format(quarterDate, 'Q')}</p>
                  <p className="mt-1 text-sm text-slate-500">
                    {format(quarterDate, 'MM/yyyy')} - {format(quarterEnd, 'MM/yyyy')}
                  </p>
                  <p className="mt-3 text-xs font-semibold uppercase tracking-wide text-slate-400">
                    Strategic summary view
                  </p>
                </button>
              );
            })}
          </div>
        ) : null}
      </div>
    </Modal>
  );
}

void PeriodPickerModal;

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

function BookingDetailModal({
  booking,
  allBookings,
  allBas,
  capacitySummaryItems,
  onClose,
  onDone
}: {
  booking: Booking | null;
  allBookings: Booking[];
  allBas: BAProfile[];
  capacitySummaryItems: CapacitySummaryItem[];
  onClose: () => void;
  onDone: () => void;
}) {
  const { user } = useAuth();
  const role = user?.role ?? 'BA';
  const isManagerRole = role === 'BA_MANAGER';
  const [capacityDraft, setCapacityDraft] = useState('50');
  const [decisionKind, setDecisionKind] = useState<'reject' | 'cancel' | null>(null);
  const [decisionReason, setDecisionReason] = useState('');
  const [selectedBaId, setSelectedBaId] = useState<string>('');
  const [baSearch, setBaSearch] = useState('');
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);

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
        rangesOverlap(
          item.start_date,
          item.end_date,
          booking.start_date,
          booking.end_date
        )
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
      current.dateRanges.push(
        `${formatDate(item.start_date)} - ${formatDate(item.end_date)}`
      );
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
    setSelectedBaId(booking?.ba_id ?? '');
    setBaSearch('');
    setIsDropdownOpen(false);
  }, [bookingId, bookingCapacity, booking?.ba_id]);

  const capacityPercent =
    parseCapacityPercent(capacityDraft) ?? booking?.capacity_percent ?? 50;
  const canEditCapacity = isManagerRole && booking?.status === 'PENDING';
  const capacityChanged = Boolean(
    booking && canEditCapacity && capacityPercent !== booking.capacity_percent
  );
  const now = new Date();
  const todayStr = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-${String(now.getUTCDate()).padStart(2, '0')}`;
  const startStr = booking
    ? typeof booking.start_date === 'string'
      ? booking.start_date.slice(0, 10)
      : new Date(booking.start_date).toISOString().slice(0, 10)
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
  const reassign = useMutation({
    mutationFn: () => {
      if (!booking || !selectedBaId) {
        return Promise.resolve(null);
      }
      return apiFetch(`/api/bookings/${booking.id}/assign`, {
        method: 'PATCH',
        body: JSON.stringify({ ba_id: selectedBaId })
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

  const recommendationQuery = useMemo(() => {
    if (!booking) return null;
    if (!booking.start_date || !booking.end_date) return null;
    if (booking.end_date < booking.start_date) return null;
    const cap = capacityPercent;
    if (!Number.isFinite(cap) || cap < 1 || cap > 100) return null;
    const { requiredSkillIds, requiredLevel } = getBookingRequirements(booking);
    return {
      start_date: typeof booking.start_date === 'string'
        ? booking.start_date.slice(0, 10)
        : new Date(booking.start_date).toISOString().slice(0, 10),
      end_date: typeof booking.end_date === 'string'
        ? booking.end_date.slice(0, 10)
        : new Date(booking.end_date).toISOString().slice(0, 10),
      capacity_percent: cap,
      project_id: booking.project_id,
      required_skill_ids: requiredSkillIds.length ? requiredSkillIds : undefined,
      level: requiredLevel || undefined,
      limit: 5
    };
  }, [booking, capacityPercent]);

  const filteredBas = useMemo(() => {
    const search = baSearch.toLowerCase().trim();
    const capacityMap = new Map(
      (capacitySummaryItems ?? []).map((item) => [item.ba_id, item])
    );

    return allBas
      .map((ba) => {
        const cap = capacityMap.get(ba.id);
        return {
          ba,
          availability: Math.max(0, 100 - (cap?.approved_capacity ?? 0)),
          riskCapacity: cap?.risk_capacity ?? 0
        };
      })
      .filter((item) => !search || item.ba.full_name.toLowerCase().includes(search))
      .sort((a, b) => a.riskCapacity - b.riskCapacity);
  }, [allBas, baSearch, capacitySummaryItems]);

  const selectedBa = allBas.find((ba) => ba.id === selectedBaId);

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
  const maxApprovedCapacity = capacityDetail.data?.max_approved_capacity ?? 0;
  const invalidOverbook = maxApprovedCapacity > 100;
  const hasConflict = maxRiskCapacity > 100;
  const suggestedMaxApprove = Math.max(0, 100 - maxApprovedCapacity);
  const firstConflictDay = capacityDetail.data?.daily.find(
    (day) => day.risk_capacity > 100
  );

  return (
    <Modal title="Booking Detail" open={Boolean(booking)} onClose={onClose}>
      <div className="grid gap-4 text-sm">
        <div className="flex items-center justify-between gap-3">
          <BAIdentity ba={booking.ba} />
          <StatusBadge status={booking.status} />
        </div>
        <div className="rounded-lg border p-4">
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
        {hasConflict ? (
          <div className="grid gap-3 rounded-lg border border-rose-200 bg-rose-50 p-4 text-rose-950">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="font-semibold">
                  {invalidOverbook ? 'Invalid overbook' : 'Capacity conflict'}
                </p>
                <p className="mt-1 text-xs text-rose-700">
                  {invalidOverbook
                    ? `Approved load reaches ${maxApprovedCapacity}% (over 100%)`
                    : `Approved + pending reaches ${maxRiskCapacity}% if all approved`}
                  {firstConflictDay ? ` on ${formatDate(firstConflictDay.date)}` : ''}.
                </p>
                <p className="mt-1 text-xs font-semibold text-rose-800">
                  Max capacity you can approve for this BA: {suggestedMaxApprove}%
                </p>
              </div>
              <AlertTriangle className="h-5 w-5 shrink-0 text-rose-700" />
            </div>
            <div className="grid gap-2 text-sm">
              <p>BA: {booking.ba?.full_name ?? 'Unassigned'}</p>
              <p>
                Selected booking: {booking.project.name} - {booking.capacity_percent}% -{' '}
                {formatDate(booking.start_date)} - {formatDate(booking.end_date)}
              </p>
              <div className="grid gap-1">
                {projectBreakdown.map((item) => (
                  <div key={item.project} className="rounded-lg bg-white/70 px-3 py-2">
                    <p className="font-semibold">
                      {item.project}: {item.capacity}%
                    </p>
                    <p className="mt-1 text-xs text-rose-700">
                      {item.dateRanges.join(', ')}
                    </p>
                  </div>
                ))}
              </div>
              <div className="grid gap-1 text-xs text-rose-700 sm:grid-cols-2">
                <span>Resolve: reduce capacity to {suggestedMaxApprove}% or less</span>
                <span>Resolve: split work across multiple BA</span>
                <span>Resolve: assign another BA</span>
                <span>Resolve: reject this request</span>
              </div>
            </div>
          </div>
        ) : null}

        {isManagerRole ? (
          <div className="grid gap-3 rounded-lg border p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="font-semibold text-slate-950">Reassign BA</p>
                <p className="mt-1 text-xs text-slate-500">
                  Current: {booking.ba?.full_name ?? 'Unassigned'}
                </p>
              </div>
              {selectedBaId !== (booking.ba_id ?? '') && (
                <span className="rounded-lg px-2 py-1 text-xs font-semibold ring-1 ring-inset bg-amber-50 text-amber-700 ring-amber-200 animate-pulse">
                  Changed
                </span>
              )}
            </div>

            <RecommendationDropdown
              query={recommendationQuery}
              selectedBaId={selectedBaId}
              onSelectCandidate={(baId) => setSelectedBaId(baId)}
            />

            <div className="relative">
              <div
                className="flex cursor-pointer items-center justify-between rounded-xl border border-slate-200 bg-white p-3 hover:border-slate-300"
                onClick={() => setIsDropdownOpen(!isDropdownOpen)}
              >
                {selectedBa ? (
                  <div className="flex items-center gap-3">
                    <Avatar name={selectedBa.full_name} url={selectedBa.avatar_url} />
                    <div>
                      <p className="text-sm font-semibold text-slate-950">
                        {selectedBa.full_name}
                      </p>
                      <p className="text-xs text-slate-500">{selectedBa.level}</p>
                    </div>
                  </div>
                ) : (
                  <p className="text-sm text-slate-500">Choose a BA...</p>
                )}
                <ChevronDown
                  className={`h-4 w-4 text-slate-400 transition ${isDropdownOpen ? 'rotate-180' : ''}`}
                />
              </div>

              {isDropdownOpen && (
                <div className="absolute bottom-full left-0 right-0 z-10 mb-2 flex flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl">
                  <div className="flex items-center gap-2 border-b border-slate-100 p-3">
                    <Search className="h-4 w-4 text-slate-400" />
                    <input
                      autoFocus
                      className="w-full text-sm outline-none"
                      placeholder="Search BAs..."
                      value={baSearch}
                      onChange={(e) => setBaSearch(e.target.value)}
                    />
                  </div>
                  <div className="max-h-[200px] overflow-y-auto">
                    {filteredBas.map((item) => (
                      <div
                        key={item.ba.id}
                        className="flex cursor-pointer items-center justify-between gap-3 p-3 hover:bg-slate-50"
                        onClick={() => {
                          setSelectedBaId(item.ba.id);
                          setIsDropdownOpen(false);
                        }}
                      >
                        <div className="flex items-center gap-3">
                          <Avatar name={item.ba.full_name} url={item.ba.avatar_url} />
                          <div>
                            <p className="text-sm font-medium text-slate-950">
                              {item.ba.full_name}
                            </p>
                            <p className="text-xs text-slate-500">{item.ba.level}</p>
                          </div>
                        </div>
                        <div className="text-right">
                          <p
                            className={`text-xs font-semibold ${item.availability < 20 ? 'text-rose-600' : 'text-slate-600'}`}
                          >
                            {item.availability}% Avail.
                          </p>
                          <p className="text-[10px] text-slate-400">
                            {item.riskCapacity}% load
                          </p>
                        </div>
                      </div>
                    ))}
                    {filteredBas.length === 0 && (
                      <div className="p-3 text-center text-xs text-slate-500">No BAs found</div>
                    )}
                  </div>
                </div>
              )}
            </div>

            {selectedBaId !== (booking.ba_id ?? '') && (
              <div className="flex justify-end gap-2 animate-in fade-in slide-in-from-top-1">
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => setSelectedBaId(booking.ba_id ?? '')}
                  disabled={reassign.isPending}
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  onClick={() => reassign.mutate()}
                  disabled={reassign.isPending}
                >
                  {reassign.isPending ? 'Saving...' : 'Save assignment'}
                </Button>
              </div>
            )}
          </div>
        ) : null}

        {canEditCapacity ? (
          <div className="grid gap-3 rounded-lg border p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="font-semibold text-slate-950">Capacity decision</p>
                <p className="mt-1 text-xs text-slate-500">
                  Requested: {booking.capacity_percent}%
                </p>
              </div>
              <span
                className={[
                  'rounded-lg px-2 py-1 text-xs font-semibold ring-1 ring-inset',
                  capacityChanged
                    ? 'bg-amber-50 text-amber-700 ring-amber-200'
                    : 'bg-gray-100 text-gray-700 ring-gray-200'
                ].join(' ')}
              >
                {capacityChanged ? 'Edited' : 'Current'}
              </span>
            </div>
            <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
              <div className="grid grid-cols-4 rounded-lg border border-slate-200 bg-slate-100 p-1">
                {CAPACITY_OPTIONS.map((option) => (
                  <button
                    key={option}
                    type="button"
                    onClick={() => setCapacityDraft(String(option))}
                    className={[
                      'h-9 rounded-lg text-sm font-semibold transition-colors',
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
            className="grid gap-3 rounded-lg border border-slate-200 bg-slate-50 p-4"
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
                className="min-h-24 rounded-lg border border-slate-200 bg-white p-3 text-sm"
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
        {approve.error || reject.error || cancel.error || updateCapacity.error || reassign.error ? (
          <div className="rounded-lg bg-rose-50 p-3 text-rose-700">
            {
              (approve.error ?? reject.error ?? cancel.error ?? updateCapacity.error ?? reassign.error)
                ?.message
            }
          </div>
        ) : null}
      </div>
    </Modal>
  );
}
