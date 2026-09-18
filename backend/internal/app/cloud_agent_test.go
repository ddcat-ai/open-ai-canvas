package app

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"

	"infinite-canvas/backend/internal/model"
)

func agentTestRequest() CloudAgentRequest {
	req := CloudAgentRequest{CanvasID: "agent-canvas", Prompt: "分析剧情", Model: "text-test", ChannelID: "channel", ChannelModelKey: "text-test", PermissionMode: "read_only", ContextScope: []string{"canvas"}, IdempotencyKey: "agent-test-key"}
	req.Budget.MaxCredits = 1
	return req
}

func TestCloudAgentRunSurvivesTaskInputCompaction(t *testing.T) {
	s, db, _, _ := creationTestService(t)
	if err := db.Create(&model.CanvasProject{ID: "agent-canvas", UserID: "user", PayloadJSON: `{"nodes":[]}`}).Error; err != nil {
		t.Fatal(err)
	}
	req := agentTestRequest()
	root, err := s.CreateCloudAgentRun("user", req, "")
	if err != nil {
		t.Fatal(err)
	}
	var task model.Task
	if err := db.First(&task, "id = ?", root.ID).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Model(&model.Task{}).Where("id = ?", root.ID).Updates(map[string]any{
		"status": model.TaskStatusSucceeded, "input_json": publicTaskInputJSON(task.InputJSON), "result_json": `{"text":"可信回复"}`,
	}).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Model(&model.CloudAgentExecution{}).Where("id = ?", root.ID).Update("status", "completed").Error; err != nil {
		t.Fatal(err)
	}
	finished, err := s.CloudAgentRun("user", root.ID)
	if err != nil || finished.Status != "completed" {
		t.Fatalf("compacted run became unreadable: %v", err)
	}
	if _, err := s.CloudAgentRun("other", root.ID); err == nil {
		t.Fatal("compacted run leaked to another user")
	}
	duplicate, err := s.CreateCloudAgentRun("user", req, "")
	if err != nil || duplicate.ID != root.ID {
		t.Fatalf("compacted run lost idempotency: %v", err)
	}
	changed := req
	changed.Prompt = "不同请求"
	if _, err := s.CreateCloudAgentRun("user", changed, ""); err == nil {
		t.Fatal("compacted run accepted conflicting idempotency key")
	}
	next := req
	next.IdempotencyKey = "agent-next-after-compaction"
	continued, err := s.CreateCloudAgentRun("user", next, root.ID)
	if err != nil {
		t.Fatalf("compacted run cannot continue: %v", err)
	}
	var child model.Task
	if err := db.First(&child, "id = ?", continued.ID).Error; err != nil {
		t.Fatal(err)
	}
	var input struct {
		TextHistory []providerTextMessage `json:"textHistory"`
	}
	if err := json.Unmarshal([]byte(child.InputJSON), &input); err != nil {
		t.Fatal(err)
	}
	if len(input.TextHistory) != 2 || input.TextHistory[0].Content != req.Prompt || input.TextHistory[1].Content != "可信回复" {
		t.Fatalf("history lost after compaction: %+v", input.TextHistory)
	}
}

