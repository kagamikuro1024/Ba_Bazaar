import type { ReactNode } from 'react';
import { Card, CardContent } from './ui/card';
import { cn } from '@/lib/utils';

type FilterCardProps = {
  children: ReactNode;
  /** Optional secondary body content (e.g. an advanced filter popover). */
  className?: string;
  /** Removes the default CardContent padding. */
  flush?: boolean;
};

/**
 * FilterCard — a thin Card that wraps toolbars/filters with consistent
 * padding. Use it as the host for DataToolbar, QuickTabs, and inline
 * filter selects.
 */
export function FilterCard({ children, className, flush = false }: FilterCardProps) {
  return (
    <Card className={cn('border-slate-200', className)}>
      <CardContent className={cn(flush ? 'p-3' : 'p-4')}>{children}</CardContent>
    </Card>
  );
}
