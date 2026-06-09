import { format, parseISO } from 'date-fns';
import type {
  BAStatus,
  BookingPriority,
  BookingStatus,
  CapacityClassification
} from './api';

export function formatDate(value: string) {
  return format(parseISO(value), 'dd/MM/yyyy');
}

export function formatShortDate(value: string) {
  return format(parseISO(value), 'dd/MM');
}

export function statusTone(status: BookingStatus | BAStatus) {
  switch (status) {
    case 'APPROVED':
    case 'IN_PROGRESS':
    case 'ACTIVE':
    case 'COMPLETED':
      return 'success';
    case 'PENDING':
    case 'ON_LEAVE':
      return 'warning';
    case 'REJECTED':
      return 'neutral';
    case 'RESIGNED':
    case 'CANCELLED':
      return 'danger';
    default:
      return 'neutral';
  }
}

export function priorityTone(priority: BookingPriority) {
  switch (priority) {
    case 'URGENT':
      return 'danger';
    case 'HIGH':
      return 'warning';
    case 'MEDIUM':
      return 'info';
    default:
      return 'neutral';
  }
}

export function capacityColor(percent: number) {
  if (percent > 100) return 'text-rose-700';
  if (percent === 100) return 'text-indigo-700';
  if (percent >= 75) return 'text-amber-700';
  if (percent >= 50) return 'text-emerald-700';
  if (percent > 0) return 'text-sky-700';
  return 'text-slate-500';
}

export function classifyCapacityLabel(percent: number): CapacityClassification {
  if (percent <= 0) return 'BENCH';
  if (percent < 50) return 'LOW';
  if (percent < 75) return 'AVAILABLE';
  if (percent < 100) return 'HIGH';
  if (percent === 100) return 'FULL';
  return 'OVERBOOKED';
}

export function capacityLabelText(label: CapacityClassification) {
  switch (label) {
    case 'BENCH':
      return 'Bench';
    case 'LOW':
      return 'Low utilization';
    case 'AVAILABLE':
      return 'Available';
    case 'HIGH':
      return 'High utilization';
    case 'FULL':
      return 'Full';
    case 'OVERBOOKED':
      return 'Overbooked';
    default:
      return label;
  }
}

export function capacityBadgeTone(
  label: CapacityClassification
): 'success' | 'warning' | 'danger' | 'info' | 'neutral' {
  switch (label) {
    case 'OVERBOOKED':
      return 'danger';
    case 'FULL':
      return 'info';
    case 'HIGH':
      return 'warning';
    case 'AVAILABLE':
      return 'success';
    case 'LOW':
      return 'info';
    case 'BENCH':
    default:
      return 'neutral';
  }
}
