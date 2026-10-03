package app

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os/exec"
	"strings"
	"sync"
	"testing"
	"time"

	"gorm.io/gorm"
	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/repository"
)

// A pre-split homepage run has a readable canvas policy, but must not execute it.
func legacyCreationContractFixture(t *testing.T) (*Service, *gorm.DB, string) {
	t.Helper()
	s, db, _, _ := creationTestService(t)
	s.legacyCloudAgentRootTask = false
	run, err := s.CreateCloudAgentRun("user", creationAgentRequest(), "")
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
	canvasReq := state.Request
	canvasReq.Surface = "canvas"
	system, policy, err := compileCloudAgentPolicies(canvasReq, nil, "", state.Profile)
	if err != nil {
		t.Fatal(err)
	}
	state.Policy = policy
	state.Canonical.SystemPrompt = system
	state.Canonical.Tools = compileCloudAgentTools(canvasReq, false)
	for _, message := range state.Canonical.Messages {
		if stringField(message, "role") == "system" {
			message["content"] = system
		}
	}
	if err := s.repo.MutateCloudAgentRun(execution, func(current *model.CloudAgentExecution, _ *repository.Repository) error {
		return cloudAgentSave(current, &state)
	}); err != nil {
		t.Fatal(err)
	}
	task, admitted, err := s.cloudAgentTask("user", run.ID)
	if err != nil {
		t.Fatal(err)
	}
	var input map[string]any
	if err := json.Unmarshal([]byte(task.InputJSON), &input); err != nil {
		t.Fatal(err)
	}
	admitted.Policy = policy
	input["cloudAgent"] = admitted
	input["agentRequests"] = map[string]any{"canonical": state.Canonical}
	input["config"].(map[string]any)["systemPrompt"] = system
	if err := db.Model(&model.Task{}).Where("id = ?", run.ID).Update("input_json", mustMarshal(input)).Error; err != nil {
		t.Fatal(err)
	}
	execution, err = s.repo.CloudAgent("user", run.ID)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := cloudAgentDecodeForExecution(execution); err == nil {
		t.Fatal("fixture must be rejected by execution decoder")
	}
	return s, db, run.ID
}

func TestCreationNativeRejectsLegacyCanvasContract(t *testing.T) {
	if _, err := exec.LookPath("node"); err != nil {
		t.Fatal(err)
	}
	if _, err := agentRuntimeDirForTest(); err != nil {
		t.Fatal(err)
	}
	t.Setenv("CANVAS_ALLOWED_PRIVATE_UPSTREAM_HOSTS", "127.0.0.1")
	t.Setenv("REDIS_URL", "")
	s, db, runID := legacyCreationContractFixture(t)
	var mu sync.Mutex
	var bodies []string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body map[string]any
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Error(err)
			w.WriteHeader(400)
			return
		}
		mu.Lock()
		bodies = append(bodies, mustMarshal(body))
		mu.Unlock()
		writeSSE(w, sseDelta(map[string]any{"content": "old contract incorrectly ran"}))
	}))
	defer server.Close()
	if err := db.Model(&model.ModelChannel{}).Where("id = ?", "channel").Updates(map[string]any{"base_url": server.URL, "api_key": "test-only"}).Error; err != nil {
		t.Fatal(err)
	}
	s = New(s.repo, s.dataDir)
	t.Cleanup(func() { _ = s.Close() })
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	stop := make(chan struct{})
	done := make(chan struct{})
	go func() {
		defer close(done)
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
	err := s.runOwnedCloudAgent(ctx, "user", runID, func(owned context.Context) error { return s.runCloudAgentPiSession(owned, "user", runID) })
	close(stop)
	<-done
	mu.Lock()
	defer mu.Unlock()
	if len(bodies) != 0 {
		t.Fatalf("stale creation contract reached actual native upstream: calls=%d containsCanvasWorkflow=%v containsMemoryTool=%v runnerErr=%v", len(bodies), strings.Contains(bodies[0], "canvas_get_state"), strings.Contains(bodies[0], "recall_lessons"), err)
	}
	if err == nil {
		t.Fatal("stale creation native execution must fail closed")
	}
}

