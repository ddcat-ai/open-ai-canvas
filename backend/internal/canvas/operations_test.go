package canvas

import (
	"encoding/json"
	"errors"
	"net/http"
	"path/filepath"
	"strings"
	"testing"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"yingce/backend/internal/kernel"
	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"
)

func TestApplyCanvasOperationsReplaysSameMutationAndRejectsDifferentPayload(t *testing.T) {
	svc := newCanvasOperationTestService(t)
	if err := svc.repo.Create(&model.CanvasProject{
		ID: "canvas", UserID: "user", Title: "初始", PayloadJSON: `{"nodes":[{"id":"node","metadata":{"title":"旧","prompt":"原始"}}],"connections":[]}`,
	}); err != nil {
		t.Fatal(err)
	}
	request := CanvasOperationsRequest{
		MutationID: "mutation-1",
		Operations: []CanvasOperation{{Type: "patch_node", ID: "node", Patch: map[string]json.RawMessage{
			"metadata.title": json.RawMessage(`"新"`),
		}, Before: map[string]json.RawMessage{"metadata.title": json.RawMessage(`"旧"`)}}},
	}
	first, err := svc.ApplyUserCanvasOperations("user", "canvas", request)
	if err != nil {
		t.Fatal(err)
	}
	if first.Revision != 2 {
		t.Fatalf("first revision = %d, want 2", first.Revision)
	}
	second, err := svc.ApplyUserCanvasOperations("user", "canvas", request)
	if err != nil {
		t.Fatal(err)
	}
	if second.Revision != first.Revision {
		t.Fatalf("replay revision = %d, want %d", second.Revision, first.Revision)
	}
	receipt, err := svc.repo.CanvasMutationReceiptForUser("user", "canvas", "mutation-1")
	if err != nil {
		t.Fatal(err)
	}
	if receipt.Revision != first.Revision || receipt.PayloadDigest == "" || receipt.ResultJSON == "" {
		t.Fatalf("invalid receipt: %#v", receipt)
	}

	request.Operations[0].Patch["metadata.title"] = json.RawMessage(`"冲突"`)
	_, err = svc.ApplyUserCanvasOperations("user", "canvas", request)
	var appError *kernel.AppError
	if !errors.As(err, &appError) || appError.Status != http.StatusConflict {
		t.Fatalf("different payload replay error = %v, want conflict", err)
	}
}

func TestApplyCanvasOperationsCreatesOnlyExplicitCanvas(t *testing.T) {
	svc := newCanvasOperationTestService(t)
	request := CanvasOperationsRequest{MutationID: "create-canvas", Operations: []CanvasOperation{
		{Type: "create_canvas", ID: "canvas", Patch: map[string]json.RawMessage{"title": json.RawMessage(`"新画布"`)}},
		{Type: "create_node", Node: json.RawMessage(`{"id":"node","type":"text","metadata":{"content":"hello"}}`)},
	}}
	result, err := svc.ApplyUserCanvasOperations("user", "canvas", request)
	if err != nil {
		t.Fatal(err)
	}
	if result.Revision != 1 {
		t.Fatalf("created revision = %d, want 1", result.Revision)
	}
	stored, err := svc.repo.CanvasProjectForUser("user", "canvas")
	if err != nil {
		t.Fatal(err)
	}
	if stored.Title != "新画布" || !strings.Contains(stored.PayloadJSON, `"node"`) {
		t.Fatalf("created canvas payload = %s", stored.PayloadJSON)
	}
	if _, err := svc.ApplyUserCanvasOperations("user", "missing", CanvasOperationsRequest{MutationID: "missing-update", Operations: []CanvasOperation{{Type: "patch_node", ID: "node", Patch: map[string]json.RawMessage{"title": json.RawMessage(`"late"`)}, Before: map[string]json.RawMessage{"title": json.RawMessage(`null`)}}}}); err == nil {
		t.Fatal("implicit canvas creation was accepted")
	}
}
func TestApplyCanvasOperationsDoesNotRecreateDeletedNode(t *testing.T) {
	svc := newCanvasOperationTestService(t)
	if err := svc.repo.Create(&model.CanvasProject{
		ID: "canvas", UserID: "user", PayloadJSON: `{"nodes":[{"id":"node","metadata":{"title":"旧"}}],"connections":[]}`,
	}); err != nil {
		t.Fatal(err)
	}
	remove := CanvasOperationsRequest{MutationID: "remove-node", Operations: []CanvasOperation{{Type: "remove_node", ID: "node", Expected: json.RawMessage(`{"id":"node","metadata":{"title":"旧"}}`)}}}
	if _, err := svc.ApplyUserCanvasOperations("user", "canvas", remove); err != nil {
		t.Fatal(err)
	}
	late := CanvasOperationsRequest{MutationID: "late-update", Operations: []CanvasOperation{{Type: "patch_node", ID: "node", Patch: map[string]json.RawMessage{
		"metadata.title": json.RawMessage(`"迟到"`),
	}, Before: map[string]json.RawMessage{"metadata.title": json.RawMessage(`"旧"`)}}}}
	if _, err := svc.ApplyUserCanvasOperations("user", "canvas", late); err == nil {
		t.Fatal("late update after deletion was accepted")
	} else {
		var appError *kernel.AppError
		if !errors.As(err, &appError) || appError.Status != http.StatusConflict {
			t.Fatalf("late update error = %v, want conflict", err)
		}
	}
	stored, err := svc.UserCanvasProject("user", "canvas")
	if err != nil {
		t.Fatal(err)
	}
	var payload struct {
		Nodes []map[string]any `json:"nodes"`
	}
	if err := json.Unmarshal(stored, &payload); err != nil {
		t.Fatal(err)
	}
	if len(payload.Nodes) != 0 {
		t.Fatalf("late update recreated deleted node: %s", stored)
	}
}

