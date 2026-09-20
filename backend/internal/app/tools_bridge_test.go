package app

import (
	"infinite-canvas/backend/internal/model"
	"strings"
	"testing"
)

func TestToolPreviewOwnershipAndResourceDeletionGuard(t *testing.T) {
	svc, db, _ := newResourceDeletionTestService(t)
	resource := model.Resource{ID: "tool-preview", UserID: "alice", Status: model.ResourceStatusReady, Provider: "local", ObjectKey: "preview.png"}
	if err := db.Create(&resource).Error; err != nil {
		t.Fatal(err)
	}
	req := ToolMutationRequest{Type: "style", Label: "style", Prompt: "film", Cover: "/api/resources/tool-preview/file", Visibility: "private"}
	if _, err := svc.CreateTool("bob", req); err == nil {
		t.Fatal("foreign resource accepted")
	}
	req.Visibility = "public"
	if _, err := svc.CreateTool("alice", req); err == nil {
		t.Fatal("private resource exposed publicly")
	}
	req.Visibility = "private"
	tool, err := svc.CreateTool("alice", req)
	if err != nil {
		t.Fatal(err)
	}
	snapshot, err := svc.repo.ResourceReferenceSnapshot("alice", "", []string{resource.ID})
	if err != nil {
		t.Fatal(err)
	}
	found := false
	for _, doc := range snapshot.Documents {
		if doc.Kind == "工具" && documentReferencesResources(doc.PrimaryJSON, map[string]struct{}{resource.ID: {}}) {
			found = true
		}
	}
	if !found {
		t.Fatal("tool preview not protected from resource deletion")
	}
	if err := svc.DeleteTool("alice", tool.ID); err != nil {
		t.Fatal(err)
	}
	var count int64
	if err := db.Model(&model.Resource{}).Where("id = ?", resource.ID).Count(&count).Error; err != nil {
		t.Fatal(err)
	}
	if count != 1 {
		t.Fatal("deleting tool deleted preview resource")
	}
}

func TestToolAdmissionRejectsBeforeQueueing(t *testing.T) {
	svc, db, _ := newResourceDeletionTestService(t)
	_, err := svc.CreateTask("alice", CreateTaskRequest{Type: "canvas_image", Prompt: "@[tool:style:999:x:X]", Input: map[string]any{"mode": "image", "prompt": "@[tool:style:999:x:X]"}})
	if err == nil || !strings.Contains(err.Error(), "工具") {
		t.Fatalf("unexpected admission result: %v", err)
	}
	var count int64
	if err := db.Model(&model.Task{}).Count(&count).Error; err != nil {
		t.Fatal(err)
	}
	if count != 0 {
		t.Fatal("invalid tool was queued")
	}
}
