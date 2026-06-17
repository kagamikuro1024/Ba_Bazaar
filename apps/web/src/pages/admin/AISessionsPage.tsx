import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { format, parseISO } from 'date-fns';
import { apiFetch, type AiSession, type AiMessage, type AiToolCall, type AiExtraction, type AiError, type AiFeedback } from '@/lib/api';
import { PageHeader } from '@/components/PageHeader';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/modal';
import { LoadingScreen } from '@/components/ui/loading-screen';

interface SessionDetailResponse {
  session: AiSession;
  messages: AiMessage[];
  tool_calls: AiToolCall[];
  extractions: AiExtraction[];
  errors: AiError[];
  feedback: AiFeedback[];
}

function fmtDateTime(value?: string | null) {
  if (!value) return '—';
  try {
    return format(parseISO(value), 'dd/MM/yyyy HH:mm:ss');
  } catch {
    return value;
  }
}

function statusTone(status: string): 'success' | 'danger' | 'warning' | 'neutral' | 'info' {
  if (status === 'SUCCESS') return 'success';
  if (status === 'FAILED') return 'danger';
  if (status === 'RUNNING') return 'info';
  if (status === 'PARTIAL_SUCCESS') return 'warning';
  return 'neutral';
}

function prettyJson(value: any) {
  if (value == null) return null;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

export function AISessionsPage() {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [featureFilter, setFeatureFilter] = useState('');
  const [page, setPage] = useState(1);
  const [detailId, setDetailId] = useState<string | null>(null);

  const queryKey = useMemo(
    () => ['admin-ai-sessions', search, statusFilter, featureFilter, page],
    [search, statusFilter, featureFilter, page]
  );

  const sessions = useQuery({
    queryKey,
    queryFn: () => {
      const params = new URLSearchParams();
      if (search.trim()) params.set('search', search.trim());
      if (statusFilter) params.set('status', statusFilter);
      if (featureFilter) params.set('feature_name', featureFilter);
      params.set('page', String(page));
      params.set('page_size', '15');
      const qs = params.toString();
      return apiFetch<{ items: AiSession[]; total: number; total_pages: number }>(
        `/api/admin/ai/sessions?${qs}`
      );
    }
  });

  const detail = useQuery({
    queryKey: ['admin-ai-session-detail', detailId],
    queryFn: () => apiFetch<SessionDetailResponse>(`/api/admin/ai/sessions/${detailId}`),
    enabled: !!detailId
  });

  const rows = sessions.data?.items ?? [];
  const totalPages = sessions.data?.total_pages ?? 1;

  return (
    <div className="grid gap-5">
      <PageHeader
        eyebrow="AI Platform"
        title="AI Trace Sessions"
        description="Trace user interactions, prompts, model responses, and costs."
      />

      <Card>
        <CardContent className="grid gap-3 p-4 sm:grid-cols-[1fr_auto_auto]">
          <input
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            placeholder="Search feature or user"
            className="h-9 rounded-lg border border-slate-200 bg-white px-3 text-sm"
          />
          <select
            value={featureFilter}
            onChange={(e) => {
              setFeatureFilter(e.target.value);
              setPage(1);
            }}
            className="h-9 rounded-lg border border-slate-200 bg-white px-2 text-sm"
          >
            <option value="">All features</option>
            <option value="AI_SUGGEST_BA">Suggest BA</option>
            <option value="AI_PRD_SKILL">PRD Tag Extraction</option>
            <option value="AI_PMPO_CHATBOT">PM/PO Chatbot</option>
            <option value="AI_BAMGR_CHATBOT">BA Manager Chatbot</option>
            <option value="AI_DASHBOARD_SUMMARY">Dashboard Summary</option>
          </select>
          <select
            value={statusFilter}
            onChange={(e) => {
              setStatusFilter(e.target.value);
              setPage(1);
            }}
            className="h-9 rounded-lg border border-slate-200 bg-white px-2 text-sm"
          >
            <option value="">All statuses</option>
            <option value="SUCCESS">Success</option>
            <option value="FAILED">Failed</option>
            <option value="RUNNING">Running</option>
            <option value="PARTIAL_SUCCESS">Partial Success</option>
          </select>
        </CardContent>
      </Card>

      <Card className="overflow-hidden">
        <CardContent className="p-0">
          {sessions.isLoading ? (
            <LoadingScreen message="Loading sessions" />
          ) : sessions.error ? (
            <div className="p-5 text-sm text-rose-700">Could not load sessions.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                    <th className="px-4 py-2 font-semibold">User</th>
                    <th className="px-4 py-2 font-semibold">Role</th>
                    <th className="px-4 py-2 font-semibold">Feature</th>
                    <th className="px-4 py-2 font-semibold">Status</th>
                    <th className="px-4 py-2 font-semibold">Started At</th>
                    <th className="px-4 py-2 font-semibold">Duration</th>
                    <th className="px-4 py-2 font-semibold">Cost</th>
                    <th className="px-4 py-2 text-right font-semibold">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="px-4 py-4 text-slate-500">
                        No sessions found matching filters.
                      </td>
                    </tr>
                  ) : (
                    rows.map((s) => (
                      <tr key={s.id} className="border-b border-slate-100">
                        <td className="px-4 py-2 font-medium text-slate-900">{s.user_name}</td>
                        <td className="px-4 py-2 text-slate-600">{s.user_role}</td>
                        <td className="px-4 py-2 text-slate-600">
                          <Badge tone="info">{s.feature_name.replace('AI_', '').replace('_', ' ')}</Badge>
                        </td>
                        <td className="px-4 py-2">
                          <Badge tone={statusTone(s.status)}>{s.status}</Badge>
                        </td>
                        <td className="px-4 py-2 text-slate-600">{fmtDateTime(s.started_at)}</td>
                        <td className="px-4 py-2 text-slate-600">
                          {s.duration_ms ? `${s.duration_ms}ms` : '—'}
                        </td>
                        <td className="px-4 py-2 text-slate-600 font-semibold">
                          {s.estimated_cost != null ? `$${s.estimated_cost.toFixed(4)}` : '—'}
                        </td>
                        <td className="px-4 py-2">
                          <div className="flex justify-end">
                            <Button variant="secondary" size="sm" onClick={() => setDetailId(s.id)}>
                              Inspect
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

      <Modal open={!!detailId} onClose={() => setDetailId(null)} title="Session Trace details">
        {detail.isLoading ? (
          <LoadingScreen message="Loading trace details..." />
        ) : detail.data ? (
          <div className="grid gap-4 max-h-[80vh] overflow-y-auto pr-2 text-sm">
            <div className="grid grid-cols-2 gap-4 border-b border-slate-100 pb-3">
              <div>
                <p className="text-xs font-semibold text-slate-400 uppercase">User context</p>
                <p className="font-medium text-slate-900">{detail.data.session.user_name} ({detail.data.session.user_role})</p>
              </div>
              <div>
                <p className="text-xs font-semibold text-slate-400 uppercase">Model name</p>
                <p className="font-medium text-slate-900">{detail.data.session.model_name ?? '—'} ({detail.data.session.prompt_version ?? '—'})</p>
              </div>
              <div>
                <p className="text-xs font-semibold text-slate-400 uppercase">Token counts</p>
                <p className="font-medium text-slate-900">Input: {detail.data.session.token_input ?? 0} | Output: {detail.data.session.token_output ?? 0}</p>
              </div>
              <div>
                <p className="text-xs font-semibold text-slate-400 uppercase">Latency & Cost</p>
                <p className="font-medium text-slate-900">{detail.data.session.duration_ms ? `${detail.data.session.duration_ms}ms` : '—'} | ${detail.data.session.estimated_cost?.toFixed(4) ?? '0.0000'}</p>
              </div>
            </div>

            {detail.data.messages.length > 0 ? (
              <div className="grid gap-2">
                <h3 className="font-semibold text-slate-900">Message history</h3>
                <div className="grid gap-2 border border-slate-100 rounded-lg p-3 bg-slate-50 max-h-[250px] overflow-y-auto">
                  {detail.data.messages.map((m, idx) => (
                    <div key={idx} className={`p-2.5 rounded-lg max-w-[85%] ${m.sender === 'USER' ? 'bg-blue-50 text-blue-900 self-start' : 'bg-slate-100 text-slate-950 self-end ml-auto'}`}>
                      <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wide">{m.sender}</p>
                      <p className="mt-1 whitespace-pre-wrap font-sans text-xs">{m.sanitized_content ?? m.content}</p>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

            {detail.data.tool_calls.length > 0 ? (
              <div className="grid gap-2">
                <h3 className="font-semibold text-slate-900">Tool Calls</h3>
                <div className="grid gap-2 border border-slate-100 rounded-lg p-3">
                  {detail.data.tool_calls.map((tc) => (
                    <details key={tc.id} className="cursor-pointer border-b border-slate-100 pb-2 last:border-0">
                      <summary className="flex items-center justify-between text-xs font-medium text-slate-700">
                        <span>{tc.tool_name}</span>
                        <div className="flex gap-2">
                          <Badge tone={tc.status === 'SUCCESS' ? 'success' : 'danger'}>{tc.status}</Badge>
                          <span className="text-slate-400">{tc.latency_ms}ms</span>
                        </div>
                      </summary>
                      <div className="mt-2 text-xs grid gap-2 font-mono bg-slate-900 text-slate-100 p-2 rounded max-h-[150px] overflow-y-auto">
                        <div>
                          <p className="text-slate-400 font-sans font-bold">Input:</p>
                          <pre>{prettyJson(tc.input_json)}</pre>
                        </div>
                        {tc.output_json ? (
                          <div>
                            <p className="text-slate-400 font-sans font-bold">Output:</p>
                            <pre>{prettyJson(tc.output_json)}</pre>
                          </div>
                        ) : null}
                        {tc.error_message ? (
                          <div className="text-rose-400">
                            <p className="font-sans font-bold">Error:</p>
                            <pre>{tc.error_message}</pre>
                          </div>
                        ) : null}
                      </div>
                    </details>
                  ))}
                </div>
              </div>
            ) : null}

            {detail.data.extractions.length > 0 ? (
              <div className="grid gap-2">
                <h3 className="font-semibold text-slate-900">Extracted JSON Data</h3>
                {detail.data.extractions.map((ex) => (
                  <div key={ex.id} className="border border-slate-100 rounded-lg p-3 bg-slate-50">
                    <p className="text-xs font-semibold text-slate-500">Type: {ex.extraction_type}</p>
                    <pre className="mt-2 text-xs font-mono max-h-[150px] overflow-y-auto bg-white border border-slate-200 rounded p-2">{prettyJson(ex.extracted_json)}</pre>
                  </div>
                ))}
              </div>
            ) : null}

            {detail.data.errors.length > 0 ? (
              <div className="grid gap-2">
                <h3 className="font-semibold text-rose-700">Logged Errors</h3>
                {detail.data.errors.map((er) => (
                  <div key={er.id} className="border border-rose-100 bg-rose-50/50 rounded-lg p-3 text-rose-900">
                    <p className="text-xs font-bold uppercase text-rose-500">{er.error_type} ({er.severity})</p>
                    <p className="font-medium text-slate-900 mt-1">{er.message}</p>
                    {er.stack_trace ? (
                      <pre className="mt-2 text-[11px] font-mono bg-rose-100/50 border border-rose-200 rounded p-2 max-h-[100px] overflow-y-auto">{er.stack_trace}</pre>
                    ) : null}
                  </div>
                ))}
              </div>
            ) : null}

            {detail.data.feedback.length > 0 ? (
              <div className="grid gap-2">
                <h3 className="font-semibold text-slate-900">User Feedback</h3>
                {detail.data.feedback.map((fb) => (
                  <div key={fb.id} className="border border-slate-100 bg-slate-50 rounded-lg p-3">
                    <Badge tone={fb.rating === 'HELPFUL' ? 'success' : 'danger'}>{fb.rating}</Badge>
                    {fb.category ? <span className="text-xs text-slate-500 ml-2 font-medium">({fb.category})</span> : null}
                    {fb.comment ? <p className="text-slate-700 mt-2 italic">"{fb.comment}"</p> : null}
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}
      </Modal>
    </div>
  );
}
