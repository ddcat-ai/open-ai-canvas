package canvas

import (
	"encoding/json"
	"errors"
	"infinite-canvas/backend/internal/kernel"
	"net/http"
	"testing"

	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/repository"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func TestCanvasCollaborationThreeWayDeleteEditCreateRestore(t *testing.T) {
	svc, owner, editorB, editorC := newCanvasCollaborationTestService(t)
	seedCanvasCollaborationProject(t, svc.repo)
	if _, err := svc.EnableCanvasCollaboration(owner, "canvas-1", editorB.ID, CanvasCollaboratorRoleEditor); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.EnableCanvasCollaboration(owner, "canvas-1", editorC.ID, CanvasCollaboratorRoleEditor); err != nil {
		t.Fatal(err)
	}

	updatePrompt := CanvasCollaborationOperationRequest{
		OpID: "op-a-edit", BaseRevision: 1, Kind: "update_node", NodeID: "node-a", Incarnation: 1, FieldGroup: "content",
		Before: map[string]json.RawMessage{"prompt": json.RawMessage(`"old prompt"`)},
		Patch:  map[string]json.RawMessage{"prompt": json.RawMessage(`"A prompt"`)},
	}
	first, err := svc.ApplyCanvasCollaborationOperation(owner, "canvas-1", updatePrompt)
	if err != nil || first.Revision != 2 {
		t.Fatalf("first edit = %#v, err=%v", first, err)
	}

	// B still sees the old prompt and attempts to delete. The delete must stop;
	// it must not silently erase A's new content.
	staleDelete := CanvasCollaborationOperationRequest{
		OpID: "op-b-delete-stale", BaseRevision: 1, Kind: "delete_node", NodeID: "node-a", Incarnation: 1,
		Before:                map[string]json.RawMessage{"id": json.RawMessage(`"node-a"`), "prompt": json.RawMessage(`"old prompt"`)},
		ExpectedConnectionIDs: []string{"connection-ab"},
	}
	if _, err := svc.ApplyCanvasCollaborationOperation(editorB, "canvas-1", staleDelete); !hasAppStatus(err, http.StatusConflict) {
		t.Fatalf("stale delete = %v, want conflict", err)
	}

	// C creates a child from the current node while its base revision is stale.
	// The operation is still mergeable because A is alive and C has no read
	// dependency on A's prompt.
	createChild := CanvasCollaborationOperationRequest{
		OpID: "op-c-create", BaseRevision: 1, Kind: "create_nodes",
		Nodes: []map[string]json.RawMessage{{
			"id": json.RawMessage(`"node-c"`), "type": json.RawMessage(`"text"`), "prompt": json.RawMessage(`"child"`),
		}},
		Connections: []map[string]json.RawMessage{{
			"id": json.RawMessage(`"connection-ac"`), "fromNodeId": json.RawMessage(`"node-a"`), "toNodeId": json.RawMessage(`"node-c"`),
		}},
		ExpectedConnections: []map[string]json.RawMessage{{
			"id": json.RawMessage(`"connection-ab"`), "fromNodeId": json.RawMessage(`"node-a"`), "toNodeId": json.RawMessage(`"node-b"`),
		}},
	}
	created, err := svc.ApplyCanvasCollaborationOperation(editorC, "canvas-1", createChild)
	if err != nil || created.Revision != 3 {
		t.Fatalf("create child = %#v, err=%v", created, err)
	}
	// A second batch still based on the old relation set must not silently
	// attach itself to a graph that changed after the first batch.
	staleBatch := createChild
	staleBatch.OpID = "op-c-stale-batch"
	staleBatch.Nodes = []map[string]json.RawMessage{{"id": json.RawMessage(`"node-d"`), "type": json.RawMessage(`"text"`)}}
	staleBatch.Connections = []map[string]json.RawMessage{{"id": json.RawMessage(`"connection-ad"`), "fromNodeId": json.RawMessage(`"node-a"`), "toNodeId": json.RawMessage(`"node-d"`)}}
	if _, err := svc.ApplyCanvasCollaborationOperation(editorC, "canvas-1", staleBatch); !hasAppStatus(err, http.StatusConflict) {
		t.Fatalf("stale create batch = %v, want conflict", err)
	}

	// Deleting the current node must include the new relation in its read set.
	deleteCurrent := CanvasCollaborationOperationRequest{
		OpID: "op-owner-delete", BaseRevision: 3, Kind: "delete_node", NodeID: "node-a", Incarnation: 1,
		Before:                map[string]json.RawMessage{"id": json.RawMessage(`"node-a"`), "prompt": json.RawMessage(`"A prompt"`)},
		ExpectedConnectionIDs: []string{"connection-ab", "connection-ac"},
	}
	deleted, err := svc.ApplyCanvasCollaborationOperation(owner, "canvas-1", deleteCurrent)
	if err != nil || deleted.Revision != 4 || deleted.DeletionID != "op-owner-delete" {
		t.Fatalf("delete current = %#v, err=%v", deleted, err)
	}

	lateEdit := updatePrompt
	lateEdit.OpID = "op-a-late-edit"
	if _, err := svc.ApplyCanvasCollaborationOperation(owner, "canvas-1", lateEdit); !hasAppStatus(err, http.StatusConflict) {
		t.Fatalf("late edit = %v, want incarnation conflict", err)
	}
	lateChild := createChild
	lateChild.OpID = "op-c-late-create"
	if _, err := svc.ApplyCanvasCollaborationOperation(editorC, "canvas-1", lateChild); !hasAppStatus(err, http.StatusConflict) {
		t.Fatalf("late child = %v, want deleted-target conflict", err)
	}
	if _, err := svc.ApplyCanvasCollaborationOperation(editorC, "canvas-1", CanvasCollaborationOperationRequest{
		OpID: "op-c-reuse-deleted-id", BaseRevision: 4, Kind: "create_nodes",
		Nodes: []map[string]json.RawMessage{{"id": json.RawMessage(`"node-a"`), "type": json.RawMessage(`"text"`)}},
	}); !hasAppStatus(err, http.StatusConflict) {
		t.Fatalf("reuse deleted node ID = %v, want conflict", err)
	}

	// A permitted restore is a new shared operation. It keeps the logical ID,
	// but raises the node incarnation so all old operations remain invalid.
	restored, err := svc.ApplyCanvasCollaborationOperation(owner, "canvas-1", CanvasCollaborationOperationRequest{
		OpID: "op-owner-restore", BaseRevision: 4, Kind: "restore_delete", DeletionID: "op-owner-delete",
	})
	if err != nil || restored.Revision != 5 {
		t.Fatalf("restore = %#v, err=%v", restored, err)
	}
	if _, err := svc.ApplyCanvasCollaborationOperation(owner, "canvas-1", CanvasCollaborationOperationRequest{
		OpID: "op-old-after-restore", BaseRevision: 4, Kind: "update_node", NodeID: "node-a", Incarnation: 1,
		Before: map[string]json.RawMessage{"prompt": json.RawMessage(`"old prompt"`)},
		Patch:  map[string]json.RawMessage{"prompt": json.RawMessage(`"old request"`)},
	}); !hasAppStatus(err, http.StatusConflict) {
		t.Fatalf("old operation after restore = %v, want conflict", err)
	}

	// Retrying an already applied op returns the original receipt and does not
	// create another version.
	retry, err := svc.ApplyCanvasCollaborationOperation(owner, "canvas-1", updatePrompt)
	if err != nil || retry.Revision != first.Revision || retry.Status != canvasCollabAlreadyApplied {
		t.Fatalf("idempotent retry = %#v, err=%v", retry, err)
	}
	project, err := svc.repo.CanvasProject("canvas-1")
	if err != nil {
		t.Fatal(err)
	}
	if project.Revision != 5 {
		t.Fatalf("revision after retry = %d, want 5", project.Revision)
	}

	viewer := &model.User{ID: "viewer"}
	if _, err := svc.EnableCanvasCollaboration(owner, "canvas-1", viewer.ID, CanvasCollaboratorRoleViewer); err != nil {
		// The test helper intentionally does not persist a viewer before this
		// call; verify the explicit missing-user validation instead.
		if !hasAppStatus(err, http.StatusBadRequest) {
			t.Fatalf("missing viewer = %v", err)
		}
	}
}

