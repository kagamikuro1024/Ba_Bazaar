package main

import (
	"context"
	"sync"
	"time"
)

var featureFlagsCache = struct {
	sync.RWMutex
	flags  map[string]bool
	expiry time.Time
}{flags: make(map[string]bool)}

// isAIFeatureEnabled checks if an AI feature flag is active.
// It uses a lightweight cache (expires after 10s) to keep database queries minimal.
func (app *App) isAIFeatureEnabled(ctx context.Context, key string) bool {
	featureFlagsCache.RLock()
	if time.Now().Before(featureFlagsCache.expiry) {
		val, ok := featureFlagsCache.flags[key]
		featureFlagsCache.RUnlock()
		if ok {
			return val
		}
	} else {
		featureFlagsCache.RUnlock()
	}

	featureFlagsCache.Lock()
	defer featureFlagsCache.Unlock()

	// Double check under write lock
	if time.Now().Before(featureFlagsCache.expiry) {
		if val, ok := featureFlagsCache.flags[key]; ok {
			return val
		}
	}

	rows, err := app.DB.Pool.Query(ctx, `select key, enabled from ai_feature_flags`)
	if err == nil {
		defer rows.Close()
		featureFlagsCache.flags = make(map[string]bool)
		for rows.Next() {
			var k string
			var e bool
			if err := rows.Scan(&k, &e); err == nil {
				featureFlagsCache.flags[k] = e
			}
		}
		featureFlagsCache.expiry = time.Now().Add(10 * time.Second)
	}

	val, ok := featureFlagsCache.flags[key]
	if !ok {
		// If flag does not exist, default to true (don't break existing functionality)
		return true
	}
	return val
}

// getAISetting retrieves a system setting value by key, fallback to default.
func (app *App) getAISetting(ctx context.Context, key, fallback string) string {
	var val string
	err := app.DB.Pool.QueryRow(ctx, `select value from ai_settings where key = $1`, key).Scan(&val)
	if err != nil {
		return fallback
	}
	return val
}
