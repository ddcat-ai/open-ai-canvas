package canvas

import (
	"encoding/json"
	"fmt"
	"net/http"
	"testing"

	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/repository"
)

func seedCanvasMedia(t *testing.T, svc *Service, owner, id, kind string) map[string]json.RawMessage {
	t.Helper()
	resource := model.Resource{ID: id, UserID: owner, Kind: kind, Status: model.ResourceStatusReady}
	if err := svc.repo.Create(&resource); err != nil {
		t.Fatal(err)
	}
	asset := model.Asset{ID: "asset-" + id, UserID: owner, Kind: kind, PayloadJSON: fmt.Sprintf(`{"id":"asset-%s","kind":%q,"data":{"storageKey":"resource:%s"}}`, id, kind, id)}
	if err := svc.repo.Create(&asset); err != nil {
		t.Fatal(err)
	}
	var node map[string]json.RawMessage
	if err := json.Unmarshal([]byte(fmt.Sprintf(`{"id":%q,"type":%q,"metadata":{"assetId":"asset-%s","storageKey":"resource:%s"}}`, id, kind, id, id)), &node); err != nil {
		t.Fatal(err)
	}
	return node
}

func saveCanvasMedia(t *testing.T, svc *Service, nodes ...map[string]json.RawMessage) {
	t.Helper()
	raw, err := json.Marshal(map[string]any{"id": "canvas-1", "title": "media", "revision": 0, "nodes": nodes, "connections": []any{}})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := svc.UpsertUserCanvasProject("owner", raw); err != nil {
		t.Fatal(err)
	}
}

func TestCanvasMediaMemberReadAndRevocation(t *testing.T) {
	svc, owner, editor, stranger := newCanvasCollaborationTestService(t)
	viewer := &model.User{ID: "viewer"}
	nodes := []map[string]json.RawMessage{}
	for _, kind := range []string{"image", "video", "audio"} {
		nodes = append(nodes, seedCanvasMedia(t, svc, owner.ID, kind, kind))
	}
	seedCanvasMedia(t, svc, owner.ID, "private", "image")
	saveCanvasMedia(t, svc, nodes...)
	for _, member := range []struct {
		user *model.User
		role string
	}{{editor, CanvasCollaboratorRoleEditor}, {viewer, CanvasCollaboratorRoleViewer}} {
		if _, err := svc.EnableCanvasCollaboration(owner, "canvas-1", member.user.ID, member.role); err != nil {
			t.Fatal(err)
		}
		for _, kind := range []string{"image", "video", "audio"} {
			resource, err := svc.ResourceForReader(member.user.ID, kind)
			if err != nil || resource.UserID != owner.ID {
				t.Fatalf("%s reads %s: %#v %v", member.role, kind, resource, err)
			}
			if _, err := svc.UserAsset(member.user.ID, "asset-"+kind); err != nil {
				t.Fatal(err)
			}
		}
		items, err := svc.UserAssetsByIDs(member.user.ID, []string{"asset-image", "asset-video", "asset-audio", "asset-private"})
		if err != nil || len(items) != 3 {
			t.Fatalf("shared assets = %s, %v", items, err)
		}
		privateLibrary, err := svc.UserAssets(member.user.ID)
		if err != nil || len(privateLibrary) != 0 {
			t.Fatalf("private library widened: %s %v", privateLibrary, err)
		}
		if _, err := svc.ResourceForReader(member.user.ID, "private"); !hasAppStatus(err, http.StatusNotFound) {
			t.Fatalf("private resource = %v", err)
		}
	}
	if _, err := svc.ResourceForReader(stranger.ID, "image"); !hasAppStatus(err, http.StatusNotFound) {
		t.Fatalf("stranger = %v", err)
	}
	if _, err := svc.ApplyCanvasCollaborationOperation(viewer, "canvas-1", CanvasCollaborationOperationRequest{OpID: "viewer-write", Kind: "create_nodes", BaseRevision: 1, Nodes: []map[string]json.RawMessage{nodes[0]}}); !hasAppStatus(err, http.StatusForbidden) {
		t.Fatalf("viewer write = %v", err)
	}
	for _, member := range []*model.User{editor, viewer} {
		if err := svc.RemoveCanvasCollaborator(owner, "canvas-1", member.ID); err != nil {
			t.Fatal(err)
		}
		if _, err := svc.ResourceForReader(member.ID, "image"); !hasAppStatus(err, http.StatusNotFound) {
			t.Fatalf("revoked resource = %v", err)
		}
		if _, err := svc.UserAsset(member.ID, "asset-image"); err == nil {
			t.Fatal("revoked asset readable")
		}
		items, err := svc.UserAssetsByIDs(member.ID, []string{"asset-image"})
		if err != nil || len(items) != 0 {
			t.Fatalf("revoked batch = %s, %v", items, err)
		}
	}
}

