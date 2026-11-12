package app

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestCloudAgentAudioReadExposesNamesAndBindingsWithoutMediaSecrets(t *testing.T) {
	meta := map[string]any{"audioMode": "unified_edit", "audioVoiceBindings": []any{map[string]any{"characterNodeId": "c", "audioNodeId": "a"}}}
	doc := map[string]any{"nodes": []any{map[string]any{"id": "c", "type": "text", "title": "陈默", "metadata": map[string]any{"workflowKind": "character"}}, map[string]any{"id": "a", "type": "audio", "title": "老余", "metadata": map[string]any{"storageKey": "resource:private-media"}}}}
	view := cloudAgentAudioReferenceState(meta, doc)
	encoded, err := json.Marshal(view)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(encoded), "老余") || !strings.Contains(string(encoded), "陈默") || strings.Contains(string(encoded), "private-media") {
		t.Fatalf("invalid public state: %s", encoded)
	}
	if view["mode"] != "unified_edit" {
		t.Fatal(view)
	}
	if !view["voiceBindings"].([]any)[0].(map[string]any)["available"].(bool) {
		t.Fatal("valid named audio binding unavailable")
	}
	meta["generationSpec"] = map[string]any{"options": map[string]any{"audioMode": "tts"}}
	if cloudAgentAudioReferenceState(meta, doc)["mode"] != "tts" {
		t.Fatal("canonical mode must override stale metadata")
	}
	doc["nodes"] = []any{}
	if cloudAgentAudioReferenceState(meta, doc)["voiceBindings"].([]any)[0].(map[string]any)["available"] != false {
		t.Fatal("deleted nodes must be unavailable")
	}
}
