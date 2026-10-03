package app

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
	"time"

	"infinite-canvas/backend/internal/model"
)

func TestPiModelConfigUsesManagedCapabilityBudget(t *testing.T) {
	s, db, _, _ := creationTestService(t)
	capability := DefaultModelCapabilityConfigForModel(string(model.ChannelInterfaceChatCompletion), "text-test")
	capability.Text.ContextWindowTokens = 65536
	capability.Text.MaxOutputTokens = 4096
	if err := db.Model(&model.ChannelModel{}).Where("id = ?", "cm").Update("capability_config_json", mustEncodeModelCapabilityConfig(t, capability)).Error; err != nil {
		t.Fatal(err)
	}
	config := s.buildModelConfig("text-test", &cloudAgentRuntime{Request: agentTestRequest()})
	if config["contextWindow"] != 65536 || config["maxTokens"] != 4096 {
		t.Fatalf("Pi ignored managed capability: %#v", config)
	}
}

func TestPiCreationRequestDoesNotInventCanvas(t *testing.T) {
	s, _, _, _ := creationTestService(t)
	state := &cloudAgentRuntime{Request: agentTestRequest()}
	state.Request.Surface, state.Request.CanvasID = "creation", ""
	state.CommercePlan = &cloudAgentCommercePlan{PlanID: "locked-commerce", Site: "DE", Language: "de-DE", StyleBible: "approved-product-style"}
	canonical := canonicalAgentRequest{Messages: []map[string]any{{"role": "user", "content": "hello"}}}
	request, err := s.buildEnhancedPiRequest(context.Background(), EnhancedPiRequestParams{UserID: "user", RunID: "creation-test", ModelID: "text-test", RuntimeState: state, Canonical: &canonical})
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(request.TurnContext, "approved-product-style") || !strings.Contains(request.TurnContext, "de-DE") {
		t.Fatal("server commerce facts missing from native turn context")
	}
	if request.Canvas != nil || request.Permissions["canWriteCanvas"] != false {
		t.Fatalf("creation received canvas: %#v", request)
	}
	reserve, _ := request.Compaction["reserveTokens"].(int)
	budget := s.cloudAgentContextBudgetForRequest(state.Request)
	if reserve != budget.ContextWindowTokens-budget.CompactAtTokens {
		t.Fatalf("Pi threshold diverged: %#v budget=%#v", request.Compaction, budget)
	}
	if _, ok := request.Compaction["keepRecentTokens"].(int); !ok {
		t.Fatal("native Pi keepRecentTokens must be explicit")
	}
}

func piEventForTest(t *testing.T, value map[string]any) map[string]json.RawMessage {
	t.Helper()
	raw, err := json.Marshal(value)
	if err != nil {
		t.Fatal(err)
	}
	var result map[string]json.RawMessage
	if err := json.Unmarshal(raw, &result); err != nil {
		t.Fatal(err)
	}
	return result
}

