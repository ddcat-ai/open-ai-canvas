package app

import (
	"context"
	"testing"
)

func TestStartCloudAgentPiDoesNotRestartAnActiveRunner(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	s := &Service{piRunners: map[string]context.CancelFunc{"run-a": cancel}}
	s.startCloudAgentPi("user-a", "run-a")

	if err := ctx.Err(); err != nil {
		t.Fatalf("duplicate start cancelled the active Pi runner: %v", err)
	}
}
