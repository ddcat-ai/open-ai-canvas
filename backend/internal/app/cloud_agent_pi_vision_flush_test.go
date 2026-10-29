package app

import (
	"context"
	"errors"
	"testing"

	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"
)

func TestCloudAgentPiMixedBatchFlushesImages(t *testing.T) {
	for _, failed := range []bool{false, true} {
		name := "success"
		if failed {
			name = "failed_final_tool"
		}
		t.Run(name, func(t *testing.T) {
			state := cloudAgentPairingState(
				cloudAgentPairingCall("image", "canvas_inspect_image", "{}"),
				cloudAgentPairingCall("state", "canvas_get_state", "{}"),
			)
			cloudAgentToolResult("run", state, state.Calls[0], cloudAgentPairingInspection("image-a", "https://example.test/a"), nil)
			if len(state.PendingImageInspections) != 1 || len(cloudAgentImageMessageIndexes(state.Canonical.Messages)) != 0 {
				t.Fatal("image must remain buffered until all tool results arrive")
			}
			var toolErr error
			if failed {
				toolErr = errors.New("read failed")
			}
			cloudAgentToolResult("run", state, state.Calls[1], map[string]any{"ok": true}, toolErr)
			// Pi does not call advanceCloudAgent's fallback flush.
			assertPiBatchImages(t, state, 1)
			if cloudAgentFlushPendingImages(state) {
				t.Fatal("batch completion must not leave a duplicate image to flush")
			}
		})
	}
}

func assertPiBatchImages(t *testing.T, state *cloudAgentRuntime, count int) {
	t.Helper()
	if len(state.PendingImageInspections) != 0 {
		t.Fatalf("Pi batch left %d images pending", len(state.PendingImageInspections))
	}
	assertCloudAgentToolCallPairing(t, state.Canonical.Messages)
	indexes := cloudAgentImageMessageIndexes(state.Canonical.Messages)
	if len(indexes) != 1 || indexes[0] != len(state.Canonical.Messages)-1 {
		t.Fatalf("expected one trailing image message: %s", cloudAgentDebugMessages(state.Canonical.Messages))
	}
	if got := cloudAgentMessageImagePartCount(state.Canonical.Messages[indexes[0]]); got != count {
		t.Fatalf("image count=%d, want %d", got, count)
	}
}

func TestCloudAgentPiToolBridgeFlushesMixedBatch(t *testing.T) {
	s, db, _ := agentMediaFixture(t)
	capability := DefaultModelCapabilityConfigForModel(string(model.ChannelInterfaceChatCompletion), "text-test")
	capability.Text.References.MaxImages = 2
	if err := db.Model(&model.ChannelModel{}).Where("id = ?", "cm").Update("capability_config_json", mustEncodeModelCapabilityConfig(t, capability)).Error; err != nil {
		t.Fatal(err)
	}
	root, err := s.CreateCloudAgentRun("user", agentTestRequest(), "")
	if err != nil {
		t.Fatal(err)
	}
	run, err := s.repo.CloudAgent("user", root.ID)
	if err != nil {
		t.Fatal(err)
	}
	state, err := cloudAgentDecode(run)
	if err != nil {
		t.Fatal(err)
	}
	state.ActiveTaskID = ""
	state.Request.VisionEnabled = true
	state.Calls = []cloudAgentCall{
		cloudAgentStoryboardCall(t, "canvas_inspect_image", "inspect-cat", map[string]any{"nodeId": "cat"}),
		cloudAgentStoryboardCall(t, "canvas_inspect_image", "inspect-hero", map[string]any{"nodeId": "hero"}),
		cloudAgentStoryboardCall(t, "canvas_get_state", "read-state", map[string]any{}),
	}
	state.Canonical.Messages = append(state.Canonical.Messages, map[string]any{"role": "assistant", "content": "", "tool_calls": state.Calls})
	if err := s.repo.MutateCloudAgent("user", run.ID, run.Revision, func(current *model.CloudAgentExecution, _ *repository.Repository) error {
		return cloudAgentSave(current, &state)
	}); err != nil {
		t.Fatal(err)
	}
	for index, call := range state.Calls {
		if _, err := s.executeCloudAgentRuntimeTool(context.Background(), "user", run.ID, call); err != nil {
			t.Fatal(err)
		}
		stored, err := s.repo.CloudAgent("user", run.ID)
		if err != nil {
			t.Fatal(err)
		}
		saved, err := cloudAgentDecode(stored)
		if err != nil {
			t.Fatal(err)
		}
		if index < len(state.Calls)-1 {
			if len(cloudAgentImageMessageIndexes(saved.Canonical.Messages)) != 0 {
				t.Fatal("images interleaved with tool results")
			}
			continue
		}
		assertPiBatchImages(t, &saved, 2)
		// The shorter Pi projection carries text receipts; the model bridge must
		// retain the server's trailing image message.
		parts := make([]any, 0, len(state.Calls))
		for _, item := range state.Calls {
			parts = append(parts, map[string]any{"type": "toolCall", "id": item.ID, "name": item.Function.Name, "arguments": map[string]any{}})
		}
		projected := []map[string]any{{"role": "assistant", "content": parts}}
		for _, item := range state.Calls {
			content, ok := cloudAgentToolMessage(&saved, item.ID)
			if !ok {
				t.Fatalf("missing tool receipt %s", item.ID)
			}
			projected = append(projected, map[string]any{"role": "toolResult", "toolCallId": item.ID, "content": content})
		}
		canonical, err := cloudAgentPiCanonicalForModelRequest(projected, saved.Canonical)
		if err != nil {
			t.Fatal(err)
		}
		saved.Canonical = canonical
		assertPiBatchImages(t, &saved, 2)
	}
}
