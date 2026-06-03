import { UserRole } from '@prisma/client';

export function isManagerRole(role: UserRole) {
  return role === UserRole.BA_MANAGER || role === UserRole.ADMIN;
}

export function canCreateBookingRequest(role: UserRole) {
  return role === UserRole.PM_PO || isManagerRole(role);
}

export function canCreateDirectBooking(role: UserRole) {
  return isManagerRole(role);
}

export function canApproveBooking(role: UserRole) {
  return isManagerRole(role);
}

export function canAssignBooking(role: UserRole) {
  return isManagerRole(role);
}

export function canManageBaProfile(role: UserRole) {
  return isManagerRole(role);
}

export function canReadPrivateNotes(role: UserRole) {
  return isManagerRole(role);
}

export function canExportReports(role: UserRole) {
  return isManagerRole(role);
}
