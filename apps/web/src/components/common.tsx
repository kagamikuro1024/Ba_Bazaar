import type { BAProfile, BookingStatus } from '@/lib/api';
import { Badge } from './ui/badge';
import { statusTone } from '@/lib/format';
import { cn } from '@/lib/utils';
import { AlertTriangle } from 'lucide-react';

export function Avatar({ name, url }: { name: string; url?: string | null }) {
  if (url) {
    return <img src={url} alt="" className="h-9 w-9 rounded-full bg-slate-100" />;
  }

  return (
    <div className="flex h-9 w-9 items-center justify-center rounded-full bg-blue-100 text-sm font-bold text-blue-700">
      {name
        .split(' ')
        .map((part) => part[0])
        .slice(0, 2)
        .join('')}
    </div>
  );
}

export function BAIdentity({
  ba,
  showConflictIcon = false
}: {
  ba: BAProfile | null;
  showConflictIcon?: boolean;
}) {
  if (!ba) {
    return (
      <div className="flex min-w-0 items-center gap-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-full bg-slate-100 text-sm font-bold text-slate-400">
          ?
        </div>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-slate-500 italic">Auto assign</p>
          <p className="text-xs text-slate-400">Assignment pending</p>
        </div>
      </div>
    );
  }
  return (
    <div className="flex min-w-0 items-center gap-3">
      <Avatar name={ba.full_name} url={ba.avatar_url} />
      <div className="min-w-0">
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="truncate text-sm font-semibold text-slate-950">{ba.full_name}</span>
          {showConflictIcon ? (
            <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-rose-600" />
          ) : null}
          {ba.status === 'ON_LEAVE' && (
            <span className="shrink-0 inline-flex items-center rounded bg-amber-50 px-1 py-0.5 text-[9px] font-medium text-amber-800 ring-1 ring-inset ring-amber-600/20">
              ON LEAVE
            </span>
          )}
        </div>

        <p className="text-xs text-slate-500">{ba.level}</p>
      </div>
    </div>
  );
}

export function StatusBadge({ status }: { status: BookingStatus | BAProfile['status'] }) {
  return <Badge tone={statusTone(status)}>{status.replaceAll('_', ' ')}</Badge>;
}

// Back-compat alias — prefer importing StatusBadge from '@/components'.
export const LegacyStatusBadge = StatusBadge;

export function Field({
  label,
  children,
  className
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <label className={cn('grid gap-1 text-sm', className)}>
      <span className="font-medium text-slate-700">{label}</span>
      {children}
    </label>
  );
}
