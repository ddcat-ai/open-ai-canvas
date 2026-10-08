package app

import (
	"context"
	"encoding/json"
	"reflect"
	"strings"
	"testing"
	"time"

	"yingce/backend/internal/model"
)

func TestCloudAgentPiCompactionSummaryUsesStandardStepWithoutAssistantEvent(t *testing.T) {
	s, db, _ := agentMediaFixture(t)
	s.disablePiRuntime = true
	root, err := s.CreateCloudAgentRun("user", agentTestRequest(), "")
	if err != nil {
		t.Fatal(err)
	}
	initialRun, err := s.repo.CloudAgent("user", root.ID)
	if err != nil {
		t.Fatal(err)
	}
	initialState, err := cloudAgentDecode(initialRun)
	if err != nil {
		t.Fatal(err)
	}

	messages := []map[string]any{
		{"role": "system", "content": []any{map[string]any{"type": "text", "text": cloudAgentCompactionSummarySystemPromptPrefix + " Summarize the conversation."}}},
		{"role": "user", "content": []any{map[string]any{"type": "text", "text": "<conversation>Earlier context</conversation>"}}},
	}
	encodedMessages, err := json.Marshal(messages)
	if err != nil {
		t.Fatal(err)
	}
	payload := map[string]json.RawMessage{
		"messages":      encodedMessages,
		"thinkingLevel": json.RawMessage(`"off"`),
	}

	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	type outcome struct {
		result any
		err    error
	}
	done := make(chan outcome, 1)
	go func() {
		result, stepErr := s.cloudAgentPiModel(ctx, "user", root.ID, payload)
		done <- outcome{result: result, err: stepErr}
	}()

	var taskID string
	deadline := time.Now().Add(10 * time.Second)
	for time.Now().Before(deadline) {
		stored, readErr := s.repo.CloudAgent("user", root.ID)
		if readErr != nil {
			t.Fatal(readErr)
		}
		state, decodeErr := cloudAgentDecode(stored)
		if decodeErr != nil {
			t.Fatal(decodeErr)
		}
		if state.ActiveTaskID != "" && state.ActiveTaskID != initialState.ActiveTaskID {
			taskID = state.ActiveTaskID
			break
		}
		select {
		case got := <-done:
			t.Fatalf("summary model bridge returned before scheduling: result=%v err=%v", got.result, got.err)
		case <-time.After(25 * time.Millisecond):
		}
	}
	if taskID == "" {
		t.Fatal("summary model step was never scheduled")
	}

	var task model.Task
	if err := db.First(&task, "id = ?", taskID).Error; err != nil {
		t.Fatal(err)
	}
	if task.Operation != cloudAgentStepOperation {
		t.Fatalf("summary operation = %q, want standard %q", task.Operation, cloudAgentStepOperation)
	}
	var input map[string]any
	if err := json.Unmarshal([]byte(task.InputJSON), &input); err != nil {
		t.Fatalf("decode scheduled model input: %v", err)
	}
	agentRequests, _ := input["agentRequests"].(map[string]any)
	canonical, _ := agentRequests["canonical"].(map[string]any)
	canonicalMessages, _ := canonical["messages"].([]any)
	if len(canonicalMessages) == 0 {
		t.Fatalf("scheduled summary request has no canonical messages: %#v", canonical)
	}
	firstMessage, _ := canonicalMessages[0].(map[string]any)
	if stringField(firstMessage, "role") != "system" || !strings.HasPrefix(stringField(firstMessage, "content"), cloudAgentCompactionSummarySystemPromptPrefix) {
		t.Fatalf("Pi summary system prompt was not preserved: %#v", firstMessage)
	}

	if err := db.Model(&model.Task{}).Where("id = ?", taskID).Updates(map[string]any{
		"status":      model.TaskStatusSucceeded,
		"result_json": `{"text":"internal compaction summary","toolCalls":[]}`,
	}).Error; err != nil {
		t.Fatal(err)
	}
	select {
	case got := <-done:
		if got.err != nil {
			t.Fatalf("summary model bridge failed: %v", got.err)
		}
		result, _ := got.result.(map[string]any)
		if result["text"] != "internal compaction summary" {
			t.Fatalf("Pi did not receive summary: %#v", got.result)
		}
	case <-ctx.Done():
		t.Fatal("summary model bridge did not return")
	}

	stored, err := s.repo.CloudAgent("user", root.ID)
	if err != nil {
		t.Fatal(err)
	}
	state, err := cloudAgentDecode(stored)
	if err != nil {
		t.Fatal(err)
	}
	if state.ActiveTaskID != "" {
		t.Fatalf("summary step remained active: %q", state.ActiveTaskID)
	}
	if state.Step != initialState.Step+1 {
		t.Fatalf("summary step = %d, want %d", state.Step, initialState.Step+1)
	}
	if !reflect.DeepEqual(state.Canonical, initialState.Canonical) {
		t.Fatal("internal summary replaced canonical conversation")
	}
	if state.PiAssistantResponses != initialState.PiAssistantResponses {
		t.Fatalf("internal summary changed response count %d → %d", initialState.PiAssistantResponses, state.PiAssistantResponses)
	}
	for _, event := range state.Events {
		if event.Type == "assistant_message" && stringField(event.Payload, "text") == "internal compaction summary" {
			t.Fatal("internal summary was published as assistant message")
		}
	}
}