func TestCanvasMediaSharesServerOutputBeforeAssetMaterialization(t *testing.T) {
	svc, owner, _, _ := newCanvasCollaborationTestService(t)
	if err := svc.repo.Create(&model.Resource{ID: "agent-output", UserID: owner.ID, Kind: "video", Status: model.ResourceStatusReady}); err != nil {
		t.Fatal(err)
	}
	project := model.CanvasProject{ID: "canvas-1", UserID: owner.ID, PayloadJSON: `{"id":"canvas-1","nodes":[{"id":"video","type":"video","metadata":{"storageKey":"resource:agent-output"}}],"connections":[]}`}
	if err := SaveDocumentWithHistory(svc.repo, nil, &project, "automatic"); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.EnableCanvasCollaboration(owner, project.ID, "viewer", CanvasCollaboratorRoleViewer); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.ResourceForReader("viewer", "agent-output"); err != nil {
		t.Fatal(err)
	}
	if err := svc.ValidateCanvasMediaAssets(owner.ID, json.RawMessage(project.PayloadJSON)); err == nil {
		t.Fatal("browser upload sync must still require its asset pair")
	}
}

func TestCanvasMediaEditorContributionAndForgedReferences(t *testing.T) {
	svc, owner, editor, _ := newCanvasCollaborationTestService(t)
	saveCanvasMedia(t, svc, seedCanvasMedia(t, svc, owner.ID, "image", "image"))
	for _, member := range []string{editor.ID, "viewer"} {
		if _, err := svc.EnableCanvasCollaboration(owner, "canvas-1", member, CanvasCollaboratorRoleEditor); err != nil {
			t.Fatal(err)
		}
	}
	contributed := seedCanvasMedia(t, svc, editor.ID, "contributed", "video")
	if _, err := svc.ApplyCanvasCollaborationOperation(editor, "canvas-1", CanvasCollaborationOperationRequest{OpID: "contribute", Kind: "create_nodes", BaseRevision: 1, Nodes: []map[string]json.RawMessage{contributed}}); err != nil {
		t.Fatal(err)
	}
	for _, id := range []string{owner.ID, "viewer"} {
		if _, err := svc.ResourceForReader(id, "contributed"); err != nil {
			t.Fatal(err)
		}
	}
	private := seedCanvasMedia(t, svc, owner.ID, "private", "image")
	for name, node := range map[string]map[string]json.RawMessage{
		"asset":   private,
		"preview": {"id": json.RawMessage(`"forged-preview"`), "type": json.RawMessage(`"text"`), "metadata": json.RawMessage(`{"previewContent":"/api/resources/private/file"}`)},
	} {
		t.Run(name, func(t *testing.T) {
			if _, err := svc.ApplyCanvasCollaborationOperation(editor, "canvas-1", CanvasCollaborationOperationRequest{OpID: "forge-" + name, Kind: "create_nodes", BaseRevision: 2, Nodes: []map[string]json.RawMessage{node}}); !hasAppStatus(err, http.StatusForbidden) {
				t.Fatalf("forged reference = %v", err)
			}
			stored, err := svc.repo.CanvasProject("canvas-1")
			if err != nil || stored.Revision != 2 {
				t.Fatalf("rejected write changed revision: %#v %v", stored, err)
			}
			if _, err := svc.ResourceForReader(editor.ID, "private"); !hasAppStatus(err, http.StatusNotFound) {
				t.Fatalf("rejected write granted access: %v", err)
			}
		})
	}
	if err := svc.repo.WithTransaction(func(repo *repository.Repository) error {
		return repo.RequireNoCanvasHistoryReferences([]string{"contributed"})
	}); err == nil {
		t.Fatal("cross-owner current reference did not protect deletion")
	}
	changed := json.RawMessage(`{"id":"asset-contributed","kind":"video","data":{"storageKey":"resource:private"}}`)
	if _, err := svc.UpsertUserAsset(editor.ID, changed); err == nil {
		t.Fatal("contributor replaced media referenced by another owner's canvas")
	}
}

