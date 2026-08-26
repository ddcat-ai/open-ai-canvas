package service

import "testing"

func TestTerminalProviderStatus(t *testing.T) {
	for _, status := range []string{"completed", "SUCCEEDED", " success ", "done", "failed", "cancelled", "canceled", "expired"} {
		if !terminalProviderStatus(status) {
			t.Fatalf("terminalProviderStatus(%q) = false, want true", status)
		}
	}
	for _, status := range []string{"", "queued", "processing", "running", "submitted"} {
		if terminalProviderStatus(status) {
			t.Fatalf("terminalProviderStatus(%q) = true, want false", status)
		}
	}
}
