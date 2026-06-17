import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { format, parseISO } from 'date-fns';
import { apiFetch, type AiFeedback } from '@/lib/api';
import { PageHeader } from '@/components/PageHeader';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { LoadingScreen } from '@/components/ui/loading-screen';

function fmtDateTime(value?: string | null) {
  if (!value) return '—';
  try {
    return format(parseISO(value), 'dd/MM/yyyy HH:mm:ss');
  } catch {
    return value;
  }
}

export function AIFeedbackPage() {
  const [ratingFilter, setRatingFilter] = useState('');
  const [page, setPage] = useState(1);

  const queryKey = useMemo(
    () => ['admin-ai-feedback', ratingFilter, page],
    [ratingFilter, page]
  );

  const feedback = useQuery({
    queryKey,
    queryFn: () => {
      const params = new URLSearchParams();
      if (ratingFilter) params.set('rating', ratingFilter);
      params.set('page', String(page));
      params.set('page_size', '15');
      const qs = params.toString();
      return apiFetch<{ items: AiFeedback[]; total: number; total_pages: number }>(
        `/api/admin/ai/feedback?${qs}`
      );
    }
  });

  const rows = feedback.data?.items ?? [];
  const totalPages = feedback.data?.total_pages ?? 1;

  return (
    <div className="grid gap-5">
      <PageHeader
        eyebrow="AI Platform"
        title="User Feedback Feed"
        description="Monitor how users rate generated AI suggestions, comments, and flags."
      />

      <Card>
        <CardContent className="grid gap-3 p-4 sm:grid-cols-[1fr_auto]">
          <div className="text-sm text-slate-500 flex items-center">Filter feedback by rating</div>
          <select
            value={ratingFilter}
            onChange={(e) => {
              setRatingFilter(e.target.value);
              setPage(1);
            }}
            className="h-9 rounded-lg border border-slate-200 bg-white px-2 text-sm w-[200px]"
          >
            <option value="">All ratings</option>
            <option value="HELPFUL">Helpful</option>
            <option value="NOT_HELPFUL">Not Helpful</option>
          </select>
        </CardContent>
      </Card>

      <Card className="overflow-hidden">
        <CardContent className="p-0">
          {feedback.isLoading ? (
            <LoadingScreen message="Loading feedback" />
          ) : feedback.error ? (
            <div className="p-5 text-sm text-rose-700">Could not load feedback.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                    <th className="px-4 py-2 font-semibold">User</th>
                    <th className="px-4 py-2 font-semibold">Feature</th>
                    <th className="px-4 py-2 font-semibold">Rating</th>
                    <th className="px-4 py-2 font-semibold">Reason Category</th>
                    <th className="px-4 py-2 font-semibold">Comment</th>
                    <th className="px-4 py-2 font-semibold">Session ID</th>
                    <th className="px-4 py-2 font-semibold">Submitted</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="px-4 py-4 text-slate-500">
                        No feedback recorded.
                      </td>
                    </tr>
                  ) : (
                    rows.map((fb) => (
                      <tr key={fb.id} className="border-b border-slate-100">
                        <td className="px-4 py-2 font-medium text-slate-900">{fb.user_name}</td>
                        <td className="px-4 py-2 text-slate-600">
                          <Badge tone="info">{fb.feature_name.replace('AI_', '').replace('_', ' ')}</Badge>
                        </td>
                        <td className="px-4 py-2">
                          <Badge tone={fb.rating === 'HELPFUL' ? 'success' : 'danger'}>{fb.rating}</Badge>
                        </td>
                        <td className="px-4 py-2 text-slate-600">{fb.category ?? '—'}</td>
                        <td className="px-4 py-2 text-slate-700 max-w-[200px] truncate" title={fb.comment ?? ''}>
                          {fb.comment ? `"${fb.comment}"` : '—'}
                        </td>
                        <td className="px-4 py-2 text-slate-500 font-mono text-xs">{fb.session_id ?? '—'}</td>
                        <td className="px-4 py-2 text-slate-600">{fmtDateTime(fb.created_at)}</td>
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
    </div>
  );
}
