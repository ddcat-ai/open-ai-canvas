package canvas

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"testing"

	"infinite-canvas/backend/internal/kernel"
	"infinite-canvas/backend/internal/model"
)

func TestCanvasHistoryRestore(t *testing.T) {
	svc := newCanvasHistoryTestService(t)
	actor := &model.User{ID: "owner"}
	save := func(raw string) UserDataSummary {
		t.Helper()
		result, err := svc.UpsertUserCanvasProject(actor.ID, json.RawMessage(raw))
		if err != nil {
			t.Fatal(err)
		}
		return result
	}
	save(`{"id":"canvas","revision":0,"title":"original","nodes":[{"id":"video"}],"connections":[]}`)
	save(`{"id":"canvas","revision":1,"title":"original","nodes":[{"id":"video"}],"connections":[],"viewport":{"x":20}}`)
	list, err := svc.CanvasHistory(actor.ID, "canvas")
	if err != nil || len(list.Snapshots) != 0 {
		t.Fatalf("no-op created snapshot: %#v %v", list, err)
	}
	save(`{"id":"canvas","revision":2,"title":"edited","nodes":[],"connections":[]}`)
	list, err = svc.CanvasHistory(actor.ID, "canvas")
	if err != nil || len(list.Snapshots) != 1 || list.CurrentRevision != 3 || list.Snapshots[0].NodeCount != 1 {
		t.Fatalf("history: %#v %v", list, err)
	}
	entry := list.Snapshots[0]
	if entry.PayloadJSON != "" {
		t.Fatal("history list loaded full payload")
	}
	preview, err := svc.CanvasHistorySnapshot(actor.ID, "canvas", entry.ID)
	if err != nil || !strings.Contains(preview.PayloadJSON, "video") {
		t.Fatalf("preview = %#v %v", preview, err)
	}
	for _, scenario := range []struct {
		actor    *model.User
		canvasID string
	}{
		{actor: &model.User{ID: "stranger"}, canvasID: "canvas"},
		{actor: actor, canvasID: "missing-canvas"},
	} {
		var notFound *kernel.AppError
		if _, err := svc.CanvasHistory(scenario.actor.ID, scenario.canvasID); !errors.As(err, &notFound) || notFound.Status != http.StatusNotFound {
			t.Fatalf("inaccessible history must return 404: %v", err)
		}
		if _, err := svc.CanvasHistorySnapshot(scenario.actor.ID, scenario.canvasID, entry.ID); !errors.As(err, &notFound) || notFound.Status != http.StatusNotFound {
			t.Fatalf("inaccessible preview must return 404: %v", err)
		}
		currentRevision := int64(3)
		if _, err := svc.RestoreCanvasHistory(scenario.actor.ID, scenario.canvasID, entry.ID, &currentRevision); !errors.As(err, &notFound) || notFound.Status != http.StatusNotFound {
			t.Fatalf("inaccessible restore must return 404: %v", err)
		}
	}
	if _, err := svc.CanvasHistorySnapshot(actor.ID, "canvas", "other-canvas-snapshot"); err == nil {
		t.Fatal("unrelated snapshot readable")
	}
	if _, err := svc.RestoreCanvasHistory(actor.ID, "canvas", entry.ID, nil); err == nil {
		t.Fatal("missing revision accepted")
	}
	stale := int64(2)
	_, err = svc.RestoreCanvasHistory(actor.ID, "canvas", entry.ID, &stale)
	var appError *kernel.AppError
	if !errors.As(err, &appError) || appError.Status != http.StatusConflict {
		t.Fatalf("stale restore = %v", err)
	}
	current := int64(3)
	result, err := svc.RestoreCanvasHistory(actor.ID, "canvas", entry.ID, &current)
	if err != nil || result.Revision != 4 {
		t.Fatalf("restore = %#v %v", result, err)
	}
	raw, _ := svc.UserCanvasProject(actor.ID, "canvas")
	if !strings.Contains(string(raw), "video") || !strings.Contains(string(raw), "original") {
		t.Fatalf("wrong restored content: %s", raw)
	}
	list, _ = svc.CanvasHistory(actor.ID, "canvas")
	if len(list.Snapshots) != 2 || list.Snapshots[0].Revision != 3 || list.Snapshots[0].Reason != "before_restore" {
		t.Fatalf("pre-restore backup missing: %#v", list)
	}
	current = 4
	if _, err := svc.RestoreCanvasHistory(actor.ID, "canvas", list.Snapshots[0].ID, &current); err != nil {
		t.Fatal(err)
	}
	raw, _ = svc.UserCanvasProject(actor.ID, "canvas")
	if strings.Contains(string(raw), "video") {
		t.Fatal("could not undo restore")
	}
}
