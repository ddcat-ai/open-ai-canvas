package app

import (
	"encoding/json"
	"fmt"
	"strings"
	"testing"

	"yingce/backend/internal/model"
)

func ecommerceGroupedReferenceDraft() EcommerceDraft {
	return EcommerceDraft{Platform: "taobao", ImageType: "detail", Count: 4, ReferenceMode: "detail",
		References: []EcommerceReference{{ResourceID: "product", Role: "primary", Name: "商品.png"}},
		LayoutReferences: []EcommerceReference{
			{ResourceID: "long-reference", Role: "style", Name: "第一条长图.png", Width: 750, Height: 3000},
			{ResourceID: "second-reference", Role: "competitor", Name: "第二条长图.png", Width: 800, Height: 4000},
		},
	}
}

func ecommerceGroupedReferencePlan() *model.EcommercePlan {
	plan := ecommerceReferencePlan()
	second := ecommerceReferencePlan()
	for index := range second.Images {
		second.Images[index].ID = fmt.Sprintf("screen-%d", index+3)
		second.Images[index].ReferenceScreen.SourceResourceID = "second-reference"
		second.Images[index].ReferenceScreen.ScreenIndex = index + 3
		second.Images[index].ReferenceScreen.ResourceID = ""
	}
	plan.Images = append(plan.Images, second.Images...)
	plan.ReferenceSummary = "第一条长图先主视觉后场景，第二条长图先细节后使用情境"
	return plan
}

func TestEcommerceSeparatedReferenceGroupsPersistAndProtectAllSources(t *testing.T) {
	svc, db, _, _ := ecommerceCreationTestService(t)
	for _, id := range []string{"product", "long-reference", "second-reference", "crop-1", "crop-2"} {
		if err := db.Create(&model.Resource{ID: id, UserID: "user", Kind: "image", Status: model.ResourceStatusReady}).Error; err != nil {
			t.Fatal(err)
		}
	}
	project, err := svc.CreateEcommerceProject("user")
	if err != nil {
		t.Fatal(err)
	}
	draft, plan := ecommerceGroupedReferenceDraft(), ecommerceGroupedReferencePlan()
	// The old scalar is preserved for recovery, but cannot choose or reorder the new group.
	draft.LayoutReferenceID = "second-reference"
	plan.Images[0].ManualPrompt = true
	saved, err := svc.SaveEcommerceProject("user", project.ID, SaveEcommerceProjectRequest{Revision: project.Revision, Draft: draft, Plan: plan})
	if err != nil {
		t.Fatal(err)
	}
	var restored EcommerceDraft
	var restoredPlan model.EcommercePlan
	if err := json.Unmarshal([]byte(saved.DraftJSON), &restored); err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal([]byte(saved.PlanJSON), &restoredPlan); err != nil {
		t.Fatal(err)
	}
	if len(restored.References) != 1 || restored.References[0].ResourceID != "product" || len(restored.LayoutReferences) != 2 || restored.LayoutReferences[1].ResourceID != "second-reference" || restored.LayoutReferences[0].Width != 750 {
		t.Fatalf("separated reference groups changed: %#v", restored)
	}
	if len(restoredPlan.Images) != 4 || restoredPlan.Images[2].ReferenceScreen.ScreenIndex != 3 || restoredPlan.Images[2].ReferenceScreen.Top != 0 || !restoredPlan.Images[0].ManualPrompt {
		t.Fatalf("source grouping or manual prompt lost: %#v", restoredPlan)
	}
	for _, id := range []string{"product", "long-reference", "second-reference", "crop-1", "crop-2"} {
		resource, err := svc.repo.ResourceForUser("user", id)
		if err != nil {
			t.Fatal(err)
		}
		if err := svc.ensureResourceHasNoBusinessReferences(resource); err == nil {
			t.Fatalf("source/crop %s lost project deletion protection", id)
		}
	}
	draft.ReferenceMode = "style"
	for index := range plan.Images {
		plan.Images[index].ReferenceScreen = nil
	}
	saved, err = svc.SaveEcommerceProject("user", saved.ID, SaveEcommerceProjectRequest{Revision: saved.Revision, Draft: draft, Plan: plan})
	if err != nil {
		t.Fatalf("style plan with multiple inspirations should not require detail screens: %v", err)
	}
	// Inactive inspiration is retained but imposes no coverage or summary on a product plan.
	draft.ReferenceMode = "product"
	plan.ReferenceSummary = ""
	for index := range plan.Images {
		plan.Images[index].ReferenceScreen = nil
	}
	product, err := svc.SaveEcommerceProject("user", saved.ID, SaveEcommerceProjectRequest{Revision: saved.Revision, Draft: draft, Plan: plan})
	if err != nil {
		t.Fatalf("inactive inspiration blocked product plan: %v", err)
	}
	if !strings.Contains(product.DraftJSON, `"layoutReferences":[`) || !strings.Contains(product.DraftJSON, "second-reference") {
		t.Fatal("inactive inspiration was discarded")
	}
}