func TestApplyCanvasOperationsRejectsConnectionWithMissingEndpoint(t *testing.T) {
	svc := newCanvasOperationTestService(t)
	if err := svc.repo.Create(&model.CanvasProject{
		ID: "canvas", UserID: "user", PayloadJSON: `{"nodes":[{"id":"from"}],"connections":[]}`,
	}); err != nil {
		t.Fatal(err)
	}
	request := CanvasOperationsRequest{MutationID: "bad-connection", Operations: []CanvasOperation{{
		Type: "create_connection", Connection: json.RawMessage(`{"id":"edge","fromNodeId":"from","toNodeId":"missing"}`),
	}}}
	if _, err := svc.ApplyUserCanvasOperations("user", "canvas", request); err == nil {
		t.Fatal("missing connection endpoint was accepted")
	}
}

func TestApplyCanvasOperationsRejectsStaleFieldAndAllowsDisjointField(t *testing.T) {
	svc := newCanvasOperationTestService(t)
	if err := svc.repo.Create(&model.CanvasProject{
		ID: "canvas", UserID: "user", PayloadJSON: `{"nodes":[{"id":"node","metadata":{"title":"旧","prompt":"原始"}}],"connections":[]}`,
	}); err != nil {
		t.Fatal(err)
	}
	first := CanvasOperationsRequest{MutationID: "title-change", Operations: []CanvasOperation{{Type: "patch_node", ID: "node", Patch: map[string]json.RawMessage{
		"metadata.title": json.RawMessage(`"标题一"`),
	}, Before: map[string]json.RawMessage{"metadata.title": json.RawMessage(`"旧"`)}}}}
	if _, err := svc.ApplyUserCanvasOperations("user", "canvas", first); err != nil {
		t.Fatal(err)
	}
	stale := CanvasOperationsRequest{MutationID: "stale-title", Operations: []CanvasOperation{{Type: "patch_node", ID: "node", Patch: map[string]json.RawMessage{
		"metadata.title": json.RawMessage(`"标题二"`),
	}, Before: map[string]json.RawMessage{"metadata.title": json.RawMessage(`"旧"`)}}}}
	if _, err := svc.ApplyUserCanvasOperations("user", "canvas", stale); err == nil {
		t.Fatal("stale same-field update was accepted")
	} else {
		var appError *kernel.AppError
		if !errors.As(err, &appError) || appError.Status != http.StatusConflict {
			t.Fatalf("stale same-field error = %v, want conflict", err)
		}
	}
	disjoint := CanvasOperationsRequest{MutationID: "prompt-change", Operations: []CanvasOperation{{Type: "patch_node", ID: "node", Patch: map[string]json.RawMessage{
		"metadata.prompt": json.RawMessage(`"新的提示词"`),
	}, Before: map[string]json.RawMessage{"metadata.prompt": json.RawMessage(`"原始"`)}}}}
	if _, err := svc.ApplyUserCanvasOperations("user", "canvas", disjoint); err != nil {
		t.Fatal(err)
	}
}

