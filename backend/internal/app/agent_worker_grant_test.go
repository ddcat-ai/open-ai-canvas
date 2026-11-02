package app

import (
	"errors"
	"strings"
	"testing"
	"time"

	"gorm.io/gorm"
	"yingce/backend/internal/model"
)

func seedLeasedRun(t *testing.T, db *gorm.DB, svc *Service) model.CloudAgentExecution {
	t.Helper()
	seedPiRun(t, db, model.CloudAgentExecution{ID: "run-x", UserID: "user-a", Status: "running"})
	claimed, err := svc.repo.ClaimPiAgentRun("w:0", time.Now().UTC().Add(45*time.Second), model.DefaultAgentSchedulerSetting())
	if err != nil || claimed == nil {
		t.Fatalf("setup claim failed: %+v err=%v", claimed, err)
	}
	return *claimed
}

func TestAgentWorkerSeedAndIdentity(t *testing.T) {
	svc, _ := newAgentWorkerTestService(t)

	t.Setenv("CANVAS_AGENT_WORKER_ID", "compose")
	t.Setenv("CANVAS_AGENT_WORKER_TOKEN", strings.Repeat("w", 32))
	if err := svc.SeedAgentWorker(); err != nil {
		t.Fatalf("seed failed: %v", err)
	}
	worker, err := svc.AuthenticateAgentWorker("compose", strings.Repeat("w", 32))
	if err != nil || worker.ID != "compose" {
		t.Fatalf("seeded identity must authenticate: worker=%+v err=%v", worker, err)
	}
	// insert-only 播种：吊销后再启动不得复活。
	if err := svc.repo.RevokeAgentWorker("compose"); err != nil {
		t.Fatal(err)
	}
	if err := svc.SeedAgentWorker(); err != nil {
		t.Fatalf("re-seed must stay silent: %v", err)
	}
	if _, err := svc.AuthenticateAgentWorker("compose", strings.Repeat("w", 32)); !errors.Is(err, gorm.ErrRecordNotFound) {
		t.Fatalf("revoked credential must stay revoked, err=%v", err)
	}

	t.Setenv("CANVAS_AGENT_WORKER_ID", "compose")
	t.Setenv("CANVAS_AGENT_WORKER_TOKEN", "weak")
	if err := svc.SeedAgentWorker(); err == nil {
		t.Fatal("seed must reject weak secrets")
	}
	t.Setenv("CANVAS_AGENT_WORKER_ID", "-bad")
	t.Setenv("CANVAS_AGENT_WORKER_TOKEN", strings.Repeat("w", 33))
	if err := svc.SeedAgentWorker(); err == nil {
		t.Fatal("seed must reject invalid ids")
	}
	t.Setenv("CANVAS_AGENT_WORKER_ID", "")
	t.Setenv("CANVAS_AGENT_WORKER_TOKEN", "")
	if err := svc.SeedAgentWorker(); err != nil {
		t.Fatal("absent bootstrap envs must be a silent no-op")
	}
}

func TestAgentRunGrantMatrix(t *testing.T) {
	t.Setenv("CANVAS_AGENT_INTERNAL_TOKEN", strings.Repeat("t", 32))
	t.Setenv("CANVAS_AGENT_WORKER_ID", "w")
	t.Setenv("CANVAS_AGENT_WORKER_TOKEN", strings.Repeat("w", 32))
	svc, db := newAgentWorkerTestService(t)
	if err := svc.SeedAgentWorker(); err != nil {
		t.Fatal(err)
	}
	seedLeasedRun(t, db, svc)

	token, err := svc.IssueAgentRunGrant("w", "w:0", "user-a", "run-x", 1)
	if err != nil {
		t.Fatalf("grant issuance failed: %v", err)
	}
	if !strings.HasPrefix(token, "run.") {
		t.Fatalf("grant shape must be run.<payload>.<sig>: %q", token)
	}
	if got, err := svc.AgentRunGrantWorker(token); err != nil || got != "w" {
		t.Fatalf("grant identity parse failed: %q err=%v", got, err)
	}
	cases := []struct {
		name   string
		userID string
		runID  string
		owner  string
		epoch  int64
		want   bool
	}{
		{"matching headers", "user-a", "run-x", "w:0", 1, true},
		{"foreign user", "user-b", "run-x", "w:0", 1, false},
		{"wrong run", "user-a", "run-y", "w:0", 1, false},
		{"wrong owner slot", "user-a", "run-x", "w:9", 1, false},
		{"stale fencing epoch", "user-a", "run-x", "w:0", 0, false},
	}
	for _, tc := range cases {
		if got := svc.ValidateAgentRunGrant(token, tc.userID, tc.runID, tc.owner, tc.epoch); got != tc.want {
			t.Fatalf("%s: got %v want %v", tc.name, got, tc.want)
		}
	}
	if svc.ValidateAgentRunGrant("run.mangled.mangled", "user-a", "run-x", "w:0", 1) {
		t.Fatal("garbage tokens must fail")
	}

	// 吊销即时生效：与签名或 token 余期无关。
	if err := svc.repo.RevokeAgentWorker("w"); err != nil {
		t.Fatal(err)
	}
	if svc.ValidateAgentRunGrant(token, "user-a", "run-x", "w:0", 1) {
		t.Fatal("revoked worker grant must fail despite a valid signature")
	}
}

func TestClaimServiceTerminalizesExhaustedRecovery(t *testing.T) {
	svc, db := newAgentWorkerTestService(t)
	seedPiRun(t, db, model.CloudAgentExecution{ID: "run-x", UserID: "user-a", Status: "running"})
	if err := db.Model(&model.CloudAgentExecution{}).Where("id = ?", "run-x").Updates(map[string]any{
		"recovery_attempts": 5, "recovery_started_at": time.Now().UTC(),
	}).Error; err != nil {
		t.Fatal(err)
	}
	if _, err := svc.ClaimPiAgentForWorker("w:0", ""); err == nil {
		t.Fatal("exhausted budget must refuse the claim")
	}
	var run model.CloudAgentExecution
	if err := db.Where("id = ?", "run-x").First(&run).Error; err != nil {
		t.Fatal(err)
	}
	if run.Status != "failed" || !run.CleanupPending {
		t.Fatalf("exhausted claim must terminalize the run: %+v", run)
	}
}

func TestLeaseTimeColumnsAreUTC(t *testing.T) {
	svc, db := newAgentWorkerTestService(t)
	seedLeasedRun(t, db, svc)
	// UTC 守则的直接证据：租约列的落盘文本必须是 UTC 时区。SQLite 的文本比较
	// 对时区偏移敏感，混入本地时区会把未来租约判成已过期（fork 的历史事故，
	// 见 RFC #943 P2/P3 设计 §1.5）。
	var text string
	if err := db.Raw("SELECT CAST(lease_expires_at AS TEXT) FROM cloud_agent_executions WHERE id = ?", "run-x").Scan(&text).Error; err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(text, "+00:00") && !strings.HasSuffix(strings.TrimSpace(text), "Z") {
		t.Fatalf("lease timestamps must be stored in UTC form, got %q", text)
	}
}