func TestCloudAgentLegacyRunSurvivesTaskInputCompaction(t *testing.T) {
	s, db, _, _ := creationTestService(t)
	if err := db.Create(&model.CanvasProject{ID: "agent-canvas", UserID: "user", PayloadJSON: `{"nodes":[]}`}).Error; err != nil {
		t.Fatal(err)
	}
	req := agentTestRequest()
	root, err := s.CreateCloudAgentRun("user", req, "")
	if err != nil {
		t.Fatal(err)
	}
	var task model.Task
	if err := db.First(&task, "id = ?", root.ID).Error; err != nil {
		t.Fatal(err)
	}
	var execution model.CloudAgentExecution
	if err := db.First(&execution, "id = ?", root.ID).Error; err != nil {
		t.Fatal(err)
	}
	var stored map[string]any
	if err := json.Unmarshal([]byte(execution.StateJSON), &stored); err != nil {
		t.Fatal(err)
	}
	delete(stored, "parentId")
	delete(stored, "fingerprint")
	delete(stored, "textHistory")
	encoded, _ := json.Marshal(stored)
	if err := db.Model(&model.CloudAgentExecution{}).Where("id = ?", root.ID).Update("state_json", string(encoded)).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Model(&model.Task{}).Where("id = ?", root.ID).Updates(map[string]any{
		"status": model.TaskStatusSucceeded, "input_json": publicTaskInputJSON(task.InputJSON), "result_json": `{"text":"旧轮次回复"}`,
	}).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Model(&model.CloudAgentExecution{}).Where("id = ?", root.ID).Update("status", "completed").Error; err != nil {
		t.Fatal(err)
	}
	finished, err := s.CloudAgentRun("user", root.ID)
	if err != nil || finished.Status != "completed" {
		t.Fatalf("legacy compacted run became unreadable: %v", err)
	}
	if _, err := s.CreateCloudAgentRun("user", req, ""); err == nil {
		t.Fatal("legacy run without fingerprint accepted idempotency replay")
	}
	next := req
	next.IdempotencyKey = "agent-next-after-legacy"
	continued, err := s.CreateCloudAgentRun("user", next, root.ID)
	if err != nil {
		t.Fatalf("legacy compacted run cannot continue: %v", err)
	}
	var child model.Task
	if err := db.First(&child, "id = ?", continued.ID).Error; err != nil {
		t.Fatal(err)
	}
	var input struct {
		TextHistory []providerTextMessage `json:"textHistory"`
	}
	if err := json.Unmarshal([]byte(child.InputJSON), &input); err != nil {
		t.Fatal(err)
	}
	if len(input.TextHistory) != 2 || input.TextHistory[0].Content != req.Prompt || input.TextHistory[1].Content != "旧轮次回复" {
		t.Fatalf("legacy history lost after compaction: %+v", input.TextHistory)
	}
}

func TestCloudAgentTerminalRunWithOlderCapabilityCanContinueOnCurrentContract(t *testing.T) {
	s, db, _, _ := creationTestService(t)
	if err := db.Create(&model.CanvasProject{ID: "agent-canvas", UserID: "user", PayloadJSON: `{"nodes":[]}`}).Error; err != nil {
		t.Fatal(err)
	}
	parentRequest := agentTestRequest()
	parentRequest.IdempotencyKey = "older-capability-parent"
	parent, err := s.CreateCloudAgentRun("user", parentRequest, "")
	if err != nil {
		t.Fatal(err)
	}
	parentExecution, err := s.repo.CloudAgent("user", parent.ID)
	if err != nil {
		t.Fatal(err)
	}
	parentState, err := cloudAgentDecode(parentExecution)
	if err != nil {
		t.Fatal(err)
	}
	parentState.Policy.CapabilitySetVersion = "canvas-capabilities/v1"
	parentState.Policy.CapabilitySetHash = agentProfileHash("historical capability contract")
	if err = cloudAgentSave(parentExecution, &parentState); err != nil {
		t.Fatal(err)
	}
	if err = db.Model(&model.CloudAgentExecution{}).Where("id = ?", parent.ID).Updates(map[string]any{
		"status": "completed", "state_json": parentExecution.StateJSON,
	}).Error; err != nil {
		t.Fatal(err)
	}
	if err = db.Model(&model.Task{}).Where("id = ?", parent.ID).Updates(map[string]any{
		"status": model.TaskStatusSucceeded, "result_json": `{"text":"旧合同下的可信回复"}`,
	}).Error; err != nil {
		t.Fatal(err)
	}
	historicalStateJSON := parentExecution.StateJSON

	childRequest := agentTestRequest()
	childRequest.Prompt = "继续操作"
	childRequest.IdempotencyKey = "current-capability-child"
	child, err := s.CreateCloudAgentRun("user", childRequest, parent.ID)
	if err != nil {
		t.Fatalf("terminal historical run cannot continue: %v", err)
	}
	childExecution, err := s.repo.CloudAgent("user", child.ID)
	if err != nil {
		t.Fatal(err)
	}
	childState, err := cloudAgentDecode(childExecution)
	if err != nil {
		t.Fatal(err)
	}
	if err = validateCloudAgentPolicySnapshot(childState.Policy); err != nil {
		t.Fatalf("child did not use the current execution contract: %v", err)
	}
	if childState.Policy.CapabilitySetVersion != cloudAgentCapabilitySetVersion || childState.Policy.CapabilitySetHash != cloudAgentCapabilitySetHash() {
		t.Fatalf("child capability contract is stale: %+v", childState.Policy)
	}
	if childState.ParentID != parent.ID || len(childState.TextHistory) != 2 || childState.TextHistory[1].Content != "旧合同下的可信回复" {
		t.Fatalf("historical conversation context was not preserved: %+v", childState)
	}
	var storedParent model.CloudAgentExecution
	if err = db.First(&storedParent, "id = ?", parent.ID).Error; err != nil {
		t.Fatal(err)
	}
	if storedParent.StateJSON != historicalStateJSON {
		t.Fatal("continuation mutated the frozen parent runtime")
	}
}

