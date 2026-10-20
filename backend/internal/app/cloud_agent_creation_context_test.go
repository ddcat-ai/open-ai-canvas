package app

import (
	"encoding/json"
	"fmt"
	"strings"
	"testing"

	"yingce/backend/internal/model"
)

func TestCreationVisibleResultUsesOwnedCurrentMessageTasks(t *testing.T) {
	s, db, _ := agentMediaFixture(t)
	for _, task := range []model.Task{
		{ID: "street", UserID: "user", Type: "canvas_image", Status: model.TaskStatusSucceeded, ResultJSON: `{"images":[{"storageKey":"resource:ref-one"}]}`},
		{ID: "foreign-street", UserID: "other", Type: "canvas_image", Status: model.TaskStatusSucceeded},
		{ID: "canvas-street", UserID: "user", ProjectID: "canvas", Type: "canvas_image", Status: model.TaskStatusSucceeded},
		{ID: "unselected-street", UserID: "user", Type: "canvas_image", Status: model.TaskStatusSucceeded},
	} {
		if err := db.Create(&task).Error; err != nil {
			t.Fatal(err)
		}
	}
	req := creationRequestWithDirectContext(t, `[{"messageId":"street-message","role":"assistant","mode":"image","taskIds":["street"]}]`)
	req.SessionID = "session"
	req.LatestVisibleResult = &CloudAgentCreationVisibleResult{MessageID: "street-message", TaskIDs: []string{"street", "street"}}
	facts, err := s.cloudAgentCreationVisibleResult("user", req)
	if err != nil {
		t.Fatal(err)
	}
	tasks := facts["tasks"].([]map[string]any)
	if facts["messageId"] != "street-message" || len(tasks) != 1 || tasks[0]["taskId"] != "street" || !strings.Contains(mustMarshal(tasks[0]), "ref-one") {
		t.Fatalf("visible result lost exact source: %+v", facts)
	}
	for _, id := range []string{"foreign-street", "canvas-street", "unselected-street", "missing"} {
		req.LatestVisibleResult.TaskIDs = []string{id}
		if _, err := s.cloudAgentCreationVisibleResult("user", req); err == nil {
			t.Fatalf("visible position authorized %s", id)
		}
	}
}

func TestCreationVisibleResultRejectsForeignTaskBeforeAdmission(t *testing.T) {
	s, db, _ := agentMediaFixture(t)
	if err := db.Create(&model.Task{ID: "foreign-visible", UserID: "other", Type: "canvas_image", Status: model.TaskStatusSucceeded}).Error; err != nil {
		t.Fatal(err)
	}
	req := creationAgentRequest()
	req.LatestVisibleResult = &CloudAgentCreationVisibleResult{MessageID: "visible", TaskIDs: []string{"foreign-visible"}}
	var before, after int64
	db.Model(&model.Task{}).Count(&before)
	if _, err := s.CreateCloudAgentRun("user", req, ""); err == nil {
		t.Fatal("foreign visible result admitted")
	}
	db.Model(&model.Task{}).Count(&after)
	if before != after {
		t.Fatal("invalid result position created a model task")
	}
}

func TestCreationCatalogueIncludesOrdinaryContextTasks(t *testing.T) {
	s, db, _ := agentMediaFixture(t)
	for _, id := range []string{"ordinary-street", "unselected-output"} {
		if err := db.Create(&model.Task{ID: id, UserID: "user", Type: "canvas_image", Status: model.TaskStatusSucceeded, ResultJSON: `{"images":[{"storageKey":"resource:ref-one"}]}`}).Error; err != nil {
			t.Fatal(err)
		}
	}
	req := creationRequestWithDirectContext(t, `[{"messageId":"street-message","role":"assistant","mode":"image","taskIds":["ordinary-street"]}]`)
	run, err := s.CreateCloudAgentRun("user", req, "")
	if err != nil {
		t.Fatal(err)
	}
	_, state := agentInterjectionState(t, s, run.ID)
	call := cloudAgentCall{}
	call.Function.Arguments = `{}`
	result, err := cloudAgentCreationMediaRead(s.repo, "user", &state, call)
	if err != nil {
		t.Fatal(err)
	}
	raw := mustMarshal(result)
	if !strings.Contains(raw, "ordinary-street") || strings.Contains(raw, "unselected-output") {
		t.Fatalf("catalogue differs from visible conversation: %s", raw)
	}
}

