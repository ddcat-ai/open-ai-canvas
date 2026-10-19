package app

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"gorm.io/gorm"
	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"
)

func installCreationParallelImageModel(t *testing.T, db *gorm.DB) {
	t.Helper()
	capability := DefaultModelCapabilityConfigForModel(string(model.ChannelInterfaceOpenAIImage), "image-test")
	for _, row := range []any{
		&model.ChannelModel{ID: "parallel-image-cm", ChannelID: "channel", ModelKey: "image-test", Capability: "image", Protocol: model.ChannelInterfaceOpenAIImage, CapabilityConfigJSON: mustEncodeModelCapabilityConfig(t, capability), BillingMode: "fixed_request", PriceConfigured: true, Enabled: true},
		&model.ChannelModelPriceTier{ID: "parallel-image-tier", ChannelModelID: "parallel-image-cm", SelectorKey: "{}", SelectorJSON: "{}", BillingMode: "fixed_request", UnitPriceMicrocredits: 1, PriceConfigured: true, Enabled: true},
	} {
		if err := db.Create(row).Error; err != nil {
			t.Fatal(err)
		}
	}
}

func creationParallelImageFixture(t *testing.T, permission string) (*Service, *gorm.DB, string, []cloudAgentCall) {
	t.Helper()
	s, db, _ := agentMediaFixture(t)
	installCreationParallelImageModel(t, db)
	req := creationAgentRequest()
	req.PermissionMode, req.IdempotencyKey = permission, "parallel-images-"+permission
	req.Budget.MaxCredits, req.Budget.MaxGenerationTasks = 10, 3
	req.MediaSettings = &CloudAgentCreationMedia{Image: &CloudAgentCreationMediaChoice{Selection: CloudAgentMediaModelSelection{ChannelID: "channel", ChannelModelKey: "image-test"}, ParameterMode: "manual", Size: "1024x1024", Count: 4}}
	root, err := s.CreateCloudAgentRun("user", req, "")
	if err != nil {
		t.Fatal(err)
	}
	calls := make([]cloudAgentCall, 3)
	for i := range calls {
		calls[i] = agentMediaCall(cloudAgentMediaArgs{Mode: "image", Prompt: fmt.Sprintf("Independent landscape %d", i+1), Title: fmt.Sprintf("Image %d", i+1)})
		calls[i].ID = fmt.Sprintf("parallel-image-%d", i+1)
	}
	run, state := agentInterjectionState(t, s, root.ID)
	state.ActiveTaskID, state.Calls, state.CallIndex = "", nil, 0
	state.PiModelCalls = calls
	if err := s.repo.MutateCloudAgentRun(run, func(current *model.CloudAgentExecution, _ *repository.Repository) error {
		return cloudAgentSave(current, &state)
	}); err != nil {
		t.Fatal(err)
	}
	return s, db, root.ID, calls
}

func TestCreationImageGroupStopKeepsAdmittedImages(t *testing.T) {
	s, db, runID, calls := creationParallelImageFixture(t, "auto")
	if _, err := s.executeCloudAgentRuntimeTool(context.Background(), "user", runID, calls[0]); err != nil {
		t.Fatal(err)
	}
	if err := s.CancelCloudAgent(context.Background(), "user", runID); err != nil {
		t.Fatal(err)
	}
	var tasks []model.Task
	if err := db.Where("agent_run_id = ? AND type = ?", runID, "canvas_image").Find(&tasks).Error; err != nil {
		t.Fatal(err)
	}
	if len(tasks) != 1 || tasks[0].Status != model.TaskStatusQueued || tasks[0].BillingOrderID == "" {
		t.Fatalf("stopping orchestration cancelled or lost its admitted image: %+v", tasks)
	}
	if _, err := s.executeCloudAgentRuntimeTool(context.Background(), "user", runID, calls[1]); err == nil {
		t.Fatal("stopped run submitted an undeclared follow-up image")
	}
	if err := db.Model(&model.Task{}).Where("id = ?", tasks[0].ID).Updates(map[string]any{"status": model.TaskStatusSucceeded, "result_json": `{"images":[]}`}).Error; err != nil {
		t.Fatal(err)
	}
	stored, err := s.CloudAgentRun("user", runID)
	if err != nil || stored.Status != "cancelled" {
		t.Fatalf("completed image revived the stopped orchestrator: %+v %v", stored, err)
	}
}