func TestCloudAgentActiveRunWithOlderCapabilityIsTerminatedWithoutResume(t *testing.T) {
	s, db, _, _ := creationTestService(t)
	if err := db.Create(&model.CanvasProject{ID: "agent-canvas", UserID: "user", PayloadJSON: `{"nodes":[]}`}).Error; err != nil {
		t.Fatal(err)
	}
	req := agentTestRequest()
	req.IdempotencyKey = "older-active-contract"
	run, err := s.CreateCloudAgentRun("user", req, "")
	if err != nil {
		t.Fatal(err)
	}
	execution, err := s.repo.CloudAgent("user", run.ID)
	if err != nil {
		t.Fatal(err)
	}
	state, err := cloudAgentDecode(execution)
	if err != nil {
		t.Fatal(err)
	}
	state.Policy.CapabilitySetVersion = "canvas-capabilities/v1"
	state.Policy.CapabilitySetHash = agentProfileHash("historical capability contract")
	if err = cloudAgentSave(execution, &state); err != nil {
		t.Fatal(err)
	}
	if err = db.Model(&model.CloudAgentExecution{}).Where("id = ?", run.ID).Update("state_json", execution.StateJSON).Error; err != nil {
		t.Fatal(err)
	}
	if err = s.advanceCloudAgentByID("user", run.ID); err != nil {
		t.Fatal(err)
	}
	execution, err = s.repo.CloudAgent("user", run.ID)
	if err != nil {
		t.Fatal(err)
	}
	if execution.Status != "failed" || !strings.Contains(execution.FailureMessage, "旧版执行合同") {
		t.Fatalf("stale active contract was resumed or failed opaquely: status=%s message=%q", execution.Status, execution.FailureMessage)
	}
}

func TestCloudAgentValidation(t *testing.T) {
	for _, mutate := range []func(*CloudAgentRequest){
		func(r *CloudAgentRequest) { r.PermissionMode = "unrestricted" },
		func(r *CloudAgentRequest) { r.SkillIDs = []string{"skill", "skill"} },
		func(r *CloudAgentRequest) { r.ContextScope = []string{"resources"} },
		func(r *CloudAgentRequest) { r.Budget.MaxCredits = 0 },
		func(r *CloudAgentRequest) { r.Budget.MaxGenerationTasks = 1 },
		func(r *CloudAgentRequest) { r.IdempotencyKey = "short" },
	} {
		req := agentTestRequest()
		mutate(&req)
		if validateCloudAgentRequest(&req) == nil {
			t.Fatal("unsupported request accepted")
		}
	}
}

