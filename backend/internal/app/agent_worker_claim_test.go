package app

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"testing"
	"time"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	gormcl "gorm.io/gorm/clause"
	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"
)

func newAgentWorkerTestService(t *testing.T) (*Service, *gorm.DB) {
	t.Helper()
	db, err := gorm.Open(sqlite.Open(strings.Replace(t.TempDir(), "\\", "/", 1)+"/agent-worker-test.db"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if sqlDB, err := db.DB(); err != nil {
		t.Fatal(err)
	} else {
		sqlDB.SetMaxOpenConns(1)
		t.Cleanup(func() { _ = sqlDB.Close() })
	}
	if err := db.AutoMigrate(&model.CloudAgentExecution{}, &model.AgentWorker{}, &model.AgentRuntimeInstance{}, &model.AgentSchedulerSetting{}, &model.AgentAdmissionCounter{}); err != nil {
		t.Fatal(err)
	}
	if err := db.Clauses(gormcl.OnConflict{DoNothing: true}).Create(&model.AgentAdmissionCounter{ID: 1}).Error; err != nil {
		t.Fatal(err)
	}
	svc := &Service{repo: repository.New(db)}
	return svc, db
}

func seedPiRun(t *testing.T, db *gorm.DB, run model.CloudAgentExecution) {
	t.Helper()
	if run.Revision == 0 {
		run.Revision = 1
	}
	run.Engine = "pi"
	if err := db.Create(&run).Error; err != nil {
		t.Fatal(err)
	}
}

func claimOwner(worker string, epoch int64) string {
	return worker + "@" + fmt.Sprintf("%d", epoch)
}

func TestClaimPiAgentRunFIFOAndEpoch(t *testing.T) {
	svc, db := newAgentWorkerTestService(t)
	fallback := model.DefaultAgentSchedulerSetting()
	seedPiRun(t, db, model.CloudAgentExecution{ID: "run-2", UserID: "user-a", Status: "queued", CreatedAt: time.Now().Add(-time.Minute)})
	seedPiRun(t, db, model.CloudAgentExecution{ID: "run-1", UserID: "user-a", Status: "queued", CreatedAt: time.Now().Add(-2 * time.Minute)})

	first, err := svc.repo.ClaimPiAgentRun("w:0", time.Now().UTC().Add(45*time.Second), fallback)
	if err != nil || first == nil || first.ID != "run-1" {
		t.Fatalf("FIFO expects run-1, got %+v err=%v", first, err)
	}
	if first.LeaseEpoch != 1 || first.Status != "running" || first.LeaseOwner != "w:0" || first.LeaseExpiresAt == nil || !first.LeaseExpiresAt.After(time.Now().UTC()) {
		t.Fatalf("claim state wrong: %+v", first)
	}
	second, err := svc.repo.ClaimPiAgentRun("w:1", time.Now().UTC().Add(45*time.Second), fallback)
	if err != nil || second == nil || second.ID != "run-2" {
		t.Fatalf("second claim expects run-2, got %+v err=%v", second, err)
	}
	if second.LeaseEpoch != 1 {
		t.Fatalf("fresh run must start at epoch 1: %+v", second)
	}
	third, err := svc.repo.ClaimPiAgentRun("w:2", time.Now().UTC().Add(45*time.Second), fallback)
	if err != nil {
		t.Fatal(err)
	}
	if third != nil {
		t.Fatalf("held leases must not be claimable: %+v", third)
	}
}

func TestReleaseThenReclaimAdvancesEpoch(t *testing.T) {
	svc, db := newAgentWorkerTestService(t)
	fallback := model.DefaultAgentSchedulerSetting()
	seedPiRun(t, db, model.CloudAgentExecution{ID: "run-1", UserID: "user-a", Status: "queued"})
	if _, err := svc.repo.ClaimPiAgentRun("w:0", time.Now().UTC().Add(45*time.Second), fallback); err != nil {
		t.Fatal(err)
	}
	if err := svc.repo.ReleasePiAgentLease("user-a", "run-1", "w:0", 1); err != nil {
		t.Fatal(err)
	}
	reclaimed, err := svc.repo.ClaimPiAgentRun("w:0", time.Now().UTC().Add(45*time.Second), fallback)
	if err != nil || reclaimed == nil {
		t.Fatalf("released run must be claimable: %+v err=%v", reclaimed, err)
	}
	if reclaimed.LeaseEpoch != 2 {
		t.Fatalf("reclaim must advance the fencing epoch, got %d", reclaimed.LeaseEpoch)
	}
}

func TestRenewPiAgentLeaseFencing(t *testing.T) {
	svc, db := newAgentWorkerTestService(t)
	seedPiRun(t, db, model.CloudAgentExecution{ID: "run-1", UserID: "user-a", Status: "running"})
	if err := db.Model(&model.CloudAgentExecution{}).Where("id = ?", "run-1").Updates(map[string]any{"lease_owner": "w:0", "lease_epoch": 3, "lease_expires_at": time.Now().UTC().Add(45 * time.Second)}).Error; err != nil {
		t.Fatal(err)
	}
	expiry := time.Now().UTC().Add(90 * time.Second)
	if renewed, err := svc.repo.RenewPiAgentLease("user-a", "run-1", "w:0", 3, expiry); err != nil || !renewed {
		t.Fatalf("matching epoch must renew: renewed=%v err=%v", renewed, err)
	}
	var row model.CloudAgentExecution
	if err := db.Where("id = ?", "run-1").First(&row).Error; err != nil {
		t.Fatal(err)
	}
	if !row.LeaseExpiresAt.After(time.Now().UTC().Add(60 * time.Second)) {
		t.Fatalf("renewal must extend the lease to %s: got %v", expiry, row.LeaseExpiresAt)
	}
	if renewed, err := svc.repo.RenewPiAgentLease("user-a", "run-1", "w:0", 2, expiry); err != nil || renewed {
		t.Fatalf("stale fencing epoch must not renew: renewed=%v err=%v", renewed, err)
	}
	if renewed, err := svc.repo.RenewPiAgentLease("user-a", "run-1", "other:0", 3, expiry); err != nil || renewed {
		t.Fatalf("foreign worker must not renew: renewed=%v err=%v", renewed, err)
	}
}

func TestClaimSkipsRecoveryBackoffAndCapacity(t *testing.T) {
	svc, db := newAgentWorkerTestService(t)
	fallback := model.DefaultAgentSchedulerSetting()
	fallback.MaxResidentPerUser = 1
	if err := db.Clauses(gormcl.OnConflict{UpdateAll: true}).Create(&fallback).Error; err != nil {
		t.Fatal(err)
	}
	// 用户容量到顶：live 租约持有 1 个常驻位，第二个候选被跳过并置 waiting_resource。
	seedPiRun(t, db, model.CloudAgentExecution{ID: "held", UserID: "user-a", Status: "running"})
	if err := db.Model(&model.CloudAgentExecution{}).Where("id = ?", "held").Updates(map[string]any{"lease_owner": "w:0", "lease_epoch": 1, "lease_expires_at": time.Now().UTC().Add(45 * time.Second)}).Error; err != nil {
		t.Fatal(err)
	}
	seedPiRun(t, db, model.CloudAgentExecution{ID: "overflow", UserID: "user-a", Status: "queued"})
	claimed, err := svc.repo.ClaimPiAgentRun("w:0", time.Now().UTC().Add(45*time.Second), fallback)
	if err != nil {
		t.Fatal(err)
	}
	if claimed != nil {
		t.Fatalf("per-user cap must skip the second run: claimed=%+v", claimed)
	}
	var overflow model.CloudAgentExecution
	if err := db.Where("id = ?", "overflow").First(&overflow).Error; err != nil {
		t.Fatal(err)
	}
	if overflow.RuntimePhase != "waiting_resource" {
		t.Fatalf("capacity-blocked run must enter waiting_resource: %q", overflow.RuntimePhase)
	}
	// 其他账户不受影响。
	seedPiRun(t, db, model.CloudAgentExecution{ID: "fresh", UserID: "user-b", Status: "queued"})
	other, err := svc.repo.ClaimPiAgentRun("w:1", time.Now().UTC().Add(45*time.Second), fallback)
	if err != nil || other == nil || other.ID != "fresh" {
		t.Fatalf("other user must claim past user-a's cap: got %+v err=%v", other, err)
	}
	// 恢复退避未到期：next_recovery_at 在未来时不可候选。
	if err := db.Model(&model.CloudAgentExecution{}).Where("id = ?", "fresh").Updates(map[string]any{"lease_owner": "", "lease_expires_at": nil, "next_recovery_at": time.Now().UTC().Add(30 * time.Second)}).Error; err != nil {
		t.Fatal(err)
	}
	if claimed, err = svc.repo.ClaimPiAgentRun("w:2", time.Now().UTC().Add(45*time.Second), fallback); err != nil {
		t.Fatal(err)
	}
	if claimed != nil && claimed.ID == "fresh" {
		t.Fatal("recovery backoff must exclude the candidate")
	}
}

func TestSweepStalledAndUnclaimed(t *testing.T) {
	svc, db := newAgentWorkerTestService(t)
	// stalled：领取过且租约 7×45s 前过期。
	seedPiRun(t, db, model.CloudAgentExecution{ID: "stalled", UserID: "user-a", Status: "running"})
	if err := db.Model(&model.CloudAgentExecution{}).Where("id = ?", "stalled").Updates(map[string]any{"lease_owner": "w", "lease_expires_at": time.Now().UTC().Add(-7 * 45 * time.Second), "created_at": time.Now().UTC().Add(-time.Hour)}).Error; err != nil {
		t.Fatal(err)
	}
	// unclaimed：从未领取，超过 30 分钟。
	seedPiRun(t, db, model.CloudAgentExecution{ID: "never", UserID: "user-b", Status: "queued", CreatedAt: time.Now().UTC().Add(-35 * time.Minute)})
	// capacity 阻塞：waiting_resource 不死于无领取。
	seedPiRun(t, db, model.CloudAgentExecution{ID: "queued-blocked", UserID: "user-c", Status: "queued", CreatedAt: time.Now().UTC().Add(-35 * time.Minute), RuntimePhase: "waiting_resource"})
	// 终态：已结束运行必须幂等跳过。
	seedPiRun(t, db, model.CloudAgentExecution{ID: "terminal", UserID: "user-d", Status: "failed", CreatedAt: time.Now().UTC().Add(-2 * time.Hour)})

	if swept := svc.SweepStalledPiAgentRuns(); swept != 1 {
		t.Fatalf("stalled sweep must finalize exactly the stale run, swept=%d", swept)
	}
	if swept := svc.SweepUnclaimedPiAgentRuns(); swept != 1 {
		t.Fatalf("unclaimed sweep must finalize only the never-claimed run, swept=%d", swept)
	}
	var failed, terminal, blocked model.CloudAgentExecution
	if err := db.Where("id = ?", "stalled").First(&failed).Error; err != nil {
		t.Fatal(err)
	}
	if failed.Status != "failed" || failed.FailureMessage == "" || !failed.CleanupPending {
		t.Fatalf("stalled run must fail with cleanup pending: %+v", failed)
	}
	if err := db.Where("id = ?", "terminal").First(&terminal).Error; err != nil {
		t.Fatal(err)
	}
	if terminal.Status != "failed" {
		t.Fatalf("terminal runs must be skipped: %+v", terminal)
	}
	if err := db.Where("id = ?", "queued-blocked").First(&blocked).Error; err != nil {
		t.Fatal(err)
	}
	if blocked.Status != "queued" {
		t.Fatalf("waiting_resource runs must stay queued: %+v", blocked)
	}
}

func TestAgentRunPhaseAndInspection(t *testing.T) {
	svc, db := newAgentWorkerTestService(t)
	leased := seedLeasedRun(t, db, svc)
	// 合法相位写入。
	if err := svc.PiRuntimePhase("user-a", leased.ID, claimOwner("w:0", 1), PiRuntimePhaseRequest{Phase: "waiting_model", Kind: "model", WaitID: "task-1", Reason: "模型步进行中"}); err != nil {
		t.Fatalf("phase write failed: %v", err)
	}
	var row model.CloudAgentExecution
	if err := db.Where("id = ?", leased.ID).First(&row).Error; err != nil {
		t.Fatal(err)
	}
	if row.RuntimePhase != "waiting_model" {
		t.Fatalf("phase must persist, got %q", row.RuntimePhase)
	}

	// 相位白名单与字界。
	if err := svc.PiRuntimePhase("user-a", leased.ID, claimOwner("w:0", 1), PiRuntimePhaseRequest{Phase: "warping"}); err == nil {
		t.Fatal("unknown phase must be rejected")
	}
	if err := svc.PiRuntimePhase("user-a", leased.ID, claimOwner("w:0", 1), PiRuntimePhaseRequest{Phase: "ready", Reason: stringsRepeat("r", 200)}); err == nil {
		t.Fatal("over-long wait reference must be rejected")
	}
	// 审批等待期：waiting_tool 归一。
	if err := db.Model(&model.CloudAgentExecution{}).Where("id = ?", leased.ID).Update("status", "waiting_approval").Error; err != nil {
		t.Fatal(err)
	}
	if err := svc.PiRuntimePhase("user-a", leased.ID, claimOwner("w:0", 1), PiRuntimePhaseRequest{Phase: "waiting_tool"}); err != nil {
		t.Fatal(err)
	}
	_ = db.First(&row, "id = ?", leased.ID).Error
	if row.RuntimePhase != "waiting_approval" {
		t.Fatalf("tool phase must normalize under approval, got %q", row.RuntimePhase)
	}

	// 旧 epoch 或错 worker 不能改写相位。
	if err := svc.PiRuntimePhase("user-a", leased.ID, claimOwner("w:0", 999), PiRuntimePhaseRequest{Phase: "ready"}); err == nil {
		t.Fatal("stale epoch must fail closed")
	}
	if err := svc.PiRuntimePhase("user-a", leased.ID, "other:0@1", PiRuntimePhaseRequest{Phase: "ready"}); err == nil {
		t.Fatal("foreign worker must fail closed")
	}

	// 快照：Approval 与 pending interjections。
	if err := db.Model(&model.CloudAgentExecution{}).Where("id = ?", leased.ID).UpdateColumn("state_json", `{"approval":{"approvalId":"ap1"},"pendingInterjections":[{"id":"i1","text":"Hi","createdAt":"2026-11-02T01:02:03Z"}]}`).Error; err != nil {
		t.Fatal(err)
	}
	inspection, err := svc.PiAgentInspection("user-a", leased.ID, claimOwner("w:0", 1))
	if err != nil {
		t.Fatal(err)
	}
	if inspection.ApprovalID != "ap1" || len(inspection.PendingInterjections) != 1 || inspection.PendingInterjections[0].ID != "i1" {
		t.Fatalf("inspection fields wrong: %+v", inspection)
	}
	if inspection.LeaseEpoch != 1 || inspection.Status != "waiting_approval" {
		t.Fatalf("inspection lease fields wrong: %+v", inspection)
	}
}

func TestPiFailRunTerminalizesHeldRun(t *testing.T) {
	svc, db := newAgentWorkerTestService(t)
	leased := seedLeasedRun(t, db, svc)
	if err := svc.PiFailRun("user-a", leased.ID, claimOwner("w:0", 1), "工具合同不一致，无法重试"); err != nil {
		t.Fatalf("fail report failed: %v", err)
	}
	var row model.CloudAgentExecution
	if err := db.Where("id = ?", leased.ID).First(&row).Error; err != nil {
		t.Fatal(err)
	}
	if row.Status != "failed" || !row.CleanupPending || row.FailureMessage == "" {
		t.Fatalf("worker fatal must terminalize with cleanup: %+v", row)
	}
	// 幂等：终态重复上报无害。
	if err := svc.PiFailRun("user-a", leased.ID, claimOwner("w:0", 1), "再次上报"); err != nil {
		t.Fatalf("repeat fail must be a no-op: %v", err)
	}
	// 相等 owner 且终态：依旧 no-op（terminal fallback 语义）。
}

func TestPiToolAdvanceSyncRejectsForeignWorker(t *testing.T) {
	svc, db := newAgentWorkerTestService(t)
	seedLeasedRun(t, db, svc)
	// 错槽位拒绝——工具推进必须来自租约持有者（无论审批与计费路径在 Go 侧如何治理）。
	if _, err := svc.PiToolAdvanceSync(context.Background(), "user-a", "run-x", "other:0@1", map[string]json.RawMessage{"callId": json.RawMessage(`"c1"`), "name": json.RawMessage(`"canvas_get_state"`), "arguments": json.RawMessage(`{}`)}); err == nil {
		t.Fatal("foreign worker tool advance must be rejected")
	}
	// 正确槽位但调用未声明 → 由执行器拒绝（行为不在本测试深度）。
	if _, err := svc.PiToolAdvanceSync(context.Background(), "user-a", "run-x", claimOwner("w:0", 1), map[string]json.RawMessage{"callId": json.RawMessage(`"c1"`), "name": json.RawMessage(`"canvas_get_state"`), "arguments": json.RawMessage(`{}`)}); err == nil {
		t.Fatal("undeclared call without state must fail in the executor; here state is empty so executor rejects too")
	}
}
