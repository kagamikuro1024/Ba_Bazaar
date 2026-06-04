import { describe, expect, it } from 'vitest';
import { UserRole } from '@prisma/client';
import {
  canApproveBooking,
  canCreateBookingRequest,
  canCreateDirectBooking,
  canReadPrivateNotes,
  canAssignBooking,
  canExportReports
} from './rbac';

describe('rbac rules', () => {
  it('prevents PM/PO from approving bookings or reading private notes', () => {
    expect(canCreateBookingRequest(UserRole.PM_PO)).toBe(true);
    expect(canApproveBooking(UserRole.PM_PO)).toBe(false);
    expect(canReadPrivateNotes(UserRole.PM_PO)).toBe(false);
  });

  it('allows managers to approve, directly book, and read notes', () => {
    expect(canApproveBooking(UserRole.BA_MANAGER)).toBe(true);
    expect(canCreateDirectBooking(UserRole.BA_MANAGER)).toBe(true);
    expect(canReadPrivateNotes(UserRole.BA_MANAGER)).toBe(true);
  });

  it('prevents BA from creating booking requests', () => {
    expect(canCreateBookingRequest(UserRole.BA)).toBe(false);
  });

  it('allows BA_MANAGER to assign bookings', () => {
    expect(canAssignBooking(UserRole.BA_MANAGER)).toBe(true);
  });

  it('denies PM_PO, BA, and ADMIN from assigning bookings', () => {
    expect(canAssignBooking(UserRole.PM_PO)).toBe(false);
    expect(canAssignBooking(UserRole.BA)).toBe(false);
    expect(canAssignBooking(UserRole.ADMIN)).toBe(false);
  });

  it('allows ADMIN to view support data but not business actions', () => {
    expect(canReadPrivateNotes(UserRole.ADMIN)).toBe(true);
    expect(canExportReports(UserRole.ADMIN)).toBe(true);
    expect(canApproveBooking(UserRole.ADMIN)).toBe(false);
    expect(canCreateDirectBooking(UserRole.ADMIN)).toBe(false);
  });
});
