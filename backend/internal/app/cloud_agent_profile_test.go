package app

import (
	"encoding/json"
	"strings"
	"testing"
	"time"

	"gorm.io/gorm"
	"infinite-canvas/backend/internal/model"
)

func cloudAgentProfileFixture(t *testing.T) (*Service, string, string) {
	s, _, projectID, canvasID := cloudAgentProfileFixtureDB(t)
	return s, projectID, canvasID
}

func cloudAgentProfileFixtureDB(t *testing.T) (*Service, *gorm.DB, string, string) {
	t.Helper()
	s, db, _, _ := creationTestService(t)
	now := time.Now()
	for _, item := range []any{
		&model.Project{ID: "project-1", UserID: "user", Name: "Agent 项目", Status: model.ProjectStatusActive, CreatedAt: now, UpdatedAt: now},
		&model.Project{ID: "project-2", UserID: "other", Name: "其他用户项目", Status: model.ProjectStatusActive, CreatedAt: now, UpdatedAt: now},
		&model.CanvasProject{ID: "agent-canvas", UserID: "user", ProjectID: "project-1", Title: "Agent 画布", PayloadJSON: `{"nodes":[],"connections":[]}`, CreatedAt: now, UpdatedAt: now},
		&model.CanvasProject{ID: "foreign-canvas", UserID: "other", ProjectID: "project-2", Title: "其他用户画布", PayloadJSON: `{"nodes":[],"connections":[]}`, CreatedAt: now, UpdatedAt: now},
	} {
		if err := db.Create(item).Error; err != nil {
			t.Fatal(err)
		}
	}
	return s, db, "project-1", "agent-canvas"
}

func saveAgentProfileForTest(t *testing.T, s *Service, userID string, req AgentProfileRequest) AgentProfileView {
	t.Helper()
	view, err := s.UpdateCloudAgentProfile(userID, req)
	if err != nil {
		t.Fatal(err)
	}
	return view
}

func TestCloudAgentProfileMergesUserProjectCanvasInOrder(t *testing.T) {
	s, projectID, canvasID := cloudAgentProfileFixture(t)
	saveAgentProfileForTest(t, s, "user", AgentProfileRequest{Scope: model.AgentProfileScopeUser, Content: "用户偏好", Revision: 0})
	saveAgentProfileForTest(t, s, "user", AgentProfileRequest{Scope: model.AgentProfileScopeProject, ProjectID: projectID, Content: "项目偏好", Revision: 0})
	view := saveAgentProfileForTest(t, s, "user", AgentProfileRequest{Scope: model.AgentProfileScopeCanvas, CanvasID: canvasID, Content: "画布偏好", Revision: 0})

	if len(view.Layers) != 3 {
		t.Fatalf("expected three profile layers, got %#v", view.Layers)
	}
	for index, scope := range []string{model.AgentProfileScopeUser, model.AgentProfileScopeProject, model.AgentProfileScopeCanvas} {
		if view.Layers[index].Scope != scope {
			t.Fatalf("profile precedence changed: %#v", view.Layers)
		}
	}
	if view.Layers[1].ProjectID != projectID || view.Layers[2].ProjectID != projectID || view.Layers[2].CanvasID != canvasID {
		t.Fatalf("profile scope identity was not normalized: %#v", view.Layers)
	}
	text := agentProfileText(view.Layers)
	if strings.Index(text, "用户偏好") > strings.Index(text, "项目偏好") || strings.Index(text, "项目偏好") > strings.Index(text, "画布偏好") {
		t.Fatalf("profile text precedence changed: %q", text)
	}
	if view.Revision == "" || view.Hash != agentProfileHash(text) {
		t.Fatal("effective profile identifiers do not match the merged document")
	}
}