// 服务端写入（Agent、生成回写）会刷新节点 updatedAt；客户端基于旧 updatedAt 的
// 补丁不能因此整体冲突，业务字段仍按基线校验。
func TestApplyCanvasOperationsIgnoresNodeUpdatedAtBase(t *testing.T) {
	svc := newCanvasOperationTestService(t)
	if err := svc.repo.Create(&model.CanvasProject{
		ID: "canvas", UserID: "user", PayloadJSON: `{"nodes":[{"id":"node","updatedAt":"server-new","metadata":{"title":"旧"}}],"connections":[]}`,
	}); err != nil {
		t.Fatal(err)
	}
	request := CanvasOperationsRequest{MutationID: "stale-updated-at", Operations: []CanvasOperation{{Type: "patch_node", ID: "node", Patch: map[string]json.RawMessage{
		"updatedAt":      json.RawMessage(`"client-new"`),
		"metadata.title": json.RawMessage(`"新"`),
	}, Before: map[string]json.RawMessage{"updatedAt": json.RawMessage(`"client-old"`), "metadata.title": json.RawMessage(`"旧"`)}}}}
	if _, err := svc.ApplyUserCanvasOperations("user", "canvas", request); err != nil {
		t.Fatalf("stale updatedAt base rejected: %v", err)
	}
	stale := CanvasOperationsRequest{MutationID: "stale-title-with-updated-at", Operations: []CanvasOperation{{Type: "patch_node", ID: "node", Patch: map[string]json.RawMessage{
		"metadata.title": json.RawMessage(`"再改"`),
	}, Before: map[string]json.RawMessage{"updatedAt": json.RawMessage(`"client-new"`), "metadata.title": json.RawMessage(`"旧"`)}}}}
	if _, err := svc.ApplyUserCanvasOperations("user", "canvas", stale); err == nil {
		t.Fatal("stale business field accepted")
	}
}

func TestApplyCanvasOperationsMergesSameTaskTimestampMonotonically(t *testing.T) {
	t.Run("stale observer cannot roll back newer task time", func(t *testing.T) {
		svc := newCanvasOperationTestService(t)
		if err := svc.repo.Create(&model.CanvasProject{ID: "canvas", UserID: "user", PayloadJSON: `{"nodes":[{"id":"node","metadata":{"taskId":"task-1","taskUpdatedAt":"2026-04-01T00:00:02Z","taskStatus":"running","prompt":"original"}}],"connections":[]}`}); err != nil {
			t.Fatal(err)
		}
		stale := CanvasOperationsRequest{MutationID: "task-timestamp-stale", Operations: []CanvasOperation{{Type: "patch_node", ID: "node", Patch: map[string]json.RawMessage{"metadata.taskUpdatedAt": json.RawMessage(`"2026-04-01T00:00:01Z"`)}, Before: map[string]json.RawMessage{"metadata.taskUpdatedAt": json.RawMessage(`"2026-04-01T00:00:00Z"`), "metadata.taskId": json.RawMessage(`"task-1"`)}}}}
		if _, err := svc.ApplyUserCanvasOperations("user", "canvas", stale); err != nil {
			t.Fatalf("stale same-task timestamp rejected: %v", err)
		}
		project, err := svc.repo.CanvasProjectForUser("user", "canvas")
		if err != nil {
			t.Fatal(err)
		}
		var payload struct {
			Nodes []struct {
				Metadata map[string]any `json:"metadata"`
			} `json:"nodes"`
		}
		if err := json.Unmarshal([]byte(project.PayloadJSON), &payload); err != nil {
			t.Fatal(err)
		}
		if got := payload.Nodes[0].Metadata["taskUpdatedAt"]; got != "2026-04-01T00:00:02Z" {
			t.Fatalf("taskUpdatedAt regressed: got %v", got)
		}
	})

	t.Run("newer observer advances task time", func(t *testing.T) {
		svc := newCanvasOperationTestService(t)
		if err := svc.repo.Create(&model.CanvasProject{ID: "canvas", UserID: "user", PayloadJSON: `{"nodes":[{"id":"node","metadata":{"taskId":"task-1","taskUpdatedAt":"2026-04-01T00:00:02Z"}}],"connections":[]}`}); err != nil {
			t.Fatal(err)
		}
		request := CanvasOperationsRequest{MutationID: "task-timestamp-newer", Operations: []CanvasOperation{{Type: "patch_node", ID: "node", Patch: map[string]json.RawMessage{"metadata.taskUpdatedAt": json.RawMessage(`"2026-04-01T00:00:03Z"`)}, Before: map[string]json.RawMessage{"metadata.taskUpdatedAt": json.RawMessage(`"2026-04-01T00:00:01Z"`), "metadata.taskId": json.RawMessage(`"task-1"`)}}}}
		if _, err := svc.ApplyUserCanvasOperations("user", "canvas", request); err != nil {
			t.Fatalf("newer same-task timestamp rejected: %v", err)
		}
		project, err := svc.repo.CanvasProjectForUser("user", "canvas")
		if err != nil {
			t.Fatal(err)
		}
		var payload struct {
			Nodes []struct {
				Metadata map[string]any `json:"metadata"`
			} `json:"nodes"`
		}
		if err := json.Unmarshal([]byte(project.PayloadJSON), &payload); err != nil {
			t.Fatal(err)
		}
		if got := payload.Nodes[0].Metadata["taskUpdatedAt"]; got != "2026-04-01T00:00:03Z" {
			t.Fatalf("newer taskUpdatedAt not applied: got %v", got)
		}
	})
}

