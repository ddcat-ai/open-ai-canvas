package app

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os/exec"
	"strings"
	"sync"
	"testing"
	"time"

	agentruntime "infinite-canvas/backend/internal/agent/runtime"
	"infinite-canvas/backend/internal/model"
)

// The mock upstream rejects the same unmatched tool-call shape that the
// production text provider rejected. The request must pass the real Go/Node
// bridge, approval, task worker, native session, and continuation path.
func TestCreationPlanningQuestionAndJapaneseContinuationReachPairedUpstream(t *testing.T) {
	if _, err := exec.LookPath("node"); err != nil {
		t.Skip("node is not installed")
	}
	if _, err := agentruntime.RuntimeDir(); err != nil {
		t.Skip(err.Error())
	}
	t.Setenv("CANVAS_ALLOWED_PRIVATE_UPSTREAM_HOSTS", "127.0.0.1")
	t.Setenv("REDIS_URL", "")

	var mu sync.Mutex
	var bodies []map[string]any
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		defer r.Body.Close()
		var body map[string]any
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Errorf("decode model request: %v", err)
			w.WriteHeader(http.StatusBadRequest)
			return
		}
		mu.Lock()
		bodies = append(bodies, body)
		call := len(bodies)
		mu.Unlock()
		if call > 1 {
			pending := map[string]bool{}
			for _, item := range body["messages"].([]any) {
				message, _ := item.(map[string]any)
				if message["role"] == "assistant" {
					calls, _ := message["tool_calls"].([]any)
					for _, raw := range calls {
						tool, _ := raw.(map[string]any)
						pending[stringField(tool, "id")] = true
					}
				}
				if message["role"] == "tool" {
					delete(pending, stringField(message, "tool_call_id"))
				}
			}
			if len(pending) > 0 {
				w.WriteHeader(http.StatusBadRequest)
				_, _ = io.WriteString(w, `{"error":{"code":11133,"message":"Invalid request parameters"}}`)
				return
			}
		}
		w.Header().Set("Content-Type", "application/json")
		if call == 1 {
			plan := `{"items":[{"id":"jp-site","title":"确认日本站、不含白底图","status":"pending"},{"id":"jp-copy","title":"规划园艺卖点","status":"pending"}]}`
			question := `{"question":"商品用途？","options":[{"label":"园艺滴灌"},{"label":"其他"}]}`
			_ = json.NewEncoder(w).Encode(map[string]any{"choices": []any{map[string]any{"message": map[string]any{
				"content": "先确认方案与用途。",
				"tool_calls": []any{
					map[string]any{"id": "plan-1", "type": "function", "function": map[string]any{"name": "plan_update", "arguments": plan}},
					map[string]any{"id": "ask-2", "type": "function", "function": map[string]any{"name": "ask_user", "arguments": question}},
				},
			}}}})
			return
		}
		_, _ = io.WriteString(w, `{"choices":[{"message":{"content":"继续按日本站园艺滴灌需求处理。"}}]}`)
	}))
	defer upstream.Close()

	s, db, _, _ := creationTestService(t)
	s = New(s.repo, s.dataDir)
	t.Cleanup(func() { _ = s.Close() })
	if err := db.Model(&model.ModelChannel{}).Where("id = ?", "channel").Updates(map[string]any{"base_url": upstream.URL, "api_key": "test-only"}).Error; err != nil {
		t.Fatal(err)
	}
	stop := make(chan struct{})
	defer close(stop)
	go func() {
		for {
			select {
			case <-stop:
				return
			default:
			}
			_ = s.ProcessNextTask()
			time.Sleep(20 * time.Millisecond)
		}
	}()

	req := creationAgentRequest()
	req.IdempotencyKey = "approval-question-jp-first"
	req.Prompt = "请改为亚马逊日本站套图，不含白底图。"
	req.PermissionMode = "request_approval"
	first, err := s.CreateCloudAgentRun("user", req, "")
	if err != nil {
		t.Fatal(err)
	}
	waitCloudAgentStatus(t, s, first.ID, "completed")
	deadline := time.Now().Add(15 * time.Second)
	for time.Now().Before(deadline) {
		saved, err := s.repo.CloudAgentPiSession("user", first.ID)
		if err == nil && strings.Contains(saved.SessionJSONL, `"toolCallId":"plan-1"`) && strings.Contains(saved.SessionJSONL, `"toolCallId":"ask-2"`) {
			break
		}
		time.Sleep(50 * time.Millisecond)
	}
	saved, err := s.repo.CloudAgentPiSession("user", first.ID)
	if err != nil || !strings.Contains(saved.SessionJSONL, `"toolCallId":"ask-2"`) {
		t.Fatalf("question/result did not reach durable Pi history: %v", err)
	}
	mu.Lock()
	before := len(bodies)
	mu.Unlock()
	if before != 1 {
		t.Fatalf("approval/question turn unexpectedly called text model %d times", before)
	}
	req = creationAgentRequest()
	req.IdempotencyKey = "approval-question-jp-answer"
	req.Prompt = "用于园艺滴灌和喷淋。"
	child, err := s.CreateCloudAgentRun("user", req, first.ID)
	if err != nil {
		t.Fatal(err)
	}
	waitCloudAgentStatus(t, s, child.ID, "completed")
	mu.Lock()
	defer mu.Unlock()
	if len(bodies) != 2 {
		t.Fatalf("expected two actual text-model requests, got %d", len(bodies))
	}
	raw, _ := json.Marshal(bodies[1]["messages"])
	for _, want := range []string{"日本站", "园艺滴灌", "plan-1", "ask-2"} {
		if !strings.Contains(string(raw), want) {
			t.Fatalf("continuation lost %q in real upstream request: %s", want, raw)
		}
	}
}

