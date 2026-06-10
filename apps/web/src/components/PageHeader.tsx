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
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div className="min-w-0">
          {eyebrow ? (
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              {eyebrow}
            </p>
          ) : null}
          <h1 className="mt-1 text-2xl font-bold tracking-tight text-slate-950 sm:text-3xl">
            {title}
          </h1>
          {description ? (
            <p className="mt-1 max-w-2xl text-sm text-slate-600">{description}</p>
          ) : null}
        </div>
        {actions ? (
          <div className="flex flex-wrap items-center gap-2">{actions}</div>
        ) : null}
      </div>
      {meta ? <div className="flex flex-wrap items-center gap-2">{meta}</div> : null}
    </header>
  );
}