func TestApplyCanvasOperationsTaskTimestampFenceDoesNotRelaxOtherConflicts(t *testing.T) {
	t.Run("rebound task rejected", func(t *testing.T) {
		svc := newCanvasOperationTestService(t)
		if err := svc.repo.Create(&model.CanvasProject{ID: "canvas", UserID: "user", PayloadJSON: `{"nodes":[{"id":"node","metadata":{"taskId":"task-2","taskUpdatedAt":"2026-04-01T00:00:02Z"}}],"connections":[]}`}); err != nil {
			t.Fatal(err)
		}
		request := CanvasOperationsRequest{MutationID: "old-task-update", Operations: []CanvasOperation{{Type: "patch_node", ID: "node", Patch: map[string]json.RawMessage{"metadata.taskUpdatedAt": json.RawMessage(`"2026-04-01T00:00:03Z"`)}, Before: map[string]json.RawMessage{"metadata.taskUpdatedAt": json.RawMessage(`"2026-04-01T00:00:01Z"`), "metadata.taskId": json.RawMessage(`"task-1"`)}}}}
		if _, err := svc.ApplyUserCanvasOperations("user", "canvas", request); err == nil {
			t.Fatal("old task timestamp crossed the task identity fence")
		}
	})

	t.Run("other stale field still rejected atomically", func(t *testing.T) {
		svc := newCanvasOperationTestService(t)
		if err := svc.repo.Create(&model.CanvasProject{ID: "canvas", UserID: "user", PayloadJSON: `{"nodes":[{"id":"node","metadata":{"taskId":"task-1","taskUpdatedAt":"2026-04-01T00:00:02Z","prompt":"new prompt"}}],"connections":[]}`}); err != nil {
			t.Fatal(err)
		}
		request := CanvasOperationsRequest{
			MutationID: "mixed-task-update",
			Operations: []CanvasOperation{{
				Type: "patch_node",
				ID:   "node",
				Patch: map[string]json.RawMessage{
					"metadata.taskUpdatedAt": json.RawMessage(`"2026-04-01T00:00:03Z"`),
					"metadata.prompt":        json.RawMessage(`"stale prompt"`),
				},
				Before: map[string]json.RawMessage{
					"metadata.taskUpdatedAt": json.RawMessage(`"2026-04-01T00:00:01Z"`),
					"metadata.taskId":        json.RawMessage(`"task-1"`),
					"metadata.prompt":        json.RawMessage(`"old prompt"`),
				},
			}},
		}
		if _, err := svc.ApplyUserCanvasOperations("user", "canvas", request); err == nil {
			t.Fatal("stale prompt conflict was hidden by timestamp merge")
		}
		project, err := svc.repo.CanvasProjectForUser("user", "canvas")
		if err != nil {
			t.Fatal(err)
		}
		var payload struct {
			Nodes []struct {
				Metadata map[string]any `json:"metadata"`
			} `json:"nodes"`
		}
		if err := json.Unmarshal([]byte(project.PayloadJSON), &payload); err != nil {
			t.Fatal(err)
		}
		if got := payload.Nodes[0].Metadata["taskUpdatedAt"]; got != "2026-04-01T00:00:02Z" {
			t.Fatalf("failed batch partially changed timestamp: got %v", got)
		}
	})
}

