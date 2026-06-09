import { BookingStatus } from '@prisma/client';
import { eachDay, rangesOverlap, toDateKey, workingDaysInRange } from './date';

export type CapacityBooking = {
  id: string;
  ba_id: string | null;
  start_date: Date;
  end_date: Date;
  capacity_percent: number;
  status: BookingStatus;
};

export type CapacityClassification =
  | 'BENCH'
  | 'LOW'
  | 'AVAILABLE'
  | 'HIGH'
  | 'FULL'
  | 'OVERBOOKED';

const officialStatuses = new Set<BookingStatus>([
  BookingStatus.APPROVED,
  BookingStatus.IN_PROGRESS
]);

const utilizationStatuses = new Set<BookingStatus>([
  BookingStatus.APPROVED,
  BookingStatus.IN_PROGRESS,
  BookingStatus.COMPLETED
]);

export function isOfficialCapacityStatus(status: BookingStatus) {
  return officialStatuses.has(status);
}

export function isUtilizationStatus(status: BookingStatus) {
  return utilizationStatuses.has(status);
}

export function getRangeCapacity(
  bookings: CapacityBooking[],
  startDate: Date,
  endDate: Date,
  excludeBookingId?: string
) {
  const daily = eachDay(startDate, endDate).map((day) => {
    const overlapping = bookings.filter(
      (booking) =>
        booking.id !== excludeBookingId &&
        rangesOverlap(booking.start_date, booking.end_date, day, day)
    );

    const approvedCapacity = overlapping
      .filter((booking) => isOfficialCapacityStatus(booking.status))
      .reduce((sum, booking) => sum + booking.capacity_percent, 0);
    const pendingCapacity = overlapping
      .filter((booking) => booking.status === BookingStatus.PENDING)
      .reduce((sum, booking) => sum + booking.capacity_percent, 0);

    return {
      date: toDateKey(day),
      approved_capacity: approvedCapacity,
      pending_capacity: pendingCapacity,
      risk_capacity: approvedCapacity + pendingCapacity
    };
  });

  return {
    daily,
    max_approved_capacity: Math.max(0, ...daily.map((day) => day.approved_capacity)),
    max_pending_capacity: Math.max(0, ...daily.map((day) => day.pending_capacity)),
    max_risk_capacity: Math.max(0, ...daily.map((day) => day.risk_capacity)),
    has_overbook_risk: daily.some((day) => day.risk_capacity > 100)
  };
}

export function canApproveCapacity(
  bookings: CapacityBooking[],
  startDate: Date,
  endDate: Date,
  capacityPercent: number,
  excludeBookingId?: string
) {
  const current = getRangeCapacity(bookings, startDate, endDate, excludeBookingId);
  const blockingDay = current.daily.find(
    (day) => day.approved_capacity + capacityPercent > 100
  );

  return {
    allowed: !blockingDay,
    blocking_day: blockingDay?.date,
    max_approved_after_approval:
      Math.max(0, ...current.daily.map((day) => day.approved_capacity)) + capacityPercent
  };
}

export function calculateBookedWorkingDays(
  bookings: CapacityBooking[],
  startDate: Date,
  endDate: Date
) {
  let bookedDays = 0;

  for (const booking of bookings.filter((item) => isUtilizationStatus(item.status))) {
    const overlapStart = booking.start_date > startDate ? booking.start_date : startDate;
    const overlapEnd = booking.end_date < endDate ? booking.end_date : endDate;

    if (overlapStart > overlapEnd) {
      continue;
    }

    const weightedDays =
      workingDaysInRange(overlapStart, overlapEnd).length *
      (booking.capacity_percent / 100);
    bookedDays += weightedDays;
  }

  return bookedDays;
}

export function calculateBookingManDays(
  booking: Pick<CapacityBooking, 'start_date' | 'end_date' | 'capacity_percent'>,
  startDate = booking.start_date,
  endDate = booking.end_date
) {
  const overlapStart = booking.start_date > startDate ? booking.start_date : startDate;
  const overlapEnd = booking.end_date < endDate ? booking.end_date : endDate;

  if (overlapStart > overlapEnd) {
    return 0;
  }

  return workingDaysInRange(overlapStart, overlapEnd).length * (booking.capacity_percent / 100);
}

export function calculateUtilizationPercent(bookedManDays: number, availableManDays: number) {
  if (availableManDays <= 0) {
    return 0;
  }

  return Number(((bookedManDays / availableManDays) * 100).toFixed(1));
}

export function calculateBenchRate(benchBaCount: number, totalBaCount: number) {
  if (totalBaCount <= 0) {
    return 0;
  }

  return Number(((benchBaCount / totalBaCount) * 100).toFixed(1));
}

export function classifyCapacity(utilizationPercent: number): CapacityClassification {
  if (utilizationPercent <= 0) {
    return 'BENCH';
  }

  if (utilizationPercent < 50) {
    return 'LOW';
  }

  if (utilizationPercent < 75) {
    return 'AVAILABLE';
  }

  if (utilizationPercent < 100) {
    return 'HIGH';
  }

  if (utilizationPercent === 100) {
    return 'FULL';
  }

  return 'OVERBOOKED';
}
