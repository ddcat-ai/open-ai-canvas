package canvas

import (
	"encoding/json"
	"errors"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"infinite-canvas/backend/internal/repository"
	"net/http"
	"path/filepath"
	"testing"

	"infinite-canvas/backend/internal/kernel"
	"infinite-canvas/backend/internal/model"
)

func TestCanvasSaveRevisionContract(t *testing.T) {
	svc := newCanvasHistoryTestService(t)
	actor := &model.User{ID: "owner"}
	missing := json.RawMessage(`{"id":"canvas","nodes":[]}`)
	_, err := svc.UpsertUserCanvasProject(actor.ID, missing)
	var appError *kernel.AppError
	if !errors.As(err, &appError) || appError.Status != http.StatusPreconditionRequired {
		t.Fatalf("unversioned save = %v", err)
	}
	raw := json.RawMessage(`{"id":"canvas","revision":0,"title":"initial","nodes":[{"id":"old"}],"viewport":{"x":999,"y":0,"k":2}}`)
	created, err := svc.UpsertUserCanvasProject(actor.ID, raw)
	if err != nil {
		t.Fatal(err)
	}
	if created.Revision != 1 {
		t.Fatalf("revision = %d", created.Revision)
	}
	update := json.RawMessage(`{"id":"canvas","revision":1,"title":"new","nodes":[{"id":"old"},{"id":"video"}],"updatedAt":"2099-01-01T00:00:00Z","remoteContentHash":"local-only","viewport":{"x":500,"y":10,"k":3}}`)
	saved, err := svc.UpsertUserCanvasProject(actor.ID, update)
	if err != nil {
		t.Fatal(err)
	}
	if saved.Revision != 2 || saved.UpdatedAt.Year() == 2099 {
		t.Fatalf("invalid server metadata: %#v", saved)
	}
	_, err = svc.UpsertUserCanvasProject(actor.ID, update)
	if !errors.As(err, &appError) || appError.Status != http.StatusConflict {
		t.Fatalf("stale save = %v", err)
	}
	got, err := svc.UserCanvasProject(actor.ID, "canvas")
	if err != nil {
		t.Fatal(err)
	}
	var project map[string]any
	if err := json.Unmarshal(got, &project); err != nil {
		t.Fatal(err)
	}
	if project["revision"] != float64(2) || len(project["nodes"].([]any)) != 2 {
		t.Fatalf("read lost metadata/content: %s", got)
	}
	if project["remoteContentHash"] != nil || project["viewport"].(map[string]any)["x"] != float64(0) {
		t.Fatalf("content save persisted local preferences: %s", got)
	}
	if _, err := svc.UserCanvasProject("unrelated", "canvas"); err == nil {
		t.Fatal("unrelated user could read canvas")
	}
}

func newCanvasHistoryTestService(t *testing.T) *Service {
	t.Helper()
	db, err := gorm.Open(sqlite.Open(filepath.Join(t.TempDir(), "canvas.db")), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&model.CanvasProject{}, &model.CanvasCollaborator{}, &model.CanvasMediaGrant{}, &model.CanvasSnapshot{}, &model.CanvasSnapshotResource{}, &model.Resource{}, &model.Asset{}); err != nil {
		t.Fatal(err)
	}
	sqlDB, _ := db.DB()
	t.Cleanup(func() { _ = sqlDB.Close() })
	return New(repository.New(db), nil)
}
