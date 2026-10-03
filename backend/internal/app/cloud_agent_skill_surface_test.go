package app

import (
	"os"
	"strings"
	"testing"

	"infinite-canvas/backend/internal/model"
)

func surfaceSkillForTest(t *testing.T, s *Service, declaration string) string {
	t.Helper()
	skill, err := s.CreateSkill("user", SkillMutationRequest{
		SkillName: "入口边界测试技能", Description: "仅用于验证当前入口的技能隔离",
		Instruction: "---\nname: 入口边界测试技能\ndescription: 入口隔离测试\n" + declaration + "---\n\n# 入口边界测试技能\n\nSURFACE_SKILL_PRIVATE_BODY",
		Tag:         "others", IsPrivate: true,
	})
	if err != nil {
		t.Fatal(err)
	}
	return skill.SkillID
}

func TestCreationAdmissionRejectsLegacyCanvasSkill(t *testing.T) {
	s, db, _, _ := creationTestService(t)
	req := creationAgentRequest()
	req.SkillIDs = []string{surfaceSkillForTest(t, s, "")}
	_, err := s.CreateCloudAgentRun("user", req, "")
	if err == nil || !strings.Contains(err.Error(), "首页创作") || !strings.Contains(err.Error(), "入口边界测试技能") {
		t.Fatalf("homepage must explain the selected skill is unavailable before admitting a run: %v", err)
	}
	var count int64
	if err := db.Table("cloud_agent_executions").Count(&count).Error; err != nil {
		t.Fatal(err)
	}
	if count != 0 {
		t.Fatalf("unsupported skill admitted %d runs", count)
	}
}

func TestCreationSkillDeclarationDoesNotAuthorizeCanvasReads(t *testing.T) {
	s, _, _, _ := creationTestService(t)
	req := creationAgentRequest()
	req.SkillIDs = []string{surfaceSkillForTest(t, s, "agentSurfaces: [\"creation\"]\n")}
	run, err := s.CreateCloudAgentRun("user", req, "")
	if err != nil {
		t.Fatal(err)
	}
	_, admitted, err := s.cloudAgentTask("user", run.ID)
	if err != nil || len(admitted.Skills) != 1 {
		t.Fatalf("explicit homepage skill was not admitted: %+v, %v", admitted.Skills, err)
	}
	state := &cloudAgentRuntime{Request: admitted.Request, Skills: admitted.Skills}
	if _, err := cloudAgentReadTool(s.repo, "user", state, skillFeedbackCall(req.SkillIDs[0], "SKILL.md"), s); err != nil {
		t.Fatalf("homepage cannot read its own skill: %v", err)
	}
	state.Request.Surface = "canvas"
	if _, err := cloudAgentReadTool(s.repo, "user", state, skillFeedbackCall(req.SkillIDs[0], "SKILL.md"), s); err == nil {
		t.Fatal("homepage-only skill leaked through a canvas skill read")
	}
	search := cloudAgentCall{ID: "surface-search"}
	search.Function.Name, search.Function.Arguments = "skill_search", `{}`
	if result, err := cloudAgentReadTool(s.repo, "user", state, search, s); err == nil {
		t.Fatalf("homepage-only skill leaked through canvas discovery: %#v", result)
	}
	if _, _, err := compileCloudAgentPolicies(state.Request, state.Skills, "", cloudAgentProfileSnapshot{}); err == nil {
		t.Fatal("homepage-only skill leaked into canvas system policy")
	}
}

func TestCreationSkillRequiresExplicitSharedDeclaration(t *testing.T) {
	s, _, _, _ := creationTestService(t)
	req := creationAgentRequest()
	req.SkillIDs = []string{surfaceSkillForTest(t, s, "agentSurfaces: [\"creation\", \"canvas\"]\n")}
	run, err := s.CreateCloudAgentRun("user", req, "")
	if err != nil {
		t.Fatal(err)
	}
	_, admitted, err := s.cloudAgentTask("user", run.ID)
	if err != nil {
		t.Fatal(err)
	}
	for _, surface := range []string{"creation", "canvas"} {
		state := &cloudAgentRuntime{Request: admitted.Request, Skills: admitted.Skills}
		state.Request.Surface = surface
		result, err := cloudAgentReadTool(s.repo, "user", state, skillFeedbackCall(req.SkillIDs[0], "SKILL.md"), s)
		if err != nil || !strings.Contains(result.(map[string]any)["content"].(string), "SURFACE_SKILL_PRIVATE_BODY") {
			t.Fatalf("explicit shared method skill unavailable on %s: %#v, %v", surface, result, err)
		}
	}
}

