import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch, type Booking } from '@/lib/api';
import { StatusBadge } from '@/components/common';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { LoadingScreen } from '@/components/ui/loading-screen';
import { formatDate } from '@/lib/format';

export function MyRequestsPage() {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState('');
  const [editing, setEditing] = useState<Booking | null>(null);
  const requests = useQuery({
    queryKey: ['my-requests', status],
    queryFn: () =>
      apiFetch<Booking[]>(`/api/bookings/my-requests${status ? `?status=${status}` : ''}`)
  });
  const resubmit = useMutation({
    mutationFn: (draft: {
      id: string;
      title: string;
      description: string;
      start_date: string;
      end_date: string;
      capacity_percent: number;
    }) =>
      apiFetch(`/api/bookings/${draft.id}`, {
        method: 'PATCH',
        body: JSON.stringify(draft)
      }),
    onSuccess: () => {
      setEditing(null);
      void queryClient.invalidateQueries();
    }
  });

  return (
    <div className="grid gap-5">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-end">
        <select value={status} onChange={(event) => setStatus(event.target.value)} className="h-10 rounded-md border px-3 text-sm">
          <option value="">All status</option>
          {['PENDING', 'APPROVED', 'REJECTED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'].map((item) => <option key={item} value={item}>{item}</option>)}
        </select>
      </div>
      {requests.isLoading ? (
        <LoadingScreen message="Loading your requests" />
      ) : null}
      {requests.error ? (
        <Card><CardContent className="p-5 text-sm text-rose-700">Could not load requests. Check API connection and retry.</CardContent></Card>
      ) : null}
      <div className="grid gap-4">
        {(requests.data ?? []).map((booking) => (
          <Card key={booking.id}>
            <CardContent className="grid gap-3 p-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h3 className="font-semibold text-slate-950">{booking.project.name}</h3>
                  <p className="text-sm text-slate-600">{booking.ba?.full_name ?? 'Auto assign'}</p>
                </div>
                <StatusBadge status={booking.status} />
              </div>
              <p className="text-sm text-slate-600">
                {formatDate(booking.start_date)} - {formatDate(booking.end_date)} · {booking.capacity_percent}% · {booking.priority}
              </p>
              {booking.reject_reason ? <p className="rounded-md bg-rose-50 p-3 text-sm text-rose-700">Reject reason: {booking.reject_reason}</p> : null}
              {booking.cancel_reason ? <p className="rounded-md bg-amber-50 p-3 text-sm text-amber-800">Cancel reason: {booking.cancel_reason}</p> : null}
              {editing?.id === booking.id ? (
                <ResubmitForm
                  booking={booking}
                  isPending={resubmit.isPending}
                  error={resubmit.error}
                  onCancel={() => setEditing(null)}
                  onSubmit={(draft) => resubmit.mutate(draft)}
                />
              ) : booking.status === 'REJECTED' ? (
                <Button variant="secondary" onClick={() => setEditing(booking)}>
                  Edit & Resubmit
                </Button>
              ) : null}
            </CardContent>
          </Card>
        ))}
        {requests.data?.length === 0 ? (
          <Card><CardContent className="p-5 text-sm text-slate-600">No requests match the selected status.</CardContent></Card>
        ) : null}
      </div>
    </div>
  );
}

function ResubmitForm({
  booking,
  isPending,
  error,
  onCancel,
  onSubmit
}: {
  booking: Booking;
  isPending: boolean;
  error: Error | null;
  onCancel: () => void;
  onSubmit: (draft: {
    id: string;
    title: string;
    description: string;
    start_date: string;
    end_date: string;
    capacity_percent: number;
  }) => void;
}) {
  const [title, setTitle] = useState(booking.title);
  const [description, setDescription] = useState(booking.description);
  const [startDate, setStartDate] = useState(booking.start_date.slice(0, 10));
  const [endDate, setEndDate] = useState(booking.end_date.slice(0, 10));
  const [capacity, setCapacity] = useState(booking.capacity_percent);
  const [localError, setLocalError] = useState('');

  return (
    <form
      className="grid gap-3 rounded-md border bg-slate-50 p-3"
      onSubmit={(event) => {
        event.preventDefault();
        if (endDate < startDate) {
          setLocalError('End date must be greater than or equal to start date.');
          return;
        }
        setLocalError('');
        onSubmit({
          id: booking.id,
          title,
          description,
          start_date: startDate,
          end_date: endDate,
          capacity_percent: capacity
        });
      }}
    >
      <input
        value={title}
        onChange={(event) => setTitle(event.target.value)}
        className="h-10 rounded-md border px-3 text-sm"
        required
      />
      <textarea
        value={description}
        onChange={(event) => setDescription(event.target.value)}
        className="min-h-24 rounded-md border p-3 text-sm"
        required
      />
      <div className="grid gap-3 md:grid-cols-3">
        <input
          type="date"
          value={startDate}
          onChange={(event) => setStartDate(event.target.value)}
          className="h-10 rounded-md border px-3 text-sm"
          required
        />
        <input
          type="date"
          value={endDate}
          onChange={(event) => setEndDate(event.target.value)}
          className="h-10 rounded-md border px-3 text-sm"
          required
        />
        <select
          value={capacity}
          onChange={(event) => setCapacity(Number(event.target.value))}
          className="h-10 rounded-md border px-3 text-sm"
        >
          <option value={50}>50%</option>
          <option value={100}>100%</option>
        </select>
      </div>
      {localError || error ? (
        <p className="rounded-md bg-rose-50 p-3 text-sm text-rose-700">
          {localError || error?.message}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={isPending}>
          {isPending ? 'Submitting...' : 'Submit Pending Request'}
        </Button>
        <Button type="button" variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
