import type { ReactNode } from 'react';
import { SlidersHorizontal, X } from 'lucide-react';
import { Button } from './ui/button';
import { cn } from '@/lib/utils';

type FilterButtonProps = {
  activeCount: number;
  onToggle: () => void;
  open: boolean;
  children?: ReactNode;
  className?: string;
};

/**
 * FilterButton — toggles a connected popover/drawer of advanced filters.
 * Shows a count badge when any filter is active. Renders as the
 * "Filters" button. Children are rendered as the popover content via
 * AdvancedFilterPopover, not directly here.
 */
export function FilterButton({
  activeCount,
  onToggle,
  open,
  className
}: FilterButtonProps) {
  return (
    <Button
      type="button"
      variant={open || activeCount > 0 ? 'default' : 'secondary'}
      onClick={onToggle}
      aria-expanded={open}
      className={cn('relative', className)}
    >
      <SlidersHorizontal className="h-4 w-4" />
      Filters
      {activeCount > 0 ? (
        <span
          className={cn(
            'ml-1 inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-xs font-bold',
            open || activeCount > 0 ? 'bg-white text-blue-700' : 'bg-slate-100 text-slate-600'
          )}
        >
          {activeCount}
        </span>
      ) : null}
    </Button>
  );
}

type AdvancedFilterPopoverProps = {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  title?: string;
  /** Approximate width. */
  width?: number;
  /** Optional footer with "Clear all" + "Apply" buttons. */
  footer?: ReactNode;
};

/**
 * AdvancedFilterPopover — popover panel that pairs with FilterButton.
 * Anchors to the button's right side; closes on outside click.
 */
export function AdvancedFilterPopover({
  open,
  onClose,
  children,
  title = 'Advanced filters',
  width = 360,
  footer
}: AdvancedFilterPopoverProps) {
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-40"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="absolute left-4 right-4 top-32 z-50 rounded-2xl border border-slate-200 bg-white shadow-2xl sm:left-auto"
        style={{ maxWidth: width, width: `min(${width}px, calc(100vw - 2rem))` }}
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-label={title}
      >
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
          <h3 className="text-sm font-semibold text-slate-950">{title}</h3>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
            aria-label="Close filters"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="grid max-h-[60vh] gap-3 overflow-y-auto p-4">{children}</div>
        {footer ? (
          <div className="flex items-center justify-end gap-2 border-t border-slate-200 px-4 py-3">
            {footer}
          </div>
        ) : null}
      </div>
    </div>
  );
}