func TestApplyCanvasOperationsTaskTimestampFenceRequiresMergeablePatch(t *testing.T) {
	t.Run("same-task null deletion uses strict CAS", func(t *testing.T) {
		svc := newCanvasOperationTestService(t)
		if err := svc.repo.Create(&model.CanvasProject{ID: "canvas", UserID: "user", PayloadJSON: `{"nodes":[{"id":"node","metadata":{"taskId":"task-1","taskUpdatedAt":"2026-04-01T00:00:02Z"}}],"connections":[]}`}); err != nil {
			t.Fatal(err)
		}
		matching := CanvasOperationsRequest{MutationID: "delete-task-time", Operations: []CanvasOperation{{Type: "patch_node", ID: "node", Patch: map[string]json.RawMessage{"metadata.taskUpdatedAt": json.RawMessage(`null`)}, Before: map[string]json.RawMessage{"metadata.taskUpdatedAt": json.RawMessage(`"2026-04-01T00:00:02Z"`), "metadata.taskId": json.RawMessage(`"task-1"`)}}}}
		if _, err := svc.ApplyUserCanvasOperations("user", "canvas", matching); err != nil {
			t.Fatalf("matching null deletion rejected: %v", err)
		}
		mismatch := CanvasOperationsRequest{MutationID: "delete-task-time-stale", Operations: []CanvasOperation{{Type: "patch_node", ID: "node", Patch: map[string]json.RawMessage{"metadata.taskUpdatedAt": json.RawMessage(`null`)}, Before: map[string]json.RawMessage{"metadata.taskUpdatedAt": json.RawMessage(`"2026-04-01T00:00:02Z"`), "metadata.taskId": json.RawMessage(`"task-1"`)}}}}
		if _, err := svc.ApplyUserCanvasOperations("user", "canvas", mismatch); err == nil {
			t.Fatal("mismatched null deletion accepted")
		}
	})

	t.Run("task rebind and whole metadata patch stay strict", func(t *testing.T) {
		svc := newCanvasOperationTestService(t)
		if err := svc.repo.Create(&model.CanvasProject{ID: "canvas", UserID: "user", PayloadJSON: `{"nodes":[{"id":"node","metadata":{"taskId":"task-2","taskUpdatedAt":"2026-04-01T00:00:02Z"}}],"connections":[]}`}); err != nil {
			t.Fatal(err)
		}
		for name, patch := range map[string]map[string]json.RawMessage{
			"rebind":         {"metadata.taskUpdatedAt": json.RawMessage(`"2026-04-01T00:00:03Z"`), "metadata.taskId": json.RawMessage(`"task-2"`)},
			"whole metadata": {"metadata.taskUpdatedAt": json.RawMessage(`"2026-04-01T00:00:03Z"`), "metadata": json.RawMessage(`{"taskId":"task-2"}`)},
		} {
			t.Run(name, func(t *testing.T) {
				request := CanvasOperationsRequest{MutationID: "strict-" + name, Operations: []CanvasOperation{{Type: "patch_node", ID: "node", Patch: patch, Before: map[string]json.RawMessage{"metadata.taskUpdatedAt": json.RawMessage(`"2026-04-01T00:00:01Z"`), "metadata.taskId": json.RawMessage(`"task-1"`)}}}}
				if _, err := svc.ApplyUserCanvasOperations("user", "canvas", request); err == nil {
					t.Fatal("strict task patch accepted across rebound identity")
				}
			})
		}
	})
}

func TestApplyCanvasOperationsConvergesSameTaskAlreadyAppliedFields(t *testing.T) {
	svc := newCanvasOperationTestService(t)
	if err := svc.repo.Create(&model.CanvasProject{ID: "canvas", UserID: "user", PayloadJSON: `{"nodes":[{"id":"node","metadata":{"taskId":"task-1","taskStatus":"succeeded","content":"done","taskUpdatedAt":"2026-04-01T00:00:03Z"}}],"connections":[]}`}); err != nil {
		t.Fatal(err)
	}
	request := CanvasOperationsRequest{MutationID: "same-completion", Operations: []CanvasOperation{{Type: "patch_node", ID: "node", Patch: map[string]json.RawMessage{
		"metadata.taskStatus":    json.RawMessage(`"succeeded"`),
		"metadata.content":       json.RawMessage(`"done"`),
		"metadata.taskUpdatedAt": json.RawMessage(`"2026-04-01T00:00:02Z"`),
	}, Before: map[string]json.RawMessage{
		"metadata.taskId":        json.RawMessage(`"task-1"`),
		"metadata.taskStatus":    json.RawMessage(`"queued"`),
		"metadata.content":       json.RawMessage(`"pending"`),
		"metadata.taskUpdatedAt": json.RawMessage(`"2026-04-01T00:00:01Z"`),
	}}}}
	if _, err := svc.ApplyUserCanvasOperations("user", "canvas", request); err != nil {
		t.Fatalf("same-task repeated completion rejected: %v", err)
	}
	project, err := svc.repo.CanvasProjectForUser("user", "canvas")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(project.PayloadJSON, `"taskUpdatedAt":"2026-04-01T00:00:03Z"`) {
		t.Fatalf("server task time regressed: %s", project.PayloadJSON)
	}

	for name, patch := range map[string]map[string]json.RawMessage{
		"different content": {"metadata.content": json.RawMessage(`"other"`), "metadata.taskUpdatedAt": json.RawMessage(`"2026-04-01T00:00:04Z"`)},
		"different prompt":  {"metadata.prompt": json.RawMessage(`"other"`), "metadata.taskUpdatedAt": json.RawMessage(`"2026-04-01T00:00:04Z"`)},
	} {
		t.Run(name, func(t *testing.T) {
			bad := request
			bad.MutationID = "different-" + name
			bad.Operations = []CanvasOperation{{Type: "patch_node", ID: "node", Patch: patch, Before: request.Operations[0].Before}}
			if _, err := svc.ApplyUserCanvasOperations("user", "canvas", bad); err == nil {
				t.Fatal("different desired value was accepted")
			}
		})
	}
}

