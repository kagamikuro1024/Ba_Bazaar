import { useQuery } from '@tanstack/react-query';
import { apiFetch, type Booking } from '@/lib/api';
import { BAIdentity, StatusBadge } from '@/components/common';
import { Card, CardContent } from '@/components/ui/card';
import { LoadingScreen } from '@/components/ui/loading-screen';
import { formatDate } from '@/lib/format';

export function MySchedulePage() {
  const schedule = useQuery({
    queryKey: ['my-schedule'],
    queryFn: () => apiFetch<Booking[]>('/api/bookings/my-schedule')
  });

  return (
    <div className="grid gap-5">
      {schedule.isLoading ? (
        <LoadingScreen message="Loading your schedule" />
      ) : null}
      {schedule.error ? (
        <Card><CardContent className="p-5 text-sm text-rose-700">Could not load schedule. Check API connection and retry.</CardContent></Card>
      ) : null}
      <div className="grid gap-4">
        {(schedule.data ?? []).map((booking) => (
          <Card key={booking.id}>
            <CardContent className="grid gap-3 p-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <BAIdentity ba={booking.ba} />
                <StatusBadge status={booking.status} />
              </div>
              <div>
                <h3 className="font-semibold text-slate-950">{booking.project.name}</h3>
                <p className="text-sm text-slate-600">{booking.description}</p>
              </div>
              <p className="text-sm text-slate-600">
                {formatDate(booking.start_date)} - {formatDate(booking.end_date)} · {booking.capacity_percent}% · Requester {booking.requester.full_name}
              </p>
            </CardContent>
          </Card>
        ))}
        {schedule.data?.length === 0 ? (
          <Card><CardContent className="p-5 text-sm text-slate-600">No assigned bookings yet.</CardContent></Card>
        ) : null}
      </div>
    </div>
  );
}
