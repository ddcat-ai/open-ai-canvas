package app

import (
	"strings"
	"testing"
)

func TestCloudAgentAudioModeRequiresClearReferenceIntent(t *testing.T) {
	audioRefs := map[string]any{"referenceAudios": []any{map[string]any{"id": "audio-1"}}}
	if err := validateCloudAgentMediaReferences("audio", audioRefs, "tts", nil); err == nil {
		t.Fatal("tts with a reference audio must fail rather than silently discard it")
	}
	if err := validateCloudAgentMediaReferences("audio", nil, "unified_edit", nil); err == nil {
		t.Fatal("unified_edit without a reference audio must fail")
	}
	if err := validateCloudAgentMediaReferences("audio", audioRefs, "unified_edit", nil); err != nil {
		t.Fatalf("valid reference mode rejected: %v", err)
	}
}

func TestCloudAgentAudioVoiceBindingsUseActualAudioOrder(t *testing.T) {
	refs := map[string]any{
		"referenceCharacters": []any{map[string]any{"id": "character-1", "name": "陈默", "canvasReferenceKind": "character"}},
		"referenceAudios":     []any{map[string]any{"id": "audio-1"}, map[string]any{"id": "audio-2"}},
	}
	prompt, err := compileCloudAgentAudioVoiceBindings("角色台词", []cloudAgentAudioVoiceBinding{{CharacterNodeID: "character-1", AudioNodeID: "audio-2"}}, refs)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(prompt, "陈默 → @音频2") {
		t.Fatalf("binding did not use the submitted audio order: %q", prompt)
	}
	_, err = compileCloudAgentAudioVoiceBindings("角色台词", []cloudAgentAudioVoiceBinding{{CharacterNodeID: "character-1", AudioNodeID: "audio-3"}}, refs)
	if err == nil {
		t.Fatal("unconnected audio must not be accepted")
	}
}

func TestCloudAgentAudioConnectionsAllowCharacterAndReferenceAudio(t *testing.T) {
	nodes := []map[string]any{
		{"id": "voice", "type": "audio"},
		{"id": "character", "type": "text", "metadata": map[string]any{"workflowKind": "character"}},
		{"id": "target", "type": "audio"},
		{"id": "video", "type": "video"},
	}
	edges := []map[string]any{{"fromNodeId": "voice", "toNodeId": "target"}}
	if err := validateCloudAgentConnection(nodes, "voice", "target"); err != nil {
		t.Fatalf("reference audio connection rejected: %v", err)
	}
	if err := validateCloudAgentConnection(nodes, "character", "target", edges); err != nil {
		t.Fatalf("character plus reference audio rejected: %v", err)
	}
	if err := validateCloudAgentConnection(nodes, "video", "target", edges); err == nil {
		t.Fatal("unsupported reference video connection accepted")
	}
}
