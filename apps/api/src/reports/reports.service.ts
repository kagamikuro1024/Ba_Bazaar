import { ForbiddenException, Inject, Injectable } from '@nestjs/common';
import { User } from '@prisma/client';
import { canExportReports } from '../auth/rbac';
import { calculateBookedWorkingDays } from '../domain/capacity';
import { monthRange, toDateKey, workingDaysInRange } from '../domain/date';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class ReportsService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async utilization(currentUser: User, month = '2026-06') {
    if (!canExportReports(currentUser.role)) {
      await this.auditDenied(currentUser, 'EXPORT_REPORT', 'Permission', currentUser.id);
      throw new ForbiddenException('Manager role required for reports');
    }

    const { startDate, endDate } = monthRange(month);
    const workingDays = workingDaysInRange(startDate, endDate).length;
    const bas = await this.prisma.bAProfile.findMany({
      include: {
        bookings: {
          where: {
            start_date: { lte: endDate },
            end_date: { gte: startDate }
          },
          include: { project: true, requester: true }
        }
      },
      orderBy: { full_name: 'asc' }
    });

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
      if (row.bookings.length === 0) {
        lines.push(
          [
            row.ba_name,
            row.level,
            '',
            '',
            '',
            '',
            '',
            '',
            report.period
          ].map(this.csvCell).join(',')
        );
        continue;
      }

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
