import { ForbiddenException, Inject, Injectable } from '@nestjs/common';
import { BookingStatus, User, UserRole } from '@prisma/client';
import { addDays, parseDateOnly, toDateKey } from '../domain/date';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class NotificationsService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async list(currentUser: User) {
    return this.prisma.notification.findMany({
      where: { recipient_id: currentUser.id },
      orderBy: { created_at: 'desc' }
    });
  }

  async markRead(currentUser: User, id: string) {
    return this.prisma.notification.update({
      where: { id, recipient_id: currentUser.id },
      data: { read_at: new Date() }
    });
  }

  async runReminders(currentUser: User, date = toDateKey(new Date())) {
    if (currentUser.role !== UserRole.BA_MANAGER && currentUser.role !== UserRole.ADMIN) {
      throw new ForbiddenException('Manager or Admin role required');
    }

    const runDate = parseDateOnly(date);
    const startReminderDate = addDays(runDate, 3);
    const endReminderDate = addDays(runDate, 1);
    const reminderStatuses = [
      BookingStatus.APPROVED,
      BookingStatus.IN_PROGRESS
    ] as const;

    const [startBookings, endBookings] = await Promise.all([
      this.prisma.booking.findMany({
        where: {
          status: { in: reminderStatuses as unknown as BookingStatus[] },
          start_date: startReminderDate
        },
        include: { ba: true, requester: true, project: true }
      }),
      this.prisma.booking.findMany({
        where: {
          status: { in: reminderStatuses as unknown as BookingStatus[] },
          end_date: endReminderDate
        },
        include: { ba: true, requester: true, project: true }
      })
    ]);

    const assignedStartBookings = startBookings.filter((booking) => booking.ba !== null) as Array<{
      id: string;
      title: string;
      start_date: Date;
      end_date: Date;
      requester_id: string;
      ba: { full_name: string; user_id: string | null };
    }>;
    const assignedEndBookings = endBookings.filter((booking) => booking.ba !== null) as Array<{
      id: string;
      title: string;
      start_date: Date;
      end_date: Date;
      requester_id: string;
      ba: { full_name: string; user_id: string | null };
    }>;

    const created = [
      ...(await this.createReminderNotifications(assignedStartBookings, {
        type: 'BOOKING_START_REMINDER',
        title: 'Booking starts in 3 days',
        buildMessage: (booking) =>
          `${booking.title}\nStarts on ${toDateKey(booking.start_date)} for ${booking.ba.full_name}.`
      })),
      ...(await this.createReminderNotifications(assignedEndBookings, {
        type: 'BOOKING_END_REMINDER',
        title: 'Booking ends tomorrow',
        buildMessage: (booking) =>
          `${booking.title}\nEnds on ${toDateKey(booking.end_date)} for ${booking.ba.full_name}.`
      }))
    ];

    return {
      run_date: toDateKey(runDate),
      start_reminder_booking_count: startBookings.length,
      end_reminder_booking_count: endBookings.length,
      created_notification_count: created.length
    };
  }

  private async createReminderNotifications(
    bookings: Array<{
      id: string;
      title: string;
      start_date: Date;
      end_date: Date;
      requester_id: string;
      ba: { full_name: string; user_id: string | null };
    }>,
    config: {
      type: string;
      title: string;
      buildMessage: (booking: {
        id: string;
        title: string;
        start_date: Date;
        end_date: Date;
        requester_id: string;
        ba: { full_name: string; user_id: string | null };
      }) => string;
    }
  ) {
    if (bookings.length === 0) {
      return [];
    }

    const existing = await this.prisma.notification.findMany({
      where: {
        type: config.type,
        related_entity_type: 'Booking',
        related_entity_id: { in: bookings.map((booking) => booking.id) }
      },
      select: {
        recipient_id: true,
        related_entity_id: true
      }
    });
    const existingKeys = new Set(
      existing.map((item) => `${item.related_entity_id}:${item.recipient_id}`)
    );

    const data = bookings.flatMap((booking) => {
      const recipients = [booking.requester_id, booking.ba.user_id].filter(
        (value): value is string => Boolean(value)
      );

      return recipients
        .filter((recipientId) => !existingKeys.has(`${booking.id}:${recipientId}`))
        .map((recipientId) => ({
          recipient_id: recipientId,
          type: config.type,
          title: config.title,
          message: config.buildMessage(booking),
          related_entity_type: 'Booking',
          related_entity_id: booking.id
        }));
    });

    if (data.length === 0) {
      return [];
    }

    await this.prisma.notification.createMany({ data });
    return data;
  }
}
