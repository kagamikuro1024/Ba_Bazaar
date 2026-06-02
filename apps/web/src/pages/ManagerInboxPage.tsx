import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch, type Booking } from '@/lib/api';
import { BAIdentity, StatusBadge } from '@/components/common';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { formatDate } from '@/lib/format';

export function ManagerInboxPage() {
  const queryClient = useQueryClient();
  const pending = useQuery({
    queryKey: ['manager-inbox'],
    queryFn: () => apiFetch<Booking[]>('/api/bookings?status=PENDING')
  });
  const approve = useMutation({
    mutationFn: (id: string) => apiFetch(`/api/bookings/${id}/approve`, { method: 'POST' }),
    onSuccess: () => void queryClient.invalidateQueries()
  });
  const reject = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      apiFetch(`/api/bookings/${id}/reject`, {
        method: 'POST',
        body: JSON.stringify({ reject_reason: reason })
      }),
    onSuccess: () => void queryClient.invalidateQueries()
  });

  return (
    <div className="grid gap-5">
      {(approve.error || reject.error) ? (
        <div className="rounded-md bg-rose-50 p-3 text-sm text-rose-700">
          {(approve.error ?? reject.error)?.message}
        </div>
      ) : null}
      {pending.isLoading ? (
        <Card><CardContent className="p-5 text-sm text-slate-600">Loading pending requests...</CardContent></Card>
      ) : null}
      {pending.error ? (
        <Card><CardContent className="p-5 text-sm text-rose-700">Could not load manager inbox. Check API connection and retry.</CardContent></Card>
      ) : null}
      <div className="grid gap-4">
        {(pending.data ?? []).map((booking) => (
          <Card key={booking.id}>
            <CardContent className="grid gap-4 p-5 lg:grid-cols-[1fr_auto] lg:items-center">
              <div className="grid gap-3">
                <div className="flex flex-wrap items-center gap-3">
                  <BAIdentity ba={booking.ba} />
                  <StatusBadge status={booking.status} />
                </div>
                <div>
                  <h3 className="font-semibold text-slate-950">{booking.project.name}</h3>
                  <p className="text-sm text-slate-600">{booking.description}</p>
                </div>
                <div className="grid gap-2 text-sm text-slate-600 sm:grid-cols-4">
                  <span>{formatDate(booking.start_date)} - {formatDate(booking.end_date)}</span>
                  <span>{booking.capacity_percent}% capacity</span>
                  <span>{booking.priority}</span>
                  <span>Requester: {booking.requester.full_name}</span>
                </div>
              </div>
              <div className="flex gap-2">
                <Button onClick={() => approve.mutate(booking.id)}>Approve</Button>
                <Button
                  variant="secondary"
                  onClick={() => {
                    const reason = window.prompt('Reject reason');
                    if (reason) reject.mutate({ id: booking.id, reason });
                  }}
                >
                  Reject
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
        {pending.data?.length === 0 ? (
          <Card><CardHeader><CardTitle>No pending requests</CardTitle></CardHeader></Card>
        ) : null}
      </div>
    </div>
  );
}
