import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { BAStatus, User, UserRole } from '@prisma/client';
import { getRangeCapacity } from '../domain/capacity';
import { parseDateOnly, toDateKey } from '../domain/date';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class CapacityService {
  constructor(private readonly prisma: PrismaService) {}

  async summary(currentUser: User, start = '2026-06-01', end = '2026-06-30') {
    const startDate = parseDateOnly(start);
    const endDate = parseDateOnly(end);
    const bas = await this.prisma.bAProfile.findMany({
      where: currentUser.role === UserRole.PM_PO ? { status: BAStatus.ACTIVE } : {},
      include: {
        bookings: {
          where: {
            start_date: { lte: endDate },
            end_date: { gte: startDate }
          }
        }
      }
    });

    const items = bas.map((ba) => {
      const capacity = getRangeCapacity(ba.bookings, startDate, endDate);
      return {
        ba_id: ba.id,
        full_name: ba.full_name,
        status: ba.status,
        approved_capacity: capacity.max_approved_capacity,
        pending_capacity: capacity.max_pending_capacity,
        risk_capacity: capacity.max_risk_capacity,
        has_overbook_risk: capacity.has_overbook_risk
      };
    });
    const average = items.length
      ? items.reduce((sum, item) => sum + item.approved_capacity, 0) / items.length
      : 0;

    return {
      start_date: toDateKey(startDate),
      end_date: toDateKey(endDate),
      average_capacity: Number(average.toFixed(1)),
      counts: {
        free: items.filter((item) => item.approved_capacity < 40).length,
        working: items.filter(
          (item) => item.approved_capacity >= 40 && item.approved_capacity < 80
        ).length,
        near_full: items.filter(
          (item) => item.approved_capacity >= 80 && item.approved_capacity <= 100
        ).length,
        overbook: items.filter((item) => item.risk_capacity > 100).length
      },
      items
    };
  }

  async baCapacity(currentUser: User, baId: string, start = '2026-06-01', end = '2026-06-30') {
    const ba = await this.prisma.bAProfile.findUnique({ where: { id: baId } });
    if (!ba) {
      throw new BadRequestException('BA not found');
    }

    if (currentUser.role === UserRole.PM_PO && ba.status !== BAStatus.ACTIVE) {
      throw new ForbiddenException('PM/PO can only inspect active BA capacity');
    }

    const startDate = parseDateOnly(start);
    const endDate = parseDateOnly(end);
    const bookings = await this.prisma.booking.findMany({
      where: {
        ba_id: baId,
        start_date: { lte: endDate },
        end_date: { gte: startDate }
      }
    });

    return {
      ba_id: baId,
      ...getRangeCapacity(bookings, startDate, endDate)
    };
  }

  async rangeCheck(query: Record<string, string | undefined>) {
    const baId = query.ba_id;
    if (!baId) {
      throw new BadRequestException('ba_id is required');
    }

    const startDate = parseDateOnly(query.start_date ?? '');
    const endDate = parseDateOnly(query.end_date ?? '');
    const requestedCapacity = Number(query.capacity_percent ?? 0);
    const bookings = await this.prisma.booking.findMany({
      where: {
        ba_id: baId,
        start_date: { lte: endDate },
        end_date: { gte: startDate }
      }
    });
    const capacity = getRangeCapacity(bookings, startDate, endDate);
    const riskDays = capacity.daily.map((day) => ({
      ...day,
      requested_capacity: requestedCapacity,
      risk_after_request: day.risk_capacity + requestedCapacity
    }));

    return {
      ...capacity,
      requested_capacity: requestedCapacity,
      has_overbook_risk_after_request: riskDays.some((day) => day.risk_after_request > 100),
      daily: riskDays
    };
  }
}
