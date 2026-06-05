import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { useAuth } from '@/auth/AuthProvider';
import { Button } from '@/components/ui/button';
import {
  apiFetch,
  type BAProfile,
  type Booking
} from '@/lib/api';
import { parseCapacityPercent } from '@/lib/capacity';
import { NotificationsPage as NotificationsListPage } from './NotificationsPage';
import {
  RequestDetailPanel
} from './ManagerInboxPage';

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

export function NotificationsManagerPage() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const role = user?.role ?? 'BA';
  const [searchParams, setSearchParams] = useSearchParams();
  const bookingId = searchParams.get('bookingId');
  const [assignDrafts, setAssignDrafts] = useState<Record<string, string>>({});
  const [capacityDrafts, setCapacityDrafts] = useState<Record<string, string>>({});
  const [successMessage, setSuccessMessage] = useState('');
  const [confirmationState, setConfirmationState] = useState<{
    title: string;
    body: string;
    confirmLabel: string;
    action: () => void;
  } | null>(null);

  const bas = useQuery({
    queryKey: ['ba-directory', role],
    queryFn: () => apiFetch<BAProfile[]>('/api/ba'),
    enabled: role === 'BA_MANAGER' || role === 'ADMIN'
  });
  const summary = useQuery({
    queryKey: ['capacity-summary', role],
    queryFn: () =>
      apiFetch<CapacitySummary>('/api/capacity/summary'),
    enabled: role === 'BA_MANAGER' || role === 'ADMIN'
  });
  const booking = useQuery({
    queryKey: ['notifications-booking-detail', bookingId],
    queryFn: () => apiFetch<Booking>(`/api/bookings/${bookingId}`),
    enabled: Boolean(bookingId) && (role === 'BA_MANAGER' || role === 'ADMIN')
  });

  const selectedBooking = booking.data;
  const selectedBaId =
    (selectedBooking && assignDrafts[selectedBooking.id]) || selectedBooking?.ba_id || '';
  const selectedCapacityDraft = selectedBooking
    ? (capacityDrafts[selectedBooking.id] ?? String(selectedBooking.capacity_percent))
    : '';
  const selectedCapacityPercent =
    parseCapacityPercent(selectedCapacityDraft) ?? selectedBooking?.capacity_percent ?? 50;
  const selectedBa = (bas.data ?? []).find((ba) => ba.id === selectedBaId);


  const selectedCapacity = useQuery({
    queryKey: [
      'notifications-capacity-detail',
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
    if (!successMessage) {
      return;
    }

    const timeout = window.setTimeout(() => setSuccessMessage(''), 3000);
    return () => window.clearTimeout(timeout);
  }, [successMessage]);

  function runWithCapacityConfirmation(confirmLabel: string, action: () => void) {
    if (!selectedBooking || !selectedBaId || !selectedBa) {
      action();
      return;
    }

    const projectedAvailability = 100 - (selectedCapacity?.data?.max_approved_capacity ?? 0);
    const exceedsCapacity = (selectedCapacity?.data?.max_approved_capacity ?? 0) + selectedCapacityPercent > 100;
    const hasZeroAvailability = projectedAvailability <= 0;

    if (!hasZeroAvailability && !exceedsCapacity) {
      action();
      return;
    }

    setConfirmationState({
      title: exceedsCapacity ? 'Exceeds BA capacity' : 'Assign BA with 0% availability?',
      body: exceedsCapacity
        ? `${selectedBa.full_name} would exceed 100% approved capacity with this assignment. Are you sure you want to continue?`
        : `${selectedBa.full_name} currently has 0% availability for this period. Are you sure you want to continue?`,
      confirmLabel,
      action
    });
  }

  useEffect(() => {
    if (!selectedBooking) {
      return;
    }

    setCapacityDrafts((current) => ({
      ...current,
      [selectedBooking.id]: String(selectedBooking.capacity_percent)
    }));
  }, [selectedBooking]);

  function handleMutationSuccess(message?: string) {
    if (message) {
      setSuccessMessage(message);
    }
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
    }
    void queryClient.invalidateQueries();
    if (bookingId) {
      void booking.refetch();
    }
  }

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

    queryClient.setQueryData<Booking | undefined>(['notifications-booking-detail', bookingId], (current) =>
      current && current.id === id ? { ...current, capacity_percent: capacityPercent } : current
    );

    return true;
  }

  const approve = useMutation({
    mutationFn: async () => {
      if (!selectedBooking) return;
      await saveCapacityIfChanged(
        selectedBooking.id,
        selectedCapacityPercent,
        selectedBooking.capacity_percent
      );
      return apiFetch(`/api/bookings/${selectedBooking.id}/approve`, { method: 'POST' });
    },
    onSuccess: () => handleMutationSuccess('Request approved successfully.')
  });
  const assign = useMutation({
    mutationFn: async () => {
      if (!selectedBooking) return;
      await saveCapacityIfChanged(
        selectedBooking.id,
        selectedCapacityPercent,
        selectedBooking.capacity_percent
      );
      return apiFetch(`/api/bookings/${selectedBooking.id}/assign`, {
        method: 'PATCH',
        body: JSON.stringify({ ba_id: selectedBaId })
      });
    },
    onSuccess: () => handleMutationSuccess('BA assigned successfully.')
  });
  const assignAndApprove = useMutation({
    mutationFn: async () => {
      if (!selectedBooking) return;
      await saveCapacityIfChanged(
        selectedBooking.id,
        selectedCapacityPercent,
        selectedBooking.capacity_percent
      );
      await apiFetch(`/api/bookings/${selectedBooking.id}/assign`, {
        method: 'PATCH',
        body: JSON.stringify({ ba_id: selectedBaId })
      });
      return apiFetch(`/api/bookings/${selectedBooking.id}/approve`, { method: 'POST' });
    },
    onSuccess: () => handleMutationSuccess('BA assigned and request approved successfully.')
  });
  const cancel = useMutation({
    mutationFn: async () => {
      if (!selectedBooking) {
        throw new Error('No booking selected');
      }
      return apiFetch(`/api/bookings/${selectedBooking.id}/cancel`, {
        method: 'POST',
        body: JSON.stringify({ cancel_reason: 'Cancelled from notifications view' })
      });
    },
    onSuccess: () => {
      handleMutationSuccess('Request cancelled successfully.');
      setSearchParams((current) => {
        const next = new URLSearchParams(current);
        next.delete('bookingId');
        return next;
      }, { replace: true });
    }
  });
  const updateCapacity = useMutation({
    mutationFn: async () => {
      if (!selectedBooking) {
        throw new Error('No booking selected');
      }
      return apiFetch(`/api/bookings/${selectedBooking.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ capacity_percent: selectedCapacityPercent })
      });
    },
    onSuccess: () => handleMutationSuccess('Capacity saved successfully.')
  });

  if (role !== 'BA_MANAGER' && role !== 'ADMIN') {
    return <NotificationsListPage />;
  }

  return (
    <>
      <NotificationsListPage />
      {successMessage ? (
        <div className="fixed right-4 top-4 z-[60] max-w-sm rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-800 shadow-lg">
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
      {confirmationState ? (
        <div className="fixed inset-0 z-[70] grid place-items-center bg-slate-950/40 p-4">
          <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl">
            <h3 className="text-base font-semibold text-slate-950">{confirmationState.title}</h3>
            <p className="mt-2 text-sm leading-6 text-slate-600">{confirmationState.body}</p>
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
        <div
          className="fixed inset-0 z-50 bg-slate-950/30 p-4"
          onClick={() => {
            setSearchParams((current) => {
              const next = new URLSearchParams(current);
              next.delete('bookingId');
              return next;
            }, { replace: true });
          }}
        >
          <div
            className="mx-auto max-h-[calc(100vh-2rem)] max-w-6xl overflow-y-auto rounded-2xl bg-white p-4 shadow-2xl lg:p-6"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="mb-4 flex items-center justify-between gap-3 border-b border-slate-200 pb-4">
              <div>
                <p className="text-base font-semibold text-slate-950">{selectedBooking.title}</p>
                <p className="mt-1 text-sm text-slate-500">Review this request without leaving notifications.</p>
              </div>
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  setSearchParams((current) => {
                    const next = new URLSearchParams(current);
                    next.delete('bookingId');
                    return next;
                  }, { replace: true });
                }}
              >
                Close
              </Button>
            </div>
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
              onSaveCapacity={() => updateCapacity.mutate()}
              onApprove={() => approve.mutate()}
              onReject={() => {}}
              onAssign={() =>
                runWithCapacityConfirmation('Assign BA', () => assign.mutate())
              }
              onAssignAndApprove={() =>
                runWithCapacityConfirmation('Assign + Approve', () =>
                  assignAndApprove.mutate()
                )
              }
              onCancel={() => cancel.mutate()}
              onSaveForLater={() => {
                setSearchParams((current) => {
                  const next = new URLSearchParams(current);
                  next.delete('bookingId');
                  return next;
                }, { replace: true });
              }}
              onApproveChanges={() => {}}
              onRejectChanges={() => {}}
              onChangeDraftDirty={() => {}}
              onOpenReviewModal={() => {}}
              onApproveField={() => {}}
              onRejectField={() => {}}
              canManageActions
              isSubmitting={
                approve.isPending ||
                assign.isPending ||
                assignAndApprove.isPending ||
                cancel.isPending ||
                updateCapacity.isPending
              }
            />
          </div>
        </div>
      ) : null}
    </>
  );
}
