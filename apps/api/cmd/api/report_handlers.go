package main

import (
	"context"
	"encoding/csv"
	"fmt"
	"net/http"
	"sort"
	"strings"
	"time"
)

func canExportReports(role string) bool { return isManagerRole(role) || isAdminSupportRole(role) }

func (app *App) handleDashboardManagerSummary(w http.ResponseWriter, r *http.Request) {
	payload, status, err := app.managerSummaryPayload(r)
	if err != nil {
		writeJSON(w, status, map[string]string{"message": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, payload)
}

func (app *App) handleAnalyticsTeamUtilization(w http.ResponseWriter, r *http.Request) {
	payload, status, err := app.managerSummaryPayload(r)
	if err != nil {
		writeJSON(w, status, map[string]string{"message": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"timeframe":             payload["timeframe"],
		"team":                  payload["team"],
		"capacity_distribution": payload["capacity_distribution"],
		"rows":                  payload["ba_utilization"],
	})
}

func (app *App) handleAnalyticsProjectEffort(w http.ResponseWriter, r *http.Request) {
	user, err := app.currentUser(r)
	if err != nil {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"message": "Authentication required."})
		return
	}
	if !canExportReports(user.Role) {
		writeJSON(w, http.StatusForbidden, map[string]string{"message": "Manager role required for reports"})
		return
	}
	_ = app.syncBookingStatuses(r.Context())
	startDate, endDate, err := resolveTimeframe(strings.TrimSpace(r.URL.Query().Get("from")), strings.TrimSpace(r.URL.Query().Get("to")))
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"message": err.Error()})
		return
	}
	rows, total, err := app.projectEffortRows(r.Context(), startDate, endDate)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"message": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"timeframe": map[string]string{"from": toDateKey(startDate), "to": toDateKey(endDate)},
		"total_man_days": total,
		"projects": rows,
	})
}

