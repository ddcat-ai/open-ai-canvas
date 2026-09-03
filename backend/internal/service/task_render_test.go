package service

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"testing"
	"time"

	"gorm.io/gorm"

	"infinite-canvas/backend/internal/model"
)

// renderTestProject 构造一个可渲染的 v2 快照：一条可见视频轨 + 一个
// 经 directMedia.storageKey（resource:<id>）引用后端资源的片段。
func renderTestProject(storageKey string) renderProject {
	visible := true
	return renderProject{
		Version:    2,
		DurationMs: 2000,
		Tracks:     []renderTrack{{ID: "track-v1", Kind: "video", Visible: &visible}},
		Clips: []renderClip{{
			ID:            "clip-v1",
			Kind:          "video",
			TrackID:       "track-v1",
			StartMs:       0,
			DurationMs:    2000,
			SourceStartMs: 0,
			Volume:        1,
			DirectMedia: &struct {
				ID         string `json:"id"`
				Kind       string `json:"kind"`
				StorageKey string `json:"storageKey"`
			}{ID: "asset-v1", Kind: "video", StorageKey: storageKey},
		}},
	}
}

func renderInputJSON(t *testing.T, project renderProject) string {
	t.Helper()
	raw, err := json.Marshal(timelineRenderInput{ProjectID: "prj-render", Timeline: project})
	if err != nil {
		t.Fatalf("marshal render input: %v", err)
	}
	return string(raw)
}

func seedRunningRenderTask(t *testing.T, db *gorm.DB, inputJSON string) *model.Task {
	t.Helper()
	task := &model.Task{
		ID:        fmt.Sprintf("tsk-render-%d", time.Now().UnixNano()),
		UserID:    "usr-render-test",
		Type:      model.TaskTypeTimelineRender,
		Status:    model.TaskStatusRunning,
		Stage:     "已领取",
		InputJSON: inputJSON,
	}
	if err := db.Create(task).Error; err != nil {
		t.Fatalf("seed task: %v", err)
	}
	return task
}

func TestCreateTimelineRenderTaskQueues(t *testing.T) {
	svc, db := newTimelineTaskTestService(t)

	task, err := svc.CreateTimelineRenderTask("usr-render-test", TimelineRenderCreateRequest{
		ProjectID: "prj-render",
		Timeline:  renderTestProject("resource:res-1"),
	})
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	if task.Type != model.TaskTypeTimelineRender || task.Status != model.TaskStatusQueued {
		t.Fatalf("task = %s/%s, want %s/queued", task.Type, task.Status, model.TaskTypeTimelineRender)
	}
	if task.Provider != "local" || task.Model != "ffmpeg" {
		t.Fatalf("provider/model = %s/%s, want local/ffmpeg", task.Provider, task.Model)
	}

	var stored model.Task
	if err := db.First(&stored, "id = ?", task.ID).Error; err != nil {
		t.Fatalf("load task: %v", err)
	}
	if stored.ProjectID != "prj-render" || stored.UserID != "usr-render-test" {
		t.Fatalf("stored owner/project mismatch: %s/%s", stored.UserID, stored.ProjectID)
	}
}

func TestCreateTimelineRenderTaskRejectsNoMedia(t *testing.T) {
	svc, _ := newTimelineTaskTestService(t)

	visible := true
	textOnly := renderProject{
		Version:    2,
		DurationMs: 1000,
		Tracks:     []renderTrack{{ID: "track-t1", Kind: "text", Visible: &visible}},
		Clips: []renderClip{{
			ID: "clip-t1", Kind: "text", TrackID: "track-t1", StartMs: 0,
			DurationMs: 1000, Text: "字幕",
		}},
	}
	_, err := svc.CreateTimelineRenderTask("usr-render-test", TimelineRenderCreateRequest{Timeline: textOnly})
	if err == nil || !strings.Contains(err.Error(), "可渲染") {
		t.Fatalf("err = %v, want mention of 没有可渲染的媒体片段", err)
	}
}

func TestTimelineRenderFailsFastWhenSourceUnreadable(t *testing.T) {
	svc, db := newTimelineTaskTestService(t)
	// 指向不存在的资源；ffmpeg 路径设为无效值不影响断言——本测试在
	// 素材落盘（materialize）阶段即失败，且该失败早于任何外部命令执行。
	task := seedRunningRenderTask(t, db, renderInputJSON(t, renderTestProject("resource:res-missing")))

	t.Setenv(renderFfmpegEnv, "/no/such/ffmpeg")
	w := newTaskWorkerCoordinator(svc)
	if err := w.processTimelineRender(task, context.Background()); err != nil {
		t.Fatalf("process: want nil (task terminal handled internally), got %v", err)
	}

	var stored model.Task
	if err := db.First(&stored, "id = ?", task.ID).Error; err != nil {
		t.Fatalf("load task: %v", err)
	}
	if stored.Status != model.TaskStatusFailed {
		t.Fatalf("status = %q, want failed", stored.Status)
	}
	if !strings.Contains(stored.Error, "时间线引用的媒体") {
		t.Fatalf("error = %q, want mention of 无法读取时间线引用的媒体", stored.Error)
	}
}