func TestCreationMixedCatalogueKeepsUserSessionAndProjectBoundaries(t *testing.T) {
	s, db, _ := agentMediaFixture(t)
	for _, run := range []model.CloudAgentExecution{
		{ID: "catalogue-current", UserID: "user", SessionID: "session", Surface: "creation"},
		{ID: "catalogue-other", UserID: "user", SessionID: "other-session", Surface: "creation"},
	} {
		if err := db.Create(&run).Error; err != nil {
			t.Fatal(err)
		}
	}
	for _, task := range []model.Task{
		{ID: "ordinary", UserID: "user", Type: "canvas_image"},
		{ID: "current-agent", UserID: "user", Type: "canvas_image", AgentRunID: "catalogue-current"},
		{ID: "other-agent", UserID: "user", Type: "canvas_image", AgentRunID: "catalogue-other"},
		{ID: "foreign", UserID: "other", Type: "canvas_image"},
		{ID: "canvas", UserID: "user", ProjectID: "canvas", Type: "canvas_image"},
		{ID: "text", UserID: "user", Type: "canvas_text"},
		{ID: "unselected", UserID: "user", Type: "canvas_image"},
	} {
		if err := db.Create(&task).Error; err != nil {
			t.Fatal(err)
		}
	}
	ids := []string{"ordinary", "other-agent", "foreign", "canvas", "text"}
	tasks, err := s.repo.CreationMediaTasks("user", "session", "", 0, 20, ids...)
	if err != nil || len(tasks) != 2 || tasks[0].ID != "ordinary" || tasks[1].ID != "current-agent" {
		t.Fatalf("mixed catalogue widened scope: %+v, %v", tasks, err)
	}
	page, err := s.repo.CreationMediaTasks("user", "session", "", 1, 1, ids...)
	if err != nil || len(page) != 1 || page[0].ID != tasks[1].ID {
		t.Fatalf("mixed catalogue pagination changed order: %+v, %v", page, err)
	}
	filtered, err := s.repo.CreationMediaTasks("user", "session", "catalogue-current", 0, 20, ids...)
	if err != nil || len(filtered) != 1 || filtered[0].ID != "current-agent" {
		t.Fatalf("run filter included ordinary tasks: %+v, %v", filtered, err)
	}
}

func creationRequestWithDirectContext(t *testing.T, entries string) CloudAgentRequest {
	t.Helper()
	raw := mustMarshal(creationAgentRequest())
	var fields map[string]json.RawMessage
	if err := json.Unmarshal([]byte(raw), &fields); err != nil {
		t.Fatal(err)
	}
	fields["creationContext"] = json.RawMessage(entries)
	encoded, _ := json.Marshal(fields)
	var req CloudAgentRequest
	if err := json.Unmarshal(encoded, &req); err != nil {
		t.Fatal(err)
	}
	return req
}

func creationContextTaskRead(t *testing.T, s *Service, runID, callID, taskID string) (map[string]any, bool) {
	t.Helper()
	call := cloudAgentCall{ID: callID}
	call.Function.Name, call.Function.Arguments = "task_get", mustMarshal(map[string]any{"taskId": taskID})
	result, err := s.executeCloudAgentRuntimeTool(t.Context(), "user", runID, call)
	if err != nil {
		t.Fatal(err)
	}
	payload := result.(map[string]any)
	var facts map[string]any
	if err := json.Unmarshal([]byte(payload["content"].(string)), &facts); err != nil {
		t.Fatal(err)
	}
	return facts, payload["isError"] == true
}

