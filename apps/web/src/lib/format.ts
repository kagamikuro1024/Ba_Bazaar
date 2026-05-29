import { format, parseISO } from 'date-fns';
import type { BAStatus, BookingPriority, BookingStatus } from './api';

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
    case 'HIGH':
      return 'danger';
    case 'MEDIUM':
      return 'warning';
    default:
      return 'success';
  }
}

export function capacityColor(percent: number) {
  if (percent > 100) return 'text-rose-600';
  if (percent >= 80) return 'text-orange-600';
  if (percent >= 40) return 'text-amber-600';
  return 'text-emerald-600';
}
