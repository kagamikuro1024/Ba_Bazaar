import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { Card, CardContent } from './ui/card';
import { TableSearch } from './TableSearch';

type Column<T> = {
  /** Stable id. */
  id: string;
  /** Header label. */
  header: string;
  /** Cell renderer. */
  cell: (row: T) => ReactNode;
  /** Optional Tailwind width class, e.g. "w-32", "min-w-[10rem]". */
  className?: string;
  /** Optional header className. */
  headerClassName?: string;
};

type DataTableProps<T> = {
  rows: T[];
  columns: Array<Column<T>>;
  /** Stable key extractor. */
  rowKey: (row: T) => string;
  /** Optional click handler for a row. */
  onRowClick?: (row: T) => void;
  /** Optional per-row className for selected/error/highlight states. */
  rowClassName?: (row: T) => string | undefined;
  /** Show the search input in the table header. */
  search?: {
    value: string;
    onChange: (value: string) => void;
    placeholder?: string;
  };
  /** Render this instead of `rows` when `rows.length === 0`. */
  emptyState?: ReactNode;
  /** Render this while a parent-driven `isLoading` is true. */
  loadingState?: ReactNode;
  isLoading?: boolean;
  /** Optional toolbar rendered above the table (e.g. active filter chips). */
  toolbar?: ReactNode;
  className?: string;
};

/**
 * DataTable — the standard list/table component.
 *
 * Generic over row type. Renders an HTML <table> with consistent
 * padding/typography. Supports a built-in search input, custom empty
 * state, and loading state.
 *
 * For row clicks that should look like navigation, wrap the cell content
 * in a Link yourself — this component never opens a route.
 */
export function DataTable<T>({
  rows,
  columns,
  rowKey,
  onRowClick,
  rowClassName,
  search,
  emptyState,
  loadingState,
  isLoading = false,
  toolbar,
  className
}: DataTableProps<T>) {
  return (
    <Card className={cn('overflow-hidden', className)}>
      {(search || toolbar) && (
        <div className="flex flex-col gap-3 border-b border-slate-200 p-4 sm:flex-row sm:items-center sm:justify-between">
          {search ? (
            <TableSearch
              value={search.value}
              onChange={search.onChange}
              placeholder={search.placeholder}
            />
          ) : (
            <div />
          )}
          {toolbar ? <div className="flex flex-wrap items-center gap-2">{toolbar}</div> : null}
        </div>
      )}
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50/60 text-xs font-semibold uppercase tracking-wide text-slate-500">
              {columns.map((column) => (
                <th
                  key={column.id}
                  className={cn('px-4 py-3', column.headerClassName)}
                >
                  {column.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={rowKey(row)}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                className={cn(
                  'border-b border-slate-100 last:border-b-0',
                  onRowClick && 'cursor-pointer hover:bg-slate-50',
                  rowClassName?.(row)
                )}
              >
                {columns.map((column) => (
                  <td key={column.id} className={cn('px-4 py-3 align-middle', column.className)}>
                    {column.cell(row)}
                  </td>
                ))}
              </tr>
            ))}
            {!isLoading && rows.length === 0 ? (
              <tr>
                <td colSpan={columns.length} className="px-4 py-8 text-center text-sm text-slate-500">
                  {emptyState ?? 'No results.'}
                </td>
              </tr>
            ) : null}
            {isLoading && rows.length === 0 ? (
              <tr>
                <td colSpan={columns.length} className="px-4 py-8 text-center text-sm text-slate-500">
                  {loadingState ?? 'Loading...'}
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

// Silence unused-import warning for CardContent (re-exported via Card).
void CardContent;