func TestApplyCanvasOperationsDoesNotRelaxTaskIdentityOrLegacyNoFence(t *testing.T) {
	svc := newCanvasOperationTestService(t)
	if err := svc.repo.Create(&model.CanvasProject{ID: "canvas", UserID: "user", PayloadJSON: `{"nodes":[{"id":"node","metadata":{"taskId":"task-1","taskStatus":"succeeded","content":"done","taskUpdatedAt":"2026-04-01T00:00:03Z"}}],"connections":[]}`}); err != nil {
		t.Fatal(err)
	}
	beforeOnly := CanvasOperationsRequest{MutationID: "before-only-task-id", Operations: []CanvasOperation{{Type: "patch_node", ID: "node", Patch: map[string]json.RawMessage{"metadata.taskUpdatedAt": json.RawMessage(`"2026-04-01T00:00:02Z"`)}, Before: map[string]json.RawMessage{"metadata.taskId": json.RawMessage(`"task-1"`), "metadata.taskStatus": json.RawMessage(`"queued"`)}}}}
	if _, err := svc.ApplyUserCanvasOperations("user", "canvas", beforeOnly); err == nil {
		t.Fatal("before-only task identity patch was accepted")
	}
	noFence := CanvasOperationsRequest{MutationID: "legacy-no-fence", Operations: []CanvasOperation{{Type: "patch_node", ID: "node", Patch: map[string]json.RawMessage{"metadata.taskStatus": json.RawMessage(`"succeeded"`), "metadata.content": json.RawMessage(`"done"`)}, Before: map[string]json.RawMessage{"metadata.taskStatus": json.RawMessage(`"queued"`), "metadata.content": json.RawMessage(`"pending"`)}}}}
	if _, err := svc.ApplyUserCanvasOperations("user", "canvas", noFence); err == nil {
		t.Fatal("legacy no-fence request was accepted")
	}
	if _, err := svc.repo.CanvasMutationReceiptForUser("user", "canvas", "legacy-no-fence"); err == nil {
		t.Fatal("failed legacy request created a receipt")
	}
	fixed := noFence
	fixed.MutationID = "fixed-with-fence"
	fixed.Operations = []CanvasOperation{{Type: "patch_node", ID: "node", Patch: map[string]json.RawMessage{"metadata.taskStatus": json.RawMessage(`"succeeded"`), "metadata.content": json.RawMessage(`"done"`), "metadata.taskUpdatedAt": json.RawMessage(`"2026-04-01T00:00:02Z"`)}, Before: map[string]json.RawMessage{"metadata.taskId": json.RawMessage(`"task-1"`), "metadata.taskStatus": json.RawMessage(`"queued"`), "metadata.content": json.RawMessage(`"pending"`), "metadata.taskUpdatedAt": json.RawMessage(`"2026-04-01T00:00:01Z"`)}}}
	result, err := svc.ApplyUserCanvasOperations("user", "canvas", fixed)
	if err != nil {
		t.Fatalf("fenced retry rejected: %v", err)
	}
	replayed, err := svc.ApplyUserCanvasOperations("user", "canvas", fixed)
	if err != nil || replayed.Revision != result.Revision {
		t.Fatalf("fenced retry replay failed: result=%#v err=%v", replayed, err)
	}
}

func TestApplyCanvasOperationsRejectsStaleCanvasField(t *testing.T) {
	svc := newCanvasOperationTestService(t)
	if err := svc.repo.Create(&model.CanvasProject{ID: "canvas", UserID: "user", Title: "旧标题", PayloadJSON: `{"nodes":[],"connections":[],"title":"旧标题"}`}); err != nil {
		t.Fatal(err)
	}
	first := CanvasOperationsRequest{MutationID: "field-one", Operations: []CanvasOperation{{Type: "set_field", Field: "title", Value: json.RawMessage(`"新标题"`), BeforeValue: json.RawMessage(`"旧标题"`)}}}
	if _, err := svc.ApplyUserCanvasOperations("user", "canvas", first); err != nil {
		t.Fatal(err)
	}
	stale := CanvasOperationsRequest{MutationID: "field-two", Operations: []CanvasOperation{{Type: "set_field", Field: "title", Value: json.RawMessage(`"另一个标题"`), BeforeValue: json.RawMessage(`"旧标题"`)}}}
	if _, err := svc.ApplyUserCanvasOperations("user", "canvas", stale); err == nil {
		t.Fatal("stale canvas field update was accepted")
	} else {
		var appError *kernel.AppError
		if !errors.As(err, &appError) || appError.Status != http.StatusConflict {
			t.Fatalf("stale canvas field error = %v, want conflict", err)
		}
	}
}

