package canvas

import (
	"encoding/json"
	"errors"
	"net/http"
	"testing"
	"time"

	"yingce/backend/internal/kernel"
	"yingce/backend/internal/model"
)

func TestCanvasEditLeaseOwnershipAndExpiry(t *testing.T) {
	svc := newCanvasOperationTestService(t)
	if err := svc.repo.Create(&model.CanvasProject{ID: "canvas", UserID: "user", PayloadJSON: `{"nodes":[],"connections":[]}`}); err != nil {
		t.Fatal(err)
	}
	change := func(session, token, action string) (map[string]any, error) {
		return svc.ChangeUserCanvasEditLease("user", "canvas", CanvasEditLeaseRequest{CanvasEditProof: model.CanvasEditProof{NodeID: "node", SessionID: session, Token: token}, Action: action})
	}
	first, err := change("browser-a", "", "acquire")
	if err != nil {
		t.Fatal(err)
	}
	token := first["token"].(string)
	lease := first["lease"].(*model.CanvasEditLease)
	if ttl := lease.ExpiresAt.Sub(first["serverTime"].(time.Time)); ttl != 30*time.Second {
		t.Fatalf("ttl = %s", ttl)
	}
	if _, err := change("browser-b", "", "acquire"); err == nil {
		t.Fatal("concurrent acquisition accepted")
	}
	if _, err := change("browser-a", "wrong", "renew"); err == nil {
		t.Fatal("wrong token renewed")
	}
	if _, err := change("browser-a", token, "renew"); err != nil {
		t.Fatal(err)
	}
	status, err := svc.UserCanvasSyncStatus("user", "canvas")
	if err != nil || len(status.Leases) != 1 {
		t.Fatalf("status = %+v, %v", status, err)
	}
	encoded, _ := json.Marshal(status)
	var exposed map[string]any
	_ = json.Unmarshal(encoded, &exposed)
	if _, present := exposed["leases"].([]any)[0].(map[string]any)["token"]; present {
		t.Fatal("status exposes token")
	}
	if _, err := svc.UserCanvasSyncStatus("other-user", "canvas"); err == nil {
		t.Fatal("status exposed to another owner")
	}
	if _, err := svc.ChangeUserCanvasEditLease("other-user", "canvas", CanvasEditLeaseRequest{CanvasEditProof: model.CanvasEditProof{NodeID: "node", SessionID: "other"}, Action: "acquire"}); err == nil {
		t.Fatal("other owner acquired")
	}
	lease.ExpiresAt = time.Now().Add(-time.Second)
	if err := svc.repo.Save(lease); err != nil {
		t.Fatal(err)
	}
	second, err := change("browser-b", "", "acquire")
	if err != nil {
		t.Fatal(err)
	}
	if second["token"] == token {
		t.Fatal("expired token reused")
	}
	for _, action := range []string{"release", "renew", "acquire"} {
		if _, err := change("browser-a", token, action); err == nil {
			t.Fatalf("stale owner %s accepted", action)
		}
	}
	if _, err := change("browser-b", second["token"].(string), "release"); err != nil {
		t.Fatal(err)
	}
	status, _ = svc.UserCanvasSyncStatus("user", "canvas")
	if len(status.Leases) != 0 {
		t.Fatal("released lease remains active")
	}
}

func TestCanvasSyncStatusIncludesAgentControlFieldsOnly(t *testing.T) {
	svc := newCanvasOperationTestService(t)
	for _, record := range []any{
		&model.CanvasProject{ID: "canvas", UserID: "user", Revision: 3},
		&model.Task{ID: "agent", UserID: "user", ProjectID: "canvas", Operation: "cloud_agent", Status: model.TaskStatusTextReplay, InputJSON: `{"private":"root body"}`},
		&model.CloudAgentExecution{ID: "agent", UserID: "user", CanvasID: "canvas", Status: "cancelled", CleanupPending: true, StateJSON: `{"private":"transcript"}`},
	} {
		if err := svc.repo.Create(record); err != nil {
			t.Fatal(err)
		}
	}
	status, err := svc.UserCanvasSyncStatus("user", "canvas")
	if err != nil || status.Agent == nil || status.Agent.RunID != "agent" || !status.Agent.CleanupPending || status.Revision != 3 {
		t.Fatalf("missing cleanup occupancy: %+v %v", status, err)
	}
	encoded, err := json.Marshal(status.Agent)
	if err != nil {
		t.Fatal(err)
	}
	var fields map[string]any
	if err := json.Unmarshal(encoded, &fields); err != nil || len(fields) != 3 {
		t.Fatalf("unexpected exposed fields: %s %v", encoded, err)
	}
	if _, err := svc.UserCanvasSyncStatus("other-user", "canvas"); err == nil {
		t.Fatal("Agent status leaked across users")
	}
	execution, err := svc.repo.CloudAgent("user", "agent")
	if err != nil {
		t.Fatal(err)
	}
	execution.CleanupPending = false
	if err := svc.repo.Save(execution); err != nil {
		t.Fatal(err)
	}
	status, err = svc.UserCanvasSyncStatus("user", "canvas")
	if err != nil || status.Agent != nil {
		t.Fatalf("completed cleanup did not clear occupancy: %+v %v", status.Agent, err)
	}
}

