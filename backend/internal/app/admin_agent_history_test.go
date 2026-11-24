package app

import (
	"errors"
	"testing"

	"yingce/backend/internal/kernel"
	"yingce/backend/internal/model"
)

func TestAdminClearAgentHistoryIsAtomicAndScoped(t *testing.T) {
	svc, db, _, _ := creationTestService(t)
	svc.legacyCloudAgentRootTask = false
	admin := &model.User{ID: "admin", Role: model.UserRoleAdmin}
	root, err := svc.CreateCloudAgentRun("user", unboundAgentTestRequest("to-clear"), "")
	if err != nil {
		t.Fatal(err)
	}
	snapshot := &model.CloudAgentPiSession{UserID: "user", RunID: root.ID, SessionJSONL: "native"}
	mutation := &model.CloudAgentCanvasMutation{ID: "undo", UserID: "user", RunID: root.ID, BeforeJSON: `{}`}
	if err := svc.repo.SaveCloudAgentPiSession(snapshot, 0); err != nil {
		t.Fatal(err)
	}
	if err := svc.repo.CreateCloudAgentCanvasMutation(mutation); err != nil {
		t.Fatal(err)
	}
	other := &model.CloudAgentExecution{ID: "other", UserID: "other-account", Status: "running", StateJSON: "other"}
	if err := svc.repo.EnsureCloudAgent(other); err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&model.CanvasProject{ID: "keep-canvas", UserID: "user"}).Error; err != nil {
		t.Fatal(err)
	}
	before, err := svc.repo.AgentStoredBytes("user")
	if err != nil || before <= 0 {
		t.Fatalf("initial usage %d: %v", before, err)
	}
	assertRejected := func(actor *model.User, target string, status int) {
		t.Helper()
		_, err := svc.AdminClearAgentHistory(actor, target)
		var failure *kernel.AppError
		if !errors.As(err, &failure) || failure.Status != status {
			t.Fatalf("expected %d, got %v", status, err)
		}
	}
	assertRejected(nil, "user", 401)
	assertRejected(&model.User{ID: "user", Role: model.UserRoleUser}, "user", 403)
	assertRejected(admin, "missing", 404)
	assertRejected(admin, "user", 409)
	for _, state := range []struct {
		status  string
		cleanup bool
	}{{"waiting_approval", false}, {"completed", true}, {"completed", false}} {
		if err := db.Model(&model.CloudAgentExecution{}).Where("id = ?", root.ID).Updates(map[string]any{"status": state.status, "cleanup_pending": state.cleanup}).Error; err != nil {
			t.Fatal(err)
		}
		if state.status != "completed" || state.cleanup {
			assertRejected(admin, "user", 409)
		}
	}
	reservation := &model.Task{ID: "reservation", UserID: "user", Operation: "cloud_agent", Status: model.TaskStatusTextReplay}
	if err := svc.repo.CreateTaskWithActiveLimit(reservation, 5); err != nil {
		t.Fatal(err)
	}
	assertRejected(admin, "user", 409)
	if err := svc.repo.FailCloudAgentReservation("user", reservation.ID, "stopped"); err != nil {
		t.Fatal(err)
	}
	if err := db.Exec(`CREATE TRIGGER refuse_agent_audit BEFORE INSERT ON admin_audit_events BEGIN SELECT RAISE(ABORT, 'audit rejected'); END`).Error; err != nil {
		t.Fatal(err)
	}
	if _, err := svc.AdminClearAgentHistory(admin, "user"); err == nil {
		t.Fatal("cleanup succeeded without an audit")
	}
	if used, err := svc.repo.AgentStoredBytes("user"); err != nil || used != before {
		t.Fatalf("cleanup did not roll back: %d, %v", used, err)
	}
	if _, err := svc.repo.CloudAgentPiSession("user", root.ID); err != nil {
		t.Fatalf("session not restored on rollback: %v", err)
	}
	if err := db.Exec(`DROP TRIGGER refuse_agent_audit`).Error; err != nil {
		t.Fatal(err)
	}
	if freed, err := svc.AdminClearAgentHistory(admin, "user"); err != nil || freed != before {
		t.Fatalf("freed %d of %d: %v", freed, before, err)
	}
	for _, table := range []any{&model.CloudAgentExecution{}, &model.CloudAgentEventRecord{}, &model.CloudAgentMessageRecord{}, &model.CloudAgentPiSession{}, &model.CloudAgentCanvasMutation{}} {
		assertModelCount(t, db, table, "user_id = ?", 0, "user")
	}
	assertModelCount(t, db, &model.AdminAuditEvent{}, "action = ? AND target_id = ? AND actor_user_id = ?", 1, "user.agent_history.clear", "user", admin.ID)
	assertModelCount(t, db, &model.CanvasProject{}, "id = ?", 1, "keep-canvas")
	assertModelCount(t, db, &model.Task{}, "id = ?", 1, root.ID)
	if used, err := svc.repo.AgentStoredBytes(other.UserID); err != nil || used != int64(len(other.StateJSON)) {
		t.Fatalf("unrelated history changed: %d, %v", used, err)
	}
	if roots, err := svc.repo.CloudAgentRoots(); err != nil || len(roots) != 0 {
		t.Fatalf("recovery would recreate cleared history: %+v, %v", roots, err)
	}
	_, readErr := svc.CloudAgentRun("user", root.ID)
	for _, err := range []error{readErr, svc.repo.SaveCloudAgentPiSession(snapshot, 0), svc.repo.CreateCloudAgentCanvasMutation(mutation)} {
		var failure *kernel.AppError
		if !errors.As(err, &failure) || failure.Status != 404 {
			t.Fatalf("cleared history should not be recreated: %v", err)
		}
	}
	if used, err := svc.repo.AgentStoredBytes("user"); err != nil || used != 0 {
		t.Fatalf("usage after cleanup: %d, %v", used, err)
	}
	if _, err := svc.CreateCloudAgentRun("user", unboundAgentTestRequest("new-after-cleanup"), ""); err != nil {
		t.Fatalf("new run after cleanup: %v", err)
	}
}
