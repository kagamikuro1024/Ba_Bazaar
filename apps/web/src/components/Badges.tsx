import type { LucideIcon } from 'lucide-react';
import { AlertTriangle, CheckCircle2, Clock, MinusCircle, Star, X } from 'lucide-react';
import type { BAStatus, BookingPriority, BookingStatus, CapacityClassification } from '@/lib/api';
import {
  capacityBadgeTone,
  capacityLabelText,
  classifyCapacityLabel,
  priorityTone,
  statusTone
} from '@/lib/format';
import { Badge } from './ui/badge';
import { cn } from '@/lib/utils';

// ---------------------------------------------------------------------------
// PriorityBadge
// ---------------------------------------------------------------------------

type PriorityBadgeProps = {
  priority: BookingPriority;
  className?: string;
};

const priorityIcons: Record<BookingPriority, LucideIcon> = {
  URGENT: AlertTriangle,
  HIGH: Star,
  MEDIUM: Clock,
  LOW: MinusCircle
};

/**
 * PriorityBadge — booking-priority chip with a leading icon. Colors follow
 * the same tones as the rest of the app (URGENT=danger, HIGH=warning, ...).
 */
export function PriorityBadge({ priority, className }: PriorityBadgeProps) {
  const Icon = priorityIcons[priority] ?? Clock;
  return (
    <Badge tone={priorityTone(priority)} className={cn('uppercase', className)}>
      <Icon className="mr-1 h-3 w-3" />
      {priority}
    </Badge>
  );
}

// ---------------------------------------------------------------------------
// StatusBadge (booking + BA status, with proper icons)
// ---------------------------------------------------------------------------

const statusIcons: Record<string, LucideIcon> = {
  APPROVED: CheckCircle2,
  IN_PROGRESS: Clock,
  ACTIVE: CheckCircle2,
  COMPLETED: CheckCircle2,
  PENDING: Clock,
  ON_LEAVE: Clock,
  REJECTED: X,
  RESIGNED: X,
  CANCELLED: X
};

type StatusBadgeProps = {
  status: BookingStatus | BAStatus | string;
  /** Hide the icon (text only). */
  hideIcon?: boolean;
  className?: string;
};

/**
 * StatusBadge — booking or BA status chip. Reuses the existing tone
 * helpers from `format.ts`. Renders with a status-appropriate icon
 * by default; pass `hideIcon` for a clean text chip.
 */
export function StatusBadge({ status, hideIcon = false, className }: StatusBadgeProps) {
  const Icon = statusIcons[status];
  const tone = statusTone(status as BookingStatus | BAStatus);
  const label = String(status).replaceAll('_', ' ');
  return (
    <Badge tone={tone} className={cn('uppercase', className)}>
      {!hideIcon && Icon ? <Icon className="mr-1 h-3 w-3" /> : null}
      {label}
    </Badge>
  );
}

// ---------------------------------------------------------------------------
// CapacityBadge
// ---------------------------------------------------------------------------

type CapacityBadgeProps = {
  /** Either pass a pre-classified label or a percent (0..200+). */
  label?: CapacityClassification;
  percent?: number;
  className?: string;
};

/**
 * CapacityBadge — capacity-classification chip. If you pass a raw
 * `percent`, the badge classifies it using the standard thresholds
 * (BENCH / LOW / AVAILABLE / HIGH / FULL / OVERBOOKED).
 */
export function CapacityBadge({ label, percent, className }: CapacityBadgeProps) {
  const resolved =
    label ?? (typeof percent === 'number' ? classifyCapacityLabel(percent) : undefined);
  if (!resolved) return null;
  return (
    <Badge tone={capacityBadgeTone(resolved)} className={className}>
      {resolved === 'OVERBOOKED' ? <AlertTriangle className="mr-1 h-3 w-3" /> : null}
      {capacityLabelText(resolved)}
      {typeof percent === 'number' ? (
        <span className="ml-1 font-normal opacity-80">· {percent}%</span>
      ) : null}
    </Badge>
  );
}

// ---------------------------------------------------------------------------
// FlagBadge
// ---------------------------------------------------------------------------

type FlagTone = 'success' | 'warning' | 'danger' | 'info' | 'neutral';

type FlagBadgeProps = {
  label: string;
  tone?: FlagTone;
  icon?: LucideIcon;
  className?: string;
};

/**
 * FlagBadge — generic flagged-item chip. Use for "Needs verification",
 * "Open Request", "Unassigned", "Auto assign", or any custom string
 * flag the model or business rules emit.
 */
export function FlagBadge({
  label,
  tone = 'info',
  icon: Icon,
  className
}: FlagBadgeProps) {
  return (
    <Badge tone={tone} className={className}>
      {Icon ? <Icon className="mr-1 h-3 w-3" /> : null}
      {label}
    </Badge>
  );
}
