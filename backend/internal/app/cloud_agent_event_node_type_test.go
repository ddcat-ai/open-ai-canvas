package app

import "testing"

func TestCloudAgentEventNodeTypeResolvesCharacterVariant(t *testing.T) {
	character := map[string]any{"type": "text", "metadata": map[string]any{"workflowKind": "character"}}
	if got := cloudAgentEventNodeType(character); got != "character" {
		t.Fatalf("character card node type = %v, want character", got)
	}
	if got := cloudAgentEventNodeType(map[string]any{"type": "text"}); got != "text" {
		t.Fatalf("plain text node type = %v, want text", got)
	}
}