func TestCreationAdmissionRejectsInvalidSkillSurfaceDeclaration(t *testing.T) {
	for _, declaration := range []string{
		"agentSurfaces: [\"unknown\"]\n",
		"agentSurfaces: []\n",
		"agentSurfaces: \"creation\"\n",
	} {
		t.Run(declaration, func(t *testing.T) {
			s, _, _, _ := creationTestService(t)
			req := creationAgentRequest()
			req.SkillIDs = []string{surfaceSkillForTest(t, s, declaration)}
			if _, err := s.CreateCloudAgentRun("user", req, ""); err == nil {
				t.Fatal("invalid surface declaration silently enabled a skill")
			}
		})
	}
}

func TestCreationCompilerRejectsUnscopedSkillSnapshots(t *testing.T) {
	skill := cloudAgentSkill{ID: "legacy-canvas", Name: "画布技能", Description: "CANVAS_ONLY_SKILL_SENTINEL"}
	if _, _, err := compileCloudAgentPolicies(creationAgentRequest(), []cloudAgentSkill{skill}, "", cloudAgentProfileSnapshot{}); err == nil {
		t.Fatal("legacy canvas skill metadata reached the homepage system policy")
	}
	if _, _, err := compileCloudAgentPolicies(agentTestRequest(), []cloudAgentSkill{skill}, "", cloudAgentProfileSnapshot{}); err != nil {
		t.Fatalf("legacy canvas skill compatibility changed: %v", err)
	}
}

func TestCreationAcceptsUnmodifiedLegacyCommerceBuiltinWithoutRewritingPackage(t *testing.T) {
	s, db, _, _ := creationTestService(t)
	content, err := os.ReadFile("testdata/legacy-commerce-skill.md")
	if err != nil {
		t.Fatal(err)
	}
	skill := model.Skill{ID: "电商创作", OwnerID: "yingce-system", Name: "电商创作", Description: "首页电商创作技能", Instruction: string(content), Status: 1, SourceType: "builtin", Tag: "ecommerce", ShowcaseMediaJSON: "[]"}
	if err := db.Create(&skill).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&model.UserSkillState{ID: "legacy-commerce-installed", UserID: "user", SkillID: skill.ID, Added: true}).Error; err != nil {
		t.Fatal(err)
	}
	if err := s.EnsureSkillPackages(); err != nil {
		t.Fatal(err)
	}
	var before model.Skill
	if err := db.First(&before, "id = ?", skill.ID).Error; err != nil {
		t.Fatal(err)
	}
	req := creationAgentRequest()
	req.SkillIDs = []string{skill.ID}
	run, err := s.CreateCloudAgentRun("user", req, "")
	if err != nil {
		t.Fatalf("unchanged installed commerce builtin lost homepage access: %v", err)
	}
	_, admitted, err := s.cloudAgentTask("user", run.ID)
	if err != nil {
		t.Fatal(err)
	}
	state := &cloudAgentRuntime{Request: admitted.Request, Skills: admitted.Skills}
	result, err := cloudAgentReadTool(s.repo, "user", state, skillFeedbackCall(skill.ID, "SKILL.md"), s)
	if err != nil || result.(map[string]any)["content"] != string(content) {
		t.Fatalf("legacy skill content was changed or is unreadable: %#v, %v", result, err)
	}
	var after model.Skill
	if err := db.First(&after, "id = ?", skill.ID).Error; err != nil {
		t.Fatal(err)
	}
	if after.Instruction != before.Instruction || after.CurrentVersionID != before.CurrentVersionID || after.ContentHash != before.ContentHash {
		t.Fatal("scope compatibility must not rewrite the installed package")
	}

	// Only the exact builtin qualifies, not edited content, a changed package,
	// or an imported copy with the same name and unchanged body.
	for _, change := range []struct{ field, value string }{
		{"instruction", string(content) + "\nCUSTOM_CANVAS_WORKFLOW"},
		{"content_hash", strings.Repeat("0", 64)},
		{"source_type", "markdown"},
	} {
		if err := db.Model(&model.Skill{}).Where("id = ?", skill.ID).Updates(map[string]any{
			"instruction": before.Instruction, "content_hash": before.ContentHash, "source_type": before.SourceType,
			change.field: change.value,
		}).Error; err != nil {
			t.Fatal(err)
		}
		req.IdempotencyKey = "modified-commerce-" + change.field
		if _, err := s.CreateCloudAgentRun("user", req, ""); err == nil {
			t.Fatalf("commerce skill with changed %s inherited the trusted builtin overlay", change.field)
		}
	}
}
