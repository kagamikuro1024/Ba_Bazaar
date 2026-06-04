import { UserRole } from '@prisma/client';

export function isManagerRole(role: UserRole) {
  return role === UserRole.BA_MANAGER;
}

export function isAdminSupportRole(role: UserRole) {
  return role === UserRole.ADMIN;
}

export function canViewManagerWorkspace(role: UserRole) {
  return isManagerRole(role) || isAdminSupportRole(role);
}

export function canCreateBookingRequest(role: UserRole) {
  return role === UserRole.PM_PO || role === UserRole.BA_MANAGER;
}

export function canCreateDirectBooking(role: UserRole) {
  return role === UserRole.BA_MANAGER;
}

export function canApproveBooking(role: UserRole) {
  return role === UserRole.BA_MANAGER;
}

export function canAssignBooking(role: UserRole) {
  return role === UserRole.BA_MANAGER;
}

export function canManageBaProfile(role: UserRole) {
  return role === UserRole.BA_MANAGER;
}

export function canViewPrivateBaFields(role: UserRole) {
  return isManagerRole(role) || isAdminSupportRole(role);
}

export function canReadPrivateNotes(role: UserRole) {
  return isManagerRole(role) || isAdminSupportRole(role);
}

export function canExportReports(role: UserRole) {
  return isManagerRole(role) || isAdminSupportRole(role);
}

export function canRunReminderJobs(role: UserRole) {
  return role === UserRole.BA_MANAGER;
}
