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

// 审批恢复时旧会话可能还在收尾：不能取消它，也不能丢弃恢复请求。
func TestResumeCloudAgentPiQueuesRestartWhileRunnerIsExiting(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	s := &Service{piRunners: map[string]context.CancelFunc{"run-a": cancel}}
	s.resumeCloudAgentPi("user-a", "run-a")

	if err := ctx.Err(); err != nil {
		t.Fatalf("resume cancelled the exiting Pi runner: %v", err)
	}
	if _, queued := s.piRunnerRestarts["run-a"]; !queued {
		t.Fatal("resume request was dropped while the previous runner was still exiting")
	}
}