func TestPiCompactionCompletionPersistsSnapshotBeforeDurableEvent(t *testing.T) {
	s, _, a := agentMediaFixture(t)
	run, _ := agentMediaRun(t, s, a, "auto")
	payload := piEventForTest(t, map[string]any{"type": "compaction_start", "reason": "threshold", "keepRecentTokens": 16000})
	if _, err := s.cloudAgentPiEvent(context.Background(), "user", run.ID, payload); err != nil {
		t.Fatal(err)
	}
	latest, _ := s.repo.CloudAgent("user", run.ID)
	state, _ := cloudAgentDecode(latest)
	if len(state.Events) == 0 || state.Events[len(state.Events)-1].Type != "context_compaction_requested" {
		t.Fatalf("start was not durable: %#v", state.Events)
	}
	// A result without its native snapshot is not successful persistence.
	payload = piEventForTest(t, map[string]any{"type": "compaction_end", "result": map[string]any{"summary": "product facts"}})
	if _, err := s.cloudAgentPiEvent(context.Background(), "user", run.ID, payload); err == nil {
		t.Fatal("completion without snapshot must be rejected")
	}
	snapshot := strings.Join([]string{`{"type":"session","id":"test","version":3}`, `{"type":"compaction","id":"compact-1","summary":"product facts","firstKeptEntryId":"last","tokensBefore":50000}`}, "\n") + "\n"
	payload = piEventForTest(t, map[string]any{"type": "compaction_end", "reason": "threshold", "sessionJSONL": snapshot, "result": map[string]any{"summary": "product facts", "firstKeptEntryId": "last", "tokensBefore": 50000, "estimatedTokensAfter": 4000}})
	if _, err := s.cloudAgentPiEvent(context.Background(), "user", run.ID, payload); err != nil {
		t.Fatal(err)
	}
	saved, err := s.repo.CloudAgentPiSession("user", run.ID)
	if err != nil || saved.SessionJSONL != snapshot {
		t.Fatalf("snapshot not saved: %v", err)
	}
	latest, _ = s.repo.CloudAgent("user", run.ID)
	state, _ = cloudAgentDecode(latest)
	if state.Events[len(state.Events)-1].Type != "context_compacted" {
		t.Fatalf("completion event absent: %#v", state.Events)
	}
	before := len(state.Events)
	if _, err := s.cloudAgentPiEvent(context.Background(), "user", run.ID, payload); err != nil {
		t.Fatal(err)
	}
	latest, _ = s.repo.CloudAgent("user", run.ID)
	state, _ = cloudAgentDecode(latest)
	if len(state.Events) != before {
		t.Fatal("replayed compaction completion duplicated the event")
	}
}

func TestPiCompactionFailureIsNotReportedAsSuccess(t *testing.T) {
	s, _, a := agentMediaFixture(t)
	run, _ := agentMediaRun(t, s, a, "auto")
	payload := piEventForTest(t, map[string]any{"type": "compaction_end", "reason": "threshold", "aborted": false, "errorMessage": "summary unavailable"})
	if _, err := s.cloudAgentPiEvent(context.Background(), "user", run.ID, payload); err != nil {
		t.Fatal(err)
	}
	latest, _ := s.repo.CloudAgent("user", run.ID)
	state, _ := cloudAgentDecode(latest)
	if len(state.Events) == 0 || state.Events[len(state.Events)-1].Type != "context_compaction_failed" {
		t.Fatalf("failure event absent: %#v", state.Events)
	}
}

func TestPiModelBridgeForwardsOnlyProviderReportedUsage(t *testing.T) {
	for _, measured := range []bool{false, true} {
		t.Run(map[bool]string{false: "unknown", true: "reported"}[measured], func(t *testing.T) {
			s, db, a := agentMediaFixture(t)
			run, _ := agentMediaRun(t, s, a, "auto")
			ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			defer cancel()
			type outcome struct {
				value any
				err   error
			}
			done := make(chan outcome, 1)
			go func() {
				v, _, err := s.runCloudAgentModelStep(ctx, "user", run.ID, []map[string]any{{"role": "user", "content": "hello"}}, "off")
				done <- outcome{v, err}
			}()
			var taskID string
			for ctx.Err() == nil {
				latest, _ := s.repo.CloudAgent("user", run.ID)
				st, _ := cloudAgentDecode(latest)
				taskID = st.ActiveTaskID
				if taskID != "" {
					break
				}
				time.Sleep(10 * time.Millisecond)
			}
			if taskID == "" {
				t.Fatal("model task not enqueued")
			}
			if measured {
				if err := db.Create(&model.ApiCallLog{ID: "pi-usage-" + taskID, UserID: "user", TaskID: taskID, Capability: "text", Status: model.ApiCallStatusSucceeded, InputTokens: 1200, OutputTokens: 100, CachedTokens: 200, UsageAvailable: true}).Error; err != nil {
					t.Fatal(err)
				}
			}
			if err := db.Model(&model.Task{}).Where("id = ?", taskID).Updates(map[string]any{"status": model.TaskStatusSucceeded, "result_json": `{"text":"hello"}`, "input_json": `{"mode":"text"}`}).Error; err != nil {
				t.Fatal(err)
			}
			result := <-done
			if result.err != nil {
				t.Fatal(result.err)
			}
			value := result.value.(map[string]any)
			usage, exists := value["usage"]
			if measured {
				latest, _ := s.repo.CloudAgent("user", run.ID)
				finished, _ := cloudAgentDecode(latest)
				found := false
				for _, event := range finished.Events {
					if event.Type == "context_pressure" && event.Payload["phase"] == "after_response" {
						found = true
					}
				}
				if !found {
					t.Fatal("provider measurement was not published after the worker scrubbed its task input")
				}
			}
			if measured && (!exists || usage == nil) {
				t.Fatalf("provider usage lost at Pi bridge: %#v", value)
			}
			if !measured && usage != nil {
				t.Fatalf("missing provider usage must not be fabricated: %#v", value)
			}
		})
	}
}

