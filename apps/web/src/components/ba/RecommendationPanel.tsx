import { useState } from 'react';
import { Sparkles, ChevronDown, ChevronUp, Loader2, Check } from 'lucide-react';
import { Avatar } from '@/components/common';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  type RecommendationResult,
  fitScoreTone,
  formatCapacityAfter,
  signalPercent
} from '@/lib/recommendations';

// ---------------------------------------------------------------------------
// Signal bar — small visual showing 0..1 as a 0..100% filled bar.
// ---------------------------------------------------------------------------

function SignalBar({ label, value }: { label: string; value: number }) {
  const pct = signalPercent(value);
  return (
    <div className="grid grid-cols-[6rem_1fr_2.5rem] items-center gap-2 text-xs text-slate-600">
      <span className="truncate">{label}</span>
      <div className="h-1.5 overflow-hidden rounded-full bg-slate-100">
        <div
          className={
            pct >= 70
              ? 'h-full bg-emerald-500'
              : pct >= 40
                ? 'h-full bg-amber-500'
                : 'h-full bg-rose-500'
          }
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="text-right font-semibold tabular-nums text-slate-700">
        {pct}%
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// One row in the ranked list.
// ---------------------------------------------------------------------------

function RecommendationRow({
  result,
  isSelected,
  onSelect
}: {
  result: RecommendationResult;
  isSelected: boolean;
  onSelect: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const tone = fitScoreTone(result.fit_score);
  const signals: Array<[string, number]> = [
    ['Skills', result.signals.skill_match],
    ['Level', result.signals.level_fit],
    ['Headroom', result.signals.capacity_headroom],
    ['Project', result.signals.project_affinity]
  ];

  // Subtitle: prefer a non-capacity reason (so we don't repeat the
  // "X% headroom" copy that's already in the headline right side).
  const headlineSubtitle = result.reasons.find(
    (reason) => !/headroom|capacity/i.test(reason)
  );

  return (
    <li
      className={[
        'rounded-lg border bg-white transition-colors',
        isSelected
          ? 'border-emerald-400 bg-emerald-50/40 ring-1 ring-emerald-200'
          : 'border-slate-200 hover:border-slate-300'
      ].join(' ')}
    >
      <div className="flex items-center gap-3 p-3">
        <Avatar name={result.full_name} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="truncate text-sm font-semibold text-slate-950">
              {result.full_name}
            </p>
            <Badge tone="neutral">{result.level}</Badge>
            {isSelected ? (
              <Badge tone="success">
                <Check className="mr-1 inline h-3 w-3" /> Selected
              </Badge>
            ) : null}
          </div>
          <p className="mt-0.5 truncate text-xs text-slate-500">
            {formatCapacityAfter(result)}
            {headlineSubtitle ? ` · ${headlineSubtitle}` : ''}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge tone={tone} className="min-w-[3rem] justify-center">
            {result.fit_score}
          </Badge>
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              setExpanded((value) => !value);
            }}
            className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
            aria-label={expanded ? 'Hide details' : 'Show details'}
            aria-expanded={expanded}
          >
            {expanded ? (
              <ChevronUp className="h-4 w-4" />
            ) : (
              <ChevronDown className="h-4 w-4" />
            )}
          </button>
        </div>
      </div>
      {expanded ? (
        <div className="grid gap-3 border-t border-slate-100 bg-slate-50/50 p-3">
          <div className="grid gap-1.5">
            {signals.map(([label, value]) => (
              <SignalBar key={label} label={label} value={value} />
            ))}
          </div>
          {result.reasons.length > 0 ? (
            <ul className="grid gap-1 text-xs text-slate-600">
              {result.reasons.map((reason) => (
                <li key={reason} className="flex items-start gap-1.5">
                  <span className="mt-1 h-1 w-1 flex-shrink-0 rounded-full bg-slate-400" />
                  <span>{reason}</span>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
      <div className="flex items-center justify-end gap-2 border-t border-slate-100 p-2">
        <Button
          type="button"
          size="sm"
          variant={isSelected ? 'secondary' : 'default'}
          onClick={onSelect}
          disabled={isSelected}
        >
          {isSelected ? 'Currently selected' : 'Assign this BA'}
        </Button>
      </div>
    </li>
  );
}

// ---------------------------------------------------------------------------
// Panel — renders the ranked list with header, hint, empty / loading states.
// The manager remains the decision-maker: clicking a candidate just calls
// onSelectCandidate; this panel NEVER auto-mutates.
// ---------------------------------------------------------------------------

export function RecommendationPanel({
  results,
  isLoading,
  isError,
  onSelectCandidate,
  selectedBaId,
  onRefresh
}: {
  results: RecommendationResult[];
  isLoading: boolean;
  isError: boolean;
  onSelectCandidate: (baId: string) => void;
  selectedBaId: string;
  onRefresh?: () => void;
}) {
  return (
    <section className="grid gap-3 rounded-xl border border-emerald-200 bg-gradient-to-br from-emerald-50/50 to-white p-4">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-emerald-600" />
          <p className="text-sm font-semibold text-slate-950">
            Model suggestions
          </p>
          <Badge tone="info">Manager picks</Badge>
        </div>
        {onRefresh ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onRefresh}
            disabled={isLoading}
          >
            {isLoading ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              'Refresh'
            )}
          </Button>
        ) : null}
      </header>

      <p className="text-xs text-slate-500">
        Scored on skills, level, capacity headroom, and project history. The
        manager picks — nothing is auto-assigned.
      </p>

      {isLoading ? (
        <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white p-4 text-sm text-slate-500">
          <Loader2 className="h-4 w-4 animate-spin" />
          Scoring candidates…
        </div>
      ) : null}

      {isError ? (
        <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs text-rose-700">
          Could not load suggestions. The regular BA list is still available
          below.
        </div>
      ) : null}

      {!isLoading && !isError && results.length === 0 ? (
        <div className="rounded-lg border border-slate-200 bg-white p-4 text-sm text-slate-500">
          No candidates match the current filters.
        </div>
      ) : null}

      {!isLoading && !isError && results.length > 0 ? (
        <ul className="grid gap-2">
          {results.map((result) => (
            <RecommendationRow
              key={result.ba_id}
              result={result}
              isSelected={result.ba_id === selectedBaId}
              onSelect={() => onSelectCandidate(result.ba_id)}
            />
          ))}
        </ul>
      ) : null}
    </section>
  );
}