func TestCloudAgentAdmissionAndContinuation(t *testing.T) {
	s, db, _, _ := creationTestService(t)
	canvas := model.CanvasProject{ID: "agent-canvas", UserID: "user", Title: "test", PayloadJSON: `{"nodes":[{"id":"n","type":"text","metadata":{"content":"剧情片段","secret":"do-not-send"}}]}`}
	if err := db.Create(&canvas).Error; err != nil {
		t.Fatal(err)
	}
	req := agentTestRequest()
	if _, err := s.CreateCloudAgentRun("other", req, ""); err == nil {
		t.Fatal("foreign canvas accepted")
	}
	low := req
	low.Budget.MaxCredits = 0.000001
	if _, err := s.CreateCloudAgentRun("user", low, ""); err == nil {
		t.Fatal("over-budget accepted")
	}
	var count int64
	db.Model(&model.Task{}).Count(&count)
	if count != 0 {
		t.Fatal("rejected request created a task")
	}
	run, err := s.CreateCloudAgentRun("user", req, "")
	if err != nil {
		t.Fatal(err)
	}
	duplicate, err := s.CreateCloudAgentRun("user", req, "")
	if err != nil || duplicate.ID != run.ID {
		t.Fatalf("idempotency failed: %v", err)
	}
	db.Model(&model.Task{}).Count(&count)
	if count != 1 {
		t.Fatalf("duplicate tasks: %d", count)
	}
	changed := req
	changed.Prompt = "different"
	if _, err := s.CreateCloudAgentRun("user", changed, ""); err == nil {
		t.Fatal("key reuse accepted")
	}
	if _, err := s.CloudAgentRun("other", run.ID); err == nil {
		t.Fatal("foreign run readable")
	}
	next := req
	next.IdempotencyKey = "agent-next-key"
	if _, err := s.CreateCloudAgentRun("user", next, run.ID); err == nil {
		t.Fatal("running parent accepted")
	}
	if err := db.Model(&model.Task{}).Where("id = ?", run.ID).Updates(map[string]any{"status": model.TaskStatusSucceeded, "result_json": `{"text":"可信回复"}`}).Error; err != nil {
		t.Fatal(err)
	}
	continued, err := s.CreateCloudAgentRun("user", next, run.ID)
	if err != nil {
		t.Fatal(err)
	}
	var task model.Task
	db.First(&task, "id = ?", continued.ID)
	var input struct {
		TextHistory []providerTextMessage `json:"textHistory"`
	}
	if err := json.Unmarshal([]byte(task.InputJSON), &input); err != nil {
		t.Fatal(err)
	}
	if len(input.TextHistory) != 2 || input.TextHistory[1].Content != "可信回复" {
		t.Fatalf("missing trusted history: %+v", input)
	}
	if strings.Contains(task.InputJSON, "do-not-send") {
		t.Fatal("unapproved canvas metadata leaked")
	}
	public := creationTextRequest()
	public.Operation = cloudAgentOperation
	if _, err := s.CreateTask("user", public); err == nil {
		t.Fatal("reserved operation accepted by public task API")
	}
	if err := db.Model(&model.Task{}).Where("id = ?", run.ID).Update("status", model.TaskStatusFailed).Error; err != nil {
		t.Fatal(err)
	}
	if _, err := s.taskLifecycle().retryTask("user", run.ID); err == nil || !strings.Contains(err.Error(), "Agent 重试需要新的幂等键") {
		t.Fatalf("Agent task retry was not blocked: %v", err)
	}
}

func TestCloudAgentAdmissionAcceptsTokenPricingWithQuotedChargeLimit(t *testing.T) {
	s, db, _, _ := creationTestService(t)
	if err := db.Create(&model.CanvasProject{ID: "agent-canvas", UserID: "user", PayloadJSON: `{"nodes":[]}`}).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Model(&model.ChannelModel{}).Where("id = ?", "cm").Updates(map[string]any{
		"billing_mode": "token", "unit_price_microcredits": 0,
		"input_token_price_microcredits": int64(1_000_000), "output_token_price_microcredits": int64(1_000_000),
	}).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Model(&model.ChannelModelPriceTier{}).Where("id = ?", "tier").Updates(map[string]any{
		"billing_mode": "token", "unit_price_microcredits": 0,
		"input_token_price_microcredits": int64(1_000_000), "output_token_price_microcredits": int64(1_000_000),
	}).Error; err != nil {
		t.Fatal(err)
	}

	run, err := s.CreateCloudAgentRun("user", agentTestRequest(), "")
	if err != nil {
		t.Fatalf("token-priced Agent request was rejected: %v", err)
	}
	var order model.BillingOrder
	if err := db.First(&order, "task_id = ?", run.ID).Error; err != nil {
		t.Fatal(err)
	}
	if order.BillingMode != "token" || order.AmountMicrocredits <= 0 || order.ChargeLimitMicrocredits != order.AmountMicrocredits {
		t.Fatalf("Agent token order did not persist quoted hard limit: %+v", order)
	}
}

