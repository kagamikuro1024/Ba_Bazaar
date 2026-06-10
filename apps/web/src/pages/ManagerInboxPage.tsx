import { type ReactNode, useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertCircle,
  ChevronDown,
  ChevronRight,
  Search
} from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import { useAuth } from '@/auth/AuthProvider';
import {
  apiFetch,
  getManagerRequestState,
  getRequestType,
  needsManagerVerification,
  type BAProfile,
  type Booking,
  type BookingPriority,
  type BookingStatus,
  type RequestType
} from '@/lib/api';
import { CAPACITY_OPTIONS, parseCapacityPercent } from '@/lib/capacity';
import { formatDate, priorityTone } from '@/lib/format';
import {
  ActiveFilterChips,
  AdvancedFilterPopover,
  DataToolbar,
  DataTable,
  FilterCard,
  PageHeader,
  Pagination,
  QuickTabs,
  type ActiveFilter,
  type QuickTab
} from '@/components';
import { Avatar, BAIdentity } from '@/components/common';
import { RecommendationDropdown } from '@/components/ba/RecommendationDropdown';
import { type RecommendationQuery } from '@/lib/recommendations';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { LoadingScreen } from '@/components/ui/loading-screen';
import { Modal } from '@/components/ui/modal';
import { setInboxDirty, type InboxDirtySummaryItem } from '@/lib/unsaved-changes';

