import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { format, parseISO } from 'date-fns';
import { apiFetch, type AiToolCall } from '@/lib/api';
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

function prettyJson(value: any) {
  if (value == null) return null;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

export function AIToolCallsPage() {
  const [statusFilter, setStatusFilter] = useState('');
  const [page, setPage] = useState(1);
  const [selectedCall, setSelectedCall] = useState<AiToolCall | null>(null);

  const queryKey = useMemo(
    () => ['admin-ai-tool-calls', statusFilter, page],
    [statusFilter, page]
  );

  const toolCalls = useQuery({
    queryKey,
    queryFn: () => {
      const params = new URLSearchParams();
      if (statusFilter) params.set('status', statusFilter);
      params.set('page', String(page));
      params.set('page_size', '15');
      const qs = params.toString();
      return apiFetch<{ items: AiToolCall[]; total: number; total_pages: number }>(
        `/api/admin/ai/tool-calls?${qs}`
      );
    }
  });

  const rows = toolCalls.data?.items ?? [];
  const totalPages = toolCalls.data?.total_pages ?? 1;

  return (
    <div className="grid gap-5">
      <PageHeader
        eyebrow="AI Platform"
        title="Tool Execution Logs"
        description="Monitor internal tool calls, latencies, input payloads, and error outputs."
      />

      <Card>
        <CardContent className="grid gap-3 p-4 sm:grid-cols-[1fr_auto]">
          <div className="text-sm text-slate-500 flex items-center">Filter tool calls by status</div>
          <select
            value={statusFilter}
            onChange={(e) => {
              setStatusFilter(e.target.value);
              setPage(1);
            }}
            className="h-9 rounded-lg border border-slate-200 bg-white px-2 text-sm w-[200px]"
          >
            <option value="">All statuses</option>
            <option value="SUCCESS">Success</option>
            <option value="FAILED">Failed</option>
          </select>
        </CardContent>
      </Card>

      <Card className="overflow-hidden">
        <CardContent className="p-0">
          {toolCalls.isLoading ? (
            <LoadingScreen message="Loading tool calls" />
          ) : toolCalls.error ? (
            <div className="p-5 text-sm text-rose-700">Could not load tool calls.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                    <th className="px-4 py-2 font-semibold">Tool Name</th>
                    <th className="px-4 py-2 font-semibold">Session ID</th>
                    <th className="px-4 py-2 font-semibold">Status</th>
                    <th className="px-4 py-2 font-semibold">Latency</th>
                    <th className="px-4 py-2 font-semibold">Executed At</th>
                    <th className="px-4 py-2 text-right font-semibold">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-4 py-4 text-slate-500">
                        No tool calls found.
                      </td>
                    </tr>
                  ) : (
                    rows.map((tc) => (
                      <tr key={tc.id} className="border-b border-slate-100">
                        <td className="px-4 py-2 font-medium text-slate-900">{tc.tool_name}</td>
                        <td className="px-4 py-2 text-slate-500 font-mono text-xs">{tc.session_id}</td>
                        <td className="px-4 py-2">
                          <Badge tone={tc.status === 'SUCCESS' ? 'success' : 'danger'}>{tc.status}</Badge>
                        </td>
                        <td className="px-4 py-2 text-slate-600">
                          {tc.latency_ms != null ? `${tc.latency_ms}ms` : '—'}
                        </td>
                        <td className="px-4 py-2 text-slate-600">{fmtDateTime(tc.created_at)}</td>
                        <td className="px-4 py-2">
                          <div className="flex justify-end">
                            <Button variant="secondary" size="sm" onClick={() => setSelectedCall(tc)}>
                              View JSON
                            </Button>
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

      <Modal open={!!selectedCall} onClose={() => setSelectedCall(null)} title="Tool Execution Payloads">
        {selectedCall ? (
          <div className="grid gap-4 max-h-[85vh] overflow-y-auto pr-2 text-xs font-mono">
            <div>
              <p className="text-xs font-semibold text-slate-400 font-sans uppercase">Tool Context</p>
              <p className="font-medium text-slate-900 font-sans mt-0.5">{selectedCall.tool_name} (Status: {selectedCall.status})</p>
            </div>
            <div>
              <p className="text-xs font-semibold text-slate-400 font-sans uppercase">Input JSON</p>
              <pre className="mt-1 bg-slate-950 text-slate-100 p-2.5 rounded border border-slate-800 max-h-[200px] overflow-y-auto">{prettyJson(selectedCall.input_json)}</pre>
            </div>
            {selectedCall.output_json ? (
              <div>
                <p className="text-xs font-semibold text-slate-400 font-sans uppercase">Output JSON</p>
                <pre className="mt-1 bg-slate-950 text-slate-100 p-2.5 rounded border border-slate-800 max-h-[250px] overflow-y-auto">{prettyJson(selectedCall.output_json)}</pre>
              </div>
            ) : null}
            {selectedCall.error_message ? (
              <div>
                <p className="text-xs font-semibold text-rose-500 font-sans uppercase">Error Message</p>
                <pre className="mt-1 bg-rose-950 text-rose-100 p-2.5 rounded border border-rose-900 max-h-[150px] overflow-y-auto">{selectedCall.error_message}</pre>
              </div>
            ) : null}
          </div>
        ) : null}
      </Modal>
    </div>
  );
}
