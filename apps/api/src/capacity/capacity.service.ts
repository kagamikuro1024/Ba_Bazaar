import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable
} from '@nestjs/common';
import { BAStatus, BookingStatus, User, UserRole } from '@prisma/client';
import {
  calculateBookedWorkingDays,
  calculateUtilizationPercent,
  classifyCapacity,
  getRangeCapacity
} from '../domain/capacity';
import { parseDateOnly, toDateKey, workingDaysInRange } from '../domain/date';
import { requireCapacityPercent } from '../common/parse';
import { PrismaService } from '../prisma/prisma.service';
import { syncBookingStatuses } from '../bookings/bookings.utils';

@Injectable()
export class CapacityService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  private buildRangeExplanation(
    riskDays: Array<{
      date: string;
      approved_capacity: number;
      pending_capacity: number;
      risk_capacity: number;
      requested_capacity: number;
      risk_after_request: number;
      overflow_capacity: number;
    }>
  ) {
    const firstRiskDay = riskDays[0];
    const maxAfterRequest = riskDays.reduce(
      (max, day) => Math.max(max, day.risk_after_request),
      0
    );
    const maxOverflow = riskDays.reduce(
      (max, day) => Math.max(max, day.overflow_capacity),
      0
    );
    const approvedStatuses = [BookingStatus.APPROVED, BookingStatus.IN_PROGRESS]
      .map((status) => status.toLowerCase())
      .join(' + ');

    if (!firstRiskDay) {
      return {
        risk_level: 'SAFE' as const,
        summary: 'No overbook risk detected for the selected BA and date range.',
        why_flagged: [],
        signals_used: [
          'Daily approved capacity',
          'Daily pending capacity',
          'Requested capacity',
          `Risk formula: ${approvedStatuses} + pending + requested`
        ],
        suggested_actions: [
          'Submit the request as planned.',
          'Keep monitoring pending requests before approval.'
        ],
        risk_days: []
      };
    }

    return {
      risk_level: 'OVERBOOK_RISK' as const,
      summary: `Capacity reaches ${maxAfterRequest}% once this request is included, peaking on ${firstRiskDay.date}.`,
      why_flagged: [
        `${firstRiskDay.date} already carries ${firstRiskDay.risk_capacity}% at-risk load before this request.`,
        `Adding ${firstRiskDay.requested_capacity}% pushes the BA to ${firstRiskDay.risk_after_request}%, which is ${firstRiskDay.overflow_capacity}% over capacity.`,
        'Pending requests are counted so managers can resolve conflicts before approving work.'
      ],
      signals_used: [
        'Approved and in-progress bookings on the same BA',
        'Pending requests overlapping the selected date range',
        'Requested capacity for this new booking',
        'Daily overlap by date inside the selected range'
      ],
      suggested_actions: [
        'Reduce the requested capacity or split the booking across fewer days.',
        'Move the request to dates with lower pending or approved load.',
        'Assign a different BA with more headroom in the same window.',
        maxOverflow > 25
          ? 'Review and reject lower-priority pending requests before approving this one.'
          : 'Review pending requests and confirm whether they still need the BA.'
      ],
      risk_days: riskDays
    };
  }

  async summary(currentUser: User, start = '2026-06-01', end = '2026-06-30') {
    await syncBookingStatuses(this.prisma);
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
      const availableManDays =
        ba.status === BAStatus.ACTIVE ? workingDaysInRange(startDate, endDate).length : 0;
      const bookedManDays = calculateBookedWorkingDays(ba.bookings, startDate, endDate);
      const utilizationPercent = calculateUtilizationPercent(bookedManDays, availableManDays);

      return {
        ba_id: ba.id,
        full_name: ba.full_name,
        status: ba.status,
        approved_capacity: capacity.max_approved_capacity,
        pending_capacity: capacity.max_pending_capacity,
        risk_capacity: capacity.max_risk_capacity,
        has_overbook_risk: capacity.has_overbook_risk,
        booked_man_days: Number(bookedManDays.toFixed(2)),
        available_man_days: availableManDays,
        utilization_percent: utilizationPercent,
        capacity_label: classifyCapacity(capacity.max_risk_capacity)
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

  async baCapacity(
    currentUser: User,
    baId: string,
    start = '2026-06-01',
    end = '2026-06-30'
  ) {
    await syncBookingStatuses(this.prisma);
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
    await syncBookingStatuses(this.prisma);
    const baId = query.ba_id;
    if (!baId) {
      throw new BadRequestException('ba_id is required');
    }

    const startDate = parseDateOnly(query.start_date ?? '');
    const endDate = parseDateOnly(query.end_date ?? '');
    const requestedCapacity = requireCapacityPercent(query.capacity_percent);
    const bookings = await this.prisma.booking.findMany({
      where: {
        ba_id: baId,
        start_date: { lte: endDate },
        end_date: { gte: startDate }
      }
    });
    const capacity = getRangeCapacity(bookings, startDate, endDate);
    const riskDays = capacity.daily
      .map((day) => ({
        ...day,
        requested_capacity: requestedCapacity,
        risk_after_request: day.risk_capacity + requestedCapacity,
        overflow_capacity: Math.max(0, day.risk_capacity + requestedCapacity - 100)
      }))
      .filter((day) => day.risk_after_request > 100);
    const maxRiskCapacityAfterRequest = capacity.daily.reduce(
      (max, day) => Math.max(max, day.risk_capacity + requestedCapacity),
      0
    );

    return {
      ...capacity,
      requested_capacity: requestedCapacity,
      max_risk_capacity_after_request: maxRiskCapacityAfterRequest,
      has_overbook_risk_after_request: riskDays.length > 0,
      explanation: this.buildRangeExplanation(riskDays),
      daily: capacity.daily.map((day) => ({
        ...day,
        requested_capacity: requestedCapacity,
        risk_after_request: day.risk_capacity + requestedCapacity
      }))
    };
  }
}
