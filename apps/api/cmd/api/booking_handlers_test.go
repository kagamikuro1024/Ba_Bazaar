package main

import (
	"context"
	"testing"
)

func TestNormalizeBookingInputAllowsEmptyDescription(t *testing.T) {
	cases := []struct {
		name        string
		description *string
		want        string
	}{
		{name: "missing", description: nil, want: ""},
		{name: "blank", description: stringPtr("   "), want: ""},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			input := bookingInput{
				ProjectID:       stringPtr("project-1"),
				Title:           stringPtr("Discovery sprint"),
				Description:     tc.description,
				StartDate:       stringPtr("2026-06-20"),
				EndDate:         stringPtr("2026-06-24"),
				CapacityPercent: intPtr(50),
			}

			got, _, err := (&App{}).normalizeBookingInput(context.Background(), input)
			if err != nil {
				t.Fatalf("normalizeBookingInput returned error: %v", err)
			}
			if got.Description != tc.want {
				t.Fatalf("Description = %q, want %q", got.Description, tc.want)
			}
		})
	}
}
