import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch, type BAProfile, type Booking } from '@/lib/api';
import { BAIdentity, StatusBadge } from '@/components/common';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { LoadingScreen } from '@/components/ui/loading-screen';
import { formatDate } from '@/lib/format';

export function ManagerInboxPage() {
  const queryClient = useQueryClient();
  const [assignDrafts, setAssignDrafts] = useState<Record<string, string>>({});
  const pending = useQuery({
    queryKey: ['manager-inbox'],
    queryFn: () => apiFetch<Booking[]>('/api/bookings?status=PENDING')
  });
  const bas = useQuery({
    queryKey: ['bookable-bas'],
    queryFn: () => apiFetch<BAProfile[]>('/api/ba?bookable=true')
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
  const assign = useMutation({
    mutationFn: ({ id, baId }: { id: string; baId: string }) =>
      apiFetch(`/api/bookings/${id}/assign`, {
        method: 'PATCH',
        body: JSON.stringify({ ba_id: baId })
      }),
    onSuccess: () => void queryClient.invalidateQueries()
  });

  return (
    <div className="grid gap-5">
      {(approve.error || reject.error || assign.error) ? (
        <div className="rounded-md bg-rose-50 p-3 text-sm text-rose-700">
          {(approve.error ?? reject.error ?? assign.error)?.message}
        </div>
      ) : null}
      {pending.isLoading ? (
        <LoadingScreen message="Loading pending requests" />
      ) : null}
      {pending.error ? (
        <Card><CardContent className="p-5 text-sm text-rose-700">Could not load manager inbox. Check API connection and retry.</CardContent></Card>
      ) : null}
      <div className="grid gap-4">
        {(pending.data ?? []).map((booking) => {
          const selectedBaId = assignDrafts[booking.id] ?? '';

          return (
            <Card key={booking.id}>
              <CardContent className="grid gap-4 p-5 lg:grid-cols-[1fr_auto] lg:items-center">
                <div className="grid gap-3">
                  <div className="flex flex-wrap items-start gap-3">
                    <BAIdentity ba={booking.ba} />
                    <div className="-mt-0.5">
                      <StatusBadge status={booking.status} />
                    </div>
                  </div>
                  {!booking.ba ? (
                    <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                      This request was submitted with Auto assign. Assign a BA before approving.
                    </div>
                  ) : null}
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
                <div className="grid gap-2 sm:min-w-52">
                  {!booking.ba ? (
                    <div className="grid gap-2">
                      <select
                        value={selectedBaId}
                        onChange={(event) =>
                          setAssignDrafts((current) => ({
                            ...current,
                            [booking.id]: event.target.value
                          }))
                        }
                        className="h-9 rounded-md border bg-white px-2 text-sm"
                        aria-label="Assign BA"
                      >
                        <option value="">Select BA</option>
                        {(bas.data ?? []).map((ba) => (
                          <option key={ba.id} value={ba.id}>
                            {ba.full_name}
                          </option>
                        ))}
                      </select>
                      <Button
                        onClick={() => assign.mutate({ id: booking.id, baId: selectedBaId })}
                        disabled={!selectedBaId || assign.isPending}
                      >
                        Assign BA
                      </Button>
                    </div>
                  ) : (
                    <Button onClick={() => approve.mutate(booking.id)}>Approve</Button>
                  )}
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
          );
        })}
        {pending.data?.length === 0 ? (
          <Card><CardHeader><CardTitle>No pending requests</CardTitle></CardHeader></Card>
        ) : null}
      </div>
    </div>
  );
}
