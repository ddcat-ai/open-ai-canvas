package app

import (
	"encoding/json"
	"strings"
	"testing"

	"infinite-canvas/backend/internal/model"
)

// Exercise the same registration calls used at server startup against an
// isolated database. A source directory alone does not publish a market skill.
func TestIGOVisualSkillRegistersAndLoadsOnlyAfterUserAddsIt(t *testing.T) {
	s, db, _, _ := creationTestService(t)
	const id = "igo-visual-design"
	if _, err := s.SkillDetail("user", id); err == nil {
		t.Fatal("new skill was registered before startup seeding")
	}
	if err := s.EnsureBuiltinSkills(); err != nil {
		t.Fatal(err)
	}
	if err := s.EnsureSkillPackages(); err != nil {
		t.Fatal(err)
	}
	var saved model.Skill
	if err := db.First(&saved, "id = ?", id).Error; err != nil {
		t.Fatalf("startup did not register skill: %v", err)
	}
	if saved.Name != "电商视觉设计" || saved.Tag != "ecommerce" || saved.IsPrivate || saved.Status != 1 || saved.CurrentVersionID == "" {
		t.Fatalf("registered skill cannot be listed or read: %+v", saved)
	}
	market, err := s.Skills("user", SkillListRequest{Scope: "public", Search: "电商视觉设计", Tag: "ecommerce"})
	if err != nil || market.TotalCount != 1 || len(market.Skills) != 1 || market.Skills[0].SkillID != id || market.Skills[0].IsAdded {
		t.Fatalf("market search/category before personal add: %+v, %v", market, err)
	}
	categoryFound := false
	for _, category := range market.Categories {
		if category.Value == "ecommerce" {
			categoryFound = category.Label == "电商营销" && category.Count > 0
		}
	}
	if !categoryFound {
		t.Fatalf("ecommerce market category absent: %+v", market.Categories)
	}
	before, err := s.cloudAgentSkills("user", nil, "creation")
	if err != nil || len(before) != 0 {
		t.Fatalf("uninstalled skill entered homepage candidates: %+v, %v", before, err)
	}
	var stateCount int64
	if err := db.Model(&model.UserSkillState{}).Where("skill_id = ?", id).Count(&stateCount).Error; err != nil || stateCount != 0 {
		t.Fatalf("registration installed skill for a user: %d, %v", stateCount, err)
	}
	added, err := s.SetSkillAdded("user", id, true)
	if err != nil || !added.IsAdded {
		t.Fatalf("personal add failed: %+v, %v", added, err)
	}
	library, err := s.Skills("user", SkillListRequest{Scope: "mine", Search: "电商视觉设计"})
	if err != nil || library.TotalCount != 1 || !library.Skills[0].IsAdded {
		t.Fatalf("skill absent from personal library: %+v, %v", library, err)
	}
	req := creationAgentRequest()
	req.Prompt = "为亚马逊日本站商品规划套图"
	req.SkillIDs = nil
	run, err := s.CreateCloudAgentRun("user", req, "")
	if err != nil {
		t.Fatal(err)
	}
	_, admitted, err := s.cloudAgentTask("user", run.ID)
	if err != nil || len(admitted.Skills) != 1 || admitted.Skills[0].ID != id {
		t.Fatalf("homepage did not admit added skill: %+v, %v", admitted.Skills, err)
	}
	runtime := &cloudAgentRuntime{Request: admitted.Request, Skills: admitted.Skills}
	search := cloudAgentCall{ID: "visual-search"}
	search.Function.Name, search.Function.Arguments = "skill_search", `{"keyword":"电商视觉设计"}`
	found, err := cloudAgentReadTool(s.repo, "user", runtime, search, s)
	encoded, _ := json.Marshal(found)
	if err != nil || !strings.Contains(string(encoded), id) {
		t.Fatalf("homepage cannot discover added skill: %#v, %v", found, err)
	}
	file, err := cloudAgentReadTool(s.repo, "user", runtime, skillFeedbackCall(id, "SKILL.md"), s)
	if err != nil || !strings.Contains(file.(map[string]any)["content"].(string), "commerce_plan_submit") {
		t.Fatalf("homepage cannot read skill instructions: %#v, %v", file, err)
	}
	if _, err := s.cloudAgentSkills("user", []string{id}, "canvas"); err == nil {
		t.Fatal("creation-only skill admitted on canvas")
	}
	runtime.Request.Surface = "canvas"
	if _, err := cloudAgentReadTool(s.repo, "user", runtime, skillFeedbackCall(id, "SKILL.md"), s); err == nil {
		t.Fatal("canvas read of creation-only skill succeeded")
	}
}