func TestCanvasMediaBranchMergeAndHistory(t *testing.T) {
	svc, owner, editor, _ := newCanvasCollaborationTestService(t)
	saveCanvasMedia(t, svc, seedCanvasMedia(t, svc, owner.ID, "image", "image"))
	if _, err := svc.EnableCanvasCollaboration(owner, "canvas-1", editor.ID, CanvasCollaboratorRoleEditor); err != nil {
		t.Fatal(err)
	}
	branch, err := svc.CreateCanvasBranchForUser(editor, "canvas-1", CanvasBranchCreateRequest{Name: "Media branch"})
	if err != nil {
		t.Fatal(err)
	}
	branchCanvasID := branch.Branch.BranchCanvasID
	share, err := svc.CreateCanvasShare(editor.ID, branchCanvasID, CanvasShareRequest{})
	if err != nil {
		t.Fatal(err)
	}
	storageOwner, resource, err := svc.sharedCanvasResource(share.Token, "image")
	if err != nil || storageOwner != owner.ID || resource.UserID != owner.ID {
		t.Fatalf("branch public media = %s %#v %v", storageOwner, resource, err)
	}
	seedCanvasMedia(t, svc, owner.ID, "unshared", "image")
	if _, _, err := svc.sharedCanvasResource(share.Token, "unshared"); err == nil {
		t.Fatal("public branch read unreferenced owner media")
	}
	contributed := seedCanvasMedia(t, svc, editor.ID, "branch-video", "video")
	if _, err := svc.ApplyCanvasCollaborationOperation(editor, branchCanvasID, CanvasCollaborationOperationRequest{OpID: "branch-contribute", Kind: "create_nodes", BaseRevision: 1, Nodes: []map[string]json.RawMessage{contributed}}); err != nil {
		t.Fatal(err)
	}
	preview, err := svc.CanvasBranchMergePreviewForUser(owner, branch.Branch.ID, CanvasBranchMergePreviewRequest{})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := svc.MergeCanvasBranchForUser(owner, branch.Branch.ID, CanvasBranchMergeRequest{SourceRevision: preview.SourceRevision, ExpectedTargetRevision: preview.TargetRevision}); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.EnableCanvasCollaboration(owner, "canvas-1", "viewer", CanvasCollaboratorRoleViewer); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.ResourceForReader("viewer", "branch-video"); err != nil {
		t.Fatalf("merged media = %v", err)
	}
	if err := svc.RemoveCanvasCollaborator(owner, "canvas-1", editor.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.ResourceForReader(editor.ID, "image"); err != nil {
		t.Fatalf("independent branch lost media = %v", err)
	}
	// A removed node is still readable in retained snapshots and can be restored.
	if _, err := svc.ApplyCanvasCollaborationOperation(owner, "canvas-1", CanvasCollaborationOperationRequest{OpID: "delete-image", Kind: "delete_node", BaseRevision: 2, NodeID: "image", Incarnation: 1, Before: map[string]json.RawMessage{"id": json.RawMessage(`"image"`)}, ExpectedConnectionIDs: []string{}}); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.ResourceForReader("viewer", "image"); err != nil {
		t.Fatalf("history media = %v", err)
	}
	if _, err := svc.ApplyCanvasCollaborationOperation(owner, "canvas-1", CanvasCollaborationOperationRequest{OpID: "restore-image", Kind: "restore_delete", BaseRevision: 3, DeletionID: "delete-image"}); err != nil {
		t.Fatal(err)
	}
}
