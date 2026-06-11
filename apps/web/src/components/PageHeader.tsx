import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

type PageHeaderProps = {
  /** Page-level eyebrow (e.g. "Directory", "Insights"). */
  eyebrow?: string;
  /** Bold page title. */
  title: string;
  /** Optional one-line description under the title. */
  description?: string;
  /** Right-side action area: typically buttons, page-level filters. */
  actions?: ReactNode;
  /** Optional secondary row of content (tabs, breadcrumbs, sub-filters). */
  meta?: ReactNode;
  className?: string;
};

/**
 * PageHeader — the canonical top of every primary page.
 *
 * Usage:
 *   <PageHeader
 *     eyebrow="Directory"
 *     title="BA Directory"
 *     description="Browse and assign BAs across active projects."
 *     actions={<Button>Create BA</Button>}
 *     meta={<QuickTabs ... />}
 *   />
 */
export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
  meta,
  className
}: PageHeaderProps) {
  return (
    <header className={cn('grid gap-3', className)}>
      <div className="grid gap-3 lg:flex lg:items-end lg:justify-between">
        <div className="min-w-0">
          {eyebrow ? (
            <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-slate-500 sm:text-xs">
              {eyebrow}
            </p>
          ) : null}
          <h1 className="mt-1 text-[1.65rem] font-bold leading-tight tracking-tight text-slate-950 sm:text-3xl">
            {title}
          </h1>
          {description ? (
            <p className="mt-1 hidden max-w-2xl text-sm leading-6 text-slate-600 sm:block">{description}</p>
          ) : null}
        </div>
        {actions ? (
          <div className="flex max-w-full items-center gap-2 overflow-x-auto pb-1 lg:flex-wrap lg:justify-end lg:overflow-visible lg:pb-0">
            {actions}
          </div>
        ) : null}
      </div>
      {meta ? (
        <div className="flex max-w-full items-center gap-2 overflow-x-auto pb-1 lg:flex-wrap lg:overflow-visible lg:pb-0">
          {meta}
        </div>
      ) : null}
    </header>
  );
}
