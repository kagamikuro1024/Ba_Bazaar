import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api';

// ---------------------------------------------------------------------------
// Grounded AI page summaries — shared client.
//
// Mirrors the Go response shape in apps/api/cmd/api/llm_summary.go. The
// backend caches by data fingerprint (the LLM is only re-billed when the
// underlying data changes); on top of that, react-query keeps the response
// fresh client-side for AI_SUMMARY_STALE_MS so re-opening a page does not
// even hit the endpoint again within a session.
// ---------------------------------------------------------------------------

export type AISummaryBullet = {
  text: string;
  citations: string[];
  highlights?: string[];
};

export type AISummaryCitation = {
  id: string;
  label: string;
  value: string;
};

export type AISummaryAction = {
  id: string;
  label: string;
};

export type AISummary = {
  summary: string;
  bullets: AISummaryBullet[];
  citations: AISummaryCitation[];
  suggested_actions?: AISummaryAction[];
  provider: 'deepseek' | 'fallback';
  grounded: boolean;
  reason?: string;
  cached?: boolean;
};

const AI_SUMMARY_STALE_MS = 2 * 60 * 1000;

export function useAISummary(endpoint: string | null, enabled = true) {
  return useQuery<AISummary>({
    queryKey: ['ai-summary', endpoint],
    queryFn: () => apiFetch<AISummary>(endpoint as string),
    enabled: Boolean(endpoint) && enabled,
    staleTime: AI_SUMMARY_STALE_MS,
    refetchOnWindowFocus: false,
    retry: 1
  });
}