func TestCreationImageGroupAdmitsOnlyApprovedCalls(t *testing.T) {
	s, db, runID, calls := creationParallelImageFixture(t, "request_approval")
	run, state := agentInterjectionState(t, s, runID)
	state.Calls, state.CallIndex = calls, 0
	state.Canonical.Messages = append(state.Canonical.Messages, map[string]any{"role": "assistant", "tool_calls": calls})
	if err := s.repo.MutateCloudAgentRun(run, func(current *model.CloudAgentExecution, _ *repository.Repository) error {
		return cloudAgentSave(current, &state)
	}); err != nil {
		t.Fatal(err)
	}
	run, state = agentInterjectionState(t, s, runID)
	if err := s.advanceCloudAgentTool(run, &state); err != nil {
		t.Fatal(err)
	}
	for index, call := range calls[:2] {
		waiting, current := agentInterjectionState(t, s, runID)
		if waiting.Status != "waiting_approval" || current.Approval == nil || current.Approval.Call.ID != call.ID {
			t.Fatalf("image skipped its required approval: status=%s approval=%+v", waiting.Status, current.Approval)
		}
		var count int64
		db.Model(&model.Task{}).Where("agent_run_id = ? AND type = ?", runID, "canvas_image").Count(&count)
		if count != int64(index) {
			t.Fatalf("unapproved image was submitted: %d", count)
		}
		if err := s.DecideCloudAgentApproval("user", runID, current.Approval.ID, "approve", ""); err != nil {
			t.Fatal(err)
		}
		db.Model(&model.Task{}).Where("agent_run_id = ? AND type = ?", runID, "canvas_image").Count(&count)
		if count != int64(index+1) {
			t.Fatalf("approval did not admit exactly its own item: %d", count)
		}
	}
}

func TestCreationNativePiImageCallsReachUpstreamTogether(t *testing.T) {
	testCreationNativePiImageCallsReachUpstreamTogether(t, false)
}

func TestCreationNativePiImageBatchReachesUpstreamTogether(t *testing.T) {
	testCreationNativePiImageCallsReachUpstreamTogether(t, true)
}

