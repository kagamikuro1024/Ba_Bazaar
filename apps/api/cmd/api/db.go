package main

import (
	"context"
	"net/url"
	"os"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

type DB struct {
	Pool *pgxpool.Pool
}

func OpenDBFromEnv() (*DB, error) {
	dsn := strings.TrimSpace(os.Getenv("DATABASE_URL"))
	if dsn == "" {
		dsn = resolveLocalDatabaseURL()
	}

	parsed, err := url.Parse(dsn)
	if err != nil {
		return nil, err
	}
	query := parsed.Query()
	query.Del("schema")
	parsed.RawQuery = query.Encode()

	cfg, err := pgxpool.ParseConfig(parsed.String())
	if err != nil {
		return nil, err
	}
	cfg.MaxConns = 10
	cfg.MaxConnLifetime = 30 * time.Minute

	pool, err := pgxpool.NewWithConfig(context.Background(), cfg)
	if err != nil {
		return nil, err
	}

	if schema := strings.TrimSpace(query.Get("schema")); schema != "" {
		_, err = pool.Exec(context.Background(), "set search_path to "+pgQuoteIdent(schema))
		if err != nil {
			pool.Close()
			return nil, err
		}
	}

	return &DB{Pool: pool}, nil
}

func (db *DB) Close() {
	if db != nil && db.Pool != nil {
		db.Pool.Close()
	}
}

func pgQuoteIdent(value string) string {
	return `"` + strings.ReplaceAll(value, `"`, `""`) + `"`
}