func TestCreationDirectContextTaskGetRefreshesExplicitTasksOnly(t *testing.T) {
	s, db, _ := agentMediaFixture(t)
	for _, task := range []model.Task{
		{ID: "direct-video", UserID: "user", Type: "canvas_video", Status: model.TaskStatusRunning},
		{ID: "direct-text", UserID: "user", Type: "canvas_text", Status: model.TaskStatusSucceeded, ResultJSON: `{"text":"已完成文案"}`},
		{ID: "unselected", UserID: "user", Type: "canvas_video", Status: model.TaskStatusSucceeded},
		{ID: "foreign", UserID: "other", Type: "canvas_video", Status: model.TaskStatusSucceeded},
	} {
		if err := db.Create(&task).Error; err != nil {
			t.Fatal(err)
		}
	}
	req := creationRequestWithDirectContext(t, `[{"role":"assistant","mode":"video","taskIds":["direct-video"]},{"role":"assistant","mode":"text","taskIds":["direct-text"]}]`)
	run, err := s.CreateCloudAgentRun("user", req, "")
	if err != nil {
		t.Fatal(err)
	}
	first, failed := creationContextTaskRead(t, s, run.ID, "first", "direct-video")
	if failed || first["status"] != "running" {
		t.Fatalf("ordinary task was not readable: %+v", first)
	}
	if err := db.Model(&model.Task{}).Where("id = ?", "direct-video").Updates(map[string]any{"status": model.TaskStatusSucceeded, "result_json": `{"video":{"storageKey":"resource:ref-one"}}`}).Error; err != nil {
		t.Fatal(err)
	}
	latest, failed := creationContextTaskRead(t, s, run.ID, "second", "direct-video")
	if failed || latest["status"] != "succeeded" {
		t.Fatalf("task_get reused admission snapshot: %+v", latest)
	}
	text, failed := creationContextTaskRead(t, s, run.ID, "text", "direct-text")
	if failed || text["text"] != "已完成文案" {
		t.Fatalf("explicit ordinary text task unreadable: %+v", text)
	}
	for _, id := range []string{"unselected", "foreign"} {
		if facts, failed := creationContextTaskRead(t, s, run.ID, id, id); !failed {
			t.Fatalf("unselected task was readable: %+v", facts)
		}
	}
	if err := db.Model(&model.Task{}).Where("id = ?", "direct-video").Update("project_id", "another-canvas").Error; err != nil {
		t.Fatal(err)
	}
	if facts, failed := creationContextTaskRead(t, s, run.ID, "canvas", "direct-video"); !failed {
		t.Fatalf("ordinary context crossed canvas boundary: %+v", facts)
	}
}