func testCreationNativePiImageCallsReachUpstreamTogether(t *testing.T, batch bool) {
	t.Helper()
	t.Setenv("CANVAS_ALLOWED_PRIVATE_UPSTREAM_HOSTS", "127.0.0.1")
	t.Setenv("REDIS_URL", "")
	s, db, pixels := cloudAgentVisionFixture(t)
	installCreationParallelImageModel(t, db)
	entered := make(chan struct{}, 3)
	release := make(chan struct{})
	var releaseOnce sync.Once
	unblock := func() { releaseOnce.Do(func() { close(release) }) }
	defer unblock()
	var mu sync.Mutex
	modelCalls, imageCalls := 0, 0
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body map[string]any
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Error(err)
			w.WriteHeader(http.StatusBadRequest)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		if strings.HasSuffix(r.URL.Path, "/images/generations") {
			mu.Lock()
			imageCalls++
			mu.Unlock()
			if body["n"] != float64(1) {
				t.Errorf("independent image request did not use n=1: n=%v", body["n"])
			}
			entered <- struct{}{}
			<-release
			_ = json.NewEncoder(w).Encode(map[string]any{"data": []any{map[string]any{"b64_json": base64.StdEncoding.EncodeToString(pixels)}}})
			return
		}
		mu.Lock()
		modelCalls++
		step := modelCalls
		mu.Unlock()
		message := map[string]any{"content": "三张独立图片已全部完成。"}
		if step == 1 {
			var calls []any
			var items []map[string]any
			for i := 1; i <= 3; i++ {
				calls = append(calls, map[string]any{"id": fmt.Sprintf("native-image-%d", i), "type": "function", "function": map[string]any{"name": "generate_media", "arguments": mustMarshal(map[string]any{"mode": "image", "prompt": fmt.Sprintf("Independent landscape %d", i), "title": fmt.Sprintf("Image %d", i)})}})
				items = append(items, map[string]any{"id": fmt.Sprint(i), "prompt": fmt.Sprintf("Independent landscape %d", i), "title": fmt.Sprintf("Image %d", i)})
			}
			if batch {
				calls = []any{map[string]any{"id": "native-batch", "type": "function", "function": map[string]any{"name": "generate_image_batch", "arguments": mustMarshal(map[string]any{"items": items})}}}
			}
			message = map[string]any{"content": "生成三个彼此独立的画面。", "tool_calls": calls}
		} else if step == 2 {
			pending := map[string]bool{}
			for _, message := range creationMaps(body["messages"]) {
				for _, call := range creationMaps(message["tool_calls"]) {
					pending[stringField(call, "id")] = true
				}
				if message["role"] == "tool" {
					delete(pending, stringField(message, "tool_call_id"))
				}
			}
			if len(pending) != 0 || !strings.Contains(mustMarshal(body["messages"]), "batchResults") {
				t.Error("native model resumed without paired tool results and complete image-group statuses")
			}
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"choices": []any{map[string]any{"message": message}}})
	}))
	t.Cleanup(upstream.Close)
	if err := db.Model(&model.ModelChannel{}).Where("id = ?", "channel").Updates(map[string]any{"base_url": upstream.URL, "api_key": "test-only"}).Error; err != nil {
		t.Fatal(err)
	}
	s = New(s.repo, s.dataDir)
	t.Cleanup(func() { _ = s.Close() })
	stop := make(chan struct{})
	var workers sync.WaitGroup
	for i := 0; i < 4; i++ {
		workers.Add(1)
		go func() {
			defer workers.Done()
			for {
				select {
				case <-stop:
					return
				default:
				}
				_ = s.ProcessNextTask()
				time.Sleep(10 * time.Millisecond)
			}
		}()
	}
	t.Cleanup(func() { unblock(); close(stop); workers.Wait() })
	req := creationAgentRequest()
	req.PermissionMode, req.IdempotencyKey, req.Prompt = "auto", "native-independent-images", "分别生成三张独立风景图片"
	req.Budget.MaxCredits, req.Budget.MaxGenerationTasks = 10, 3
	req.MediaSettings = &CloudAgentCreationMedia{Image: &CloudAgentCreationMediaChoice{Selection: CloudAgentMediaModelSelection{ChannelID: "channel", ChannelModelKey: "image-test"}, ParameterMode: "manual", Size: "1024x1024", Count: 4}}
	run, err := s.CreateCloudAgentRun("user", req, "")
	if err != nil {
		t.Fatal(err)
	}
	deadline := time.After(12 * time.Second)
	for i := 0; i < 3; i++ {
		select {
		case <-entered:
		case <-deadline:
			stored, state := agentInterjectionState(t, s, run.ID)
			mu.Lock()
			steps := modelCalls
			mu.Unlock()
			t.Fatalf("only %d/3 image requests reached upstream while responses were blocked: status=%s error=%s modelCalls=%d calls=%+v pending=%v", i, stored.Status, stored.FailureMessage, steps, state.Calls, state.CreationPendingImages)
		}
	}
	unblock()
	terminal := waitLiveAgentTerminal(t, s, run.ID)
	mu.Lock()
	defer mu.Unlock()
	if terminal.Status != "completed" || modelCalls != 2 || imageCalls != 3 {
		t.Fatalf("native group did not finish exactly once: status=%s error=%s model=%d images=%d", terminal.Status, terminal.FailureMessage, modelCalls, imageCalls)
	}
}

