package app

import (
	"testing"
)

func TestCreationDiscoversOnlyInstalledCompatibleSkillsWithoutExplicitSelection(t *testing.T) {
	s, _, _, _ := creationTestService(t)
	available := surfaceSkillForTest(t, s, "agentSurfaces: [\"creation\"]\n")
	canvasOnly := surfaceSkillForTest(t, s, "agentSurfaces: [\"canvas\"]\n")
	req := creationAgentRequest()
	req.SkillIDs = nil
	run, err := s.CreateCloudAgentRun("user", req, "")
	if err != nil {
		t.Fatal(err)
	}
	_, admitted, err := s.cloudAgentTask("user", run.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(admitted.Skills) != 1 || admitted.Skills[0].ID != available {
		t.Fatalf("creation candidates = %+v; canvas-only %s must be excluded", admitted.Skills, canvasOnly)
	}
	state := &cloudAgentRuntime{Request: admitted.Request, Skills: admitted.Skills}
	search := cloudAgentCall{ID: "discover"}
	search.Function.Name, search.Function.Arguments = "skill_search", `{}`
	if _, err := cloudAgentReadTool(s.repo, "user", state, search, s); err != nil {
		t.Fatalf("candidate discovery unavailable: %v", err)
	}
	if _, err := cloudAgentReadTool(s.repo, "user", state, skillFeedbackCall(canvasOnly, "SKILL.md"), s); err == nil {
		t.Fatal("canvas-only skill reachable from creation")
	}
}
