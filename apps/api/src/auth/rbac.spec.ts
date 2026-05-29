import { describe, expect, it } from 'vitest';
import { UserRole } from '@prisma/client';
import {
  canApproveBooking,
  canCreateBookingRequest,
  canCreateDirectBooking,
  canReadPrivateNotes
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
});
