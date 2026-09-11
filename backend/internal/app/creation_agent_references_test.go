package app

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestCreationAgentImagesResolveOnlyApprovedResources(t *testing.T) {
	input := canvasGenerationInput{ReferenceImages: []providerMedia{{StorageKey: "resource:allowed", DataURL: "data:image/png;base64,aW1hZ2U="}}, AgentRequests: &agentToolRequests{
		ChatCompletion: map[string]any{"messages": []any{map[string]any{"role": "user", "content": []any{map[string]any{"type": "image_url", "image_url": map[string]any{"url": "resource:allowed"}}}}}},
		Claude:         map[string]any{"messages": []any{map[string]any{"content": []any{map[string]any{"type": "image", "source": map[string]any{"type": "url", "url": "resource:allowed"}}}}}},
		Gemini:         map[string]any{"contents": []any{map[string]any{"parts": []any{map[string]any{"fileData": map[string]any{"fileUri": "resource:allowed", "mimeType": "image/png"}}}}}},
	}}
	if err := validateAgentResourcePlaceholders(input); err != nil {
		t.Fatal(err)
	}
	resolved, err := resolveAgentResourcePlaceholders(input, true)
	if err != nil {
		t.Fatal(err)
	}
	b, _ := json.Marshal(resolved.AgentRequests)
	text := string(b)
	for _, want := range []string{"data:image/png;base64,aW1hZ2U=", `"type":"base64"`, `"inlineData"`} {
		if !strings.Contains(text, want) {
			t.Fatalf("missing protocol image: %s", want)
		}
	}
	original, _ := json.Marshal(input.AgentRequests)
	if strings.Contains(string(original), "base64") {
		t.Fatal("persistable protocol mutated")
	}
	input.AgentRequests.Responses = map[string]any{"input": []any{map[string]any{"image_url": "resource:other"}}}
	if err := validateAgentResourcePlaceholders(input); err == nil {
		t.Fatal("unlisted resource allowed")
	}
}

func TestCreationManagedConfigSecretsAreNotPersisted(t *testing.T) {
	s, _, id, guard := creationTestService(t)
	request := creationTextRequest()
	config := request.Input["config"].(map[string]any)
	config["apiKey"] = "system-sentinel"
	config["baseUrl"] = "/api/ai/system/channel"
	item, err := s.PrepareCreationSubmission("user", id, CreationRequest{CreationGuard: guard, ItemKey: "sanitized", Request: request})
	if err != nil {
		t.Fatal(err)
	}
	stored, err := s.repo.CreationSubmission("user", id, item.ID)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(stored.RequestJSON, "system-sentinel") || strings.Contains(stored.RequestJSON, "baseUrl") {
		t.Fatal("sentinel config persisted")
	}
}
