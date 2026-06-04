ALTER TABLE "bookings"
  DROP CONSTRAINT IF EXISTS "bookings_capacity_percent_check";

ALTER TABLE "bookings"
  ADD CONSTRAINT "bookings_capacity_percent_check"
  CHECK ("capacity_percent" IN (25, 50, 75, 100));
