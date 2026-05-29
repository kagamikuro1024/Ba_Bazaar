import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch, type Booking } from '@/lib/api';
import { StatusBadge } from '@/components/common';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { formatDate } from '@/lib/format';

export function MyRequestsPage() {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState('');
  const requests = useQuery({
    queryKey: ['my-requests', status],
    queryFn: () =>
      apiFetch<Booking[]>(`/api/bookings/my-requests${status ? `?status=${status}` : ''}`)
  });
  const resubmit = useMutation({
    mutationFn: (booking: Booking) =>
      apiFetch(`/api/bookings/${booking.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          title: booking.title,
          description: `${booking.description} Resubmitted with additional context.`
        })
      }),
    onSuccess: () => void queryClient.invalidateQueries()
  });

  return (
    <div className="grid gap-5">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h2 className="text-2xl font-bold text-slate-950">My Requests</h2>
          <p className="text-sm text-slate-600">Requests created by the current PM/PO.</p>
        </div>
        <select value={status} onChange={(event) => setStatus(event.target.value)} className="h-10 rounded-md border px-3 text-sm">
          <option value="">All status</option>
          {['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED'].map((item) => <option key={item} value={item}>{item}</option>)}
        </select>
      </div>
      <div className="grid gap-4">
        {(requests.data ?? []).map((booking) => (
          <Card key={booking.id}>
            <CardContent className="grid gap-3 p-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h3 className="font-semibold text-slate-950">{booking.project.name}</h3>
                  <p className="text-sm text-slate-600">{booking.ba.full_name}</p>
                </div>
                <StatusBadge status={booking.status} />
              </div>
              <p className="text-sm text-slate-600">
                {formatDate(booking.start_date)} - {formatDate(booking.end_date)} · {booking.capacity_percent}% · {booking.priority}
              </p>
              {booking.reject_reason ? <p className="rounded-md bg-rose-50 p-3 text-sm text-rose-700">Reject reason: {booking.reject_reason}</p> : null}
              {booking.status === 'REJECTED' ? (
                <Button variant="secondary" onClick={() => resubmit.mutate(booking)}>
                  Edit & Resubmit
                </Button>
              ) : null}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
