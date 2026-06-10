import type { LucideIcon } from 'lucide-react';
import { Inbox } from 'lucide-react';
import type { ReactNode } from 'react';
import { Card, CardContent } from './ui/card';
import { Button } from './ui/button';
import { cn } from '@/lib/utils';

type EmptyStateProps = {
  /** Big title, e.g. "No BAs match your filters". */
  title: string;
  /** Optional supporting copy. */
  description?: string;
  /** Optional icon. Defaults to the Inbox icon. */
  icon?: LucideIcon;
  /** Optional CTA. */
  action?: { label: string; onClick: () => void };
  className?: string;
};

/**
 * EmptyState — the standard "no data" affordance. Use for empty lists,
 * empty search results, and zero-state pages.
 */
export function EmptyState({
  title,
  description,
  icon: Icon = Inbox,
  action,
  className
}: EmptyStateProps) {
  return (
    <Card className={cn('border-dashed bg-slate-50/50', className)}>
      <CardContent className="flex flex-col items-center justify-center gap-3 p-10 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-slate-100 text-slate-400">
          <Icon className="h-6 w-6" />
        </div>
        <div>
          <p className="text-sm font-semibold text-slate-950">{title}</p>
          {description ? (
            <p className="mt-1 max-w-md text-sm text-slate-500">{description}</p>
          ) : null}
        </div>
        {action ? <Button onClick={action.onClick}>{action.label}</Button> : null}
      </CardContent>
    </Card>
  );
}

type ErrorStateProps = {
  title?: string;
  description?: string;
  /** Show a retry button. If omitted, no button is shown. */
  onRetry?: () => void;
  /** Optional raw error to display (typically for dev). */
  error?: unknown;
  className?: string;
};

/**
 * ErrorState — the standard "something went wrong" affordance. Pairs with
 * EmptyState visually but uses the rose palette.
 */
export function ErrorState({
  title = 'Something went wrong',
  description = 'We could not load the data. Check your connection and try again.',
  onRetry,
  error,
  className
}: ErrorStateProps) {
  const errorMessage =
    error instanceof Error ? error.message : typeof error === 'string' ? error : null;
  return (
    <Card className={cn('border-rose-200 bg-rose-50/40', className)}>
      <CardContent className="flex flex-col items-center justify-center gap-3 p-10 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-rose-100 text-rose-700">
          <span className="text-xl font-bold">!</span>
        </div>
        <div>
          <p className="text-sm font-semibold text-rose-900">{title}</p>
          <p className="mt-1 max-w-md text-sm text-rose-700">{description}</p>
          {errorMessage ? (
            <p className="mt-2 font-mono text-xs text-rose-600/80">{errorMessage}</p>
          ) : null}
        </div>
        {onRetry ? (
          <Button variant="secondary" onClick={onRetry}>
            Try again
          </Button>
        ) : null}
      </CardContent>
    </Card>
  );
}

// Re-export LoadingScreen so callers can do `import { LoadingScreen, EmptyState, ErrorState } from '@/components'`.
export { LoadingScreen } from './ui/loading-screen';

// Suppress unused warning for ReactNode in some builds.
export type { ReactNode };
