import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { format, parseISO } from 'date-fns';
import { apiFetch, type AiSetting, type AuditLogEntry } from '@/lib/api';
import { PageHeader } from '@/components/PageHeader';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/modal';
import { LoadingScreen } from '@/components/ui/loading-screen';

function fmtDateTime(value?: string | null) {
  if (!value) return '—';
  try {
    return format(parseISO(value), 'dd/MM HH:mm');
  } catch {
    return value;
  }
}

export function AISettingsPage() {
  const queryClient = useQueryClient();
  const [editingSetting, setEditingSetting] = useState<AiSetting | null>(null);
  const [newValue, setNewValue] = useState('');

  const settings = useQuery({
    queryKey: ['admin-ai-settings'],
    queryFn: () => apiFetch<AiSetting[]>('/api/admin/ai/settings')
  });

  const audits = useQuery({
    queryKey: ['admin-ai-settings-audit'],
    queryFn: () => apiFetch<AuditLogEntry[]>('/api/admin/audit-logs?action=AI_SETTING_CHANGED')
  });

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['admin-ai-settings'] });
    queryClient.invalidateQueries({ queryKey: ['admin-ai-settings-audit'] });
  };

  const update = useMutation({
    mutationFn: ({ key, value }: { key: string; value: string }) =>
      apiFetch(`/api/admin/ai/settings/${key}`, {
        method: 'PATCH',
        body: JSON.stringify({ value })
      }),
    onSuccess: () => {
      setEditingSetting(null);
      setNewValue('');
      refresh();
    }
  });

  const items = settings.data ?? [];
  const auditLogs = Array.isArray(audits.data) ? audits.data : (audits.data as any)?.items ?? [];

  const handleEditClick = (s: AiSetting) => {
    setEditingSetting(s);
    setNewValue(s.value);
  };

  const handleFormSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (editingSetting) {
      update.mutate({ key: editingSetting.key, value: newValue });
    }
  };

  return (
    <div className="grid gap-5">
      <PageHeader
        eyebrow="AI Platform"
        title="System Settings"
        description="Configure active model choices, temperature settings, and prompt templates."
      />

      {update.error ? (
        <div className="rounded-lg bg-rose-50 p-3 text-sm text-rose-700">
          Could not update setting: {update.error instanceof Error ? update.error.message : 'Error'}
        </div>
      ) : null}

      <div className="grid gap-4 md:grid-cols-3">
        <div className="md:col-span-2 grid gap-3">
          {settings.isLoading ? (
            <LoadingScreen message="Loading settings..." />
          ) : settings.error ? (
            <Card>
              <CardContent className="p-5 text-sm text-rose-700">Could not load AI configuration settings.</CardContent>
            </Card>
          ) : items.length === 0 ? (
            <Card>
              <CardContent className="p-5 text-sm text-slate-500">No configuration settings found.</CardContent>
            </Card>
          ) : (
            items.map((s) => (
              <Card key={s.id}>
                <CardContent className="flex items-center justify-between p-4 gap-4">
                  <div className="min-w-0">
                    <h3 className="font-semibold text-slate-900 text-sm font-sans">{s.key.replace('ai_', '').replace('_', ' ').toUpperCase()}</h3>
                    <p className="text-xs text-slate-500 mt-0.5">{s.description ?? 'No description.'}</p>
                    <div className="mt-2 flex items-center gap-2">
                      <span className="text-xs font-semibold text-slate-400">Current Value:</span>
                      <code className="text-xs bg-slate-100 rounded px-1.5 py-0.5 text-slate-800 font-mono font-bold">
                        {s.value}
                      </code>
                    </div>
                  </div>
                  <Button variant="secondary" onClick={() => handleEditClick(s)} className="flex-shrink-0">
                    Configure
                  </Button>
                </CardContent>
              </Card>
            ))
          )}
        </div>

        <Card>
          <CardContent className="grid gap-3 p-5">
            <h2 className="text-base font-semibold text-slate-950">Update History</h2>
            <div className="overflow-y-auto max-h-[400px] text-xs grid gap-3">
              {audits.isLoading ? (
                <p className="text-slate-400">Loading history...</p>
              ) : auditLogs.length === 0 ? (
                <p className="text-slate-400">No configuration changes logged.</p>
              ) : (
                auditLogs.map((log: any) => (
                  <div key={log.id} className="border-b border-slate-100 pb-2 last:border-0">
                    <div className="flex items-center justify-between font-medium">
                      <span className="text-slate-800 font-mono text-[10px]">{log.target_id}</span>
                      <span className="text-slate-400 text-[10px]">{fmtDateTime(log.created_at)}</span>
                    </div>
                    <p className="text-slate-600 mt-1 font-sans">
                      {log.actor_name} updated from "{String(log.old_value?.value)}" to "{String(log.new_value?.value)}"
                    </p>
                  </div>
                ))
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      <Modal open={!!editingSetting} onClose={() => { setEditingSetting(null); setNewValue(''); }} title="Edit AI Setting">
        {editingSetting ? (
          <form onSubmit={handleFormSubmit} className="grid gap-4 text-sm">
            <div>
              <p className="text-xs font-semibold text-slate-400 uppercase">Config Key</p>
              <p className="font-mono text-slate-900 font-bold">{editingSetting.key}</p>
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-500 uppercase">Value</label>
              <input
                required
                type="text"
                value={newValue}
                onChange={(e) => setNewValue(e.target.value)}
                placeholder="Setting value"
                className="mt-1 w-full rounded-lg border border-slate-200 bg-white p-2 text-sm focus:border-blue-500 focus:outline-none"
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="secondary" onClick={() => { setEditingSetting(null); setNewValue(''); }}>
                Cancel
              </Button>
              <Button type="submit" disabled={update.isPending}>
                {update.isPending ? 'Updating...' : 'Save Configuration'}
              </Button>
            </div>
          </form>
        ) : null}
      </Modal>
    </div>
  );
}
