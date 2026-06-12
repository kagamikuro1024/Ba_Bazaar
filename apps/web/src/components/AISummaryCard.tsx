import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Sparkles } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import type { AISummary } from '@/lib/aiSummary';

// ---------------------------------------------------------------------------
// AISummaryCard — shared grounded-AI summary block.
//
// Used on the Manager Dashboard, Action Center, Reports, and the BA
// dashboard. Renders: headline summary, cited bullets with semantic
// highlights, deterministic suggested-action chips (navigation only — the
// AI never mutates anything), and the grounding data.
// ---------------------------------------------------------------------------

export function AISummaryCard({
  summary,
  isLoading,
  title = 'Grounded AI Summary',
  loadingTitle = 'Grounding AI summary',
  actionRoutes = {},
  className
}: {
  summary?: AISummary;
  isLoading?: boolean;
  title?: string;
  loadingTitle?: string;
  /** Maps suggested action ids (from the API) to in-app routes. */
  actionRoutes?: Record<string, string>;
  className?: string;
}) {
  if (isLoading) {
    return <AISummaryLoadingCard title={loadingTitle} className={className} />;
  }

  if (!summary) return null;

  const citationMap = new Map(summary.citations.map((citation) => [citation.id, citation]));
  const actions = (summary.suggested_actions ?? []).filter((action) => action.label);

  return (
    <Card className={cn('border-blue-100 bg-gradient-to-br from-blue-50/80 to-white', className)}>
      <CardContent className="grid gap-4 p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-blue-600" />
              <h2 className="text-base font-semibold text-slate-950">{title}</h2>
            </div>
            <p className="mt-1 text-sm text-slate-600">{summary.summary}</p>
          </div>
          <Badge tone={summary.provider === 'deepseek' ? 'info' : 'neutral'}>
            {summary.provider === 'deepseek' ? 'DeepSeek' : 'Fallback'} ·{' '}
            {summary.cached ? 'cached' : 'cited'}
          </Badge>
        </div>
        <div className="grid gap-2">
          {summary.bullets.map((bullet) => (
            <div
              key={bullet.text}
              className="rounded-lg border border-blue-100 bg-white/80 p-3 text-sm text-slate-700"
            >
              <p>{renderHighlightedText(bullet.text, bullet.highlights ?? [])}</p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {bullet.citations.map((id) => {
                  const citation = citationMap.get(id);
                  return citation ? (
                    <span
                      key={id}
                      className="rounded-full bg-blue-50 px-2 py-0.5 text-[11px] font-semibold text-blue-700"
                      title={citation.value}
                    >
                      {id}: {citation.label}
                    </span>
                  ) : null;
                })}
              </div>
            </div>
          ))}
        </div>
        {actions.length > 0 ? (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
              Next actions
            </span>
            {actions.map((action) => {
              const to = actionRoutes[action.id];
              const chip = (
                <span className="inline-flex items-center gap-1 rounded-full border border-blue-200 bg-white px-3 py-1.5 text-xs font-semibold text-blue-700 transition hover:border-blue-300 hover:bg-blue-50">
                  {action.label}
                  {to ? <ArrowRight className="h-3 w-3" /> : null}
                </span>
              );
              return to ? (
                <Link key={action.id} to={to}>
                  {chip}
                </Link>
              ) : (
                <span key={action.id}>{chip}</span>
              );
            })}
          </div>
        ) : null}
        <details className="text-xs text-slate-500">
          <summary className="cursor-pointer font-semibold text-slate-600">
            View grounding data
          </summary>
          <div className="mt-2 grid gap-1 sm:grid-cols-2">
            {summary.citations.map((citation) => (
              <p key={citation.id} className="rounded-md bg-white/70 px-2 py-1">
                <span className="font-semibold text-slate-700">
                  {citation.id} {citation.label}:
                </span>{' '}
                {citation.value}
              </p>
            ))}
          </div>
        </details>
      </CardContent>
    </Card>
  );
}