type CapacitySummary = {
  items: Array<{
    ba_id: string;
    approved_capacity: number;
    pending_capacity: number;
    risk_capacity: number;
  }>;
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

type InboxTab = 'ALL' | 'URGENT' | 'UNASSIGNED' | 'PENDING' | 'OVERBOOK_RISK';

type FilterState = {
  search: string;
  priority: 'ALL' | BookingPriority;
  status: 'ALL' | BookingStatus;
  type: 'ALL' | RequestType;
  sort: 'NEWEST' | 'OLDEST' | 'PRIORITY' | 'CAPACITY_RISK';
  startDate: string;
  endDate: string;
  needsVerification: boolean;
  overbookRisk: boolean;
};

type PendingChangeEntry = {
  key: string;
  label: string;
  currentDisplay: string;
  proposedDisplay: string;
  proposedInputValue: string;
};

type DecisionModalState = {
  kind: 'reject' | 'cancel';
  bookingId: string;
  title: string;
} | null;

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

const defaultFilters: FilterState = {
  search: '',
  priority: 'ALL',
  status: 'ALL',
  type: 'ALL',
  sort: 'PRIORITY',
  startDate: '',
  endDate: '',
  needsVerification: false,
  overbookRisk: false
};

const priorityFilterOptions: Array<{
  value: FilterState['priority'];
  label: string;
}> = [
  { value: 'ALL', label: 'All' },
  { value: 'URGENT', label: 'Urgent' },
  { value: 'HIGH', label: 'High' },
  { value: 'MEDIUM', label: 'Medium' },
  { value: 'LOW', label: 'Low' }
];

const statusFilterOptions: Array<{
  value: FilterState['status'];
  label: string;
}> = [
  { value: 'ALL', label: 'All' },
  { value: 'PENDING', label: 'Pending' },
  { value: 'APPROVED', label: 'Approved' },
  { value: 'REJECTED', label: 'Rejected' },
  { value: 'IN_PROGRESS', label: 'In progress' },
  { value: 'COMPLETED', label: 'Completed' },
  { value: 'CANCELLED', label: 'Cancelled' }
];

const requestTypeFilterOptions: Array<{
  value: FilterState['type'];
  label: string;
}> = [
  { value: 'ALL', label: 'All' },
  { value: 'SPECIFIC_BA', label: 'Specific BA' },
  { value: 'OPEN_REQUEST', label: 'Open Request' }
];

export function ManagerInboxPage() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const canManageInbox = user?.role === 'BA_MANAGER';
  const [searchParams, setSearchParams] = useSearchParams();
  const [assignDrafts, setAssignDrafts] = useState<Record<string, string>>({});
  const [capacityDrafts, setCapacityDrafts] = useState<Record<string, string>>({});
  const [successMessage, setSuccessMessage] = useState('');
  const [saveForLaterMessage, setSaveForLaterMessage] = useState('');
  const [confirmationState, setConfirmationState] = useState<{
    title: string;
    body: string;
    confirmLabel: string;
    action: () => void;
  } | null>(null);
  const [mobileDetailOpen, setMobileDetailOpen] = useState(false);
  const [decisionModal, setDecisionModal] = useState<DecisionModalState>(null);
  const [decisionReason, setDecisionReason] = useState('');
  const [pendingChangeDraftDirty, setPendingChangeDraftDirty] = useState(false);
  const [reviewModalOpen, setReviewModalOpen] = useState(false);
  const [changeDrafts, setChangeDrafts] = useState<Record<string, string>>({});
  const [pendingNavigationAction, setPendingNavigationAction] = useState<
    (() => void) | null
  >(null);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [filterDraft, setFilterDraft] = useState<FilterState>(defaultFilters);
  const isMobile = useIsMobile();
  const pageSize = 10;

  const filters = useMemo<FilterState>(() => {
    const type = searchParams.get('type');
    const priority = searchParams.get('priority');
    const status = searchParams.get('status');

    return {
      search: searchParams.get('search') ?? '',
      priority: isBookingPriority(priority) ? priority : 'ALL',
      status: isBookingStatus(status) ? status : 'ALL',
      type: isRequestType(type) ? type : 'ALL',
      sort: isSortOption(searchParams.get('sort'))
        ? (searchParams.get('sort') as FilterState['sort'])
        : 'PRIORITY',
      startDate: searchParams.get('startDate') ?? '',
      endDate: searchParams.get('endDate') ?? '',
      needsVerification: searchParams.get('needsVerification') === 'true',
      overbookRisk: searchParams.get('overbookRisk') === 'true'
    };
  }, [searchParams]);

  const activeTab = useMemo<InboxTab>(() => {
    if (filters.overbookRisk) {
      return 'OVERBOOK_RISK';
    }

    if (filters.priority === 'URGENT') {
      return 'URGENT';
    }

    if (filters.type === 'OPEN_REQUEST') {
      return 'UNASSIGNED';
    }

    if (filters.status === 'PENDING') {
      return 'PENDING';
    }

    return 'ALL';
  }, [filters.overbookRisk, filters.priority, filters.status, filters.type]);

  const bookings = useQuery({
    queryKey: ['manager-inbox-bookings'],
    queryFn: () => apiFetch<Booking[]>('/api/bookings')
  });
  const bas = useQuery({
    queryKey: ['manager-inbox-bookable-bas'],
    queryFn: () => apiFetch<BAProfile[]>('/api/ba?bookable=true')
  });
  const summary = useQuery({
    queryKey: ['manager-inbox-capacity-summary'],
    queryFn: () => apiFetch<CapacitySummary>('/api/capacity/summary')
  });

  const filteredBookings = useMemo(() => {
    const capacityByBaId = new Map(
      (summary.data?.items ?? []).map((item) => [item.ba_id, item])
    );
    const riskBaIds = new Set(
      [...capacityByBaId.values()]
        .filter((item) => item.risk_capacity > 100 || item.approved_capacity > 100)
        .map((item) => item.ba_id)
    );

    return (bookings.data ?? [])
      .filter((booking) => {
        const requestType = getRequestType(booking);
        const requestState = getManagerRequestState(booking);
        const searchBlob = [
          booking.title,
          booking.project.name,
          booking.requester.full_name,
          booking.ba?.full_name ?? ''
        ]
          .join(' ')
          .toLowerCase();

        if (filters.search && !searchBlob.includes(filters.search.toLowerCase())) {
          return false;
        }

        if (filters.priority !== 'ALL' && booking.priority !== filters.priority) {
          return false;
        }

        if (filters.status !== 'ALL' && booking.status !== filters.status) {
          return false;
        }

        if (filters.type !== 'ALL' && requestType !== filters.type) {
          return false;
        }

        if (filters.needsVerification && requestState !== 'NEED_VERIFICATION') {
          return false;
        }

        if (filters.overbookRisk && !(booking.ba_id && riskBaIds.has(booking.ba_id))) {
          return false;
        }

        if (filters.startDate && booking.end_date < filters.startDate) {
          return false;
        }

        if (filters.endDate && booking.start_date > filters.endDate) {
          return false;
        }

        return true;
      })
      .sort((left, right) => {
        if (filters.sort === 'NEWEST') {
          return (
            new Date(right.created_at).getTime() - new Date(left.created_at).getTime()
          );
        }

        if (filters.sort === 'OLDEST') {
          return (
            new Date(left.created_at).getTime() - new Date(right.created_at).getTime()
          );
        }

        if (filters.sort === 'CAPACITY_RISK') {
          const leftCapacity = left.ba_id ? capacityByBaId.get(left.ba_id) : undefined;
          const rightCapacity = right.ba_id ? capacityByBaId.get(right.ba_id) : undefined;
          const leftRisk =
            leftCapacity &&
            (leftCapacity.approved_capacity > 100 || leftCapacity.risk_capacity > 100)
              ? 1
              : 0;
          const rightRisk =
            rightCapacity &&
            (rightCapacity.approved_capacity > 100 || rightCapacity.risk_capacity > 100)
              ? 1
              : 0;
          if (leftRisk !== rightRisk) {
            return rightRisk - leftRisk;
          }
        }

        const leftCapacity = left.ba_id ? capacityByBaId.get(left.ba_id) : undefined;
        const rightCapacity = right.ba_id ? capacityByBaId.get(right.ba_id) : undefined;
        const leftScore = getInboxPriorityScore(left, {
          hasCapacityRisk: Boolean(
            leftCapacity &&
            leftCapacity.approved_capacity <= 100 &&
            leftCapacity.risk_capacity > 100
          ),
          hasOverbooked: Boolean(leftCapacity && leftCapacity.approved_capacity > 100)
        });
        const rightScore = getInboxPriorityScore(right, {
          hasCapacityRisk: Boolean(
            rightCapacity &&
            rightCapacity.approved_capacity <= 100 &&
            rightCapacity.risk_capacity > 100
          ),
          hasOverbooked: Boolean(rightCapacity && rightCapacity.approved_capacity > 100)
        });
        if (leftScore !== rightScore) {
          return rightScore - leftScore;
        }

        const byCreatedAt =
          new Date(left.created_at).getTime() - new Date(right.created_at).getTime();
        if (byCreatedAt !== 0) {
          return byCreatedAt;
        }

        return new Date(left.start_date).getTime() - new Date(right.start_date).getTime();
      });
  }, [bookings.data, filters, summary.data]);

  const counts = useMemo(() => {
    const riskBaIds = new Set(
      (summary.data?.items ?? [])
        .filter((item) => item.risk_capacity > 100)
        .map((item) => item.ba_id)
    );
    const allBookings = bookings.data ?? [];

    return {
      ALL: allBookings.length,
      URGENT: allBookings.filter((booking) => booking.priority === 'URGENT').length,
      UNASSIGNED: allBookings.filter((booking) => !booking.ba_id).length,
      PENDING: allBookings.filter((booking) => booking.status === 'PENDING').length,
      OVERBOOK_RISK: allBookings.filter(
        (booking) => booking.ba_id && riskBaIds.has(booking.ba_id)
      ).length
    };
  }, [bookings.data, summary.data]);

  const quickTabs = useMemo<Array<QuickTab<InboxTab>>>(
    () => [
      { value: 'ALL', label: 'All', count: counts.ALL },
      { value: 'URGENT', label: 'Urgent', count: counts.URGENT, tone: 'danger' },
      {
        value: 'UNASSIGNED',
        label: 'Unassigned',
        count: counts.UNASSIGNED,
        tone: 'warning'
      },
      { value: 'PENDING', label: 'Pending', count: counts.PENDING, tone: 'warning' },
      {
        value: 'OVERBOOK_RISK',
        label: 'Overbook risk',
        count: counts.OVERBOOK_RISK,
        tone: 'danger'
      }
    ],
    [counts]
  );

  const activeAdvancedFilterCount = useMemo(
    () =>
      Number(filters.priority !== 'ALL') +
      Number(filters.status !== 'ALL') +
      Number(filters.type !== 'ALL') +
      Number(Boolean(filters.startDate)) +
      Number(Boolean(filters.endDate)) +
      Number(filters.needsVerification) +
      Number(filters.overbookRisk),
    [filters]
  );

  const activeFilterChips: ActiveFilter[] = [];

  if (filters.search) {
    activeFilterChips.push({
      id: 'search',
      label: `Search: ${filters.search}`,
      onRemove: () => setFilter({ search: '' })
    });
  }

  if (filters.priority !== 'ALL') {
    activeFilterChips.push({
      id: 'priority',
      label: `Priority: ${filters.priority}`,
      onRemove: () => setFilter({ priority: 'ALL' })
    });
  }

  if (filters.status !== 'ALL') {
    activeFilterChips.push({
      id: 'status',
      label: `Status: ${filters.status.replaceAll('_', ' ')}`,
      onRemove: () => setFilter({ status: 'ALL' })
    });
  }

  if (filters.type !== 'ALL') {
    activeFilterChips.push({
      id: 'type',
      label:
        filters.type === 'OPEN_REQUEST' ? 'Type: Open Request' : 'Type: Specific BA',
      onRemove: () => setFilter({ type: 'ALL' })
    });
  }

  if (filters.startDate) {
    activeFilterChips.push({
      id: 'startDate',
      label: `From: ${filters.startDate}`,
      onRemove: () => setFilter({ startDate: '' })
    });
  }

  if (filters.endDate) {
    activeFilterChips.push({
      id: 'endDate',
      label: `To: ${filters.endDate}`,
      onRemove: () => setFilter({ endDate: '' })
    });
  }

  if (filters.needsVerification) {
    activeFilterChips.push({
      id: 'needsVerification',
      label: 'Needs verification',
      onRemove: () => setFilter({ needsVerification: false })
    });
  }

  if (filters.overbookRisk) {
    activeFilterChips.push({
      id: 'overbookRisk',
      label: 'Overbook risk',
      onRemove: () => setFilter({ overbookRisk: false })
    });
  }

  const currentPage = Math.max(1, Number(searchParams.get('page') ?? '1') || 1);
  const totalPages = Math.max(1, Math.ceil(filteredBookings.length / pageSize));
  const safePage = Math.min(currentPage, totalPages);
  const paginatedBookings = filteredBookings.slice(
    (safePage - 1) * pageSize,
    safePage * pageSize
  );

  const selectedRequestId = searchParams.get('requestId');
  const selectedBooking = useMemo(() => {
    if (!selectedRequestId) {
      return null;
    }

    return (
      filteredBookings.find((booking) => booking.id === selectedRequestId) ??
      bookings.data?.find((booking) => booking.id === selectedRequestId) ??
      null
    );
  }, [bookings.data, filteredBookings, selectedRequestId]);

  useEffect(() => {
    if (!filteredBookings.length) {
      return;
    }

    const pageParam = searchParams.get('page');

    if (!selectedRequestId) {
      if (safePage !== currentPage) {
        const nextParams = new URLSearchParams(searchParams);
        nextParams.set('page', String(safePage));
        setSearchParams(nextParams, { replace: true });
      }
      return;
    }

    if (pageParam) {
      return;
    }

    const bookingIndex = filteredBookings.findIndex(
      (booking) => booking.id === selectedRequestId
    );
    if (bookingIndex === -1) {
      return;
    }

    const requestPage = Math.floor(bookingIndex / pageSize) + 1;
    if (requestPage !== safePage) {
      const nextParams = new URLSearchParams(searchParams);
      nextParams.set('page', String(requestPage));
      setSearchParams(nextParams, { replace: true });
    }
  }, [
    currentPage,
    filteredBookings,
    pageSize,
    safePage,
    searchParams,
    selectedRequestId,
    setSearchParams
  ]);

  const selectedBaId =
    (selectedBooking && assignDrafts[selectedBooking.id]) || selectedBooking?.ba_id || '';
  const selectedCapacityDraft = selectedBooking
    ? (capacityDrafts[selectedBooking.id] ?? String(selectedBooking.capacity_percent))
    : '';
  const selectedCapacityPercent =
    parseCapacityPercent(selectedCapacityDraft) ??
    selectedBooking?.capacity_percent ??
    50;
  const selectedBookableBa = bas.data?.find((ba) => ba.id === selectedBaId);
  const selectedBookingId = selectedBooking?.id;
  const selectedBookingCapacity = selectedBooking?.capacity_percent;
  const selectedPendingChangeEntries = useMemo(
    () => (selectedBooking ? getPendingChangeEntries(selectedBooking) : []),
    [selectedBooking]
  );

  useEffect(() => {
    const draftDirty = selectedPendingChangeEntries.some((entry) => {
      const draft = changeDrafts[entry.key];
      return draft !== undefined && draft !== entry.proposedInputValue;
    });
    setPendingChangeDraftDirty(draftDirty);
    return () => setPendingChangeDraftDirty(false);
  }, [changeDrafts, selectedPendingChangeEntries]);

  const selectedCapacity = useQuery({
    queryKey: [
      'manager-inbox-capacity-detail',
      selectedBaId,
      selectedBooking?.start_date,
      selectedBooking?.end_date
    ],
    queryFn: () =>
      apiFetch<CapacityDetail>(
        `/api/capacity/ba/${selectedBaId}?start_date=${selectedBooking?.start_date}&end_date=${selectedBooking?.end_date}`
      ),
    enabled: Boolean(
      selectedBaId && selectedBooking?.start_date && selectedBooking?.end_date
    )
  });

  useEffect(() => {
    if (!selectedBookingId || selectedBookingCapacity === undefined) {
      return;
    }

    setCapacityDrafts((current) => ({
      ...current,
      [selectedBookingId]: String(selectedBookingCapacity)
    }));
  }, [selectedBookingId, selectedBookingCapacity]);

  useEffect(() => {
    if (!successMessage && !saveForLaterMessage) {
      return;
    }

    const timeout = window.setTimeout(() => {
      setSuccessMessage('');
      setSaveForLaterMessage('');
    }, 3000);

    return () => window.clearTimeout(timeout);
  }, [saveForLaterMessage, successMessage]);

  const approve = useMutation({
    mutationFn: async ({
      id,
      capacityPercent,
      currentCapacityPercent
    }: {
      id: string;
      capacityPercent: number;
      currentCapacityPercent: number;
    }) => {
      await saveCapacityIfChanged(id, capacityPercent, currentCapacityPercent);
      return apiFetch(`/api/bookings/${id}/approve`, { method: 'POST' });
    },
    onSuccess: () => handleMutationSuccess('Request approved.')
  });
  const reject = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      apiFetch(`/api/bookings/${id}/reject`, {
        method: 'POST',
        body: JSON.stringify({ reject_reason: reason })
      }),
    onSuccess: () => handleMutationSuccess('Request rejected.')
  });
  const assign = useMutation({
    mutationFn: async ({
      id,
      baId,
      capacityPercent,
      currentCapacityPercent
    }: {
      id: string;
      baId: string;
      capacityPercent: number;
      currentCapacityPercent: number;
    }) => {
      await saveCapacityIfChanged(id, capacityPercent, currentCapacityPercent);
      return apiFetch(`/api/bookings/${id}/assign`, {
        method: 'PATCH',
        body: JSON.stringify({ ba_id: baId })
      });
    },
    onSuccess: () => handleMutationSuccess('BA assigned.')
  });
  const assignAndApprove = useMutation({
    mutationFn: async ({
      id,
      baId,
      capacityPercent,
      currentCapacityPercent
    }: {
      id: string;
      baId: string;
      capacityPercent: number;
      currentCapacityPercent: number;
    }) => {
      await saveCapacityIfChanged(id, capacityPercent, currentCapacityPercent);
      await apiFetch(`/api/bookings/${id}/assign`, {
        method: 'PATCH',
        body: JSON.stringify({ ba_id: baId })
      });
      return apiFetch(`/api/bookings/${id}/approve`, { method: 'POST' });
    },
    onSuccess: () => handleMutationSuccess('BA assigned and request approved.')
  });
  const cancel = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      apiFetch(`/api/bookings/${id}/cancel`, {
        method: 'POST',
        body: JSON.stringify({ cancel_reason: reason })
      }),
    onSuccess: () => handleMutationSuccess('Request cancelled.')
  });
  const updateCapacity = useMutation({
    mutationFn: ({ id, capacityPercent }: { id: string; capacityPercent: number }) =>
      apiFetch(`/api/bookings/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ capacity_percent: capacityPercent })
      }),
    onSuccess: () => handleMutationSuccess('Capacity updated.', false)
  });
  const approveChanges = useMutation({
    mutationFn: ({ id, changes }: { id: string; changes: Record<string, unknown> }) =>
      apiFetch(`/api/bookings/${id}/changes/approve`, {
        method: 'POST',
        body: JSON.stringify(changes)
      }),
    onSuccess: () => handleMutationSuccess('Proposed changes approved.')
  });
  const rejectChanges = useMutation({
    mutationFn: ({ id }: { id: string }) =>
      apiFetch(`/api/bookings/${id}/changes/reject`, {
        method: 'POST'
      }),
    onSuccess: () => handleMutationSuccess('Proposed changes rejected.')
  });
  const approveFields = useMutation({
    mutationFn: ({
      id,
      fields,
      overrides
    }: {
      id: string;
      fields: string[];
      overrides?: Record<string, unknown>;
    }) =>
      apiFetch(`/api/bookings/${id}/changes/approve-fields`, {
        method: 'POST',
        body: JSON.stringify({ fields, overrides })
      }),
    onSuccess: () => handleMutationSuccess('Field change(s) approved.', false)
  });
  const rejectFields = useMutation({
    mutationFn: ({ id, fields }: { id: string; fields: string[] }) =>
      apiFetch(`/api/bookings/${id}/changes/reject-fields`, {
        method: 'POST',
        body: JSON.stringify({ fields })
      }),
    onSuccess: () => handleMutationSuccess('Field change(s) rejected.', false)
  });

  const assignDraftChanged = selectedBaId !== (selectedBooking?.ba_id ?? '');
  const capacityDraftChanged =
    selectedCapacityPercent !== (selectedBooking?.capacity_percent ?? 50);
  const hasUnsavedChanges = Boolean(
    assignDraftChanged || capacityDraftChanged || pendingChangeDraftDirty
  );
  const unsavedChangeSummary = useMemo(() => {
    if (!selectedBooking) return [];

    const summary: string[] = [];
    if (assignDraftChanged) {
      const nextBa = bas.data?.find((ba) => ba.id === selectedBaId);
      summary.push(
        `BA: ${selectedBooking.ba?.full_name ?? 'Unassigned'} -> ${nextBa?.full_name ?? 'Unassigned'}`
      );
    }

    if (capacityDraftChanged) {
      summary.push(
        `Capacity: ${selectedBooking.capacity_percent}% -> ${selectedCapacityDraft}%`
      );
    }

    const pendingEntries = getPendingChangeEntries(selectedBooking);
    for (const entry of pendingEntries) {
      const draftValue = changeDrafts[entry.key];
      const proposedValue =
        draftValue !== undefined && draftValue !== entry.proposedInputValue
          ? draftValue
          : entry.proposedDisplay;
      summary.push(`${entry.label}: ${entry.currentDisplay} -> ${proposedValue}`);
    }

    return summary;
  }, [
    assignDraftChanged,
    bas.data,
    capacityDraftChanged,
    changeDrafts,
    selectedBaId,
    selectedBooking,
    selectedCapacityDraft
  ]);

  const unsavedChangeSummaryItems = useMemo<InboxDirtySummaryItem[]>(() => {
    if (!selectedBooking) return [];

    const items: InboxDirtySummaryItem[] = [];
    if (assignDraftChanged) {
      const nextBa = bas.data?.find((ba) => ba.id === selectedBaId);
      items.push({
        id: 'ba_id',
        label: `BA: ${selectedBooking.ba?.full_name ?? 'Unassigned'} -> ${nextBa?.full_name ?? 'Unassigned'}`,
        approve: () =>
          apiFetch(`/api/bookings/${selectedBooking.id}/assign`, {
            method: 'PATCH',
            body: JSON.stringify({ ba_id: selectedBaId })
          }),
        reject: () =>
          setAssignDrafts((current) => {
            const next = { ...current };
            delete next[selectedBooking.id];
            return next;
          })
      });
    }

    if (capacityDraftChanged) {
      items.push({
        id: 'capacity_percent',
        label: `Capacity: ${selectedBooking.capacity_percent}% -> ${selectedCapacityDraft}%`,
        approve: () =>
          apiFetch(`/api/bookings/${selectedBooking.id}`, {
            method: 'PATCH',
            body: JSON.stringify({ capacity_percent: selectedCapacityPercent })
          }),
        reject: () =>
          setCapacityDrafts((current) => {
            const next = { ...current };
            delete next[selectedBooking.id];
            return next;
          })
      });
    }

    const pendingEntries = getPendingChangeEntries(selectedBooking);
    for (const entry of pendingEntries) {
      const draftValue = changeDrafts[entry.key];
      const proposedValue =
        draftValue !== undefined && draftValue !== entry.proposedInputValue
          ? draftValue
          : entry.proposedDisplay;
      items.push({
        id: entry.key,
        label: `${entry.label}: ${entry.currentDisplay} -> ${proposedValue}`,
        approve: () =>
          apiFetch(`/api/bookings/${selectedBooking.id}/changes/approve-fields`, {
            method: 'POST',
            body: JSON.stringify({
              fields: [entry.key],
              overrides:
                draftValue !== undefined
                  ? { [entry.key]: parsePendingChangeValue(entry, draftValue) }
                  : undefined
            })
          }),
        reject: () =>
          apiFetch(`/api/bookings/${selectedBooking.id}/changes/reject-fields`, {
            method: 'POST',
            body: JSON.stringify({ fields: [entry.key] })
          })
      });
    }

    return items;
  }, [
    assignDraftChanged,
    bas.data,
    capacityDraftChanged,
    changeDrafts,
    selectedBaId,
    selectedBooking,
    selectedCapacityDraft,
    selectedCapacityPercent
  ]);

  useEffect(() => {
    setInboxDirty(hasUnsavedChanges, unsavedChangeSummaryItems, {
      approveAndLeave: async () => {
        if (!selectedBooking) return;
        const pendingEntries = getPendingChangeEntries(selectedBooking);
        if (pendingEntries.length > 0) {
          await apiFetch(`/api/bookings/${selectedBooking.id}/changes/approve`, {
            method: 'POST',
            body: JSON.stringify(buildPendingChangePayload(pendingEntries, changeDrafts))
          });
        }
        if (assignDraftChanged && selectedBaId) {
          await apiFetch(`/api/bookings/${selectedBooking.id}/assign`, {
            method: 'PATCH',
            body: JSON.stringify({ ba_id: selectedBaId })
          });
        }
        if (capacityDraftChanged) {
          await apiFetch(`/api/bookings/${selectedBooking.id}`, {
            method: 'PATCH',
            body: JSON.stringify({ capacity_percent: selectedCapacityPercent })
          });
        }
        await queryClient.invalidateQueries();
      },
      rejectAndLeave: async () => {
        if (!selectedBooking) return;
        const pendingEntries = getPendingChangeEntries(selectedBooking);
        if (pendingEntries.length > 0) {
          await apiFetch(`/api/bookings/${selectedBooking.id}/changes/reject`, {
            method: 'POST'
          });
        }
        setAssignDrafts((current) => {
          const next = { ...current };
          delete next[selectedBooking.id];
          return next;
        });
        setCapacityDrafts((current) => {
          const next = { ...current };
          delete next[selectedBooking.id];
          return next;
        });
        setChangeDrafts({});
        await queryClient.invalidateQueries();
      }
    });
    return () => setInboxDirty(false);
  }, [
    assignDraftChanged,
    capacityDraftChanged,
    changeDrafts,
    hasUnsavedChanges,
    queryClient,
    selectedBaId,
    selectedBooking,
    selectedCapacityPercent,
    unsavedChangeSummaryItems
  ]);

  useEffect(() => {
    function handleBeforeUnload(event: BeforeUnloadEvent) {
      if (hasUnsavedChanges) {
        event.preventDefault();
      }
    }
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [hasUnsavedChanges]);

  function runOrConfirmNavigation(action: () => void) {
    if (hasUnsavedChanges) {
      setPendingNavigationAction(() => action);
      return;
    }

    action();
  }

  function continuePendingNavigation() {
    const action = pendingNavigationAction;
    setPendingNavigationAction(null);
    action?.();
  }

  useEffect(() => {
    if (!selectedBooking || !isMobile) {
      return;
    }

    if (searchParams.get('requestId')) {
      setMobileDetailOpen(true);
    } else {
      setMobileDetailOpen(false);
    }
  }, [isMobile, searchParams, selectedBooking]);

  async function saveCapacityIfChanged(
    id: string,
    capacityPercent: number,
    currentCapacityPercent: number
  ) {
    if (capacityPercent === currentCapacityPercent) {
      return false;
    }

    await apiFetch(`/api/bookings/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ capacity_percent: capacityPercent })
    });

    queryClient.setQueryData<Booking[] | undefined>(
      ['manager-inbox-bookings'],
      (current) =>
        current?.map((booking) =>
          booking.id === id ? { ...booking, capacity_percent: capacityPercent } : booking
        )
    );

    return true;
  }

  function handleMutationSuccess(message: string, closeDetail = true) {
    setSuccessMessage(message);
    setSaveForLaterMessage('');
    if (selectedBooking) {
      setAssignDrafts((current) => {
        const next = { ...current };
        delete next[selectedBooking.id];
        return next;
      });
      setCapacityDrafts((current) => {
        const next = { ...current };
        delete next[selectedBooking.id];
        return next;
      });
      setChangeDrafts({});
    }
    if (closeDetail) {
      setMobileDetailOpen(false);
      const params = new URLSearchParams(searchParams);
      params.delete('requestId');
      setSearchParams(params, { replace: true });
    }
    void queryClient.invalidateQueries();
  }

  function runWithCapacityConfirmation(confirmLabel: string, action: () => void) {
    if (!selectedBooking || !selectedBaId || !selectedBookableBa) {
      action();
      return;
    }

    const approvedCapacity = selectedCapacity.data?.max_approved_capacity ?? 0;
    const remainingAvailability = Math.max(0, 100 - approvedCapacity);
    const exceedsCapacity = approvedCapacity + selectedCapacityPercent > 100;
    const hasZeroAvailability = remainingAvailability <= 0;

    if (!hasZeroAvailability && !exceedsCapacity) {
      action();
      return;
    }

    setConfirmationState({
      title: exceedsCapacity ? 'Exceeds BA capacity' : 'Assign BA with 0% availability?',
      body: exceedsCapacity
        ? `${selectedBookableBa.full_name} would exceed 100% approved capacity with this action. Are you sure you want to continue?`
        : `${selectedBookableBa.full_name} currently has 0% availability for this period. Are you sure you want to continue?`,
      confirmLabel,
      action
    });
  }

  function setFilter(next: Partial<FilterState>) {
    runOrConfirmNavigation(() => {
      const params = new URLSearchParams(searchParams);
      const merged = { ...filters, ...next };

      setParam(params, 'search', merged.search);
      setParam(params, 'priority', merged.priority === 'ALL' ? '' : merged.priority);
      setParam(params, 'status', merged.status === 'ALL' ? '' : merged.status);
      setParam(params, 'type', merged.type === 'ALL' ? '' : merged.type);
      setParam(params, 'sort', merged.sort === 'PRIORITY' ? '' : merged.sort);
      setParam(params, 'startDate', merged.startDate);
      setParam(params, 'endDate', merged.endDate);
      setParam(params, 'needsVerification', merged.needsVerification ? 'true' : '');
      setParam(params, 'overbookRisk', merged.overbookRisk ? 'true' : '');
      params.delete('requestId');
      params.delete('page');
      setSearchParams(params);
    });
  }

  function toggleFilters() {
    if (!filtersOpen) {
      setFilterDraft(filters);
    }
    setFiltersOpen((current) => !current);
  }

  function updateFilterDraft(next: Partial<FilterState>) {
    setFilterDraft((current) => ({ ...current, ...next }));
  }

  function clearFilterDraft() {
    setFilterDraft((current) => ({
      ...current,
      priority: 'ALL',
      status: 'ALL',
      type: 'ALL',
      startDate: '',
      endDate: '',
      needsVerification: false,
      overbookRisk: false
    }));
  }

  function applyFilterDraft() {
    setFilter({
      priority: filterDraft.priority,
      status: filterDraft.status,
      type: filterDraft.type,
      startDate: filterDraft.startDate,
      endDate: filterDraft.endDate,
      needsVerification: filterDraft.needsVerification,
      overbookRisk: filterDraft.overbookRisk
    });
    setFiltersOpen(false);
  }

  function clearAllFilters() {
    setFilter(defaultFilters);
    setFilterDraft(defaultFilters);
    setFiltersOpen(false);
  }

  function setPage(page: number) {
    runOrConfirmNavigation(() => {
      const nextPage = Math.max(1, Math.min(page, totalPages));
      const params = new URLSearchParams(searchParams);
      params.set('page', String(nextPage));
      params.delete('requestId');
      setSearchParams(params);
    });
  }

  function selectTab(tab: InboxTab) {
    runOrConfirmNavigation(() => {
      const params = new URLSearchParams(searchParams);
      setParam(params, 'priority', '');
      setParam(params, 'type', '');
      setParam(params, 'status', '');
      setParam(params, 'overbookRisk', '');
      setParam(params, 'needsVerification', '');
      params.delete('requestId');
      params.delete('page');

      if (tab === 'ALL') {
        setSearchParams(params);
        return;
      }

      if (tab === 'URGENT') {
        setParam(params, 'priority', 'URGENT');
        setSearchParams(params);
        return;
      }

      if (tab === 'UNASSIGNED') {
        setParam(params, 'type', 'OPEN_REQUEST');
        setSearchParams(params);
        return;
      }

      if (tab === 'PENDING') {
        setParam(params, 'status', 'PENDING');
        setSearchParams(params);
        return;
      }

      setParam(params, 'overbookRisk', 'true');
      setSearchParams(params);
    });
  }

  function openDetail(id: string) {
    runOrConfirmNavigation(() => {
      const params = new URLSearchParams(searchParams);
      params.set('requestId', id);
      setSearchParams(params);
      if (isMobile) {
        setMobileDetailOpen(true);
      }
    });
  }

  function closeDetail() {
    runOrConfirmNavigation(() => {
      const params = new URLSearchParams(searchParams);
      params.delete('requestId');
      setSearchParams(params);
      setMobileDetailOpen(false);
    });
  }

  function handleReject(id: string) {
    const booking = bookings.data?.find((item) => item.id === id);
    setDecisionReason('');
    setDecisionModal({
      kind: 'reject',
      bookingId: id,
      title: booking?.title ?? 'this request'
    });
  }

  function handleCancel(id: string) {
    const booking = bookings.data?.find((item) => item.id === id);
    setDecisionReason('');
    setDecisionModal({
      kind: 'cancel',
      bookingId: id,
      title: booking?.title ?? 'this request'
    });
  }

  function submitDecision() {
    const reason = decisionReason.trim();
    if (!decisionModal || !reason) {
      return;
    }

    if (decisionModal.kind === 'reject') {
      reject.mutate(
        { id: decisionModal.bookingId, reason },
        {
          onSuccess: () => {
            setDecisionModal(null);
            setDecisionReason('');
            handleMutationSuccess('Request rejected.');
          }
        }
      );
      return;
    }

    cancel.mutate(
      { id: decisionModal.bookingId, reason },
      {
        onSuccess: () => {
          setDecisionModal(null);
          setDecisionReason('');
          handleMutationSuccess('Request cancelled.');
        }
      }
    );
  }

  const managerInboxColumns = [
    {
      id: 'priority',
      header: 'Priority',
      className: 'w-[5.75rem] xl:w-[6.5rem]',
      cell: (booking: Booking) => (
        <Badge tone={priorityTone(booking.priority)} className={actionCenterPriorityBadgeClassName}>
          {booking.priority}
        </Badge>
      )
    },
    {
      id: 'type',
      header: 'Type',
      className: 'w-[6.5rem] xl:w-[7.5rem]',
      cell: (booking: Booking) => <RequestTypeBadge booking={booking} />
    },
    {
      id: 'project',
      header: 'Project',
      className: 'w-[16rem] xl:w-[18rem] 2xl:w-[20rem]',
      cell: (booking: Booking) => {
        const capacity = summary.data?.items.find(
          (item) => item.ba_id === booking.ba_id
        );
        const riskFlags = getRequestRiskFlags(booking, capacity?.risk_capacity ?? 0);

        return (
          <div className="min-w-0 text-left">
            <p className="truncate font-semibold text-slate-950">
              {booking.project.name}
            </p>
            <p className="mt-1 truncate text-xs text-slate-500">{booking.title}</p>
            <p className="mt-1 truncate text-xs text-slate-500 xl:hidden">
              Requester: {booking.requester.full_name}
            </p>
            <span className="mt-2 flex flex-wrap gap-1">
              {riskFlags.map((flag) => (
                <Badge
                  key={flag}
                  tone={
                    flag === 'Normal'
                      ? 'neutral'
                      : flag === 'Overbook risk' || flag === 'Urgent'
                        ? 'danger'
                        : 'warning'
                  }
                >
                  {flag}
                </Badge>
              ))}
            </span>
          </div>
        );
      }
    },
    {
      id: 'requester',
      header: 'Requester',
      headerClassName: 'hidden xl:table-cell',
      className: 'hidden xl:table-cell xl:w-[8.5rem] 2xl:w-[9.5rem]',
      cell: (booking: Booking) => (
        <span className="block truncate text-slate-600">
          {booking.requester.full_name}
        </span>
      )
    },
    {
      id: 'ba',
      header: 'Requested / Assigned BA',
      className: 'w-[8.5rem] xl:w-[10rem] 2xl:w-[11rem]',
      cell: (booking: Booking) => (
        <span className="block truncate text-slate-600">
          {booking.ba?.full_name ?? 'Unassigned'}
        </span>
      )
    },
    {
      id: 'dateRange',
      header: 'Date Range',
      className: 'w-[7.75rem] xl:w-[8.75rem]',
      cell: (booking: Booking) => (
        <span className="text-slate-600">
          {formatDate(booking.start_date)} - {formatDate(booking.end_date)}
        </span>
      )
    },
    {
      id: 'status',
      header: 'Status',
      className: 'w-[7.75rem] xl:w-[8.75rem]',
      cell: (booking: Booking) => <RequestStateBadge booking={booking} />
    },
    {
      id: 'action',
      header: 'Action',
      headerClassName: 'text-right',
      className: 'w-[6.75rem] xl:w-[7.5rem] text-right',
      cell: (booking: Booking) => {
        const actionLabel = getRequestActionLabel(booking, canManageInbox);

        return (
          <Button
            type="button"
            size="sm"
            variant={actionLabel === 'View' ? 'secondary' : 'default'}
            className="min-w-[5.75rem] xl:min-w-[6.5rem]"
            onClick={(event) => {
              event.stopPropagation();
              openDetail(booking.id);
            }}
            aria-label={`${actionLabel} ${booking.title}`}
          >
            {actionLabel}
            <ChevronRight className="h-4 w-4" />
          </Button>
        );
      }
    }
  ];

  return (
    <div className="grid gap-5">
      {successMessage || saveForLaterMessage ? (
        <div className="fixed left-4 right-4 top-4 z-[60] flex flex-col gap-3 sm:left-auto sm:max-w-sm">
          {successMessage ? (
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-800 shadow-lg">
              <div className="flex items-start justify-between gap-3">
                <span>{successMessage}</span>
                <button
                  type="button"
                  className="text-emerald-700 hover:text-emerald-900"
                  onClick={() => setSuccessMessage('')}
                  aria-label="Dismiss success message"
                >
                  ×
                </button>
              </div>
            </div>
          ) : null}
          {saveForLaterMessage ? (
            <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-600 shadow-lg">
              <div className="flex items-start justify-between gap-3">
                <span>{saveForLaterMessage}</span>
                <button
                  type="button"
                  className="text-slate-500 hover:text-slate-700"
                  onClick={() => setSaveForLaterMessage('')}
                  aria-label="Dismiss reminder message"
                >
                  ×
                </button>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
      <PageHeader
        eyebrow="Manager workspace"
        title="Action Center"
        description="Review, assign, approve, and resolve BA booking requests."
      />
      {approve.error ||
      reject.error ||
      assign.error ||
      assignAndApprove.error ||
      cancel.error ||
      updateCapacity.error ||
      approveChanges.error ||
      rejectChanges.error ||
      approveFields.error ||
      rejectFields.error ? (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {
            (
              approve.error ??
              reject.error ??
              assign.error ??
              assignAndApprove.error ??
              cancel.error ??
              updateCapacity.error ??
              approveChanges.error ??
              rejectChanges.error ??
              approveFields.error ??
              rejectFields.error
            )?.message
          }
        </div>
      ) : null}
      {!canManageInbox ? (
        <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
          Admin support role can review this inbox but cannot approve, reject, cancel, or
          assign bookings.
        </div>
      ) : null}
      {bookings.isLoading || bas.isLoading || summary.isLoading ? (
        <LoadingScreen message="Loading manager inbox..." />
      ) : null}
      {bookings.error || bas.error || summary.error ? (
        <Card>
          <CardContent className="p-5 text-sm text-rose-700">
            Could not load manager inbox. Check API connection and retry.
          </CardContent>
        </Card>
      ) : null}

      <FilterCard>
        <div className="grid gap-3">
          <div className="grid gap-3 2xl:grid-cols-[minmax(0,1fr)_minmax(360px,440px)] 2xl:items-center">
            <QuickTabs<InboxTab>
              tabs={quickTabs}
              value={activeTab}
              onChange={selectTab}
              className="2xl:justify-start"
            />
            <DataToolbar
              searchPlaceholder="Filter by project, requester, or BA..."
              searchValue={filters.search}
              onSearchChange={(search) => setFilter({ search })}
              activeFilterCount={activeAdvancedFilterCount}
              filtersOpen={filtersOpen}
              onFiltersToggle={toggleFilters}
              className="2xl:justify-end"
            />
          </div>

          <ActiveFilterChips
            filters={activeFilterChips}
            onClearAll={clearAllFilters}
            className="border-t border-slate-100 pt-3"
          />

          <AdvancedFilterPopover
            open={filtersOpen}
            onClose={() => setFiltersOpen(false)}
            title="Filter requests"
            width={380}
            footer={
              <>
                <Button type="button" variant="ghost" onClick={clearFilterDraft}>
                  Clear
                </Button>
                <Button type="button" onClick={applyFilterDraft}>
                  Apply
                </Button>
              </>
            }
          >
            <FilterOptionGroup
              label="Priority"
              options={priorityFilterOptions}
              value={filterDraft.priority}
              onChange={(priority) => updateFilterDraft({ priority })}
            />
            <FilterOptionGroup
              label="Status"
              options={statusFilterOptions}
              value={filterDraft.status}
              onChange={(status) => updateFilterDraft({ status })}
            />
            <FilterOptionGroup
              label="Request type"
              options={requestTypeFilterOptions}
              value={filterDraft.type}
              onChange={(type) => updateFilterDraft({ type })}
            />
            <div className="grid gap-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Date range
              </p>
              <div className="grid gap-2 sm:grid-cols-2">
                <input
                  type="date"
                  value={filterDraft.startDate}
                  onChange={(event) =>
                    updateFilterDraft({ startDate: event.target.value })
                  }
                  className="h-10 rounded-md border border-slate-200 bg-white px-3 text-sm"
                />
                <input
                  type="date"
                  value={filterDraft.endDate}
                  onChange={(event) =>
                    updateFilterDraft({ endDate: event.target.value })
                  }
                  className="h-10 rounded-md border border-slate-200 bg-white px-3 text-sm"
                />
              </div>
            </div>
            <div className="grid gap-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Flags
              </p>
              <label className="flex items-center gap-2 rounded-md border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700">
                <input
                  type="checkbox"
                  checked={filterDraft.needsVerification}
                  onChange={(event) =>
                    updateFilterDraft({ needsVerification: event.target.checked })
                  }
                />
                Needs verification
              </label>
              <label className="flex items-center gap-2 rounded-md border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700">
                <input
                  type="checkbox"
                  checked={filterDraft.overbookRisk}
                  onChange={(event) =>
                    updateFilterDraft({ overbookRisk: event.target.checked })
                  }
                />
                Overbook risk
              </label>
            </div>
          </AdvancedFilterPopover>
        </div>
      </FilterCard>

      <div className="grid items-start gap-5">
        <div className="grid gap-3">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3">
            <p className="text-sm font-medium text-slate-500">
              Showing {filteredBookings.length} request
              {filteredBookings.length === 1 ? '' : 's'}
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm text-slate-500">Sort by</span>
              <select
                value={filters.sort}
                onChange={(event) =>
                  setFilter({ sort: event.target.value as FilterState['sort'] })
                }
                className="h-9 rounded-md border border-slate-200 bg-white px-3 text-sm"
              >
                <option value="PRIORITY">Priority</option>
                <option value="CAPACITY_RISK">Capacity risk</option>
                <option value="NEWEST">Newest</option>
                <option value="OLDEST">Oldest</option>
              </select>
            </div>
          </div>
          <DataTable<Booking>
            rows={paginatedBookings}
            columns={managerInboxColumns}
            tableClassName="table-fixed"
            rowKey={(booking) => booking.id}
            onRowClick={(booking) => openDetail(booking.id)}
            rowClassName={(booking) =>
              selectedBooking?.id === booking.id
                ? 'bg-blue-50/70 ring-1 ring-inset ring-blue-300'
                : undefined
            }
            emptyState="No requests match the current filters."
            isLoading={bookings.isLoading || bas.isLoading || summary.isLoading}
            loadingState="Loading requests..."
          />
          <Pagination
            page={safePage}
            pageSize={pageSize}
            total={filteredBookings.length}
            onPageChange={setPage}
            className="rounded-xl border border-slate-200 bg-white shadow-sm"
          />
        </div>

        {!isMobile && selectedBooking ? (
          <div
            className="fixed inset-0 z-50 bg-slate-950/25"
            onClick={closeDetail}
            role="presentation"
          >
            <aside
              className="absolute inset-y-0 right-0 flex w-full max-w-[1040px] flex-col overflow-hidden border-l border-slate-200 bg-slate-50 shadow-2xl"
              onClick={(event) => event.stopPropagation()}
              aria-label="Request detail"
            >
              <div className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-slate-200 bg-white px-5 py-4">
                <div className="min-w-0">
                  <p className="text-base font-semibold text-slate-950">Request detail</p>
                  <p className="truncate text-sm text-slate-500">
                    {selectedBooking.project.name}
                  </p>
                </div>
                <Button variant="secondary" onClick={closeDetail}>
                  Close
                </Button>
              </div>
              <div className="overflow-y-auto p-4">
                <RequestDetailPanel
                  booking={selectedBooking}
                  allBas={bas.data ?? []}
                  capacitySummary={summary.data}
                  selectedBaId={selectedBaId}
                  capacity={selectedCapacity.data}
                  capacityPercent={selectedCapacityPercent}
                  onSelectBa={(baId) =>
                    setAssignDrafts((current) => ({
                      ...current,
                      [selectedBooking.id]: baId
                    }))
                  }
                  onCapacityChange={(capacityPercent) =>
                    setCapacityDrafts((current) => ({
                      ...current,
                      [selectedBooking.id]: String(capacityPercent)
                    }))
                  }
                  onSaveCapacity={() =>
                    updateCapacity.mutate({
                      id: selectedBooking.id,
                      capacityPercent: selectedCapacityPercent
                    })
                  }
                  onApprove={() =>
                    approve.mutate({
                      id: selectedBooking.id,
                      capacityPercent: selectedCapacityPercent,
                      currentCapacityPercent: selectedBooking.capacity_percent
                    })
                  }
                  onReject={() => handleReject(selectedBooking.id)}
                  onAssign={() =>
                    runWithCapacityConfirmation('Assign BA', () =>
                      assign.mutate({
                        id: selectedBooking.id,
                        baId: selectedBaId,
                        capacityPercent: selectedCapacityPercent,
                        currentCapacityPercent: selectedBooking.capacity_percent
                      })
                    )
                  }
                  onAssignAndApprove={() =>
                    runWithCapacityConfirmation('Assign + Approve', () =>
                      assignAndApprove.mutate({
                        id: selectedBooking.id,
                        baId: selectedBaId,
                        capacityPercent: selectedCapacityPercent,
                        currentCapacityPercent: selectedBooking.capacity_percent
                      })
                    )
                  }
                  onCancel={() => handleCancel(selectedBooking.id)}
                  onSaveForLater={() =>
                    setSaveForLaterMessage(
                      `Saved ${selectedBooking.title} for later review.`
                    )
                  }
                  onApproveChanges={(changes) =>
                    approveChanges.mutate({ id: selectedBooking.id, changes })
                  }
                  onRejectChanges={() => rejectChanges.mutate({ id: selectedBooking.id })}
                  onChangeDraftDirty={setPendingChangeDraftDirty}
                  onOpenReviewModal={() => setReviewModalOpen(true)}
                  onApproveField={(field, override) =>
                    approveFields.mutate({
                      id: selectedBooking.id,
                      fields: [field],
                      overrides:
                        override !== undefined ? { [field]: override } : undefined
                    })
                  }
                  onRejectField={(field) =>
                    rejectFields.mutate({ id: selectedBooking.id, fields: [field] })
                  }
                  canManageActions={canManageInbox}
                  isSubmitting={
                    approve.isPending ||
                    reject.isPending ||
                    assign.isPending ||
                    assignAndApprove.isPending ||
                    cancel.isPending ||
                    updateCapacity.isPending ||
                    approveChanges.isPending ||
                    rejectChanges.isPending ||
                    approveFields.isPending ||
                    rejectFields.isPending
                  }
                />
              </div>
            </aside>
          </div>
        ) : null}
      </div>

      {isMobile && selectedBooking && mobileDetailOpen ? (
        <div className="fixed inset-0 z-50 bg-slate-950/30" onClick={closeDetail}>
          <div
            className="absolute inset-x-0 bottom-0 max-h-[85vh] overflow-y-auto rounded-t-3xl bg-white p-4 shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="mx-auto mb-4 h-1.5 w-14 rounded-full bg-slate-200" />
            <RequestDetailPanel
              booking={selectedBooking}
              allBas={bas.data ?? []}
              capacitySummary={summary.data}
              selectedBaId={selectedBaId}
              capacity={selectedCapacity.data}
              capacityPercent={selectedCapacityPercent}
              onSelectBa={(baId) =>
                setAssignDrafts((current) => ({ ...current, [selectedBooking.id]: baId }))
              }
              onCapacityChange={(capacityPercent) =>
                setCapacityDrafts((current) => ({
                  ...current,
                  [selectedBooking.id]: String(capacityPercent)
                }))
              }
              onSaveCapacity={() =>
                updateCapacity.mutate({
                  id: selectedBooking.id,
                  capacityPercent: selectedCapacityPercent
                })
              }
              onApprove={() =>
                approve.mutate({
                  id: selectedBooking.id,
                  capacityPercent: selectedCapacityPercent,
                  currentCapacityPercent: selectedBooking.capacity_percent
                })
              }
              onReject={() => handleReject(selectedBooking.id)}
              onAssign={() =>
                runWithCapacityConfirmation('Assign BA', () =>
                  assign.mutate({
                    id: selectedBooking.id,
                    baId: selectedBaId,
                    capacityPercent: selectedCapacityPercent,
                    currentCapacityPercent: selectedBooking.capacity_percent
                  })
                )
              }
              onAssignAndApprove={() =>
                runWithCapacityConfirmation('Assign + Approve', () =>
                  assignAndApprove.mutate({
                    id: selectedBooking.id,
                    baId: selectedBaId,
                    capacityPercent: selectedCapacityPercent,
                    currentCapacityPercent: selectedBooking.capacity_percent
                  })
                )
              }
              onCancel={() => handleCancel(selectedBooking.id)}
              onSaveForLater={() => {
                setSaveForLaterMessage(
                  `Saved ${selectedBooking.title} for later review.`
                );
                closeDetail();
              }}
              onApproveChanges={(changes) =>
                approveChanges.mutate({ id: selectedBooking.id, changes })
              }
              onRejectChanges={() => rejectChanges.mutate({ id: selectedBooking.id })}
              onChangeDraftDirty={setPendingChangeDraftDirty}
              onOpenReviewModal={() => setReviewModalOpen(true)}
              onApproveField={(field, override) =>
                approveFields.mutate({
                  id: selectedBooking.id,
                  fields: [field],
                  overrides: override !== undefined ? { [field]: override } : undefined
                })
              }
              onRejectField={(field) =>
                rejectFields.mutate({ id: selectedBooking.id, fields: [field] })
              }
              canManageActions={canManageInbox}
              isSubmitting={
                approve.isPending ||
                reject.isPending ||
                assign.isPending ||
                assignAndApprove.isPending ||
                cancel.isPending ||
                updateCapacity.isPending ||
                approveChanges.isPending ||
                rejectChanges.isPending ||
                approveFields.isPending ||
                rejectFields.isPending
              }
            />
          </div>
        </div>
      ) : null}

      <Modal
        title={decisionModal?.kind === 'reject' ? 'Reject request' : 'Cancel request'}
        open={Boolean(decisionModal)}
        onClose={() => {
          if (reject.isPending || cancel.isPending) {
            return;
          }
          setDecisionModal(null);
          setDecisionReason('');
        }}
      >
        <form
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            submitDecision();
          }}
        >
          <div className="grid gap-2">
            <p className="text-sm font-medium text-slate-950">{decisionModal?.title}</p>
            <p className="text-sm text-slate-500">
              {decisionModal?.kind === 'reject'
                ? 'Provide a clear reason so the requester knows what to adjust.'
                : 'Provide a clear reason for cancelling this approved request.'}
            </p>
          </div>
          <label className="grid gap-2">
            <span className="text-sm font-medium text-slate-700">
              {decisionModal?.kind === 'reject' ? 'Reject reason' : 'Cancel reason'}
            </span>
            <textarea
              value={decisionReason}
              onChange={(event) => setDecisionReason(event.target.value)}
              className="min-h-28 rounded-md border border-slate-200 p-3 text-sm"
              placeholder={
                decisionModal?.kind === 'reject'
                  ? 'Explain why this request is rejected...'
                  : 'Explain why this request is cancelled...'
              }
              autoFocus
            />
          </label>
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                setDecisionModal(null);
                setDecisionReason('');
              }}
              disabled={reject.isPending || cancel.isPending}
            >
              Back
            </Button>
            <Button
              type="submit"
              variant="secondary"
              className={rejectButtonClassName}
              disabled={!decisionReason.trim() || reject.isPending || cancel.isPending}
            >
              {decisionModal?.kind === 'reject'
                ? reject.isPending
                  ? 'Rejecting...'
                  : 'Confirm reject'
                : cancel.isPending
                  ? 'Cancelling...'
                  : 'Confirm cancel'}
            </Button>
          </div>
        </form>
      </Modal>

      {pendingNavigationAction ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/30 p-4">
          <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold text-slate-950">
                  Unsaved changes
                </h2>
                <p className="mt-1 text-sm text-slate-600">
                  Review these edits before leaving this section.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setPendingNavigationAction(null)}
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
              {unsavedChangeSummary.length > 0 ? (
                <ul className="mt-2 grid gap-1 text-sm text-slate-700">
                  {unsavedChangeSummary.map((item) => (
                    <li key={item} className="rounded-md bg-white px-2 py-1">
                      {item}
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
                variant="secondary"
                onClick={() => continuePendingNavigation()}
              >
                Leave anyway
              </Button>
              <Button type="button" onClick={() => setPendingNavigationAction(null)}>
                Stay here
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      {confirmationState ? (
        <div className="fixed inset-0 z-[60] grid place-items-center bg-slate-950/40 p-4">
          <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl">
            <h2 className="text-base font-semibold text-slate-950">
              {confirmationState.title}
            </h2>
            <p className="mt-2 text-sm leading-6 text-slate-600">
              {confirmationState.body}
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <Button
                type="button"
                variant="secondary"
                onClick={() => setConfirmationState(null)}
              >
                Cancel
              </Button>
              <Button
                type="button"
                onClick={() => {
                  const action = confirmationState.action;
                  setConfirmationState(null);
                  action();
                }}
              >
                {confirmationState.confirmLabel}
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      {selectedBooking ? (
        <Modal
          open={reviewModalOpen}
          onClose={() => setReviewModalOpen(false)}
          title="Review Changes"
        >
          <div className="grid gap-3">
            {selectedPendingChangeEntries.map((entry) => (
              <div
                key={entry.key}
                className="rounded-lg border border-slate-200 p-3 text-sm"
              >
                <p className="font-medium text-slate-950">{entry.label}</p>
                <p className="mt-1 text-slate-600">
                  {entry.currentDisplay} {'->'} {entry.proposedDisplay}
                </p>
              </div>
            ))}
          </div>
        </Modal>
      ) : null}
    </div>
  );
}

export function RequestDetailPanel({
  booking,
  allBas,
  capacitySummary,
  selectedBaId,
  capacity,
  capacityPercent,
  onSelectBa,
  onCapacityChange,
  onSaveCapacity,
  onApprove,
  onReject,
  onAssign,
  onAssignAndApprove,
  onCancel,
  onSaveForLater,
  onOpenReviewModal,
  canManageActions,
  isSubmitting
}: {
  booking: Booking;
  allBas: BAProfile[];
  capacitySummary?: CapacitySummary;
  selectedBaId: string;
  capacity?: CapacityDetail;
  capacityPercent: number;
  onSelectBa: (baId: string) => void;
  onCapacityChange: (capacityPercent: number) => void;
  onSaveCapacity: () => void;
  onApprove: () => void;
  onReject: () => void;
  onAssign: () => void;
  onAssignAndApprove: () => void;
  onCancel: () => void;
  onSaveForLater: () => void;
  onApproveChanges: (changes: Record<string, unknown>) => void;
  onRejectChanges: () => void;
  onChangeDraftDirty: (dirty: boolean) => void;
  onOpenReviewModal: () => void;
  onApproveField: (field: string, override?: unknown) => void;
  onRejectField: (field: string) => void;
  canManageActions: boolean;
  isSubmitting: boolean;
}) {
  const [baSearch, setBaSearch] = useState('');
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const canEditPendingRequest = canManageActions && booking.status === 'PENDING';
  const canEditCapacity = canEditPendingRequest;
  const capacityChanged = capacityPercent !== booking.capacity_percent;
  const capacityPreview = getAdjustedCapacityPreview(
    capacity,
    booking,
    selectedBaId,
    capacityPercent
  );
  const capacityCheckReady = !selectedBaId || Boolean(capacity);
  const blocksCapacityDecision =
    canEditCapacity &&
    Boolean(selectedBaId) &&
    (!capacityCheckReady || capacityPreview.hasApprovalRisk);
  const verificationItems = getVerificationItems(booking, capacityPercent);
  const canApproveDirectly = booking.status === 'PENDING' && Boolean(booking.ba_id);
  const canAssign = canEditPendingRequest;
  const canReject = canEditPendingRequest;
  const now = new Date();
  const todayStr = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-${String(now.getUTCDate()).padStart(2, '0')}`;
  const startStr =
    typeof booking.start_date === 'string'
      ? booking.start_date.slice(0, 10)
      : new Date(booking.start_date).toISOString().slice(0, 10);
  const canCancel = booking.status === 'APPROVED' && startStr > todayStr;
  const assignChanged = selectedBaId !== (booking.ba_id ?? '');
  const hasAssignmentAction = assignChanged || capacityChanged;
  const hasApprovalAction = capacityChanged || booking.status === 'PENDING';
  const pendingChangeEntries = getPendingChangeEntries(booking);
  const hasPendingChanges = pendingChangeEntries.length > 0;

  const filteredBas = useMemo(() => {
    const search = baSearch.toLowerCase().trim();
    const capacityMap = new Map(
      (capacitySummary?.items ?? []).map((item) => [item.ba_id, item])
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
  }, [allBas, baSearch, capacitySummary]);

  const selectedBa = allBas.find((ba) => ba.id === selectedBaId);
  const assignmentName = selectedBa?.full_name ?? booking.ba?.full_name ?? 'Unassigned';
  const assignmentHint = selectedBa?.level ?? booking.ba?.level ?? 'Needs assignment';
  const assignmentLabel = booking.ba_id ? 'Requested BA' : 'Assignment';

  // Build the recommendation query from the booking. We always pass the
  // date range, capacity, and project_id (so project_affinity is real). The
  // manager opens the panel manually to avoid hitting the API on every
  // keystroke in the capacity input above.
  const recommendationQuery: RecommendationQuery | null = useMemo(() => {
    if (!booking.start_date || !booking.end_date) return null;
    if (booking.end_date < booking.start_date) return null;
    const cap = capacityPercent;
    if (!Number.isFinite(cap) || cap < 1 || cap > 100) return null;
    return {
      start_date: typeof booking.start_date === 'string'
        ? booking.start_date.slice(0, 10)
        : new Date(booking.start_date).toISOString().slice(0, 10),
      end_date: typeof booking.end_date === 'string'
        ? booking.end_date.slice(0, 10)
        : new Date(booking.end_date).toISOString().slice(0, 10),
      capacity_percent: cap,
      project_id: booking.project_id,
      // Exclude the currently-assigned BA so a manager can pick "show me
      // alternatives" if they want; we keep this OFF by default because
      // re-assigning to the same BA should be allowed.
      limit: 5
    };
  }, [
    booking.start_date,
    booking.end_date,
    booking.project_id,
    capacityPercent
  ]);

  return (
    <Card className="h-fit">
      <CardHeader className="gap-4 border-b border-slate-200 pb-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <CardTitle>{booking.title}</CardTitle>
              <RequestTypeBadge booking={booking} />
              <RequestStateBadge booking={booking} />
            </div>
            <p className="mt-2 text-sm text-slate-500">{booking.project.name}</p>
          </div>
          <div className="flex gap-2">
            {canManageActions && canApproveDirectly ? (
              <Button
                onClick={onApprove}
                disabled={isSubmitting || blocksCapacityDecision}
              >
                {capacityChanged ? 'Save + approve' : 'Approve'}
              </Button>
            ) : null}
            {canManageActions && canCancel ? (
              <Button
                variant="secondary"
                className={rejectButtonClassName}
                onClick={onCancel}
                disabled={isSubmitting}
              >
                Cancel
              </Button>
            ) : null}
            {canManageActions && canReject ? (
              <Button
                variant="secondary"
                className={rejectButtonClassName}
                onClick={onReject}
                disabled={isSubmitting}
              >
                Reject
              </Button>
            ) : null}
          </div>
        </div>

        <div className="grid gap-2 rounded-xl border border-slate-200 bg-slate-50/80 p-3 md:grid-cols-2 xl:grid-cols-4">
          <RequestSummaryItem
            label={assignmentLabel}
            value={assignmentName}
            hint={assignmentHint}
          />
          <RequestSummaryItem
            label="Requester"
            value={booking.requester.full_name}
            hint={booking.requester.email}
          />
          <RequestSummaryItem
            label="Priority"
            value={
              <Badge tone={priorityTone(booking.priority)} className="w-fit">
                {booking.priority}
              </Badge>
            }
            hint="Decision order"
          />
          <RequestSummaryItem
            label="Date Range"
            value={`${formatDate(booking.start_date)} - ${formatDate(booking.end_date)}`}
            hint={`${capacityPercent}% capacity`}
          />
        </div>
      </CardHeader>

      <CardContent className="grid gap-5 p-5">
        {hasPendingChanges ? (
          <section className="grid gap-4 rounded-xl border border-amber-200 bg-gradient-to-r from-amber-50 to-blue-50 p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-slate-950">Changes Proposed</p>
                <p className="mt-1 text-sm text-slate-600">
                  {pendingChangeEntries.length} change
                  {pendingChangeEntries.length === 1 ? '' : 's'} proposed — review each
                  before approving or rejecting.
                </p>
              </div>
              <Badge tone="warning">Manager review required</Badge>
            </div>
            <Button type="button" onClick={onOpenReviewModal} disabled={isSubmitting}>
              Review Changes
            </Button>
          </section>
        ) : null}

        <section className="grid gap-2 rounded-xl border border-slate-200 p-4">
          <p className="text-sm font-semibold text-slate-950">Project / Business need</p>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="font-semibold text-slate-900">{booking.project.name}</span>
            <Badge tone="info">{capacityPercent}% capacity</Badge>
            {capacityChanged ? (
              <Badge tone="warning">Original {booking.capacity_percent}%</Badge>
            ) : null}
          </div>
          <p className="text-sm leading-6 text-slate-600">{booking.description}</p>
          {booking.notes ? (
            <p className="text-sm text-slate-500">Notes: {booking.notes}</p>
          ) : null}
        </section>

        {verificationItems.length > 0 ? (
          <section className="grid gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4">
            <div className="flex items-center gap-2">
              <AlertCircle className="h-4 w-4 text-amber-600" />
              <p className="text-sm font-semibold text-amber-900">
                Needs manager verification
              </p>
            </div>
            <div className="grid gap-2 text-sm text-amber-900">
              {verificationItems.map((item) => (
                <div key={item} className="flex items-center gap-2">
                  <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
                  <span>{item}</span>
                </div>
              ))}
            </div>
          </section>
        ) : null}

        {canEditCapacity ? (
          <section className="grid gap-3 rounded-xl border border-slate-200 p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-slate-950">Capacity decision</p>
                <p className="mt-1 text-xs text-slate-500">
                  Requested: {booking.capacity_percent}%
                </p>
              </div>
              {capacityChanged ? (
                <Badge tone="warning">Edited</Badge>
              ) : (
                <Badge tone="neutral">Current</Badge>
              )}
            </div>
            <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
              <div className="grid grid-cols-4 rounded-md border border-slate-200 bg-slate-100 p-1">
                {CAPACITY_OPTIONS.map((option) => (
                  <button
                    key={option}
                    type="button"
                    onClick={() => onCapacityChange(option)}
                    className={[
                      'h-9 rounded-md text-sm font-semibold transition-colors',
                      capacityPercent === option
                        ? 'bg-white text-slate-950 shadow-sm'
                        : 'text-slate-600 hover:text-slate-950'
                    ].join(' ')}
                    disabled={isSubmitting}
                  >
                    {option}%
                  </button>
                ))}
              </div>
              <Button
                type="button"
                variant="secondary"
                onClick={onSaveCapacity}
                disabled={!capacityChanged || isSubmitting}
              >
                Save capacity
              </Button>
            </div>
          </section>
        ) : null}

        <section className="grid gap-3 rounded-xl border border-slate-200 p-4">
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm font-semibold text-slate-950">Capacity preview</p>
            <Badge
              tone={
                !selectedBaId || !capacityCheckReady
                  ? 'neutral'
                  : capacityPreview.hasApprovalRisk
                    ? 'danger'
                    : 'success'
              }
            >
              {!selectedBaId
                ? 'Needs BA'
                : !capacityCheckReady
                  ? 'Checking'
                  : capacityPreview.hasApprovalRisk
                    ? 'Over capacity'
                    : 'Approvable'}
            </Badge>
          </div>
          <div className="grid gap-2 text-sm text-slate-600">
            <div className="flex items-center justify-between">
              <span>Approved capacity</span>
              <span>{capacityPreview.approvedCapacity}%</span>
            </div>
            <div className="flex items-center justify-between">
              <span>Pending capacity</span>
              <span>{capacityPreview.pendingCapacity}%</span>
            </div>
            <div className="flex items-center justify-between">
              <span>Approval load</span>
              <span
                className={
                  capacityPreview.hasApprovalRisk
                    ? 'font-semibold text-rose-600'
                    : undefined
                }
              >
                {capacityPreview.approvalLoad}%
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span>Risk capacity</span>
              <span>{capacityPreview.riskCapacity}%</span>
            </div>
            <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-100">
              <div
                className={
                  capacityPreview.hasApprovalRisk
                    ? 'h-full bg-rose-500'
                    : 'h-full bg-blue-600'
                }
                style={{ width: `${Math.min(100, capacityPreview.approvalLoad)}%` }}
              />
            </div>
          </div>
        </section>

        {canManageActions && canAssign ? (
          <section className="grid gap-3 rounded-xl border border-slate-200 p-4">
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm font-semibold text-slate-950">
                {booking.ba ? 'Reassign BA' : 'Select BA for Assignment'}
              </p>
              <Button variant="ghost" size="sm" asChild>
                <a href="/crm/ba">BA Directory</a>
              </Button>
            </div>

            <RecommendationDropdown
              query={recommendationQuery}
              selectedBaId={selectedBaId}
              onSelectCandidate={onSelectBa}
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
                  <div className="max-h-[300px] overflow-y-auto">
                    {filteredBas.map((item) => (
                      <div
                        key={item.ba.id}
                        className="flex cursor-pointer items-center justify-between gap-3 p-3 hover:bg-slate-50"
                        onClick={() => {
                          onSelectBa(item.ba.id);
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
                      <p className="p-4 text-center text-sm text-slate-500">
                        No BAs found.
                      </p>
                    )}
                  </div>
                </div>
              )}
            </div>
          </section>
        ) : (
          <section className="grid gap-3 rounded-xl border border-slate-200 p-4">
            <p className="text-sm font-semibold text-slate-950">
              {canAssign ? 'Requested BA / Assignment' : 'Assigned BA'}
            </p>
            <BAIdentity ba={booking.ba} />
            {!canManageActions ? (
              <p className="text-sm text-slate-500">View only</p>
            ) : null}
          </section>
        )}

        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {canManageActions && canAssign ? (
            <>
              <Button
                variant="secondary"
                onClick={onAssign}
                disabled={
                  !selectedBaId ||
                  isSubmitting ||
                  blocksCapacityDecision ||
                  !hasAssignmentAction
                }
              >
                {capacityChanged || assignChanged ? 'Save + assign' : 'Assign BA'}
              </Button>
              <Button
                onClick={onAssignAndApprove}
                disabled={
                  !selectedBaId ||
                  isSubmitting ||
                  blocksCapacityDecision ||
                  !hasApprovalAction
                }
              >
                {capacityChanged || assignChanged
                  ? 'Save + assign + approve'
                  : 'Assign + Approve'}
              </Button>
              <Button
                variant="secondary"
                onClick={onSaveForLater}
                disabled={isSubmitting}
              >
                Save for later
              </Button>
              <Button
                variant="secondary"
                className={rejectButtonClassName}
                onClick={onReject}
                disabled={isSubmitting}
              >
                Reject
              </Button>
            </>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}

function getPendingChangeEntries(booking: Booking): PendingChangeEntry[] {
  const changes = booking.pending_changes ?? {};
  return Object.entries(changes).map(([key, value]) => ({
    key,
    label: toTitleLabel(key),
    currentDisplay: formatPendingChangeValue(
      (booking as unknown as Record<string, unknown>)[key]
    ),
    proposedDisplay: formatPendingChangeValue(value),
    proposedInputValue: formatPendingChangeValue(value)
  }));
}

function buildPendingChangePayload(
  entries: PendingChangeEntry[],
  drafts: Record<string, string>
) {
  const changes: Record<string, unknown> = {};
  for (const entry of entries) {
    const draft = drafts[entry.key];
    changes[entry.key] =
      draft !== undefined ? parsePendingChangeValue(entry, draft) : entry.proposedDisplay;
  }
  return changes;
}

function parsePendingChangeValue(entry: PendingChangeEntry, value: string) {
  if (entry.key === 'capacity_percent') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : value;
  }
  return value;
}

function formatPendingChangeValue(value: unknown) {
  if (value === null || value === undefined || value === '') return '—';
  if (
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return String(value);
  }
  return JSON.stringify(value);
}

function toTitleLabel(key: string) {
  return key
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function RequestSummaryItem({
  label,
  value,
  hint
}: {
  label: string;
  value: ReactNode;
  hint: string;
}) {
  return (
    <div className="min-w-0 rounded-lg bg-white px-3 py-2 ring-1 ring-slate-200">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
        {label}
      </p>
      <div className="mt-1 min-w-0 truncate text-sm font-semibold text-slate-950">
        {value}
      </div>
      <p className="mt-0.5 truncate text-xs text-slate-500">{hint}</p>
    </div>
  );
}

const actionCenterBadgeClassName =
  'inline-flex w-full min-w-[104px] justify-center text-center xl:min-w-[128px]';

const actionCenterPriorityBadgeClassName =
  'inline-flex w-full min-w-[84px] justify-center text-center xl:min-w-[96px]';

const actionCenterTypeBadgeClassName =
  'inline-flex w-full min-w-[92px] justify-center text-center xl:min-w-[108px]';

function RequestTypeBadge({ booking }: { booking: Booking }) {
  return (
    <Badge
      tone={getRequestType(booking) === 'SPECIFIC_BA' ? 'info' : 'success'}
      className={actionCenterTypeBadgeClassName}
    >
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

  return (
    <Badge tone={tone} className={actionCenterBadgeClassName}>
      {stateLabelMap[state]}
    </Badge>
  );
}

function getRequestRiskFlags(booking: Booking, riskCapacity: number) {
  const flags: string[] = [];

  if (booking.priority === 'URGENT') {
    flags.push('Urgent');
  }

  if (!booking.ba_id) {
    flags.push('Unassigned');
  }

  if (riskCapacity > 100) {
    flags.push('Overbook risk');
  }

  if (needsManagerVerification(booking)) {
    flags.push('Needs verification');
  }

  return flags.length > 0 ? flags : ['Normal'];
}

function FilterOptionGroup<T extends string>({
  label,
  options,
  value,
  onChange
}: {
  label: string;
  options: Array<{ value: T; label: string }>;
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <div className="grid gap-2">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
        {label}
      </p>
      <div className="flex flex-wrap gap-2">
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            onClick={() => onChange(option.value)}
            className={[
              'rounded-md border px-3 py-1.5 text-sm font-semibold transition-colors',
              value === option.value
                ? 'border-blue-300 bg-blue-50 text-blue-700'
                : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:text-slate-950'
            ].join(' ')}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function getRequestActionLabel(booking: Booking, canManageActions = true) {
  if (!canManageActions) {
    return 'View';
  }

  if (!booking.ba_id) {
    return 'Assign';
  }

  if (booking.status === 'PENDING' && getRequestType(booking) === 'SPECIFIC_BA') {
    return 'Approve';
  }

  if (booking.status === 'PENDING') {
    return 'Review';
  }

  return 'View';
}

const rejectButtonClassName =
  'border-slate-200 bg-white text-slate-700 hover:bg-slate-50 hover:text-slate-950';

function useIsMobile() {
  const [isMobile, setIsMobile] = useState(() =>
    typeof window === 'undefined' ? false : window.innerWidth < 1280
  );

  useEffect(() => {
    const handler = () => setIsMobile(window.innerWidth < 1280);
    window.addEventListener('resize', handler);
    return () => window.removeEventListener('resize', handler);
  }, []);

  return isMobile;
}

function getAdjustedCapacityPreview(
  capacity: CapacityDetail | undefined,
  booking: Booking,
  selectedBaId: string,
  capacityPercent: number
) {
  const shouldPreviewDraft = booking.status === 'PENDING' && Boolean(selectedBaId);
  const includesCurrentPending =
    booking.status === 'PENDING' &&
    Boolean(booking.ba_id) &&
    selectedBaId === booking.ba_id;

  if (capacity?.daily.length) {
    const ownPendingCapacity = includesCurrentPending ? booking.capacity_percent : 0;
    const daily = capacity.daily.map((day) => {
      const pendingCapacity = shouldPreviewDraft
        ? Math.max(0, day.pending_capacity - ownPendingCapacity) + capacityPercent
        : day.pending_capacity;
      const approvalLoad = shouldPreviewDraft
        ? day.approved_capacity + capacityPercent
        : day.approved_capacity;

      return {
        approvedCapacity: day.approved_capacity,
        pendingCapacity,
        approvalLoad,
        riskCapacity: day.approved_capacity + pendingCapacity
      };
    });

    return {
      approvedCapacity: Math.max(0, ...daily.map((day) => day.approvedCapacity)),
      pendingCapacity: Math.max(0, ...daily.map((day) => day.pendingCapacity)),
      approvalLoad: Math.max(0, ...daily.map((day) => day.approvalLoad)),
      riskCapacity: Math.max(0, ...daily.map((day) => day.riskCapacity)),
      hasApprovalRisk: daily.some((day) => day.approvalLoad > 100)
    };
  }

  const approvedCapacity = capacity?.max_approved_capacity ?? 0;
  const pendingCapacity = shouldPreviewDraft
    ? Math.max(
        0,
        (capacity?.max_pending_capacity ?? 0) -
          (includesCurrentPending ? booking.capacity_percent : 0)
      ) + capacityPercent
    : (capacity?.max_pending_capacity ?? 0);
  const approvalLoad = shouldPreviewDraft
    ? approvedCapacity + capacityPercent
    : approvedCapacity;

  return {
    approvedCapacity,
    pendingCapacity,
    approvalLoad,
    riskCapacity: approvedCapacity + pendingCapacity,
    hasApprovalRisk: approvalLoad > 100
  };
}

function getVerificationItems(
  booking: Booking,
  capacityPercent = booking.capacity_percent
) {
  const items: string[] = [];

  if (!booking.ba_id) {
    items.push('BA not assigned');
  }

  if (capacityPercent >= 100) {
    items.push('Capacity needs verification');
  }

  if (needsManagerVerification(booking)) {
    items.push('Business context needs manager verification');
  }

  return Array.from(new Set(items));
}

function setParam(params: URLSearchParams, key: string, value: string) {
  if (value) {
    params.set(key, value);
    return;
  }

  params.delete(key);
}

function isRequestType(value: string | null): value is RequestType {
  return value === 'SPECIFIC_BA' || value === 'OPEN_REQUEST';
}

function isBookingPriority(value: string | null): value is BookingPriority {
  return value === 'LOW' || value === 'MEDIUM' || value === 'HIGH' || value === 'URGENT';
}

function isBookingStatus(value: string | null): value is BookingStatus {
  return (
    value === 'PENDING' ||
    value === 'APPROVED' ||
    value === 'REJECTED' ||
    value === 'IN_PROGRESS' ||
    value === 'COMPLETED' ||
    value === 'CANCELLED'
  );
}

function isSortOption(value: string | null): value is FilterState['sort'] {
  return (
    value === 'NEWEST' ||
    value === 'OLDEST' ||
    value === 'PRIORITY' ||
    value === 'CAPACITY_RISK'
  );
}

function getInboxPriorityScore(
  booking: Booking,
  flags: { hasCapacityRisk?: boolean; hasOverbooked?: boolean } = {}
) {
  let score = getInboxStatusScore(booking.status);

  switch (booking.priority) {
    case 'URGENT':
      score += 400;
      break;
    case 'HIGH':
      score += 300;
      break;
    case 'MEDIUM':
      score += 200;
      break;
    default:
      score += 100;
      break;
  }

  if (flags.hasOverbooked) score += 60;
  else if (flags.hasCapacityRisk) score += 40;
  if (!booking.ba_id) score += 50;

  return score;
}

function getInboxStatusScore(status: BookingStatus) {
  switch (status) {
    case 'PENDING':
      return 1000;
    case 'REJECTED':
      return 300;
    case 'APPROVED':
      return 100;
    case 'COMPLETED':
      return 50;
    case 'CANCELLED':
      return 0;
    default:
      return 80;
  }
}
