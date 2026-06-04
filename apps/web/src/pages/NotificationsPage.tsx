import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { useAuth } from '@/auth/AuthProvider';
import { apiFetch, type NotificationItem } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { LoadingScreen } from '@/components/ui/loading-screen';
import { formatDate } from '@/lib/format';

export function NotificationsPage() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const role = user?.role ?? 'BA';
  const notifications = useQuery({
    queryKey: ['notifications-page'],
    queryFn: () => apiFetch<NotificationItem[]>('/api/notifications')
  });
  const markRead = useMutation({
    mutationFn: (id: string) => apiFetch(`/api/notifications/${id}/read`, { method: 'POST' }),
    onSuccess: () => void queryClient.invalidateQueries()
  });

  function resolveNotificationPath(item: NotificationItem) {
    if (item.type === 'BOOKING_REJECTED' || item.type === 'BOOKING_CANCELLED') {
      return '/my-requests';
    }

    if (item.related_entity_type === 'Booking') {
      return role === 'BA' ? '/my-schedule' : '/notifications';
    }

    return '/notifications';
  }

  function resolveNotificationAction(item: NotificationItem) {
    if (item.type === 'BOOKING_REJECTED') {
      return 'Open My Requests';
    }

    if (item.type === 'BOOKING_CANCELLED') {
      return role === 'PM_PO' ? 'Open My Requests' : 'Open My Schedule';
    }

    return 'View details';
  }

  return (
    <div className="grid gap-5">
      {notifications.isLoading ? (
        <LoadingScreen message="Loading notifications" />
      ) : null}
      {notifications.error ? (
        <Card><CardContent className="p-5 text-sm text-rose-700">Could not load notifications. Check API connection and retry.</CardContent></Card>
      ) : null}
      <div className="grid gap-3">
        {(notifications.data ?? []).map((item) => (
          <Card key={item.id} className={item.read_at ? 'opacity-70' : ''}>
            <CardContent className="flex flex-col gap-3 p-4 md:flex-row md:items-center md:justify-between">
              <div>
                <p className="font-semibold text-slate-950">{item.title}</p>
                <p className="whitespace-pre-line text-sm text-slate-600">{item.message}</p>
                <p className="mt-1 text-xs text-slate-500">{formatDate(item.created_at)}</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button variant="secondary" asChild>
                  <Link
                    to={resolveNotificationPath(item)}
                    onClick={() => {
                      if (!item.read_at) {
                        markRead.mutate(item.id);
                      }
                    }}
                  >
                    {resolveNotificationAction(item)}
                  </Link>
                </Button>
                {!item.read_at ? (
                  <Button variant="ghost" onClick={() => markRead.mutate(item.id)}>
                    Mark read
                  </Button>
                ) : null}
              </div>
            </CardContent>
          </Card>
        ))}
        {notifications.data?.length === 0 ? (
          <Card><CardContent className="p-5 text-sm text-slate-600">No notifications yet.</CardContent></Card>
        ) : null}
      </div>
    </div>
  );
}