func TestCloudAgentPiCompactedProjectionPreservesSummaryAndRecentToolResult(t *testing.T) {
	messages := []map[string]any{
		{"role": "compactionSummary", "summary": "Earlier decisions", "tokensBefore": 12000},
		{"role": "assistant", "content": []any{map[string]any{
			"type": "toolCall", "id": "call-recent", "name": "canvas_read", "arguments": map[string]any{"nodeId": "node-1"},
		}}},
		{"role": "toolResult", "toolCallId": "call-recent", "content": []any{map[string]any{"type": "text", "text": "recent tool result"}}},
		{"role": "user", "content": "Continue from the current state."},
	}
	existing := canonicalAgentRequest{
		Tools:          []map[string]interface{}{{"type": "function", "function": map[string]interface{}{"name": "canvas_read"}}},
		SystemPrompt:   "Agent system prompt",
		PromptCacheKey: "cache-key",
		Messages:       make([]map[string]interface{}, 8),
	}

	canonical, err := cloudAgentPiCanonicalForModelRequest(messages, existing)
	if err != nil {
		t.Fatalf("convert compacted projection: %v", err)
	}
	if len(canonical.Messages) != 5 {
		t.Fatalf("compacted projection messages = %d, want 5: %#v", len(canonical.Messages), canonical.Messages)
	}
	if stringField(canonical.Messages[1], "role") != "user" || !strings.Contains(stringField(canonical.Messages[1], "content"), "Earlier decisions") {
		t.Fatalf("compaction summary not converted: %#v", canonical.Messages[1])
	}
	if stringField(canonical.Messages[3], "role") != "tool" || stringField(canonical.Messages[3], "content") != "recent tool result" {
		t.Fatalf("recent tool result not retained: %#v", canonical.Messages[3])
	}
	if canonical.PromptCacheKey != "cache-key" {
		t.Fatalf("lost prompt cache key: %q", canonical.PromptCacheKey)
	}
}

func TestCloudAgentPiCompactionSummarySkipsOrdinaryTranscriptValidation(t *testing.T) {
	messages := []map[string]any{
		{"role": "system", "content": cloudAgentCompactionSummarySystemPromptPrefix},
		{"role": "assistant", "content": []any{map[string]any{
			"type": "toolCall", "id": "unfinished", "name": "canvas_read", "arguments": map[string]any{},
		}}},
		{"role": "user", "content": "Serialized conversation."},
	}
	canonical, err := cloudAgentPiCanonicalForModelRequest(messages, canonicalAgentRequest{
		Tools:        []map[string]interface{}{{"type": "function"}},
		SystemPrompt: "ordinary Agent system prompt",
	})
	if err != nil {
		t.Fatalf("summary request failed validation: %v", err)
	}
	if len(canonical.Tools) != 0 {
		t.Fatalf("summary request included Agent tools: %#v", canonical.Tools)
	}
	if canonical.SystemPrompt != "" || stringField(canonical.Messages[0], "content") != cloudAgentCompactionSummarySystemPromptPrefix {
		t.Fatalf("summary system prompt not isolated: %#v", canonical)
	}
}

func TestCloudAgentPiContextPressureForwardsPiUsage(t *testing.T) {
	s, _, _ := agentMediaFixture(t)
	root, err := s.CreateCloudAgentRun("user", agentTestRequest(), "")
	if err != nil {
		t.Fatal(err)
	}
	tokens, percent := 120_000, 93.75
	if err := s.broadcastCloudAgentPiContextPressure("user", root.ID, &cloudAgentPiContextUsage{
		Tokens:        &tokens,
		ContextWindow: 128_000,
		Percent:       &percent,
	}); err != nil {
		t.Fatal(err)
	}

	stored, err := s.repo.CloudAgent("user", root.ID)
	if err != nil {
		t.Fatal(err)
	}
	state, err := cloudAgentDecode(stored)
	if err != nil {
		t.Fatal(err)
	}
	if len(state.Events) == 0 || state.Events[len(state.Events)-1].Type != "context_pressure" {
		t.Fatalf("Pi context pressure event missing: %#v", state.Events)
	}
	payload := state.Events[len(state.Events)-1].Payload
	if payload["tokenSource"] != "pi" || payload["estimateMethod"] != "pi-sdk" || payload["readingScope"] != "pi-session" {
		t.Fatalf("unexpected Pi context source metadata: %#v", payload)
	}
	if got := payload["estimatedInputTokens"]; got != float64(tokens) {
		t.Fatalf("estimatedInputTokens = %#v, want %d", got, tokens)
	}
	if got := payload["pressureRatio"]; got != percent/100 {
		t.Fatalf("pressureRatio = %#v, want %v", got, percent/100)
	}
}

func TestCloudAgentTransientModelFailureDoesNotOverridePermanentHTTPStatus(t *testing.T) {
	cases := []struct {
		name string
		call model.ApiCallLog
		want bool
	}{
		{
			name: "http 200 business error is transient",
			call: model.ApiCallLog{Status: model.ApiCallStatusFailed, StatusCode: 200, ErrorCode: "api_error"},
			want: true,
		},
		{
			name: "http 400 business error is permanent",
			call: model.ApiCallLog{Status: model.ApiCallStatusFailed, StatusCode: 400, ErrorCode: "api_error"},
			want: false,
		},
		{
			name: "http 401 authentication error is permanent",
			call: model.ApiCallLog{Status: model.ApiCallStatusFailed, StatusCode: 401, ErrorCode: "authentication"},
			want: false,
		},
		{
			name: "successful call is never transient",
			call: model.ApiCallLog{Status: model.ApiCallStatusSucceeded, StatusCode: 200, ErrorCode: "api_error"},
			want: false,
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := cloudAgentTransientModelFailure(tc.call); got != tc.want {
				t.Fatalf("cloudAgentTransientModelFailure() = %v, want %v for %#v", got, tc.want, tc.call)
			}
		})
	}
}