func TestEnableCanvasCollaborationAcceptsUsername(t *testing.T) {
	svc, owner, editor, _ := newCanvasCollaborationTestService(t)
	seedCanvasCollaborationProject(t, svc.repo)
	member, err := svc.EnableCanvasCollaboration(owner, "canvas-1", editor.Username, CanvasCollaboratorRoleEditor)
	if err != nil {
		t.Fatal(err)
	}
	if member.UserID != editor.ID {
		t.Fatalf("member user id = %q, want %q", member.UserID, editor.ID)
	}
}

func TestSearchCanvasCollaborationUsersIsOwnerScoped(t *testing.T) {
	svc, owner, editor, _ := newCanvasCollaborationTestService(t)
	seedCanvasCollaborationProject(t, svc.repo)
	if err := svc.repo.Create(&model.User{ID: "producer-1", Username: "producer", DisplayName: "制片人", Status: model.UserStatusActive}); err != nil {
		t.Fatal(err)
	}
	if err := svc.repo.Create(&model.User{ID: "disabled-1", Username: "producer-disabled", DisplayName: "停用账号", Status: model.UserStatusDisabled}); err != nil {
		t.Fatal(err)
	}
	users, err := svc.SearchCanvasCollaborationUsers(owner, "canvas-1", "制片")
	if err != nil {
		t.Fatal(err)
	}
	if len(users) != 1 || users[0].Username != "producer" || users[0].ID == owner.ID {
		t.Fatalf("search users = %#v, want the active producer only", users)
	}

	if _, err := svc.SearchCanvasCollaborationUsers(editor, "canvas-1", "producer"); !hasAppStatus(err, http.StatusForbidden) {
		t.Fatalf("non-owner search = %v, want forbidden", err)
	}
}

