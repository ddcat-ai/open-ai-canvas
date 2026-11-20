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

// Creating skill content requires an administrator; consumers can remain ordinary users.
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
	if state.Request.SkillsEnabled || len(state.Skills) != 0 || len(state.SkillVersions) != 0 || state.SkillHints != "" {
		t.Fatalf("empty library acquired readable skills: %#v", state.SkillVersions)
	}
	market := false
	for _, tool := range state.Canonical.Tools {
		fn, _ := tool["function"].(map[string]any)
		market = market || stringField(fn, "name") == "skill_market_search"
	}
	if !market {
		t.Fatal("ordinary users with an empty library cannot discover market skills")
	}
	allowed, names, err := s.CloudAgentSkillCapabilities("user")
	if err != nil || !allowed {
		t.Fatalf("capabilities = %v, %v", allowed, err)
	}
	foundSkill := false
	for _, name := range names {
		foundSkill = foundSkill || name == "skill_read_file"
	}
	if !foundSkill {
		t.Fatal("ordinary capabilities omit skill reading")
	}
	if prompt, err := s.EcommerceSkillPrompt("user", nil); err != nil || prompt != "" {
		t.Fatalf("ordinary ecommerce without skills failed: %q, %v", prompt, err)
	}
}

func TestCloudAgentSkillAuthorizationRejectsUninstalledSkills(t *testing.T) {
	s, db, _, _ := creationTestService(t)
	skillAdministratorFixture(t, db, "author")
	public, err := s.CreateSkill("author", SkillMutationRequest{SkillName: "分镜构图", Description: "分镜构图方法", Instruction: "# 分镜构图\n\n步骤", Tag: "drama"})
	if err != nil {
		t.Fatal(err)
	}
	for _, test := range []struct {
		name string
		ids  []string
		text string
	}{{"pinned", []string{public.SkillID}, "hello"}, {"mention", nil, "使用 @[skill:" + public.SkillID + "]"}, {"unknown", []string{"missing-skill"}, "hello"}} {
		t.Run(test.name, func(t *testing.T) {
			req := skillAuthorizationRequest()
			req.PinnedSkillIDs, req.Prompt = test.ids, test.text
			_, err := s.CreateCloudAgentRun("user", req, "")
			assertSkillRuntimeStatus(t, err, 400)
			_, err = s.cloudAgentBuildSkillPool("user", test.text, test.ids)
			assertSkillRuntimeStatus(t, err, 400)
		})
	}
	if _, err := s.SetSkillAdded("user", public.SkillID, true); err != nil {
		t.Fatal(err)
	}
	pool, err := s.cloudAgentBuildSkillPool("user", "使用 @[skill:"+public.SkillID+"]", nil)
	if err != nil || len(pool.Pinned) != 1 || pool.Versions[public.SkillID] == "" {
		t.Fatalf("installed public skill unavailable to member: %+v, %v", pool, err)
	}
	if _, err := s.CloudAgentSkillUsage("user"); err != nil {
		t.Fatalf("ordinary user cannot read own skill usage: %v", err)
	}
}

