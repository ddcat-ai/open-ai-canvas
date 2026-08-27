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

func TestQueryAPICallLogsSearchesFailureFields(t *testing.T) {
	db, err := gorm.Open(sqlite.Open("file:api-log-error-search?mode=memory&cache=shared"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&model.User{}, &model.ModelChannel{}, &model.ApiCallLog{}); err != nil {
		t.Fatal(err)
	}
	now := time.Now()
	item := model.ApiCallLog{
		ID:          "api-log-1",
		UserID:      "user-1",
		RequestKind: "create",
		Status:      model.ApiCallStatusFailed,
		ErrorCode:   "request_not_sent",
		Error:       "模型服务拒绝了请求，请检查模型和参数；上游：invalid parameter: size",
		CreatedAt:   now,
	}
	if err := db.Create(&item).Error; err != nil {
		t.Fatal(err)
	}
	repo := New(db)
	for _, keyword := range []string{"模型服务拒绝", "invalid parameter", "request_not_sent"} {
		logs, total, err := repo.QueryAPICallLogs(APICallLogFilter{
			AnalyticsFilter: AnalyticsFilter{From: now.Add(-time.Hour), To: now.Add(time.Hour)},
			Keyword:         keyword,
			Page:            1,
			Limit:           20,
		})
		if err != nil {
			t.Fatalf("QueryAPICallLogs(%q) error = %v", keyword, err)
		}
		if total != 1 || len(logs) != 1 || logs[0].ID != item.ID {
			t.Fatalf("QueryAPICallLogs(%q) = total:%d logs:%#v", keyword, total, logs)
		}
	}
}