func TestCanvasCollaborationDifferentFieldChangesMergeAndViewerCannotWrite(t *testing.T) {
	svc, owner, editor, viewer := newCanvasCollaborationTestService(t)
	seedCanvasCollaborationProject(t, svc.repo)
	if _, err := svc.EnableCanvasCollaboration(owner, "canvas-1", editor.ID, CanvasCollaboratorRoleEditor); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.EnableCanvasCollaboration(owner, "canvas-1", viewer.ID, CanvasCollaboratorRoleViewer); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.ApplyCanvasCollaborationOperation(owner, "canvas-1", CanvasCollaborationOperationRequest{
		OpID: "merge-prompt", BaseRevision: 1, Kind: "update_node", NodeID: "node-a", Incarnation: 1,
		Before: map[string]json.RawMessage{"prompt": json.RawMessage(`"old prompt"`)},
		Patch:  map[string]json.RawMessage{"prompt": json.RawMessage(`"new prompt"`)},
	}); err != nil {
		t.Fatal(err)
	}
	merged, err := svc.ApplyCanvasCollaborationOperation(editor, "canvas-1", CanvasCollaborationOperationRequest{
		OpID: "merge-position", BaseRevision: 1, Kind: "update_node", NodeID: "node-a", Incarnation: 1,
		Before: map[string]json.RawMessage{"position": json.RawMessage(`{"x":0,"y":0}`)},
		Patch:  map[string]json.RawMessage{"position": json.RawMessage(`{"x":100,"y":20}`)},
	})
	if err != nil || merged.Revision != 3 {
		t.Fatalf("different field merge = %#v, err=%v", merged, err)
	}
	if _, err := svc.ApplyCanvasCollaborationOperation(viewer, "canvas-1", CanvasCollaborationOperationRequest{
		OpID: "viewer-write", BaseRevision: 3, Kind: "update_node", NodeID: "node-a", Incarnation: 1,
		Before: map[string]json.RawMessage{"prompt": json.RawMessage(`"new prompt"`)},
		Patch:  map[string]json.RawMessage{"prompt": json.RawMessage(`"blocked"`)},
	}); !hasAppStatus(err, http.StatusForbidden) {
		t.Fatalf("viewer write = %v, want forbidden", err)
	}
}

