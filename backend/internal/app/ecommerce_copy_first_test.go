package app

import (
	"encoding/json"
	"testing"
	"yingce/backend/internal/assets"
	"yingce/backend/internal/model"
)

func TestEcommerceSuppliedCopyCannotBeRewrittenOrReordered(t *testing.T) {
	draft := EcommerceDraft{CopyBrief: &EcommerceCopyBrief{Text: "温暖包裹\n毛绒鞋口\n---\n细节之美", Mode: "verbatim"}}
	plan := model.EcommercePlan{Images: []model.EcommercePlanTask{{Copy: "温暖\n包裹\n毛绒鞋口"}, {Copy: "细节之美"}}}
	if err := validateEcommerceSuppliedCopy(draft, &plan); err != nil {
		t.Fatal(err)
	}
	plan.Images[0].Copy = "防水鞋口"
	if err := validateEcommerceSuppliedCopy(draft, &plan); err == nil {
		t.Fatal("rewritten copy accepted")
	}
	plan.Images[0].Copy, plan.Images[1].Copy = "细节之美", "温暖包裹毛绒鞋口"
	if err := validateEcommerceSuppliedCopy(draft, &plan); err == nil {
		t.Fatal("reordered copy accepted")
	}
	draft.CopyBrief.Mode = "polish"
	if err := validateEcommerceSuppliedCopy(draft, &plan); err != nil {
		t.Fatal(err)
	}
	draft.CopyBrief = &EcommerceCopyBrief{Text: "Soft and warm", Mode: "verbatim"}
	plan.Images = []model.EcommercePlanTask{{Copy: "Softandwarm"}}
	if err := validateEcommerceSuppliedCopy(draft, &plan); err == nil {
		t.Fatal("spaces lost in copy")
	}
}

func TestEcommercePhotoTextLayoutPersistsAndArchivesWithOwnership(t *testing.T) {
	svc, db, _, _ := ecommerceCreationTestService(t)
	for _, owner := range []string{"user", "other"} {
		if err := db.Create(&model.Resource{ID: owner + "-photo", UserID: owner, Kind: "image", Status: model.ResourceStatusReady}).Error; err != nil {
			t.Fatal(err)
		}
	}
	project, err := svc.CreateEcommerceProject("user")
	if err != nil {
		t.Fatal(err)
	}
	draft := EcommerceDraft{ProductName: "拖鞋", Platform: "pinduoduo", ImageType: "single", Count: 1, Language: "zh-CN", CopyBrief: &EcommerceCopyBrief{Text: "毛绒鞋口", Mode: "verbatim"}}
	image := model.EcommercePlanTask{ID: "photo-page", ImageType: "single", Platform: "pinduoduo", Language: "zh-CN", Goal: "鞋口细节", Theme: "毛绒鞋口", Composition: "原图", MainVisual: "拖鞋", Fidelity: "原图", Prompt: "原图排版", ImageModel: "photo", Ratio: "1:1", Resolution: "1k", Copy: "毛绒鞋口", SourcePhotoResourceID: "user-photo", TextLayout: &model.EcommerceTextLayout{X: 8, Y: 8, Width: 84, FontSize: 3.2, Color: "#222222", Background: "#ffffff", Align: "left"}}
	plan := &model.EcommercePlan{ProductSummary: "拖鞋", VisualStrategy: "实拍排版", Images: []model.EcommercePlanTask{image}}
	saved, err := svc.SaveEcommerceProject("user", project.ID, SaveEcommerceProjectRequest{Revision: project.Revision, Draft: draft, Plan: plan, HistoryMode: "rounds"})
	if err != nil {
		t.Fatal(err)
	}
	var restored model.EcommercePlan
	if err := json.Unmarshal([]byte(saved.PlanJSON), &restored); err != nil {
		t.Fatal(err)
	}
	if restored.Images[0].Copy != image.Copy || restored.Images[0].TextLayout.X != 8 || restored.Images[0].SourcePhotoResourceID != "user-photo" {
		t.Fatal("layout lost on save")
	}
	if !assets.DocumentReferences(saved.PlanJSON, map[string]struct{}{"user-photo": {}}) {
		t.Fatal("photo missing from deletion protection")
	}
	plan.Images[0].SourcePhotoResourceID = "other-photo"
	if _, err := svc.SaveEcommerceProject("user", project.ID, SaveEcommerceProjectRequest{Revision: saved.Revision, Draft: draft, Plan: plan, HistoryMode: "rounds"}); err == nil {
		t.Fatal("foreign photo accepted")
	}
	saved, err = svc.SaveEcommerceProject("user", project.ID, SaveEcommerceProjectRequest{Revision: saved.Revision, Draft: draft, HistoryMode: "rounds", AdvanceRound: true, ActiveRoundID: saved.ActiveRoundID})
	if err != nil {
		t.Fatal(err)
	}
	page, err := svc.EcommerceRoundPage("user", project.ID, 10, 0)
	if err != nil || page.Total != 1 {
		t.Fatalf("photo archive failed: %#v %v", page, err)
	}
	round := page.Rounds[0]
	edited := round.Plan.Images[0]
	edited.Copy = "蝴蝶结细节"
	edited.TextLayout.Y = 60
	updated, err := svc.UpdateEcommerceRoundImage("user", project.ID, round.ID, edited.ID, EcommerceRoundImageUpdateRequest{Version: round.Version, Image: &edited})
	if err != nil {
		t.Fatal(err)
	}
	if updated.Plan.Images[0].TextLayout.Y != 60 || updated.Plan.Images[0].Copy != edited.Copy {
		t.Fatal("history edit lost")
	}
	edited.Copy = "新的文案"
	if _, err := svc.UpdateEcommerceRoundImage("user", project.ID, round.ID, edited.ID, EcommerceRoundImageUpdateRequest{Version: round.Version, Image: &edited}); err == nil {
		t.Fatal("stale update accepted")
	}
	edited.SourcePhotoResourceID = "other-photo"
	if _, err := svc.UpdateEcommerceRoundImage("user", project.ID, round.ID, edited.ID, EcommerceRoundImageUpdateRequest{Version: updated.Version, Image: &edited}); err == nil {
		t.Fatal("foreign photo accepted in history")
	}
	edited.SourcePhotoResourceID = "user-photo"
	edited.TextLayout.X = 200
	if err := svc.validateEcommerceTextImage("user", edited); err == nil {
		t.Fatal("off-canvas layout accepted")
	}
}
