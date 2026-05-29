import { describe, expect, it } from 'vitest';
import { BookingStatus } from '@prisma/client';
import { canApproveCapacity, getRangeCapacity } from './capacity';

const date = (value: string) => new Date(`${value}T00:00:00.000Z`);

describe('capacity engine', () => {
  it('calculates approved and pending overlap capacity by day', () => {
    const result = getRangeCapacity(
      [
        {
          id: 'approved-50',
          ba_id: 'ba-1',
          start_date: date('2026-06-01'),
          end_date: date('2026-06-03'),
          capacity_percent: 50,
          status: BookingStatus.APPROVED
        },
        {
          id: 'pending-100',
          ba_id: 'ba-1',
          start_date: date('2026-06-02'),
          end_date: date('2026-06-04'),
          capacity_percent: 100,
          status: BookingStatus.PENDING
        }
      ],
      date('2026-06-01'),
      date('2026-06-04')
    );

    expect(result.max_approved_capacity).toBe(50);
    expect(result.max_pending_capacity).toBe(100);
    expect(result.max_risk_capacity).toBe(150);
    expect(result.has_overbook_risk).toBe(true);
  });

  it('blocks approval when approved capacity would exceed 100 percent', () => {
    const result = canApproveCapacity(
      [
        {
          id: 'approved-100',
          ba_id: 'ba-1',
          start_date: date('2026-06-01'),
          end_date: date('2026-06-03'),
          capacity_percent: 100,
          status: BookingStatus.APPROVED
        }
      ],
      date('2026-06-02'),
      date('2026-06-04'),
      50
    );

    expect(result.allowed).toBe(false);
    expect(result.blocking_day).toBe('2026-06-02');
  });
});
