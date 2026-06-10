import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from './ui/button';
import { cn } from '@/lib/utils';

type PaginationProps = {
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
  /** Maximum number of page buttons to show at once. */
  maxButtons?: number;
  className?: string;
};

/**
 * Pagination — page-numbered navigation strip. Computes a window of
 * page numbers around the current page with ellipses.
 */
export function Pagination({
  page,
  pageSize,
  total,
  onPageChange,
  maxButtons = 5,
  className
}: PaginationProps) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  if (totalPages <= 1) return null;

  const window = computePageWindow(page, totalPages, maxButtons);

  const start = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const end = Math.min(page * pageSize, total);

  return (
    <div
      className={cn(
        'flex flex-col items-center justify-between gap-3 p-4 sm:flex-row',
        className
      )}
    >
      <p className="text-sm text-slate-600">
        Showing <strong>{start}</strong>–<strong>{end}</strong> of{' '}
        <strong>{total}</strong>
      </p>
      <div className="flex items-center gap-1">
        <Button
          type="button"
          variant="secondary"
          size="icon"
          onClick={() => onPageChange(page - 1)}
          disabled={page <= 1}
          aria-label="Previous page"
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>
        {window.map((item, index) =>
          typeof item === 'number' ? (
            <button
              key={item}
              type="button"
              onClick={() => onPageChange(item)}
              className={cn(
                'inline-flex h-9 min-w-9 items-center justify-center rounded-md px-2 text-sm font-semibold transition-colors',
                item === page
                  ? 'bg-blue-600 text-white'
                  : 'border border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:text-slate-950'
              )}
            >
              {item}
            </button>
          ) : (
            <span
              key={`ellipsis-${index}`}
              className="px-1 text-sm font-semibold text-slate-400"
            >
              …
            </span>
          )
        )}
        <Button
          type="button"
          variant="secondary"
          size="icon"
          onClick={() => onPageChange(page + 1)}
          disabled={page >= totalPages}
          aria-label="Next page"
        >
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

function computePageWindow(
  current: number,
  total: number,
  max: number
): Array<number | 'ellipsis'> {
  if (total <= max) {
    return Array.from({ length: total }, (_, i) => i + 1);
  }
  const half = Math.floor(max / 2);
  let start = Math.max(2, current - half);
  let end = Math.min(total - 1, current + half);

  if (current - 1 <= half) end = Math.min(total - 1, max);
  if (total - current <= half) start = Math.max(2, total - max + 1);

  const result: Array<number | 'ellipsis'> = [1];
  if (start > 2) result.push('ellipsis');
  for (let i = start; i <= end; i++) result.push(i);
  if (end < total - 1) result.push('ellipsis');
  result.push(total);
  return result;
}
