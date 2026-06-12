import { Search, X } from 'lucide-react';
import { cn } from '@/lib/utils';

type TableSearchProps = {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
};

/**
 * TableSearch — bare-bones search input meant to live inside a
 * DataTable header. For the toolbar version (with filter button), use
 * DataToolbar instead.
 */
export function TableSearch({
  value,
  onChange,
  placeholder = 'Search...',
  className
}: TableSearchProps) {
  return (
    <div className={cn('relative w-full sm:w-64', className)}>
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
      <input
        type="search"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="h-9 w-full rounded-lg border border-slate-200 bg-white pl-9 pr-8 text-sm placeholder:text-slate-400 focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-200"
      />
      {value ? (
        <button
          type="button"
          onClick={() => onChange('')}
          className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
          aria-label="Clear search"
        >
          <X className="h-3 w-3" />
        </button>
      ) : null}
    </div>
  );
}
