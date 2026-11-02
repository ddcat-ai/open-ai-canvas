package app

import (
	"testing"
)

func TestAgentWorkerIDPatternEdges(t *testing.T) {
	cases := map[string]bool{
		"compose-worker": true,
		"w":              true,
		"W1.2-3_4":       true,
		"":               false,
		"-lead":          false,
		"has space":      false,
		"slash/head":     false,
		repeat("a", 64):  true,  // 首个命名符 + 63 个
		repeat("a", 65):  false, // 超出 64 上限
	}
	for id, want := range cases {
		if got := agentWorkerIDPattern.MatchString(id); got != want {
			t.Fatalf("pattern mismatch for %q: got %v want %v", id, got, want)
		}
	}
}

func TestAgentWorkerOwnsOwner(t *testing.T) {
	s := &Service{}
	if !s.AgentWorkerOwnsOwner("compose", "compose:0") {
		t.Fatal("worker must own its own slot")
	}
	if !s.AgentWorkerOwnsOwner("compose", "compose:sched-a.1") {
		t.Fatal("dotted-hyphen slot suffix is allowed")
	}
	if s.AgentWorkerOwnsOwner("compose", "other:0") {
		t.Fatal("worker must not own another worker's owner")
	}
	if s.AgentWorkerOwnsOwner("compose", "compose:") {
		t.Fatal("empty slot suffix must be rejected")
	}
	if s.AgentWorkerOwnsOwner("compose", "compose:way-too-long-suffix-16") {
		t.Fatal("slot suffix must stay within 15 chars")
	}
	if s.AgentWorkerOwnsOwner("compose", stringsRepeat("o", 81)) {
		t.Fatal("owner beyond 80 chars must be rejected")
	}
}

func repeat(value string, count int) string {
	out := make([]rune, 0, count)
	for i := 0; i < count; i++ {
		out = append(out, []rune(value)...)
	}
	return string(out)
}