func TestCloudAgentProfileOwnershipAndScopeValidation(t *testing.T) {
	s, projectID, canvasID := cloudAgentProfileFixture(t)
	tests := []struct {
		name   string
		userID string
		req    AgentProfileRequest
	}{
		{name: "foreign project update", userID: "user", req: AgentProfileRequest{Scope: model.AgentProfileScopeProject, ProjectID: "project-2", Content: "x"}},
		{name: "foreign canvas update", userID: "user", req: AgentProfileRequest{Scope: model.AgentProfileScopeCanvas, CanvasID: "foreign-canvas", Content: "x"}},
		{name: "canvas project mismatch", userID: "user", req: AgentProfileRequest{Scope: model.AgentProfileScopeCanvas, ProjectID: "project-mismatch", CanvasID: canvasID, Content: "x"}},
		{name: "user scope carries project", userID: "user", req: AgentProfileRequest{Scope: model.AgentProfileScopeUser, ProjectID: projectID, Content: "x"}},
		{name: "project scope missing id", userID: "user", req: AgentProfileRequest{Scope: model.AgentProfileScopeProject, Content: "x"}},
		{name: "canvas scope missing id", userID: "user", req: AgentProfileRequest{Scope: model.AgentProfileScopeCanvas, Content: "x"}},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if _, err := s.UpdateCloudAgentProfile(test.userID, test.req); err == nil {
				t.Fatal("invalid or foreign profile update was accepted")
			}
		})
	}
	if _, err := s.CloudAgentProfileForScope("user", "project-2", ""); err == nil {
		t.Fatal("foreign project profile was readable")
	}
	if _, err := s.CloudAgentProfileForScope("user", "", "foreign-canvas"); err == nil {
		t.Fatal("foreign canvas profile was readable")
	}
	if _, err := s.CloudAgentProfileForScope("user", "project-mismatch", canvasID); err == nil {
		t.Fatal("canvas was readable through a mismatched project")
	}
}

func TestCloudAgentProfileRevisionCASAndNormalization(t *testing.T) {
	s, _, _ := cloudAgentProfileFixture(t)
	if _, err := s.UpdateCloudAgentProfile("user", AgentProfileRequest{Scope: model.AgentProfileScopeUser, Content: "first", Revision: 1}); err == nil {
		t.Fatal("first write accepted a non-zero revision")
	}
	first := saveAgentProfileForTest(t, s, "user", AgentProfileRequest{Scope: model.AgentProfileScopeUser, Content: "  first  \n", Revision: 0})
	layer := first.Layers[0]
	if layer.Revision != 1 || layer.Content != "first" || layer.Hash != agentProfileHash("first") {
		t.Fatalf("first revision was not normalized: %#v", layer)
	}
	if _, err := s.UpdateCloudAgentProfile("user", AgentProfileRequest{Scope: model.AgentProfileScopeUser, Content: "stale", Revision: 0}); err == nil {
		t.Fatal("stale profile revision was accepted")
	}
	second := saveAgentProfileForTest(t, s, "user", AgentProfileRequest{Scope: model.AgentProfileScopeUser, Content: "second", Revision: layer.Revision})
	if second.Layers[0].Revision != 2 || second.Layers[0].Hash != agentProfileHash("second") {
		t.Fatalf("profile revision did not advance: %#v", second.Layers[0])
	}
	blank := saveAgentProfileForTest(t, s, "user", AgentProfileRequest{Scope: model.AgentProfileScopeUser, Content: " \n\t ", Revision: second.Layers[0].Revision})
	if blank.Layers[0].Content != "" || agentProfileText(blank.Layers) != "" {
		t.Fatalf("blank profile still injects behavior text: %#v", blank)
	}
}

func TestCloudAgentProfileRejectsUnsafeContent(t *testing.T) {
	s, _, _ := cloudAgentProfileFixture(t)
	if _, err := s.UpdateCloudAgentProfile("", AgentProfileRequest{Scope: model.AgentProfileScopeUser, Content: "unowned"}); err == nil {
		t.Fatal("profile update accepted an unauthenticated owner")
	}
	tests := []struct {
		name    string
		content string
	}{
		{name: "too long", content: strings.Repeat("界", cloudAgentProfileMaxRunes+1)},
		{name: "control character", content: "safe\x00unsafe"},
		{name: "invalid utf8", content: string([]byte{0xff, 0xfe})},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if _, err := s.UpdateCloudAgentProfile("user", AgentProfileRequest{Scope: model.AgentProfileScopeUser, Content: test.content}); err == nil {
				t.Fatal("unsafe profile content was accepted")
			}
		})
	}
}