func TestEcommerceSeparatedReferenceGroupsRejectInvalidPlansAndOwnership(t *testing.T) {
	svc, db, _, _ := ecommerceCreationTestService(t)
	for _, resource := range []model.Resource{
		{ID: "product", UserID: "user", Kind: "image", Status: model.ResourceStatusReady},
		{ID: "long-reference", UserID: "user", Kind: "image", Status: model.ResourceStatusReady},
		{ID: "second-reference", UserID: "user", Kind: "image", Status: model.ResourceStatusReady},
		{ID: "crop-1", UserID: "user", Kind: "image", Status: model.ResourceStatusReady},
		{ID: "crop-2", UserID: "user", Kind: "image", Status: model.ResourceStatusReady},
		{ID: "foreign", UserID: "other", Kind: "image", Status: model.ResourceStatusReady},
		{ID: "video", UserID: "user", Kind: "video", Status: model.ResourceStatusReady},
		{ID: "pending", UserID: "user", Kind: "image", Status: model.ResourceStatusPending},
	} {
		if err := db.Create(&resource).Error; err != nil {
			t.Fatal(err)
		}
	}
	tests := []struct {
		name   string
		mutate func(*EcommerceDraft, *model.EcommercePlan)
	}{
		{"foreign layout", func(d *EcommerceDraft, _ *model.EcommercePlan) { d.LayoutReferences[1].ResourceID = "foreign" }},
		{"nonimage layout", func(d *EcommerceDraft, _ *model.EcommercePlan) { d.LayoutReferences[1].ResourceID = "video" }},
		{"unready layout", func(d *EcommerceDraft, _ *model.EcommercePlan) { d.LayoutReferences[1].ResourceID = "pending" }},
		{"foreign crop", func(_ *EcommerceDraft, p *model.EcommercePlan) { p.Images[3].ReferenceScreen.ResourceID = "foreign" }},
		{"duplicate layout", func(d *EcommerceDraft, _ *model.EcommercePlan) { d.LayoutReferences[1] = d.LayoutReferences[0] }},
		{"primary in layout", func(d *EcommerceDraft, _ *model.EcommercePlan) { d.LayoutReferences[0].Role = "primary" }},
		{"style in product", func(d *EcommerceDraft, _ *model.EcommercePlan) {
			d.References = append(d.References, d.LayoutReferences[0])
		}},
		{"no product primary", func(d *EcommerceDraft, _ *model.EcommercePlan) { d.References = nil }},
		{"empty explicit layout does not use scalar", func(d *EcommerceDraft, _ *model.EcommercePlan) {
			d.LayoutReferences = []EcommerceReference{}
			d.LayoutReferenceID = "product"
		}},
		{"missing summary", func(_ *EcommerceDraft, p *model.EcommercePlan) { p.ReferenceSummary = " " }},
		{"group starts at second source", func(_ *EcommerceDraft, p *model.EcommercePlan) {
			p.Images[0].ReferenceScreen.SourceResourceID = "second-reference"
		}},
		{"interleaved sources", func(_ *EcommerceDraft, p *model.EcommercePlan) {
			p.Images[1].ReferenceScreen.SourceResourceID = "second-reference"
			p.Images[2].ReferenceScreen.SourceResourceID = "long-reference"
		}},
		{"source omitted", func(_ *EcommerceDraft, p *model.EcommercePlan) {
			for i := 2; i < 4; i++ {
				p.Images[i].ReferenceScreen.SourceResourceID = "long-reference"
			}
		}},
		{"last source omitted entirely", func(d *EcommerceDraft, p *model.EcommercePlan) {
			p.Images = p.Images[:2]
			d.Count = 2
		}},
		{"draft source order reversed", func(d *EcommerceDraft, _ *model.EcommercePlan) {
			d.LayoutReferences[0], d.LayoutReferences[1] = d.LayoutReferences[1], d.LayoutReferences[0]
		}},
		{"incomplete previous group", func(_ *EcommerceDraft, p *model.EcommercePlan) { p.Images[1].ReferenceScreen.Bottom = .9 }},
		{"missing next group head", func(_ *EcommerceDraft, p *model.EcommercePlan) { p.Images[2].ReferenceScreen.Top = .1 }},
		{"missing final tail", func(_ *EcommerceDraft, p *model.EcommercePlan) { p.Images[3].ReferenceScreen.Bottom = .9 }},
		{"screenIndex reset per source", func(_ *EcommerceDraft, p *model.EcommercePlan) { p.Images[2].ReferenceScreen.ScreenIndex = 1 }},
		{"product used as layout source", func(_ *EcommerceDraft, p *model.EcommercePlan) {
			p.Images[0].ReferenceScreen.SourceResourceID = "product"
		}},
		{"too many total references", func(d *EcommerceDraft, _ *model.EcommercePlan) {
			for i := 0; i < 23; i++ {
				d.References = append(d.References, EcommerceReference{ResourceID: "product", Role: "detail"})
			}
		}},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			project, err := svc.CreateEcommerceProject("user")
			if err != nil {
				t.Fatal(err)
			}
			draft, plan := ecommerceGroupedReferenceDraft(), ecommerceGroupedReferencePlan()
			tt.mutate(&draft, plan)
			if _, err := svc.SaveEcommerceProject("user", project.ID, SaveEcommerceProjectRequest{Revision: project.Revision, Draft: draft, Plan: plan}); err == nil {
				t.Fatal("invalid separated reference contract accepted")
			}
		})
	}
}

