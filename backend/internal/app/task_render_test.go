package app

import (
	"context"
	"encoding/json"
	"fmt"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"gorm.io/gorm"

	"yingce/backend/internal/model"
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
	if stored.Stage != "准备合成素材失败" {
		t.Fatalf("stage = %q, want source preparation failure", stored.Stage)
	}
	if !strings.Contains(stored.Error, "时间线引用的媒体") {
		t.Fatalf("error = %q, want mention of 无法读取时间线引用的媒体", stored.Error)
	}
}

// 真实 ffmpeg 端到端：近似画幅的来源裁切铺满，成片写入 AIGC 隐式标识，结果记录尺寸、适配方式与来源标识。
func TestTimelineRenderCropsNearAspectAndWritesProvenance(t *testing.T) {
	requireFFmpegTools(t)
	svc, db := newTimelineTaskTestService(t)
	svc.dataDir = t.TempDir()
	sourceTag := `{"Label":"1","ContentProducer":"upstream-co","ProduceID":"p-1"}`
	source := seedLocalVideoResource(t, svc, "usr-render-test", 768, 1344, map[string]string{"AIGC": sourceTag, "comment": "upstream comment"})
	project := renderTestProject("resource:" + source.ID)
	project.Width, project.Height, project.DurationMs = 1080, 1920, 1000
	project.Clips[0].DurationMs = 1000
	task := seedRunningRenderTask(t, db, renderInputJSON(t, project))

	if err := newTaskWorkerCoordinator(svc).processTimelineRender(task, context.Background()); err != nil {
		t.Fatalf("process: %v", err)
	}
	var stored model.Task
	if err := db.First(&stored, "id = ?", task.ID).Error; err != nil {
		t.Fatal(err)
	}
	if stored.Status != model.TaskStatusSucceeded {
		t.Fatalf("status = %s, error = %s", stored.Status, stored.Error)
	}
	var result timelineRenderOutput
	if err := json.Unmarshal([]byte(stored.ResultJSON), &result); err != nil {
		t.Fatal(err)
	}
	if result.Width != 1080 || result.Height != 1920 || result.Fit != renderFitAuto || len(result.Sources) != 1 {
		t.Fatalf("result = %+v", result)
	}
	if record := result.Sources[0]; record.ResourceID != source.ID || record.Fit != renderFitCrop || record.Width != 768 || record.Height != 1344 || record.AIGC != sourceTag {
		t.Fatalf("source record = %+v", record)
	}
	var label aigcImplicitLabel
	if err := json.Unmarshal([]byte(result.AIGC), &label); err != nil {
		t.Fatalf("result aigc: %v", err)
	}
	if label.Label != "1" || label.ContentProducer != "upstream-co" || label.ProduceID != "p-1" || label.PropagateID != task.ID || label.ContentPropagator != AIGCPlatformPropagator {
		t.Fatalf("label = %+v", label)
	}

	output, err := svc.repo.ResourceForUser("usr-render-test", result.ResourceID)
	if err != nil {
		t.Fatal(err)
	}
	info, err := probeMediaFile(context.Background(), filepath.Join(svc.dataDir, "resources", filepath.FromSlash(output.ObjectKey)))
	if err != nil {
		t.Fatal(err)
	}
	if info.Width != 1080 || info.Height != 1920 {
		t.Fatalf("output size = %dx%d", info.Width, info.Height)
	}
	if got := mediaProbeTag(info.Tags, "AIGC"); got != result.AIGC {
		t.Fatalf("output AIGC tag = %q, want %q", got, result.AIGC)
	}
	if got := mediaProbeTag(info.Tags, "comment"); got != renderAIGCComment {
		t.Fatalf("output comment = %q: source metadata leaked or label missing", got)
	}
}
