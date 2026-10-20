package app

import (
	"testing"

	"yingce/backend/internal/model"
)

func TestCloudAgentPiPermissionsUsePersistedCanvasAndRequestMode(t *testing.T) {
	s, db, _, _ := creationTestService(t)
	if err := db.Create(&model.CanvasProject{ID: "permissions-canvas", UserID: "user", PayloadJSON: "{\"nodes\":[],\"connections\":[],\"metadata\":{\"collaborators\":[{\"userId\":\"other\",\"role\":\"admin\"}]}}"}).Error; err != nil {
		t.Fatal(err)
	}
	for _, mode := range []string{"auto", "request_approval", "read_only"} {
		t.Run(mode, func(t *testing.T) {
			permissions, err := s.buildPermissionsConfig("user", "permissions-canvas", mode)
			if err != nil {
				t.Fatal(err)
			}
			if permissions["canReadCanvas"] != true {
				t.Fatal("owned persisted canvas was not readable")
			}
			for _, field := range []string{"canWriteCanvas", "canCreateNodes", "canManageRelations", "canDeleteNodes", "canMoveNodes", "canDuplicateNodes", "canInviteUsers"} {
				if permissions[field] != (mode != "read_only") {
					t.Fatalf("permission %s disagrees with request mode: %+v", field, permissions)
				}
			}
		})
	}
	for _, scenario := range []struct{ user, canvas, mode string }{
		{"other", "permissions-canvas", "auto"},
		{"user", "missing-canvas", "auto"},
		{"user", "permissions-canvas", "unknown"},
	} {
		permissions, err := s.buildPermissionsConfig(scenario.user, scenario.canvas, scenario.mode)
		if err == nil || permissions != nil {
			t.Fatalf("unverified permissions were silently downgraded or granted: %+v %v", permissions, err)
		}
	}
}

func TestCloudAgentPiRequestIncludesStoryboardPreparationAndCanvasPermissions(t *testing.T) {
	s, _, _ := agentStoryboardImageFixture(t)
	req := agentTestRequest()
	req.PermissionMode = "auto"
	canonical := cloudAgentCanonical("分镜行可关联图片", nil, "准备镜头图片", req)
	state := &cloudAgentRuntime{Request: req}
	request, err := s.buildEnhancedPiRequest(t.Context(), EnhancedPiRequestParams{UserID: "user", RunID: "request-test", CanvasID: "agent-canvas", FocusNodeIDs: []string{"script"}, Prompt: "准备镜头图片", SystemPrompt: canonical.SystemPrompt, RuntimeState: state, Canonical: &canonical})
	if err != nil {
		t.Fatal(err)
	}
	if request.Permissions["canWriteCanvas"] != true || request.Permissions["canManageRelations"] != true {
		t.Fatalf("runtime incorrectly received read-only canvas permissions: %+v", request.Permissions)
	}
	for _, tool := range request.Tools {
		if tool["name"] == "canvas_prepare_storyboard_image" {
			return
		}
	}
	t.Fatal("actual runtime request omitted storyboard preparation")
}
