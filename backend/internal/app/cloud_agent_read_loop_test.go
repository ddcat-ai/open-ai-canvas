package app

import (
	"encoding/json"
	"strings"
	"testing"

	"yingce/backend/internal/model"
)

func TestCloudAgentReadLoopBudgetKeepsPendingCallsAndRunAlive(t *testing.T) {
	for _, batch := range []bool{false, true} {
		name := "single"
		if batch {
			name = "batch"
		}
		t.Run(name, func(t *testing.T) {
			s, db, root := interjectionPiRoot(t)
			run, state := agentInterjectionState(t, s, root.ID)
			read := cloudAgentCall{ID: "read"}
			read.Function.Name, read.Function.Arguments = "canvas_get_state", "{}"
			write := cloudAgentCall{ID: "write"}
			write.Function.Name, write.Function.Arguments = "canvas_apply_ops", "{}"
			state.Calls = []cloudAgentCall{read, write}
			state.CallIndex = 0
			state.ReadToolCalls = cloudAgentMaxReadToolCallsPerRun
			state.Canonical.Messages = append(state.Canonical.Messages, map[string]any{
				"role": "assistant", "tool_calls": state.Calls,
			})
			run.Status = "running"
			interjectionSaveState(t, s, db, run, &state)
			run, state = agentInterjectionState(t, s, root.ID)
			if batch {
				if handled, err := s.advanceCloudAgentReadBatch(run, &state); err != nil || !handled {
					t.Fatalf("read batch: handled=%v err=%v", handled, err)
				}
			} else if err := s.advanceCloudAgentTool(run, &state); err != nil {
				t.Fatal(err)
			}
			run, state = agentInterjectionState(t, s, root.ID)
			if run.Status != "running" || !state.ReadLoopNudge || state.CallIndex != 1 {
				t.Fatalf("guard ended run or consumed pending write: status=%s nudge=%v index=%d", run.Status, state.ReadLoopNudge, state.CallIndex)
			}
			if agentHasEvent(state, "run_failed") || !agentHasEvent(state, "read_loop_guard") {
				t.Fatal("expected soft guard event without run_failed")
			}
			last := state.Canonical.Messages[len(state.Canonical.Messages)-1]
			if last["role"] != "tool" || last["tool_call_id"] != read.ID {
				t.Fatalf("guard interrupted the tool result sequence: %#v", last)
			}
			if _, found := cloudAgentToolMessage(&state, write.ID); found {
				t.Fatal("guard fabricated a result for the pending write")
			}
		})
	}
}

func TestCloudAgentPiReadLoopGuardOnlyFiltersNextConversationRequest(t *testing.T) {
	s, db, root := interjectionPiRoot(t)
	run, state := agentInterjectionState(t, s, root.ID)
	state.ReadLoopNudge, state.ReadLoopToolName, state.ReadLoopCount = true, "canvas_get_state", 4
	run.Status = "running"
	interjectionSaveState(t, s, db, run, &state)

	messages := []map[string]any{{"role": "user", "content": "继续完成任务"}}
	for step := 0; step < 1; step++ {
		result := interjectionModelStep(t, s, db, "user", root.ID, messages, `{"text":"基于已有信息给出回答","toolCalls":[]}`)
		if result["text"] != "基于已有信息给出回答" {
			t.Fatalf("guard blocked assistant response: %#v", result)
		}
		run, state = agentInterjectionState(t, s, root.ID)
		if run.Status != "running" || state.ReadLoopNudge || agentHasEvent(state, "run_failed") {
			t.Fatalf("unexpected post-step state: status=%s nudge=%v", run.Status, state.ReadLoopNudge)
		}
		var task model.Task
		if err := db.First(&task, "id = ?", state.TaskIDs[len(state.TaskIDs)-1]).Error; err != nil {
			t.Fatal(err)
		}
		var input struct {
			AgentRequests struct {
				Canonical canonicalAgentRequest `json:"canonical"`
			} `json:"agentRequests"`
		}
		if err := json.Unmarshal([]byte(task.InputJSON), &input); err != nil {
			t.Fatal(err)
		}
		canonical := input.AgentRequests.Canonical
		hasRead, hasAsk := false, false
		for _, tool := range canonical.Tools {
			fn, _ := tool["function"].(map[string]any)
			name := stringValue(fn["name"])
			hasRead = hasRead || cloudAgentReadToolReadOnly(name) || name == "canvas_inspect_image"
			hasAsk = hasAsk || name == "ask_user"
		}
		if hasRead || !hasAsk {
			t.Fatalf("step %d tool availability: read=%v ask=%v", step, hasRead, hasAsk)
		}
		nudges := 0
		for _, message := range canonical.Messages {
			if strings.Contains(stringField(message, "content"), `"kind":"read_loop"`) {
				nudges++
			}
		}
		wantNudges := 1
		if nudges != wantNudges {
			t.Fatalf("step %d nudge count=%d, want %d", step, nudges, wantNudges)
		}
	}
}
