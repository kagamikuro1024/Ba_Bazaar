export function parseDateOnly(value: string | Date): Date {
  if (value instanceof Date) {
    return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
  }

  const trimmed = value.trim();
  const dateOnlyMatch = /^\d{4}-\d{2}-\d{2}$/.test(trimmed);
  const isoDateTimeMatch = /^\d{4}-\d{2}-\d{2}[T\s]/.test(trimmed);

  if (!dateOnlyMatch && !isoDateTimeMatch) {
    throw new Error('Date must use YYYY-MM-DD format');
  }

  const dateKey = trimmed.slice(0, 10);
  return new Date(`${dateKey}T00:00:00.000Z`);
}

export function toDateKey(value: string | Date): string {
  const date = parseDateOnly(value);
  return date.toISOString().slice(0, 10);
}

export function addDays(value: Date, days: number): Date {
  const date = parseDateOnly(value);
  date.setUTCDate(date.getUTCDate() + days);
  return date;
}

export function eachDay(startDate: Date, endDate: Date): Date[] {
  const start = parseDateOnly(startDate);
  const end = parseDateOnly(endDate);
  const days: Date[] = [];

  for (let cursor = start; cursor <= end; cursor = addDays(cursor, 1)) {
    days.push(cursor);
  }

  return days;
}

export function rangesOverlap(
  firstStart: Date,
  firstEnd: Date,
  secondStart: Date,
  secondEnd: Date
) {
  return firstStart <= secondEnd && firstEnd >= secondStart;
}

export function isWeekend(value: Date) {
  const day = value.getUTCDay();
  return day === 0 || day === 6;
}

export function workingDaysInRange(startDate: Date, endDate: Date) {
  return eachDay(startDate, endDate).filter((day) => !isWeekend(day));
}

export function monthRange(month: string) {
  if (!/^\d{4}-\d{2}$/.test(month)) {
    throw new Error('Month must use YYYY-MM format');
  }

  const [year, monthIndex] = month.split('-').map(Number);
  const startDate = new Date(Date.UTC(year, monthIndex - 1, 1));
  const endDate = new Date(Date.UTC(year, monthIndex, 0));

  return { startDate, endDate };
}
