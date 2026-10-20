package app

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestPiSkillManifestUsesMetadataAndLeavesBodiesForReadTool(t *testing.T) {
	instruction := strings.Repeat("skill method body ", 10000)
	skills := []cloudAgentSkill{{
		ID: "skill-1", Name: "Product design", Description: "Design a product set",
		Version: "1", Hash: "sha", Instruction: instruction,
		Files: map[string]string{"SKILL.md": instruction, "references/layout.md": instruction},
	}}
	manifests := (&Service{}).buildSkillManifests(skills)
	data, err := json.Marshal(manifests)
	if err != nil {
		t.Fatal(err)
	}
	if len(data) > 1024 || strings.Contains(string(data), "skill method body") {
		t.Fatalf("Pi transport redundantly carries skill file bodies: %d bytes", len(data))
	}
	if len(manifests) != 1 || manifests[0]["name"] != "Product design" || manifests[0]["hash"] != "sha" {
		t.Fatalf("skill discovery metadata lost: %#v", manifests)
	}
	if skills[0].Files["SKILL.md"] != instruction || skills[0].Instruction != instruction {
		t.Fatal("server skill_read_file source was modified")
	}
}
