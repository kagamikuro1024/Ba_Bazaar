import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { useState } from 'react';
import { useAuth } from '@/auth/AuthProvider';
import { apiFetch, type NotificationItem, type PaginatedResponse } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { LoadingScreen } from '@/components/ui/loading-screen';
import { formatDate } from '@/lib/format';

const PAGE_SIZE = 20;

export function NotificationsPage() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const role = user?.role ?? 'BA';
  const [page, setPage] = useState(1);
  const notifications = useQuery({
    queryKey: ['notifications-page', page],
    queryFn: () => apiFetch<PaginatedResponse<NotificationItem>>(`/api/notifications?page=${page}&page_size=${PAGE_SIZE}`),
    placeholderData: (previous) => previous
  });
  const markRead = useMutation({
    mutationFn: (id: string) => apiFetch(`/api/notifications/${id}/read`, { method: 'POST' }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['notifications'] })
  });

  const items = notifications.data?.items ?? [];
  const totalItems = notifications.data?.total ?? 0;
  const totalPages = notifications.data?.total_pages ?? 1;
  const firstItem = totalItems === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const lastItem = Math.min(page * PAGE_SIZE, totalItems);

  function resolveNotificationPath(item: NotificationItem) {
    const id = item.related_entity_id;
    if (item.related_entity_type === 'Booking' && id) {
      if (role === 'BA_MANAGER' || role === 'ADMIN') {
        return `/notifications?bookingId=${id}`;
      }
      if (role === 'PM_PO') {
        return `/my-requests?bookingId=${id}`;
      }
      if (role === 'BA') {
        return `/my-schedule?bookingId=${id}`;
      }
    }

    if (item.type === 'BOOKING_REJECTED' || item.type === 'BOOKING_CANCELLED') {
      return id ? `/my-requests?bookingId=${id}` : '/my-requests';
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
        {items.map((item) => (
          <Card key={item.id} className={item.read_at ? 'opacity-70' : ''}>
            <CardContent className="flex flex-col gap-3 p-3 sm:flex-row sm:items-center sm:justify-between sm:p-4">
              <div className="min-w-0">
                <p className="truncate font-semibold text-slate-950">{item.title}</p>
                <p className="whitespace-pre-line text-sm text-slate-600">{item.message}</p>
                <p className="mt-1 text-xs text-slate-500">{formatDate(item.created_at)}</p>
              </div>
              <div className="flex flex-wrap gap-2 sm:flex-nowrap">
                <Button variant="secondary" asChild className="h-10 px-3 text-sm">
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
                  <Button variant="ghost" onClick={() => markRead.mutate(item.id)} className="h-10 px-3 text-sm">
                    Mark read
                  </Button>
                ) : null}
              </div>
            </CardContent>
          </Card>
        ))}
        {items.length === 0 && !notifications.isLoading ? (
          <Card><CardContent className="p-5 text-sm text-slate-600">No notifications yet.</CardContent></Card>
        ) : null}
      </div>
      {totalItems > 0 ? (
        <Card>
          <CardContent className="flex flex-col gap-3 p-3 text-sm text-slate-600 sm:flex-row sm:items-center sm:justify-between sm:p-4">
            <span>Showing {firstItem}-{lastItem} of {totalItems} notifications</span>
            <div className="grid grid-cols-2 gap-2 sm:flex">
              <Button
                variant="secondary"
                disabled={page <= 1 || notifications.isFetching}
                onClick={() => setPage((current) => Math.max(1, current - 1))}
              >
                Previous
              </Button>
              <Button
                variant="secondary"
                disabled={page >= totalPages || notifications.isFetching}
                onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
              >
                Next
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