// 客户端读到的 projectId/title 来自数据库列投影；payload 里缺省该字段时，
// 以投影值作为 beforeValue 的请求必须被接受，而不是误报字段冲突。
func TestApplyCanvasOperationsChecksFieldBaseAgainstProjection(t *testing.T) {
	svc := newCanvasOperationTestService(t)
	if err := svc.repo.Create(&model.CanvasProject{ID: "canvas", UserID: "user", Title: "自由画布 1", PayloadJSON: `{"nodes":[],"connections":[]}`}); err != nil {
		t.Fatal(err)
	}
	request := CanvasOperationsRequest{MutationID: "projection-base", Operations: []CanvasOperation{
		{Type: "set_field", Field: "projectId", Value: json.RawMessage(`null`), BeforeValue: json.RawMessage(`""`)},
		{Type: "set_field", Field: "title", Value: json.RawMessage(`"改名"`), BeforeValue: json.RawMessage(`"自由画布 1"`)},
	}}
	if _, err := svc.ApplyUserCanvasOperations("user", "canvas", request); err != nil {
		t.Fatalf("projection base rejected: %v", err)
	}
	stored, err := svc.repo.CanvasProjectForUser("user", "canvas")
	if err != nil {
		t.Fatal(err)
	}
	if stored.Title != "改名" || stored.ProjectID != "" {
		t.Fatalf("stored title=%q projectId=%q", stored.Title, stored.ProjectID)
	}
	stale := CanvasOperationsRequest{MutationID: "projection-stale", Operations: []CanvasOperation{
		{Type: "set_field", Field: "title", Value: json.RawMessage(`"再改"`), BeforeValue: json.RawMessage(`"自由画布 1"`)},
	}}
	if _, err := svc.ApplyUserCanvasOperations("user", "canvas", stale); err == nil {
		t.Fatal("stale title base accepted")
	}
}

func TestApplyCanvasOperationsAcceptsLegacyOmittedOptionalFieldValues(t *testing.T) {
	svc := newCanvasOperationTestService(t)
	if err := svc.repo.Create(&model.CanvasProject{ID: "canvas", UserID: "user", PayloadJSON: `{"nodes":[],"connections":[]}`}); err != nil {
		t.Fatal(err)
	}
	// Before the frontend encoded undefined as null, JSON.stringify omitted
	// beforeValue when an optional field was absent. The server must replay that
	// original request against an absent field without weakening the precondition.
	legacyCreate := CanvasOperationsRequest{MutationID: "legacy-optional-field", Operations: []CanvasOperation{{
		Type: "set_field", Field: "timeline", Value: json.RawMessage(`{"tracks":[]}`),
	}}}
	if _, err := svc.ApplyUserCanvasOperations("user", "canvas", legacyCreate); err != nil {
		t.Fatalf("legacy optional field update failed: %v", err)
	}

	stored, err := svc.repo.CanvasProjectForUser("user", "canvas")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(stored.PayloadJSON, `"timeline":{"tracks":[]}`) {
		t.Fatalf("legacy optional field was not stored: %s", stored.PayloadJSON)
	}

	legacyDelete := CanvasOperationsRequest{MutationID: "legacy-optional-field-delete", Operations: []CanvasOperation{{
		Type: "set_field", Field: "timeline", BeforeValue: json.RawMessage(`{"tracks":[]}`),
	}}}
	if _, err := svc.ApplyUserCanvasOperations("user", "canvas", legacyDelete); err != nil {
		t.Fatalf("legacy optional field deletion failed: %v", err)
	}
	stored, err = svc.repo.CanvasProjectForUser("user", "canvas")
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(stored.PayloadJSON, `"timeline"`) {
		t.Fatalf("legacy optional field was not deleted: %s", stored.PayloadJSON)
	}
	if _, err := svc.ApplyUserCanvasOperations("user", "canvas", CanvasOperationsRequest{MutationID: "missing-required-field-base", Operations: []CanvasOperation{{
		Type: "set_field", Field: "title", Value: json.RawMessage(`"标题"`),
	}}}); err == nil {
		t.Fatal("missing required field precondition was accepted")
	}
}

func TestApplyCanvasOperationsRejectsDuplicateCreateWithStructuredConflict(t *testing.T) {
	svc := newCanvasOperationTestService(t)
	request := CanvasOperationsRequest{MutationID: "first-create", Operations: []CanvasOperation{{Type: "create_canvas", ID: "canvas", Patch: map[string]json.RawMessage{"title": json.RawMessage(`"已保存"`)}}}}
	first, err := svc.ApplyUserCanvasOperations("user", "canvas", request)
	if err != nil {
		t.Fatal(err)
	}
	// A lost response must remain replayable with its original mutation ID.
	replayed, err := svc.ApplyUserCanvasOperations("user", "canvas", request)
	if err != nil || replayed.Revision != first.Revision {
		t.Fatalf("original creation replay = %#v, %v", replayed, err)
	}
	request.MutationID = "stale-create-with-new-id"
	request.Operations[0].Patch["title"] = json.RawMessage(`"不应覆盖"`)
	_, err = svc.ApplyUserCanvasOperations("user", "canvas", request)
	var appError *kernel.AppError
	if !errors.As(err, &appError) || appError.Status != http.StatusConflict || appError.Reason != "canvas_field_conflict" || appError.Retryable {
		t.Fatalf("duplicate create error = %#v, want non-retryable field conflict", err)
	}
	stored, err := svc.repo.CanvasProjectForUser("user", "canvas")
	if err != nil || stored.Title != "已保存" || stored.Revision != first.Revision {
		t.Fatalf("duplicate create changed stored canvas: %#v, %v", stored, err)
	}
	if _, err := svc.repo.CanvasMutationReceiptForUser("user", "canvas", request.MutationID); !errors.Is(err, gorm.ErrRecordNotFound) {
		t.Fatalf("rejected creation retained a receipt: %v", err)
	}
}

