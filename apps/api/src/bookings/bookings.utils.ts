import { BookingStatus, type PrismaClient } from '@prisma/client';
import { parseDateOnly, toDateKey } from '../domain/date';

export async function syncBookingStatuses(prisma: Pick<PrismaClient, 'booking'>) {
  const today = parseDateOnly(toDateKey(new Date()));

  // 1. APPROVED -> IN_PROGRESS if start_date <= today <= end_date
  await prisma.booking.updateMany({
    where: {
      status: BookingStatus.APPROVED,
      start_date: { lte: today },
      end_date: { gte: today }
    },
    data: {
      status: BookingStatus.IN_PROGRESS
    }
  });

  // 2. IN_PROGRESS -> APPROVED if start_date > today
  await prisma.booking.updateMany({
    where: {
      status: BookingStatus.IN_PROGRESS,
      start_date: { gt: today }
    },
    data: {
      status: BookingStatus.APPROVED
    }
  });

  // 3. APPROVED / IN_PROGRESS -> COMPLETED if end_date < today
  await prisma.booking.updateMany({
    where: {
      status: { in: [BookingStatus.APPROVED, BookingStatus.IN_PROGRESS] },
      end_date: { lt: today }
    },
    data: {
      status: BookingStatus.COMPLETED
    }
  });
}
