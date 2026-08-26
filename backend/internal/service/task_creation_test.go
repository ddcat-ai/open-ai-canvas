package service

import "testing"

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
