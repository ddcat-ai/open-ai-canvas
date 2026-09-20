package canvas

import (
	"encoding/json"
	"net/http"
	"reflect"
	"testing"
)

func TestCanvasCollaborationDeltaUsesCommittedValues(t *testing.T) {
	svc, owner, editor, _ := newCanvasCollaborationTestService(t)
	svc.canvasCollaborationHub = newCanvasCollaborationHub()
	seedCanvasCollaborationProject(t, svc.repo)
	if _, err := svc.EnableCanvasCollaboration(owner, "canvas-1", editor.ID, CanvasCollaboratorRoleEditor); err != nil {
		t.Fatal(err)
	}
	sub := svc.SubscribeCanvasCollaborationRealtime("canvas-1")
	defer sub.Close()
	request := CanvasCollaborationOperationRequest{
		OpID: "delta-create", BaseRevision: 1, Kind: "create_nodes",
		Nodes: []map[string]json.RawMessage{{"id": json.RawMessage(`"delta-node"`), "type": json.RawMessage(`"text"`)}},
	}
	result, err := svc.ApplyCanvasCollaborationOperation(owner, "canvas-1", request)
	if err != nil {
		t.Fatal(err)
	}
	message := <-sub.Messages
	if message.Operation == nil || message.Operation.Revision != result.Revision {
		t.Fatalf("missing delta: %#v", message)
	}
	var metadata map[string]int64
	if err := json.Unmarshal(message.Operation.Nodes[0]["metadata"], &metadata); err != nil || metadata["collaborationIncarnation"] != 1 {
		t.Fatalf("delta lacks server incarnation: %#v %v", metadata, err)
	}
	events, err := svc.CanvasCollaborationEventsForUser(editor, "canvas-1", 1, 100)
	if err != nil || len(events.Events) != 1 {
		t.Fatalf("events: %#v %v", events, err)
	}
	if !reflect.DeepEqual(message.Operation, events.Events[0].Operation) {
		t.Fatal("replay differs from live event")
	}
	// Reconstruct the immutable request: the service stamps its private node map.
	request.Nodes = []map[string]json.RawMessage{{"id": json.RawMessage(`"delta-node"`), "type": json.RawMessage(`"text"`)}}
	if _, err := svc.ApplyCanvasCollaborationOperation(owner, "canvas-1", request); err != nil {
		t.Fatal(err)
	}
	select {
	case <-sub.Messages:
		t.Fatal("idempotent retry broadcast twice")
	default:
	}
}

func TestCanvasCollaborationPatchRequiresEveryBeforeField(t *testing.T) {
	svc, owner, editor, _ := newCanvasCollaborationTestService(t)
	svc.canvasCollaborationHub = newCanvasCollaborationHub()
	seedCanvasCollaborationProject(t, svc.repo)
	if _, err := svc.EnableCanvasCollaboration(owner, "canvas-1", editor.ID, CanvasCollaboratorRoleEditor); err != nil {
		t.Fatal(err)
	}
	sub := svc.SubscribeCanvasCollaborationRealtime("canvas-1")
	defer sub.Close()
	_, err := svc.ApplyCanvasCollaborationOperation(owner, "canvas-1", CanvasCollaborationOperationRequest{
		OpID: "missing-before", BaseRevision: 1, Kind: "update_node", NodeID: "node-a", Incarnation: 1,
		Before: map[string]json.RawMessage{"prompt": json.RawMessage(`"old prompt"`)},
		Patch:  map[string]json.RawMessage{"title": json.RawMessage(`"overwrite"`)},
	})
	if !hasAppStatus(err, http.StatusBadRequest) {
		t.Fatalf("expected rejection, got %v", err)
	}
	select {
	case <-sub.Messages:
		t.Fatal("rejected write broadcast")
	default:
	}
}

func TestCanvasCollaborationMetadataKeepsServerIncarnation(t *testing.T) {
	svc, owner, editor, _ := newCanvasCollaborationTestService(t)
	svc.canvasCollaborationHub = newCanvasCollaborationHub()
	seedCanvasCollaborationProject(t, svc.repo)
	if _, err := svc.EnableCanvasCollaboration(owner, "canvas-1", editor.ID, CanvasCollaboratorRoleEditor); err != nil {
		t.Fatal(err)
	}
	project, err := svc.repo.CanvasProject("canvas-1")
	if err != nil {
		t.Fatal(err)
	}
	_, nodes, _, err := decodeCanvasCollaborationDocument(project.PayloadJSON)
	if err != nil {
		t.Fatal(err)
	}
	index := canvasNodeIndex(nodes, "node-a")
	sub := svc.SubscribeCanvasCollaborationRealtime("canvas-1")
	defer sub.Close()
	_, err = svc.ApplyCanvasCollaborationOperation(owner, "canvas-1", CanvasCollaborationOperationRequest{
		OpID: "metadata-incarnation", BaseRevision: project.Revision, Kind: "update_node", NodeID: "node-a", Incarnation: 1,
		Before: map[string]json.RawMessage{"metadata": nodes[index]["metadata"]},
		Patch:  map[string]json.RawMessage{"metadata": json.RawMessage(`{"collaborationIncarnation":999,"prompt":"edited"}`)},
	})
	if err != nil {
		t.Fatal(err)
	}
	message := <-sub.Messages
	var metadata map[string]json.RawMessage
	if message.Operation == nil || json.Unmarshal(message.Operation.Patch["metadata"], &metadata) != nil || string(metadata["collaborationIncarnation"]) != "1" {
		t.Fatalf("delta must retain server lifecycle: %#v", message.Operation)
	}
	if string(metadata["prompt"]) != `"edited"` {
		t.Fatal("metadata edit was lost")
	}
}

func TestCanvasCollaborationHubOverflowAlwaysSignalsResync(t *testing.T) {
	hub := newCanvasCollaborationHub()
	sub := hub.subscribe("canvas")
	defer sub.Close()
	for i := int64(1); i <= 40; i++ {
		hub.publish(CanvasCollaborationRealtimeMessage{Type: "operation_applied", CanvasID: "canvas", Revision: i})
	}
	found := false
	for i := 0; i < 32; i++ {
		message := <-sub.Messages
		if message.Type == "resync" && message.Revision == 40 {
			found = true
		}
	}
	if !found {
		t.Fatal("last revision disappeared without resync")
	}
}