func TestCreationImageGroupSubmitsBeforeAnyImageCompletes(t *testing.T) {
	s, db, runID, calls := creationParallelImageFixture(t, "auto")
	for _, call := range calls[:2] {
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		result, err := s.executeCloudAgentRuntimeTool(ctx, "user", runID, call)
		cancel()
		if err != nil || result.(map[string]any)["isError"] == true {
			t.Fatalf("independent image waited for generation before admitting its sibling: result=%+v err=%v", result, err)
		}
		if replay, err := s.executeCloudAgentRuntimeTool(context.Background(), "user", runID, call); err != nil || mustMarshal(replay) != mustMarshal(result) {
			t.Fatalf("submitted image did not replay its exact receipt: %+v %v", replay, err)
		}
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	done := make(chan error, 1)
	go func() {
		_, err := s.executeCloudAgentRuntimeTool(ctx, "user", runID, calls[2])
		done <- err
	}()
	var tasks []model.Task
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		if err := db.Where("agent_run_id = ? AND type = ?", runID, "canvas_image").Order("created_at").Find(&tasks).Error; err != nil {
			t.Fatal(err)
		}
		if len(tasks) == 3 {
			break
		}
		time.Sleep(10 * time.Millisecond)
	}
	if len(tasks) != 3 {
		t.Fatalf("expected all 3 independent image tasks before completion, got %d", len(tasks))
	}
	for _, task := range tasks {
		if task.Status != model.TaskStatusQueued || !strings.Contains(task.InputJSON, `"count":"1"`) {
			t.Fatalf("group item was not a separate queued n=1 task: %s %s", task.Status, task.InputJSON)
		}
	}
	if err := db.Model(&model.Task{}).Where("id = ?", tasks[2].ID).Updates(map[string]any{"status": model.TaskStatusSucceeded, "result_json": `{"images":[]}`}).Error; err != nil {
		t.Fatal(err)
	}
	select {
	case err := <-done:
		t.Fatalf("last image closed the group while earlier images were pending: %v", err)
	case <-time.After(100 * time.Millisecond):
	}
	if err := db.Model(&model.Task{}).Where("id = ?", tasks[0].ID).Updates(map[string]any{"status": model.TaskStatusFailed, "error": "mock image failure"}).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Model(&model.Task{}).Where("id = ?", tasks[1].ID).Updates(map[string]any{"status": model.TaskStatusSucceeded, "result_json": `{"images":[]}`}).Error; err != nil {
		t.Fatal(err)
	}
	if err := <-done; err != nil {
		t.Fatal(err)
	}
	_, state := agentInterjectionState(t, s, runID)
	completed := map[string]bool{}
	for _, event := range state.Events {
		if event.Type == "generation_task_completed" {
			completed[stringField(event.Payload, "taskId")] = true
		}
	}
	if len(completed) != 3 || state.Generations != 3 || state.MediaTaskID != "" {
		t.Fatalf("group completion was lost or counted twice: events=%v generations=%d media=%q", completed, state.Generations, state.MediaTaskID)
	}
	receipt, err := s.repo.CloudAgentReceipt("user", runID, "tool", calls[2].ID)
	if err != nil || receipt.TaskID != tasks[2].ID || !strings.Contains(receipt.Content, "batchResults") || !strings.Contains(receipt.Content, string(model.TaskStatusFailed)) || !strings.Contains(receipt.Content, tasks[0].ID) {
		t.Fatalf("failed sibling was lost from the exact final receipt: %+v %v", receipt, err)
	}
	var taskCount, billedCount int64
	db.Model(&model.Task{}).Where("agent_run_id = ? AND type = ?", runID, "canvas_image").Count(&taskCount)
	db.Model(&model.BillingOrder{}).Where("task_id IN ?", []string{tasks[0].ID, tasks[1].ID, tasks[2].ID}).Count(&billedCount)
	if taskCount != 3 || billedCount != 3 {
		t.Fatalf("replayed image duplicated a task or charge: tasks=%d orders=%d", taskCount, billedCount)
	}
}

func TestCreationVisualSkillReadEnablesSetSubmissionWithoutEagerSkillLoading(t *testing.T) {
	req := creationAgentRequest()
	req.PermissionMode = "auto"
	state := cloudAgentRuntime{Request: req, Skills: []cloudAgentSkill{{ID: "commerce-visual-design", Version: "test-full-skill", Surfaces: []string{"creation"}, Instruction: "Full visual design method"}}}
	tools := compileCloudAgentTools(req, false)
	if strings.Contains(mustMarshal(cloudAgentCreationModelTools(&state, tools)), "commerce_plan_submit") {
		t.Fatal("ordinary creation eagerly exposed commerce workflow")
	}
	call := cloudAgentCall{ID: "choose-visual-method"}
	call.Function.Name, call.Function.Arguments = "skill_read_file", `{"skillId":"commerce-visual-design","path":"SKILL.md"}`
	result, err := cloudAgentReadTool(nil, "user", &state, call)
	if err != nil || !strings.Contains(mustMarshal(result), "Full visual design method") {
		t.Fatalf("complete visual skill was not read: %+v %v", result, err)
	}
	if !strings.Contains(mustMarshal(cloudAgentCreationModelTools(&state, tools)), "commerce_plan_submit") {
		t.Fatal("model explicitly chose product visual design but set submission remained hidden")
	}
}
