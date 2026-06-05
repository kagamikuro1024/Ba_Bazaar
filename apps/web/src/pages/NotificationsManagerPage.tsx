import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { useAuth } from '@/auth/AuthProvider';
import { Modal } from '@/components/ui/modal';
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
    if (!selectedBooking) {
      return;
    }

    setCapacityDrafts((current) => ({
      ...current,
      [selectedBooking.id]: String(selectedBooking.capacity_percent)
    }));
  }, [selectedBooking]);

  function handleMutationSuccess() {
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
      return;
    }

    await apiFetch(`/api/bookings/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ capacity_percent: capacityPercent })
    });
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
    onSuccess: handleMutationSuccess
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
    onSuccess: handleMutationSuccess
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
    onSuccess: handleMutationSuccess
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
      handleMutationSuccess();
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
    onSuccess: handleMutationSuccess
  });

  if (role !== 'BA_MANAGER' && role !== 'ADMIN') {
    return <NotificationsListPage />;
  }

  return (
    <>
      <NotificationsListPage />
      <Modal
        title={selectedBooking ? selectedBooking.title : 'Request detail'}
        open={Boolean(selectedBooking)}
        onClose={() => {
          setSearchParams((current) => {
            const next = new URLSearchParams(current);
            next.delete('bookingId');
            return next;
          }, { replace: true });
        }}
      >
        {selectedBooking ? (
          <div className="max-h-[80vh] overflow-y-auto pr-1">
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
              onAssign={() => assign.mutate()}
              onAssignAndApprove={() => assignAndApprove.mutate()}
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
        ) : null}
      </Modal>
    </>
  );
}
