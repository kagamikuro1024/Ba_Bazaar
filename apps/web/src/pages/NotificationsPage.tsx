import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiFetch, type NotificationItem } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { formatDate } from '@/lib/format';

export function NotificationsPage() {
  const queryClient = useQueryClient();
  const notifications = useQuery({
    queryKey: ['notifications-page'],
    queryFn: () => apiFetch<NotificationItem[]>('/api/notifications')
  });
  const markRead = useMutation({
    mutationFn: (id: string) => apiFetch(`/api/notifications/${id}/read`, { method: 'POST' }),
    onSuccess: () => void queryClient.invalidateQueries()
  });

  return (
    <div className="grid gap-5">
      <div>
        <h2 className="text-2xl font-bold text-slate-950">Notifications</h2>
        <p className="text-sm text-slate-600">In-app booking and approval updates.</p>
      </div>
      <div className="grid gap-3">
        {(notifications.data ?? []).map((item) => (
          <Card key={item.id} className={item.read_at ? 'opacity-70' : ''}>
            <CardContent className="flex flex-col gap-3 p-4 md:flex-row md:items-center md:justify-between">
              <div>
                <p className="font-semibold text-slate-950">{item.title}</p>
                <p className="text-sm text-slate-600">{item.message}</p>
                <p className="mt-1 text-xs text-slate-500">{formatDate(item.created_at)}</p>
              </div>
              {!item.read_at ? (
                <Button variant="secondary" onClick={() => markRead.mutate(item.id)}>
                  Mark read
                </Button>
              ) : null}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