func TestPiSummaryUsesNativePromptWithoutReplacingDialogueHistory(t *testing.T) {
	s, db, a := agentMediaFixture(t)
	run, _ := agentMediaRun(t, s, a, "auto")
	beforeRun, _ := s.repo.CloudAgent("user", run.ID)
	before, _ := cloudAgentDecode(beforeRun)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	ctx = context.WithValue(ctx, cloudAgentPiModelContextKey{}, cloudAgentPiModelContext{Purpose: "compaction", SystemPrompt: "native summary instruction"})
	done := make(chan error, 1)
	go func() {
		_, _, err := s.runCloudAgentModelStep(ctx, "user", run.ID, []map[string]any{{"role": "user", "content": "condense history"}}, "off")
		done <- err
	}()
	var task model.Task
	for ctx.Err() == nil {
		db.Where("agent_run_id = ? AND operation = ?", run.ID, cloudAgentContextCompactionOperation).Limit(1).Find(&task)
		if task.ID != "" {
			break
		}
		time.Sleep(10 * time.Millisecond)
	}
	if task.ID == "" {
		t.Fatal("summary task absent")
	}
	var input map[string]any
	_ = json.Unmarshal([]byte(task.InputJSON), &input)
	canonical, ok := canonicalAgentRequestFromInput(input)
	if !ok || canonical.SystemPrompt != "native summary instruction" || len(canonical.Tools) != 0 {
		t.Fatalf("wrong summary envelope: %#v", canonical)
	}
	if err := db.Model(&model.Task{}).Where("id = ?", task.ID).Updates(map[string]any{"status": model.TaskStatusSucceeded, "result_json": `{"text":"private context summary"}`}).Error; err != nil {
		t.Fatal(err)
	}
	if err := <-done; err != nil {
		t.Fatal(err)
	}
	latest, _ := s.repo.CloudAgent("user", run.ID)
	state, _ := cloudAgentDecode(latest)
	if len(state.Canonical.Messages) != len(before.Canonical.Messages) {
		t.Fatal("summary replaced canonical dialogue")
	}
	for _, event := range state.Events {
		if event.Type == "assistant_message" && event.Payload["text"] == "private context summary" {
			t.Fatal("summary leaked as assistant answer")
		}
	}
	if state.Step != before.Step {
		t.Fatalf("summary consumed normal step: %d -> %d", before.Step, state.Step)
	}
}

func TestPiPendingNativeCompactionIsNotSettled(t *testing.T) {
	state := &cloudAgentRuntime{PiAssistantResponses: 1}
	snapshot := `{"type":"message","message":{"role":"assistant","stopReason":"stop","content":[{"type":"text","text":"answer"}]}}` + "\n" + `{"type":"custom","customType":"canvas-model-step","data":{"purpose":"compaction"}}` + "\n"
	if cloudAgentPiTurnSettled(snapshot, state) {
		t.Fatal("summary checkpoint without its compaction result is not settled")
	}
	snapshot += `{"type":"compaction","id":"completed","summary":"facts"}` + "\n"
	if !cloudAgentPiTurnSettled(snapshot, state) {
		t.Fatal("persisted native compaction should allow completed answer to settle")
	}
}
