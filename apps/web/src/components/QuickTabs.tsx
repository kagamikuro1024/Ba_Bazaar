import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

export type QuickTab<T extends string = string> = {
  value: T;
  label: string;
  count?: number;
  /** Optional tone for the count badge when the tab is active. */
  tone?: 'success' | 'warning' | 'danger' | 'info' | 'neutral';
  icon?: ReactNode;
};

type QuickTabsProps<T extends string> = {
  tabs: Array<QuickTab<T>>;
  value: T;
  onChange: (value: T) => void;
  /** Optional right-side content (e.g. "Reset filters" link). */
  trailing?: ReactNode;
  className?: string;
  /** Allow multi-select; if true, `value` becomes the array of selected tabs. */
  multi?: boolean;
};

/**
 * QuickTabs — pill-style segmented control for quick filtering. Used for
 * status filters, priority filters, "All / Unassigned / Pending" tabs, etc.
 *
 * Single-select by default. Set `multi` to allow multiple active tabs.
 */
export function QuickTabs<T extends string>({
  tabs,
  value,
  onChange,
  trailing,
  className,
  multi = false
}: QuickTabsProps<T>) {
  const isActive = (tabValue: T) =>
    multi ? (value as unknown as string).split(',').includes(tabValue) : value === tabValue;

  const handleClick = (tabValue: T) => {
    if (!multi) {
      onChange(tabValue);
      return;
    }
    const current = (value as unknown as string).split(',').filter(Boolean);
    const next = current.includes(tabValue)
      ? current.filter((v) => v !== tabValue)
      : [...current, tabValue];
    onChange(next.join(',') as T);
  };

  return (
    <div className={cn('-mx-1 flex items-center gap-2 overflow-x-auto px-1 pb-1 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden sm:flex-wrap sm:overflow-x-visible sm:pb-0', className)}>
      {tabs.map((tab) => {
        const active = isActive(tab.value);
        return (
          <button
            key={tab.value}
            type="button"
            onClick={() => handleClick(tab.value)}
            aria-pressed={active}
            className={cn(
              'inline-flex h-9 shrink-0 items-center gap-2 rounded-full border px-3 text-sm font-semibold transition-colors',
              active
                ? 'border-blue-300 bg-blue-50 text-blue-700 ring-1 ring-blue-200'
                : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:text-slate-900'
            )}
          >
            {tab.icon ? <span className="flex-shrink-0">{tab.icon}</span> : null}
            <span>{tab.label}</span>
            {typeof tab.count === 'number' ? (
              <span
                className={cn(
                  'inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-xs font-bold',
                  active ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-600'
                )}
              >
                {tab.count}
              </span>
            ) : null}
          </button>
        );
      })}
      {trailing ? <div className="ml-auto flex items-center gap-2">{trailing}</div> : null}
    </div>
  );
}
