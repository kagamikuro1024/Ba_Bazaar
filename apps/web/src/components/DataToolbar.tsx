import type { ReactNode } from 'react';
import { Search } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from './ui/button';

type DataToolbarProps = {
  /** Search placeholder, e.g. "Search BA, projects...". */
  searchPlaceholder?: string;
  searchValue: string;
  onSearchChange: (value: string) => void;
  /** Optional debounce hint — toolbar itself doesn't debounce, callers do. */
  /** Number of active filters (drives the badge on the filter button). */
  activeFilterCount?: number;
  /** Toggles the advanced filter popover. */
  onFiltersToggle?: () => void;
  /** Whether the filter popover is open (controls button appearance). */
  filtersOpen?: boolean;
  /** Right-side actions: e.g. "Create BA" button, bulk actions. */
  actions?: ReactNode;
  className?: string;
};

/**
 * DataToolbar — search + filter button + page actions, used at the top of
 * every list page. Renders inside a Card via FilterCard, or standalone.
 *
 * For more complex toolbars (e.g. with tabs), use PageHeader.meta instead.
 */
export function DataToolbar({
  searchPlaceholder = 'Search...',
  searchValue,
  onSearchChange,
  activeFilterCount = 0,
  onFiltersToggle,
  filtersOpen = false,
  actions,
  className
}: DataToolbarProps) {
  return (
    <div
      className={cn(
        'flex flex-col gap-3 md:flex-row md:items-center md:justify-between',
        className
      )}
    >
      <div className="flex min-w-0 flex-1 flex-col gap-2 sm:flex-row sm:items-center">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            type="search"
            value={searchValue}
            onChange={(event) => onSearchChange(event.target.value)}
            placeholder={searchPlaceholder}
            className="h-11 w-full rounded-lg border border-slate-200 bg-white pl-9 pr-3 text-sm placeholder:text-slate-400 focus:border-blue-400 focus:outline-none focus:ring-4 focus:ring-blue-100 sm:h-10 sm:rounded-lg"
          />
        </div>
        {onFiltersToggle ? (
          <Button
            type="button"
            variant={filtersOpen ? 'default' : 'secondary'}
            onClick={onFiltersToggle}
            aria-expanded={filtersOpen}
            className="relative"
          >
            Filters
            {activeFilterCount > 0 ? (
              <span
                className={cn(
                  'ml-1 inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-xs font-bold',
                  filtersOpen
                    ? 'bg-white text-blue-700'
                    : 'bg-blue-600 text-white'
                )}
              >
                {activeFilterCount}
              </span>
            ) : null}
          </Button>
        ) : null}
      </div>
      {actions ? (
        <div className="flex flex-wrap items-center gap-2">{actions}</div>
      ) : null}
    </div>
  );
}
