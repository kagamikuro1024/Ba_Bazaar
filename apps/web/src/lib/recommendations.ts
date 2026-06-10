import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiFetch, type BALevel } from '@/lib/api';

// ---------------------------------------------------------------------------
// Types — mirror the Go handler's response shape (apps/api/cmd/api/recommendations_handler.go).
// ---------------------------------------------------------------------------

export type RecommendationSignals = {
  /** Jaccard overlap with required skills (0..1). */
  skill_match: number;
  /** Normalized distance from requested level (0..1). */
  level_fit: number;
  /** 1 - clamp(max_risk_after / 200, 0, 1). 1 = empty BA, 0 = over capacity. */
  capacity_headroom: number;
  /** Project-bookings / total-bookings for the BA, 0..1. */
  project_affinity: number;
};

export type RecommendationResult = {
  ba_id: string;
  full_name: string;
  level: BALevel;
  status: string;
  /** Weighted-sum score on a 0..100 scale. */
  fit_score: number;
  signals: RecommendationSignals;
  /** Worst-case risk capacity if this booking is added. */
  max_risk_capacity_after: number;
  reasons: string[];
};

export type RecommendationQuery = {
  start_date: string; // YYYY-MM-DD
  end_date: string;   // YYYY-MM-DD
  capacity_percent: number; // 1..100
  required_skill_ids?: string[];
  level?: BALevel | '';
  project_id?: string;
  limit?: number; // 1..25, default 5
  exclude_ba_ids?: string[];
};

export type RecommendationResponse = {
  query: {
    start_date: string;
    end_date: string;
    capacity_percent: number;
    required_skill_ids: string[];
    level: string;
    project_id: string;
    limit: number;
  };
  results: RecommendationResult[];
};

// ---------------------------------------------------------------------------
// Pure helpers (no React). Useful in unit tests and previews.
// ---------------------------------------------------------------------------

/** Build a `fetch` URL for the recommendations endpoint. */
export function buildRecommendationsUrl(query: RecommendationQuery): string {
  const params = new URLSearchParams();
  params.set('start_date', query.start_date);
  params.set('end_date', query.end_date);
  params.set('capacity_percent', String(query.capacity_percent));
  if (query.required_skill_ids && query.required_skill_ids.length > 0) {
    params.set('required_skill_ids', query.required_skill_ids.join(','));
  }
  if (query.level) {
    params.set('level', query.level);
  }
  if (query.project_id) {
    params.set('project_id', query.project_id);
  }
  if (query.limit) {
    params.set('limit', String(query.limit));
  }
  if (query.exclude_ba_ids && query.exclude_ba_ids.length > 0) {
    params.set('exclude_ba_ids', query.exclude_ba_ids.join(','));
  }
  return `/api/ba/recommendations?${params.toString()}`;
}

/** Direct fetcher — for imperative calls. */
export function fetchRecommendations(query: RecommendationQuery) {
  return apiFetch<RecommendationResponse>(buildRecommendationsUrl(query));
}

// ---------------------------------------------------------------------------
// useBARecommendations — debounced query keyed off (start, end, capacity, ...).
//
// - 250ms debounce so date-input typing doesn't thrash the API.
// - Disabled when required fields are missing.
// ---------------------------------------------------------------------------

const RECOMMENDATIONS_DEBOUNCE_MS = 250;

function queryIsReady(query: RecommendationQuery | null | undefined): query is RecommendationQuery {
  if (!query) return false;
  if (!query.start_date || !query.end_date) return false;
  if (query.end_date < query.start_date) return false;
  if (
    !Number.isFinite(query.capacity_percent) ||
    query.capacity_percent < 1 ||
    query.capacity_percent > 100
  ) {
    return false;
  }
  return true;
}

export function useBARecommendations(query: RecommendationQuery | null | undefined) {
  const [debounced, setDebounced] = useState<RecommendationQuery | null>(null);

  useEffect(() => {
    if (!queryIsReady(query)) {
      setDebounced(null);
      return;
    }
    const timer = setTimeout(() => {
      setDebounced(query);
    }, RECOMMENDATIONS_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [
    query?.start_date,
    query?.end_date,
    query?.capacity_percent,
    query?.level,
    query?.project_id,
    query?.required_skill_ids?.join(','),
    query?.limit,
    query?.exclude_ba_ids?.join(',')
  ]);

  const stableKey = useMemo(() => {
    if (!debounced) return null;
    return [
      'ba-recommendations',
      debounced.start_date,
      debounced.end_date,
      debounced.capacity_percent,
      debounced.level ?? '',
      debounced.project_id ?? '',
      (debounced.required_skill_ids ?? []).join(','),
      (debounced.exclude_ba_ids ?? []).join(','),
      debounced.limit ?? 5
    ] as const;
  }, [debounced]);

  return useQuery<RecommendationResponse>({
    queryKey: stableKey ?? ['ba-recommendations', 'idle'],
    queryFn: () => fetchRecommendations(debounced as RecommendationQuery),
    enabled: Boolean(stableKey),
    staleTime: 30_000,
    refetchOnWindowFocus: false
  });
}

// ---------------------------------------------------------------------------
// Display helpers
// ---------------------------------------------------------------------------

/** Convert a 0..1 signal to a friendly percentage label (0–100). */
export function signalPercent(signal: number): number {
  if (!Number.isFinite(signal)) return 0;
  return Math.max(0, Math.min(100, Math.round(signal * 100)));
}

/** Pick a Tailwind-ish tone for a fit score: green >= 75, amber 50-74, rose < 50. */
export function fitScoreTone(score: number): 'success' | 'warning' | 'danger' | 'neutral' {
  if (score >= 75) return 'success';
  if (score >= 50) return 'warning';
  if (score > 0) return 'danger';
  return 'neutral';
}

/** Pretty capacity-after string, e.g. "50%" or "would exceed 100% by 30%". */
export function formatCapacityAfter(result: RecommendationResult): string {
  const after = result.max_risk_capacity_after;
  if (after <= 100) {
    return `${100 - after}% headroom`;
  }
  return `Would exceed 100% by ${after - 100}%`;
}