func TestCreationLegacyContinuationKeepsHistoryWithNewContract(t *testing.T) {
	s, db, runID := legacyCreationContractFixture(t)
	if err := db.Model(&model.CloudAgentExecution{}).Where("id = ?", runID).Update("status", "completed").Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Model(&model.Task{}).Where("id = ?", runID).Updates(map[string]any{"status": model.TaskStatusSucceeded, "result_json": `{"text":"OLD_HISTORY_SENTINEL: 先读取画布"}`}).Error; err != nil {
		t.Fatal(err)
	}
	before, err := s.repo.CloudAgent("user", runID)
	if err != nil {
		t.Fatal(err)
	}
	req := creationAgentRequest()
	req.IdempotencyKey = "independent-new-home-contract"
	req.Prompt = "继续刚才的创作，只使用首页能力"
	child, err := s.CreateCloudAgentRun("user", req, runID)
	if err != nil {
		t.Fatal(err)
	}
	row, err := s.repo.CloudAgent("user", child.ID)
	if err != nil {
		t.Fatal(err)
	}
	state, err := cloudAgentDecodeForExecution(row)
	if err != nil {
		t.Fatal(err)
	}
	if state.Policy.SystemPolicyID != "creation-agent-system" || strings.Contains(state.Canonical.SystemPrompt, "canvas_get_state") {
		t.Fatal("new turn still uses old canvas contract")
	}
	if !strings.Contains(mustMarshal(state.TextHistory), "OLD_HISTORY_SENTINEL") {
		t.Fatal("continuation erased old readable history")
	}
	if state.ParentID != runID || state.Request.SessionID != before.SessionID {
		t.Fatal("continuation detached from original session")
	}
	parent, err := s.repo.CloudAgent("user", runID)
	if err != nil {
		t.Fatal(err)
	}
	if parent.StateJSON != before.StateJSON {
		t.Fatal("continuation rewrote frozen historical state")
	}
}

func TestCreationLegacyContractRejectedAtModelAndToolBridges(t *testing.T) {
	for _, entry := range []string{"model", "tool", "direct-tool"} {
		t.Run(entry, func(t *testing.T) {
			s, db, runID := legacyCreationContractFixture(t)
			before, err := s.repo.CloudAgent("user", runID)
			if err != nil {
				t.Fatal(err)
			}
			ctx, cancel := context.WithTimeout(context.Background(), 250*time.Millisecond)
			defer cancel()
			call := cloudAgentStoryboardCall(t, "plan_update", "stale-plan", map[string]any{"items": []any{map[string]any{"id": "stale", "title": "旧合同不应执行", "status": "pending"}}})
			switch entry {
			case "model":
				_, err = s.cloudAgentPiModel(ctx, "user", runID, piEventForTest(t, map[string]any{"stepId": "stale-model", "purpose": "dialogue", "messages": []map[string]any{{"role": "user", "content": "continue"}}}))
			case "tool":
				_, err = s.cloudAgentPiTool(ctx, "user", runID, piEventForTest(t, map[string]any{"callId": call.ID, "name": call.Function.Name, "arguments": json.RawMessage(call.Function.Arguments)}))
			case "direct-tool":
				_, err = s.executeCloudAgentRuntimeTool(ctx, "user", runID, call)
			}
			if err == nil || ctx.Err() != nil {
				t.Errorf("%s did not reject stale execution before work: %v", entry, err)
			}
			var tasks, receipts int64
			if err := db.Model(&model.Task{}).Where("agent_run_id = ?", runID).Count(&tasks).Error; err != nil {
				t.Fatal(err)
			}
			if err := db.Model(&model.CloudAgentReceipt{}).Where("run_id = ?", runID).Count(&receipts).Error; err != nil {
				t.Fatal(err)
			}
			after, err := s.repo.CloudAgent("user", runID)
			if err != nil {
				t.Fatal(err)
			}
			if tasks != 0 || receipts != 0 || after.StateJSON != before.StateJSON {
				t.Fatalf("%s mutated stale execution: tasks=%d receipts=%d", entry, tasks, receipts)
			}
			if _, err := cloudAgentDecode(after); err != nil {
				t.Fatalf("historical read must remain available: %v", err)
			}
		})
	}
}