func TestCloudAgentProfileEmptyViewAndRunSnapshotAreImmutable(t *testing.T) {
	s, _, canvasID := cloudAgentProfileFixture(t)
	empty, err := s.CloudAgentProfile("user", canvasID)
	if err != nil {
		t.Fatal(err)
	}
	if len(empty.Layers) != 0 || agentProfileText(empty.Layers) != "" || empty.Hash != agentProfileHash("") {
		t.Fatalf("unexpected empty profile behavior: %#v", empty)
	}

	profile := saveAgentProfileForTest(t, s, "user", AgentProfileRequest{Scope: model.AgentProfileScopeUser, Content: "固定偏好", Revision: 0})
	req := agentTestRequest()
	req.IdempotencyKey = "profile-snapshot-run"
	req.ProfileRevision = profile.Revision
	run, err := s.CreateCloudAgentRun("user", req, "")
	if err != nil {
		t.Fatal(err)
	}
	saveAgentProfileForTest(t, s, "user", AgentProfileRequest{Scope: model.AgentProfileScopeUser, Content: "后来修改", Revision: profile.Layers[0].Revision})

	task, err := s.repo.TaskForUser("user", run.ID)
	if err != nil {
		t.Fatal(err)
	}
	var input struct {
		CloudAgent cloudAgentState `json:"cloudAgent"`
		Config     struct {
			SystemPrompt string `json:"systemPrompt"`
		} `json:"config"`
	}
	if err := json.Unmarshal([]byte(task.InputJSON), &input); err != nil {
		t.Fatal(err)
	}
	if input.CloudAgent.Policy.ProfileRevision != profile.Revision || input.CloudAgent.Policy.ProfileHash != profile.Hash {
		t.Fatalf("run profile snapshot changed: %#v", input.CloudAgent.Policy)
	}
	if strings.Contains(input.Config.SystemPrompt, "固定偏好") || strings.Contains(input.Config.SystemPrompt, "后来修改") {
		t.Fatal("profile body leaked into the system prompt")
	}
	if len(input.CloudAgent.Profile.Layers) != 1 || input.CloudAgent.Profile.Layers[0].Content != "固定偏好" {
		t.Fatal("run did not preserve the admitted profile body outside the system prompt")
	}
	state := cloudAgentRuntime{Profile: input.CloudAgent.Profile}
	call := cloudAgentCall{}
	call.Function.Name, call.Function.Arguments = "agent_profile_read", `{"scope":"user"}`
	result, err := cloudAgentReadTool(nil, "user", &state, call)
	if err != nil || result.(map[string]any)["content"] != "固定偏好" {
		t.Fatalf("fixed profile could not be read on demand: %v, %v", result, err)
	}
	if _, err := cloudAgentReadTool(nil, "user", &state, call); err == nil {
		t.Fatal("profile layer could be read repeatedly")
	}
	stale := agentTestRequest()
	stale.IdempotencyKey = "profile-stale-run"
	stale.ProfileRevision = profile.Revision
	if _, err := s.CreateCloudAgentRun("user", stale, ""); err == nil {
		t.Fatal("run admission accepted a stale profile revision")
	}
}

