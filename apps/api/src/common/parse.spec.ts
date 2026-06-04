import { describe, expect, it } from 'vitest';
import { requireCapacityPercent } from './parse';

describe('requireCapacityPercent', () => {
  it('allows quarter-step capacity values', () => {
    expect(requireCapacityPercent(25)).toBe(25);
    expect(requireCapacityPercent(50)).toBe(50);
    expect(requireCapacityPercent(75)).toBe(75);
    expect(requireCapacityPercent(100)).toBe(100);
  });

  it('rejects capacity values outside supported steps', () => {
    expect(() => requireCapacityPercent(30)).toThrow(
      'capacity_percent must be 25, 50, 75, or 100'
    );
  });
});
