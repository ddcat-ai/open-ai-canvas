package app

import (
	"os"
	"testing"
	"time"

	"yingce/backend/internal/model"
	"yingce/backend/internal/protocol"
)

func TestAdminTaskMediaInspectionAndManualDiscard(t *testing.T) {
	s, db := newMediaRecoveryTestService(t)
	admin := &model.User{ID: "inspector", Role: model.UserRoleAdmin, Status: model.UserStatusActive}
	ordinary := &model.User{ID: "ordinary", Role: model.UserRoleUser, Status: model.UserStatusActive}
	task := seedMediaTask(t, db, providerConfig{})
	name, err := s.stageInlineMedia(task.UserID, mediaTestPNG(t))
	if err != nil {
		t.Fatal(err)
	}
	checkpoint := &mediaCheckpoint{Mode: "image", StartedAt: time.Now(), Items: []mediaCheckpointItem{{TempName: name, MIMEType: "image/png", Reference: protocol.MediaReference{URL: "https://example.invalid/image?token=secret"}}}}
	if err := s.saveMediaCheckpoint(task, checkpoint, "upload"); err != nil {
		t.Fatal(err)
	}
	if _, err := s.AdminInspectTaskMedia(ordinary, task.UserID, task.ID); err == nil {
		t.Fatal("ordinary user inspected another account")
	}
	if _, err := s.AdminDiscardTaskMedia(admin, task.UserID, task.ID); err == nil {
		t.Fatal("running task staging deleted")
	}
	if _, err := os.Stat(s.mediaTempPath(name)); err != nil {
		t.Fatal("running file lost")
	}
	if err := db.Model(task).Updates(map[string]any{"status": model.TaskStatusFailed, "lease_owner": "", "lease_expires_at": nil}).Error; err != nil {
		t.Fatal(err)
	}
	view, err := s.AdminInspectTaskMedia(admin, task.UserID, task.ID)
	if err != nil || view.StagedFiles != 1 || view.StagedBytes == 0 || view.RemoteItems != 0 {
		t.Fatalf("inspection: %+v %v", view, err)
	}
	if _, err := s.AdminDiscardTaskMedia(admin, "wrong-owner", task.ID); err == nil {
		t.Fatal("wrong task owner accepted")
	}
	view, err = s.AdminDiscardTaskMedia(admin, task.UserID, task.ID)
	if err != nil || view.StagedFiles != 0 || view.RemoteItems != 1 {
		t.Fatalf("discard: %+v %v", view, err)
	}
	if _, err := os.Stat(s.mediaTempPath(name)); !os.IsNotExist(err) {
		t.Fatal("file still exists")
	}
	saved, err := s.repo.Task(task.ID)
	if err != nil || saved.Status != model.TaskStatusFailed || saved.LeaseOwner != "" {
		t.Fatal("cleanup changed lifecycle or leaked maintenance lease")
	}
	remaining, err := s.decodeMediaCheckpoint(saved)
	if err != nil || remaining.Items[0].Reference.URL == "" || remaining.Items[0].TempName != "" {
		t.Fatal("source recovery record lost")
	}
	var audits int64
	db.Model(&model.AdminAuditEvent{}).Where("target_id = ? AND action = ?", task.ID, "task.media_staging_discard").Count(&audits)
	if audits != 1 {
		t.Fatalf("audit count=%d", audits)
	}
}

func TestAdminTaskMediaMaintenanceLeaseBlocksRecovery(t *testing.T) {
	s, db := newMediaRecoveryTestService(t)
	task := seedMediaTask(t, db, providerConfig{})
	checkpoint := &mediaCheckpoint{Mode: "image", StartedAt: time.Now(), Items: []mediaCheckpointItem{{Reference: protocol.MediaReference{URL: "https://example.invalid/image"}}}}
	if err := s.saveMediaCheckpoint(task, checkpoint, "download"); err != nil {
		t.Fatal(err)
	}
	if err := db.Model(task).Updates(map[string]any{"status": model.TaskStatusFailed, "lease_owner": "", "lease_expires_at": nil}).Error; err != nil {
		t.Fatal(err)
	}
	task, _ = s.repo.Task(task.ID)
	audit := &model.AdminAuditEvent{ID: newID(), Action: "test"}
	if err := s.repo.LockFailedTaskMedia(task, "cleanup", audit); err != nil {
		t.Fatal(err)
	}
	if _, err := s.RecoverTaskMedia(task.UserID, task.ID); err == nil {
		t.Fatal("recovery bypassed cleanup lease")
	}
	if err := s.repo.UnlockFailedTaskMedia(task.ID, "cleanup"); err != nil {
		t.Fatal(err)
	}
	if _, err := s.RecoverTaskMedia(task.UserID, task.ID); err != nil {
		t.Fatalf("recovery after cleanup: %v", err)
	}
}
