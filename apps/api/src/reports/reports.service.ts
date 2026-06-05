import { ForbiddenException, Inject, Injectable } from '@nestjs/common';
import { BAStatus, BookingStatus, User } from '@prisma/client';
import { canExportReports } from '../auth/rbac';
import { calculateBookedWorkingDays } from '../domain/capacity';
import { monthRange, toDateKey, workingDaysInRange } from '../domain/date';
import { PrismaService } from '../prisma/prisma.service';
import { syncBookingStatuses } from '../bookings/bookings.utils';

const reportBookingStatuses = [
  BookingStatus.APPROVED,
  BookingStatus.IN_PROGRESS,
  BookingStatus.COMPLETED
] as const;

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
export class ReportsService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async utilization(currentUser: User, month = '2026-06') {
    await syncBookingStatuses(this.prisma);
    if (!canExportReports(currentUser.role)) {
      await this.auditDenied(currentUser, 'EXPORT_REPORT', 'Permission', currentUser.id);
      throw new ForbiddenException('Manager role required for reports');
    }

    const { startDate, endDate } = monthRange(month);
    const workingDays = workingDaysInRange(startDate, endDate).length;
    const nextMonth = this.shiftMonth(month, 1);
    const { startDate: nextMonthStartDate, endDate: nextMonthEndDate } = monthRange(nextMonth);
    const bas = await this.prisma.bAProfile.findMany({
      where: { status: BAStatus.ACTIVE },
      include: {
        bookings: {
          where: {
            start_date: { lte: endDate },
            end_date: { gte: startDate },
            status: { in: reportBookingStatuses as unknown as BookingStatus[] }
          },
          include: { project: true, requester: { select: safeUserSelect } }
        }
      },
      orderBy: { full_name: 'asc' }
    });
    const [currentMonthBookingCount, nextMonthBookingCount] = await Promise.all([
      this.prisma.booking.count({
        where: {
          ba: { status: BAStatus.ACTIVE },
          start_date: { lte: endDate },
          end_date: { gte: startDate },
          status: { in: reportBookingStatuses as unknown as BookingStatus[] }
        }
      }),
      this.prisma.booking.count({
        where: {
          ba: { status: BAStatus.ACTIVE },
          start_date: { lte: nextMonthEndDate },
          end_date: { gte: nextMonthStartDate },
          status: { in: reportBookingStatuses as unknown as BookingStatus[] }
        }
      })
    ]);

    const rows = bas.map((ba) => {
      const bookedDays = calculateBookedWorkingDays(ba.bookings, startDate, endDate);
      const projectCount = new Set(ba.bookings.map((booking) => booking.project_id)).size;

      return {
        ba_id: ba.id,
        ba_name: ba.full_name,
        level: ba.level,
        status: ba.status,
        period: month,
        working_days: workingDays,
        booked_days: Number(bookedDays.toFixed(2)),
        utilization_percent: workingDays
          ? Number(((bookedDays / workingDays) * 100).toFixed(1))
          : 0,
        project_count: projectCount,
        bookings: ba.bookings
      };
    });

    return {
      period: month,
      start_date: toDateKey(startDate),
      end_date: toDateKey(endDate),
      active_ba_count: rows.length,
      total_booking_count: currentMonthBookingCount,
      next_month_booking_count: nextMonthBookingCount,
      average_utilization_percent: rows.length
        ? Number(
            (
              rows.reduce((sum, row) => sum + row.utilization_percent, 0) / rows.length
            ).toFixed(1)
          )
        : 0,
      rows
    };
  }

  async utilizationCsv(currentUser: User, month = '2026-06') {
    const report = await this.utilization(currentUser, month);
    const header = [
      'BA name',
      'Level',
      'Project',
      'Start date',
      'End date',
      'Capacity percent',
      'Status',
      'Requester',
      'Utilization period'
    ];
    const lines = [header.join(',')];

    for (const row of report.rows) {
      for (const booking of row.bookings) {
        lines.push(
          [
            row.ba_name,
            row.level,
            booking.project.name,
            toDateKey(booking.start_date),
            toDateKey(booking.end_date),
            String(booking.capacity_percent),
            booking.status,
            booking.requester.full_name,
            report.period
          ].map(this.csvCell).join(',')
        );
      }
    }

    return lines.join('\n');
  }

  private csvCell(value: string) {
    return `"${value.replace(/"/g, '""')}"`;
  }

  private shiftMonth(month: string, offset: number) {
    const { startDate } = monthRange(month);
    const shifted = new Date(
      Date.UTC(startDate.getUTCFullYear(), startDate.getUTCMonth() + offset, 1)
    );
    return shifted.toISOString().slice(0, 7);
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
}
