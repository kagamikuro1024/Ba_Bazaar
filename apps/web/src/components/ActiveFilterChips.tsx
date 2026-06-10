import { X } from 'lucide-react';
import { cn } from '@/lib/utils';

export type ActiveFilter = {
  /** Stable id. */
  id: string;
  /** Display label, e.g. "Level: SENIOR". */
  label: string;
  /** Removes this filter. */
  onRemove: () => void;
};

type ActiveFilterChipsProps = {
  filters: ActiveFilter[];
  /** Optional "Clear all" handler. */
  onClearAll?: () => void;
  className?: string;
};

/**
 * ActiveFilterChips — small inline list of currently-applied filter chips,
 * each with an X to remove. Renders nothing if `filters` is empty.
 */
export function ActiveFilterChips({
  filters,
  onClearAll,
  className
}: ActiveFilterChipsProps) {
  if (filters.length === 0) return null;
  return (
    <div className={cn('flex flex-wrap items-center gap-2', className)}>
      {filters.map((filter) => (
        <span
          key={filter.id}
          className="inline-flex items-center gap-1 rounded-full border border-blue-200 bg-blue-50 px-2.5 py-1 text-xs font-semibold text-blue-700"
        >
          {filter.label}
          <button
            type="button"
            onClick={filter.onRemove}
            className="rounded-full p-0.5 hover:bg-blue-100"
            aria-label={`Remove ${filter.label} filter`}
          >
            <X className="h-3 w-3" />
          </button>
        </span>
      ))}
      {onClearAll ? (
        <button
          type="button"
          onClick={onClearAll}
          className="text-xs font-semibold text-slate-500 hover:text-slate-900"
        >
          Clear all
        </button>
      ) : null}
    </div>
  );
}
