import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Cpu, AlertTriangle, Clock, CircleDollarSign, Terminal, ShieldAlert, MessageSquare, ToggleLeft, Sliders, ArrowRight } from 'lucide-react';
import { apiFetch } from '@/lib/api';
import { PageHeader } from '@/components/PageHeader';
import { StatCard } from '@/components/StatCard';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { LoadingScreen } from '@/components/ui/loading-screen';

interface AISummary {
  total_sessions: number;
  error_count: number;
  avg_latency_ms: number;
  total_cost: number;
}

interface FeatureHealth {
  key: string;
  name: string;
  enabled: boolean;
  session_count: number;
  error_count: number;
  success_rate: number;
}

interface AIOverviewData {
  summary: AISummary;
  features: FeatureHealth[];
}

export function AIObservabilityPage() {
  const overview = useQuery({
    queryKey: ['admin-ai-overview'],
    queryFn: () => apiFetch<AIOverviewData>('/api/admin/ai/overview')
  });

  const data = overview.data;

  return (
    <div className="grid gap-5">
      <PageHeader
        eyebrow="AI Platform"
        title="AI Observability"
        description="Monitor system cost, latency, error rates, and feature status."
      />

      {overview.isLoading ? <LoadingScreen message="Loading AI overview..." /> : null}
      {overview.error ? (
        <Card>
          <CardContent className="p-5 text-sm text-rose-700">
            Could not load AI overview. Check the API connection and your IT Admin permissions.
          </CardContent>
        </Card>
      ) : null}

      {data ? (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard label="Total sessions" value={String(data.summary.total_sessions)} icon={Cpu} tone="info" />
            <StatCard label="Open errors" value={String(data.summary.error_count)} icon={AlertTriangle} tone={data.summary.error_count > 0 ? 'danger' : 'neutral'} />
            <StatCard label="Avg latency" value={`${Math.round(data.summary.avg_latency_ms)}ms`} icon={Clock} tone="info" />
            <StatCard label="Estimated cost" value={`$${data.summary.total_cost.toFixed(4)}`} icon={CircleDollarSign} tone="success" />
          </div>

          <div className="grid gap-4 md:grid-cols-3">
            <Card className="md:col-span-2">
              <CardContent className="grid gap-3 p-5">
                <h2 className="text-base font-semibold text-slate-950">AI feature health</h2>
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead>
                      <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
                        <th className="py-2 pr-3 font-semibold">Feature</th>
                        <th className="py-2 pr-3 font-semibold">Status</th>
                        <th className="py-2 pr-3 font-semibold">Sessions</th>
                        <th className="py-2 pr-3 font-semibold">Error Count</th>
                        <th className="py-2 pr-3 font-semibold text-right">Success Rate</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.features.length === 0 ? (
                        <tr>
                          <td colSpan={5} className="py-3 text-slate-500">No AI features registered.</td>
                        </tr>
                      ) : (
                        data.features.map((f) => (
                          <tr key={f.key} className="border-b border-slate-100">
                            <td className="py-2.5 pr-3 font-medium text-slate-900">{f.name}</td>
                            <td className="py-2.5 pr-3">
                              <Badge tone={f.enabled ? 'success' : 'neutral'}>
                                {f.enabled ? 'ACTIVE' : 'DISABLED'}
                              </Badge>
                            </td>
                            <td className="py-2.5 pr-3 text-slate-600">{f.session_count}</td>
                            <td className="py-2.5 pr-3 text-slate-600">{f.error_count}</td>
                            <td className="py-2.5 pr-3 text-right font-semibold">
                              <span className={f.success_rate < 90 ? 'text-amber-600' : 'text-emerald-600'}>
                                {f.success_rate.toFixed(1)}%
                              </span>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="grid gap-3 p-5">
                <h2 className="text-base font-semibold text-slate-950">Observability Logs</h2>
                <div className="grid gap-2">
                  <Button variant="secondary" className="justify-between" asChild>
                    <Link to="/admin/ai/sessions">
                      <span className="flex items-center gap-2">
                        <Terminal className="h-4 w-4" /> Trace Logs
                      </span>
                      <ArrowRight className="h-3 w-3" />
                    </Link>
                  </Button>
                  <Button variant="secondary" className="justify-between" asChild>
                    <Link to="/admin/ai/tool-calls">
                      <span className="flex items-center gap-2">
                        <Cpu className="h-4 w-4" /> Tool Calls
                      </span>
                      <ArrowRight className="h-3 w-3" />
                    </Link>
                  </Button>
                  <Button variant="secondary" className="justify-between" asChild>
                    <Link to="/admin/ai/errors">
                      <span className="flex items-center gap-2">
                        <ShieldAlert className="h-4 w-4" /> Exception Logs
                      </span>
                      <ArrowRight className="h-3 w-3" />
                    </Link>
                  </Button>
                  <Button variant="secondary" className="justify-between" asChild>
                    <Link to="/admin/ai/feedback">
                      <span className="flex items-center gap-2">
                        <MessageSquare className="h-4 w-4" /> Feedback Feed
                      </span>
                      <ArrowRight className="h-3 w-3" />
                    </Link>
                  </Button>
                  <Button variant="secondary" className="justify-between" asChild>
                    <Link to="/admin/ai/feature-flags">
                      <span className="flex items-center gap-2">
                        <ToggleLeft className="h-4 w-4" /> Feature Flags
                      </span>
                      <ArrowRight className="h-3 w-3" />
                    </Link>
                  </Button>
                  <Button variant="secondary" className="justify-between" asChild>
                    <Link to="/admin/ai/settings">
                      <span className="flex items-center gap-2">
                        <Sliders className="h-4 w-4" /> Settings Panel
                      </span>
                      <ArrowRight className="h-3 w-3" />
                    </Link>
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>
        </>
      ) : null}
    </div>
  );
}
