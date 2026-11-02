package app

import (
	"errors"
	"os"
	"testing"

	"gorm.io/gorm"
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

func TestAuthenticateAgentWorkerEnvIdentity(t *testing.T) {
	t.Setenv("CANVAS_AGENT_WORKER_ID", "compose")
	t.Setenv("CANVAS_AGENT_WORKER_TOKEN", "expected-secret-long-enough-32-ch")
	t.Setenv("CANVAS_AGENT_WORKER_USER_ID", "user-1")
	s := &Service{}

	worker, err := s.AuthenticateAgentWorker("compose", "expected-secret-long-enough-32-ch")
	if err != nil || worker.ID != "compose" || worker.UserID != "user-1" {
		t.Fatalf("matching identity failed: worker=%+v err=%v", worker, err)
	}
	if _, err := s.AuthenticateAgentWorker("compose", "mismatch-secret-long-enough-32"); !errors.Is(err, gorm.ErrRecordNotFound) {
		t.Fatalf("wrong secret must return record-not-found, got %v", err)
	}
	if _, err := s.AuthenticateAgentWorker("compose", "short"); !errors.Is(err, gorm.ErrRecordNotFound) {
		t.Fatalf("weak secret must be rejected before comparison, got %v", err)
	}
	if _, err := s.AuthenticateAgentWorker("other", "expected-secret-long-enough-32-ch"); !errors.Is(err, gorm.ErrRecordNotFound) {
		t.Fatalf("other identity must not match, got %v", err)
	}

	t.Setenv("CANVAS_AGENT_WORKER_TOKEN", "short")
	if _, err := s.AuthenticateAgentWorker("compose", "expected-secret-long-enough-32-ch"); !errors.Is(err, gorm.ErrRecordNotFound) {
		t.Fatal("weak expected token must disable identity entirely")
	}
	t.Setenv("CANVAS_AGENT_WORKER_ID", "")
	t.Setenv("CANVAS_AGENT_WORKER_TOKEN", "expected-secret-long-enough-32-ch")
	if _, err := s.AuthenticateAgentWorker("compose", "expected-secret-long-enough-32-ch"); !errors.Is(err, gorm.ErrRecordNotFound) {
		t.Fatal("missing worker id env must disable identity entirely")
	}
	if os.Getenv("CANVAS_AGENT_WORKER_USER_ID") != "user-1" {
		t.Fatal("unexpected env interference between subtests")
	}
}

func repeat(value string, count int) string {
	out := make([]rune, 0, count)
	for i := 0; i < count; i++ {
		out = append(out, []rune(value)...)
	}
	return string(out)
}
