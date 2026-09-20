package canvas

import (
	"encoding/json"
	"net/http"
	"testing"
)

func TestCanvasMergeKeepsUnsafePathKeysAtomic(t *testing.T) {
	for _, key := range []string{"plugin.key", "__proto__", "constructor", "prototype"} {
		value := func(n int) json.RawMessage {
			raw, _ := json.Marshal(map[string]any{key: map[string]int{"value": n}})
			return raw
		}
		var conflicts []CanvasBranchConflict
		merged := mergeCanvasValue(value(1), value(2), value(3), "metadata", true, func(c CanvasBranchConflict) { conflicts = append(conflicts, c) })
		if len(conflicts) != 1 || conflicts[0].Path != "metadata" || !rawEqual(merged, value(3)) {
			t.Fatalf("unsafe path %s: conflicts=%#v merged=%s", key, conflicts, merged)
		}
	}
}

func TestCanvasCollaborationMetadataLeavesAndConnections(t *testing.T) {
	svc, owner, editor, _ := newCanvasCollaborationTestService(t)
	seedCanvasCollaborationProject(t, svc.repo)
	if _, err := svc.EnableCanvasCollaboration(owner, "canvas-1", editor.ID, "editor"); err != nil {
		t.Fatal(err)
	}
	apply := func(actor bool, req CanvasCollaborationOperationRequest) CanvasCollaborationOperationResult {
		t.Helper()
		user := owner
		if actor {
			user = editor
		}
		result, err := svc.ApplyCanvasCollaborationOperation(user, "canvas-1", req)
		if err != nil {
			t.Fatal(err)
		}
		return result
	}
	apply(false, CanvasCollaborationOperationRequest{OpID: "meta-a", Kind: "update_node", BaseRevision: 1, NodeID: "node-a", Incarnation: 1, Before: map[string]json.RawMessage{"metadata": json.RawMessage(`null`)}, Patch: map[string]json.RawMessage{"metadata": json.RawMessage(`{"pluginData":{"seed":2}}`)}})
	result := apply(true, CanvasCollaborationOperationRequest{OpID: "meta-b", Kind: "update_node", BaseRevision: 1, NodeID: "node-a", Incarnation: 1, Before: map[string]json.RawMessage{"metadata": json.RawMessage(`null`)}, Patch: map[string]json.RawMessage{"metadata": json.RawMessage(`{"pluginData":{"style":"film"}}`)}})
	_, nodes, edges, err := decodeCanvasCollaborationDocument(string(result.Document))
	if err != nil {
		t.Fatal(err)
	}
	var metadata map[string]any
	_ = json.Unmarshal(nodes[0]["metadata"], &metadata)
	if got := metadata["pluginData"].(map[string]any); got["seed"] != float64(2) || got["style"] != "film" {
		t.Fatalf("metadata: %#v", got)
	}
	first := cloneJSONMap(edges[0])
	first["label"] = json.RawMessage(`"mine"`)
	apply(false, CanvasCollaborationOperationRequest{OpID: "edge-a", Kind: "update_connections", BaseRevision: 3, ExpectedConnections: edges, Connections: []map[string]json.RawMessage{first}})
	second := cloneJSONMap(edges[0])
	second["color"] = json.RawMessage(`"red"`)
	newEdge := map[string]json.RawMessage{"id": json.RawMessage(`"new-edge"`), "fromNodeId": json.RawMessage(`"node-b"`), "toNodeId": json.RawMessage(`"node-a"`)}
	result = apply(true, CanvasCollaborationOperationRequest{OpID: "edge-b", Kind: "update_connections", BaseRevision: 3, ExpectedConnections: edges, Connections: []map[string]json.RawMessage{second, newEdge}})
	_, _, merged, _ := decodeCanvasCollaborationDocument(string(result.Document))
	if len(merged) != 2 || rawString(merged[0]["label"]) != "mine" || rawString(merged[0]["color"]) != "red" {
		t.Fatalf("edges: %#v", merged)
	}
	first["label"] = json.RawMessage(`"conflict"`)
	if _, err := svc.ApplyCanvasCollaborationOperation(editor, "canvas-1", CanvasCollaborationOperationRequest{OpID: "edge-conflict", Kind: "update_connections", BaseRevision: 3, ExpectedConnections: edges, Connections: []map[string]json.RawMessage{first}}); !hasAppStatus(err, http.StatusConflict) {
		t.Fatalf("expected same-edge conflict: %v", err)
	}
}

