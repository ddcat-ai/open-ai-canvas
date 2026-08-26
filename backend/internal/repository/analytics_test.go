package repository

import (
	"context"
	"strings"
	"testing"
	"time"

	"infinite-canvas/backend/internal/model"

	"gorm.io/driver/postgres"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

type sqlCaptureLogger struct {
	statements []string
}

func TestAPICallDurationsByTaskIDsUsesLargestDurationPerOwnedTask(t *testing.T) {
	db, err := gorm.Open(sqlite.Open("file:api-call-durations?mode=memory&cache=shared"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&model.ApiCallLog{}); err != nil {
		t.Fatal(err)
	}
	logs := []model.ApiCallLog{
		{ID: "log-1", UserID: "user-1", TaskID: "task-1", DurationMs: 1200},
		{ID: "log-2", UserID: "user-1", TaskID: "task-1", DurationMs: 1800},
		{ID: "log-3", UserID: "user-1", TaskID: "task-2", DurationMs: 900},
		{ID: "log-4", UserID: "user-2", TaskID: "task-1", DurationMs: 9999},
	}
	if err := db.Create(&logs).Error; err != nil {
		t.Fatal(err)
	}

	durations, err := New(db).APICallDurationsByTaskIDs("user-1", []string{"task-1", "task-2", "missing"})
	if err != nil {
		t.Fatal(err)
	}
	if durations["task-1"] != 1800 || durations["task-2"] != 900 || durations["missing"] != 0 {
		t.Fatalf("durations = %#v", durations)
	}
}

func (l *sqlCaptureLogger) LogMode(logger.LogLevel) logger.Interface { return l }
func (*sqlCaptureLogger) Info(context.Context, string, ...any)       {}
func (*sqlCaptureLogger) Warn(context.Context, string, ...any)       {}
func (*sqlCaptureLogger) Error(context.Context, string, ...any)      {}

func (l *sqlCaptureLogger) Trace(_ context.Context, _ time.Time, query func() (string, int64), _ error) {
	statement, _ := query()
	l.statements = append(l.statements, statement)
}

func TestRecordUserActivityQualifiesPostgresConflictColumns(t *testing.T) {
	capture := &sqlCaptureLogger{}
	db, err := gorm.Open(postgres.New(postgres.Config{
		DSN:                  "host=localhost user=test dbname=test sslmode=disable",
		PreferSimpleProtocol: true,
	}), &gorm.Config{
		DisableAutomaticPing:   true,
		DryRun:                 true,
		Logger:                 capture,
		SkipDefaultTransaction: true,
	})
	if err != nil {
		t.Fatalf("open dry-run postgres database: %v", err)
	}

	repo := New(db)
	cases := []struct {
		event  string
		column string
	}{
		{event: "login", column: "login_count"},
		{event: "task", column: "task_count"},
		{event: "agent_message", column: "agent_message_count"},
		{event: "asset", column: "asset_count"},
		{event: "resource", column: "resource_count"},
	}

	for _, tc := range cases {
		t.Run(tc.event, func(t *testing.T) {
			capture.statements = nil
			if err := repo.RecordUserActivity("user-1", tc.event, 1, time.Unix(1_700_000_000, 0)); err != nil {
				t.Fatalf("record activity: %v", err)
			}
			if len(capture.statements) == 0 {
				t.Fatal("expected generated SQL")
			}
			statement := capture.statements[len(capture.statements)-1]
			if !strings.Contains(statement, "user_daily_activities."+tc.column) {
				t.Fatalf("conflict update column is not target-qualified: %s", statement)
			}
			if tc.event != "login" && !strings.Contains(statement, "COALESCE(user_daily_activities.first_active_at") {
				t.Fatalf("first active column is not target-qualified: %s", statement)
			}
		})
	}
}
