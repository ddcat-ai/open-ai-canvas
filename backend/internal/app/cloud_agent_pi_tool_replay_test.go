package app

import "testing"

func TestPiReplayUsesOnlyMatchingCommittedToolResult(t *testing.T) {
	call := cloudAgentCall{ID: "plan-1"}
	call.Function.Name = "plan_update"
	call.Function.Arguments = `{"items":[{"title":"日本站套图"}]}`
	state := cloudAgentRuntime{Calls: []cloudAgentCall{call}, CallIndex: 1, Canonical: canonicalAgentRequest{Messages: []map[string]any{
		{"role": "tool", "tool_call_id": "plan-1", "content": `{"ok":true}`},
	}}}
	content, ok := cloudAgentCommittedToolReplay(&state, call)
	if !ok || content != `{"ok":true}` {
		t.Fatalf("approved tool result was not replayed: %q, %v", content, ok)
	}
	call.Function.Arguments = `{"items":[{"title":"美国站套图"}]}`
	if _, ok := cloudAgentCommittedToolReplay(&state, call); ok {
		t.Fatal("same tool-call ID with changed arguments was accepted")
	}
	call.Function.Arguments = `{"items":[{"title":"日本站套图"}]}`
	state.CallIndex = 0
	if _, ok := cloudAgentCommittedToolReplay(&state, call); ok {
		t.Fatal("unfinished tool call was treated as completed")
	}
	state.CallIndex = 1
	state.Canonical.Messages = nil
	if _, ok := cloudAgentCommittedToolReplay(&state, call); ok {
		t.Fatal("uncommitted tool call was treated as completed")
	}
}
