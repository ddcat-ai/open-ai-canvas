package repository

import (
	"errors"
	"testing"
	"time"

	"infinite-canvas/backend/internal/model"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func TestCloudAgentPiSessionSnapshotRevision(t *testing.T) {
	db, err := gorm.Open(sqlite.Open("file:cloud-agent-pi-session-revision?mode=memory&cache=shared"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&model.CloudAgentPiSession{}); err != nil {
		t.Fatal(err)
	}
	repo := New(db)
	session := &model.CloudAgentPiSession{RunID: "run-a", UserID: "user-a", SessionJSONL: "{\"type\":\"session\"}\n", UpdatedAt: time.Now()}
	if err := repo.SaveCloudAgentPiSession(session, 0); err != nil {
		t.Fatal(err)
	}
	if session.Revision != 1 {
		t.Fatalf("create revision = %d, want 1", session.Revision)
	}
	session.SessionJSONL = "{\"type\":\"session\",\"updated\":true}\n"
	if err := repo.SaveCloudAgentPiSession(session, 1); err != nil {
		t.Fatal(err)
	}
	if session.Revision != 2 {
		t.Fatalf("update revision = %d, want 2", session.Revision)
	}
	stale := &model.CloudAgentPiSession{RunID: "run-a", UserID: "user-a", SessionJSONL: "stale"}
	if err := repo.SaveCloudAgentPiSession(stale, 1); !errors.Is(err, gorm.ErrRecordNotFound) {
		t.Fatalf("stale update error = %v, want revision conflict", err)
	}
	stored, err := repo.CloudAgentPiSession("user-a", "run-a")
	if err != nil {
		t.Fatal(err)
	}
	if stored.SessionJSONL != session.SessionJSONL || stored.Revision != 2 {
		t.Fatalf("stale writer changed session: %+v", stored)
	}
	if _, err := repo.CloudAgentPiSession("user-b", "run-a"); !errors.Is(err, gorm.ErrRecordNotFound) {
		t.Fatalf("cross-user lookup error = %v, want not found", err)
	}
}
