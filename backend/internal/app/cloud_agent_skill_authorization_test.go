package app

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"
	"time"

	"gorm.io/gorm"
	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"
)

// Only skill-positive fixtures opt in; creationTestService remains an ordinary user.
func skillAdministratorFixture(t *testing.T, db *gorm.DB, ids ...string) {
	t.Helper()
	for _, id := range ids {
		result := db.Model(&model.User{}).Where("id = ?", id).Updates(map[string]any{"role": model.UserRoleAdmin, "status": model.UserStatusActive})
		if result.Error != nil {
			t.Fatal(result.Error)
		}
		if result.RowsAffected == 0 {
			if err := db.Create(&model.User{ID: id, Username: "skill-admin-" + id, Role: model.UserRoleAdmin, Status: model.UserStatusActive}).Error; err != nil {
				t.Fatal(err)
			}
		}
	}
}

func assertSkillRuntimeStatus(t *testing.T, err error, status int) {
	t.Helper()
	var appErr *AppError
	if !errors.As(err, &appErr) || appErr.Status != status {
		t.Fatalf("error = %v, want HTTP %d", err, status)
	}
}

func skillAuthorizationRequest() CloudAgentRequest {
	req := agentTestRequest()
	req.CanvasID, req.ContextScope = "", nil
	return req
}

func TestCloudAgentSkillAuthorizationOrdinaryFreshConversation(t *testing.T) {
	s, _, _, _ := creationTestService(t)
	s.legacyCloudAgentRootTask = false
	req := skillAuthorizationRequest()
	req.SkillsEnabled = true // Client authority is ignored, not inherited into a run.
	run, err := s.CreateCloudAgentRun("user", req, "")
	if err != nil {
		t.Fatal(err)
	}
	execution, err := s.repo.CloudAgent("user", run.ID)
	if err != nil {
		t.Fatal(err)
	}
	state, err := cloudAgentDecode(execution)
	if err != nil {
		t.Fatal(err)
	}
	if state.Request.SkillsEnabled || len(state.Skills) != 0 || len(state.SkillVersions) != 0 || state.SkillHints != "" || strings.Contains(state.Canonical.SystemPrompt, cloudAgentSkillCatalogHeader) {
		t.Fatalf("ordinary conversation acquired skills: %#v", state.SkillVersions)
	}
	for _, tool := range state.Canonical.Tools {
		fn, _ := tool["function"].(map[string]any)
		if cloudAgentIsSkillTool(stringField(fn, "name")) {
			t.Fatalf("ordinary conversation exposes %v", fn["name"])
		}
	}
	admin, names, err := s.CloudAgentSkillCapabilities("user")
	if err != nil || admin {
		t.Fatalf("capabilities = %v, %v", admin, err)
	}
	for _, name := range names {
		if cloudAgentIsSkillTool(name) {
			t.Fatalf("ordinary capabilities contain %s", name)
		}
	}
	if prompt, err := s.EcommerceSkillPrompt("user", nil); err != nil || prompt != "" {
		t.Fatalf("ordinary ecommerce without skills failed: %q, %v", prompt, err)
	}
}

func TestCloudAgentSkillAuthorizationRejectsExplicitSkills(t *testing.T) {
	s, _, _, _ := creationTestService(t)
	for _, test := range []struct {
		name string
		ids  []string
		text string
	}{{"pinned", []string{"private-skill"}, "hello"}, {"mention", nil, "使用 @[skill:private-skill]"}} {
		t.Run(test.name, func(t *testing.T) {
			req := skillAuthorizationRequest()
			req.PinnedSkillIDs, req.Prompt = test.ids, test.text
			_, err := s.CreateCloudAgentRun("user", req, "")
			assertSkillRuntimeStatus(t, err, 403)
			_, err = s.cloudAgentBuildSkillPool("user", test.text, test.ids, defaultCloudAgentContextBudget())
			assertSkillRuntimeStatus(t, err, 403)
		})
	}
	_, err := s.CloudAgentSkillUsage("user")
	assertSkillRuntimeStatus(t, err, 403)
}

