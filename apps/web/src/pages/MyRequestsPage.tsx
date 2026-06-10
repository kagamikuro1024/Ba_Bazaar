import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { CalendarRange, Edit3, Eye, RotateCcw, UserRound } from 'lucide-react';
import {
  apiFetch,
  getRequestType,
  type BAProfile,
  type Booking,
  type BookingPriority
} from '@/lib/api';
import { CAPACITY_OPTIONS } from '@/lib/capacity';
import { StatusBadge } from '@/components/common';
import { BookingModal } from '@/components/BookingModal';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { LoadingScreen } from '@/components/ui/loading-screen';
import { Modal } from '@/components/ui/modal';
import { formatDate, priorityTone } from '@/lib/format';

type RequestDraft = {
  id: string;
  title: string;
  description: string;
  notes: string;
  start_date: string;
  end_date: string;
  capacity_percent: number;
  priority: BookingPriority;
  ba_id?: string;
};

export function MyRequestsPage() {
  const queryClient = useQueryClient();
  const [searchParams] = useSearchParams();
  const targetBookingId = searchParams.get('bookingId') ?? searchParams.get('requestId');
  const [status, setStatus] = useState('');
  const [editing, setEditing] = useState<Booking | null>(null);
  const [viewing, setViewing] = useState<Booking | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [successMessage, setSuccessMessage] = useState('');
  const requests = useQuery({
    queryKey: ['my-requests', status],
    queryFn: () =>
      apiFetch<Booking[]>(`/api/bookings/my-requests${status ? `?status=${status}` : ''}`)
  });
  const bas = useQuery({
    queryKey: ['my-requests-bas'],
    queryFn: () => apiFetch<BAProfile[]>('/api/ba?bookable=true')
  });
  const updateRequest = useMutation({
    mutationFn: (draft: RequestDraft) =>
      apiFetch(`/api/bookings/${draft.id}`, {
        method: 'PATCH',
        body: JSON.stringify(draft)
      }),
    onSuccess: () => {
      setEditing(null);
      setSuccessMessage('Request updated and sent for manager review.');
      void queryClient.invalidateQueries();
    }
  });

  useEffect(() => {
    if (!successMessage) return;
    const timeout = window.setTimeout(() => setSuccessMessage(''), 3000);
    return () => window.clearTimeout(timeout);
  }, [successMessage]);

  function hasPendingChanges(booking: Booking) {
    return Boolean(
      booking.pending_changes && Object.keys(booking.pending_changes).length > 0
    );
  }

  function canEditBooking(booking: Booking) {
    return (
      !hasPendingChanges(booking) &&
      (booking.status === 'PENDING' || booking.status === 'REJECTED')
    );
  }

  return (
    <div className="grid gap-5">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        {successMessage ? (
          <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-800">
            {successMessage}
          </div>
        ) : (
          <span />
        )}
        <div className="flex flex-wrap items-center justify-end gap-2">
          <select
            value={status}
            onChange={(event) => setStatus(event.target.value)}
            className="h-10 rounded-md border px-3 text-sm"
          >
            <option value="">All status</option>
            {[
              'PENDING',
              'APPROVED',
              'REJECTED',
              'IN_PROGRESS',
              'COMPLETED',
              'CANCELLED'
            ].map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
          <Button onClick={() => setCreateOpen(true)}>Create Request</Button>
        </div>
      </div>

      {requests.isLoading ? <LoadingScreen message="Loading your requests" /> : null}
      {requests.error ? (
        <Card>
          <CardContent className="p-5 text-sm text-rose-700">
            Could not load requests. Check API connection and retry.
          </CardContent>
        </Card>
      ) : null}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {(requests.data ?? []).map((booking) => (
          <RequestCard
            key={booking.id}
            booking={booking}
            highlighted={booking.id === targetBookingId}
            hasPendingChanges={hasPendingChanges(booking)}
            canEdit={canEditBooking(booking)}
            onView={() => setViewing(booking)}
            onEdit={() => setEditing(booking)}
          />
        ))}
        {requests.data?.length === 0 ? (
          <Card>
            <CardContent className="p-5 text-sm text-slate-600">
              No requests match the selected status.
            </CardContent>
          </Card>
        ) : null}
      </div>

      <EditRequestModal
        booking={editing}
        bas={bas.data ?? []}
        isPending={updateRequest.isPending}
        error={updateRequest.error}
        onClose={() => {
          if (!updateRequest.isPending) setEditing(null);
        }}
        onSubmit={(draft) => updateRequest.mutate(draft)}
      />

      <RequestDetailModal booking={viewing} onClose={() => setViewing(null)} />
      <BookingModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onSuccess={() => {
          setCreateOpen(false);
          setSuccessMessage('Request created.');
          void queryClient.invalidateQueries();
        }}
      />
    </div>
  );
}

function RequestCard({
  booking,
  highlighted,
  hasPendingChanges,
  canEdit,
  onView,
  onEdit
}: {
  booking: Booking;
  highlighted: boolean;
  hasPendingChanges: boolean;
  canEdit: boolean;
  onView: () => void;
  onEdit: () => void;
}) {
  return (
    <Card className={highlighted ? 'ring-2 ring-blue-600 ring-offset-2' : ''}>
      <CardContent className="grid h-full gap-3 p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="truncate text-base font-semibold text-slate-950">
              {booking.title || booking.project.name}
            </h3>
            <p className="mt-1 truncate text-sm text-slate-500">{booking.project.name}</p>
          </div>
          <StatusBadge status={booking.status} />
        </div>

        <div className="flex flex-wrap gap-2">
          <Badge tone={priorityTone(booking.priority)}>{booking.priority}</Badge>
          <Badge tone={booking.ba ? 'info' : 'success'}>
            {booking.ba ? 'Specific BA' : 'Open Request'}
          </Badge>
          {hasPendingChanges ? <Badge tone="warning">Changes pending</Badge> : null}
        </div>

        <div className="grid gap-2 text-sm text-slate-600">
          <CompactMeta
            icon={CalendarRange}
            label="Date"
            value={`${formatDate(booking.start_date)} - ${formatDate(booking.end_date)}`}
          />
          <CompactMeta
            icon={UserRound}
            label={booking.ba ? 'Requested BA' : 'Assignment'}
            value={booking.ba?.full_name ?? 'Unassigned'}
          />
          <div className="flex items-center justify-between rounded-md bg-slate-50 px-3 py-2">
            <span>Capacity</span>
            <strong className="text-slate-950">{booking.capacity_percent}%</strong>
          </div>
        </div>

        {booking.reject_reason ? (
          <p className="line-clamp-2 rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-700">
            {booking.reject_reason}
          </p>
        ) : null}

        <div className="mt-auto grid gap-2 sm:grid-cols-2">
          <Button variant="secondary" size="sm" onClick={onView}>
            <Eye className="h-4 w-4" /> View
          </Button>
          {canEdit ? (
            <Button size="sm" onClick={onEdit}>
              {booking.status === 'REJECTED' ? (
                <RotateCcw className="h-4 w-4" />
              ) : (
                <Edit3 className="h-4 w-4" />
              )}
              {booking.status === 'REJECTED' ? 'Resubmit' : 'Edit'}
            </Button>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}

function CompactMeta({
  icon: Icon,
  label,
  value
}: {
  icon: typeof CalendarRange;
  label: string;
  value: string;
}) {
  return (
    <div className="flex min-w-0 items-center gap-2 rounded-md bg-slate-50 px-3 py-2">
      <Icon className="h-4 w-4 shrink-0 text-slate-400" />
      <span className="shrink-0 text-slate-500">{label}</span>
      <span className="min-w-0 truncate font-medium text-slate-800">{value}</span>
    </div>
  );
}

function EditRequestModal({
  booking,
  bas,
  isPending,
  error,
  onClose,
  onSubmit
}: {
  booking: Booking | null;
  bas: BAProfile[];
  isPending: boolean;
  error: Error | null;
  onClose: () => void;
  onSubmit: (draft: RequestDraft) => void;
}) {
  const [draft, setDraft] = useState<RequestDraft | null>(null);
  const [localError, setLocalError] = useState('');

  useEffect(() => {
    if (!booking) {
      setDraft(null);
      setLocalError('');
      return;
    }

    setDraft({
      id: booking.id,
      title: booking.title,
      description: booking.description,
      notes: booking.notes ?? '',
      start_date: booking.start_date.slice(0, 10),
      end_date: booking.end_date.slice(0, 10),
      capacity_percent: booking.capacity_percent,
      priority: booking.priority,
      ba_id: booking.ba_id ?? undefined
    });
    setLocalError('');
  }, [booking]);

  if (!booking || !draft) {
    return null;
  }

  const isSpecificBa = getRequestType(booking) === 'SPECIFIC_BA';

  return (
    <Modal
      title={booking.status === 'REJECTED' ? 'Edit & Resubmit Request' : 'Edit Request'}
      open={Boolean(booking)}
      onClose={onClose}
    >
      <form
        className="grid gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          if (draft.end_date < draft.start_date) {
            setLocalError('End date must be greater than or equal to start date.');
            return;
          }

          if (isSpecificBa && !draft.ba_id) {
            setLocalError('Requested BA is required for a specific BA request.');
            return;
          }

          setLocalError('');
          onSubmit(draft);
        }}
      >
        <label className="grid gap-2">
          <span className="text-sm font-semibold text-slate-700">
            Project / task name
          </span>
          <input
            value={draft.title}
            onChange={(event) => setDraft({ ...draft, title: event.target.value })}
            className="h-10 rounded-md border px-3 text-sm"
            required
          />
        </label>

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="grid gap-2">
            <span className="text-sm font-semibold text-slate-700">Start date</span>
            <input
              type="date"
              value={draft.start_date}
              onChange={(event) => setDraft({ ...draft, start_date: event.target.value })}
              className="h-10 rounded-md border px-3 text-sm"
              required
            />
          </label>
          <label className="grid gap-2">
            <span className="text-sm font-semibold text-slate-700">End date</span>
            <input
              type="date"
              value={draft.end_date}
              onChange={(event) => setDraft({ ...draft, end_date: event.target.value })}
              className="h-10 rounded-md border px-3 text-sm"
              required
            />
          </label>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="grid gap-2">
            <span className="text-sm font-semibold text-slate-700">Capacity</span>
            <select
              value={draft.capacity_percent}
              onChange={(event) =>
                setDraft({ ...draft, capacity_percent: Number(event.target.value) })
              }
              className="h-10 rounded-md border px-3 text-sm"
            >
              {CAPACITY_OPTIONS.map((capacityPercent) => (
                <option key={capacityPercent} value={capacityPercent}>
                  {capacityPercent}%
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-2">
            <span className="text-sm font-semibold text-slate-700">Priority</span>
            <select
              value={draft.priority}
              onChange={(event) =>
                setDraft({ ...draft, priority: event.target.value as BookingPriority })
              }
              className="h-10 rounded-md border px-3 text-sm"
            >
              {['LOW', 'MEDIUM', 'HIGH', 'URGENT'].map((priority) => (
                <option key={priority} value={priority}>
                  {priority}
                </option>
              ))}
            </select>
          </label>
        </div>

        {isSpecificBa ? (
          <label className="grid gap-2">
            <span className="text-sm font-semibold text-slate-700">Requested BA</span>
            <select
              value={draft.ba_id ?? ''}
              onChange={(event) =>
                setDraft({ ...draft, ba_id: event.target.value || undefined })
              }
              className="h-10 rounded-md border px-3 text-sm"
              required
            >
              <option value="">Select BA</option>
              {bas.map((ba) => (
                <option key={ba.id} value={ba.id}>
                  {ba.full_name} - {ba.level}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <label className="grid gap-2">
            <span className="text-sm font-semibold text-slate-700">
              Required skills / preparation note
            </span>
            <textarea
              value={draft.notes}
              onChange={(event) => setDraft({ ...draft, notes: event.target.value })}
              className="min-h-20 rounded-md border p-3 text-sm"
              placeholder="Mention required domain or analysis skills..."
            />
          </label>
        )}

        <label className="grid gap-2">
          <span className="text-sm font-semibold text-slate-700">
            Description / scope
          </span>
          <textarea
            value={draft.description}
            onChange={(event) => setDraft({ ...draft, description: event.target.value })}
            className="min-h-28 rounded-md border p-3 text-sm"
            required
          />
        </label>

        {localError || error ? (
          <p className="rounded-md bg-rose-50 p-3 text-sm text-rose-700">
            {localError || error?.message}
          </p>
        ) : null}

        <div className="flex flex-wrap justify-end gap-2">
          <Button
            type="button"
            variant="secondary"
            onClick={onClose}
            disabled={isPending}
          >
            Cancel
          </Button>
          <Button type="submit" disabled={isPending}>
            {isPending
              ? 'Submitting...'
              : booking.status === 'REJECTED'
                ? 'Submit again'
                : 'Submit changes'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function RequestDetailModal({
  booking,
  onClose
}: {
  booking: Booking | null;
  onClose: () => void;
}) {
  return (
    <Modal title="Request Detail" open={Boolean(booking)} onClose={onClose}>
      {booking ? (
        <div className="grid gap-4 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge status={booking.status} />
            <Badge tone={priorityTone(booking.priority)}>{booking.priority}</Badge>
          </div>
          <div>
            <h3 className="text-base font-semibold text-slate-950">{booking.title}</h3>
            <p className="mt-1 text-slate-500">{booking.project.name}</p>
          </div>
          <p className="leading-6 text-slate-600">{booking.description}</p>
          <div className="grid gap-2 rounded-lg border border-slate-200 bg-slate-50 p-3">
            <p>
              Date: {formatDate(booking.start_date)} - {formatDate(booking.end_date)}
            </p>
            <p>Capacity: {booking.capacity_percent}%</p>
            <p>BA: {booking.ba?.full_name ?? 'Unassigned'}</p>
            {booking.reject_reason ? <p>Reject reason: {booking.reject_reason}</p> : null}
            {booking.cancel_reason ? <p>Cancel reason: {booking.cancel_reason}</p> : null}
          </div>
        </div>
      ) : null}
    </Modal>
  );
}