function AISummaryLoadingCard({ title, className }: { title: string; className?: string }) {
  return (
    <Card
      className={cn(
        'overflow-hidden border-blue-100 bg-gradient-to-br from-blue-50 via-white to-cyan-50',
        className
      )}
    >
      <CardContent className="relative grid gap-4 p-5">
        <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(110deg,transparent_20%,rgba(59,130,246,0.16)_45%,transparent_70%)] animate-[dashboard-shimmer_1.8s_ease-in-out_infinite]" />
        <div className="relative flex items-start gap-3">
          <div className="grid h-10 w-10 place-items-center rounded-2xl bg-blue-600 text-white shadow-lg shadow-blue-200">
            <Sparkles className="h-5 w-5 animate-pulse" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h2 className="text-base font-semibold text-slate-950">{title}</h2>
              <span className="relative flex h-2.5 w-2.5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-blue-400 opacity-75" />
                <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-blue-500" />
              </span>
            </div>
            <p className="mt-1 text-sm text-slate-600">
              Checking the facts, drafting cited bullets, then validating every claim.
            </p>
          </div>
        </div>
        <div className="relative grid gap-2">
          {['Collecting metrics', 'Writing cited bullets', 'Verifying citation IDs'].map(
            (label, index) => (
              <div
                key={label}
                className="flex items-center gap-3 rounded-lg border border-blue-100 bg-white/80 p-3"
              >
                <span
                  className="h-2 w-2 rounded-full bg-blue-500 animate-[dashboard-dot_1.2s_ease-in-out_infinite]"
                  style={{ animationDelay: `${index * 160}ms` }}
                />
                <span className="text-sm font-medium text-slate-700">{label}</span>
                <span className="ml-auto h-2 w-24 overflow-hidden rounded-full bg-slate-100">
                  <span
                    className="block h-full w-1/2 rounded-full bg-blue-400 animate-[dashboard-progress_1.5s_ease-in-out_infinite]"
                    style={{ animationDelay: `${index * 120}ms` }}
                  />
                </span>
              </div>
            )
          )}
        </div>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Semantic highlights — emphasize the numbers and risk words inside bullets.
// ---------------------------------------------------------------------------

const KEYWORD_HIGHLIGHTS = [
  'overbooked',
  'overbook risk',
  'bench',
  'urgent',
  'unassigned',
  'capacity risk',
  'pending'
];

function renderHighlightedText(text: string, extraHighlights: string[]): ReactNode {
  const lower = text.toLowerCase();
  const terms = new Set<string>();

  for (const keyword of KEYWORD_HIGHLIGHTS) {
    if (lower.includes(keyword)) terms.add(keyword);
  }
  for (const match of text.match(/\b\d+(?:\.\d+)?%/g) ?? []) terms.add(match);
  for (const match of text.match(/\b\d+(?:\.\d+)?\s+man-days?\b/gi) ?? []) terms.add(match);
  for (const highlight of extraHighlights) {
    const trimmed = highlight.trim();
    if (trimmed && text.includes(trimmed)) terms.add(trimmed);
  }

  const uniqueHighlights = Array.from(terms).slice(0, 10);
  if (uniqueHighlights.length === 0) return text;

  const pattern = new RegExp(`(${uniqueHighlights.map(escapeRegex).join('|')})`, 'gi');
  return text.split(pattern).map((part, index) => {
    const matched = uniqueHighlights.find(
      (highlight) => highlight.toLowerCase() === part.toLowerCase()
    );
    return matched ? (
      <mark
        key={`${part}-${index}`}
        className={cn('rounded px-1 font-semibold', highlightTone(part))}
      >
        {part}
      </mark>
    ) : (
      part
    );
  });
}

function highlightTone(value: string) {
  const lower = value.toLowerCase();
  if (lower.includes('overbook')) return 'bg-rose-100 text-rose-800 ring-1 ring-rose-200';
  if (lower.includes('bench')) return 'bg-sky-100 text-sky-800 ring-1 ring-sky-200';
  if (lower.includes('urgent')) return 'bg-amber-100 text-amber-900 ring-1 ring-amber-200';
  if (lower.includes('unassigned')) return 'bg-violet-100 text-violet-800 ring-1 ring-violet-200';
  if (lower.includes('capacity risk')) return 'bg-amber-100 text-amber-900 ring-1 ring-amber-200';
  if (/^\d/.test(lower)) return 'bg-emerald-100 text-emerald-800 ring-1 ring-emerald-200';
  return 'bg-amber-100 text-amber-900 ring-1 ring-amber-200';
}

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
