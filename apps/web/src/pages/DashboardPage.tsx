import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { ArrowRight, CalendarDays, ClipboardList, Users } from 'lucide-react';
import { apiFetch } from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export function DashboardPage() {
  const summary = useQuery({
    queryKey: ['capacity-summary'],
    queryFn: () => apiFetch<{ average_capacity: number; counts: Record<string, number> }>('/api/capacity/summary')
  });

  const stats = [
    {
      label: 'Average capacity',
      value: `${summary.data?.average_capacity ?? 0}%`,
      icon: CalendarDays,
      to: '/timeline'
    },
    {
      label: 'Available BA',
      value: summary.data?.counts.free ?? 0,
      icon: Users,
      to: '/crm/ba'
    },
    {
      label: 'Overbook risk',
      value: summary.data?.counts.overbook ?? 0,
      icon: ClipboardList,
      to: '/manager/inbox'
    }
  ];

  return (
    <div className="grid gap-5">
      <div>
        <h2 className="text-2xl font-bold text-slate-950">BA Bazaar</h2>
        <p className="mt-1 text-sm text-slate-600">
          Resource booking, approval workflow, and BA CRM foundation.
        </p>
      </div>
      <div className="grid gap-4 md:grid-cols-3">
        {stats.map((item) => {
          const Icon = item.icon;

          return (
            <Link key={item.label} to={item.to}>
              <Card className="transition hover:-translate-y-0.5 hover:shadow-md">
                <CardContent className="flex items-center justify-between p-5">
                  <div>
                    <p className="text-sm font-medium text-slate-500">{item.label}</p>
                    <p className="mt-2 text-3xl font-bold text-slate-950">{item.value}</p>
                  </div>
                  <Icon className="h-8 w-8 text-blue-600" />
                </CardContent>
              </Card>
            </Link>
          );
        })}
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Current Scope</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 text-sm text-slate-600 md:grid-cols-3">
          <Link className="flex items-center justify-between rounded-md border p-3" to="/timeline">
            Date-range booking timeline <ArrowRight className="h-4 w-4" />
          </Link>
          <Link className="flex items-center justify-between rounded-md border p-3" to="/crm/ba">
            BA CRM directory <ArrowRight className="h-4 w-4" />
          </Link>
          <Link className="flex items-center justify-between rounded-md border p-3" to="/reports">
            Utilization CSV reports <ArrowRight className="h-4 w-4" />
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}