func TestCloudAgentSkillAuthorizationCachedReadSurvivesDemotionButRejectsDisabledAccount(t *testing.T) {
	s, db, _, _ := creationTestService(t)
	skillAdministratorFixture(t, db, "user")
	skill, err := s.CreateSkill("user", SkillMutationRequest{SkillName: "管理员技能", Description: "保密工作法", Instruction: "# 管理员技能\n\nsecret-body", IsPrivate: true, Tag: "others"})
	if err != nil {
		t.Fatal(err)
	}
	pool, err := s.cloudAgentBuildSkillPool("user", "hello", nil)
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
	if _, err := cloudAgentReadToolCached(s.repo, "user", state, call, s); err != nil {
		t.Fatalf("demotion revoked skill usage: %v", err)
	}
	if err := db.Model(&model.User{}).Where("id = ?", "user").Update("status", model.UserStatusDisabled).Error; err != nil {
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

func TestCloudAgentSkillAuthorizationOrdinaryUserUsesInstalledSkills(t *testing.T) {
	s, db, _, _ := creationTestService(t)
	s.legacyCloudAgentRootTask = false
	skillAdministratorFixture(t, db, "author")
	skill, err := s.CreateSkill("author", SkillMutationRequest{SkillName: "分镜方法", Description: "公共分镜技能", Instruction: "# 分镜方法\n\n先确定镜头目标", Tag: "drama"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.SetSkillAdded("user", skill.SkillID, true); err != nil {
		t.Fatal(err)
	}
	ref := &DramaSkillRef{SkillID: skill.SkillID, SkillName: skill.SkillName, Path: "SKILL.md"}
	if writing, err := s.dramaWritingSkill("user", ref, "分镜"); err != nil || writing == nil || !strings.Contains(writing.Content, "先确定镜头目标") {
		t.Fatalf("ordinary drama cannot read installed skill: %v, %v", writing, err)
	}
	for _, mode := range []string{"auto", "pinned", "mention"} {
		t.Run(mode, func(t *testing.T) {
			req := skillAuthorizationRequest()
			req.IdempotencyKey = "ordinary-skill-" + mode
			if mode == "pinned" {
				req.PinnedSkillIDs = []string{skill.SkillID}
			}
			if mode == "mention" {
				req.Prompt = "使用 @[skill:" + skill.SkillID + "] 写分镜"
			}
			run, err := s.CreateCloudAgentRun("user", req, "")
			if err != nil {
				t.Fatal(err)
			}
			execution, err := s.repo.CloudAgent("user", run.ID)
			if err != nil {
				t.Fatal(err)
			}
			state, err := s.cloudAgentDecodeForExecution(execution)
			if err != nil || state.SkillVersions[skill.SkillID] != skill.VersionID || !state.Request.SkillsEnabled {
				t.Fatalf("installed skill missing from run: %v, %#v", err, state.SkillVersions)
			}
			if mode != "auto" && (len(state.Skills) != 1 || !strings.Contains(state.SkillHints, skill.SkillID)) {
				t.Fatalf("explicit skill missing from hints: %#v", state.Skills)
			}
			result, err := cloudAgentReadToolCached(s.repo, "user", &state, skillFeedbackCall(skill.SkillID, "SKILL.md"), s)
			if err != nil || !strings.Contains(result.(map[string]any)["content"].(string), "先确定镜头目标") {
				t.Fatalf("ordinary agent cannot read installed skill: %v, %v", result, err)
			}
		})
	}
}

func TestCloudAgentSkillCachedReadChecksCurrentAvailability(t *testing.T) {
	for _, change := range []string{"uninstalled", "disabled", "private", "updated"} {
		t.Run(change, func(t *testing.T) {
			s, db, _, _ := creationTestService(t)
			skillAdministratorFixture(t, db, "author")
			skill, err := s.CreateSkill("author", SkillMutationRequest{SkillName: "公共技能", Description: "测试技能", Instruction: "# 公共技能\n\n可用正文", Tag: "others"})
			if err != nil {
				t.Fatal(err)
			}
			if _, err := s.SetSkillAdded("user", skill.SkillID, true); err != nil {
				t.Fatal(err)
			}
			state := &cloudAgentRuntime{SkillVersions: map[string]string{skill.SkillID: skill.VersionID}}
			call := skillFeedbackCall(skill.SkillID, "SKILL.md")
			if _, err := cloudAgentReadToolCached(s.repo, "user", state, call, s); err != nil {
				t.Fatal(err)
			}
			want := 400
			switch change {
			case "uninstalled":
				_, err = s.SetSkillAdded("user", skill.SkillID, false)
			case "disabled":
				err = db.Model(&model.Skill{}).Where("id = ?", skill.SkillID).Update("status", 0).Error
			case "private":
				err = db.Model(&model.Skill{}).Where("id = ?", skill.SkillID).Update("is_private", true).Error
				want = 403
			case "updated":
				body := "# 新版本\n\n新的正文"
				_, err = s.EditSkillPackageFiles("author", skill.SkillID, SkillPackageEditRequest{BaseVersionID: skill.VersionID, Operations: []SkillPackageFileOperation{{Op: "write", Path: "SKILL.md", Content: &body}}})
				want = 409
			}
			if err != nil {
				t.Fatal(err)
			}
			_, err = cloudAgentReadToolCached(s.repo, "user", state, call, s)
			assertSkillRuntimeStatus(t, err, want)
		})
	}
}

func TestCloudAgentSkillAuthorizationPiSessionAndCallbacksRejectDisabledAccount(t *testing.T) {
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
	if err := db.Model(&model.User{}).Where("id = ?", "user").Update("status", model.UserStatusDisabled).Error; err != nil {
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

func TestCloudAgentSkillAuthorizationContinuationPreservesOldPiSkillSnapshot(t *testing.T) {
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
	snapshot := `{"type":"message","message":{"role":"toolResult","toolName":"skill_read_file","content":[{"type":"text","text":"secret-body"}]}}`
	if err := db.Create(&model.CloudAgentPiSession{RunID: run.ID, UserID: "user", SessionJSONL: snapshot, UpdatedAt: time.Now()}).Error; err != nil {
		t.Fatal(err)
	}
	req.IdempotencyKey = "ordinary-continuation-after-old-skill"
	nextRun, err := s.CreateCloudAgentRun("user", req, run.ID)
	if err != nil {
		t.Fatalf("ordinary user cannot continue skill history: %v", err)
	}
	nextTask, err := s.repo.TaskForUser("user", nextRun.ID)
	if err != nil {
		t.Fatal(err)
	}
	var input struct {
		PiSessionJSONL string `json:"piSessionJSONL"`
	}
	if err := json.Unmarshal([]byte(nextTask.InputJSON), &input); err != nil || input.PiSessionJSONL != snapshot {
		t.Fatalf("continuation lost skill history: %v, %q", err, input.PiSessionJSONL)
	}
	stored, err := s.repo.CloudAgentPiSession("user", run.ID)
	if err != nil || stored.SessionJSONL != snapshot {
		t.Fatalf("continuation changed the prior session: %v", err)
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
	if _, err := s.cloudAgentDecodeForExecution(execution); err != nil {
		t.Fatalf("demotion must preserve skill execution: %v", err)
	}
	market = false
	for _, tool := range state.Canonical.Tools {
		fn, _ := tool["function"].(map[string]any)
		market = market || stringField(fn, "name") == "skill_market_search"
	}
	if !market {
		t.Fatal("demotion removed market tools")
	}
}

func TestCloudAgentSkillAuthorizationDramaSelectionPreservesForbidden(t *testing.T) {
	s, db, _, _ := creationTestService(t)
	ref := &DramaSkillRef{SkillID: "missing-skill", SkillName: "missing", Path: "SKILL.md"}
	_, err := s.dramaWritingSkill("user", ref, "test")
	assertSkillRuntimeStatus(t, err, 400)
	for _, empty := range []*DramaSkillRef{nil, {}} {
		if got, err := s.dramaWritingSkill("user", empty, "test"); err != nil || got != nil {
			t.Fatalf("empty selection must stay available: %v", err)
		}
	}
	if err := db.Model(&model.User{}).Where("id = ?", "user").Update("status", model.UserStatusDisabled).Error; err != nil {
		t.Fatal(err)
	}
	_, err = s.dramaWritingSkill("user", ref, "test")
	assertSkillRuntimeStatus(t, err, 403)
}
