package canvas

import (
	"encoding/json"
	"strings"
	"testing"
	"time"

	canvasdoc "yingce/backend/internal/canvas/document"
	"yingce/backend/internal/model"
)

func TestCanvasNodeModelSaveRestoreAndShareBoundary(t *testing.T) {
	svc := newCanvasHistoryTestService(t)
	original := `{"id":"canvas","revision":0,"title":"保留作品","nodes":[{"id":"markdown","type":"markdown","title":"原文","position":{"x":12,"y":24},"width":420,"height":320,"metadata":{"content":"# 保留正文","custom":{"type":"html"}}},{"id":"compare","type":"compare"}],"connections":[{"id":"edge","fromNodeId":"markdown","toNodeId":"compare"}]}`
	saved, err := svc.UpsertUserCanvasProject("owner", json.RawMessage(original))
	if err != nil || saved.Revision != 1 {
		t.Fatalf("save: %+v %v", saved, err)
	}
	project, err := svc.repo.CanvasProjectForUser("owner", "canvas")
	if err != nil {
		t.Fatal(err)
	}
	assertCanonicalBoundary(t, project.PayloadJSON)
	public, _, err := publicCanvasProject(project, "share-token")
	if err != nil {
		t.Fatal(err)
	}
	publicRaw, _ := json.Marshal(public)
	assertCanonicalBoundary(t, string(publicRaw))
	var publicDoc struct {
		Nodes []struct{ Metadata map[string]any }
	}
	json.Unmarshal(publicRaw, &publicDoc)
	if publicDoc.Nodes[0].Metadata["textFormat"] != "markdown" {
		t.Fatal("share stripped textFormat")
	}

	updated := strings.Replace(original, `"revision":0`, `"revision":1`, 1)
	updated = strings.Replace(updated, "# 保留正文", "已修改", 1)
	if _, err := svc.UpsertUserCanvasProject("owner", json.RawMessage(updated)); err != nil {
		t.Fatal(err)
	}
	history, err := svc.CanvasHistory("owner", "canvas")
	if err != nil || len(history.Snapshots) != 1 {
		t.Fatalf("history: %+v %v", history, err)
	}
	snapshot, err := svc.CanvasHistorySnapshot("owner", "canvas", history.Snapshots[0].ID)
	if err != nil {
		t.Fatal(err)
	}
	assertCanonicalBoundary(t, snapshot.PayloadJSON)
	restored, err := svc.RestoreCanvasHistory("owner", "canvas", snapshot.ID, &history.CurrentRevision)
	if err != nil || restored.Revision != 3 {
		t.Fatalf("restore: %+v %v", restored, err)
	}
	project, _ = svc.repo.CanvasProjectForUser("owner", "canvas")
	assertCanonicalBoundary(t, project.PayloadJSON)
	if !strings.Contains(project.PayloadJSON, "# 保留正文") {
		t.Fatal("restore lost original content")
	}
}

func TestCanvasNodeModelOperationsKeepOriginalIdempotencyIdentity(t *testing.T) {
	svc := newCanvasOperationTestService(t)
	req := CanvasOperationsRequest{MutationID: "migration-boundary", Operations: []CanvasOperation{
		{Type: "create_canvas", ID: "canvas"},
		{Type: "create_node", Node: json.RawMessage(`{"id":"markdown","type":"markdown","title":"原文","metadata":{"content":"# 保留正文"}}`)},
		{Type: "create_node", Node: json.RawMessage(`{"id":"compare","type":"compare"}`)},
		{Type: "create_connection", Connection: json.RawMessage(`{"id":"edge","fromNodeId":"markdown","toNodeId":"compare"}`)},
	}}
	digest := CanvasOperationsDigest(req)
	first, err := svc.ApplyUserCanvasOperations("user", "canvas", req)
	if err != nil {
		t.Fatal(err)
	}
	project, _ := svc.repo.CanvasProjectForUser("user", "canvas")
	assertCanonicalBoundary(t, project.PayloadJSON)
	receipt, err := svc.repo.CanvasMutationReceiptForUser("user", "canvas", req.MutationID)
	if err != nil || receipt.PayloadDigest != digest {
		t.Fatalf("request identity changed: %+v %v", receipt, err)
	}
	second, err := svc.ApplyUserCanvasOperations("user", "canvas", req)
	if err != nil || second.Revision != first.Revision {
		t.Fatalf("same request replay: %+v %v", second, err)
	}
	req.Operations[1].Node = json.RawMessage(`{"id":"markdown","type":"text","metadata":{"content":"# 保留正文","textFormat":"markdown"}}`)
	if _, err := svc.ApplyUserCanvasOperations("user", "canvas", req); err == nil {
		t.Fatal("rewritten request reused old idempotency key")
	}
}