func TestCreationRejectedPlanRevisionReachesPairedUpstreamWithoutOldToolExecution(t *testing.T) {
	if _, err := exec.LookPath("node"); err != nil {
		t.Skip("node is not installed")
	}
	if _, err := agentruntime.RuntimeDir(); err != nil {
		t.Skip(err.Error())
	}
	t.Setenv("CANVAS_ALLOWED_PRIVATE_UPSTREAM_HOSTS", "127.0.0.1")
	t.Setenv("REDIS_URL", "")
	plan := commerceFixturePlan()
	plan.ProductFacts[0].SourceIDs = []string{"ref-one"}
	plan.Items[0].Type, plan.Items[0].Operation, plan.Items[0].AttachmentResourceIDs = "video", "image_to_video", []string{"ref-one"}
	planJSON, _ := json.Marshal(plan)
	var mu sync.Mutex
	var bodies []map[string]any
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		defer r.Body.Close()
		var body map[string]any
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Error(err)
			w.WriteHeader(400)
			return
		}
		mu.Lock()
		bodies = append(bodies, body)
		step := len(bodies)
		mu.Unlock()
		w.Header().Set("Content-Type", "application/json")
		if step == 1 {
			_ = json.NewEncoder(w).Encode(map[string]any{"choices": []any{map[string]any{"message": map[string]any{"content": "旧日本站方案等待审批", "tool_calls": []any{
				map[string]any{"id": "old-plan", "type": "function", "function": map[string]any{"name": "commerce_plan_submit", "arguments": string(planJSON)}},
				map[string]any{"id": "old-question", "type": "function", "function": map[string]any{"name": "ask_user", "arguments": `{"question":"旧语言问题","options":[{"label":"日语"},{"label":"其他"}]}`}},
			}}}}})
			return
		}
		_, _ = io.WriteString(w, `{"choices":[{"message":{"content":"按备注重新规划法国站五图 1K。"}}]}`)
	}))
	defer upstream.Close()
	fixture, db, _ := agentMediaFixture(t)
	s := New(fixture.repo, fixture.dataDir)
	t.Cleanup(func() { _ = s.Close() })
	if err := db.Model(&model.ModelChannel{}).Where("id = ?", "channel").Updates(map[string]any{"base_url": upstream.URL, "api_key": "test-only"}).Error; err != nil {
		t.Fatal(err)
	}
	stop := make(chan struct{})
	defer close(stop)
	go func() {
		for {
			select {
			case <-stop:
				return
			default:
			}
			_ = s.ProcessNextTask()
			time.Sleep(20 * time.Millisecond)
		}
	}()
	req := creationAgentRequest()
	req.PermissionMode, req.IdempotencyKey, req.Prompt = "request_approval", "reject-jp-parent", "日本站六图，日语"
	req.Budget.MaxCredits, req.Budget.MaxGenerationTasks = 1, 1
	req.Attachments = []CloudAgentAttachment{{ResourceID: "ref-one", StorageKey: "resource:ref-one", Kind: "image", Role: "product", Name: "产品图"}}
	req.MediaSettings = &CloudAgentCreationMedia{Video: &CloudAgentCreationMediaChoice{Selection: CloudAgentMediaModelSelection{ChannelID: "channel", ChannelModelKey: "seedance-test"}, ParameterMode: "manual", Size: "9:16", DurationSeconds: 6}}
	first, err := s.CreateCloudAgentRun("user", req, "")
	if err != nil {
		t.Fatal(err)
	}
	waiting := waitCloudAgentStatus(t, s, first.ID, "waiting_approval")
	deadline := time.Now().Add(10 * time.Second)
	for time.Now().Before(deadline) {
		saved, err := s.repo.CloudAgentPiSession("user", first.ID)
		if err == nil && strings.Contains(saved.SessionJSONL, `"paused":true`) {
			break
		}
		time.Sleep(30 * time.Millisecond)
	}
	if waiting.Approval == nil {
		t.Fatal("missing old approval")
	}
	if err := s.DecideCloudAgentApproval("user", first.ID, waiting.Approval.ID, "reject", "按备注修改"); err != nil {
		t.Fatal(err)
	}
	req.IdempotencyKey, req.Prompt = "revised-fr-child", "备注：改成法国站五图，1K分辨率。"
	child, err := s.CreateCloudAgentRun("user", req, first.ID)
	if err != nil {
		t.Fatal(err)
	}
	waitCloudAgentStatus(t, s, child.ID, "completed")
	mu.Lock()
	defer mu.Unlock()
	if len(bodies) != 2 {
		t.Fatalf("expected one replan model request, got %d", len(bodies))
	}
	raw, _ := json.Marshal(bodies[1]["messages"])
	for _, want := range []string{"old-plan", "old-question", "user_rejected", "法国站五图"} {
		if !strings.Contains(string(raw), want) {
			t.Fatalf("revision lost paired history %s", want)
		}
	}
	var pending = map[string]bool{}
	for _, entry := range bodies[1]["messages"].([]any) {
		message := entry.(map[string]any)
		if calls, ok := message["tool_calls"].([]any); ok {
			for _, call := range calls {
				pending[stringField(call.(map[string]any), "id")] = true
			}
		}
		if message["role"] == "tool" {
			delete(pending, stringField(message, "tool_call_id"))
		}
	}
	if len(pending) != 0 {
		t.Fatalf("upstream received unpaired old calls: %v", pending)
	}
	old, _ := s.CloudAgentRun("user", first.ID)
	for _, event := range old.Events {
		if event.Type == "user_question" {
			t.Fatal("replanning executed the rejected parent's next tool")
		}
	}
	var mediaTasks int64
	db.Model(&model.Task{}).Where("type IN ?", []string{"canvas_image", "canvas_video"}).Count(&mediaTasks)
	if mediaTasks != 0 {
		t.Fatal("replanning submitted media before its new approval")
	}
}
