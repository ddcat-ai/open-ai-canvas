package app

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"
)

func TestCloudAgentPiVisionWorkerPreservesImagesWithEmptySystemHistory(t *testing.T) {
	for _, scenario := range []struct {
		name         string
		emptySystems int
	}{
		{"no_empty_messages", 0},
		{"raw_history_same_length", 2},
		{"raw_history_longer", 6},
	} {
		t.Run(scenario.name, func(t *testing.T) {
			t.Setenv("CANVAS_ALLOWED_PRIVATE_UPSTREAM_HOSTS", "127.0.0.1")
			s, _, pixels := cloudAgentVisionFixture(t)
			call := cloudAgentStoryboardCall(t, "canvas_inspect_image", "inspect-cat", map[string]any{"nodeId": "cat"})
			call.ItemID = "fc-inspect-cat"
			state := cloudAgentPairingState(call)
			state.Request = agentTestRequest()
			state.Request.VisionEnabled = true
			state.Canonical.ToolChoice = "auto"
			state.Canonical.SystemPrompt = "Inspect the requested canvas image."
			state.Canonical.Messages = append([]map[string]any{
				{"role": "system", "content": state.Canonical.SystemPrompt},
				{"role": "user", "content": "Describe the image."},
			}, state.Canonical.Messages...)
			inspection, err := s.prepareCloudAgentImageInspection("user", "agent-canvas", state, call)
			if err != nil {
				t.Fatal(err)
			}
			cloudAgentToolResult("run", state, call, inspection, nil)
			assertPiBatchImages(t, state, 1)
			receipt, _ := cloudAgentToolMessage(state, call.ID)

			projected := make([]map[string]any, 0, scenario.emptySystems+3)
			for index := 0; index < scenario.emptySystems; index++ {
				projected = append(projected, map[string]any{"role": "system", "content": ""})
			}
			projected = append(projected,
				map[string]any{"role": "user", "content": "Describe the image."},
				map[string]any{"role": "assistant", "content": []any{map[string]any{
					"type": "toolCall", "id": call.ID, "itemId": call.ItemID, "name": call.Function.Name, "arguments": map[string]any{"nodeId": "cat"},
				}}},
				map[string]any{"role": "toolResult", "toolCallId": call.ID, "content": []any{map[string]any{"type": "text", "text": receipt}}},
			)
			canonical, err := cloudAgentPiCanonicalForModelRequest(projected, state.Canonical)
			if err != nil {
				t.Fatal(err)
			}
			references, err := s.cloudAgentPiStepImageReferences("user", state.Request, &canonical)
			if err != nil {
				t.Fatal(err)
			}
			limits, err := s.cloudAgentVisionReferences(state.Request)
			if err != nil {
				t.Fatal(err)
			}
			received := make(chan []string, 1)
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				var body struct {
					Input []map[string]any `json:"input"`
				}
				if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
					t.Error(err)
					w.WriteHeader(http.StatusBadRequest)
					return
				}
				if r.URL.Path != "/v1/responses" {
					t.Errorf("request path = %q", r.URL.Path)
				}
				var imageURLs []string
				for _, message := range body.Input {
					parts, _ := message["content"].([]any)
					for _, value := range parts {
						part, _ := value.(map[string]any)
						if stringField(part, "type") == "input_image" {
							imageURLs = append(imageURLs, stringField(part, "image_url"))
						}
					}
				}
				received <- imageURLs
				w.Header().Set("Content-Type", "text/event-stream")
				_, _ = w.Write([]byte("event: response.output_text.delta\ndata: {\"delta\":\"pixels received\"}\n\nevent: response.completed\ndata: {\"response\":{\"status\":\"completed\",\"output\":[]}}\n\n"))
			}))
			defer server.Close()
			stream := true
			input := canvasGenerationInput{
				Mode: "text", Prompt: "Describe the image.", ReferenceImages: references,
				AgentRequests: &agentToolRequests{Canonical: &canonical},
				TextOptions:   canvasTextOptions{Stream: &stream},
				Config: providerConfig{
					Model: "text-test", InterfaceType: string(model.ChannelInterfaceOpenAIResponse), APIKey: "test-only", BaseURL: server.URL,
					CapabilityConfig: &ModelCapabilityConfig{Text: &TextCapabilityConfig{References: limits}},
				},
			}
			raw, err := json.Marshal(input)
			if err != nil {
				t.Fatal(err)
			}
			if _, err := s.processCanvasGenerationTask(context.Background(), "user", "agent-canvas", "canvas_text", "", string(raw)); err != nil {
				t.Fatal(err)
			}
			select {
			case imageURLs := <-received:
				if len(imageURLs) != 1 || imageURLs[0] != "data:image/png;base64,"+base64.StdEncoding.EncodeToString(pixels) {
					t.Fatalf("Responses request received %d images; expected the exact stored image bytes", len(imageURLs))
				}
			default:
				t.Fatal("worker did not call the local upstream")
			}
		})
	}
}

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
