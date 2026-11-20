package app

import (
	"strings"
	"testing"

	"yingce/backend/internal/ecommerceskills"
	"yingce/backend/internal/model"
)

func TestEcommerceManagedSkillSwitchPersistsAndControlsPromptAndKnowledge(t *testing.T) {
	svc, _ := knowledgeTestService(t)
	admin := &model.User{ID: "admin", Role: model.UserRoleAdmin, Status: model.UserStatusActive}
	user := &model.User{ID: "user", Role: model.UserRoleUser, Status: model.UserStatusActive}
	if _, err := svc.EcommerceManagedSkills(user); err == nil {
		t.Fatal("non-admin listed management catalog")
	}
	if err := svc.SetEcommerceManagedSkillEnabled(user, "ecom-fruit-preparation", false); err == nil {
		t.Fatal("non-admin changed policy")
	}
	items, err := svc.EcommerceManagedSkills(admin)
	if err != nil {
		t.Fatal(err)
	}
	if len(items) != 61 {
		t.Fatal(len(items))
	}
	for _, item := range items {
		if !item.Enabled {
			t.Fatal("new skill not enabled by default")
		}
	}
	if _, err := svc.EnsureBuiltinEcommerceKnowledge(); err != nil {
		t.Fatal(err)
	}
	draft := EcommerceDraft{ProductName: "榨汁机", Category: "家电", Platform: "taobao", ImageType: "detail", Count: 9, ReferenceMode: "detail"}
	block, calls, err := svc.ecommerceManagedSkillBlock(draft, nil)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(block, "榨汁鲜果制作叙事") || len(calls) == 0 {
		t.Fatal("app did not route product skill")
	}
	if !strings.Contains(ecommerceManagedImageRules(map[string]any{"ecommerceManagedSkills": calls}), "鲜果") {
		t.Fatal("image execution rules lost")
	}
	if err := svc.SetEcommerceManagedSkillEnabled(admin, "ecom-fruit-preparation", false); err != nil {
		t.Fatal(err)
	}
	policy, err := svc.ecommerceManagedSkillPolicy()
	if err != nil {
		t.Fatal(err)
	}
	if policy["ecom-fruit-preparation"] {
		t.Fatal("switch not persisted")
	}
	block, calls, err = svc.ecommerceManagedSkillBlock(draft, nil)
	if err != nil {
		t.Fatal(err)
	}
	for _, call := range calls {
		if call.ID == "ecom-fruit-preparation" {
			t.Fatal("disabled skill called")
		}
	}
	for _, entry := range ecommerceManagedSkillKnowledge() {
		if strings.Contains(entry.ID, "ecom-fruit-preparation") && ecommerceKnowledgeSkillEnabled(entry, policy, ecommerceDraftKnowledgeRequest(draft)) {
			t.Fatal("disabled skill leaked through knowledge")
		}
	}
	items, err = svc.EcommerceManagedSkills(admin)
	if err != nil {
		t.Fatal(err)
	}
	for _, item := range items {
		if item.ID == "ecom-fruit-preparation" && item.Enabled {
			t.Fatal("management refresh reset switch")
		}
	}
	if err := svc.SetEcommerceManagedSkillEnabled(admin, "ecom-missing", true); err == nil {
		t.Fatal("unknown skill accepted")
	}
	if len(ecommerceManagedSkillKnowledge()) != len(ecommerceskills.ManagedCatalog())*3 {
		t.Fatal("knowledge bundle incomplete")
	}
}
