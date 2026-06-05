import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException
} from '@nestjs/common';
import { BAStatus, BookingPriority, BookingStatus, Prisma, User, UserRole } from '@prisma/client';
import { canApproveCapacity, getRangeCapacity } from '../domain/capacity';
import {
  optionalString,
  requireCapacityPercent,
  requireDate,
  requireString
} from '../common/parse';
import { canApproveBooking, canAssignBooking, canCreateBookingRequest, canCreateDirectBooking } from '../auth/rbac';
import { PrismaService } from '../prisma/prisma.service';

type BookingInput = {
  ba_id?: string;
  project_id?: string;
  project_name?: string;
  title?: string;
  description?: string;
  notes?: string;
  start_date?: string;
  end_date?: string;
  capacity_percent?: number;
  priority?: BookingPriority;
  manager_comment?: string;
};

const safeUserSelect = {
  id: true,
  full_name: true,
  email: true,
  role: true,
  avatar_url: true,
  created_at: true,
  updated_at: true
} as const;

@Injectable()
export class BookingsService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async list(currentUser: User, query: Record<string, string | undefined>) {
    const where = {
      ...(currentUser.role === UserRole.BA ? { ba: { user_id: currentUser.id } } : {}),
      ...(query.ba_id ? { ba_id: query.ba_id } : {}),
      ...(query.project_id ? { project_id: query.project_id } : {}),
      ...(query.status ? { status: query.status as BookingStatus } : {})
    };

