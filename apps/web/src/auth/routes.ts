import type { UserRole } from '@/lib/api';

const roleHomePaths: Record<UserRole, string> = {
  ADMIN: '/dashboard',
  BA: '/dashboard',
  BA_MANAGER: '/dashboard',
  PM_PO: '/dashboard'
};

export function roleHomePath(role: UserRole) {
  return roleHomePaths[role];
}
