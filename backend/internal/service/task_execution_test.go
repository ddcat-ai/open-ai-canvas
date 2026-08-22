package service

import (
	"context"
	"testing"

	"infinite-canvas/backend/internal/model"
)

func TestCanRunProviderTaskRequiresVideoConfig(t *testing.T) {
	tests := []struct {
		name string
		task model.Task
		want bool
	}{
		{
			name: "channel config",
			task: model.Task{Type: "video_generate", InputJSON: `{"mode":"video","config":{"model":"veo","channelId":"channel-1"}}`},
			want: true,
		},
		{
			name: "direct config",
			task: model.Task{Type: "video_generate", InputJSON: `{"mode":"video","config":{"model":"veo","baseUrl":"https://example.test","apiKey":"secret"}}`},
			want: true,
		},
		{
			name: "missing model",
			task: model.Task{Type: "video_generate", InputJSON: `{"mode":"video","config":{"channelId":"channel-1"}}`},
			want: false,
		},
		{
			name: "missing direct credentials",
			task: model.Task{Type: "video_generate", InputJSON: `{"mode":"video","config":{"model":"veo","baseUrl":"https://example.test"}}`},
			want: false,
		},
		{
			name: "non video task",
			task: model.Task{Type: "agent_storyboard", InputJSON: `{"mode":"video","config":{"model":"veo","channelId":"channel-1"}}`},
			want: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := canRunProviderTask(tt.task); got != tt.want {
				t.Fatalf("canRunProviderTask() = %v, want %v", got, tt.want)
			}
		})
	}
}

func TestProcessTaskRejectsVideoTaskWithoutProviderConfig(t *testing.T) {
	svc := &Service{}
	_, _, err := svc.processTask(context.Background(), model.Task{
		Type:      "video_generate",
		InputJSON: `{"mode":"video","config":{"model":""}}`,
	})
	if err == nil {
		t.Fatal("processTask() error = nil, want missing provider configuration error")
	}
	if err.Error() != "视频任务缺少可执行的模型配置" {
		t.Fatalf("processTask() error = %q, want explicit provider configuration error", err)
	}
}

func TestValidateTaskType(t *testing.T) {
	tests := []struct {
		name     string
		taskType string
		wantErr  bool
	}{
		{name: "missing", taskType: "", wantErr: true},
		{name: "canvas image", taskType: "canvas_image"},
		{name: "storyboard rows", taskType: "agent_storyboard_rows"},
		{name: "video operation", taskType: "video_image_to_video"},
		{name: "unknown canvas type", taskType: "canvas_unknown", wantErr: true},
		{name: "unknown type", taskType: "workflow_router", wantErr: true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if err := validateTaskType(tt.taskType); (err != nil) != tt.wantErr {
				t.Fatalf("validateTaskType(%q) error = %v, wantErr %v", tt.taskType, err, tt.wantErr)
			}
		})
	}
}

func TestProcessTaskRejectsUnknownType(t *testing.T) {
	_, _, err := (&Service{}).processTask(context.Background(), model.Task{
		Type:      "workflow_router",
		InputJSON: `{}`,
	})
	if err == nil {
		t.Fatal("processTask() error = nil, want unsupported task type error")
	}
	if err.Error() != "不支持的任务类型：workflow_router" {
		t.Fatalf("processTask() error = %q, want unsupported task type error", err)
	}
}