func TestCloudAgentSkillAuthorizationCachedReadChecksCurrentRole(t *testing.T) {
	s, db, _, _ := creationTestService(t)
	skillAdministratorFixture(t, db, "user")
	skill, err := s.CreateSkill("user", SkillMutationRequest{SkillName: "管理员技能", Description: "保密工作法", Instruction: "# 管理员技能\n\nsecret-body", IsPrivate: true, Tag: "others"})
	if err != nil {
		t.Fatal(err)
	}
	pool, err := s.cloudAgentBuildSkillPool("user", "hello", nil, defaultCloudAgentContextBudget())
	if err != nil {
		t.Fatal(err)
	}
	state := &cloudAgentRuntime{SkillVersions: pool.Versions}
	call := skillFeedbackCall(skill.SkillID, "SKILL.md")
	if _, err := cloudAgentReadToolCached(s.repo, "user", state, call, s); err != nil {
		t.Fatal(err)
	}
	if len(state.ToolReadResults) == 0 {
		t.Fatal("fixture did not populate cache")
	}
	if err := db.Model(&model.User{}).Where("id = ?", "user").Update("role", model.UserRoleUser).Error; err != nil {
		t.Fatal(err)
	}
	for _, withService := range []bool{true, false} {
		var err error
		if withService {
			_, err = cloudAgentReadToolCached(s.repo, "user", state, call, s)
		} else {
			_, err = cloudAgentReadToolCached(s.repo, "user", state, call)
		}
		assertSkillRuntimeStatus(t, err, 403)
	}
	_, err = cloudAgentReadTool(s.repo, "user", state, call, s)
	assertSkillRuntimeStatus(t, err, 403)
	for _, name := range []string{"skill_market_search", "skill_recommend", "skills_load"} {
		call.Function.Name = name
		_, err := cloudAgentReadToolCached(s.repo, "user", state, call, s)
		assertSkillRuntimeStatus(t, err, 403)
	}
}

func TestCloudAgentSkillAuthorizationPreservesCleanRuntimeAndRejectsSkillSnapshots(t *testing.T) {
	s, db, _, _ := creationTestService(t)
	clean := &cloudAgentRuntime{Request: skillAuthorizationRequest(), Canonical: canonicalAgentRequest{Tools: cloudAgentTools(skillAuthorizationRequest())}}
	if err := s.cloudAgentCheckSkillExecution("user", clean, nil, `{"type":"message","message":{"role":"user","content":"tell me about skill-based games"}}`); err != nil {
		t.Fatal(err)
	}
	for _, mutate := range []func(*cloudAgentRuntime){
		func(state *cloudAgentRuntime) {
			state.Skills = []cloudAgentSkill{{ID: "old", Instruction: "secret-body"}}
		},
		func(state *cloudAgentRuntime) { state.SkillVersions = map[string]string{"old": "v1"} },
		func(state *cloudAgentRuntime) { state.SkillHints = "old skill context" },
		func(state *cloudAgentRuntime) { state.Request.SkillsEnabled = true },
		func(state *cloudAgentRuntime) {
			state.Canonical.Messages = []map[string]any{{"role": "assistant", "tool_calls": []any{map[string]any{"id": "read", "function": map[string]any{"name": "skill_read_file"}}}}}
		},
	} {
		state := &cloudAgentRuntime{Request: skillAuthorizationRequest()}
		mutate(state)
		err := s.cloudAgentCheckSkillExecution("user", state, nil, "")
		assertSkillRuntimeStatus(t, err, 403)
		if !strings.Contains(err.Error(), "另开无技能对话") {
			t.Fatalf("missing actionable refusal: %v", err)
		}
	}
	snapshot := `{"type":"message","message":{"role":"toolResult","toolName":"skill_read_file","content":[{"type":"text","text":"secret-body"}]}}`
	assertSkillRuntimeStatus(t, s.cloudAgentCheckSkillExecution("user", clean, nil, snapshot), 403)
	skillAdministratorFixture(t, db, "user")
	if err := s.cloudAgentCheckSkillExecution("user", &cloudAgentRuntime{Skills: []cloudAgentSkill{{ID: "old"}}}, nil, snapshot); err != nil {
		t.Fatalf("current administrator rejected: %v", err)
	}
	if err := db.Model(&model.User{}).Where("id = ?", "user").Update("role", model.UserRoleUser).Error; err != nil {
		t.Fatal(err)
	}
	assertSkillRuntimeStatus(t, s.cloudAgentCheckSkillExecution("user", &cloudAgentRuntime{Skills: []cloudAgentSkill{{ID: "old"}}}, nil, snapshot), 403)
}

