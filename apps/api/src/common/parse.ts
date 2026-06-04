import { BadRequestException } from '@nestjs/common';
import { parseDateOnly } from '../domain/date';

export const allowedCapacityPercents = [25, 50, 75, 100] as const;

export function requireString(value: unknown, field: string) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new BadRequestException(`${field} is required`);
  }

  return value.trim();
}

export function optionalString(value: unknown) {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;
}

export function requireDate(value: unknown, field: string) {
  try {
    return parseDateOnly(requireString(value, field));
  } catch {
    throw new BadRequestException(`${field} must be a valid YYYY-MM-DD date`);
  }
}

export function requireCapacityPercent(value: unknown) {
  const numericValue = Number(value);

  if (
    !allowedCapacityPercents.includes(
      numericValue as (typeof allowedCapacityPercents)[number]
    )
  ) {
    throw new BadRequestException('capacity_percent must be 25, 50, 75, or 100');
  }

  return numericValue;
}
