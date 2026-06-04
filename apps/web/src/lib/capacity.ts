export const CAPACITY_OPTIONS = [25, 50, 75, 100] as const;

export type CapacityOption = (typeof CAPACITY_OPTIONS)[number];

export function parseCapacityPercent(value: string | number | null | undefined) {
  const capacityPercent = Number(value);
  return CAPACITY_OPTIONS.includes(capacityPercent as CapacityOption)
    ? (capacityPercent as CapacityOption)
    : null;
}
