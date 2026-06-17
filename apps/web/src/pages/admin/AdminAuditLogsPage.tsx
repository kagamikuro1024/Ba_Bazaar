import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { format, parseISO } from 'date-fns';
import { apiFetch, type AuditLogEntry } from '@/lib/api';
import { PageHeader } from '@/components/PageHeader';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/modal';
import { LoadingScreen } from '@/components/ui/loading-screen';

function fmtDateTime(value?: string | null) {
  if (!value) return '—';
  try {
    return format(parseISO(value), 'dd/MM/yyyy HH:mm:ss');
  } catch {
    return value;
  }
}

function resultTone(result: string): 'success' | 'danger' | 'warning' | 'neutral' {
  if (result === 'SUCCESS') return 'success';
  if (result === 'DENIED') return 'warning';
  if (result === 'FAILURE') return 'danger';
  return 'neutral';
}

function prettyJson(value: unknown) {
  if (value == null) return null;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

export function AdminAuditLogsPage() {
  const [search, setSearch] = useState('');
  const [action, setAction] = useState('');
  const [result, setResult] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [detailId, setDetailId] = useState<string | null>(null);

  const logs = useQuery({
    queryKey: ['admin-audit', search, action, result, from, to],
    queryFn: () => {
      const params = new URLSearchParams();
      if (search.trim()) params.set('search', search.trim());
      if (action.trim()) params.set('action', action.trim());
      if (result) params.set('result', result);
      if (from) params.set('from', from);
      if (to) params.set('to', to);
      const qs = params.toString();
      return apiFetch<AuditLogEntry[]>(`/api/admin/audit-logs${qs ? `?${qs}` : ''}`);
    }
  });

  const detail = useQuery({
    queryKey: ['admin-audit-detail', detailId],
    queryFn: () => apiFetch<AuditLogEntry>(`/api/admin/audit-logs/${detailId}`),
    enabled: Boolean(detailId)
  });

  const rows = logs.data ?? [];

  return (
    <div className="grid gap-5">
      <PageHeader
        eyebrow="IT Admin"
        title="Audit Logs"
        description="Every privileged action is recorded here: who did what, when, and the result."
      />

      <Card>
        <CardContent className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-5">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search action or actor"
            className="h-9 rounded-lg border border-slate-200 bg-white px-3 text-sm"
          />
          <input
            value={action}
            onChange={(e) => setAction(e.target.value)}
            placeholder="Action (e.g. USER_DISABLED)"
            className="h-9 rounded-lg border border-slate-200 bg-white px-3 text-sm"
          />
          <select
            value={result}
            onChange={(e) => setResult(e.target.value)}
            className="h-9 rounded-lg border border-slate-200 bg-white px-2 text-sm"
          >
            <option value="">All results</option>
            <option value="SUCCESS">Success</option>
            <option value="DENIED">Denied</option>
            <option value="FAILURE">Failure</option>
          </select>
          <input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className="h-9 rounded-lg border border-slate-200 bg-white px-2 text-sm"
          />
          <input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className="h-9 rounded-lg border border-slate-200 bg-white px-2 text-sm"
          />
        </CardContent>
      </Card>

      <Card className="overflow-hidden">
        <CardContent className="p-0">
          {logs.isLoading ? (
            <LoadingScreen message="Loading audit logs" />
          ) : logs.error ? (
            <div className="p-5 text-sm text-rose-700">Could not load audit logs.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                    <th className="px-4 py-2 font-semibold">Time</th>
                    <th className="px-4 py-2 font-semibold">Actor</th>
                    <th className="px-4 py-2 font-semibold">Role</th>
                    <th className="px-4 py-2 font-semibold">Action</th>
                    <th className="px-4 py-2 font-semibold">Target</th>
                    <th className="px-4 py-2 font-semibold">Result</th>
                    <th className="px-4 py-2 text-right font-semibold"></th>
                  </tr>
                </thead>
                <tbody>
                  {rows.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="px-4 py-4 text-slate-500">
                        No audit entries match these filters.
                      </td>
                    </tr>
                  ) : (
                    rows.map((log) => (
                      <tr key={log.id} className="border-b border-slate-100">
                        <td className="px-4 py-2 text-slate-600">{fmtDateTime(log.created_at)}</td>
                        <td className="px-4 py-2 text-slate-900">{log.actor_name || log.actor_id}</td>
                        <td className="px-4 py-2 text-slate-600">{log.actor_role || '—'}</td>
                        <td className="px-4 py-2 font-medium text-slate-900">{log.action}</td>
                        <td className="px-4 py-2 text-slate-600">
                          {log.target_type}
                          {log.target_id ? <span className="text-slate-400"> · {log.target_id}</span> : null}
                        </td>
                        <td className="px-4 py-2">
                          <Badge tone={resultTone(log.result)}>{log.result}</Badge>
                        </td>
                        <td className="px-4 py-2 text-right">
                          <Button variant="ghost" size="sm" onClick={() => setDetailId(log.id)}>
                            View
                          </Button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <Modal title="Audit entry" open={Boolean(detailId)} onClose={() => setDetailId(null)}>
        {detail.isLoading ? (
          <p className="text-sm text-slate-500">Loading…</p>
        ) : detail.data ? (
          <div className="grid gap-3 text-sm">
            <Field label="Action" value={detail.data.action} />
            <Field label="Result" value={detail.data.result} />
            <Field
              label="Actor"
              value={`${detail.data.actor_name || detail.data.actor_id} (${detail.data.actor_role || '—'})`}
            />
            <Field label="Target" value={`${detail.data.target_type} ${detail.data.target_id ?? ''}`} />
            <Field label="Time" value={fmtDateTime(detail.data.created_at)} />
            {detail.data.ip_address ? <Field label="IP" value={detail.data.ip_address} /> : null}
            {detail.data.user_agent ? <Field label="User agent" value={detail.data.user_agent} /> : null}
            {prettyJson(detail.data.old_value) ? (
              <div className="grid gap-1">
                <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Before</span>
                <pre className="overflow-x-auto rounded-lg bg-slate-100 p-3 text-xs text-slate-800">
                  {prettyJson(detail.data.old_value)}
                </pre>
              </div>
            ) : null}
            {prettyJson(detail.data.new_value) ? (
              <div className="grid gap-1">
                <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">After</span>
                <pre className="overflow-x-auto rounded-lg bg-slate-100 p-3 text-xs text-slate-800">
                  {prettyJson(detail.data.new_value)}
                </pre>
              </div>
            ) : null}
          </div>
        ) : (
          <p className="text-sm text-rose-700">Could not load this entry.</p>
        )}
      </Modal>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[100px_1fr] gap-2">
      <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</span>
      <span className="text-slate-900">{value}</span>
    </div>
  );
}
