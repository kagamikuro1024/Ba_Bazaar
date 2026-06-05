import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertCircle,
  CalendarRange,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Hash,
  Layers3,
  ShieldCheck,
  Search,
  SlidersHorizontal,
  UserRound,
  UsersRound,
  Zap
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
import { Avatar, BAIdentity } from '@/components/common';
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

type InboxTab = 'ALL' | 'SPECIFIC_BA' | 'OPEN_REQUEST' | 'URGENT';

type FilterState = {
  search: string;
  priority: 'ALL' | BookingPriority;
  status: 'ALL' | BookingStatus;
  type: 'ALL' | RequestType;
  sort: 'NEWEST' | 'OLDEST' | 'PRIORITY';
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

export function ManagerInboxPage() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const canManageInbox = user?.role === 'BA_MANAGER';
  const [searchParams, setSearchParams] = useSearchParams();
  const [assignDrafts, setAssignDrafts] = useState<Record<string, string>>({});
  const [capacityDrafts, setCapacityDrafts] = useState<Record<string, string>>({});
  const [successMessage, setSuccessMessage] = useState('');
  const [saveForLaterMessage, setSaveForLaterMessage] = useState('');
  const [mobileDetailOpen, setMobileDetailOpen] = useState(false);
  const [decisionModal, setDecisionModal] = useState<DecisionModalState>(null);
  const [decisionReason, setDecisionReason] = useState('');
  const [pendingChangeDraftDirty, setPendingChangeDraftDirty] = useState(false);
  const [reviewModalOpen, setReviewModalOpen] = useState(false);
  const [changeDrafts, setChangeDrafts] = useState<Record<string, string>>({});
  const [pendingNavigationAction, setPendingNavigationAction] = useState<(() => void) | null>(null);
  const isMobile = useIsMobile();
  const pageSize = 6;

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
    if (filters.priority === 'URGENT') {
      return 'URGENT';
    }

    if (filters.type === 'SPECIFIC_BA') {
      return 'SPECIFIC_BA';
    }

    if (filters.type === 'OPEN_REQUEST') {
      return 'OPEN_REQUEST';
    }

    return 'ALL';
  }, [filters.priority, filters.type]);

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
    const riskBaIds = new Set(
      (summary.data?.items ?? [])
        .filter((item) => item.risk_capacity > 100)
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

        const leftScore = getInboxPriorityScore(left);
        const rightScore = getInboxPriorityScore(right);
        if (leftScore !== rightScore) {
          return rightScore - leftScore;
        }

        const byCreatedAt =
          new Date(right.created_at).getTime() - new Date(left.created_at).getTime();
        if (byCreatedAt !== 0) {
          return byCreatedAt;
        }

        return new Date(left.start_date).getTime() - new Date(right.start_date).getTime();
      });
  }, [bookings.data, filters, summary.data]);

  const counts = useMemo(
    () => ({
      ALL: (bookings.data ?? []).length,
      SPECIFIC_BA: (bookings.data ?? []).filter(
        (booking) => getRequestType(booking) === 'SPECIFIC_BA'
      ).length,
      OPEN_REQUEST: (bookings.data ?? []).filter(
        (booking) => getRequestType(booking) === 'OPEN_REQUEST'
      ).length,
      URGENT: (bookings.data ?? []).filter((booking) => booking.priority === 'URGENT')
        .length
    }),
    [bookings.data]
  );

  const currentPage = Math.max(1, Number(searchParams.get('page') ?? '1') || 1);
  const totalPages = Math.max(1, Math.ceil(filteredBookings.length / pageSize));
  const safePage = Math.min(currentPage, totalPages);
  const visiblePages = useMemo<(number | 'ellipsis-left' | 'ellipsis-right')[]>(() => {
    if (totalPages <= 2) {
      return Array.from({ length: totalPages }, (_, index) => index + 1);
    }

    if (safePage <= 2) {
      return [1, 2, 'ellipsis-right', totalPages];
    }

    if (safePage >= totalPages - 1) {
      return [1, 'ellipsis-left', totalPages - 1, totalPages];
    }

    return [1, 'ellipsis-left', safePage, 'ellipsis-right', totalPages];
  }, [safePage, totalPages]);
  const paginatedBookings = filteredBookings.slice(
    (safePage - 1) * pageSize,
    safePage * pageSize
  );

  const selectedRequestId = searchParams.get('requestId');
  const selectedBooking = useMemo(() => {
    if (!filteredBookings.length) {
      return null;
    }

    if (selectedRequestId) {
      return (
        paginatedBookings.find((booking) => booking.id === selectedRequestId) ??
        filteredBookings.find((booking) => booking.id === selectedRequestId) ??
        bookings.data?.find((booking) => booking.id === selectedRequestId) ??
        paginatedBookings[0]
      );
    }

    return paginatedBookings[0] ?? filteredBookings[0];
  }, [bookings.data, filteredBookings, paginatedBookings, selectedRequestId]);

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

  useEffect(() => {
    if (!selectedBooking) {
      return;
    }

    const currentRequestId = searchParams.get('requestId');
    if (currentRequestId === selectedBooking.id) {
      return;
    }

    const nextParams = new URLSearchParams(searchParams);
    nextParams.set('requestId', selectedBooking.id);
    setSearchParams(nextParams, { replace: true });
  }, [searchParams, selectedBooking, setSearchParams]);

  const selectedBaId =
    (selectedBooking && assignDrafts[selectedBooking.id]) || selectedBooking?.ba_id || '';
  const selectedCapacityDraft = selectedBooking
    ? (capacityDrafts[selectedBooking.id] ?? String(selectedBooking.capacity_percent))
    : '';
  const selectedCapacityPercent =
    parseCapacityPercent(selectedCapacityDraft) ??
    selectedBooking?.capacity_percent ??
    50;
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

  const assignDraftChanged =
    selectedBooking &&
    assignDrafts[selectedBooking.id] &&
    assignDrafts[selectedBooking.id] !== selectedBooking.ba_id;
  const capacityDraftChanged =
    selectedBooking &&
    capacityDrafts[selectedBooking.id] &&
    capacityDrafts[selectedBooking.id] !== String(selectedBooking.capacity_percent);
  const hasUnsavedChanges = Boolean(assignDraftChanged || capacityDraftChanged || pendingChangeDraftDirty);
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

    if (!searchParams.get('requestId')) {
      setMobileDetailOpen(false);
    }
  }, [isMobile, searchParams, selectedBooking]);

  async function saveCapacityIfChanged(
    id: string,
    capacityPercent: number,
    currentCapacityPercent: number
  ) {
    if (capacityPercent === currentCapacityPercent) {
      return;
    }

    await apiFetch(`/api/bookings/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ capacity_percent: capacityPercent })
    });
  }

  function handleMutationSuccess(message: string, closeDetail = true) {
    setSuccessMessage(message);
    setSaveForLaterMessage('');
    if (closeDetail) {
      setMobileDetailOpen(false);
    }
    void queryClient.invalidateQueries();
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
      if (tab === 'ALL') {
        const params = new URLSearchParams(searchParams);
        setParam(params, 'priority', '');
        setParam(params, 'type', '');
        params.delete('requestId');
        params.delete('page');
        setSearchParams(params);
        return;
      }

      if (tab === 'URGENT') {
        const params = new URLSearchParams(searchParams);
        setParam(params, 'priority', 'URGENT');
        setParam(params, 'type', '');
        params.delete('requestId');
        params.delete('page');
        setSearchParams(params);
        return;
      }

      const params = new URLSearchParams(searchParams);
      setParam(params, 'type', tab);
      setParam(params, 'priority', '');
      params.delete('requestId');
      params.delete('page');
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

  function closeMobileDetail() {
    setMobileDetailOpen(false);
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

  return (
    <div className="grid gap-5">
      {successMessage ? (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          {successMessage}
        </div>
      ) : null}
      {saveForLaterMessage ? (
        <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-600">
          {saveForLaterMessage}
        </div>
      ) : null}
      {filters.needsVerification || filters.overbookRisk ? (
        <div
          className={[
            'flex flex-wrap items-center gap-2 rounded-xl px-4 py-3 text-sm',
            filters.overbookRisk
              ? 'border border-rose-200 bg-rose-50 text-rose-800'
              : 'border border-amber-200 bg-amber-50 text-amber-900'
          ].join(' ')}
        >
          <span className="font-semibold">Active alert filter:</span>
          {filters.needsVerification ? (
            <span className="inline-flex items-center rounded-full bg-white px-3 py-1 font-medium text-amber-700 ring-1 ring-amber-200">
              Needs verification
            </span>
          ) : null}
          {filters.overbookRisk ? (
            <span className="inline-flex items-center rounded-full bg-white px-3 py-1 font-medium text-rose-700 ring-1 ring-rose-200">
              Overbook risk
            </span>
          ) : null}
          <button
            type="button"
            onClick={() => setFilter({ needsVerification: false, overbookRisk: false })}
            className={[
              'ml-auto inline-flex items-center rounded-md px-3 py-1.5 text-sm font-semibold transition-colors',
              filters.overbookRisk
                ? 'bg-white text-rose-700 ring-1 ring-rose-200 hover:bg-rose-100'
                : 'bg-white text-amber-700 ring-1 ring-amber-200 hover:bg-amber-100'
            ].join(' ')}
          >
            Clear
          </button>
        </div>
      ) : null}
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

      <Card>
        <CardContent className="grid gap-3 p-4 lg:p-5">
          <div className="grid gap-3 2xl:grid-cols-[minmax(0,320px)_minmax(0,1fr)] 2xl:items-center">
            <label className="relative block 2xl:min-w-0">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                value={filters.search}
                onChange={(event) => setFilter({ search: event.target.value })}
                placeholder="Search requests, projects, or requesters"
                className="h-10 w-full rounded-md border border-slate-200 bg-white pl-9 pr-3 text-sm"
              />
            </label>
            <div className="flex flex-wrap items-center gap-2 2xl:justify-start">
              {[
                ['ALL', `All (${counts.ALL})`],
                ['SPECIFIC_BA', `Specific BA (${counts.SPECIFIC_BA})`],
                ['OPEN_REQUEST', `Open Requests (${counts.OPEN_REQUEST})`],
                ['URGENT', `Urgent (${counts.URGENT})`]
              ].map(([tab, label]) => (
                <button
                  key={tab}
                  type="button"
                  onClick={() => selectTab(tab as InboxTab)}
                  className={[
                    'rounded-full border px-4 py-2 text-sm font-semibold transition-colors',
                    activeTab === tab
                      ? 'border-blue-200 bg-blue-50 text-blue-700'
                      : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:text-slate-950'
                  ].join(' ')}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-[repeat(3,minmax(0,180px))_repeat(2,minmax(0,156px))_auto] 2xl:items-center">
            <select
              value={filters.priority}
              onChange={(event) =>
                setFilter({ priority: event.target.value as FilterState['priority'] })
              }
              className="h-10 min-w-0 rounded-md border border-slate-200 bg-white px-3 text-sm"
            >
              <option value="ALL">Priority: All</option>
              <option value="LOW">Priority: Low</option>
              <option value="MEDIUM">Priority: Medium</option>
              <option value="HIGH">Priority: High</option>
              <option value="URGENT">Priority: Urgent</option>
            </select>
            <select
              value={filters.status}
              onChange={(event) =>
                setFilter({ status: event.target.value as FilterState['status'] })
              }
              className="h-10 min-w-0 rounded-md border border-slate-200 bg-white px-3 text-sm"
            >
              <option value="ALL">Status: All</option>
              <option value="PENDING">Pending</option>
              <option value="APPROVED">Approved</option>
              <option value="REJECTED">Rejected</option>
              <option value="IN_PROGRESS">In progress</option>
              <option value="COMPLETED">Completed</option>
              <option value="CANCELLED">Cancelled</option>
            </select>
            <select
              value={filters.type}
              onChange={(event) =>
                setFilter({ type: event.target.value as FilterState['type'] })
              }
              className="h-10 min-w-0 rounded-md border border-slate-200 bg-white px-3 text-sm"
            >
              <option value="ALL">Type: All</option>
              <option value="SPECIFIC_BA">Specific BA</option>
              <option value="OPEN_REQUEST">Open Request</option>
            </select>
            <input
              type="date"
              value={filters.startDate}
              onChange={(event) => setFilter({ startDate: event.target.value })}
              className="h-10 min-w-0 rounded-md border border-slate-200 bg-white px-3 text-sm"
            />
            <input
              type="date"
              value={filters.endDate}
              onChange={(event) => setFilter({ endDate: event.target.value })}
              className="h-10 min-w-0 rounded-md border border-slate-200 bg-white px-3 text-sm"
            />
            <button
              type="button"
              onClick={() =>
                setFilter({
                  search: '',
                  priority: 'ALL',
                  status: 'ALL',
                  type: 'ALL',
                  sort: 'PRIORITY',
                  startDate: '',
                  endDate: '',
                  needsVerification: false,
                  overbookRisk: false
                })
              }
              className="inline-flex h-10 w-fit items-center justify-center gap-2 justify-self-start rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-sm font-semibold text-blue-700 shadow-sm transition hover:bg-blue-100 hover:text-blue-800 md:col-span-2 xl:col-span-3 2xl:col-span-1"
            >
              <SlidersHorizontal className="h-4 w-4" />
              Reset filters
            </button>
          </div>
        </CardContent>
      </Card>

      <div className="grid items-start gap-5 2xl:grid-cols-[minmax(0,440px)_minmax(0,1fr)]">
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
                <option value="NEWEST">Newest</option>
                <option value="OLDEST">Oldest</option>
              </select>
            </div>
          </div>
          {paginatedBookings.map((booking) => {
            const selected = selectedBooking?.id === booking.id;
            const type = getRequestType(booking);

            return (
              <button
                key={booking.id}
                type="button"
                onClick={() => openDetail(booking.id)}
                className={[
                  'rounded-xl border bg-white p-4 text-left shadow-sm transition block w-full',
                  selected
                    ? 'border-blue-400 ring-1 ring-blue-400'
                    : 'border-slate-200 hover:border-slate-300'
                ].join(' ')}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2 mb-1">
                      <p className="truncate text-lg font-semibold text-slate-900">
                        {booking.title}
                      </p>
                      <Badge tone={priorityTone(booking.priority)}>
                        {booking.priority}
                      </Badge>
                    </div>
                    <div className="flex flex-wrap items-center gap-2 mb-3">
                      <RequestTypeBadge booking={booking} />
                      <RequestStateBadge booking={booking} />
                      {needsManagerVerification(booking) ? (
                        <Badge tone="warning">Needs verification</Badge>
                      ) : null}
                    </div>
                  </div>
                  <ChevronRight className="mt-1 h-5 w-5 shrink-0 text-slate-400" />
                </div>

                <div className="grid gap-x-4 gap-y-2 text-sm text-slate-600 sm:grid-cols-2">
                  <div className="flex items-center gap-2 truncate">
                    {type === 'SPECIFIC_BA' ? (
                      <UserRound className="h-4 w-4 shrink-0 text-slate-400" />
                    ) : (
                      <UsersRound className="h-4 w-4 shrink-0 text-slate-400" />
                    )}
                    <span className="truncate">
                      {booking.ba?.full_name ?? 'Unassigned'}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 truncate">
                    <CalendarRange className="h-4 w-4 shrink-0 text-slate-400" />
                    <span className="truncate">
                      {formatDate(booking.start_date)} - {formatDate(booking.end_date)}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 truncate sm:col-span-2">
                    <span className="truncate">
                      Requester: {booking.requester.full_name}
                    </span>
                  </div>
                </div>
              </button>
            );
          })}

          {filteredBookings.length === 0 ? (
            <Card>
              <CardContent className="p-5 text-sm text-slate-500">
                No requests match the current filters.
              </CardContent>
            </Card>
          ) : null}
          {filteredBookings.length > 0 ? (
            <Card>
              <CardContent className="flex flex-col gap-3 p-4 text-sm text-slate-600 sm:flex-row sm:items-center sm:justify-between">
                <span>
                  Showing {(safePage - 1) * pageSize + 1}-
                  {Math.min(safePage * pageSize, filteredBookings.length)} of{' '}
                  {filteredBookings.length} requests
                </span>
                <div className="flex items-center gap-2 self-end sm:self-auto">
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => setPage(safePage - 1)}
                    disabled={safePage <= 1}
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                  <div className="flex items-center gap-2">
                    {visiblePages.map((page, index) =>
                      typeof page === 'number' ? (
                        <button
                          key={page}
                          type="button"
                          onClick={() => setPage(page)}
                          className={[
                            'inline-flex min-w-9 items-center justify-center rounded-md px-3 py-2 text-sm font-semibold transition-colors',
                            page === safePage
                              ? 'bg-blue-600 text-white'
                              : 'border border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:text-slate-950'
                          ].join(' ')}
                        >
                          {page}
                        </button>
                      ) : (
                        <span
                          key={`${page}-${index}`}
                          className="inline-flex min-w-9 items-center justify-center px-1 text-sm font-semibold text-slate-400"
                        >
                          ...
                        </span>
                      )
                    )}
                  </div>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => setPage(safePage + 1)}
                    disabled={safePage >= totalPages}
                  >
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ) : null}
        </div>

        {!isMobile && selectedBooking ? (
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
              assign.mutate({
                id: selectedBooking.id,
                baId: selectedBaId,
                capacityPercent: selectedCapacityPercent,
                currentCapacityPercent: selectedBooking.capacity_percent
              })
            }
            onAssignAndApprove={() =>
              assignAndApprove.mutate({
                id: selectedBooking.id,
                baId: selectedBaId,
                capacityPercent: selectedCapacityPercent,
                currentCapacityPercent: selectedBooking.capacity_percent
              })
            }
            onCancel={() => handleCancel(selectedBooking.id)}
            onSaveForLater={() =>
              setSaveForLaterMessage(`Saved ${selectedBooking.title} for later review.`)
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
        ) : !isMobile ? (
          <Card>
            <CardContent className="p-5 text-sm text-slate-500">
              Select a request to review details.
            </CardContent>
          </Card>
        ) : null}
      </div>

      {isMobile && selectedBooking && mobileDetailOpen ? (
        <div className="fixed inset-0 z-50 bg-slate-950/30" onClick={closeMobileDetail}>
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
                assign.mutate({
                  id: selectedBooking.id,
                  baId: selectedBaId,
                  capacityPercent: selectedCapacityPercent,
                  currentCapacityPercent: selectedBooking.capacity_percent
                })
              }
              onAssignAndApprove={() =>
                assignAndApprove.mutate({
                  id: selectedBooking.id,
                  baId: selectedBaId,
                  capacityPercent: selectedCapacityPercent,
                  currentCapacityPercent: selectedBooking.capacity_percent
                })
              }
              onCancel={() => handleCancel(selectedBooking.id)}
              onSaveForLater={() => {
                setSaveForLaterMessage(
                  `Saved ${selectedBooking.title} for later review.`
                );
                closeMobileDetail();
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
                <h2 className="text-base font-semibold text-slate-950">Unsaved changes</h2>
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
                <p className="mt-2 text-sm text-slate-600">There are unsaved edits in this review.</p>
              )}
            </div>

            <div className="mt-5 flex justify-end gap-2">
              <Button type="button" variant="secondary" onClick={() => setPendingNavigationAction(null)}>
                Stay here
              </Button>
              <Button
                type="button"
                variant="secondary"
                className={rejectButtonClassName}
                onClick={continuePendingNavigation}
              >
                Leave anyway
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      {selectedBooking ? (
        <Modal open={reviewModalOpen} onClose={() => setReviewModalOpen(false)} title="Review Changes">
          <div className="grid gap-3">
            {selectedPendingChangeEntries.map((entry) => (
              <div key={entry.key} className="rounded-lg border border-slate-200 p-3 text-sm">
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
  const requestState = getManagerRequestState(booking);
  const type = getRequestType(booking);
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
  const startStr = typeof booking.start_date === 'string'
    ? booking.start_date.slice(0, 10)
    : new Date(booking.start_date).toISOString().slice(0, 10);
  const canCancel = booking.status === 'APPROVED' && startStr > todayStr;
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

        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <DetailStat
            label={type === 'SPECIFIC_BA' ? 'Requested BA' : 'Requested BA / Assignment'}
            value={booking.ba?.full_name ?? selectedBa?.full_name ?? 'Unassigned'}
            hint={booking.ba?.level ?? selectedBa?.level ?? 'Assign BA'}
            tone="person"
            icon={UserRound}
          />
          <DetailStat
            label="Requester"
            value={booking.requester.full_name}
            hint={booking.requester.email}
            tone="requester"
            icon={UsersRound}
          />
          <DetailStat
            label="Priority"
            value={booking.priority}
            hint={`${capacityPercent}% capacity`}
            tone="priority"
            icon={Zap}
          />
          <DetailStat
            label="Request ID"
            value={booking.id.slice(0, 8).toUpperCase()}
            hint="Booking record"
            tone="neutral"
            icon={Hash}
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
                  {pendingChangeEntries.length} change{pendingChangeEntries.length === 1 ? '' : 's'} proposed — review each before approving or rejecting.
                </p>
              </div>
              <Badge tone="warning">Manager review required</Badge>
            </div>
            <Button
              type="button"
              onClick={onOpenReviewModal}
              disabled={isSubmitting}
            >
              Review Changes
            </Button>
          </section>
        ) : null}

        <div className="grid gap-4 xl:grid-cols-3">
          <InfoCard
            title="Date range"
            value={`${formatDate(booking.start_date)} - ${formatDate(booking.end_date)}`}
            hint="5 working days"
            tone="date"
            icon={CalendarRange}
          />
          <InfoCard
            title="Estimated capacity"
            value={`${capacityPercent}%`}
            hint={
              capacityChanged
                ? `Original: ${booking.capacity_percent}%`
                : requestState === 'NEED_VERIFICATION'
                  ? 'Needs verification'
                  : 'Current'
            }
            tone="capacity"
            icon={ShieldCheck}
          />
          <InfoCard
            title="Request type"
            value={type === 'SPECIFIC_BA' ? 'Specific BA request' : 'Open request'}
            hint={type === 'SPECIFIC_BA' ? 'Pre-assigned submission' : 'Needs assignment'}
            tone="type"
            icon={Layers3}
          />
        </div>

        <section className="grid gap-2 rounded-xl border border-slate-200 p-4">
          <p className="text-sm font-semibold text-slate-950">Project / Business need</p>
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
                disabled={!selectedBaId || isSubmitting || blocksCapacityDecision}
              >
                {capacityChanged ? 'Save + assign' : 'Assign BA'}
              </Button>
              <Button
                onClick={onAssignAndApprove}
                disabled={!selectedBaId || isSubmitting || blocksCapacityDecision}
              >
                {capacityChanged ? 'Save + assign + approve' : 'Assign + Approve'}
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
    currentDisplay: formatPendingChangeValue((booking as unknown as Record<string, unknown>)[key]),
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
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
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

function DetailStat({
  label,
  value,
  hint,
  tone,
  icon: Icon
}: {
  label: string;
  value: string;
  hint: string;
  tone: 'person' | 'requester' | 'priority' | 'neutral';
  icon: typeof UserRound;
}) {
  const styles = {
    person: {
      wrapper: 'border-slate-200 bg-white',
      label: 'text-slate-500',
      value: 'text-slate-950',
      hint: 'text-slate-500'
    },
    requester: {
      wrapper: 'border-slate-200 bg-white',
      label: 'text-slate-500',
      value: 'text-slate-950',
      hint: 'text-slate-500'
    },
    priority: {
      wrapper: 'border-slate-200 bg-white',
      label: 'text-slate-500',
      value: 'text-slate-950',
      hint: 'text-slate-500'
    },
    neutral: {
      wrapper: 'border-slate-200 bg-white',
      label: 'text-slate-400',
      value: 'text-slate-950',
      hint: 'text-slate-500'
    }
  } as const;
  const style = styles[tone];

  return (
    <div className={`rounded-xl border p-3 ${style.wrapper}`}>
      <div className="flex items-center gap-2">
        <Icon className="h-3.5 w-3.5 text-slate-400" />
        <p className={`text-xs uppercase tracking-wide ${style.label}`}>{label}</p>
      </div>
      <p className={`mt-3 text-sm font-semibold ${style.value}`}>{value}</p>
      <p className={`mt-1 text-xs ${style.hint}`}>{hint}</p>
    </div>
  );
}

function InfoCard({
  title,
  value,
  hint,
  tone,
  icon: Icon
}: {
  title: string;
  value: string;
  hint: string;
  tone: 'date' | 'capacity' | 'type';
  icon: typeof CalendarRange;
}) {
  const styles = {
    date: {
      wrapper: 'border-slate-200 bg-white',
      label: 'text-slate-500',
      value: 'text-slate-950',
      hint: 'text-slate-500'
    },
    capacity: {
      wrapper: 'border-slate-200 bg-white',
      label: 'text-slate-500',
      value: 'text-slate-950',
      hint: 'text-slate-500'
    },
    type: {
      wrapper: 'border-slate-200 bg-white',
      label: 'text-slate-500',
      value: 'text-slate-950',
      hint: 'text-slate-500'
    }
  } as const;
  const style = styles[tone];

  return (
    <div className={`rounded-xl border p-4 ${style.wrapper}`}>
      <div className="flex items-center gap-2">
        <Icon className="h-3.5 w-3.5 text-slate-400" />
        <p className={`text-xs uppercase tracking-wide ${style.label}`}>{title}</p>
      </div>
      <p className={`mt-3 text-sm font-semibold ${style.value}`}>{value}</p>
      <p className={`mt-1 text-xs ${style.hint}`}>{hint}</p>
    </div>
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
  return value === 'NEWEST' || value === 'OLDEST' || value === 'PRIORITY';
}

function getInboxPriorityScore(booking: Booking) {
  const state = getManagerRequestState(booking);
  let score = 0;

  if (booking.status === 'PENDING') score += 100;
  if (state === 'NEED_VERIFICATION') score += 40;
  if (state === 'NEEDS_ASSIGNMENT') score += 30;
  if (getRequestType(booking) === 'OPEN_REQUEST') score += 10;

  switch (booking.priority) {
    case 'URGENT':
      score += 50;
      break;
    case 'HIGH':
      score += 30;
      break;
    case 'MEDIUM':
      score += 15;
      break;
    default:
      score += 5;
      break;
  }

  return score;
}
