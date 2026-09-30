package app

import (
	"context"
	"errors"
	"testing"
	"time"

	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/repository"
)

// 停机时审批后的媒体等待会被取消。此时不能继续回写结果、也不能恢复运行时：
// 否则正在排空的进程会拉起新的 Agent 步骤，并把仍在生成的媒体任务当作失败处理。
// MediaTaskID 必须原样保留，让下次启动的 recoverCloudAgentPiRunners 重新挂上等待。
func TestFinishApprovedCloudAgentMediaStopsWhenWaitIsCancelled(t *testing.T) {
	s, db, a := agentMediaFixture(t)
	s.disablePiRuntime = true
	run, state := agentMediaRun(t, s, a, "request_approval", "approved-media-cancel")
	task := &model.Task{ID: "approved-media-task", UserID: "user", ProjectID: "agent-canvas", Type: "canvas_video",
		Status: model.TaskStatusRunning, CreatedAt: time.Now(), UpdatedAt: time.Now()}
	if err := db.Create(task).Error; err != nil {
		t.Fatal(err)
	}
	state.MediaTaskID = task.ID
	state.TaskIDs = append(state.TaskIDs, task.ID)
	if err := s.repo.MutateCloudAgent("user", run.ID, run.Revision, func(current *model.CloudAgentExecution, _ *repository.Repository) error {
		return cloudAgentSave(current, &state)
	}); err != nil {
		t.Fatal(err)
	}

	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	err := s.finishApprovedCloudAgentMedia(ctx, "user", run.ID, task.ID)
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("finishApprovedCloudAgentMedia() error = %v, want context.Canceled", err)
	}
	latest, err := s.repo.CloudAgent("user", run.ID)
	if err != nil {
		t.Fatal(err)
	}
	decoded, err := cloudAgentDecode(latest)
	if err != nil {
		t.Fatal(err)
	}
	if decoded.MediaTaskID != task.ID || decoded.PiResumePrompt != "" {
		t.Fatalf("cancelled wait mutated run state: mediaTask=%q resumePrompt=%q", decoded.MediaTaskID, decoded.PiResumePrompt)
	}
}