func TestCreationDirectContextCarriesSubmissionAndBillingFacts(t *testing.T) {
	s, db, _ := agentMediaFixture(t)
	for _, id := range []string{"known", "unknown", "receipt", "legacy"} {
		task := model.Task{ID: id, UserID: "user", Type: "canvas_image", Status: model.TaskStatusFailed, RouteRun: 1, BillingOrderID: "order-" + id, ExecutionDiagnosticJSON: `{"submissionOutcome":"unknown","retryClass":"reconcile_submission"}`}
		order := model.BillingOrder{ID: task.BillingOrderID, UserID: "user", TaskID: id, IdempotencyKey: id, Status: model.BillingStatusRefunded}
		attempt := model.RouteAttempt{ID: "attempt-" + id, TaskID: id, RouteRun: 1, Status: "failed", DispatchState: "submission_unknown", FailureCode: "upstream_503", FailureMessage: "模型服务暂时不可用（HTTP 503）；上游：No available compatible accounts"}
		if id == "known" || id == "receipt" {
			attempt.DispatchState = "rejected_no_job"
		}
		if id == "unknown" {
			attempt.FailureMessage = "service unavailable"
		}
		if id == "receipt" {
			order.ProviderRequestID = "accepted-receipt"
		}
		for _, row := range []any{&task, &order, &attempt} {
			if err := db.Create(row).Error; err != nil {
				t.Fatal(err)
			}
		}
	}
	req := creationRequestWithDirectContext(t, `[{"role":"assistant","mode":"image","taskIds":["known","unknown","receipt","legacy"]}]`)
	run, err := s.CreateCloudAgentRun("user", req, "")
	if err != nil {
		t.Fatal(err)
	}
	_, state := agentInterjectionState(t, s, run.ID)
	admission := map[string]map[string]any{}
	for _, message := range state.TextHistory {
		var frame struct {
			Source  string `json:"source"`
			Entries []struct {
				Tasks []map[string]any `json:"tasks"`
			} `json:"entries"`
		}
		if json.Unmarshal([]byte(message.Content), &frame) == nil && frame.Source == "creation_mode_history" {
			for _, entry := range frame.Entries {
				for _, task := range entry.Tasks {
					admission[task["taskId"].(string)] = task
				}
			}
		}
	}
	for _, id := range []string{"known", "unknown", "receipt", "legacy"} {
		wantOutcome, wantRetry := "unknown", "reconcile_submission"
		if id == "known" {
			wantOutcome, wantRetry = "rejected", "new_generation_authorization"
		}
		current, _ := creationContextTaskRead(t, s, run.ID, "read-"+id, id)
		if current["taskId"] != id {
			t.Fatalf("task_get rejected context task %s: %+v", id, current)
		}
		for _, facts := range []map[string]any{admission[id], current} {
			billing, _ := facts["billing"].(map[string]any)
			if facts["submissionOutcome"] != wantOutcome || facts["retryClass"] != wantRetry || billing["chargeState"] != "refunded" {
				t.Errorf("%s confused submission with refund: %+v", id, facts)
			}
		}
		stored, err := s.repo.TaskForUser("user", id)
		if err != nil || !strings.Contains(stored.ExecutionDiagnosticJSON, `"unknown"`) {
			t.Fatal("read changed durable diagnostic")
		}
	}
}

func TestCreationDirectContextUsesOwnedTaskTruth(t *testing.T) {
	s, db, _ := agentMediaFixture(t)
	for _, task := range []model.Task{
		{ID: "direct-image", UserID: "user", Type: "canvas_image", Status: model.TaskStatusSucceeded, Prompt: "产品主图", ResultJSON: `{"images":[{"storageKey":"resource:ref-one","url":"https://secret.example/result"}]}`},
		{ID: "direct-video", UserID: "user", Type: "canvas_video", Status: model.TaskStatusRunning, ResultJSON: `{"video":{"storageKey":"resource:ref-two"}}`},
	} {
		if err := db.Create(&task).Error; err != nil {
			t.Fatal(err)
		}
	}
	req := creationRequestWithDirectContext(t, `[{"role":"user","mode":"image","content":"想要暖色风格"},{"role":"assistant","mode":"image","taskIds":["direct-image"]},{"role":"assistant","mode":"video","taskIds":["direct-video"]}]`)
	run, err := s.CreateCloudAgentRun("user", req, "")
	if err != nil {
		t.Fatal(err)
	}
	_, state := agentInterjectionState(t, s, run.ID)
	history := mustMarshal(state.TextHistory)
	for _, want := range []string{"想要暖色风格", "direct-image", "succeeded", "direct-video", "running", "ref-one"} {
		if !strings.Contains(history, want) {
			t.Errorf("context missing %s: %s", want, history)
		}
	}
	if strings.Contains(history, "secret.example") || strings.Contains(history, "ref-two") {
		t.Fatal("untrusted URL or unfinished output leaked")
	}
	if state.Request.Prompt != req.Prompt || state.Request.PermissionMode != "read_only" || state.Request.Budget.MaxCredits != req.Budget.MaxCredits {
		t.Fatal("context changed user instruction or permission/budget")
	}
	call := cloudAgentCall{}
	call.Function.Arguments = `{"taskId":"direct-image","outputIndex":1}`
	if _, err := cloudAgentCreationMediaRead(s.repo, "user", &state, call); err != nil {
		t.Fatalf("owned direct output unreadable: %v", err)
	}
	call.Function.Arguments = `{"taskId":"direct-video","outputIndex":1}`
	if _, err := cloudAgentCreationMediaRead(s.repo, "user", &state, call); err == nil {
		t.Fatal("running task treated as completed output")
	}
	if err := db.Create(&model.Task{ID: "not-selected", UserID: "user", Type: "canvas_image", Status: model.TaskStatusSucceeded, ResultJSON: `{"images":[{"storageKey":"resource:ref-one"}]}`}).Error; err != nil {
		t.Fatal(err)
	}
	call.Function.Arguments = `{"taskId":"not-selected","outputIndex":1}`
	if _, err := cloudAgentCreationMediaRead(s.repo, "user", &state, call); err == nil {
		t.Fatal("unselected same-user direct task was readable")
	}
	if cloudAgentLatestUserInstruction(state.Canonical.Messages) != req.Prompt {
		t.Fatal("history replaced the latest user instruction")
	}
	if _, err := s.CreateCloudAgentRun("user", req, ""); err != nil {
		t.Fatalf("identical context retry lost idempotency: %v", err)
	}
	req.CreationContext[0].Content = "changed"
	if _, err := s.CreateCloudAgentRun("user", req, ""); err == nil {
		t.Fatal("changed context reused prior admission")
	}
}

