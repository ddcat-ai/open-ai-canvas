package service

import (
	"strings"
	"testing"
	"time"

	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/repository"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func newAgentRunTestDB(t *testing.T) (*gorm.DB, *repository.Repository, *Service) {
	t.Helper()
	db, err := gorm.Open(sqlite.Open("file:agent-run-"+newID()+"?mode=memory&cache=shared"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if sqlDB, err := db.DB(); err == nil {
		sqlDB.SetMaxOpenConns(1)
	}
	if err := db.AutoMigrate(&model.AgentRun{}, &model.AgentRunStep{}, &model.Project{}); err != nil {
		t.Fatal(err)
	}
	repo := repository.New(db)
	svc := &Service{repo: repo}
	return db, repo, svc
}

func createTestProject(t *testing.T, repo *repository.Repository, userID, projectID string) {
	t.Helper()
	now := time.Now()
	project := &model.Project{
		ID:        projectID,
		UserID:    userID,
		Name:      "Test Project",
		Type:      "short_drama",
		Status:    model.ProjectStatusActive,
		Revision:  1,
		CreatedAt: now,
		UpdatedAt: now,
	}
	if err := repo.CreateProject(project); err != nil {
		t.Fatalf("create test project: %v", err)
	}
}

func TestStartAgentRunCreatesRunningRecord(t *testing.T) {
	_, repo, svc := newAgentRunTestDB(t)
	createTestProject(t, repo, "user-1", "project-1")

	run, err := svc.StartAgentRun("user-1", StartAgentRunRequest{
		ProjectID:    "project-1",
		AgentKind:    "codex",
		InputSummary: "把剧本拆成8个分镜",
	})
	if err != nil {
		t.Fatalf("StartAgentRun error = %v", err)
	}
	if run.ID == "" {
		t.Fatal("run.ID is empty")
	}
	if run.UserID != "user-1" {
		t.Fatalf("run.UserID = %q, want user-1", run.UserID)
	}
	if run.ProjectID != "project-1" {
		t.Fatalf("run.ProjectID = %q, want project-1", run.ProjectID)
	}
	if run.AgentKind != "codex" {
		t.Fatalf("run.AgentKind = %q, want codex", run.AgentKind)
	}
	if run.Status != AgentRunStatusRunning {
		t.Fatalf("run.Status = %q, want running", run.Status)
	}
	if run.InputSummary != "把剧本拆成8个分镜" {
		t.Fatalf("run.InputSummary = %q", run.InputSummary)
	}
	if run.StartedAt.IsZero() {
		t.Fatal("run.StartedAt is zero")
	}
	if run.CompletedAt != nil {
		t.Fatal("run.CompletedAt should be nil for running run")
	}
}

func TestStartAgentRunRejectsEmptyProject(t *testing.T) {
	_, _, svc := newAgentRunTestDB(t)

	_, err := svc.StartAgentRun("user-1", StartAgentRunRequest{ProjectID: ""})
	if err == nil {
		t.Fatal("expected error for empty projectId")
	}
}

func TestStartAgentRunRejectsEmptyUser(t *testing.T) {
	_, _, svc := newAgentRunTestDB(t)

	_, err := svc.StartAgentRun("", StartAgentRunRequest{ProjectID: "project-1"})
	if err == nil {
		t.Fatal("expected error for empty user")
	}
}

func TestStartAgentRunRejectsAnotherUsersProject(t *testing.T) {
	db, repo, svc := newAgentRunTestDB(t)
	// User B owns project-b
	createTestProject(t, repo, "user-b", "project-b")

	// User A attempts to start run against User B's project
	_, err := svc.StartAgentRun("user-a", StartAgentRunRequest{
		ProjectID: "project-b",
		AgentKind: "codex",
	})
	if err == nil {
		t.Fatal("expected error when user-a tries to start run against user-b's project")
	}

	// 验证没有 agent_runs 行被创建
	var count int64
	if err := db.Model(&model.AgentRun{}).Count(&count).Error; err != nil {
		t.Fatal(err)
	}
	if count != 0 {
		t.Fatalf("expected 0 agent_runs rows, got %d", count)
	}
}

func TestStartAgentRunRejectsNonexistentProject(t *testing.T) {
	_, _, svc := newAgentRunTestDB(t)

	_, err := svc.StartAgentRun("user-1", StartAgentRunRequest{
		ProjectID: "nonexistent-project",
		AgentKind: "codex",
	})
	if err == nil {
		t.Fatal("expected error for nonexistent project")
	}
}

func TestAgentRunCompletedLifecycle(t *testing.T) {
	_, repo, svc := newAgentRunTestDB(t)
	createTestProject(t, repo, "user-1", "project-1")

	run, err := svc.StartAgentRun("user-1", StartAgentRunRequest{ProjectID: "project-1", AgentKind: "codex"})
	if err != nil {
		t.Fatal(err)
	}

	completed, err := svc.CompleteAgentRun("user-1", run.ID, CompleteAgentRunRequest{ThreadID: "thread-abc"})
	if err != nil {
		t.Fatalf("CompleteAgentRun error = %v", err)
	}
	if completed.Status != AgentRunStatusCompleted {
		t.Fatalf("completed.Status = %q, want completed", completed.Status)
	}
	if completed.CompletedAt == nil {
		t.Fatal("completed.CompletedAt should not be nil")
	}
	if completed.ThreadID != "thread-abc" {
		t.Fatalf("completed.ThreadID = %q, want thread-abc", completed.ThreadID)
	}
}

func TestAgentRunFailedLifecycle(t *testing.T) {
	_, repo, svc := newAgentRunTestDB(t)
	createTestProject(t, repo, "user-1", "project-1")

	run, err := svc.StartAgentRun("user-1", StartAgentRunRequest{ProjectID: "project-1", AgentKind: "codex"})
	if err != nil {
		t.Fatal(err)
	}

	failed, err := svc.FailAgentRun("user-1", run.ID, FailAgentRunRequest{
		ThreadID:     "thread-xyz",
		ErrorMessage: "upstream timeout: connection refused",
	})
	if err != nil {
		t.Fatalf("FailAgentRun error = %v", err)
	}
	if failed.Status != AgentRunStatusFailed {
		t.Fatalf("failed.Status = %q, want failed", failed.Status)
	}
	if failed.CompletedAt == nil {
		t.Fatal("failed.CompletedAt should not be nil")
	}
	if failed.ErrorMessage != "upstream timeout: connection refused" {
		t.Fatalf("failed.ErrorMessage = %q", failed.ErrorMessage)
	}
	if failed.ThreadID != "thread-xyz" {
		t.Fatalf("failed.ThreadID = %q, want thread-xyz", failed.ThreadID)
	}
}

func TestAgentRunCompleteTwiceIsIdempotent(t *testing.T) {
	_, repo, svc := newAgentRunTestDB(t)
	createTestProject(t, repo, "user-1", "project-1")

	run, err := svc.StartAgentRun("user-1", StartAgentRunRequest{ProjectID: "project-1"})
	if err != nil {
		t.Fatal(err)
	}

	first, err := svc.CompleteAgentRun("user-1", run.ID, CompleteAgentRunRequest{ThreadID: "thread-1"})
	if err != nil {
		t.Fatal(err)
	}
	firstCompletedAt := first.CompletedAt

	// 第二次 complete 应为幂等，不改变状态
	second, err := svc.CompleteAgentRun("user-1", run.ID, CompleteAgentRunRequest{ThreadID: "thread-2"})
	if err != nil {
		t.Fatal(err)
	}
	if second.Status != AgentRunStatusCompleted {
		t.Fatalf("second.Status = %q, want completed", second.Status)
	}
	// threadID 不应被第二次调用覆盖（因为条件更新未命中）
	if second.ThreadID != "thread-1" {
		t.Fatalf("second.ThreadID = %q, want thread-1 (should not be overwritten)", second.ThreadID)
	}
	// completedAt 应保持不变
	if second.CompletedAt == nil || !second.CompletedAt.Equal(*firstCompletedAt) {
		t.Fatal("completedAt changed on second complete call")
	}
}

func TestAgentRunFailTwiceIsIdempotent(t *testing.T) {
	_, repo, svc := newAgentRunTestDB(t)
	createTestProject(t, repo, "user-1", "project-1")

	run, err := svc.StartAgentRun("user-1", StartAgentRunRequest{ProjectID: "project-1"})
	if err != nil {
		t.Fatal(err)
	}

	_, err = svc.FailAgentRun("user-1", run.ID, FailAgentRunRequest{ErrorMessage: "first error"})
	if err != nil {
		t.Fatal(err)
	}

	// 第二次 fail 应为幂等，不改变错误信息
	second, err := svc.FailAgentRun("user-1", run.ID, FailAgentRunRequest{ErrorMessage: "second error"})
	if err != nil {
		t.Fatal(err)
	}
	if second.Status != AgentRunStatusFailed {
		t.Fatalf("second.Status = %q, want failed", second.Status)
	}
	if second.ErrorMessage != "first error" {
		t.Fatalf("second.ErrorMessage = %q, want 'first error' (should not be overwritten)", second.ErrorMessage)
	}
}

func TestAgentRunCompletedCannotBecomeFailed(t *testing.T) {
	_, repo, svc := newAgentRunTestDB(t)
	createTestProject(t, repo, "user-1", "project-1")

	run, err := svc.StartAgentRun("user-1", StartAgentRunRequest{ProjectID: "project-1"})
	if err != nil {
		t.Fatal(err)
	}

	if _, err := svc.CompleteAgentRun("user-1", run.ID, CompleteAgentRunRequest{}); err != nil {
		t.Fatal(err)
	}

	// 尝试将 completed 变为 failed —— 必须不覆盖
	failed, err := svc.FailAgentRun("user-1", run.ID, FailAgentRunRequest{ErrorMessage: "should not overwrite"})
	if err != nil {
		t.Fatal(err)
	}
	if failed.Status != AgentRunStatusCompleted {
		t.Fatalf("failed.Status = %q, want completed (terminal state must not be overwritten)", failed.Status)
	}
	if failed.ErrorMessage != "" {
		t.Fatalf("failed.ErrorMessage = %q, want empty (completed run must not get error message)", failed.ErrorMessage)
	}
}

func TestAgentRunFailedCannotBecomeCompleted(t *testing.T) {
	_, repo, svc := newAgentRunTestDB(t)
	createTestProject(t, repo, "user-1", "project-1")

	run, err := svc.StartAgentRun("user-1", StartAgentRunRequest{ProjectID: "project-1"})
	if err != nil {
		t.Fatal(err)
	}

	if _, err := svc.FailAgentRun("user-1", run.ID, FailAgentRunRequest{ErrorMessage: "original failure"}); err != nil {
		t.Fatal(err)
	}

	// 尝试将 failed 变为 completed —— 必须不覆盖
	completed, err := svc.CompleteAgentRun("user-1", run.ID, CompleteAgentRunRequest{})
	if err != nil {
		t.Fatal(err)
	}
	if completed.Status != AgentRunStatusFailed {
		t.Fatalf("completed.Status = %q, want failed (terminal state must not be overwritten)", completed.Status)
	}
	if completed.ErrorMessage != "original failure" {
		t.Fatalf("completed.ErrorMessage = %q, want 'original failure'", completed.ErrorMessage)
	}
}

func TestAgentRunFailureMessageSanitized(t *testing.T) {
	_, repo, svc := newAgentRunTestDB(t)
	createTestProject(t, repo, "user-1", "project-1")

	run, err := svc.StartAgentRun("user-1", StartAgentRunRequest{ProjectID: "project-1"})
	if err != nil {
		t.Fatal(err)
	}

	longError := strings.Repeat("x", maxAgentRunErrorMessage+100)
	failed, err := svc.FailAgentRun("user-1", run.ID, FailAgentRunRequest{ErrorMessage: longError})
	if err != nil {
		t.Fatal(err)
	}
	if len([]rune(failed.ErrorMessage)) > maxAgentRunErrorMessage {
		t.Fatalf("error message length = %d, want <= %d", len([]rune(failed.ErrorMessage)), maxAgentRunErrorMessage)
	}
}

func TestAgentRunInputSummarySanitized(t *testing.T) {
	_, repo, svc := newAgentRunTestDB(t)
	createTestProject(t, repo, "user-1", "project-1")

	longInput := strings.Repeat("y", maxAgentRunInputSummary+100)
	run, err := svc.StartAgentRun("user-1", StartAgentRunRequest{ProjectID: "project-1", InputSummary: longInput})
	if err != nil {
		t.Fatal(err)
	}
	if len([]rune(run.InputSummary)) > maxAgentRunInputSummary {
		t.Fatalf("input summary length = %d, want <= %d", len([]rune(run.InputSummary)), maxAgentRunInputSummary)
	}
}

func TestAgentRunUserIsolation(t *testing.T) {
	db, repo, svc := newAgentRunTestDB(t)
	createTestProject(t, repo, "user-1", "project-1")

	run, err := svc.StartAgentRun("user-1", StartAgentRunRequest{ProjectID: "project-1"})
	if err != nil {
		t.Fatal(err)
	}

	// 另一个用户不能读取
	_, err = svc.GetAgentRun("user-2", run.ID)
	if err == nil {
		t.Fatal("expected error when user-2 tries to read user-1's run")
	}
	if err != repository.ErrAgentRunNotFound {
		t.Fatalf("error = %v, want ErrAgentRunNotFound", err)
	}

	// 另一个用户不能完成
	_, err = svc.CompleteAgentRun("user-2", run.ID, CompleteAgentRunRequest{})
	if err == nil {
		t.Fatal("expected error when user-2 tries to complete user-1's run")
	}

	// 另一个用户不能标记失败
	_, err = svc.FailAgentRun("user-2", run.ID, FailAgentRunRequest{ErrorMessage: "hack"})
	if err == nil {
		t.Fatal("expected error when user-2 tries to fail user-1's run")
	}

	// 原始用户仍可读取
	fetched, err := svc.GetAgentRun("user-1", run.ID)
	if err != nil {
		t.Fatalf("user-1 GetAgentRun error = %v", err)
	}
	if fetched.ID != run.ID {
		t.Fatalf("fetched.ID = %q, want %q", fetched.ID, run.ID)
	}

	// 确认数据库中状态仍为 running（未被 user-2 篡改）
	var persisted model.AgentRun
	if err := db.First(&persisted, "id = ?", run.ID).Error; err != nil {
		t.Fatal(err)
	}
	if persisted.Status != AgentRunStatusRunning {
		t.Fatalf("persisted.Status = %q, want running (user-2 should not have modified it)", persisted.Status)
	}
}

func TestAgentRunNormalizesAgentKind(t *testing.T) {
	_, repo, svc := newAgentRunTestDB(t)
	createTestProject(t, repo, "user-1", "project-1")

	cases := []struct {
		input string
		want  string
	}{
		{"codex", "codex"},
		{"Codex", "codex"},
		{"claude", "claude"},
		{"Claude", "claude"},
		{"", "codex"},
		{"unknown", "codex"},
	}
	for _, tc := range cases {
		run, err := svc.StartAgentRun("user-1", StartAgentRunRequest{ProjectID: "project-1", AgentKind: tc.input})
		if err != nil {
			t.Fatalf("AgentKind=%q: error = %v", tc.input, err)
		}
		if run.AgentKind != tc.want {
			t.Fatalf("AgentKind=%q: got %q, want %q", tc.input, run.AgentKind, tc.want)
		}
	}
}

func TestAgentRunGetNotFound(t *testing.T) {
	_, _, svc := newAgentRunTestDB(t)

	_, err := svc.GetAgentRun("user-1", "nonexistent-id")
	if err == nil {
		t.Fatal("expected error for nonexistent run")
	}
	if err != repository.ErrAgentRunNotFound {
		t.Fatalf("error = %v, want ErrAgentRunNotFound", err)
	}
}
