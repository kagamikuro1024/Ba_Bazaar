import { useCallback, useState } from 'react';
import { Sparkles, ChevronDown, ChevronUp, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useBARecommendations, type RecommendationQuery } from '@/lib/recommendations';
import { RecommendationPanel } from '@/components/ba/RecommendationPanel';

// ---------------------------------------------------------------------------
// RecommendationDropdown
//
// Self-contained wrapper that adds a "Suggest BAs" toggle next to any BA
// selection surface. The manager still picks — this component never
// auto-mutates; it just opens the ranked overlay and feeds selected
// candidates back via onSelectCandidate.
// ---------------------------------------------------------------------------

export function RecommendationDropdown({
  query,
  selectedBaId,
  onSelectCandidate,
  defaultOpen = false,
  triggerLabel = 'Suggest BAs',
  className
}: {
  query: RecommendationQuery | null;
  selectedBaId: string;
  onSelectCandidate: (baId: string) => void;
  defaultOpen?: boolean;
  triggerLabel?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const recommendations = useBARecommendations(open ? query : null);

  const handleSelect = useCallback(
    (baId: string) => {
      onSelectCandidate(baId);
    },
    [onSelectCandidate]
  );

  return (
    <div className={['grid gap-3', className].filter(Boolean).join(' ')}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button
          type="button"
          variant={open ? 'secondary' : 'default'}
          size="sm"
          onClick={() => setOpen((value) => !value)}
          disabled={!query}
          title={
            !query
              ? 'Fill in the date range, capacity, and (optionally) project to get suggestions.'
              : undefined
          }
        >
          {recommendations.isFetching ? (
            <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
          ) : (
            <Sparkles className="mr-1.5 h-3.5 w-3.5" />
          )}
          {triggerLabel}
          {open ? (
            <ChevronUp className="ml-1.5 h-3.5 w-3.5" />
          ) : (
            <ChevronDown className="ml-1.5 h-3.5 w-3.5" />
          )}
        </Button>
        {open && recommendations.data ? (
          <span className="text-xs text-slate-500">
            {recommendations.data.results.length} suggestion
            {recommendations.data.results.length === 1 ? '' : 's'}
          </span>
        ) : null}
      </div>

      {open ? (
        <RecommendationPanel
          results={recommendations.data?.results ?? []}
          isLoading={recommendations.isLoading}
          isError={recommendations.isError}
          onSelectCandidate={handleSelect}
          selectedBaId={selectedBaId}
          onRefresh={
            recommendations.isFetching
              ? undefined
              : () => {
                  void recommendations.refetch();
                }
          }
        />
      ) : null}
    </div>
  );
}
