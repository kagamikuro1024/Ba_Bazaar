import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { format, parseISO } from 'date-fns';
import { Users, UserCheck, UserX, ScrollText } from 'lucide-react';
import { apiFetch, type AdminOverview } from '@/lib/api';
import { PageHeader } from '@/components/PageHeader';
import { StatCard } from '@/components/StatCard';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { LoadingScreen } from '@/components/ui/loading-screen';

function formatDateTime(value?: string | null) {
  if (!value) return '—';
  try {
    return format(parseISO(value), 'dd/MM HH:mm');
  } catch {
    return value;
  }
}

function auditTone(result: string): 'success' | 'danger' | 'warning' | 'neutral' {
  if (result === 'SUCCESS') return 'success';
  if (result === 'DENIED') return 'warning';
  if (result === 'FAILURE') return 'danger';
  return 'neutral';
}

export function AdminDashboardPage() {
  const overview = useQuery({
    queryKey: ['admin-overview'],
    queryFn: () => apiFetch<AdminOverview>('/api/admin/overview')
  });

  const data = overview.data;
  const byRole = data?.users.by_role ?? {};

  return (
    <div className="grid gap-5">
      <PageHeader
        eyebrow="IT Admin"
        title="Admin Dashboard"
        description="System health and recent activity. AI observability arrives in a later phase."
        actions={
          <>
            <Button variant="secondary" asChild>
              <Link to="/admin/users">Manage users</Link>
            </Button>
            <Button variant="secondary" asChild>
              <Link to="/admin/audit-logs">Audit logs</Link>
            </Button>
          </>
        }
      />

      {overview.isLoading ? <LoadingScreen message="Loading admin overview" /> : null}
      {overview.error ? (
        <Card>
          <CardContent className="p-5 text-sm text-rose-700">
            Could not load admin overview. Check the API connection and your IT Admin permissions.
          </CardContent>
        </Card>
      ) : null}

      {data ? (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard label="Total users" value={String(data.users.total)} icon={Users} tone="info" />
            <StatCard label="Active" value={String(data.users.active)} icon={UserCheck} tone="success" />
            <StatCard label="Disabled" value={String(data.users.disabled)} icon={UserX} tone="warning" />
            <StatCard label="Roles" value={String(Object.keys(byRole).length)} icon={ScrollText} tone="neutral" />
          </div>

          <Card>
            <CardContent className="grid gap-3 p-5">
              <h2 className="text-base font-semibold text-slate-950">Users by role</h2>
              <div className="flex flex-wrap gap-2">
                {Object.entries(byRole).length === 0 ? (
                  <p className="text-sm text-slate-500">No users yet.</p>
                ) : (
                  Object.entries(byRole).map(([role, count]) => (
                    <Badge key={role} tone="info">
                      {role.replace('_', ' ')}: {count}
                    </Badge>
                  ))
                )}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="grid gap-3 p-5">
              <div className="flex items-center justify-between">
                <h2 className="text-base font-semibold text-slate-950">Recent activity</h2>
                <Button variant="ghost" size="sm" asChild>
                  <Link to="/admin/audit-logs">View all</Link>
                </Button>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
                      <th className="py-2 pr-3 font-semibold">Time</th>
                      <th className="py-2 pr-3 font-semibold">Actor</th>
                      <th className="py-2 pr-3 font-semibold">Action</th>
                      <th className="py-2 pr-3 font-semibold">Result</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.recent_audit.length === 0 ? (
                      <tr>
                        <td colSpan={4} className="py-3 text-slate-500">
                          No activity recorded yet.
                        </td>
                      </tr>
                    ) : (
                      data.recent_audit.map((log) => (
                        <tr key={log.id} className="border-b border-slate-100">
                          <td className="py-2 pr-3 text-slate-600">{formatDateTime(log.created_at)}</td>
                          <td className="py-2 pr-3 text-slate-900">{log.actor_name || log.actor_id}</td>
                          <td className="py-2 pr-3 font-medium text-slate-900">{log.action}</td>
                          <td className="py-2 pr-3">
                            <Badge tone={auditTone(log.result)}>{log.result}</Badge>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </>
      ) : null}
    </div>
  );
}
