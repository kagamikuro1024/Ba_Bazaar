import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { format, parseISO } from 'date-fns';
import { apiFetch, type AiError } from '@/lib/api';
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

function severityTone(sev: string): 'danger' | 'warning' | 'info' | 'neutral' {
  if (sev === 'CRITICAL' || sev === 'HIGH') return 'danger';
  if (sev === 'MEDIUM') return 'warning';
  if (sev === 'LOW') return 'info';
  return 'neutral';
}

export function AIErrorsPage() {
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState('OPEN');
  const [severityFilter, setSeverityFilter] = useState('');
  const [page, setPage] = useState(1);
  const [inspectError, setInspectError] = useState<AiError | null>(null);
  const [resolveId, setResolveId] = useState<string | null>(null);
  const [resolveNote, setResolveNote] = useState('');

  const queryKey = useMemo(
    () => ['admin-ai-errors', statusFilter, severityFilter, page],
    [statusFilter, severityFilter, page]
  );

  const errors = useQuery({
    queryKey,
    queryFn: () => {
      const params = new URLSearchParams();
      if (statusFilter) params.set('status', statusFilter);
      if (severityFilter) params.set('severity', severityFilter);
      params.set('page', String(page));
      params.set('page_size', '15');
      const qs = params.toString();
      return apiFetch<{ items: AiError[]; total: number; total_pages: number }>(
        `/api/admin/ai/errors?${qs}`
      );
    }
  });

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['admin-ai-errors'] });

  const resolve = useMutation({
    mutationFn: ({ id, note }: { id: string; note: string }) =>
      apiFetch(`/api/admin/ai/errors/${id}/resolve`, {
        method: 'PATCH',
        body: JSON.stringify({ note })
      }),
    onSuccess: () => {
      setResolveId(null);
      setResolveNote('');
      refresh();
    }
  });

  const rows = errors.data?.items ?? [];
  const totalPages = errors.data?.total_pages ?? 1;

  const handleResolveSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (resolveId) {
      resolve.mutate({ id: resolveId, note: resolveNote });
    }
  };

  return (
    <div className="grid gap-5">
      <PageHeader
        eyebrow="AI Platform"
        title="Exceptions & Errors"
        description="Monitor runtime model exceptions, schema parsing issues, and API conflicts."
      />

      <Card>
        <CardContent className="grid gap-3 p-4 sm:grid-cols-3">
          <select
            value={statusFilter}
            onChange={(e) => {
              setStatusFilter(e.target.value);
              setPage(1);
            }}
            className="h-9 rounded-lg border border-slate-200 bg-white px-2 text-sm"
          >
            <option value="">All statuses</option>
            <option value="OPEN">Open</option>
            <option value="RESOLVED">Resolved</option>
          </select>
          <select
            value={severityFilter}
            onChange={(e) => {
              setSeverityFilter(e.target.value);
              setPage(1);
            }}
            className="h-9 rounded-lg border border-slate-200 bg-white px-2 text-sm"
          >
            <option value="">All severities</option>
            <option value="LOW">Low</option>
            <option value="MEDIUM">Medium</option>
            <option value="HIGH">High</option>
            <option value="CRITICAL">Critical</option>
          </select>
        </CardContent>
      </Card>

      {resolve.error ? (
        <div className="rounded-lg bg-rose-50 p-3 text-sm text-rose-700">
          Could not resolve error: {resolve.error instanceof Error ? resolve.error.message : 'Error'}
        </div>
      ) : null}

      <Card className="overflow-hidden">
        <CardContent className="p-0">
          {errors.isLoading ? (
            <LoadingScreen message="Loading errors" />
          ) : errors.error ? (
            <div className="p-5 text-sm text-rose-700">Could not load errors.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                    <th className="px-4 py-2 font-semibold">Error Type</th>
                    <th className="px-4 py-2 font-semibold">Feature</th>
                    <th className="px-4 py-2 font-semibold">Severity</th>
                    <th className="px-4 py-2 font-semibold">Message</th>
                    <th className="px-4 py-2 font-semibold">Created</th>
                    <th className="px-4 py-2 font-semibold">Status</th>
                    <th className="px-4 py-2 text-right font-semibold">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="px-4 py-4 text-slate-500">
                        No errors logged under these filters.
                      </td>
                    </tr>
                  ) : (
                    rows.map((er) => (
                      <tr key={er.id} className="border-b border-slate-100">
                        <td className="px-4 py-2 font-medium text-slate-900">{er.error_type}</td>
                        <td className="px-4 py-2 text-slate-600">
                          <Badge tone="info">{er.feature_name.replace('AI_', '').replace('_', ' ')}</Badge>
                        </td>
                        <td className="px-4 py-2">
                          <Badge tone={severityTone(er.severity)}>{er.severity}</Badge>
                        </td>
                        <td className="px-4 py-2 text-slate-600 truncate max-w-[200px]" title={er.message}>
                          {er.message}
                        </td>
                        <td className="px-4 py-2 text-slate-600">{fmtDateTime(er.created_at)}</td>
                        <td className="px-4 py-2 text-slate-600">
                          <Badge tone={er.status === 'OPEN' ? 'danger' : 'success'}>{er.status}</Badge>
                        </td>
                        <td className="px-4 py-2">
                          <div className="flex justify-end gap-1.5">
                            <Button variant="secondary" size="sm" onClick={() => setInspectError(er)}>
                              Inspect
                            </Button>
                            {er.status === 'OPEN' ? (
                              <Button variant="secondary" size="sm" onClick={() => setResolveId(er.id)}>
                                Resolve
                              </Button>
                            ) : null}
                          </div>
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

      {totalPages > 1 ? (
        <div className="flex items-center justify-between mt-2">
          <Button variant="secondary" size="sm" onClick={() => setPage((p) => Math.max(p - 1, 1))} disabled={page === 1}>
            Previous
          </Button>
          <span className="text-xs text-slate-500">Page {page} of {totalPages}</span>
          <Button variant="secondary" size="sm" onClick={() => setPage((p) => Math.min(p + 1, totalPages))} disabled={page === totalPages}>
            Next
          </Button>
        </div>
      ) : null}

      <Modal open={!!inspectError} onClose={() => setInspectError(null)} title="Exception Tracing">
        {inspectError ? (
          <div className="grid gap-3 max-h-[80vh] overflow-y-auto pr-2 text-xs">
            <div>
              <p className="text-xs font-semibold text-slate-400 font-sans uppercase">Error Summary</p>
              <p className="font-bold text-slate-900 font-sans mt-0.5">{inspectError.error_type} ({inspectError.severity})</p>
              <p className="font-medium text-slate-700 font-sans mt-1 bg-rose-50 border border-rose-100 p-2.5 rounded text-xs">{inspectError.message}</p>
            </div>
            {inspectError.session_id ? (
              <div>
                <p className="text-xs font-semibold text-slate-400 font-sans uppercase">Session Trace ID</p>
                <p className="font-mono text-slate-900">{inspectError.session_id}</p>
              </div>
            ) : null}
            {inspectError.stack_trace ? (
              <div>
                <p className="text-xs font-semibold text-slate-400 font-sans uppercase">Stack Trace / Details</p>
                <pre className="mt-1 bg-slate-900 text-slate-100 p-3 rounded border border-slate-800 max-h-[250px] overflow-y-auto font-mono text-[11px]">{inspectError.stack_trace}</pre>
              </div>
            ) : null}
            {inspectError.status === 'RESOLVED' ? (
              <div className="border-t border-slate-100 pt-3">
                <p className="text-xs font-semibold text-slate-400 font-sans uppercase">Resolution notes</p>
                <p className="font-medium text-slate-900 font-sans mt-0.5">Resolved by {inspectError.resolved_name} {inspectError.resolved_at ? `on ${fmtDateTime(inspectError.resolved_at)}` : ''}</p>
                {inspectError.note ? (
                  <p className="text-slate-600 font-sans mt-1 italic">"{inspectError.note}"</p>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : null}
      </Modal>

      <Modal open={!!resolveId} onClose={() => { setResolveId(null); setResolveNote(''); }} title="Resolve Exception">
        <form onSubmit={handleResolveSubmit} className="grid gap-4 text-sm">
          <div>
            <label className="block text-xs font-semibold text-slate-500 uppercase">Resolution Note</label>
            <textarea
              required
              rows={3}
              value={resolveNote}
              onChange={(e) => setResolveNote(e.target.value)}
              placeholder="e.g. Model was overloaded, resolved after checking capacity constraints"
              className="mt-1 w-full rounded-lg border border-slate-200 bg-white p-2 text-sm focus:border-blue-500 focus:outline-none"
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => { setResolveId(null); setResolveNote(''); }}>
              Cancel
            </Button>
            <Button type="submit" disabled={resolve.isPending}>
              {resolve.isPending ? 'Resolving...' : 'Confirm Resolution'}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
