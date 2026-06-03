import type { UserRole } from '@/lib/api';

export function roleHomePath(role: UserRole) {
  switch (role) {
    case 'BA':
      return '/my-schedule';
    case 'PM_PO':
      return '/timeline';
    default:
      return '/';
  }
}
