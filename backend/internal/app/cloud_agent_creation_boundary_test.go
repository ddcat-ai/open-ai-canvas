package app

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
	"time"

	"infinite-canvas/backend/internal/model"
)

func TestCreationPolicyHasNoCanvasWorkflowOrMemoryTools(t *testing.T) {
	req := creationAgentRequest()
	req.PermissionMode = "auto"
	req.MediaSettings = &CloudAgentCreationMedia{Image: &CloudAgentCreationMediaChoice{ParameterMode: "auto"}}
	profile := cloudAgentProfileSnapshot{Revision: agentProfileRevision(nil), Hash: agentProfileHash("")}
	system, policy, err := compileCloudAgentPolicies(req, nil, "", profile)
	if err != nil {
		t.Fatal(err)
	}
	if err := validateCloudAgentPolicySnapshot(policy); err != nil {
		t.Fatal(err)
	}
	if policy.SystemPolicyID == "cloud-agent-system" || policy.MediaPolicyID == "cloud-agent-media" {
		t.Error("creation still uses canvas policy identities")
	}
	tools, _ := json.Marshal(compileCloudAgentTools(req, true))
	for _, forbidden := range []string{"canvas_get_state", "canvas_inspect_image", "canvas_apply_ops", "snapshotHash", "节点能力速查", "model_list", "agent_profile_read", "recall_lessons", "remember_lesson"} {
		if strings.Contains(system, forbidden) || strings.Contains(string(tools), forbidden) {
			t.Errorf("creation carries canvas-only contract %q", forbidden)
		}
	}
	canvasSystem, canvasPolicy, err := compileCloudAgentPolicies(agentTestRequest(), nil, "", profile)
	if err != nil || canvasPolicy.SystemPolicyID != "cloud-agent-system" || !strings.Contains(canvasSystem, "先调用 `canvas_get_state`") {
		t.Fatalf("canvas contract changed: %v", err)
	}
}

func TestCreationAdmissionDoesNotLoadCanvasProfileOrLessons(t *testing.T) {
	s, db, _, _ := creationTestService(t)
	saveAgentProfileForTest(t, s, "user", AgentProfileRequest{Scope: model.AgentProfileScopeUser, Content: "CANVAS_PROFILE_MUST_NOT_LEAK", Revision: 0})
	now := time.Now()
	if err := db.Create(&model.AgentLesson{ID: newID(), AuthorUserID: "user", Topic: "canvas.only", Situation: "CANVAS_MEMORY_MUST_NOT_LEAK", Lesson: "先读画布", Status: model.AgentLessonStatusApproved, CreatedAt: now, UpdatedAt: now}).Error; err != nil {
		t.Fatal(err)
	}
	run, err := s.CreateCloudAgentRun("user", creationAgentRequest(), "")
	if err != nil {
		t.Fatal(err)
	}
	task, admitted, err := s.cloudAgentTask("user", run.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(admitted.Profile.Layers) != 0 || strings.Contains(task.InputJSON, "CANVAS_MEMORY_MUST_NOT_LEAK") || strings.Contains(task.InputJSON, "CANVAS_PROFILE_MUST_NOT_LEAK") {
		t.Fatal("creation admission inherited canvas profile or personal memory")
	}
	var input map[string]any
	if err := json.Unmarshal([]byte(task.InputJSON), &input); err != nil {
		t.Fatal(err)
	}
	canonical := stateCanonicalFromInput(input)
	state := &cloudAgentRuntime{Request: admitted.Request, Profile: admitted.Profile, Policy: admitted.Policy}
	request, err := s.buildEnhancedPiRequest(context.Background(), EnhancedPiRequestParams{UserID: "user", RunID: run.ID, ModelID: "text-test", RuntimeState: state, Canonical: &canonical, SystemPrompt: canonical.SystemPrompt})
	if err != nil {
		t.Fatal(err)
	}
	if request.Profile != nil || request.Canvas != nil || request.Memory["enabled"] != false || request.Features["memoryEnabled"] != false {
		t.Fatalf("creation Pi request contains canvas capability: %#v", request)
	}
}

func TestCreationTaskReadAllowsSameSessionButNotOtherSurfaces(t *testing.T) {
	s, db, _, _ := creationTestService(t)
	state := &cloudAgentRuntime{Request: creationAgentRequest()}
	state.Request.SessionID = "session-current"
	for _, test := range []struct {
		name, surface, session, user, project string
		allowed                               bool
	}{
		{"prior-turn", "creation", "session-current", "user", "", true},
		{"other-session", "creation", "session-other", "user", "", false},
		{"canvas", "canvas", "session-current", "user", "agent-canvas", false},
		{"foreign", "creation", "session-current", "other", "", false},
	} {
		runID, taskID := "scope-run-"+test.name, "scope-task-"+test.name
		if err := db.Create(&model.CloudAgentExecution{ID: runID, UserID: test.user, SessionID: test.session, Surface: test.surface}).Error; err != nil {
			t.Fatal(err)
		}
		if err := db.Create(&model.Task{ID: taskID, UserID: test.user, AgentRunID: runID, ProjectID: test.project, Type: "canvas_image", Status: model.TaskStatusSucceeded, ResultJSON: `{}`}).Error; err != nil {
			t.Fatal(err)
		}
		call := cloudAgentStoryboardCall(t, "task_get", "read-"+test.name, map[string]any{"taskId": taskID})
		_, err := cloudAgentReadTool(s.repo, "user", state, call, s)
		if (err == nil) != test.allowed {
			t.Fatalf("%s task authorization mismatch: %v", test.name, err)
		}
	}
}