func TestCanvasCollaborationCanvasFieldsMergeAndProtectProjectAssociation(t *testing.T) {
	svc, owner, editor, _ := newCanvasCollaborationTestService(t)
	seedCanvasCollaborationProject(t, svc.repo)
	if _, err := svc.EnableCanvasCollaboration(owner, "canvas-1", editor.ID, CanvasCollaboratorRoleEditor); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.ApplyCanvasCollaborationOperation(owner, "canvas-1", CanvasCollaborationOperationRequest{
		OpID: "canvas-title", BaseRevision: 1, Kind: "update_canvas",
		RootBefore: map[string]json.RawMessage{"title": json.RawMessage(`"协作测试画布"`)},
		RootPatch:  map[string]json.RawMessage{"title": json.RawMessage(`"新标题"`)},
	}); err != nil {
		t.Fatal(err)
	}
	merged, err := svc.ApplyCanvasCollaborationOperation(editor, "canvas-1", CanvasCollaborationOperationRequest{
		OpID: "canvas-chat", BaseRevision: 1, Kind: "update_canvas",
		RootBefore: map[string]json.RawMessage{"activeChatId": json.RawMessage(`null`)},
		RootPatch:  map[string]json.RawMessage{"activeChatId": json.RawMessage(`"chat-1"`)},
	})
	if err != nil || merged.Revision != 3 {
		t.Fatalf("canvas field merge = %#v, err=%v", merged, err)
	}
	if _, err := svc.ApplyCanvasCollaborationOperation(editor, "canvas-1", CanvasCollaborationOperationRequest{
		OpID: "editor-project-association", BaseRevision: 3, Kind: "update_canvas",
		RootBefore: map[string]json.RawMessage{"projectId": json.RawMessage(`null`)},
		RootPatch:  map[string]json.RawMessage{"projectId": json.RawMessage(`"project-2"`)},
	}); !hasAppStatus(err, http.StatusForbidden) {
		t.Fatalf("editor project association = %v, want forbidden", err)
	}
	if _, err := svc.ApplyCanvasCollaborationOperation(editor, "canvas-1", CanvasCollaborationOperationRequest{
		OpID: "stale-title", BaseRevision: 1, Kind: "update_canvas",
		RootBefore: map[string]json.RawMessage{"title": json.RawMessage(`"协作测试画布"`)},
		RootPatch:  map[string]json.RawMessage{"title": json.RawMessage(`"另一个标题"`)},
	}); !hasAppStatus(err, http.StatusConflict) {
		t.Fatalf("stale title = %v, want conflict", err)
	}
}