    return this.prisma.booking.findMany({
      where,
      include: this.includeRelations(),
      orderBy: [{ start_date: 'asc' }, { created_at: 'asc' }]
    });
  }

  async getById(currentUser: User, id: string) {
    const booking = await this.prisma.booking.findUnique({
      where: { id },
      include: this.includeRelations()
    });

    if (!booking) {
      throw new NotFoundException('Booking not found');
    }

    this.ensureCanRead(currentUser, booking);
    return booking;
  }

  async createRequest(currentUser: User, input: BookingInput) {
    if (!canCreateBookingRequest(currentUser.role)) {
      await this.auditDenied(
        currentUser,
        'CREATE_BOOKING_REQUEST',
        'Permission',
        currentUser.id
      );
      throw new ForbiddenException('PM/PO or Manager role required to create request');
    }

    const normalized = await this.normalizeBookingInput(input);
    const warning = await this.getSubmitWarning(
      normalized.ba_id,
      normalized.start_date,
      normalized.end_date,
      normalized.capacity_percent
    );

    const booking = await this.prisma.booking.create({
      data: {
        ba_id: normalized.ba_id,
        project_id: normalized.project_id,
        title: normalized.title,
        description: normalized.description,
        notes: normalized.notes,
        start_date: normalized.start_date,
        end_date: normalized.end_date,
        capacity_percent: normalized.capacity_percent,
        priority: normalized.priority,
        requester_id: currentUser.id,
        status: BookingStatus.PENDING
      },
      include: this.includeRelations()
    });

    await this.audit(currentUser, 'CREATE_BOOKING_REQUEST', 'Booking', booking.id, null, booking);
    if (normalized.ba_id) {
      await this.notifyManagers('BOOKING_REQUEST_CREATED', 'New booking request', booking);
    } else {
      await this.notifyManagers(
        'BOOKING_NEEDS_ASSIGNMENT',
        'Booking needs BA assignment',
        booking
      );
    }

    return {
      booking,
      warning
    };
  }

  async createDirect(currentUser: User, input: BookingInput) {
    if (!canCreateDirectBooking(currentUser.role)) {
      await this.auditDenied(currentUser, 'CREATE_DIRECT_BOOKING', 'Permission', currentUser.id);
      throw new ForbiddenException('Manager role required to create direct booking');
    }

    const normalized = await this.normalizeBookingInput(input);
    if (!normalized.ba_id) {
      throw new BadRequestException('BA is required for direct bookings');
    }
    
    const existing = await this.getBaBookings(normalized.ba_id);
    const approval = canApproveCapacity(
      existing,
      normalized.start_date,
      normalized.end_date,
      normalized.capacity_percent
    );

    if (!approval.allowed) {
      throw new BadRequestException(
        `Cannot approve booking because capacity exceeds 100% on ${approval.blocking_day}`
      );
    }

    const booking = await this.prisma.booking.create({
      data: {
        ...normalized,
        ba_id: normalized.ba_id,
        requester_id: currentUser.id,
        manager_id: currentUser.id,
        status: BookingStatus.APPROVED,
        approved_at: new Date(),
        manager_comment: optionalString(input.manager_comment)
      },
      include: this.includeRelations()
    });

    await this.audit(currentUser, 'CREATE_DIRECT_BOOKING', 'Booking', booking.id, null, booking);
    await this.notifyAssignedBA(booking, 'BOOKING_APPROVED', 'Booking assigned');
    return booking;
  }

  async update(currentUser: User, id: string, input: BookingInput) {
    const booking = await this.getById(currentUser, id);
    const manager = canApproveBooking(currentUser.role);
    const requesterOwns = booking.requester_id === currentUser.id;
    const requesterCanProposeChanges =
      requesterOwns &&
      currentUser.role === UserRole.PM_PO &&
      booking.status !== BookingStatus.COMPLETED &&
      booking.status !== BookingStatus.CANCELLED;

    if (!manager && !requesterCanProposeChanges) {
      await this.auditDenied(currentUser, 'UPDATE_BOOKING', 'Booking', id);
      throw new ForbiddenException(
        'Only Manager/Admin or requester can propose changes for non-completed, non-cancelled bookings'
      );
    }

    const data = {
      title: input.title,
      description: input.description,
      notes: input.notes,
      project_id: input.project_id ? requireString(input.project_id, 'project_id') : undefined,
      start_date: input.start_date ? requireDate(input.start_date, 'start_date') : undefined,
      end_date: input.end_date ? requireDate(input.end_date, 'end_date') : undefined,
      capacity_percent:
        input.capacity_percent !== undefined
          ? requireCapacityPercent(input.capacity_percent)
          : undefined,
      priority: input.priority
    };

    if (data.start_date && data.end_date && data.end_date < data.start_date) {
      throw new BadRequestException('end_date must be greater than or equal to start_date');
    }

    const nextStartDate = data.start_date ?? booking.start_date;
    const nextEndDate = data.end_date ?? booking.end_date;
    const nextCapacity = data.capacity_percent ?? booking.capacity_percent;

    if ((manager && isOfficialBooking(booking.status)) || requesterCanProposeChanges) {
      const existing = await this.getBaBookings(booking.ba_id);
      const approval = canApproveCapacity(
        existing,
        nextStartDate,
        nextEndDate,
        nextCapacity,
        booking.id
      );

      if (!approval.allowed) {
        throw new BadRequestException(
          `Cannot update booking because capacity exceeds 100% on ${approval.blocking_day}`
        );
      }
    }

    if (requesterCanProposeChanges) {
      const pendingChanges = Object.fromEntries(
        Object.entries(data).filter(([, value]) => value !== undefined)
      );

      const updated = await this.prisma.booking.update({
        where: { id },
        data: {
          pending_changes: pendingChanges,
          status: BookingStatus.PENDING
        },
        include: this.includeRelations()
      });

      await this.audit(currentUser, 'UPDATE_BOOKING', 'Booking', id, booking, updated);
      await this.notifyManagers(
        'BOOKING_CHANGES_PROPOSED',
        'Booking changes proposed',
        updated
      );
      return updated;
    }

    const updated = await this.prisma.booking.update({
      where: { id },
      data,
      include: this.includeRelations()
    });

    await this.audit(currentUser, 'UPDATE_BOOKING', 'Booking', id, booking, updated);
    return updated;
  }

  async assign(currentUser: User, id: string, input: BookingInput) {
    if (!canAssignBooking(currentUser.role)) {
      await this.auditDenied(currentUser, 'ASSIGN_BOOKING_BA', 'Booking', id);
      throw new ForbiddenException('Manager role required to assign booking');
    }

    const baId = requireString(input.ba_id, 'ba_id');
    const ba = await this.prisma.bAProfile.findUnique({ where: { id: baId } });
    if (!ba || ba.status !== BAStatus.ACTIVE) {
      throw new BadRequestException('Only active BA can be assigned');
    }

    const booking = await this.getExisting(id);
    const existing = await this.getBaBookings(baId);
    const approval = canApproveCapacity(
      existing,
      booking.start_date,
      booking.end_date,
      booking.capacity_percent,
      booking.id
    );

    if (!approval.allowed) {
      throw new BadRequestException(
        `Cannot assign BA because capacity exceeds 100% on ${approval.blocking_day}`
      );
    }

    const updated = await this.prisma.booking.update({
      where: { id },
      data: { ba_id: baId, manager_id: currentUser.id },
      include: this.includeRelations()
    });

    await this.audit(currentUser, 'ASSIGN_BOOKING_BA', 'Booking', id, booking, updated);
    await this.notifyRequester(updated, 'BOOKING_ASSIGNED', 'BA assigned', `Assigned BA: ${ba.full_name}`);
    await this.notifyAssignedBA(updated, 'BOOKING_ASSIGNED', 'Booking assigned');
    return updated;
  }

  async approve(currentUser: User, id: string) {
    if (!canApproveBooking(currentUser.role)) {
      await this.auditDenied(currentUser, 'APPROVE_BOOKING', 'Booking', id);
      throw new ForbiddenException('Manager role required to approve booking');
    }

    const booking = await this.getExisting(id);
    const existing = await this.getBaBookings(booking.ba_id);
    const approval = canApproveCapacity(
      existing,
      booking.start_date,
      booking.end_date,
      booking.capacity_percent,
      booking.id
    );

    if (!approval.allowed) {
      throw new BadRequestException(
        `Cannot approve booking because capacity exceeds 100% on ${approval.blocking_day}`
      );
    }

    const updated = await this.prisma.booking.update({
      where: { id },
      data: {
        status: BookingStatus.APPROVED,
        manager_id: currentUser.id,
        approved_at: new Date(),
        reject_reason: null,
        rejected_at: null
      },
      include: this.includeRelations()
    });

    await this.audit(currentUser, 'APPROVE_BOOKING', 'Booking', id, booking, updated);
    await this.notifyRequester(updated, 'BOOKING_APPROVED', 'Booking approved');
    await this.notifyAssignedBA(updated, 'BOOKING_APPROVED', 'Booking approved');
    return updated;
  }

  async approveChanges(currentUser: User, id: string, input: BookingInput = {}) {
    if (!canApproveBooking(currentUser.role)) {
      await this.auditDenied(currentUser, 'APPROVE_BOOKING_CHANGES', 'Booking', id);
      throw new ForbiddenException('Manager role required to approve booking changes');
    }

    const booking = await this.prisma.booking.findUnique({
      where: { id },
      include: this.includeRelations()
    });
    if (!booking) throw new NotFoundException('Booking not found');

    const pendingChanges = this.getPendingChangesObject(booking.pending_changes);
    if (!pendingChanges || Object.keys(pendingChanges).length === 0) {
      throw new BadRequestException('No pending changes to approve');
    }

    const effectiveChanges = this.normalizePartialBookingInput({
      ...pendingChanges,
      ...this.getDefinedEntries(input)
    });

    if (effectiveChanges.ba_id) {
      const ba = await this.prisma.bAProfile.findUnique({ where: { id: effectiveChanges.ba_id } });
      if (!ba || ba.status !== BAStatus.ACTIVE) {
        throw new BadRequestException('Only active BA can be booked');
      }
    }

    const nextBaId = effectiveChanges.ba_id ?? booking.ba_id;
    const nextStartDate = effectiveChanges.start_date ?? booking.start_date;
    const nextEndDate = effectiveChanges.end_date ?? booking.end_date;
    const nextCapacity = effectiveChanges.capacity_percent ?? booking.capacity_percent;

    if (nextEndDate < nextStartDate) {
      throw new BadRequestException('end_date must be greater than or equal to start_date');
    }

    if (nextBaId) {
      const existing = await this.getBaBookings(nextBaId);
      const approval = canApproveCapacity(existing, nextStartDate, nextEndDate, nextCapacity, booking.id);
      if (!approval.allowed) {
        throw new BadRequestException(
          `Cannot approve booking changes because capacity exceeds 100% on ${approval.blocking_day}`
        );
      }
    }

    const updated = await this.prisma.booking.update({
      where: { id },
      data: {
        ...effectiveChanges,
        pending_changes: Prisma.DbNull,
        ...(booking.status === BookingStatus.PENDING
          ? {
              status: BookingStatus.APPROVED,
              manager_id: currentUser.id,
              approved_at: new Date(),
              reject_reason: null,
              rejected_at: null
            }
          : {})
      },
      include: this.includeRelations()
    });

    await this.audit(currentUser, 'APPROVE_BOOKING_CHANGES', 'Booking', id, booking, updated);
    await this.notifyRequester(updated, 'BOOKING_CHANGES_APPROVED', 'Booking changes approved');
    await this.notifyAssignedBA(updated, 'BOOKING_CHANGES_APPROVED', 'Booking changes approved');
    return updated;
  }

  async reject(currentUser: User, id: string, reason?: string) {
    if (!canApproveBooking(currentUser.role)) {
      await this.auditDenied(currentUser, 'REJECT_BOOKING', 'Booking', id);
      throw new ForbiddenException('Manager role required to reject booking');
    }

    const rejectReason = requireString(reason, 'reject_reason');
    const booking = await this.getExisting(id);
    const updated = await this.prisma.booking.update({
      where: { id },
      data: {
        status: BookingStatus.REJECTED,
        manager_id: currentUser.id,
        reject_reason: rejectReason,
        rejected_at: new Date()
      },
      include: this.includeRelations()
    });

    await this.audit(currentUser, 'REJECT_BOOKING', 'Booking', id, booking, {
      id,
      reject_reason: rejectReason
    });
    await this.notifyRequester(
      updated,
      'BOOKING_REJECTED',
      'Booking rejected',
      `Reason: ${rejectReason}`
    );
    return updated;
  }

  async rejectChanges(currentUser: User, id: string, reason?: string) {
    if (!canApproveBooking(currentUser.role)) {
      await this.auditDenied(currentUser, 'REJECT_BOOKING_CHANGES', 'Booking', id);
      throw new ForbiddenException('Manager role required to reject booking changes');
    }

    const booking = await this.prisma.booking.findUnique({
      where: { id },
      include: this.includeRelations()
    });
    if (!booking) throw new NotFoundException('Booking not found');

    const pendingChanges = this.getPendingChangesObject(booking.pending_changes);
    if (!pendingChanges || Object.keys(pendingChanges).length === 0) {
      throw new BadRequestException('No pending changes to reject');
    }

    const rejectReason = optionalString(reason);
    const updated = await this.prisma.booking.update({
      where: { id },
      data: { pending_changes: Prisma.DbNull },
      include: this.includeRelations()
    });

    await this.audit(currentUser, 'REJECT_BOOKING_CHANGES', 'Booking', id, booking, {
      id,
      pending_changes: null,
      reject_reason: rejectReason
    });
    await this.notifyRequester(
      updated,
      'BOOKING_CHANGES_REJECTED',
      'Booking changes rejected',
      rejectReason ? `Reason: ${rejectReason}` : undefined
    );
    return updated;
  }

  async approveFields(
    currentUser: User,
    id: string,
    fields: string[],
    overrides?: Record<string, unknown>
  ) {
    if (!canApproveBooking(currentUser.role)) {
      await this.auditDenied(currentUser, 'APPROVE_BOOKING_CHANGES_PARTIAL', 'Booking', id);
      throw new ForbiddenException('Manager role required to approve booking changes');
    }

    const booking = await this.prisma.booking.findUnique({
      where: { id },
      include: this.includeRelations()
    });
    if (!booking) throw new NotFoundException('Booking not found');

    const pendingChanges = this.getPendingChangesObject(booking.pending_changes);
    if (!pendingChanges || Object.keys(pendingChanges).length === 0) {
      throw new BadRequestException('No pending changes to approve');
    }

    if (!fields || fields.length === 0) {
      throw new BadRequestException('No fields specified to approve');
    }

    const fieldChanges: Record<string, unknown> = {};
    for (const field of fields) {
      if (!(field in pendingChanges)) {
        throw new BadRequestException(`Field "${field}" is not in pending changes`);
      }
      fieldChanges[field] = overrides?.[field] ?? pendingChanges[field];
    }

    const effectiveChanges = this.normalizePartialBookingInput(fieldChanges);

    if (effectiveChanges.ba_id) {
      const ba = await this.prisma.bAProfile.findUnique({ where: { id: effectiveChanges.ba_id } });
      if (!ba || ba.status !== BAStatus.ACTIVE) {
        throw new BadRequestException('Only active BA can be booked');
      }
    }

    const nextBaId = effectiveChanges.ba_id ?? booking.ba_id;
    const nextStartDate = effectiveChanges.start_date ?? booking.start_date;
    const nextEndDate = effectiveChanges.end_date ?? booking.end_date;
    const nextCapacity = effectiveChanges.capacity_percent ?? booking.capacity_percent;

    if (nextEndDate < nextStartDate) {
      throw new BadRequestException('end_date must be greater than or equal to start_date');
    }

    if (nextBaId) {
      const existing = await this.getBaBookings(nextBaId);
      const approval = canApproveCapacity(existing, nextStartDate, nextEndDate, nextCapacity, booking.id);
      if (!approval.allowed) {
        throw new BadRequestException(
          `Cannot approve booking field changes because capacity exceeds 100% on ${approval.blocking_day}`
        );
      }
    }

    // Remove approved keys from pending_changes
    const remainingChanges: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(pendingChanges)) {
      if (!fields.includes(key)) {
        remainingChanges[key] = value;
      }
    }

    const updated = await this.prisma.booking.update({
      where: { id },
      data: {
        ...effectiveChanges,
        pending_changes:
          Object.keys(remainingChanges).length === 0
            ? Prisma.DbNull
            : (remainingChanges as Prisma.InputJsonValue),
        ...(booking.status === BookingStatus.PENDING
          ? {
              status: BookingStatus.APPROVED,
              manager_id: currentUser.id,
              approved_at: new Date(),
              reject_reason: null,
              rejected_at: null
            }
          : {})
      },
      include: this.includeRelations()
    });

    await this.audit(currentUser, 'APPROVE_BOOKING_CHANGES_PARTIAL', 'Booking', id, booking, updated);
    await this.notifyRequester(
      updated,
      'BOOKING_CHANGES_PARTIALLY_APPROVED',
      'Booking field changes approved',
      `Approved fields: ${fields.join(', ')}`
    );
    await this.notifyAssignedBA(
      { id: updated.id, title: updated.title, ba: updated.ba },
      'BOOKING_CHANGES_PARTIALLY_APPROVED',
      'Booking field changes approved'
    );
    return updated;
  }

  async rejectFields(currentUser: User, id: string, fields: string[]) {
    if (!canApproveBooking(currentUser.role)) {
      await this.auditDenied(currentUser, 'REJECT_BOOKING_CHANGES_PARTIAL', 'Booking', id);
      throw new ForbiddenException('Manager role required to reject booking changes');
    }

    const booking = await this.prisma.booking.findUnique({
      where: { id },
      include: this.includeRelations()
    });
    if (!booking) throw new NotFoundException('Booking not found');

    const pendingChanges = this.getPendingChangesObject(booking.pending_changes);
    if (!pendingChanges || Object.keys(pendingChanges).length === 0) {
      throw new BadRequestException('No pending changes to reject');
    }

    if (!fields || fields.length === 0) {
      throw new BadRequestException('No fields specified to reject');
    }

    // Remove rejected keys from pending_changes
    const remainingChanges: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(pendingChanges)) {
      if (!fields.includes(key)) {
        remainingChanges[key] = value;
      }
    }

    const updated = await this.prisma.booking.update({
      where: { id },
      data: {
        pending_changes:
          Object.keys(remainingChanges).length === 0
            ? Prisma.DbNull
            : (remainingChanges as Prisma.InputJsonValue)
      },
      include: this.includeRelations()
    });

    await this.audit(currentUser, 'REJECT_BOOKING_CHANGES_PARTIAL', 'Booking', id, booking, updated);
    await this.notifyRequester(
      updated,
      'BOOKING_CHANGES_PARTIALLY_REJECTED',
      'Booking field changes rejected',
      `Rejected fields: ${fields.join(', ')}`
    );
    return updated;
  }

  async cancel(currentUser: User, id: string, reason?: string) {
    const cancelReason = requireString(reason, 'cancel_reason');
    const booking = await this.getById(currentUser, id);

    if (!canApproveBooking(currentUser.role)) {
      await this.auditDenied(currentUser, 'CANCEL_BOOKING', 'Booking', id);
      throw new ForbiddenException('Manager role required to cancel bookings');
    }

    const updated = await this.prisma.booking.update({
      where: { id },
      data: {
        status: BookingStatus.CANCELLED,
        cancel_reason: cancelReason,
        cancelled_at: new Date()
      },
      include: this.includeRelations()
    });

    await this.audit(currentUser, 'CANCEL_BOOKING', 'Booking', id, booking, {
      id,
      cancel_reason: cancelReason
    });
    await this.notifyRequester(
      updated,
      'BOOKING_CANCELLED',
      'Booking cancelled',
      `Reason: ${cancelReason}`
    );
    await this.notifyAssignedBA(
      updated,
      'BOOKING_CANCELLED',
      'Booking cancelled',
      `Reason: ${cancelReason}`
    );
    return updated;
  }

  async myRequests(currentUser: User, status?: BookingStatus) {
    if (currentUser.role !== UserRole.PM_PO && !canApproveBooking(currentUser.role)) {
      throw new ForbiddenException('PM/PO or Manager role required');
    }

    return this.prisma.booking.findMany({
      where: {
        requester_id: currentUser.id,
        ...(status ? { status } : {})
      },
      include: this.includeRelations(),
      orderBy: { created_at: 'desc' }
    });
  }

  async mySchedule(currentUser: User) {
    const ba = await this.prisma.bAProfile.findFirst({ where: { user_id: currentUser.id } });
    if (!ba) {
      if (canApproveBooking(currentUser.role)) {
        return [];
      }
      throw new ForbiddenException('BA profile not found for current user');
    }

    return this.prisma.booking.findMany({
      where: {
        ba_id: ba.id,
        status: { in: [BookingStatus.APPROVED, BookingStatus.IN_PROGRESS, BookingStatus.COMPLETED] }
      },
      include: this.includeRelations(),
      orderBy: { start_date: 'asc' }
    });
  }

  private async normalizeBookingInput(input: BookingInput) {
    const baId = input.ba_id?.trim() || null;
    let ba = null;
    
    if (baId) {
      ba = await this.prisma.bAProfile.findUnique({ where: { id: baId } });
      if (!ba || ba.status !== BAStatus.ACTIVE) {
        throw new BadRequestException('Only active BA can be booked');
      }
    }

    const startDate = requireDate(input.start_date, 'start_date');
    const endDate = requireDate(input.end_date, 'end_date');
    if (endDate < startDate) {
      throw new BadRequestException('end_date must be greater than or equal to start_date');
    }

    const projectId = input.project_id
      ? requireString(input.project_id, 'project_id')
      : await this.findOrCreateProjectId(requireString(input.project_name, 'project_name'));

    return {
      ba_id: baId,
      project_id: projectId,
      title: requireString(input.title, 'title'),
      description: requireString(input.description, 'description'),
      notes: optionalString(input.notes),
      start_date: startDate,
      end_date: endDate,
      capacity_percent: requireCapacityPercent(input.capacity_percent),
      priority: input.priority ?? BookingPriority.MEDIUM
    };
  }

  private async findOrCreateProjectId(projectName: string) {
    const existing = await this.prisma.project.findFirst({
      where: { name: { equals: projectName, mode: 'insensitive' } }
    });

    if (existing) {
      return existing.id;
    }

    const created = await this.prisma.project.create({
      data: {
        name: projectName,
        color: '#2563EB',
        description: 'Created from booking request'
      }
    });

    return created.id;
  }

  private async getSubmitWarning(
    baId: string | null,
    startDate: Date,
    endDate: Date,
    capacityPercent: number
  ) {
    if (!baId) {
      return null;
    }
    
    const existing = await this.getBaBookings(baId);
    const capacity = getRangeCapacity(existing, startDate, endDate);
    const warningDay = capacity.daily.find(
      (day) => day.approved_capacity + day.pending_capacity + capacityPercent > 100
    );

    if (!warningDay) {
      return null;
    }

    return {
      type: 'OVERBOOK_RISK',
      message: 'BA has overbook risk in selected date range.',
      date: warningDay.date,
      approved_capacity: warningDay.approved_capacity,
      pending_capacity: warningDay.pending_capacity,
      requested_capacity: capacityPercent,
      risk_capacity: warningDay.approved_capacity + warningDay.pending_capacity + capacityPercent
    };
  }

  private async getBaBookings(baId: string | null) {
    if (!baId) return [];
    return this.prisma.booking.findMany({ where: { ba_id: baId } });
  }

  private async getExisting(id: string) {
    const booking = await this.prisma.booking.findUnique({ where: { id } });
    if (!booking) {
      throw new NotFoundException('Booking not found');
    }
    return booking;
  }

  private ensureCanRead(
    currentUser: User,
    booking: { requester_id: string; ba?: { user_id: string | null } | null }
  ) {
    if (canApproveBooking(currentUser.role)) {
      return;
    }

    if (booking.requester_id === currentUser.id) {
      return;
    }

    if (currentUser.role === UserRole.BA && booking.ba?.user_id === currentUser.id) {
      return;
    }

    throw new ForbiddenException('Cannot read this booking');
  }

  private includeRelations() {
    return {
      ba: { include: { skill_tags: { include: { tag: true } } } },
      project: true,
      requester: { select: safeUserSelect },
      manager: { select: safeUserSelect }
    } as const;
  }

  private async notifyManagers(type: string, title: string, booking: { id: string; title: string }) {
    const managers = await this.prisma.user.findMany({
      where: { role: UserRole.BA_MANAGER }
    });

    if (managers.length === 0) {
      return;
    }

    await this.prisma.notification.createMany({
      data: managers.map((manager) => ({
        recipient_id: manager.id,
        type,
        title,
        message: booking.title,
        related_entity_type: 'Booking',
        related_entity_id: booking.id
      }))
    });
  }

  private async notifyRequester(
    booking: { id: string; title: string; requester_id: string },
    type: string,
    title: string,
    detail?: string
  ) {
    await this.prisma.notification.create({
      data: {
        recipient_id: booking.requester_id,
        type,
        title,
        message: detail ? `${booking.title}\n${detail}` : booking.title,
        related_entity_type: 'Booking',
        related_entity_id: booking.id
      }
    });
  }

  private async notifyAssignedBA(
    booking: { id: string; title: string; ba: { user_id: string | null } | null },
    type: string,
    title: string,
    detail?: string
  ) {
    if (!booking.ba || !booking.ba.user_id) {
      return;
    }

    await this.prisma.notification.create({
      data: {
        recipient_id: booking.ba.user_id,
        type,
        title,
        message: detail ? `${booking.title}\n${detail}` : booking.title,
        related_entity_type: 'Booking',
        related_entity_id: booking.id
      }
    });
  }

  private async audit(
    user: User,
    action: string,
    targetType: string,
    targetId: string,
    oldValue: unknown,
    newValue: unknown
  ) {
    await this.prisma.auditLog.create({
      data: {
        actor_id: user.id,
        action,
        target_type: targetType,
        target_id: targetId,
        old_value: oldValue === null ? undefined : JSON.parse(JSON.stringify(oldValue)),
        new_value: newValue === null ? undefined : JSON.parse(JSON.stringify(newValue)),
        result: 'SUCCESS'
      }
    });
  }

  private async auditDenied(user: User, action: string, targetType: string, targetId: string) {
    await this.prisma.auditLog
      .create({
        data: {
          actor_id: user.id,
          action,
          target_type: targetType,
          target_id: targetId,
          result: 'DENIED'
        }
      })
      .catch(() => undefined);
  }

  private normalizePartialBookingInput(input: Record<string, unknown>) {
    return {
      ba_id: input.ba_id === undefined ? undefined : requireString(input.ba_id, 'ba_id'),
      project_id: input.project_id === undefined ? undefined : requireString(input.project_id, 'project_id'),
      title: input.title === undefined ? undefined : requireString(input.title, 'title'),
      description: input.description === undefined ? undefined : requireString(input.description, 'description'),
      notes: input.notes === undefined ? undefined : optionalString(input.notes),
      start_date: input.start_date === undefined ? undefined : requireDate(input.start_date, 'start_date'),
      end_date: input.end_date === undefined ? undefined : requireDate(input.end_date, 'end_date'),
      capacity_percent:
        input.capacity_percent === undefined ? undefined : requireCapacityPercent(input.capacity_percent),
      priority: input.priority === undefined ? undefined : (input.priority as BookingPriority),
      manager_comment: input.manager_comment === undefined ? undefined : optionalString(input.manager_comment)
    };
  }

  private getDefinedEntries(input: Record<string, unknown>) {
    return Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined));
  }

  private getPendingChangesObject(value: unknown) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    return value as Record<string, unknown>;
  }
}

function isOfficialBooking(status: BookingStatus) {
  return status === BookingStatus.APPROVED || status === BookingStatus.IN_PROGRESS;
}