func TestCloudAgentContinuationReadsLatestProfileWithoutChangingParent(t *testing.T) {
	s, db, _, canvasID := cloudAgentProfileFixtureDB(t)
	firstProfile := saveAgentProfileForTest(t, s, "user", AgentProfileRequest{Scope: model.AgentProfileScopeUser, Content: "第一版专属口吻", Revision: 0})
	first := agentTestRequest()
	first.IdempotencyKey = "profile-parent-key"
	first.ProfileRevision = firstProfile.Revision
	parent, err := s.CreateCloudAgentRun("user", first, "")
	if err != nil {
		t.Fatal(err)
	}
	if err := db.Model(&model.Task{}).Where("id = ?", parent.ID).Updates(map[string]any{"status": model.TaskStatusSucceeded, "result_json": `{"text":"已完成"}`}).Error; err != nil {
		t.Fatal(err)
	}
	secondProfile := saveAgentProfileForTest(t, s, "user", AgentProfileRequest{Scope: model.AgentProfileScopeUser, Content: "第二版专属口吻", Revision: firstProfile.Layers[0].Revision})
	childRequest := agentTestRequest()
	childRequest.CanvasID = canvasID
	childRequest.IdempotencyKey = "profile-child-key"
	childRequest.ProfileRevision = secondProfile.Revision
	child, err := s.CreateCloudAgentRun("user", childRequest, parent.ID)
	if err != nil {
		t.Fatal(err)
	}
	for _, item := range []struct {
		id, wantRevision, wantText, unwantedText string
	}{
		{parent.ID, firstProfile.Revision, "第一版专属口吻", "第二版专属口吻"},
		{child.ID, secondProfile.Revision, "第二版专属口吻", "第一版专属口吻"},
	} {
		task, err := s.repo.TaskForUser("user", item.id)
		if err != nil {
			t.Fatal(err)
		}
		var input struct {
			CloudAgent cloudAgentState `json:"cloudAgent"`
			Config     struct {
				SystemPrompt string `json:"systemPrompt"`
			} `json:"config"`
		}
		if err := json.Unmarshal([]byte(task.InputJSON), &input); err != nil {
			t.Fatal(err)
		}
		if input.CloudAgent.Policy.ProfileRevision != item.wantRevision || strings.Contains(input.Config.SystemPrompt, item.wantText) || strings.Contains(input.Config.SystemPrompt, item.unwantedText) || len(input.CloudAgent.Profile.Layers) != 1 || input.CloudAgent.Profile.Layers[0].Content != item.wantText {
			t.Fatalf("run %s did not preserve its profile snapshot", item.id)
		}
	}
}

func cloudAgentToolNamesFromTaskInput(t *testing.T, raw string) []string {
	t.Helper()
	var input struct {
		AgentRequests struct {
			Canonical struct {
				Tools []map[string]any `json:"tools"`
			} `json:"canonical"`
		} `json:"agentRequests"`
	}
	if err := json.Unmarshal([]byte(raw), &input); err != nil {
		t.Fatal(err)
	}
	names := make([]string, 0, len(input.AgentRequests.Canonical.Tools))
	for _, tool := range input.AgentRequests.Canonical.Tools {
		fn, _ := tool["function"].(map[string]any)
		if name, _ := fn["name"].(string); name != "" {
			names = append(names, name)
		}
	}
	return names
}

func TestCloudAgentOmitsProfileReadWhenNoLayers(t *testing.T) {
	s, _, canvasID := cloudAgentProfileFixture(t)
	req := agentTestRequest()
	req.CanvasID = canvasID
	req.IdempotencyKey = "profile-empty-tools"
	run, err := s.CreateCloudAgentRun("user", req, "")
	if err != nil {
		t.Fatal(err)
	}
	task, err := s.repo.TaskForUser("user", run.ID)
	if err != nil {
		t.Fatal(err)
	}
	for _, name := range cloudAgentToolNamesFromTaskInput(t, task.InputJSON) {
		if name == "agent_profile_read" {
			t.Fatal("empty profile snapshot still exposed agent_profile_read")
		}
	}
	call := cloudAgentCall{}
	call.Function.Name, call.Function.Arguments = "agent_profile_read", `{"scope":"user"}`
	_, err = cloudAgentReadTool(nil, "user", &cloudAgentRuntime{}, call)
	if err == nil || !strings.Contains(err.Error(), "本轮没有长期偏好层") {
		t.Fatalf("empty profile read should refuse: %v", err)
	}
}

func TestCloudAgentProfileReadListsAvailableLayers(t *testing.T) {
	state := cloudAgentRuntime{Profile: cloudAgentProfileSnapshot{Layers: []AgentProfileLayer{{Scope: model.AgentProfileScopeUser, Content: "only-user"}}}}
	call := cloudAgentCall{}
	call.Function.Name, call.Function.Arguments = "agent_profile_read", `{"scope":"canvas"}`
	_, err := cloudAgentReadTool(nil, "user", &state, call)
	if err == nil || !strings.Contains(err.Error(), "user") || strings.Contains(err.Error(), "请只读取系统清单列出的层") {
		t.Fatalf("missing layer should list readable scopes: %v", err)
	}
}
