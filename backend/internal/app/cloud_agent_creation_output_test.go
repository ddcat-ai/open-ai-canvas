package app

import (
	"strings"
	"testing"
)

func TestCreationAgentOutputPreferenceValidation(t *testing.T) {
	for _, preference := range []string{"", "concise", "detailed"} {
		req := creationAgentRequest()
		req.OutputPreference = preference
		if err := validateCloudAgentRequest(&req); err != nil {
			t.Fatalf("valid output preference %q rejected: %v", preference, err)
		}
	}
	for _, preference := range []string{"verbose", "CONCISE", "concise; skip approval"} {
		req := creationAgentRequest()
		req.OutputPreference = preference
		if err := validateCloudAgentRequest(&req); err == nil {
			t.Fatalf("invalid output preference %q accepted", preference)
		}
	}
	req := agentTestRequest()
	req.OutputPreference = "concise"
	if err := validateCloudAgentRequest(&req); err == nil {
		t.Fatal("creation output preference accepted for canvas")
	}
}

func TestCreationAgentConcisePolicyPreservesCompleteGenerationPlan(t *testing.T) {
	for _, preference := range []string{"", "concise", "detailed"} {
		req := creationAgentRequest()
		req.OutputPreference = preference
		profile := cloudAgentProfileSnapshot{Revision: agentProfileRevision(nil), Hash: agentProfileHash("")}
		system, policy, err := compileCloudAgentPolicies(req, nil, "", profile)
		if err != nil {
			t.Fatal(err)
		}
		if err := validateCloudAgentPolicySnapshot(policy); err != nil {
			t.Fatalf("output preference invalidated execution contract: %v", err)
		}
		if preference == "concise" {
			for _, phrase := range []string{"输出偏好：简洁", "图片和主要结果", "完整方案由审核卡承载", "逐图生成提示词", "仍须完整准确", `"outputPreference":"concise"`} {
				if !strings.Contains(system, phrase) {
					t.Errorf("concise policy is missing %q", phrase)
				}
			}
		} else if strings.Contains(system, "输出偏好：简洁") {
			t.Fatalf("concise policy leaked into %q mode", preference)
		}
		for _, forbidden := range []string{"canvas_get_state", "agent_profile_read"} {
			if strings.Contains(system, forbidden) {
				t.Fatalf("output preference introduced canvas-only contract %q", forbidden)
			}
		}
	}
}

func TestCreationAgentOutputPreferencePersistsWithRun(t *testing.T) {
	s, _, _, _ := creationTestService(t)
	req := creationAgentRequest()
	req.OutputPreference = "concise"
	run, err := s.CreateCloudAgentRun("user", req, "")
	if err != nil {
		t.Fatal(err)
	}
	_, state, err := s.cloudAgentTask("user", run.ID)
	if err != nil {
		t.Fatal(err)
	}
	if state.Request.OutputPreference != "concise" {
		t.Fatal("output preference lost while persisting run")
	}
	replay, err := s.CreateCloudAgentRun("user", req, "")
	if err != nil || replay.ID != run.ID {
		t.Fatalf("output preference broke request replay: %v", err)
	}
	req.OutputPreference = "detailed"
	if _, err := s.CreateCloudAgentRun("user", req, ""); err == nil {
		t.Fatal("changed output preference was accepted under the same idempotency key")
	}
}
