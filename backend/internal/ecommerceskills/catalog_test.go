package ecommerceskills

import (
	"strings"
	"testing"
)

func hasManaged(calls []ManagedInvocation, id string) bool {
	for _, call := range calls {
		if call.ID == id {
			return true
		}
	}
	return false
}

func TestManagedSkillsRouteByProductReferenceAndAdministratorPolicy(t *testing.T) {
	input := ManagedInput{Category: "appliance", Text: "便携榨汁机，鲜果制作", ImageType: "detail", Platform: "taobao", ReferenceMode: "detail", Style: "鲜果黑场，玻璃杯身", PeopleAllowed: true}
	calls, block := SelectManaged(input, nil)
	if len(calls) > 8 || !hasManaged(calls, "ecom-fruit-preparation") || !hasManaged(calls, "ecom-layout-reference") || !strings.Contains(block, "鲜果") {
		t.Fatalf("juicer/reference route: %+v", calls)
	}
	policy := map[string]bool{"ecom-fruit-preparation": false, "ecom-layout-reference": false}
	calls, _ = SelectManaged(input, policy)
	if hasManaged(calls, "ecom-fruit-preparation") || hasManaged(calls, "ecom-layout-reference") {
		t.Fatal("disabled skill selected")
	}
	input.Text = "扫地机器人，地板清洁"
	input.Style = "极简家居"
	input.ReferenceMode = "product"
	calls, _ = SelectManaged(input, nil)
	if hasManaged(calls, "ecom-fruit-preparation") {
		t.Fatal("fruit preparation selected for a vacuum")
	}
	input.Category = "apparel"
	input.Text = "服饰试穿真人模特"
	input.PeopleAllowed = false
	calls, _ = SelectManaged(input, nil)
	if hasManaged(calls, "ecom-model-try-on") || hasManaged(calls, "ecom-product-shots-multi-angle") || hasManaged(calls, "ecom-human-realism") {
		t.Fatal("people restriction ignored")
	}
	input = ManagedInput{Category: "tech", ImageType: "white", Platform: "amazon", NoText: true}
	calls, _ = SelectManaged(input, nil)
	if !hasManaged(calls, "ecom-amazon-white-background") || hasManaged(calls, "ecom-copywriting") {
		t.Fatal("white-image routing lost")
	}
	policy = map[string]bool{}
	for _, skill := range ManagedCatalog() {
		policy[skill.ID] = false
	}
	calls, block = SelectManaged(input, policy)
	if len(calls) != 0 || block != "" {
		t.Fatal("all-disabled policy did not stop managed skills")
	}
}

func TestManagedCatalogHasCompleteVersionedPackages(t *testing.T) {
	seen := map[string]bool{}
	github := 0
	for _, skill := range ManagedCatalog() {
		if seen[skill.ID] || skill.Method == "" || skill.ImageRule == "" || skill.Review == "" || len(skill.ContentHash) != 64 || !strings.Contains(skill.Instructions, skill.Method) {
			t.Fatalf("invalid skill %s", skill.ID)
		}
		seen[skill.ID] = true
		if skill.Origin == "github-adapted" {
			github++
			if skill.License != "MIT" || len(skill.SourceCommit) != 40 || !strings.Contains(skill.SourceURL, skill.SourceCommit) {
				t.Fatalf("unpinned source %s", skill.ID)
			}
		}
	}
	if len(seen) != 61 || github != 23 {
		t.Fatalf("installed=%d github=%d", len(seen), github)
	}
}

func TestManagedIndustryRoutesCoverEveryRootAndRespectSwitch(t *testing.T) {
	for _, skill := range ManagedCatalog() {
		if len(skill.RootIDs) == 0 {
			continue
		}
		for _, kind := range []string{"detail", "white"} {
			input := ManagedInput{RootID: skill.RootIDs[0], ImageType: kind, Platform: "general", PeopleAllowed: true}
			calls, _ := SelectManaged(input, nil)
			if !hasManaged(calls, skill.ID) {
				t.Errorf("industry method missing: %s %s", skill.ID, kind)
			}
			for _, call := range calls {
				if strings.HasPrefix(call.ID, "ecom-industry-") && call.ID != skill.ID {
					t.Errorf("cross-industry method selected: %s", call.ID)
				}
			}
			calls, _ = SelectManaged(input, map[string]bool{skill.ID: false})
			if hasManaged(calls, skill.ID) {
				t.Error("disabled industry method selected", skill.ID)
			}
		}
	}
}
