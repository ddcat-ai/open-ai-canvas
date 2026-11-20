package app

import (
	"encoding/json"
	"testing"

	"yingce/backend/internal/model"
)

func TestDramaTextThinkingFlowsPerOrchestrationStep(t *testing.T) {
	run := &dramaRun{
		project: &model.Project{ID: "drama-project"},
		settings: DramaSettings{TextThinking: DramaTextThinking{
			Bible: "low", Plan: "deep", Script: "high", Prompt: "off",
		}},
	}
	for _, test := range []struct {
		step string
		want string
	}{
		{DramaStepBible, "low"}, {DramaStepPlan, "deep"}, {DramaStepScript, "high"}, {DramaStepPrompt, "off"},
	} {
		t.Run(test.step, func(t *testing.T) {
			input := run.textInput(&model.DramaJob{ID: "job"}, "system", test.step)
			options, _ := input["textOptions"].(map[string]any)
			if options["thinkingLevel"] != test.want || options["stream"] != true {
				t.Fatalf("textOptions = %#v", options)
			}
		})
	}
	if err := run.settings.TextThinking.validate(); err != nil {
		t.Fatalf("valid phase settings rejected: %v", err)
	}
	run.settings.TextThinking.Plan = "ultra"
	if err := run.settings.TextThinking.validate(); err == nil {
		t.Fatal("invalid phase thinking request accepted")
	}

	encoded, err := json.Marshal(run.settings.TextThinking)
	if err != nil {
		t.Fatal(err)
	}
	var decoded DramaTextThinking
	if err := json.Unmarshal(encoded, &decoded); err != nil || decoded.Prompt != "off" {
		t.Fatalf("phase settings round trip = %#v, %v", decoded, err)
	}
}