func TestCanvasNodeModelRepositoryBoundaryProtectsSnapshots(t *testing.T) {
	svc := newCanvasHistoryTestService(t)
	project := model.CanvasProject{ID: "canvas", UserID: "owner", PayloadJSON: `{"nodes":[{"id":"old","type":"svg","metadata":{"content":"<svg/>"}}],"connections":[]}`}
	if err := svc.repo.UpsertCanvasProject(&project); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(project.PayloadJSON, `"textFormat":"plain"`) {
		t.Fatal("repository admitted retired type")
	}
	snapshot := &model.CanvasSnapshot{ID: "snapshot", CanvasID: "canvas", UserID: "owner", Revision: project.Revision, PayloadJSON: `{"nodes":[{"id":"history","type":"chart","metadata":{"content":"{\"values\":[1]}","chartKind":"bar"}}]}`, CreatedAt: time.Now()}
	if err := svc.repo.SaveCanvasWithSnapshot(&project, snapshot, nil, nil, time.Now(), 20, true); err != nil {
		t.Fatal(err)
	}
	stored, err := svc.repo.CanvasSnapshot("owner", "canvas", "snapshot")
	if err != nil {
		t.Fatal(err)
	}
	if stored.PayloadBytes != len([]byte(stored.PayloadJSON)) || strings.Contains(stored.PayloadJSON, `"type":"chart"`) || strings.Contains(stored.PayloadJSON, "chartKind") {
		t.Fatalf("noncanonical snapshot: %+v", stored)
	}
}

func TestCanvasNodeModelInvalidIncomingBodyRollsBack(t *testing.T) {
	svc := newCanvasHistoryTestService(t)
	_, err := svc.UpsertUserCanvasProject("owner", json.RawMessage(`{"id":"canvas","revision":0,"nodes":[{"id":"x","type":"html","metadata":{"content":{"raw":"cannot discard"}}}]}`))
	if err == nil {
		t.Fatal("invalid source content was discarded")
	}
	if _, err := svc.repo.CanvasProjectForUser("owner", "canvas"); err == nil {
		t.Fatal("invalid migration created a canvas")
	}
}

func assertCanonicalBoundary(t *testing.T, raw string) {
	t.Helper()
	_, changed, err := canvasdoc.Canonicalize([]byte(raw))
	if err != nil || changed {
		t.Fatalf("boundary returned retired nodes: %s err=%v", raw, err)
	}
	var doc struct {
		Nodes []struct {
			ID, Type string
			Metadata struct{ Content, TextFormat string }
		}
		Connections []struct{ ID, FromNodeID, ToNodeID string }
	}
	if err := json.Unmarshal([]byte(raw), &doc); err != nil {
		t.Fatal(err)
	}
	if len(doc.Nodes) != 2 || doc.Nodes[0].ID != "markdown" || doc.Nodes[0].Type != "text" || doc.Nodes[0].Metadata.TextFormat != "markdown" || doc.Nodes[1].Type != "text" {
		t.Fatalf("node identity/format lost: %s", raw)
	}
	if len(doc.Connections) != 1 || doc.Connections[0].ID != "edge" || doc.Connections[0].FromNodeID != "markdown" || doc.Connections[0].ToNodeID != "compare" {
		t.Fatalf("edge changed: %s", raw)
	}
	if doc.Nodes[1].Metadata.Content != "对比参考：\n原文 @[node:markdown]" {
		t.Fatalf("comparison body changed: %s", raw)
	}
}