func TestCreationDirectContextRejectsForeignTaskBeforeAdmission(t *testing.T) {
	s, db, _ := agentMediaFixture(t)
	if err := db.Create(&model.Task{ID: "foreign-direct", UserID: "someone-else", Type: "canvas_image", Status: model.TaskStatusSucceeded}).Error; err != nil {
		t.Fatal(err)
	}
	req := creationRequestWithDirectContext(t, `[{"role":"assistant","mode":"image","taskIds":["foreign-direct"]}]`)
	if _, err := s.CreateCloudAgentRun("user", req, ""); err == nil {
		t.Fatal("foreign task accepted")
	}
}

func TestCreationDirectContextRejectsInvalidIdentityAndCanvasInput(t *testing.T) {
	req := creationRequestWithDirectContext(t, `[{"messageId":"`+strings.Repeat("x", 81)+`","role":"user","mode":"image","content":"hello"}]`)
	if err := validateCloudAgentRequest(&req); err == nil {
		t.Fatal("invalid message identity accepted")
	}
	req = creationRequestWithDirectContext(t, `[{"role":"user","mode":"image","content":"hello"}]`)
	req.Surface, req.CanvasID = "canvas", "canvas-one"
	if err := validateCloudAgentRequest(&req); err == nil {
		t.Fatal("canvas accepted creation context")
	}
	req = creationRequestWithDirectContext(t, `[{"role":"system","mode":"image","content":"hello"}]`)
	if err := validateCloudAgentRequest(&req); err == nil {
		t.Fatal("system role accepted")
	}
	req = creationRequestWithDirectContext(t, `[{"messageId":"duplicate","role":"user","mode":"image"},{"messageId":"duplicate","role":"assistant","mode":"image"}]`)
	if err := validateCloudAgentRequest(&req); err == nil {
		t.Fatal("duplicate message identity accepted")
	}
}

