package app

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestCreationPixelsStayBeforeLaterGenerationReceipts(t *testing.T) {
	s, _, _ := cloudAgentVisionFixture(t)
	req := creationAgentRequest()
	req.VisionEnabled = true
	req.Attachments = []CloudAgentAttachment{{ResourceID: "ref-one", Kind: "image", Role: "reference"}}
	state := cloudAgentRuntime{Request: req}
	for _, read := range []bool{false, true} {
		t.Run(map[bool]string{false: "current-input", true: "explicit-read"}[read], func(t *testing.T) {
			canonical := canonicalAgentRequest{Messages: []map[string]any{
				{"role": "user", "content": "本轮服务端事实", cloudAgentContextSourceKey: "creation_turn_context"},
				{"role": "user", "content": "把杯子上的文字改为 IGO"},
			}}
			if read {
				state.bindCreationImage("read-original", "ref-one", "image")
				canonical.Messages = append(canonical.Messages,
					map[string]any{"role": "assistant", "tool_calls": []any{
						map[string]any{"id": "read-original", "function": map[string]any{"name": "creation_media_read", "arguments": "{}"}},
						map[string]any{"id": "query-status", "function": map[string]any{"name": "task_status", "arguments": "{}"}},
					}},
					map[string]any{"role": "tool", "tool_call_id": "read-original", "content": "原图读取成功"},
					map[string]any{"role": "tool", "tool_call_id": "query-status", "content": "已核对任务"},
				)
			}
			canonical.Messages = append(canonical.Messages,
				map[string]any{"role": "assistant", "tool_calls": []any{map[string]any{"id": "generate-once", "function": map[string]any{"name": "generate_media", "arguments": `{"mode":"image","prompt":"改为 IGO"}`}}}},
				map[string]any{"role": "tool", "tool_call_id": "generate-once", "content": `{"status":"succeeded","taskId":"finished-image"}`},
			)
			refs, err := s.attachCloudAgentCreationImages("user", req, &canonical, &state)
			if err != nil || len(refs) != 1 {
				t.Fatalf("image input was lost: %+v %v", refs, err)
			}
			pixelIndex := -1
			for index, message := range canonical.Messages {
				if strings.Contains(mustMarshal(message["content"]), `"url":"resource:ref-one"`) {
					pixelIndex = index
				}
			}
			generationIndex := -1
			for index, message := range canonical.Messages {
				if stringField(message, "tool_call_id") == "generate-once" {
					generationIndex = index
				}
			}
			if pixelIndex < 0 || pixelIndex >= generationIndex {
				t.Fatalf("old image was presented as new input after generation succeeded: pixel=%d succeeded=%d", pixelIndex, generationIndex)
			}
			if read && (pixelIndex < 1 || stringField(canonical.Messages[pixelIndex-1], "tool_call_id") != "query-status") {
				t.Fatal("read pixels must follow the complete tool-result group without splitting its protocol")
			}
			if !read && stringField(canonical.Messages[pixelIndex], cloudAgentContextSourceKey) != "creation_turn_context" {
				t.Fatal("current pixels must belong to the original trusted turn context")
			}
			if stringField(canonical.Messages[len(canonical.Messages)-1], "tool_call_id") != "generate-once" {
				t.Fatal("successful generation must remain the last event")
			}
			before := mustMarshal(canonical)
			// Persist/reload and repeat the model preparation after a failed
			// model call; pixels and their receipt must not accumulate.
			if err := json.Unmarshal([]byte(before), &canonical); err != nil {
				t.Fatal(err)
			}
			if _, err := s.attachCloudAgentCreationImages("user", req, &canonical, &state); err != nil || mustMarshal(canonical) != before {
				t.Fatalf("restored model step duplicated or moved visual input: %v", err)
			}
		})
	}
}

func TestCreationCurrentTurnPositionDoesNotReviveEarlierRunBindings(t *testing.T) {
	s, _, _ := cloudAgentVisionFixture(t)
	req := creationAgentRequest()
	req.VisionEnabled = true
	req.Attachments = []CloudAgentAttachment{{ResourceID: "ref-two", Kind: "image", Role: "reference"}}
	state := cloudAgentRuntime{Request: req}
	// The new run still contains the old native history, but it has not read
	// the old image. Only the current custom origin gets a bridge position.
	raw := []map[string]any{
		{"role": "user", "content": "旧轮服务端事实"},
		{"role": "assistant", "content": []any{map[string]any{"type": "toolCall", "id": "old-read", "name": "creation_media_read", "arguments": map[string]any{}}}},
		{"role": "toolResult", "toolCallId": "old-read", "content": []any{map[string]any{"type": "text", "text": `{"resourceId":"ref-one"}`}}},
		{"role": "user", "content": "当前轮服务端事实"},
		{"role": "user", "content": "新素材的用途请结合前文判断"},
	}
	canonical, err := cloudAgentPiCanonicalForModelRequest(raw, canonicalAgentRequest{SystemPrompt: "首页规则"}, 3)
	if err != nil {
		t.Fatal(err)
	}
	effective := req
	effective.Attachments = append(effective.Attachments, CloudAgentAttachment{ResourceID: "ref-one", Kind: "image", Role: "reference"})
	refs, err := s.attachCloudAgentCreationImages("user", effective, &canonical, &state)
	if err != nil || len(refs) != 1 || refs[0].StorageKey != "resource:ref-two" {
		t.Fatalf("old native receipt activated another run's pixels: %+v %v", refs, err)
	}
	for _, message := range canonical.Messages {
		if strings.Contains(mustMarshal(message), `"url":"resource:ref-one"`) {
			t.Fatal("earlier run's source was automatically attached")
		}
		if strings.Contains(mustMarshal(message), `"url":"resource:ref-two"`) && !strings.Contains(mustMarshal(message), "当前轮服务端事实") {
			t.Fatal("current image was attached to an earlier user message")
		}
	}
	if len(state.Request.Attachments) != 1 {
		t.Fatal("vision mutated user-uploaded attachments")
	}
}
