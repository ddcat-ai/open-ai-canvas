package canvas

import (
	"encoding/json"
	"errors"
	"net/http"
	"reflect"
	"strings"
	"testing"
	"time"

	"yingce/backend/internal/kernel"
	"yingce/backend/internal/model"
)

func TestCanvasProjectPayloadReplacesMetadataAndPreservesDocument(t *testing.T) {
	project := model.CanvasProject{
		ID:          "canvas-authoritative",
		Title:       "Current title",
		ProjectID:   "project-current",
		Revision:    9,
		CreatedAt:   time.Date(2026, 1, 2, 3, 4, 5, 0, time.UTC),
		UpdatedAt:   time.Date(2026, 2, 3, 4, 5, 6, 0, time.UTC),
		PayloadJSON: `{"id":"stale","title":"stale","revision":1,"nodes":[ { "id": "node-1", "metadata": {"content":"large"} } ],"connections":[],"custom":{"preserve":true}}`,
	}
	raw, err := canvasProjectPayload(project)
	if err != nil {
		t.Fatal(err)
	}
	var actual map[string]json.RawMessage
	if err := json.Unmarshal(raw, &actual); err != nil {
		t.Fatal(err)
	}
	for key, want := range map[string]any{
		"id": project.ID, "title": project.Title, "projectId": project.ProjectID,
		"revision": project.Revision, "createdAt": project.CreatedAt, "updatedAt": project.UpdatedAt,
	} {
		var got any
		if err := json.Unmarshal(actual[key], &got); err != nil {
			t.Fatal(err)
		}
		encodedWant, _ := json.Marshal(want)
		var decodedWant any
		_ = json.Unmarshal(encodedWant, &decodedWant)
		if !reflect.DeepEqual(got, decodedWant) {
			t.Errorf("%s = %#v, want %#v", key, got, decodedWant)
		}
	}
	for _, key := range []string{"nodes", "connections", "custom"} {
		if len(actual[key]) == 0 || !json.Valid(actual[key]) {
			t.Errorf("original %s payload was not preserved: %s", key, actual[key])
		}
	}
}

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
