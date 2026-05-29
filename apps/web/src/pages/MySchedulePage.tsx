import { useQuery } from '@tanstack/react-query';
import { apiFetch, type Booking } from '@/lib/api';
import { BAIdentity, StatusBadge } from '@/components/common';
import { Card, CardContent } from '@/components/ui/card';
import { formatDate } from '@/lib/format';

export function MySchedulePage() {
  const schedule = useQuery({
    queryKey: ['my-schedule'],
    queryFn: () => apiFetch<Booking[]>('/api/bookings/my-schedule')
  });

  return (
    <div className="grid gap-5">
      <div>
        <h2 className="text-2xl font-bold text-slate-950">My Schedule</h2>
        <p className="text-sm text-slate-600">Approved, in-progress, and completed assignments.</p>
      </div>
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
      </div>
    </div>
  );
}
