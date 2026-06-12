import { describe, expect, it, vi } from 'vitest';
import { CapacityService } from './capacity.service';

function createService() {
  const prisma = {
    booking: {
      findMany: vi.fn(),
      updateMany: vi.fn().mockResolvedValue({ count: 0 })
    }
  };

  const service = new CapacityService(prisma as never);
  return { prisma, service };
}

describe('CapacityService.rangeCheck', () => {
  it('explains overbook risk with why, signals, and next actions', async () => {
    const { prisma, service } = createService();

    prisma.booking.findMany.mockResolvedValue([
      {
        id: 'approved-1',
        ba_id: 'ba-1',
        start_date: new Date('2026-06-10T00:00:00.000Z'),
        end_date: new Date('2026-06-12T00:00:00.000Z'),
        capacity_percent: 75,
        status: 'APPROVED'
      },
      {
        id: 'pending-1',
        ba_id: 'ba-1',
        start_date: new Date('2026-06-11T00:00:00.000Z'),
        end_date: new Date('2026-06-11T00:00:00.000Z'),
        capacity_percent: 25,
        status: 'PENDING'
      }
    ]);

    const result = await service.rangeCheck({
      ba_id: 'ba-1',
      start_date: '2026-06-10',
      end_date: '2026-06-12',
      capacity_percent: '50'
    });

    expect(result.has_overbook_risk_after_request).toBe(true);
    expect(result.max_risk_capacity_after_request).toBe(150);
    expect(result.explanation.risk_level).toBe('OVERBOOK_RISK');
    expect(result.explanation.summary).toContain('150%');
    expect(result.explanation.why_flagged).toEqual(
      expect.arrayContaining([
        expect.stringContaining('2026-06-10 already carries 75%'),
        expect.stringContaining('pushes the BA to 125%')
      ])
    );
    expect(result.explanation.signals_used).toEqual(
      expect.arrayContaining([
        'Approved and in-progress bookings on the same BA',
        'Pending requests overlapping the selected date range',
        'Requested capacity for this new booking'
      ])
    );
    expect(result.explanation.suggested_actions).toEqual(
      expect.arrayContaining([
        'Reduce the requested capacity or split the booking across fewer days.',
        'Assign a different BA with more headroom in the same window.'
      ])
    );
    expect(result.explanation.risk_days).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          date: '2026-06-11',
          approved_capacity: 75,
          pending_capacity: 25,
          risk_capacity: 100,
          requested_capacity: 50,
          risk_after_request: 150,
          overflow_capacity: 50
        })
      ])
    );
  });

  it('returns a safe explanation when the request stays within capacity', async () => {
    const { prisma, service } = createService();

    prisma.booking.findMany.mockResolvedValue([
      {
        id: 'approved-1',
        ba_id: 'ba-2',
        start_date: new Date('2026-06-10T00:00:00.000Z'),
        end_date: new Date('2026-06-10T00:00:00.000Z'),
        capacity_percent: 50,
        status: 'APPROVED'
      }
    ]);

    const result = await service.rangeCheck({
      ba_id: 'ba-2',
      start_date: '2026-06-10',
      end_date: '2026-06-10',
      capacity_percent: '25'
    });

    expect(result.has_overbook_risk_after_request).toBe(false);
    expect(result.max_risk_capacity_after_request).toBe(75);
    expect(result.explanation.risk_level).toBe('SAFE');
    expect(result.explanation.why_flagged).toEqual([]);
    expect(result.explanation.risk_days).toEqual([]);
    expect(result.explanation.suggested_actions).toEqual(
      expect.arrayContaining(['Submit the request as planned.'])
    );
  });
});
