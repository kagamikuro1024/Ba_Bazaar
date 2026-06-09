package main

import (
	"context"
	"time"
)

func (app *App) syncBookingStatuses(ctx context.Context) error {
	today := normalizeDate(timeNow())
	_, err := app.DB.Pool.Exec(ctx, `update bookings set status = 'IN_PROGRESS' where status = 'APPROVED' and start_date <= $1 and end_date >= $1`, today)
	if err != nil {
		return err
	}
	_, err = app.DB.Pool.Exec(ctx, `update bookings set status = 'APPROVED' where status = 'IN_PROGRESS' and start_date > $1`, today)
	if err != nil {
		return err
	}
	_, err = app.DB.Pool.Exec(ctx, `update bookings set status = 'COMPLETED' where status in ('APPROVED','IN_PROGRESS') and end_date < $1`, today)
	return err
}

func timeNow() (now time.Time) {
	return time.Now().UTC()
}