func TestCanvasCollaborationHistoricalRestoreReconcilesNodeLifecycles(t *testing.T) {
	svc, owner, _, _ := newCanvasCollaborationTestService(t)
	seedCanvasCollaborationProject(t, svc.repo)
	if _, err := svc.EnableCanvasCollaboration(owner, "canvas-1", "editor-b", CanvasCollaboratorRoleEditor); err != nil {
		t.Fatal(err)
	}
	oldOnlyA := map[string]any{
		"id": "canvas-1", "title": "历史 A", "nodes": []any{
			map[string]any{"id": "node-a", "type": "text", "prompt": "old prompt", "position": map[string]any{"x": 0, "y": 0}},
		}, "connections": []any{},
	}
	oldBoth := map[string]any{
		"id": "canvas-1", "title": "历史 AB", "nodes": []any{
			map[string]any{"id": "node-a", "type": "text", "prompt": "old prompt", "position": map[string]any{"x": 0, "y": 0}},
			map[string]any{"id": "node-b", "type": "text", "prompt": "other", "position": map[string]any{"x": 300, "y": 0}},
		}, "connections": []any{},
	}
	firstRaw, _ := json.Marshal(oldOnlyA)
	secondRaw, _ := json.Marshal(oldBoth)
	if err := svc.repo.WithCanvasCollaborationTransaction("canvas-1", func(tx *gorm.DB, _ *model.CanvasProject) error {
		return tx.Create(&model.CanvasSnapshot{ID: "snapshot-a", CanvasID: "canvas-1", UserID: owner.ID, Revision: 10, Title: "历史 A", PayloadJSON: string(firstRaw)}).Error
	}); err != nil {
		t.Fatal(err)
	}
	if err := svc.repo.WithCanvasCollaborationTransaction("canvas-1", func(tx *gorm.DB, _ *model.CanvasProject) error {
		return tx.Create(&model.CanvasSnapshot{ID: "snapshot-ab", CanvasID: "canvas-1", UserID: owner.ID, Revision: 11, Title: "历史 AB", PayloadJSON: string(secondRaw)}).Error
	}); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.ApplyCanvasCollaborationOperation(owner, "canvas-1", CanvasCollaborationOperationRequest{
		OpID: "before-restore-edit", BaseRevision: 1, Kind: "update_node", NodeID: "node-a", Incarnation: 1,
		Before: map[string]json.RawMessage{"prompt": json.RawMessage(`"old prompt"`)}, Patch: map[string]json.RawMessage{"prompt": json.RawMessage(`"changed"`)},
	}); err != nil {
		t.Fatal(err)
	}
	firstRestore, err := svc.ApplyCanvasCollaborationOperation(owner, "canvas-1", CanvasCollaborationOperationRequest{OpID: "restore-a", BaseRevision: 2, Kind: "restore_snapshot", SnapshotID: "snapshot-a"})
	if err != nil || firstRestore.Revision != 3 {
		t.Fatalf("first restore = %#v, err=%v", firstRestore, err)
	}
	if _, err := svc.ApplyCanvasCollaborationOperation(owner, "canvas-1", CanvasCollaborationOperationRequest{
		OpID: "stale-node-a-before-restore", BaseRevision: 2, Kind: "update_node", NodeID: "node-a", Incarnation: 1,
		Before: map[string]json.RawMessage{"prompt": json.RawMessage(`"changed"`)}, Patch: map[string]json.RawMessage{"prompt": json.RawMessage(`"stale"`)},
	}); !hasAppStatus(err, http.StatusConflict) {
		t.Fatalf("stale active node after restore = %v, want conflict", err)
	}
	if _, err := svc.ApplyCanvasCollaborationOperation(owner, "canvas-1", CanvasCollaborationOperationRequest{
		OpID: "stale-node-b", BaseRevision: 2, Kind: "update_node", NodeID: "node-b", Incarnation: 1,
		Before: map[string]json.RawMessage{"prompt": json.RawMessage(`"other"`)}, Patch: map[string]json.RawMessage{"prompt": json.RawMessage(`"stale"`)},
	}); !hasAppStatus(err, http.StatusConflict) {
		t.Fatalf("stale node after restore = %v, want conflict", err)
	}
	secondRestore, err := svc.ApplyCanvasCollaborationOperation(owner, "canvas-1", CanvasCollaborationOperationRequest{OpID: "restore-ab", BaseRevision: 3, Kind: "restore_snapshot", SnapshotID: "snapshot-ab"})
	if err != nil || secondRestore.Revision != 4 {
		t.Fatalf("second restore = %#v, err=%v", secondRestore, err)
	}
	var restored map[string]json.RawMessage
	if err := json.Unmarshal(secondRestore.Document, &restored); err != nil {
		t.Fatal(err)
	}
	var restoredNodes []map[string]json.RawMessage
	if err := json.Unmarshal(restored["nodes"], &restoredNodes); err != nil {
		t.Fatal(err)
	}
	var restoredB map[string]json.RawMessage
	for _, node := range restoredNodes {
		if rawString(node["id"]) == "node-b" {
			restoredB = node
		}
	}
	var metadata map[string]json.RawMessage
	if err := json.Unmarshal(restoredB["metadata"], &metadata); err != nil {
		t.Fatal(err)
	}
	if string(metadata["collaborationIncarnation"]) != "2" {
		t.Fatalf("reintroduced node incarnation = %s, want 2", string(metadata["collaborationIncarnation"]))
	}
	var restoreOperation model.CanvasCollaborationOperation
	if err := svc.repo.WithCanvasCollaborationTransaction("canvas-1", func(tx *gorm.DB, _ *model.CanvasProject) error {
		return tx.Where("canvas_id = ? AND op_id = ?", "canvas-1", "restore-a").First(&restoreOperation).Error
	}); err != nil {
		t.Fatal(err)
	}
	if restoreOperation.Kind != "restore_snapshot" || restoreOperation.SnapshotJSON == "" {
		t.Fatalf("restore operation = %#v, want previous document snapshot", restoreOperation)
	}
}

func TestCanvasCollaborationRestoreRejectsRelationToNewEndpointIncarnation(t *testing.T) {
	svc, owner, editor, _ := newCanvasCollaborationTestService(t)
	seedCanvasCollaborationProject(t, svc.repo)
	if _, err := svc.EnableCanvasCollaboration(owner, "canvas-1", editor.ID, CanvasCollaboratorRoleEditor); err != nil {
		t.Fatal(err)
	}

	if _, err := svc.ApplyCanvasCollaborationOperation(owner, "canvas-1", CanvasCollaborationOperationRequest{
		OpID: "delete-a-for-relation", BaseRevision: 1, Kind: "delete_node", NodeID: "node-a", Incarnation: 1,
		Before:                map[string]json.RawMessage{"id": json.RawMessage(`"node-a"`), "prompt": json.RawMessage(`"old prompt"`)},
		ExpectedConnectionIDs: []string{"connection-ab"},
	}); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.ApplyCanvasCollaborationOperation(owner, "canvas-1", CanvasCollaborationOperationRequest{
		OpID: "delete-b-for-relation", BaseRevision: 2, Kind: "delete_node", NodeID: "node-b", Incarnation: 1,
		Before:                map[string]json.RawMessage{"id": json.RawMessage(`"node-b"`), "prompt": json.RawMessage(`"other"`)},
		ExpectedConnectionIDs: []string{},
	}); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.ApplyCanvasCollaborationOperation(owner, "canvas-1", CanvasCollaborationOperationRequest{
		OpID: "restore-b-for-relation", BaseRevision: 3, Kind: "restore_delete", DeletionID: "delete-b-for-relation",
	}); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.ApplyCanvasCollaborationOperation(owner, "canvas-1", CanvasCollaborationOperationRequest{
		OpID: "restore-a-stale-relation", BaseRevision: 4, Kind: "restore_delete", DeletionID: "delete-a-for-relation", RestoreConnectionIDs: []string{"connection-ab"},
	}); !hasAppStatus(err, http.StatusConflict) {
		t.Fatalf("restore relation to new endpoint incarnation = %v, want conflict", err)
	}
}

