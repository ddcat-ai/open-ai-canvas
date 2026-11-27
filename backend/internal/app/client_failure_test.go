package app

import (
	"fmt"
	"testing"
	"time"
	"yingce/backend/internal/model"
)

func TestClientFailureACKPrivacyAndOwnership(t *testing.T) {
	s, db, _, _ := creationTestService(t)
	event := ClientFailureInput{EventID: "event-startup-one", Code: "worker_load_failed", Phase: "startup", BuildCommit: "dev", OccurredAt: time.Now().UTC().Truncate(time.Millisecond), Frames: []ClientFailureFrame{}}
	for i := 0; i < 2; i++ {
		ids, err := s.ReportClientFailures("user", []ClientFailureInput{event})
		if err != nil || len(ids) != 1 || ids[0] != event.EventID {
			t.Fatalf("ACK %v %v", ids, err)
		}
	}
	var count int64
	db.Model(&model.ClientFailure{}).Count(&count)
	if count != 1 {
		t.Fatalf("duplicate persisted: %d", count)
	}
	missing := event
	missing.EventID = "event-deleted-run"
	missing.RunID = "missing-run"
	if ids, err := s.ReportClientFailures("user", []ClientFailureInput{missing, event}); err != nil || len(ids) != 1 || ids[0] != event.EventID {
		t.Fatalf("deleted run blocked valid logs: %v %v", ids, err)
	}
	changed := event
	changed.HTTPStatus = 503
	if _, err := s.ReportClientFailures("user", []ClientFailureInput{changed}); err == nil {
		t.Fatal("same event ID with different body accepted")
	}
	bad := event
	bad.EventID = "event-sensitive"
	bad.Frames = []ClientFailureFrame{{File: "https://secret.example/key.js?token=secret"}}
	if _, err := s.ReportClientFailures("user", []ClientFailureInput{bad}); err == nil {
		t.Fatal("sensitive URL accepted")
	}
	if rows, err := s.OwnClientFailures("other", ""); err != nil || len(rows) != 0 {
		t.Fatalf("foreign logs exposed: %v %v", rows, err)
	}
	if _, err := s.AdminClientFailures(&model.User{ID: "user", Role: model.UserRoleUser}, "", ""); err == nil {
		t.Fatal("nonadmin read logs")
	}
	if _, err := s.OwnClientFailures("", ""); err == nil {
		t.Fatal("empty owner queried all logs")
	}
	fill := make([]model.ClientFailure, 1999)
	for i := range fill {
		fill[i] = model.ClientFailure{UserID: "user", EventID: fmt.Sprintf("quota-%d", i), Code: event.Code, Phase: event.Phase, BuildCommit: event.BuildCommit, OccurredAt: event.OccurredAt, FramesJSON: "[]"}
	}
	if err := db.CreateInBatches(fill, 100).Error; err != nil {
		t.Fatal(err)
	}
	full := event
	full.EventID = "event-over-quota"
	if ids, err := s.ReportClientFailures("user", []ClientFailureInput{full}); err != nil || len(ids) != 0 {
		t.Fatalf("unpersisted event ACKed: %v %v", ids, err)
	}
	if ids, err := s.ReportClientFailures("user", []ClientFailureInput{event}); err != nil || len(ids) != 1 {
		t.Fatalf("full quota rejected persisted duplicate: %v %v", ids, err)
	}
	if err := db.Model(&model.ClientFailure{}).Where("user_id = ?", "user").UpdateColumn("created_at", time.Now().Add(-15*24*time.Hour)).Error; err != nil {
		t.Fatal(err)
	}
	if err := s.repo.PurgeClientFailures(time.Now().Add(-14 * 24 * time.Hour)); err != nil {
		t.Fatal(err)
	}
	db.Model(&model.ClientFailure{}).Count(&count)
	if count != 0 {
		t.Fatal("retention not enforced")
	}
}
