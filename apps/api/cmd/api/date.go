package main

import (
	"fmt"
	"time"
)

func parseDateOnly(value string) (time.Time, error) {
	if len(value) < 10 {
		return time.Time{}, fmt.Errorf("date must use YYYY-MM-DD format")
	}
	key := value[:10]
	parsed, err := time.ParseInLocation("2006-01-02", key, time.UTC)
	if err != nil {
		return time.Time{}, fmt.Errorf("date must use YYYY-MM-DD format")
	}
	return parsed, nil
}

func toDateKey(value time.Time) string {
	return value.UTC().Format("2006-01-02")
}

func addDays(value time.Time, days int) time.Time {
	return value.UTC().AddDate(0, 0, days)
}

func eachDay(startDate, endDate time.Time) []time.Time {
	start := normalizeDate(startDate)
	end := normalizeDate(endDate)
	days := make([]time.Time, 0)
	for cursor := start; !cursor.After(end); cursor = addDays(cursor, 1) {
		days = append(days, cursor)
	}
	return days
}

func isWeekend(value time.Time) bool {
	switch value.UTC().Weekday() {
	case time.Saturday, time.Sunday:
		return true
	default:
		return false
	}
}

func workingDaysInRange(startDate, endDate time.Time) []time.Time {
	all := eachDay(startDate, endDate)
	out := make([]time.Time, 0, len(all))
	for _, day := range all {
		if !isWeekend(day) {
			out = append(out, day)
		}
	}
	return out
}

func monthRange(month string) (time.Time, time.Time, error) {
	if len(month) != 7 {
		return time.Time{}, time.Time{}, fmt.Errorf("month must use YYYY-MM format")
	}
	parsed, err := time.ParseInLocation("2006-01", month, time.UTC)
	if err != nil {
		return time.Time{}, time.Time{}, fmt.Errorf("month must use YYYY-MM format")
	}
	start := time.Date(parsed.Year(), parsed.Month(), 1, 0, 0, 0, 0, time.UTC)
	end := start.AddDate(0, 1, -1)
	return start, end, nil
}

func normalizeDate(value time.Time) time.Time {
	return time.Date(value.UTC().Year(), value.UTC().Month(), value.UTC().Day(), 0, 0, 0, 0, time.UTC)
}