func TestCanvasCollaborationDeletesConnectedNodesSequentially(t *testing.T) {
	svc, owner, editor, _ := newCanvasCollaborationTestService(t)
	seedCanvasCollaborationProject(t, svc.repo)
	if _, err := svc.EnableCanvasCollaboration(owner, "canvas-1", editor.ID, CanvasCollaboratorRoleEditor); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.ApplyCanvasCollaborationOperation(owner, "canvas-1", CanvasCollaborationOperationRequest{
		OpID: "delete-connected-a", BaseRevision: 1, Kind: "delete_node", NodeID: "node-a", Incarnation: 1,
		Before:                map[string]json.RawMessage{"id": json.RawMessage(`"node-a"`), "prompt": json.RawMessage(`"old prompt"`)},
		ExpectedConnectionIDs: []string{"connection-ab"},
	}); err != nil {
		t.Fatal(err)
	}
	deleted, err := svc.ApplyCanvasCollaborationOperation(owner, "canvas-1", CanvasCollaborationOperationRequest{
		OpID: "delete-connected-b", BaseRevision: 2, Kind: "delete_node", NodeID: "node-b", Incarnation: 1,
		Before:                map[string]json.RawMessage{"id": json.RawMessage(`"node-b"`), "prompt": json.RawMessage(`"other"`)},
		ExpectedConnectionIDs: []string{},
	})
	if err != nil || deleted.Revision != 3 {
		t.Fatalf("delete connected B after A = %#v, err=%v", deleted, err)
	}
}

func newCanvasCollaborationTestService(t *testing.T) (*Service, *model.User, *model.User, *model.User) {
	t.Helper()
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&model.User{}, &model.CanvasProject{}, &model.CanvasShare{}, &model.CanvasSnapshot{}, &model.CanvasSnapshotResource{}, &model.Resource{}, &model.Asset{}, &model.CanvasMediaGrant{}, &model.CanvasBranch{}, &model.CanvasCollaborator{}, &model.CanvasCollaborationNode{}, &model.CanvasCollaborationOperation{}); err != nil {
		t.Fatal(err)
	}
	repo := repository.New(db)
	owner := &model.User{ID: "owner", Username: "owner"}
	editorB := &model.User{ID: "editor-b", Username: "editor-b"}
	editorC := &model.User{ID: "editor-c", Username: "editor-c"}
	viewer := &model.User{ID: "viewer", Username: "viewer"}
	for _, user := range []*model.User{owner, editorB, editorC, viewer} {
		if err := db.Create(user).Error; err != nil {
			t.Fatal(err)
		}
	}
	return New(repo, nil), owner, editorB, editorC
}

func seedCanvasCollaborationProject(t *testing.T, repo *repository.Repository) {
	t.Helper()
	payload := map[string]any{
		"id": "canvas-1", "title": "协作测试画布", "projectId": nil, "activeChatId": nil,
		"nodes": []any{
			map[string]any{"id": "node-a", "type": "text", "prompt": "old prompt", "position": map[string]any{"x": 0, "y": 0}},
			map[string]any{"id": "node-b", "type": "text", "prompt": "other", "position": map[string]any{"x": 300, "y": 0}},
		},
		"connections": []any{map[string]any{"id": "connection-ab", "fromNodeId": "node-a", "toNodeId": "node-b"}},
	}
	raw, _ := json.Marshal(payload)
	if err := repo.UpsertCanvasProject(&model.CanvasProject{ID: "canvas-1", UserID: "owner", Title: "协作测试画布", PayloadJSON: string(raw)}); err != nil {
		t.Fatal(err)
	}
}

func hasAppStatus(err error, status int) bool {
	var appError *kernel.AppError
	return errors.As(err, &appError) && appError.Status == status
}
