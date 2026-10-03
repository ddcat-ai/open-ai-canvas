package protocol

import (
	"strings"
	"testing"
)

func smartCreationManifest(contribution string) []byte {
	return []byte(`{"apiVersion":"yingce.plugin/v2","id":"smart-test","name":"Smart Test","version":"1.0.0","permissions":["ai.text"],"contributes":{"smartCreation":` + contribution + `}}`)
}

func TestSmartCreationContributionSurvivesManifestDecoding(t *testing.T) {
	manifest, err := decodeManifest(smartCreationManifest(`{"entry":"smart-creation","label":"智能创作","planner":{"systemPrompt":["规划","只返回 JSON"],"tool":{"name":"create_plan","parameters":{"type":"object"}}},"defaults":{"platforms":{}},"execution":{"maxConcurrency":3}}`))
	if err != nil {
		t.Fatal(err)
	}
	config := manifest.Contributes.SmartCreation
	if config == nil || config.Entry != SmartCreationEntry || config.Label != "智能创作" {
		t.Fatalf("smartCreation contribution = %#v", config)
	}
	if !strings.Contains(string(config.Planner), "create_plan") || !strings.Contains(string(config.Execution), "maxConcurrency") {
		t.Fatalf("smartCreation raw sections were not preserved: %#v", config)
	}
}

func TestSmartCreationContributionRejectsInvalidBoundaries(t *testing.T) {
	cases := map[string]string{
		"entry":         `{"entry":"homepage"}`,
		"section shape": `{"entry":"smart-creation","execution":[1,2]}`,
		"empty prompt":  `{"entry":"smart-creation","planner":{"systemPrompt":"  "}}`,
		"prompt items":  `{"entry":"smart-creation","planner":{"systemPrompt":["ok",1]}}`,
		"tool name":     `{"entry":"smart-creation","planner":{"tool":{"name":"bad name","parameters":{}}}}`,
		"tool schema":   `{"entry":"smart-creation","planner":{"tool":{"name":"ok","parameters":"schema"}}}`,
	}
	for name, contribution := range cases {
		if _, err := decodeManifest(smartCreationManifest(contribution)); err == nil {
			t.Fatalf("%s: invalid smartCreation contribution was accepted", name)
		}
	}
}
