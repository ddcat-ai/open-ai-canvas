package logging

import (
	"context"
	"errors"
	"log/slog"
	"time"

	"gorm.io/gorm"
	gormlogger "gorm.io/gorm/logger"
)

// GormLogger 把 GORM 日志接入统一 Handler：成功的 SQL 一律不输出，只记录失败与慢查询。
// SQL 以参数化形式输出（不内联参数值），避免密码哈希、token 等写进日志。
func GormLogger() gormlogger.Interface {
	return gormLogger{level: gormlogger.Warn}
}

type gormLogger struct {
	level gormlogger.LogLevel
}

func (l gormLogger) LogMode(level gormlogger.LogLevel) gormlogger.Interface {
	l.level = level
	return l
}

func (l gormLogger) Info(ctx context.Context, msg string, data ...any) {
	if l.level >= gormlogger.Info {
		slog.InfoContext(ctx, "gorm: "+msg, "data", data)
	}
}

func (l gormLogger) Warn(ctx context.Context, msg string, data ...any) {
	if l.level >= gormlogger.Warn {
		slog.WarnContext(ctx, "gorm: "+msg, "data", data)
	}
}

func (l gormLogger) Error(ctx context.Context, msg string, data ...any) {
	if l.level >= gormlogger.Error {
		slog.ErrorContext(ctx, "gorm: "+msg, "data", data)
	}
}

func (l gormLogger) Trace(ctx context.Context, begin time.Time, fc func() (string, int64), err error) {
	if l.level <= gormlogger.Silent {
		return
	}
	elapsed := time.Since(begin)
	var level slog.Level
	var msg string
	switch {
	case err != nil && isExpectedQueryError(err):
		return
	case err != nil:
		if l.level < gormlogger.Error {
			return
		}
		level, msg = slog.LevelWarn, "sql failed"
	case slowSQLThreshold() > 0 && elapsed >= slowSQLThreshold():
		if l.level < gormlogger.Warn {
			return
		}
		level, msg = slog.LevelWarn, "sql slow"
	default:
		return
	}
	if ctx == nil {
		ctx = context.Background()
	}
	if !slog.Default().Enabled(ctx, level) {
		return
	}
	sql, rows := fc()
	attrs := []slog.Attr{
		slog.Int64("duration_ms", elapsed.Milliseconds()),
		slog.Int64("rows", rows),
		slog.String("sql", truncate(sql, 2000)),
	}
	if err != nil {
		attrs = append(attrs, slog.String("error", err.Error()))
	}
	slog.LogAttrs(ctx, level, msg, attrs...)
}

// ParamsFilter 让 GORM 在生成日志用的 SQL 时丢弃参数值。
func (gormLogger) ParamsFilter(_ context.Context, sql string, _ ...any) (string, []any) {
	return sql, nil
}

// 查不到记录、请求取消属于正常业务分支，由调用方决定是否需要记录。
func isExpectedQueryError(err error) bool {
	return errors.Is(err, gorm.ErrRecordNotFound) || errors.Is(err, context.Canceled)
}

func truncate(value string, limit int) string {
	if len(value) <= limit {
		return value
	}
	return value[:limit] + "...(truncated)"
}
