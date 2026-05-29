ALTER TABLE "bookings"
  ADD CONSTRAINT "bookings_capacity_percent_check"
  CHECK ("capacity_percent" IN (50, 100));

ALTER TABLE "bookings"
  ADD CONSTRAINT "bookings_date_range_check"
  CHECK ("end_date" >= "start_date");

ALTER TABLE "private_notes"
  ADD CONSTRAINT "private_notes_content_length_check"
  CHECK (char_length("content") <= 5000);
