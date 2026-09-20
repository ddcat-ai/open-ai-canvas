package canvas

import (
	"encoding/json"
	"net/http"
	"testing"

	"infinite-canvas/backend/internal/model"
)

func TestCanvasBranchLifecycleAndMergePermissions(t *testing.T) {
	svc, owner, editor, _ := newCanvasCollaborationTestService(t)
	seedCanvasCollaborationProject(t, svc.repo)
	viewer := &model.User{ID: "viewer"}
	for _, member := range []struct {
		user *model.User
		role string
	}{{editor, CanvasCollaboratorRoleEditor}, {viewer, CanvasCollaboratorRoleViewer}} {
		if _, err := svc.EnableCanvasCollaboration(owner, "canvas-1", member.user.ID, member.role); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := svc.CreateCanvasBranchForUser(viewer, "canvas-1", CanvasBranchCreateRequest{Name: "forbidden"}); !hasAppStatus(err, http.StatusForbidden) {
		t.Fatalf("viewer create = %v", err)
	}
	created, err := svc.CreateCanvasBranchForUser(editor, "canvas-1", CanvasBranchCreateRequest{Name: "Alternative"})
	if err != nil {
		t.Fatal(err)
	}
	branchID, canvasID := created.Branch.ID, created.Branch.BranchCanvasID
	branchCanvas, err := svc.repo.CanvasProject(canvasID)
	if err != nil || branchCanvas.UserID != editor.ID || !branchCanvas.CollaborationEnabled {
		t.Fatalf("branch = %#v, %v", branchCanvas, err)
	}
	if _, err := svc.UserCanvasProject(viewer.ID, canvasID); err != nil {
		t.Fatalf("inherited viewer read = %v", err)
	}
	if _, err := svc.UserCanvasProject("stranger", canvasID); !hasAppStatus(err, http.StatusNotFound) {
		t.Fatalf("stranger read = %v", err)
	}

	edit := CanvasCollaborationOperationRequest{OpID: "branch-edit", BaseRevision: 1, Kind: "update_node", NodeID: "node-a", Incarnation: 1, FieldGroup: "content", Before: map[string]json.RawMessage{"prompt": json.RawMessage(`"old prompt"`)}, Patch: map[string]json.RawMessage{"prompt": json.RawMessage(`"branch prompt"`)}}
	if _, err := svc.ApplyCanvasCollaborationOperation(viewer, canvasID, edit); !hasAppStatus(err, http.StatusForbidden) {
		t.Fatalf("viewer edit = %v", err)
	}
	if _, err := svc.ApplyCanvasCollaborationOperation(editor, canvasID, edit); err != nil {
		t.Fatal(err)
	}
	preview, err := svc.CanvasBranchMergePreviewForUser(owner, branchID, CanvasBranchMergePreviewRequest{})
	if err != nil || len(preview.Conflicts) != 0 {
		t.Fatalf("preview = %#v, %v", preview, err)
	}
	request := CanvasBranchMergeRequest{SourceRevision: preview.SourceRevision, ExpectedTargetRevision: preview.TargetRevision}
	if _, err := svc.MergeCanvasBranchForUser(viewer, branchID, request); !hasAppStatus(err, http.StatusForbidden) {
		t.Fatalf("viewer merge = %v", err)
	}
	stale := request
	stale.SourceRevision++
	if _, err := svc.MergeCanvasBranchForUser(owner, branchID, stale); !hasAppStatus(err, http.StatusConflict) {
		t.Fatalf("stale source = %v", err)
	}
	stale = request
	stale.ExpectedTargetRevision++
	if _, err := svc.MergeCanvasBranchForUser(owner, branchID, stale); !hasAppStatus(err, http.StatusConflict) {
		t.Fatalf("stale target = %v", err)
	}
	merged, err := svc.MergeCanvasBranchForUser(owner, branchID, request)
	if err != nil || merged.Status != "merged" || merged.TargetRevision != request.ExpectedTargetRevision+1 {
		t.Fatalf("merge = %#v, %v", merged, err)
	}
	var document struct {
		Nodes []struct {
			ID     string `json:"id"`
			Prompt string `json:"prompt"`
		} `json:"nodes"`
	}
	if err := json.Unmarshal(merged.Project, &document); err != nil {
		t.Fatal(err)
	}
	if len(document.Nodes) != 2 || document.Nodes[0].Prompt != "branch prompt" {
		t.Fatalf("merged content = %s", merged.Project)
	}
	replayed, err := svc.MergeCanvasBranchForUser(owner, branchID, request)
	if err != nil || replayed.Status != "already_merged" || replayed.TargetRevision != merged.TargetRevision {
		t.Fatalf("replay = %#v, %v", replayed, err)
	}
	if _, err := svc.repo.CanvasProject(canvasID); err != nil {
		t.Fatalf("merge deleted branch: %v", err)
	}
	if err := svc.ArchiveCanvasBranchForUser(owner, branchID); !hasAppStatus(err, http.StatusForbidden) {
		t.Fatalf("non-owner archive = %v", err)
	}
	if err := svc.ArchiveCanvasBranchForUser(editor, branchID); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.MergeCanvasBranchForUser(owner, branchID, CanvasBranchMergeRequest{SourceRevision: preview.SourceRevision, ExpectedTargetRevision: merged.TargetRevision}); !hasAppStatus(err, http.StatusConflict) {
		t.Fatalf("archived merge = %v", err)
	}
}

func TestCanvasLibraryIncludesOnlyOwnedAndInvitedCanvases(t *testing.T) {
	svc, owner, editor, stranger := newCanvasCollaborationTestService(t)
	seedCanvasCollaborationProject(t, svc.repo)
	if _, err := svc.EnableCanvasCollaboration(owner, "canvas-1", editor.ID, CanvasCollaboratorRoleEditor); err != nil {
		t.Fatal(err)
	}
	page, err := svc.UserCanvasProjectsPage(editor.ID, 1, 10, "", "", "")
	if err != nil || page.Total != 1 || len(page.Projects) != 1 || !page.Projects[0].SharedWithMe || !page.Projects[0].CollaborationEnabled {
		t.Fatalf("invited page = %#v, %v", page, err)
	}
	page, err = svc.UserCanvasProjectsPage(owner.ID, 1, 10, "", "", "")
	if err != nil || page.Total != 1 || page.Projects[0].SharedWithMe {
		t.Fatalf("owner page = %#v, %v", page, err)
	}
	page, err = svc.UserCanvasProjectsPage(stranger.ID, 1, 10, "", "", "")
	if err != nil || page.Total != 0 {
		t.Fatalf("stranger page = %#v, %v", page, err)
	}
}

func TestValidateCanvasBranchManualMergeAcceptsOnlyPreviewChoices(t *testing.T) {
	auto := json.RawMessage(`{"title":"目标","nodes":[{"id":"node-a","metadata":{"prompt":"目标提示词"}}],"connections":[]}`)
	valid := json.RawMessage(`{"title":"目标","nodes":[{"id":"node-a","metadata":{"prompt":"独立提示词"}}],"connections":[]}`)
	conflicts := []CanvasBranchConflict{{
		Path:   "nodes.node-a.metadata.prompt",
		Source: json.RawMessage(`"独立提示词"`),
		Target: json.RawMessage(`"目标提示词"`),
	}}
	if err := validateCanvasBranchManualMerge(auto, valid, conflicts); err != nil {
		t.Fatalf("valid manual merge rejected: %v", err)
	}

	tampered := json.RawMessage(`{"title":"被篡改","nodes":[{"id":"node-a","metadata":{"prompt":"独立提示词"}}],"connections":[]}`)
	if err := validateCanvasBranchManualMerge(auto, tampered, conflicts); err == nil {
		t.Fatal("tampered unrelated field was accepted")
	}
}

func TestValidateCanvasBranchManualMergeAcceptsStructureConflictChoice(t *testing.T) {
	auto := json.RawMessage(`{"title":"目标","nodes":[{"id":"node-a"}],"connections":[]}`)
	valid := json.RawMessage(`{"title":"目标","nodes":[],"connections":[]}`)
	conflicts := []CanvasBranchConflict{{
		Path:   "nodes.node-a",
		Source: nil,
		Target: json.RawMessage(`{"id":"node-a"}`),
	}}
	if err := validateCanvasBranchManualMerge(auto, valid, conflicts); err != nil {
		t.Fatalf("valid structure choice rejected: %v", err)
	}

	// Deleting an item from the middle of an array must remain valid; the
	// validator should not reject it because its normalization temporarily
	// re-inserts the reference item at the end.
	autoMiddle := json.RawMessage(`{"title":"目标","nodes":[{"id":"node-a"},{"id":"node-b"},{"id":"node-c"}],"connections":[]}`)
	validMiddle := json.RawMessage(`{"title":"目标","nodes":[{"id":"node-b"},{"id":"node-c"}],"connections":[]}`)
	middleConflict := []CanvasBranchConflict{{Path: "nodes.node-a", Source: nil, Target: json.RawMessage(`{"id":"node-a"}`)}}
	if err := validateCanvasBranchManualMerge(autoMiddle, validMiddle, middleConflict); err != nil {
		t.Fatalf("middle item deletion rejected: %v", err)
	}
}
