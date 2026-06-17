import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { format, parseISO } from 'date-fns';
import { apiFetch, type FeatureFlag, type AuditLogEntry } from '@/lib/api';
import { PageHeader } from '@/components/PageHeader';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { LoadingScreen } from '@/components/ui/loading-screen';

function fmtDateTime(value?: string | null) {
  if (!value) return '—';
  try {
    return format(parseISO(value), 'dd/MM HH:mm');
  } catch {
    return value;
  }
}

export function AIFeatureFlagsPage() {
  const queryClient = useQueryClient();

  const flags = useQuery({
    queryKey: ['admin-ai-flags'],
    queryFn: () => apiFetch<FeatureFlag[]>('/api/admin/ai/feature-flags')
  });

  const audits = useQuery({
    queryKey: ['admin-ai-flags-audit'],
    queryFn: () => apiFetch<AuditLogEntry[]>('/api/admin/audit-logs?action=AI_FEATURE_TOGGLED')
  });

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['admin-ai-flags'] });
    queryClient.invalidateQueries({ queryKey: ['admin-ai-flags-audit'] });
  };

  const toggle = useMutation({
    mutationFn: ({ key, enabled }: { key: string; enabled: boolean }) =>
      apiFetch(`/api/admin/ai/feature-flags/${key}`, {
        method: 'PATCH',
        body: JSON.stringify({ enabled })
      }),
    onSuccess: refresh
  });

  const items = flags.data ?? [];
  const auditLogs = Array.isArray(audits.data) ? audits.data : (audits.data as any)?.items ?? [];

  return (
    <div className="grid gap-5">
      <PageHeader
        eyebrow="AI Platform"
        title="AI Feature Flags"
        description="Gate access to AI models and features server-side. Toggles are audited."
      />

      {toggle.error ? (
        <div className="rounded-lg bg-rose-50 p-3 text-sm text-rose-700">
          Could not toggle feature flag: {toggle.error instanceof Error ? toggle.error.message : 'Error'}
        </div>
      ) : null}

      <div className="grid gap-4 md:grid-cols-3">
        <div className="md:col-span-2 grid gap-3">
          {flags.isLoading ? (
            <LoadingScreen message="Loading feature flags" />
          ) : flags.error ? (
            <Card>
              <CardContent className="p-5 text-sm text-rose-700">Could not load feature flags.</CardContent>
            </Card>
          ) : items.length === 0 ? (
            <Card>
              <CardContent className="p-5 text-sm text-slate-500">No feature flags found in database.</CardContent>
            </Card>
          ) : (
            items.map((f) => (
              <Card key={f.id} className="overflow-hidden">
                <CardContent className="flex items-center justify-between p-4 gap-4">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <h3 className="font-semibold text-slate-900 text-sm">{f.name}</h3>
                      <Badge tone={f.enabled ? 'success' : 'neutral'}>
                        {f.enabled ? 'ACTIVE' : 'DISABLED'}
                      </Badge>
                    </div>
                    <p className="text-xs text-slate-500 mt-0.5">{f.description ?? 'No description.'}</p>
                    <p className="text-[10px] text-slate-400 mt-1 font-mono">key: {f.key}</p>
                  </div>
                  <Button
                    variant={f.enabled ? 'secondary' : 'default'}
                    onClick={() => toggle.mutate({ key: f.key, enabled: !f.enabled })}
                    disabled={toggle.isPending}
                    className="flex-shrink-0"
                  >
                    {f.enabled ? 'Disable' : 'Enable'}
                  </Button>
                </CardContent>
              </Card>
            ))
          )}
        </div>

        <Card>
          <CardContent className="grid gap-3 p-5">
            <h2 className="text-base font-semibold text-slate-950">Toggle History</h2>
            <div className="overflow-y-auto max-h-[400px] text-xs grid gap-3">
              {audits.isLoading ? (
                <p className="text-slate-400">Loading history...</p>
              ) : auditLogs.length === 0 ? (
                <p className="text-slate-400">No toggle actions recorded.</p>
              ) : (
                auditLogs.map((log: any) => (
                  <div key={log.id} className="border-b border-slate-100 pb-2 last:border-0">
                    <div className="flex items-center justify-between font-medium">
                      <span className="text-slate-800 font-mono text-[10px]">{log.target_id}</span>
                      <span className="text-slate-400 text-[10px]">{fmtDateTime(log.created_at)}</span>
                    </div>
                    <p className="text-slate-600 mt-1 font-sans">
                      {log.actor_name} toggled from {String(log.old_value?.enabled)} to {String(log.new_value?.enabled)}
                    </p>
                  </div>
                ))
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