func TestCanvasCollaborationUndoDeletionRestoresDurableContentAndNewLifecycle(t *testing.T) {
	svc, owner, editor, _ := newCanvasCollaborationTestService(t)
	seedCanvasCollaborationProject(t, svc.repo)
	if _, err := svc.EnableCanvasCollaboration(owner, "canvas-1", editor.ID, "editor"); err != nil {
		t.Fatal(err)
	}
	project, _ := svc.repo.CanvasProject("canvas-1")
	_, nodes, edges, _ := decodeCanvasCollaborationDocument(project.PayloadJSON)
	if _, err := svc.ApplyCanvasCollaborationOperation(editor, "canvas-1", CanvasCollaborationOperationRequest{OpID: "my-delete", Kind: "delete_node", BaseRevision: 1, NodeID: "node-a", Incarnation: 1, Before: nodes[0], ExpectedConnections: edges}); err != nil {
		t.Fatal(err)
	}
	req := CanvasCollaborationOperationRequest{OpID: "my-undo", Kind: "restore_nodes", BaseRevision: 2, Nodes: []map[string]json.RawMessage{{"id": json.RawMessage(`"node-a"`), "prompt": json.RawMessage(`"forged snapshot"`), "metadata": json.RawMessage(`{"collaborationRestoreIncarnation":1}`)}}, Connections: edges, EndpointIncarnations: map[string]int64{"node-b": 1}}
	if _, err := svc.ApplyCanvasCollaborationOperation(owner, "canvas-1", req); !hasAppStatus(err, http.StatusConflict) {
		t.Fatalf("undo another actor's deletion: %v", err)
	}
	forged := req
	forged.OpID = "forged-edge"
	forged.Connections = []map[string]json.RawMessage{cloneJSONMap(edges[0])}
	forged.Connections[0]["label"] = json.RawMessage(`"not in deletion snapshot"`)
	if _, err := svc.ApplyCanvasCollaborationOperation(editor, "canvas-1", forged); !hasAppStatus(err, http.StatusConflict) {
		t.Fatalf("changed undo edge accepted: %v", err)
	}
	result, err := svc.ApplyCanvasCollaborationOperation(editor, "canvas-1", req)
	if err != nil {
		t.Fatal(err)
	}
	_, restored, connections, _ := decodeCanvasCollaborationDocument(string(result.Document))
	index := canvasNodeIndex(restored, "node-a")
	if rawString(restored[index]["prompt"]) != "old prompt" || len(connections) != 1 {
		t.Fatalf("restored wrong snapshot: %s", result.Document)
	}
	state, err := svc.repo.CanvasProject("canvas-1")
	if err != nil || state.Revision != 3 {
		t.Fatal(err)
	}
	if replay, err := svc.ApplyCanvasCollaborationOperation(editor, "canvas-1", req); err != nil || replay.Status != canvasCollabAlreadyApplied {
		t.Fatalf("replay: %#v %v", replay, err)
	}
	if _, err := svc.ApplyCanvasCollaborationOperation(editor, "canvas-1", CanvasCollaborationOperationRequest{OpID: "stale-edit", Kind: "update_node", BaseRevision: 1, NodeID: "node-a", Incarnation: 1, Before: map[string]json.RawMessage{"prompt": json.RawMessage(`"old prompt"`)}, Patch: map[string]json.RawMessage{"prompt": json.RawMessage(`"stale"`)}}); !hasAppStatus(err, http.StatusConflict) {
		t.Fatalf("stale edit: %v", err)
	}
}