func TestCloudAgentWorkerPersistsRealResponse(t *testing.T) {
	t.Setenv("CANVAS_ALLOWED_PRIVATE_UPSTREAM_HOSTS", "127.0.0.1")
	t.Setenv("REDIS_URL", "")
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body map[string]any
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Error(err)
		}
		encoded, _ := json.Marshal(body["tools"])
		if strings.Contains(string(encoded), "canvas_apply_ops") || strings.Contains(string(encoded), "generate_media") {
			t.Error("read-only request exposed write tools")
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"choices":[{"message":{"content":"测试回复"}}]}`))
	}))
	defer upstream.Close()
	s, db, _, _ := creationTestService(t)
	s = New(s.repo, s.dataDir)
	t.Cleanup(func() { _ = s.Close() })
	if err := db.Model(&model.ModelChannel{}).Where("id = ?", "channel").Updates(map[string]any{"base_url": upstream.URL, "api_key": "test-only"}).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&model.CanvasProject{ID: "agent-canvas", UserID: "user", PayloadJSON: `{"nodes":[]}`}).Error; err != nil {
		t.Fatal(err)
	}
	run, err := s.CreateCloudAgentRun("user", agentTestRequest(), "")
	if err != nil {
		t.Fatal(err)
	}
	if err := s.ProcessNextTask(); err != nil {
		t.Fatal(err)
	}
	var task model.Task
	if err := db.First(&task, "id = ?", run.ID).Error; err != nil {
		t.Fatal(err)
	}
	if task.Status != model.TaskStatusSucceeded || taskResultText(task.ResultJSON) != "测试回复" {
		t.Fatalf("worker result: status=%s result=%s error=%s", task.Status, task.ResultJSON, task.Error)
	}
}

func TestCloudAgentConcurrentIdempotencyReservesOnce(t *testing.T) {
	s, db, _, _ := creationTestService(t)
	if err := db.Create(&model.CanvasProject{ID: "agent-canvas", UserID: "user", PayloadJSON: `{"nodes":[]}`}).Error; err != nil {
		t.Fatal(err)
	}
	var wg sync.WaitGroup
	for i := 0; i < 4; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if _, err := s.CreateCloudAgentRun("user", agentTestRequest(), ""); err != nil {
				t.Error(err)
			}
		}()
	}
	wg.Wait()
	for _, table := range []any{&model.Task{}, &model.BillingOrder{}, &model.CreditLedgerEntry{}} {
		var count int64
		db.Model(table).Count(&count)
		if count != 1 {
			t.Fatalf("expected one %T, got %d", table, count)
		}
	}
	var account model.CreditAccount
	db.First(&account, "user_id = ?", "user")
	if account.AvailableMicrocredits != 9900 || account.ReservedMicrocredits != 100 {
		t.Fatalf("unexpected reservation: %+v", account)
	}
}

func TestCloudAgentToolLoopPersistsApprovalAndAppliesCanvasWrite(t *testing.T) {
	s, db, _, _ := creationTestService(t)
	canvas := model.CanvasProject{ID: "agent-canvas", UserID: "user", Title: "test", PayloadJSON: `{"nodes":[]}`}
	if err := db.Create(&canvas).Error; err != nil {
		t.Fatal(err)
	}
	req := agentTestRequest()
	req.ReasoningMode = "deep"
	req.PermissionMode = "request_approval"
	root, err := s.CreateCloudAgentRun("user", req, "")
	if err != nil {
		t.Fatal(err)
	}
	doc, err := creationDocument(canvas.PayloadJSON)
	if err != nil {
		t.Fatal(err)
	}
	callArguments, err := json.Marshal(map[string]any{
		"snapshotHash": cloudAgentCanvasHash(doc),
		"ops":          []map[string]any{{"type": "add_node", "id": "agent-note", "nodeType": "text", "title": "Agent note", "content": "由 Agent 写入", "x": 24, "y": 48}},
	})
	if err != nil {
		t.Fatal(err)
	}
	result, err := json.Marshal(map[string]any{
		"text": "我先读取画布，再请求写入。",
		"toolCalls": []map[string]any{
			{"id": "read-1", "type": "function", "function": map[string]any{"name": "canvas_get_state", "arguments": `{}`}},
			{"id": "write-1", "type": "function", "function": map[string]any{"name": "canvas_apply_ops", "arguments": string(callArguments)}},
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	var rootTask model.Task
	if err := db.First(&rootTask, "id = ?", root.ID).Error; err != nil {
		t.Fatal(err)
	}
	var rootInput canvasGenerationInput
	if err := json.Unmarshal([]byte(rootTask.InputJSON), &rootInput); err != nil || !rootInput.TextOptions.Thinking {
		t.Fatalf("initial task lost thinking option: %v", err)
	}
	if err := db.Model(&model.Task{}).Where("id = ?", root.ID).Updates(map[string]any{"status": model.TaskStatusSucceeded, "result_json": string(result), "input_json": publicTaskInputJSON(rootTask.InputJSON)}).Error; err != nil {
		t.Fatal(err)
	}

	// The worker transition first records the model response, then executes one
	// tool per durable transition. This is the recovery boundary after restart.
	if err := s.advanceCloudAgentByID("user", root.ID); err != nil {
		t.Fatal(err)
	}
	if err := s.advanceCloudAgentByID("user", root.ID); err != nil {
		t.Fatal(err)
	}
	if err := s.advanceCloudAgentByID("user", root.ID); err != nil {
		t.Fatal(err)
	}
	waiting, err := s.CloudAgentRun("user", root.ID)
	if err != nil {
		t.Fatal(err)
	}
	if waiting.Status != "waiting_approval" || waiting.Approval == nil || waiting.Approval.ID == "" {
		t.Fatalf("approval was not persisted: %+v", waiting)
	}
	if err := s.DecideCloudAgentApproval("user", root.ID, waiting.Approval.ID, "approve", "确认写入"); err != nil {
		t.Fatal(err)
	}
	if err := s.advanceCloudAgentByID("user", root.ID); err != nil {
		t.Fatal(err)
	}
	var stored model.CanvasProject
	if err := db.First(&stored, "id = ? AND user_id = ?", canvas.ID, "user").Error; err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(stored.PayloadJSON, "由 Agent 写入") {
		t.Fatalf("approved canvas write missing: %s", stored.PayloadJSON)
	}
	final, err := s.CloudAgentRun("user", root.ID)
	if err != nil {
		t.Fatal(err)
	}
	if final.Approval != nil {
		t.Fatalf("approval remained after execution: %+v", final.Approval)
	}
	foundTool := false
	for _, event := range final.Events {
		if event.Type == "tool_completed" && event.Payload["toolName"] == "canvas_apply_ops" {
			foundTool = true
		}
	}
	if !foundTool {
		t.Fatalf("tool completion event missing: %+v", final.Events)
	}
	if err := s.advanceCloudAgentByID("user", root.ID); err != nil {
		t.Fatal(err)
	}
	execution, err := s.repo.CloudAgent("user", root.ID)
	if err != nil {
		t.Fatal(err)
	}
	runtime, err := cloudAgentDecode(execution)
	if err != nil {
		t.Fatal(err)
	}
	var nextTask model.Task
	if err := db.First(&nextTask, "id = ?", runtime.ActiveTaskID).Error; err != nil {
		t.Fatal(err)
	}
	var nextInput canvasGenerationInput
	if err := json.Unmarshal([]byte(nextTask.InputJSON), &nextInput); err != nil || !nextInput.TextOptions.Thinking || nextTask.ID == root.ID {
		t.Fatalf("tool continuation lost thinking option or failed to enqueue: %v", err)
	}
}

func TestCloudAgentNodeTypesExposeExecutableAllowList(t *testing.T) {
	result := cloudAgentNodeTypes()
	nodes, ok := result["nodes"].([]map[string]any)
	if !ok || len(nodes) != 8 {
		t.Fatalf("unexpected node registry: %#v", result)
	}
	for _, node := range nodes {
		if node["type"] == "panorama" {
			t.Fatal("UI-only node must not be exposed")
		}
	}
}

func TestCloudAgentCanvasApprovalAdmissionFailureTerminatesRun(t *testing.T) {
	s, db, _, _ := creationTestService(t)
	canvas := model.CanvasProject{ID: "agent-canvas", UserID: "user", Title: "test", PayloadJSON: `{"nodes":[]}`}
	if err := db.Create(&canvas).Error; err != nil {
		t.Fatal(err)
	}
	req := agentTestRequest()
	req.PermissionMode = "request_approval"
	root, err := s.CreateCloudAgentRun("user", req, "")
	if err != nil {
		t.Fatal(err)
	}
	doc, err := creationDocument(canvas.PayloadJSON)
	if err != nil {
		t.Fatal(err)
	}
	args, err := json.Marshal(map[string]any{
		"snapshotHash": cloudAgentCanvasHash(doc),
		"ops":          []map[string]any{{"type": "unsupported_canvas_op", "id": "bad-op"}},
	})
	if err != nil {
		t.Fatal(err)
	}
	result, err := json.Marshal(map[string]any{
		"toolCalls": []map[string]any{{
			"id": "write-1", "type": "function", "function": map[string]any{
				"name": "canvas_apply_ops", "arguments": string(args),
			},
		}},
	})
	if err != nil {
		t.Fatal(err)
	}
	var task model.Task
	if err := db.First(&task, "id = ?", root.ID).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Model(&model.Task{}).Where("id = ?", root.ID).Updates(map[string]any{
		"status": model.TaskStatusSucceeded, "result_json": string(result), "input_json": publicTaskInputJSON(task.InputJSON),
	}).Error; err != nil {
		t.Fatal(err)
	}

	if err := s.advanceCloudAgentByID("user", root.ID); err != nil {
		t.Fatal(err)
	}
	if err := s.advanceCloudAgentByID("user", root.ID); err != nil {
		t.Fatal(err)
	}
	failed, err := s.repo.CloudAgent("user", root.ID)
	if err != nil {
		t.Fatal(err)
	}
	state, err := cloudAgentDecode(failed)
	if err != nil {
		t.Fatal(err)
	}
	if failed.Status != "failed" || failed.FailureMessage != "不支持的画布写操作" {
		t.Fatalf("admission failure did not terminate run: status=%q message=%q", failed.Status, failed.FailureMessage)
	}
	if len(state.Events) == 0 || state.Events[len(state.Events)-1].Type != "run_failed" || state.Events[len(state.Events)-1].Payload["reason"] != "tool_admission_failed" {
		t.Fatalf("missing admission failure event: %+v", state.Events)
	}
	eventCount := len(state.Events)
	if err := s.advanceCloudAgentByID("user", root.ID); err != nil {
		t.Fatal(err)
	}
	failedAgain, err := s.repo.CloudAgent("user", root.ID)
	if err != nil {
		t.Fatal(err)
	}
	stateAgain, err := cloudAgentDecode(failedAgain)
	if err != nil || len(stateAgain.Events) != eventCount {
		t.Fatalf("terminal run was replayed: err=%v events=%d want=%d", err, len(stateAgain.Events), eventCount)
	}
}