func TestCloudAgentSkillAuthorizationPiSessionAndCallbacksRejectRevokedRun(t *testing.T) {
	s, db, _, _ := creationTestService(t)
	s.legacyCloudAgentRootTask = false
	skillAdministratorFixture(t, db, "user")
	run, err := s.CreateCloudAgentRun("user", skillAuthorizationRequest(), "")
	if err != nil {
		t.Fatal(err)
	}
	execution, err := s.repo.CloudAgent("user", run.ID)
	if err != nil {
		t.Fatal(err)
	}
	state, err := cloudAgentDecode(execution)
	if err != nil {
		t.Fatal(err)
	}
	state.SkillVersions = map[string]string{"old": "v1"}
	call := skillFeedbackCall("old", "SKILL.md")
	state.Calls = []cloudAgentCall{call}
	state.Canonical.Messages = append(state.Canonical.Messages, map[string]any{"role": "assistant", "content": "", "tool_calls": []cloudAgentCall{call}})
	cloudAgentToolResult(run.ID, &state, call, map[string]any{"content": "secret-body"}, nil)
	if err := s.repo.MutateCloudAgent("user", run.ID, execution.Revision, func(current *model.CloudAgentExecution, _ *repository.Repository) error {
		return cloudAgentSave(current, &state)
	}); err != nil {
		t.Fatal(err)
	}
	if err := db.Model(&model.User{}).Where("id = ?", "user").Update("role", model.UserRoleUser).Error; err != nil {
		t.Fatal(err)
	}
	assertSkillRuntimeStatus(t, s.runCloudAgentPiSession(context.Background(), "user", run.ID), 403)
	_, err = s.executeCloudAgentRuntimeTool(context.Background(), "user", run.ID, call)
	assertSkillRuntimeStatus(t, err, 403)
	payload := map[string]json.RawMessage{"callId": json.RawMessage(`"call"`), "name": json.RawMessage(`"skill_read_file"`), "arguments": json.RawMessage(`[]`)}
	_, err = s.cloudAgentPiTool(context.Background(), "user", run.ID, payload)
	assertSkillRuntimeStatus(t, err, 403)
	payload["name"] = json.RawMessage(`"plan_update"`)
	_, err = s.cloudAgentPiTool(context.Background(), "user", run.ID, payload)
	assertSkillRuntimeStatus(t, err, 403)
	_, _, err = s.runCloudAgentModelStep(context.Background(), "user", run.ID, []map[string]any{{"role": "user", "content": "continue"}}, "off")
	assertSkillRuntimeStatus(t, err, 403)
	stored, err := s.repo.CloudAgent("user", run.ID)
	if err != nil || len(stored.Transcript) == 0 {
		t.Fatalf("refusal removed receipts: %v", err)
	}
}

