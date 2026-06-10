import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

type StatTone = 'success' | 'warning' | 'danger' | 'info' | 'neutral';

const toneStyles: Record<StatTone, { icon: string; bar: string }> = {
  success: { icon: 'bg-emerald-100 text-emerald-700', bar: 'bg-emerald-500' },
  warning: { icon: 'bg-amber-100 text-amber-700', bar: 'bg-amber-500' },
  danger: { icon: 'bg-rose-100 text-rose-700', bar: 'bg-rose-500' },
  info: { icon: 'bg-blue-100 text-blue-700', bar: 'bg-blue-500' },
  neutral: { icon: 'bg-slate-100 text-slate-600', bar: 'bg-slate-300' }
};

type StatCardProps = {
  /** Small label above the value. */
  label: string;
  /** Big value (string so callers can format: "12", "86%", "$1.2k"). */
  value: string;
  /** Optional hint or trend line below the value. */
  hint?: string;
  /** Optional icon. */
  icon?: LucideIcon;
  tone?: StatTone;
  /** Optional click target. When set, the card becomes a button. */
  onClick?: () => void;
  /** Marks the card as the "active" filter/tab variant. */
  active?: boolean;
  /** Optional badge to render in the top-right. */
  trailing?: ReactNode;
  className?: string;
};

/**
 * StatCard — small KPI card for page headers, dashboards, and tab strips.
 *
 * Use as a button when `onClick` is provided. The `active` prop gives it
 * a selected look (e.g. when used as a filter chip).
 */
export function StatCard({
  label,
  value,
  hint,
  icon: Icon,
  tone = 'neutral',
  onClick,
  active = false,
  trailing,
  className
}: StatCardProps) {
  const styles = toneStyles[tone];
  const inner = (
    <div
      className={cn(
        'flex items-center gap-3 rounded-lg border bg-white p-4 transition-colors',
        active
          ? 'border-blue-300 bg-blue-50/50 ring-1 ring-blue-200'
          : 'border-slate-200',
        onClick && 'hover:border-slate-300 hover:shadow-sm cursor-pointer',
        className
      )}
    >
      {Icon ? (
        <div
          className={cn(
            'flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg',
            styles.icon
          )}
        >
          <Icon className="h-5 w-5" />
        </div>
      ) : null}
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs font-medium uppercase tracking-wide text-slate-500">
          {label}
        </p>
        <p className="mt-0.5 text-xl font-bold text-slate-950">{value}</p>
        {hint ? <p className="mt-0.5 truncate text-xs text-slate-500">{hint}</p> : null}
      </div>
      {trailing ? <div className="flex-shrink-0">{trailing}</div> : null}
    </div>
  );

  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        className="text-left w-full"
        aria-pressed={active}
      >
        {inner}
      </button>
    );
  }
  return inner;
}