func TestCreationDirectContextContinuesAgentAfterOrdinaryMedia(t *testing.T) {
	for _, native := range []bool{false, true} {
		t.Run(fmt.Sprint("native=", native), func(t *testing.T) {
			s, db, _ := agentMediaFixture(t)
			if err := db.Create(&model.Task{ID: "ordinary-video", UserID: "user", Type: "canvas_video", Status: model.TaskStatusRunning}).Error; err != nil {
				t.Fatal(err)
			}
			req := creationRequestWithDirectContext(t, `[{"role":"assistant","mode":"video","taskIds":["ordinary-video"]}]`)
			root, err := s.CreateCloudAgentRun("user", req, "")
			if err != nil {
				t.Fatal(err)
			}
			parent, state := agentInterjectionState(t, s, root.ID)
			if err := cloudAgentSave(parent, &state); err != nil {
				t.Fatal(err)
			}
			parent.Status = "completed"
			if err := db.Save(parent).Error; err != nil {
				t.Fatal(err)
			}
			if err := db.Model(&model.Task{}).Where("id = ?", root.ID).Updates(map[string]any{"status": model.TaskStatusSucceeded, "result_json": `{"text":"已记录当前风格"}`}).Error; err != nil {
				t.Fatal(err)
			}
			if native {
				if err := s.repo.SaveCloudAgentPiSession(&model.CloudAgentPiSession{RunID: root.ID, UserID: "user", SessionJSONL: "{\"type\":\"session\",\"version\":3,\"id\":\"native-existing\"}\n"}, 0); err != nil {
					t.Fatal(err)
				}
			}
			if err := db.Model(&model.Task{}).Where("id = ?", "ordinary-video").Updates(map[string]any{"status": model.TaskStatusSucceeded, "result_json": `{"video":{"storageKey":"resource:ref-one"}}`}).Error; err != nil {
				t.Fatal(err)
			}
			next := creationRequestWithDirectContext(t, `[{"role":"user","mode":"image","content":"普通模式生成后继续讨论"},{"role":"assistant","mode":"video","taskIds":["ordinary-video"]}]`)
			next.Prompt, next.IdempotencyKey, next.SessionID = "沿用这段视频里的风格", "direct-context-followup", root.SessionID
			child, err := s.CreateCloudAgentRun("user", next, root.ID)
			if err != nil {
				t.Fatal(err)
			}
			_, current := agentInterjectionState(t, s, child.ID)
			history := mustMarshal(current.TextHistory)
			if strings.Count(history, "creation_mode_history") != 1 || !strings.Contains(history, "普通模式生成后继续讨论") || !strings.Contains(history, "succeeded") || strings.Contains(history, `\"status\":\"running\"`) {
				t.Fatalf("stale or missing mode context: %s", history)
			}
			if cloudAgentLatestUserInstruction(current.Canonical.Messages) != next.Prompt || child.ParentID != root.ID || current.Request.Budget.MaxCredits != next.Budget.MaxCredits {
				t.Fatal("conversation, goal or budget continuity broken")
			}
		})
	}
}

func TestCreationDirectContextPreservesServerFactsAndRejectsCanvasTask(t *testing.T) {
	s, db, _ := agentMediaFixture(t)
	req := creationAgentRequest()
	for i := 0; i < 32; i++ {
		id := fmt.Sprintf("large-context-%d", i)
		if err := db.Create(&model.Task{ID: id, UserID: "user", Type: "canvas_image", Status: model.TaskStatusFailed, Prompt: strings.Repeat("大", 1200), Error: strings.Repeat("错", 500)}).Error; err != nil {
			t.Fatal(err)
		}
		if i%2 == 0 {
			req.CreationContext = append(req.CreationContext, CloudAgentCreationContextEntry{Role: "assistant", Mode: "image"})
		}
		entry := &req.CreationContext[len(req.CreationContext)-1]
		entry.TaskIDs = append(entry.TaskIDs, id)
	}
	facts, err := s.cloudAgentCreationContext("user", req)
	if err != nil || len(facts) <= 64<<10 || !strings.Contains(facts, "large-context-0") || !strings.Contains(facts, "large-context-31") || strings.Contains(facts, "olderEntriesTruncated") {
		t.Fatalf("initial owned facts were silently truncated: len=%d err=%v", len(facts), err)
	}
	if err := db.Model(&model.Task{}).Where("id = ?", "large-context-31").Update("project_id", "canvas-other").Error; err != nil {
		t.Fatal(err)
	}
	if _, err := s.cloudAgentCreationContext("user", req); err == nil {
		t.Fatal("canvas task accepted as ordinary home task")
	}
}