func TestCloudAgentSkillAuthorizationContinuationRejectsOldPiSkillSnapshot(t *testing.T) {
	s, db, _, _ := creationTestService(t)
	s.legacyCloudAgentRootTask = false
	req := skillAuthorizationRequest()
	run, err := s.CreateCloudAgentRun("user", req, "")
	if err != nil {
		t.Fatal(err)
	}
	if err := db.Model(&model.Task{}).Where("id = ?", run.ID).Updates(map[string]any{"status": model.TaskStatusSucceeded, "result_json": `{"text":"done"}`}).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Model(&model.CloudAgentExecution{}).Where("id = ?", run.ID).Update("status", "completed").Error; err != nil {
		t.Fatal(err)
	}
	if stored, err := s.repo.CloudAgentPiSession("user", run.ID); err == nil && stored.SessionJSONL != "" {
		t.Fatal("unexpected initial Pi snapshot")
	}
	next := req
	next.IdempotencyKey = "ordinary-clean-continuation"
	if _, err := s.CreateCloudAgentRun("user", next, run.ID); err != nil {
		t.Fatalf("ordinary conversation without skills cannot continue: %v", err)
	}
	snapshot := `{"type":"message","message":{"role":"toolResult","toolName":"skill_read_file","content":[{"type":"text","text":"secret-body"}]}}`
	if err := db.Create(&model.CloudAgentPiSession{RunID: run.ID, UserID: "user", SessionJSONL: snapshot, UpdatedAt: time.Now()}).Error; err != nil {
		t.Fatal(err)
	}
	req.IdempotencyKey = "ordinary-continuation-after-old-skill"
	_, err = s.CreateCloudAgentRun("user", req, run.ID)
	assertSkillRuntimeStatus(t, err, 403)
	stored, err := s.repo.CloudAgentPiSession("user", run.ID)
	if err != nil || stored.SessionJSONL != snapshot {
		t.Fatalf("refusal deleted the prior session: %v", err)
	}
}

func TestCloudAgentSkillAuthorizationAdministratorEmptyLibraryCanUseMarket(t *testing.T) {
	s, db, _, _ := creationTestService(t)
	s.legacyCloudAgentRootTask = false
	skillAdministratorFixture(t, db, "user")
	run, err := s.CreateCloudAgentRun("user", skillAuthorizationRequest(), "")
	if err != nil {
		t.Fatal(err)
	}
	execution, err := s.repo.CloudAgent("user", run.ID)
	if err != nil {
		t.Fatal(err)
	}
	state, err := cloudAgentDecode(execution)
	if err != nil {
		t.Fatal(err)
	}
	market := false
	for _, tool := range state.Canonical.Tools {
		fn, _ := tool["function"].(map[string]any)
		market = market || stringField(fn, "name") == "skill_market_search"
	}
	if !market || state.Request.SkillsEnabled {
		t.Fatal("empty administrator library must retain market tools without claiming readable installed skills")
	}
	if err := db.Model(&model.User{}).Where("id = ?", "user").Update("role", model.UserRoleUser).Error; err != nil {
		t.Fatal(err)
	}
	if err := s.cloudAgentCheckSkillExecution("user", &state, nil, ""); err != nil {
		t.Fatalf("unused market declarations alone must not block a normal conversation: %v", err)
	}
	for _, tool := range state.Canonical.Tools {
		fn, _ := tool["function"].(map[string]any)
		if cloudAgentIsSkillTool(stringField(fn, "name")) {
			t.Fatal("market declarations survived role revocation")
		}
	}
}

func TestCloudAgentSkillAuthorizationDramaSelectionPreservesForbidden(t *testing.T) {
	s, db, _, _ := creationTestService(t)
	ref := &DramaSkillRef{SkillID: "missing-skill", SkillName: "missing", Path: "SKILL.md"}
	_, err := s.dramaWritingSkill("user", ref, "test")
	assertSkillRuntimeStatus(t, err, 403)
	for _, empty := range []*DramaSkillRef{nil, {}} {
		if got, err := s.dramaWritingSkill("user", empty, "test"); err != nil || got != nil {
			t.Fatalf("empty selection is not an administrator operation: %v", err)
		}
	}
	skillAdministratorFixture(t, db, "user")
	_, err = s.dramaWritingSkill("user", ref, "test")
	assertSkillRuntimeStatus(t, err, 400)
	if !strings.Contains(err.Error(), "missing") {
		t.Fatalf("administrator lost missing-skill diagnosis: %v", err)
	}
}
