import { BadRequestException, ForbiddenException, Inject, Injectable } from '@nestjs/common';
import { BAStatus, BookingPriority, BookingStatus, User } from '@prisma/client';
import { canExportReports } from '../auth/rbac';
import {
  calculateBenchRate,
  calculateBookedWorkingDays,
  calculateBookingManDays,
  calculateUtilizationPercent,
  classifyCapacity,
  getRangeCapacity
} from '../domain/capacity';
import { monthRange, parseDateOnly, toDateKey, workingDaysInRange } from '../domain/date';
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
    await this.ensureReportAccess(currentUser);

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

  async managerSummary(currentUser: User, from?: string, to?: string) {
    await syncBookingStatuses(this.prisma);
    await this.ensureReportAccess(currentUser);

    const timeframe = this.resolveTimeframe(from, to);
    const workingDays = workingDaysInRange(timeframe.startDate, timeframe.endDate).length;
    const bas = await this.prisma.bAProfile.findMany({
      where: { status: BAStatus.ACTIVE },
      include: {
        bookings: {
          where: {
            start_date: { lte: timeframe.endDate },
            end_date: { gte: timeframe.startDate }
          },
          include: { project: true, requester: { select: safeUserSelect } }
        }
      },
      orderBy: { full_name: 'asc' }
    });

    const baRows = bas.map((ba) => {
      const capacity = getRangeCapacity(ba.bookings, timeframe.startDate, timeframe.endDate);
      const bookedManDays = calculateBookedWorkingDays(
        ba.bookings,
        timeframe.startDate,
        timeframe.endDate
      );
      const utilizationPercent = calculateUtilizationPercent(bookedManDays, workingDays);
      const capacityLabel = capacity.max_risk_capacity > 100
        ? 'OVERBOOKED'
        : classifyCapacity(utilizationPercent);
      const currentProjects = this.summarizeProjectsForBa(
        ba.bookings,
        timeframe.startDate,
        timeframe.endDate
      );

      return {
        ba_id: ba.id,
        ba_name: ba.full_name,
        level: ba.level,
        booked_man_days: Number(bookedManDays.toFixed(2)),
        available_man_days: workingDays,
        utilization_percent: utilizationPercent,
        approved_capacity: capacity.max_approved_capacity,
        pending_capacity: capacity.max_pending_capacity,
        risk_capacity: capacity.max_risk_capacity,
        capacity_label: capacityLabel,
        current_projects: currentProjects
      };
    });

    const [
      pendingRequests,
      unassignedRequests,
      urgentRequests
    ] = await Promise.all([
      this.prisma.booking.count({
        where: {
          status: BookingStatus.PENDING,
          start_date: { lte: timeframe.endDate },
          end_date: { gte: timeframe.startDate }
        }
      }),
      this.prisma.booking.count({
        where: {
          status: BookingStatus.PENDING,
          ba_id: null,
          start_date: { lte: timeframe.endDate },
          end_date: { gte: timeframe.startDate }
        }
      }),
      this.prisma.booking.count({
        where: {
          status: BookingStatus.PENDING,
          priority: BookingPriority.URGENT,
          start_date: { lte: timeframe.endDate },
          end_date: { gte: timeframe.startDate }
        }
      })
    ]);

    const totalManDays = baRows.reduce((sum, row) => sum + row.booked_man_days, 0);
    const totalAvailableManDays = baRows.reduce(
      (sum, row) => sum + row.available_man_days,
      0
    );
    const benchCount = baRows.filter((row) => row.utilization_percent === 0).length;
    const overbookedCount = baRows.filter((row) => row.risk_capacity > 100).length;
    const projectEffort = this.buildProjectEffort(
      bas.flatMap((ba) => ba.bookings),
      timeframe.startDate,
      timeframe.endDate
    );

    return {
      timeframe: {
        from: toDateKey(timeframe.startDate),
        to: toDateKey(timeframe.endDate)
      },
      team: {
        total_ba: baRows.length,
        team_utilization_percent: calculateUtilizationPercent(
          totalManDays,
          totalAvailableManDays
        ),
        bench_count: benchCount,
        bench_rate_percent: calculateBenchRate(benchCount, baRows.length),
        overbooked_count: overbookedCount,
        total_man_days: Number(totalManDays.toFixed(2)),
        total_available_man_days: totalAvailableManDays
      },
      actions: {
        pending_requests: pendingRequests,
        unassigned_requests: unassignedRequests,
        urgent_requests: urgentRequests,
        overbooked_ba: overbookedCount,
        bench_ba: benchCount
      },
      capacity_distribution: {
        bench: baRows.filter((row) => row.capacity_label === 'BENCH').length,
        low: baRows.filter((row) => row.capacity_label === 'LOW').length,
        available: baRows.filter((row) => row.capacity_label === 'AVAILABLE').length,
        high: baRows.filter((row) => row.capacity_label === 'HIGH').length,
        full: baRows.filter((row) => row.capacity_label === 'FULL').length,
        overbooked: baRows.filter((row) => row.capacity_label === 'OVERBOOKED').length
      },
      ba_utilization: baRows,
      project_effort: projectEffort
    };
  }

  async teamUtilization(currentUser: User, from?: string, to?: string) {
    const summary = await this.managerSummary(currentUser, from, to);

    return {
      timeframe: summary.timeframe,
      team: summary.team,
      capacity_distribution: summary.capacity_distribution,
      rows: summary.ba_utilization
    };
  }

  async projectEffort(currentUser: User, from?: string, to?: string) {
    await syncBookingStatuses(this.prisma);
    await this.ensureReportAccess(currentUser);

    const timeframe = this.resolveTimeframe(from, to);
    const bookings = await this.prisma.booking.findMany({
      where: {
        status: { in: reportBookingStatuses as unknown as BookingStatus[] },
        start_date: { lte: timeframe.endDate },
        end_date: { gte: timeframe.startDate }
      },
      include: { project: true }
    });
    const rows = this.buildProjectEffort(bookings, timeframe.startDate, timeframe.endDate);

    return {
      timeframe: {
        from: toDateKey(timeframe.startDate),
        to: toDateKey(timeframe.endDate)
      },
      total_man_days: Number(
        rows.reduce((sum, row) => sum + row.man_days, 0).toFixed(2)
      ),
      projects: rows
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

  private resolveTimeframe(from?: string, to?: string) {
    if (from || to) {
      if (!from || !to) {
        throw new BadRequestException('from and to must be provided together');
      }

      const startDate = parseDateOnly(from);
      const endDate = parseDateOnly(to);
      if (startDate > endDate) {
        throw new BadRequestException('from must be before or equal to to');
      }

      return { startDate, endDate };
    }

    const now = new Date();
    return {
      startDate: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)),
      endDate: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0))
    };
  }

  private summarizeProjectsForBa<
    TBooking extends {
      project_id: string;
      project: { id: string; name: string; color: string };
      start_date: Date;
      end_date: Date;
      capacity_percent: number;
      status: BookingStatus;
    }
  >(bookings: TBooking[], startDate: Date, endDate: Date) {
    const projectMap = new Map<
      string,
      {
        project_id: string;
        project_name: string;
        color: string;
        capacity_percent: number;
        man_days: number;
      }
    >();

    for (const booking of bookings.filter((item) =>
      item.status === BookingStatus.PENDING ||
      reportBookingStatuses.includes(item.status as (typeof reportBookingStatuses)[number])
    )) {
      const current = projectMap.get(booking.project_id) ?? {
        project_id: booking.project.id,
        project_name: booking.project.name,
        color: booking.project.color,
        capacity_percent: 0,
        man_days: 0
      };

      current.capacity_percent += booking.capacity_percent;
      current.man_days += calculateBookingManDays(booking, startDate, endDate);
      projectMap.set(booking.project_id, current);
    }

    return Array.from(projectMap.values())
      .map((item) => ({
        ...item,
        man_days: Number(item.man_days.toFixed(2))
      }))
      .sort((left, right) => right.man_days - left.man_days);
  }

  private buildProjectEffort<
    TBooking extends {
      project_id: string;
      project: { id: string; name: string; color: string };
      ba_id: string | null;
      start_date: Date;
      end_date: Date;
      capacity_percent: number;
      status: BookingStatus;
    }
  >(bookings: TBooking[], startDate: Date, endDate: Date) {
    const projectMap = new Map<
      string,
      {
        project_id: string;
        project_name: string;
        color: string;
        man_days: number;
        booking_count: number;
        ba_ids: Set<string>;
      }
    >();

    for (const booking of bookings.filter((item) =>
      reportBookingStatuses.includes(item.status as (typeof reportBookingStatuses)[number])
    )) {
      const current = projectMap.get(booking.project_id) ?? {
        project_id: booking.project.id,
        project_name: booking.project.name,
        color: booking.project.color,
        man_days: 0,
        booking_count: 0,
        ba_ids: new Set<string>()
      };

      current.man_days += calculateBookingManDays(booking, startDate, endDate);
      current.booking_count += 1;
      if (booking.ba_id) {
        current.ba_ids.add(booking.ba_id);
      }
      projectMap.set(booking.project_id, current);
    }

    const totalManDays = Array.from(projectMap.values()).reduce(
      (sum, item) => sum + item.man_days,
      0
    );

    return Array.from(projectMap.values())
      .map((item) => ({
        project_id: item.project_id,
        project_name: item.project_name,
        color: item.color,
        man_days: Number(item.man_days.toFixed(2)),
        allocation_percent: calculateUtilizationPercent(item.man_days, totalManDays),
        booking_count: item.booking_count,
        ba_count: item.ba_ids.size
      }))
      .sort((left, right) => right.man_days - left.man_days);
  }

  private async ensureReportAccess(currentUser: User) {
    if (!canExportReports(currentUser.role)) {
      await this.auditDenied(currentUser, 'EXPORT_REPORT', 'Permission', currentUser.id);
      throw new ForbiddenException('Manager role required for reports');
    }
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
