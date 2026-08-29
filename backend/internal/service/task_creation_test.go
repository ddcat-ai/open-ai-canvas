package service

import (
	"strings"
	"testing"

	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/repository"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func TestTaskInputUsesWorkflowProvider(t *testing.T) {
	tests := []struct {
		name  string
		input map[string]any
		want  bool
	}{
		{name: "runninghub workflow", input: map[string]any{"config": map[string]any{"interfaceType": "runninghub-workflow-video"}}, want: true},
		{name: "comfy bridge", input: map[string]any{"config": map[string]any{"interfaceType": "comfyui-bridge-image"}}, want: true},
		{name: "case insensitive", input: map[string]any{"config": map[string]any{"interfaceType": "RunningHub-Workflow-Audio"}}, want: true},
		{name: "ordinary model", input: map[string]any{"config": map[string]any{"interfaceType": "openai-image", "channelId": "system-1", "model": "image-model"}}, want: false},
		{name: "missing config", input: map[string]any{}, want: false},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if got := taskInputUsesWorkflowProvider(test.input); got != test.want {
				t.Fatalf("taskInputUsesWorkflowProvider() = %v, want %v", got, test.want)
			}
			if test.want && taskInputUsesCustomChannel(test.input) {
				t.Fatal("workflow input must not be classified as a custom channel")
			}
		})
	}
}

func TestResolveTaskModelSelectionAllowsExplicitSystemChannelWhenFrontendModelsEnabled(t *testing.T) {
	db, err := gorm.Open(sqlite.Open("file:"+newID()+"?mode=memory&cache=shared"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&model.ModelChannel{}, &model.ChannelModel{}, &model.ChannelModelPriceTier{}); err != nil {
		t.Fatal(err)
	}
	channel := model.ModelChannel{ID: "channel-1", Scope: model.ChannelScopeSystem, Enabled: true, Name: "Agnes"}
	channelModel := model.ChannelModel{
		ID: "channel-model-1", ChannelID: channel.ID, ModelKey: "agnes-video-2.5", Capability: "video",
		Protocol: model.ChannelInterfaceNewAPIVideo, BillingMode: "per_second", PriceConfigured: true, Enabled: true,
	}
	if err := db.Create(&channel).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&channelModel).Error; err != nil {
		t.Fatal(err)
	}
	input, err := normalizeTaskInput(map[string]any{
		"mode":   "video",
		"config": providerConfig{ChannelID: channel.ID, Model: channelModel.ModelKey, InterfaceType: string(channelModel.Protocol)},
	})
	if err != nil {
		t.Fatal(err)
	}

	routed, resolvedInput, err := (&Service{repo: repository.New(db)}).resolveTaskModelSelection(input, "", "canvas_video", "", true)
	if err != nil {
		t.Fatalf("resolveTaskModelSelection() error = %v", err)
	}
	if routed != nil || resolvedInput["config"] == nil {
		t.Fatalf("resolveTaskModelSelection() routed = %#v, input = %#v", routed, resolvedInput)
	}
}

func TestResolveTaskModelSelectionAllowsCustomImageChannelWhenFrontendModelsEnabled(t *testing.T) {
	input := map[string]any{
		"mode": "image",
		"config": map[string]any{
			"baseUrl":       "https://images.example.com/v1",
			"apiKey":        "custom-key",
			"interfaceType": "openai-image",
			"model":         "custom-image-model",
		},
	}

	routed, resolvedInput, err := (&Service{}).resolveTaskModelSelection(input, "", "canvas_image", "image", true)
	if err != nil {
		t.Fatalf("resolveTaskModelSelection() error = %v", err)
	}
	if routed != nil || resolvedInput["config"] == nil {
		t.Fatalf("resolveTaskModelSelection() routed = %#v, input = %#v", routed, resolvedInput)
	}
}

func TestResolveTaskModelSelectionStillRequiresLogicalModelWithoutExplicitSystemChannel(t *testing.T) {
	_, _, err := (&Service{}).resolveTaskModelSelection(map[string]any{
		"mode":   "video",
		"config": map[string]any{"model": "agnes-video-2.5"},
	}, "", "canvas_video", "", true)
	if err == nil || !strings.Contains(err.Error(), "logicalModelId") {
		t.Fatalf("resolveTaskModelSelection() error = %v, want logicalModelId validation", err)
	}
}