func TestCanvasEditLeaseGuardsTextButAllowsResultsAndReceiptReplay(t *testing.T) {
	svc := newCanvasOperationTestService(t)
	if err := svc.repo.Create(&model.CanvasProject{ID: "canvas", UserID: "user", PayloadJSON: `{"nodes":[{"id":"node","type":"video","title":"original","position":{"x":0,"y":0},"metadata":{"prompt":"prompt","content":"","generationTaskId":"original-task"}}],"connections":[]}`}); err != nil {
		t.Fatal(err)
	}
	grant, err := svc.ChangeUserCanvasEditLease("user", "canvas", CanvasEditLeaseRequest{CanvasEditProof: model.CanvasEditProof{NodeID: "node", SessionID: "a"}, Action: "acquire"})
	if err != nil {
		t.Fatal(err)
	}
	if err := svc.repo.Create(&model.Resource{ID: "video", UserID: "user", Kind: "video", Status: model.ResourceStatusReady}); err != nil {
		t.Fatal(err)
	}
	if err := svc.repo.Create(&model.Asset{ID: "video-asset", UserID: "user", Kind: "video", PayloadJSON: `{"storageKey":"resource:video"}`}); err != nil {
		t.Fatal(err)
	}
	proof := model.CanvasEditProof{NodeID: "node", SessionID: "a", Token: grant["token"].(string)}
	request := func(id, field, before, after string) CanvasOperationsRequest {
		return CanvasOperationsRequest{MutationID: id, Operations: []CanvasOperation{{Type: "patch_node", ID: "node", Patch: map[string]json.RawMessage{field: json.RawMessage(after)}, Before: map[string]json.RawMessage{field: json.RawMessage(before)}}}}
	}
	assertConflict := func(err error) {
		t.Helper()
		var appErr *kernel.AppError
		if !errors.As(err, &appErr) || appErr.Status != http.StatusConflict {
			t.Fatalf("expected conflict, got %v", err)
		}
	}
	text := request("text", "title", `"original"`, `"changed"`)
	_, err = svc.ApplyUserCanvasOperations("user", "canvas", text)
	assertConflict(err)
	assertConflict(svc.DeleteUserCanvasProject("user", "canvas"))
	for _, req := range []CanvasOperationsRequest{
		request("move", "position.x", `0`, `10`),
		request("asset", "metadata.assetId", `null`, `"video-asset"`),
		request("result", "metadata.content", `""`, `"resource:video"`),
		request("progress", "metadata.progress", `null`, `80`),
	} {
		if _, err := svc.ApplyUserCanvasOperations("user", "canvas", req); err != nil {
			t.Fatal(err)
		}
	}
	text.EditProofs = []model.CanvasEditProof{proof}
	first, err := svc.ApplyUserCanvasOperations("user", "canvas", text)
	if err != nil {
		t.Fatal(err)
	}
	lease := grant["lease"].(*model.CanvasEditLease)
	lease.ExpiresAt = time.Now().Add(-time.Second)
	if err := svc.repo.Save(lease); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.ChangeUserCanvasEditLease("user", "canvas", CanvasEditLeaseRequest{CanvasEditProof: model.CanvasEditProof{NodeID: "node", SessionID: "b"}, Action: "acquire"}); err != nil {
		t.Fatal(err)
	}
	replayed, err := svc.ApplyUserCanvasOperations("user", "canvas", text)
	if err != nil || replayed.Revision != first.Revision {
		t.Fatalf("receipt replay = %+v, %v", replayed, err)
	}
	stale := request("stale", "title", `"changed"`, `"lost update"`)
	stale.EditProofs = []model.CanvasEditProof{proof}
	_, err = svc.ApplyUserCanvasOperations("user", "canvas", stale)
	assertConflict(err)
	stored, err := svc.repo.CanvasProjectForUser("user", "canvas")
	if err != nil {
		t.Fatal(err)
	}
	var snapshot map[string]any
	if err := json.Unmarshal([]byte(stored.PayloadJSON), &snapshot); err != nil {
		t.Fatal(err)
	}
	snapshot["id"], snapshot["revision"] = "canvas", stored.Revision
	raw, _ := json.Marshal(snapshot)
	_, err = svc.UpsertUserCanvasProject("user", raw)
	// An unchanged snapshot is allowed, but it cannot erase an editing node.
	if err != nil {
		t.Fatal(err)
	}
	stored, _ = svc.repo.CanvasProjectForUser("user", "canvas")
	snapshot["revision"] = stored.Revision
	snapshot["nodes"].([]any)[0].(map[string]any)["title"] = "unproved overwrite"
	raw, _ = json.Marshal(snapshot)
	_, err = svc.UpsertUserCanvasProject("user", raw)
	assertConflict(err)
	snapshot["nodes"] = []any{}
	raw, _ = json.Marshal(snapshot)
	_, err = svc.UpsertUserCanvasProject("user", raw)
	assertConflict(err)
}