func TestApplyCanvasOperationsDoesNotRecreateDeletedCanvas(t *testing.T) {
	svc := newCanvasOperationTestService(t)
	if _, err := svc.ApplyUserCanvasOperations("user", "canvas", CanvasOperationsRequest{MutationID: "create", Operations: []CanvasOperation{{Type: "create_canvas", ID: "canvas", Patch: map[string]json.RawMessage{"title": json.RawMessage(`"初始"`)}}}}); err != nil {
		t.Fatal(err)
	}
	if err := svc.DeleteUserCanvasProject("user", "canvas"); err != nil {
		t.Fatal(err)
	}
	late := CanvasOperationsRequest{MutationID: "late-after-canvas-delete", Operations: []CanvasOperation{{Type: "patch_node", ID: "node", Patch: map[string]json.RawMessage{"title": json.RawMessage(`"迟到"`)}, Before: map[string]json.RawMessage{"title": json.RawMessage(`null`)}}}}
	if _, err := svc.ApplyUserCanvasOperations("user", "canvas", late); err == nil {
		t.Fatal("late update recreated deleted canvas")
	}
	createAgain := CanvasOperationsRequest{MutationID: "explicit-recreate", Operations: []CanvasOperation{{Type: "create_canvas", ID: "canvas", Patch: map[string]json.RawMessage{"title": json.RawMessage(`"明确新建"`)}}}}
	if _, err := svc.ApplyUserCanvasOperations("user", "canvas", createAgain); err != nil {
		t.Fatalf("explicit canvas creation after deletion failed: %v", err)
	}
}

func TestApplyCanvasOperationsRequiresObjectPreconditions(t *testing.T) {
	svc := newCanvasOperationTestService(t)
	if err := svc.repo.Create(&model.CanvasProject{ID: "canvas", UserID: "user", PayloadJSON: `{"nodes":[{"id":"node","title":"旧"}],"connections":[{"id":"edge","fromNodeId":"node","toNodeId":"node","label":"旧"}]}`}); err != nil {
		t.Fatal(err)
	}
	withoutPatchBase := CanvasOperationsRequest{MutationID: "missing-patch-base", Operations: []CanvasOperation{{Type: "patch_node", ID: "node", Patch: map[string]json.RawMessage{"title": json.RawMessage(`"新"`)}}}}
	if _, err := svc.ApplyUserCanvasOperations("user", "canvas", withoutPatchBase); err == nil {
		t.Fatal("patch without field precondition was accepted")
	}
	withoutRemoveBase := CanvasOperationsRequest{MutationID: "missing-remove-base", Operations: []CanvasOperation{{Type: "remove_node", ID: "node"}}}
	if _, err := svc.ApplyUserCanvasOperations("user", "canvas", withoutRemoveBase); err == nil {
		t.Fatal("remove without object precondition was accepted")
	}
	withoutConnectionBase := CanvasOperationsRequest{MutationID: "missing-connection-base", Operations: []CanvasOperation{{Type: "update_connection", ID: "edge", Connection: json.RawMessage(`{"id":"edge","fromNodeId":"node","toNodeId":"node","label":"新"}`)}}}
	if _, err := svc.ApplyUserCanvasOperations("user", "canvas", withoutConnectionBase); err == nil {
		t.Fatal("connection update without object precondition was accepted")
	}
}

func newCanvasOperationTestService(t *testing.T) *Service {
	t.Helper()
	db, err := gorm.Open(sqlite.Open(filepath.Join(t.TempDir(), "canvas-operations.db")), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&model.CanvasEditLease{}, &model.CanvasProject{}, &model.CanvasSnapshot{}, &model.CanvasSnapshotResource{}, &model.CanvasMutationReceipt{}, &model.CanvasShare{}, &model.CanvasUnitLink{}, &model.Task{}, &model.CloudAgentExecution{}, &model.Resource{}, &model.Asset{}); err != nil {
		t.Fatal(err)
	}
	sqlDB, _ := db.DB()
	t.Cleanup(func() { _ = sqlDB.Close() })
	return New(repository.New(db), nil)
}