func TestEcommerceReferenceGroupsKeepEmptyDraftAndLegacySemantics(t *testing.T) {
	svc, db, _, _ := ecommerceCreationTestService(t)
	for _, id := range []string{"product", "long-reference", "second-reference", "crop-1", "crop-2"} {
		if err := db.Create(&model.Resource{ID: id, UserID: "user", Kind: "image", Status: model.ResourceStatusReady}).Error; err != nil {
			t.Fatal(err)
		}
	}
	for _, mode := range []string{"style", "detail"} {
		project, err := svc.CreateEcommerceProject("user")
		if err != nil {
			t.Fatal(err)
		}
		draft := ecommerceGroupedReferenceDraft()
		draft.ReferenceMode = mode
		draft.References = []EcommerceReference{}
		saved, err := svc.SaveEcommerceProject("user", project.ID, SaveEcommerceProjectRequest{Revision: project.Revision, Draft: draft})
		if err != nil {
			t.Fatal(err)
		}
		var restored EcommerceDraft
		if err := json.Unmarshal([]byte(saved.DraftJSON), &restored); err != nil {
			t.Fatal(err)
		}
		if len(restored.References) != 0 || len(restored.LayoutReferences) != 2 {
			t.Fatal("draft inspiration became product identity")
		}
		plan := ecommerceGroupedReferencePlan()
		if mode == "style" {
			for index := range plan.Images {
				plan.Images[index].ReferenceScreen = nil
			}
		}
		if _, err := svc.SaveEcommerceProject("user", project.ID, SaveEcommerceProjectRequest{Revision: saved.Revision, Draft: draft, Plan: plan}); err == nil {
			t.Fatal("inspiration-only plan accepted")
		}
	}
	project, err := svc.CreateEcommerceProject("user")
	if err != nil {
		t.Fatal(err)
	}
	legacy := EcommerceDraft{Platform: "taobao", ImageType: "detail", Count: 2, ReferenceMode: "detail", LayoutReferenceID: "long-reference", References: []EcommerceReference{{ResourceID: "long-reference", Role: "primary"}}}
	saved, err := svc.SaveEcommerceProject("user", project.ID, SaveEcommerceProjectRequest{Revision: project.Revision, Draft: legacy, Plan: ecommerceReferencePlan()})
	if err != nil {
		t.Fatalf("legacy primary-selected plan was broken: %v", err)
	}
	legacy.ReferenceMode = "product"
	legacy.LayoutReferences = []EcommerceReference{}
	legacy.LayoutReferenceID = ""
	plan := ecommerceReferencePlan()
	plan.ReferenceSummary = ""
	for index := range plan.Images {
		plan.Images[index].ReferenceScreen = nil
	}
	saved, err = svc.SaveEcommerceProject("user", project.ID, SaveEcommerceProjectRequest{Revision: saved.Revision, Draft: legacy, Plan: plan})
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(saved.DraftJSON, `"layoutReferences":[]`) {
		t.Fatal("explicit empty group was omitted and will regain legacy semantics on restore")
	}
	var emptyGroup EcommerceDraft
	if err := json.Unmarshal([]byte(saved.DraftJSON), &emptyGroup); err != nil {
		t.Fatal(err)
	}
	if emptyGroup.LayoutReferences == nil {
		t.Fatal("explicit empty group became missing")
	}
}
