package repository

import (
	"context"
	"database/sql"
	"strconv"
	"time"

	"infinite-canvas/backend/internal/database"
)

type DatabasePoolStats struct {
	MaxOpenConnections int           `json:"maxOpenConnections"`
	OpenConnections    int           `json:"openConnections"`
	InUse              int           `json:"inUse"`
	Idle               int           `json:"idle"`
	WaitCount          int64         `json:"waitCount"`
	WaitDuration       time.Duration `json:"-"`
	WaitDurationMs     int64         `json:"waitDurationMs"`
	MaxIdleClosed      int64         `json:"maxIdleClosed"`
	MaxLifetimeClosed  int64         `json:"maxLifetimeClosed"`
}

type PostgresRuntimeStats struct {
	ServerVersion  string  `json:"serverVersion,omitempty"`
	DatabaseBytes  int64   `json:"databaseBytes,omitempty"`
	Connections    int64   `json:"connections,omitempty"`
	MaxConnections int64   `json:"maxConnections,omitempty"`
	Transactions   int64   `json:"transactions,omitempty"`
	Rollbacks      int64   `json:"rollbacks,omitempty"`
	CacheHitRate   float64 `json:"cacheHitRate,omitempty"`
	TempFiles      int64   `json:"tempFiles,omitempty"`
	TempBytes      int64   `json:"tempBytes,omitempty"`
	Deadlocks      int64   `json:"deadlocks,omitempty"`
}

type DatabaseRuntimeStats struct {
	Driver        string                `json:"driver"`
	Connected     bool                  `json:"connected"`
	LatencyMs     int64                 `json:"latencyMs"`
	DatabaseBytes int64                 `json:"databaseBytes,omitempty"`
	Schema        database.SchemaStatus `json:"schema"`
	Pool          DatabasePoolStats     `json:"pool"`
	Postgres      *PostgresRuntimeStats `json:"postgres,omitempty"`
}

func (r *Repository) DatabaseRuntimeStats(ctx context.Context) (DatabaseRuntimeStats, error) {
	result := DatabaseRuntimeStats{Driver: r.Dialect(), Schema: database.SchemaStatus{Expected: database.CurrentSchemaVersion}}
	sqlDB, err := r.db.DB()
	if err != nil {
		return result, err
	}
	started := time.Now()
	if err := sqlDB.PingContext(ctx); err != nil {
		return result, err
	}
	result.Connected = true
	result.LatencyMs = max(1, time.Since(started).Milliseconds())
	result.Pool = databasePoolStats(sqlDB.Stats())
	if schema, schemaErr := database.ReadSchemaStatus(r.db.WithContext(ctx)); schemaErr == nil {
		result.Schema = schema
	}
	if result.Driver == "postgres" {
		result.Postgres, err = r.postgresRuntimeStats(ctx)
		if result.Postgres != nil {
			result.DatabaseBytes = result.Postgres.DatabaseBytes
		}
		return result, err
	}
	if result.Driver == "sqlite" {
		var pageCount, pageSize int64
		if r.db.WithContext(ctx).Raw("PRAGMA page_count").Scan(&pageCount).Error == nil && r.db.WithContext(ctx).Raw("PRAGMA page_size").Scan(&pageSize).Error == nil {
			result.DatabaseBytes = pageCount * pageSize
		}
	}
	return result, nil
}

func databasePoolStats(stats sql.DBStats) DatabasePoolStats {
	return DatabasePoolStats{
		MaxOpenConnections: stats.MaxOpenConnections, OpenConnections: stats.OpenConnections, InUse: stats.InUse, Idle: stats.Idle,
		WaitCount: stats.WaitCount, WaitDuration: stats.WaitDuration, WaitDurationMs: stats.WaitDuration.Milliseconds(),
		MaxIdleClosed: stats.MaxIdleClosed, MaxLifetimeClosed: stats.MaxLifetimeClosed,
	}
}

func (r *Repository) postgresRuntimeStats(ctx context.Context) (*PostgresRuntimeStats, error) {
	stats := &PostgresRuntimeStats{}
	if err := r.db.WithContext(ctx).Raw("SHOW server_version").Scan(&stats.ServerVersion).Error; err != nil {
		return stats, err
	}
	var maxConnections string
	if err := r.db.WithContext(ctx).Raw("SHOW max_connections").Scan(&maxConnections).Error; err == nil {
		stats.MaxConnections, _ = strconv.ParseInt(maxConnections, 10, 64)
	}
	var blocksRead, blocksHit int64
	err := r.db.WithContext(ctx).Raw(`
		SELECT pg_database_size(current_database()) AS database_bytes,
		       numbackends AS connections, xact_commit AS transactions, xact_rollback AS rollbacks,
		       blks_read, blks_hit, temp_files, temp_bytes, deadlocks
		FROM pg_stat_database WHERE datname = current_database()
	`).Row().Scan(&stats.DatabaseBytes, &stats.Connections, &stats.Transactions, &stats.Rollbacks, &blocksRead, &blocksHit, &stats.TempFiles, &stats.TempBytes, &stats.Deadlocks)
	if blocksRead+blocksHit > 0 {
		stats.CacheHitRate = float64(blocksHit) / float64(blocksRead+blocksHit) * 100
	}
	return stats, err
}
