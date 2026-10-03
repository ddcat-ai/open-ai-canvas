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

func TestApprovedCloudAgentMediaWaiterSettlesWithoutManualAdvance(t *testing.T) {
	s, db, args := agentMediaFixture(t)
	// Explicitly enable the production waiter; transition fixtures keep it off.
	s.approvedMediaClosed = false
	run, _ := agentMediaRun(t, s, args, "request_approval", "approved-media-waiter")
	if err := s.advanceCloudAgentByID("user", run.ID); err != nil {
		t.Fatal(err)
	}
	waiting, err := s.CloudAgentRun("user", run.ID)
	if err != nil || waiting.Approval == nil {
		t.Fatalf("missing approval: %v", err)
	}
	if err := s.DecideCloudAgentApproval("user", run.ID, waiting.Approval.ID, "approve", ""); err != nil {
		t.Fatal(err)
	}
	stored, state := agentInterjectionState(t, s, run.ID)
	taskID := state.MediaTaskID
	if taskID == "" {
		t.Fatal("approval did not submit media")
	}
	if err := db.Model(&model.Task{}).Where("id = ?", taskID).Updates(map[string]any{"status": model.TaskStatusFailed, "error": "本地验收失败"}).Error; err != nil {
		t.Fatal(err)
	}
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		stored, state = agentInterjectionState(t, s, run.ID)
		if state.MediaTaskID == "" {
			break
		}
		time.Sleep(20 * time.Millisecond)
	}
	if state.MediaTaskID != "" {
		t.Fatalf("background waiter did not checkpoint terminal media: %s", stored.StateJSON)
	}
	var count int64
	if err := db.Model(&model.Task{}).Where("type = ?", "canvas_video").Count(&count).Error; err != nil || count != 1 {
		t.Fatalf("waiter duplicated media submission: count=%d err=%v", count, err)
	}
}
