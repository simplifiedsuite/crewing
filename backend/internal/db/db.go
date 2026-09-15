package db

import (
	"context"
	"fmt"
	"os"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

func Connect(ctx context.Context) (*pgxpool.Pool, error) {
	url := os.Getenv("DATABASE_URL")
	if url == "" {
		return nil, fmt.Errorf("DATABASE_URL is not set")
	}
	config, err := pgxpool.ParseConfig(url)
	if err != nil {
		return nil, fmt.Errorf("parsing DATABASE_URL: %w", err)
	}
	// Handlers scan DATE/TIME columns straight into Go string/*string
	// fields (start_date, call_time, etc.) to match the plain "YYYY-MM-DD"
	// JSON shape the frontend prototypes already use — pgx's default binary
	// protocol can't decode those types into a string destination. Simple
	// protocol mode returns text-format results, which it can.
	config.ConnConfig.DefaultQueryExecMode = pgx.QueryExecModeSimpleProtocol

	// DATABASE_URL points at Supabase's session-mode pooler, capped at 15
	// concurrent client connections total — shared with ralto-ical (its own
	// per-request psycopg2 connections, not pooled) plus manual/dashboard
	// access. Explicit here rather than left at pgxpool's own defaults
	// (MaxConns scales with NumCPU, which is 1 on this service's current
	// plan but not something to depend on implicitly) so this pool's share
	// of the 15-connection cap is a deliberate, visible number. The actual
	// leak that exhausted the cap (2026-09-15/16) was every restart of this
	// process orphaning its open connections — main.go had no graceful
	// shutdown, so Render's SIGTERM just killed the process without ever
	// calling pool.Close(), leaving the pooler to notice the dead TCP
	// connections on its own. That's fixed in cmd/api/main.go; the tighter
	// MaxConnIdleTime/MaxConnLifetime here are defence in depth so a
	// connection this pool still owns doesn't sit around unnecessarily
	// either.
	config.MaxConns = 6
	config.MinConns = 0
	config.MaxConnIdleTime = 5 * time.Minute
	config.MaxConnLifetime = 30 * time.Minute

	pool, err := pgxpool.NewWithConfig(ctx, config)
	if err != nil {
		return nil, fmt.Errorf("connecting to database: %w", err)
	}
	if err := pool.Ping(ctx); err != nil {
		return nil, fmt.Errorf("pinging database: %w", err)
	}
	return pool, nil
}
