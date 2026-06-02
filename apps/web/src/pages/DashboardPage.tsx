import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { ArrowRight, CalendarDays, ClipboardList, Users } from 'lucide-react';
import { apiFetch } from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';

type CapacitySummaryData = {
  average_capacity: number;
  counts: Record<string, number>;
};

export function DashboardPage() {
  const summary = useQuery({
    queryKey: ['capacity-summary'],
    queryFn: () => apiFetch<CapacitySummaryData>('/api/capacity/summary')
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
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(280px,340px)]">
        <CapacitySummary summary={summary.data} />
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-1">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm uppercase">Legend</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-2 text-sm">
              <div className="flex items-center gap-2">
                <span className="h-4 w-9 rounded bg-blue-600" /> Approved/In progress
              </div>
              <div className="flex items-center gap-2">
                <span className="h-4 w-9 rounded border border-dashed border-amber-400 bg-amber-100" /> Pending
              </div>
              <div className="flex items-center gap-2">
                <span className="h-4 w-9 rounded border border-gray-300 bg-gray-200" /> Rejected
              </div>
              <div className="flex items-center gap-2">
                <span className="h-4 w-9 rounded border border-dashed bg-slate-50" /> Available
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-sm uppercase">Capacity Rules</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-2 text-sm text-slate-600">
              <p>Approved capacity cannot exceed 100% for overlapping dates.</p>
              <p>Pending requests are allowed but counted as overbook risk.</p>
              <p>BA Manager decides approve/reject.</p>
            </CardContent>
          </Card>
        </div>
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

function CapacitySummary({ summary }: { summary?: CapacitySummaryData }) {
  const average = summary?.average_capacity ?? 0;
  const circumference = 2 * Math.PI * 42;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm uppercase">Capacity Summary</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-4">
        <div className="relative mx-auto grid h-28 w-28 place-items-center">
          <svg viewBox="0 0 100 100" className="h-28 w-28 -rotate-90">
            <circle cx="50" cy="50" r="42" fill="none" stroke="#e2e8f0" strokeWidth="10" />
            <circle
              cx="50"
              cy="50"
              r="42"
              fill="none"
              stroke="#2563eb"
              strokeWidth="10"
              strokeDasharray={circumference}
              strokeDashoffset={circumference - (Math.min(average, 100) / 100) * circumference}
              strokeLinecap="round"
            />
          </svg>
          <div className="absolute text-center">
            <p className="text-2xl font-bold text-slate-950">{average}%</p>
            <p className="text-xs text-slate-500">Average</p>
          </div>
        </div>
        {[
          ['0-40%', 'Free', summary?.counts.free ?? 0, 'bg-emerald-500'],
          ['40-80%', 'Working', summary?.counts.working ?? 0, 'bg-amber-500'],
          ['80-100%', 'Near full', summary?.counts.near_full ?? 0, 'bg-orange-500'],
          ['>100%', 'Overbook', summary?.counts.overbook ?? 0, 'bg-rose-500']
        ].map(([range, label, count, color]) => (
          <div key={range} className="flex items-center justify-between text-sm">
            <span className="flex items-center gap-2">
              <span className={cn('h-2.5 w-2.5 rounded-full', color as string)} />
              {range} · {label}
            </span>
            <strong>{count} BA</strong>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
