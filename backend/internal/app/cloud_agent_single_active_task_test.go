package app

import (
	"context"
	"testing"
	"time"

	"infinite-canvas/backend/internal/model"
)

// 线上复现："invalid Agent checkpoint (runtime validation): Agent runtime has multiple active tasks"。
// 批准媒体生成后，媒体任务还在跑（MediaTaskID 已设置），运行时又请求下一步模型调用；
// 调度模型步骤会同时设置 ActiveTaskID，检查点校验拒绝，整轮失败。
// 修复后模型步骤必须先等媒体结果回写、释放 MediaTaskID，再入队。
func TestCloudAgentModelStepWaitsForPendingMediaTask(t *testing.T) {
	s, db, a := agentMediaFixture(t)
	run, state := agentMediaRun(t, s, a, "auto")
	if err := s.advanceCloudAgentTool(run, &state); err != nil {
		t.Fatal(err)
	}
	run, err := s.repo.CloudAgent("user", run.ID)
	if err != nil {
		t.Fatal(err)
	}
	state, err = cloudAgentDecode(run)
	if err != nil {
		t.Fatal(err)
	}
	if state.MediaTaskID == "" {
		t.Fatalf("fixture did not submit a media task (status=%s failure=%q)", run.Status, run.FailureMessage)
	}
	mediaTaskID := state.MediaTaskID

	// 模拟媒体任务稍后才结束。
	go func() {
		time.Sleep(300 * time.Millisecond)
		_ = db.Model(&model.Task{}).Where("id = ?", mediaTaskID).Updates(map[string]any{"status": model.TaskStatusFailed, "error": "HTTP 502 Bad Gateway"}).Error
	}()

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	messages := []map[string]any{{"role": "user", "content": "继续"}}
	done := make(chan error, 1)
	go func() {
		_, _, stepErr := s.runCloudAgentModelStep(ctx, "user", run.ID, messages, "off")
		done <- stepErr
	}()

	// 模型步骤在等待期间，检查点里绝不能同时出现两个活动任务。
	deadline := time.Now().Add(8 * time.Second)
	scheduled := false
	for time.Now().Before(deadline) && !scheduled {
		latest, readErr := s.repo.CloudAgent("user", run.ID)
		if readErr != nil {
			t.Fatal(readErr)
		}
		current, decodeErr := cloudAgentDecode(latest)
		if decodeErr != nil {
			t.Fatalf("checkpoint became invalid while waiting for media: %v", decodeErr)
		}
		if current.ActiveTaskID != "" && current.MediaTaskID != "" {
			t.Fatalf("model step scheduled while media task %s still active", current.MediaTaskID)
		}
		if current.ActiveTaskID != "" {
			scheduled = true
			if current.MediaTaskID != "" {
				t.Fatal("media task not released before model step")
			}
		}
		if latest.Status == "failed" {
			t.Fatalf("run failed while waiting for media: %q", latest.FailureMessage)
		}
		time.Sleep(50 * time.Millisecond)
	}
	if !scheduled {
		t.Fatal("model step was never scheduled after the media task finished")
	}
	cancel()
	<-done
}