func (app *App) handleReportsUtilization(w http.ResponseWriter, r *http.Request) {
	payload, status, err := app.utilizationReportPayload(r)
	if err != nil {
		writeJSON(w, status, map[string]string{"message": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, payload)
}

func (app *App) handleReportsUtilizationCSV(w http.ResponseWriter, r *http.Request) {
	payload, status, err := app.utilizationReportPayload(r)
	if err != nil {
		writeJSON(w, status, map[string]string{"message": err.Error()})
		return
	}
	w.Header().Set("Content-Type", "text/csv; charset=utf-8")
	w.Header().Set("Content-Disposition", `attachment; filename="ba-utilization.csv"`)
	writer := csv.NewWriter(w)
	_ = writer.Write([]string{"BA name", "Level", "Project", "Start date", "End date", "Capacity percent", "Status", "Requester", "Utilization period"})
	rows := payload["rows"].([]map[string]any)
	period := payload["period"].(string)
	for _, row := range rows {
		bookings := row["bookings"].([]map[string]any)
		for _, booking := range bookings {
			_ = writer.Write([]string{
				fmt.Sprint(row["ba_name"]),
				fmt.Sprint(row["level"]),
				fmt.Sprint(booking["project_name"]),
				fmt.Sprint(booking["start_date"]),
				fmt.Sprint(booking["end_date"]),
				fmt.Sprint(booking["capacity_percent"]),
				fmt.Sprint(booking["status"]),
				fmt.Sprint(booking["requester_name"]),
				period,
			})
		}
	}
	writer.Flush()
}

func (app *App) utilizationReportPayload(r *http.Request) (map[string]any, int, error) {
	user, err := app.currentUser(r)
	if err != nil {
		return nil, http.StatusUnauthorized, fmt.Errorf("authentication required")
	}
	if !canExportReports(user.Role) {
		return nil, http.StatusForbidden, fmt.Errorf("Manager role required for reports")
	}
	_ = app.syncBookingStatuses(r.Context())
	month := strings.TrimSpace(r.URL.Query().Get("month"))
	if month == "" {
		month = "2026-06"
	}
	startDate, endDate, err := monthRange(month)
	if err != nil {
		return nil, http.StatusBadRequest, err
	}
	nextMonthStart, nextMonthEnd, _ := monthRange(shiftMonth(month, 1))
	rows, err := app.activeBAProfiles(r.Context())
	if err != nil {
		return nil, http.StatusInternalServerError, err
	}
	workingDays := len(workingDaysInRange(startDate, endDate))
	resultRows := make([]map[string]any, 0, len(rows))
	for _, ba := range rows {
		bookings, _ := app.fetchBookingsForBA(r.Context(), ba.ID, startDate, endDate)
		capRows := make([]CapacityBooking, 0, len(bookings))
		bookingViews := make([]map[string]any, 0, len(bookings))
		projects := map[string]bool{}
		for _, booking := range bookings {
			capRows = append(capRows, CapacityBooking{ID: booking.ID, BAID: booking.BAID, StartDate: booking.StartDate, EndDate: booking.EndDate, CapacityPercent: booking.CapacityPercent, Status: booking.Status})
			requesterName := ""
			if requester, err := app.findUserByID(r.Context(), booking.RequesterID); err == nil {
				requesterName = requester.FullName
			}
			projectName := ""
			if booking.Project != nil {
				projectName = booking.Project.Name
			}
			bookingViews = append(bookingViews, map[string]any{"project_name": projectName, "start_date": toDateKey(booking.StartDate), "end_date": toDateKey(booking.EndDate), "capacity_percent": booking.CapacityPercent, "status": booking.Status, "requester_name": requesterName})
			projects[booking.ProjectID] = true
		}
		bookedDays := round1(calculateHistoricalBookedWorkingDays(capRows, startDate, endDate))
		resultRows = append(resultRows, map[string]any{"ba_id": ba.ID, "ba_name": ba.FullName, "level": ba.Level, "status": ba.Status, "period": month, "working_days": workingDays, "booked_days": bookedDays, "utilization_percent": calculateUtilizationPercent(bookedDays, workingDays), "project_count": len(projects), "bookings": bookingViews})
	}
	currentCount, _ := app.countOfficialBookings(r.Context(), startDate, endDate)
	nextCount, _ := app.countOfficialBookings(r.Context(), nextMonthStart, nextMonthEnd)
	avg := 0.0
	for _, row := range resultRows { avg += row["utilization_percent"].(float64) }
	if len(resultRows) > 0 { avg = round1(avg / float64(len(resultRows))) }
	return map[string]any{"period": month, "start_date": toDateKey(startDate), "end_date": toDateKey(endDate), "active_ba_count": len(resultRows), "total_booking_count": currentCount, "next_month_booking_count": nextCount, "average_utilization_percent": avg, "rows": resultRows}, http.StatusOK, nil
}

func (app *App) managerSummaryPayload(r *http.Request) (map[string]any, int, error) {
	user, err := app.currentUser(r)
	if err != nil {
		return nil, http.StatusUnauthorized, fmt.Errorf("authentication required")
	}
	if !canExportReports(user.Role) {
		return nil, http.StatusForbidden, fmt.Errorf("Manager role required for reports")
	}
	_ = app.syncBookingStatuses(r.Context())
	startDate, endDate, err := resolveTimeframe(strings.TrimSpace(r.URL.Query().Get("from")), strings.TrimSpace(r.URL.Query().Get("to")))
	if err != nil {
		return nil, http.StatusBadRequest, err
	}
	bas, err := app.activeBAProfiles(r.Context())
	if err != nil {
		return nil, http.StatusInternalServerError, err
	}
	workingDays := len(workingDaysInRange(startDate, endDate))
	baRows := make([]map[string]any, 0, len(bas))
	allBookings := make([]Booking, 0)
	for _, ba := range bas {
		bookings, _ := app.fetchBookingsForBA(r.Context(), ba.ID, startDate, endDate)
		allBookings = append(allBookings, bookings...)
		capRows := make([]CapacityBooking, 0, len(bookings))
		for _, booking := range bookings {
			capRows = append(capRows, CapacityBooking{ID: booking.ID, BAID: booking.BAID, StartDate: booking.StartDate, EndDate: booking.EndDate, CapacityPercent: booking.CapacityPercent, Status: booking.Status})
		}
		capacity := getRangeCapacity(capRows, startDate, endDate, "")
		bookedManDays := round1(calculateHistoricalBookedWorkingDays(capRows, startDate, endDate))
		utilization := calculateUtilizationPercent(bookedManDays, workingDays)
		label := classifyCapacity(utilization)
		if capacity.MaxRiskCapacity > 100 { label = "OVERBOOKED" }
		baRows = append(baRows, map[string]any{"ba_id": ba.ID, "ba_name": ba.FullName, "level": ba.Level, "booked_man_days": bookedManDays, "available_man_days": workingDays, "utilization_percent": utilization, "approved_capacity": capacity.MaxApprovedCapacity, "pending_capacity": capacity.MaxPendingCapacity, "risk_capacity": capacity.MaxRiskCapacity, "capacity_label": label, "current_projects": summarizeCurrentProjects(bookings)})
	}
	totalManDays := 0.0
	totalAvailable := 0
	benchCount := 0
	overbookedCount := 0
	distribution := map[string]int{"bench": 0, "low": 0, "available": 0, "high": 0, "full": 0, "overbooked": 0}
	for _, row := range baRows {
		totalManDays += row["booked_man_days"].(float64)
		totalAvailable += row["available_man_days"].(int)
		label := strings.ToLower(row["capacity_label"].(string))
		distribution[label]++
		if row["utilization_percent"].(float64) == 0 { benchCount++ }
		if row["risk_capacity"].(int) > 100 { overbookedCount++ }
	}
	pendingRequests, unassignedRequests, urgentRequests := app.pendingActionCounts(r.Context(), startDate, endDate)
	projectEffort, _ := app.projectEffortRowsFromBookings(allBookings, startDate, endDate)
	return map[string]any{
		"timeframe": map[string]string{"from": toDateKey(startDate), "to": toDateKey(endDate)},
		"team": map[string]any{"total_ba": len(baRows), "team_utilization_percent": calculateUtilizationPercent(totalManDays, totalAvailable), "bench_count": benchCount, "bench_rate_percent": calculateBenchRate(benchCount, len(baRows)), "overbooked_count": overbookedCount, "total_man_days": round1(totalManDays), "total_available_man_days": totalAvailable},
		"actions": map[string]any{"pending_requests": pendingRequests, "unassigned_requests": unassignedRequests, "urgent_requests": urgentRequests, "overbooked_ba": overbookedCount, "bench_ba": benchCount},
		"capacity_distribution": distribution,
		"ba_utilization": baRows,
		"project_effort": projectEffort,
	}, http.StatusOK, nil
}

func (app *App) activeBAProfiles(ctx context.Context) ([]BAProfile, error) {
	rows, err := app.DB.Pool.Query(ctx, `select id, user_id, full_name, email, phone, level, joined_date, avatar_url, status, status_reason, status_changed_at, created_at, updated_at, version from ba_profiles where status = 'ACTIVE' order by full_name asc`)
	if err != nil { return nil, err }
	defer rows.Close()
	items := make([]BAProfile, 0)
	for rows.Next() {
		item, err := scanBAProfile(rows)
		if err != nil { return nil, err }
		items = append(items, *item)
	}
	return items, rows.Err()
}

func (app *App) countOfficialBookings(ctx context.Context, startDate, endDate time.Time) (int, error) {
	var count int
	err := app.DB.Pool.QueryRow(ctx, `select count(*) from bookings b join ba_profiles ba on ba.id = b.ba_id where ba.status = 'ACTIVE' and b.start_date <= $2 and b.end_date >= $1 and b.status in ('APPROVED','IN_PROGRESS','COMPLETED')`, startDate, endDate).Scan(&count)
	return count, err
}

func (app *App) pendingActionCounts(ctx context.Context, startDate, endDate time.Time) (int, int, int) {
	var pending, unassigned, urgent int
	_ = app.DB.Pool.QueryRow(ctx, `select count(*) from bookings where status = 'PENDING' and start_date <= $2 and end_date >= $1`, startDate, endDate).Scan(&pending)
	_ = app.DB.Pool.QueryRow(ctx, `select count(*) from bookings where status = 'PENDING' and ba_id is null and start_date <= $2 and end_date >= $1`, startDate, endDate).Scan(&unassigned)
	_ = app.DB.Pool.QueryRow(ctx, `select count(*) from bookings where status = 'PENDING' and priority = 'URGENT' and start_date <= $2 and end_date >= $1`, startDate, endDate).Scan(&urgent)
	return pending, unassigned, urgent
}

func (app *App) projectEffortRows(ctx context.Context, startDate, endDate time.Time) ([]map[string]any, float64, error) {
	rows, err := app.DB.Pool.Query(ctx, `select id, ba_id, project_id, requester_id, manager_id, title, description, notes, pending_changes, start_date, end_date, capacity_percent, priority, status, reject_reason, cancel_reason, manager_comment, approved_at, rejected_at, cancelled_at, created_at, updated_at from bookings where status in ('APPROVED','IN_PROGRESS','COMPLETED') and start_date <= $2 and end_date >= $1`, startDate, endDate)
	if err != nil { return nil, 0, err }
	defer rows.Close()
	bookings := make([]Booking, 0)
	for rows.Next() {
		booking, err := scanBooking(rows)
		if err != nil { return nil, 0, err }
		project, _ := app.loadProject(ctx, booking.ProjectID)
		booking.Project = project
		bookings = append(bookings, *booking)
	}
	result, total := app.projectEffortRowsFromBookings(bookings, startDate, endDate)
	return result, total, nil
}

func (app *App) projectEffortRowsFromBookings(bookings []Booking, startDate, endDate time.Time) ([]map[string]any, float64) {
	projectMap := map[string]map[string]any{}
	for _, booking := range bookings {
		if booking.Project == nil {
			continue
		}
		current, ok := projectMap[booking.ProjectID]
		if !ok {
			current = map[string]any{"project_id": booking.Project.ID, "project_name": booking.Project.Name, "color": booking.Project.Color, "man_days": 0.0, "booking_count": 0, "ba_ids": []string{}}
			projectMap[booking.ProjectID] = current
		}
		capBooking := CapacityBooking{ID: booking.ID, BAID: booking.BAID, StartDate: booking.StartDate, EndDate: booking.EndDate, CapacityPercent: booking.CapacityPercent, Status: booking.Status}
		current["man_days"] = current["man_days"].(float64) + calculateBookingManDays(capBooking, startDate, endDate)
		current["booking_count"] = current["booking_count"].(int) + 1
		if booking.BAID != nil {
			current["ba_ids"] = append(current["ba_ids"].([]string), *booking.BAID)
		}
	}
	total := 0.0
	rows := make([]map[string]any, 0, len(projectMap))
	for _, item := range projectMap {
		manDays := round1(item["man_days"].(float64))
		total += manDays
		rows = append(rows, map[string]any{"project_id": item["project_id"], "project_name": item["project_name"], "color": item["color"], "man_days": manDays, "booking_count": item["booking_count"], "ba_ids": uniqueSortedStrings(item["ba_ids"].([]string))})
	}
	for _, row := range rows {
		baIDs := row["ba_ids"].([]string)
		row["ba_count"] = len(baIDs)
		row["allocation_percent"] = calculateUtilizationPercent(row["man_days"].(float64), int(total))
		delete(row, "ba_ids")
	}
	sort.Slice(rows, func(i, j int) bool { return rows[i]["man_days"].(float64) > rows[j]["man_days"].(float64) })
	return rows, round1(total)
}

func shiftMonth(month string, offset int) string {
	start, _, err := monthRange(month)
	if err != nil { return month }
	return start.AddDate(0, offset, 0).Format("2006-01")
}
