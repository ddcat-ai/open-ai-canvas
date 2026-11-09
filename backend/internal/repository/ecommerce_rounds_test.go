package repository

import (
	"encoding/json"
	"errors"
	"path/filepath"
	"testing"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
	"yingce/backend/internal/model"
)

func ecommerceRoundsTestDB(t *testing.T) *gorm.DB {
	t.Helper()
	db, err := gorm.Open(sqlite.Open(filepath.Join(t.TempDir(), "rounds.db")), &gorm.Config{Logger: logger.Default.LogMode(logger.Silent)})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&model.EcommerceProject{}, &model.EcommerceRound{}); err != nil {
		t.Fatal(err)
	}
	return db
}

func ecommerceRoundsTestPlan(images ...model.EcommercePlanTask) string {
	raw, err := json.Marshal(model.EcommercePlan{Images: images})
	if err != nil {
		panic(err)
	}
	return string(raw)
}

func ecommerceRoundsTestImage(id, taskID, draft string) model.EcommercePlanTask {
	image := model.EcommercePlanTask{ID: id, TaskID: taskID, Prompt: "prompt " + id, ImageModel: "image-model", Ratio: "1:1", Resolution: "1k"}
	if draft != "" {
		image.SourceDraft = json.RawMessage(draft)
	}
	return image
}

func ecommerceRoundsTestProject(planJSON string) *model.EcommerceProject {
	return &model.EcommerceProject{
		ID:            "project-1",
		UserID:        "user-1",
		Name:          "商品",
		Status:        "draft",
		DraftJSON:     `{"productName":"商品"}`,
		PlanJSON:      planJSON,
		ActiveRoundID: "active-1",
		Revision:      1,
	}
}

func TestSaveEcommerceProjectRoundsArchivesAdmittedImages(t *testing.T) {
	db := ecommerceRoundsTestDB(t)
	repo := New(db)
	project := ecommerceRoundsTestProject(ecommerceRoundsTestPlan(
		ecommerceRoundsTestImage("image-1", "task-1", ""),
		ecommerceRoundsTestImage("image-2", "", ""),
	))
	if err := repo.CreateEcommerceProject(project); err != nil {
		t.Fatal(err)
	}
	stored := *project
	stored.PlanJSON = ecommerceRoundsTestPlan(ecommerceRoundsTestImage("next-1", "", ""))
	if err := repo.SaveEcommerceProjectRounds(&stored, 1, EcommerceRoundsSaveOptions{RoundMode: true, AdvanceRound: true, ActiveRoundID: "active-1"}); err != nil {
		t.Fatal(err)
	}
	rounds, total, err := repo.EcommerceRoundPage("user-1", "project-1", 10, 0)
	if err != nil || total != 1 || len(rounds) != 1 {
		t.Fatalf("rounds total=%d len=%d err=%v", total, len(rounds), err)
	}
	if rounds[0].ImageCount != 1 {
		t.Fatalf("pending sketch must not be archived, imageCount=%d", rounds[0].ImageCount)
	}
	var archived model.EcommercePlan
	if err := json.Unmarshal([]byte(rounds[0].PlanJSON), &archived); err != nil || len(archived.Images) != 1 || archived.Images[0].ID != "image-1" {
		t.Fatalf("archived plan = %+v err=%v", archived, err)
	}
	if stored.ActiveRoundID == "active-1" {
		t.Fatal("active round must rotate after archiving")
	}
	if stored.Revision != 2 {
		t.Fatalf("revision = %d", stored.Revision)
	}
}

func TestSaveEcommerceProjectRoundsRejectsStaleActiveRound(t *testing.T) {
	db := ecommerceRoundsTestDB(t)
	repo := New(db)
	project := ecommerceRoundsTestProject("{}")
	if err := repo.CreateEcommerceProject(project); err != nil {
		t.Fatal(err)
	}
	next := *project
	next.PlanJSON = "{}"
	err := repo.SaveEcommerceProjectRounds(&next, 1, EcommerceRoundsSaveOptions{RoundMode: true, ActiveRoundID: "other-tab"})
	if !errors.Is(err, ErrEcommerceRoundConflict) {
		t.Fatalf("err = %v", err)
	}
}

func TestConvertEcommerceProjectRoundsGroupsAndIsIdempotent(t *testing.T) {
	db := ecommerceRoundsTestDB(t)
	repo := New(db)
	plan := model.EcommercePlan{
		Images: []model.EcommercePlanTask{ecommerceRoundsTestImage("active-1", "task-active", "")},
		PreviousImages: []model.EcommercePlanTask{
			ecommerceRoundsTestImage("old-1", "task-1", `{"productName":"A"}`),
			ecommerceRoundsTestImage("old-2", "task-2", `{"productName":"A"}`),
			ecommerceRoundsTestImage("old-3", "task-3", `{"productName":"B"}`),
		},
	}
	raw, _ := json.Marshal(plan)
	project := &model.EcommerceProject{ID: "project-1", UserID: "user-1", Name: "商品", Status: "draft", DraftJSON: `{}`, PlanJSON: string(raw), Revision: 1}
	if err := repo.CreateEcommerceProject(project); err != nil {
		t.Fatal(err)
	}
	converted, created, err := repo.ConvertEcommerceProjectRounds("user-1", "project-1", 1)
	if err != nil {
		t.Fatal(err)
	}
	if created != 2 || converted.ActiveRoundID == "" || converted.Revision != 2 {
		t.Fatalf("created=%d active=%q revision=%d", created, converted.ActiveRoundID, converted.Revision)
	}
	count, images, err := repo.EcommerceRoundStats("user-1", "project-1")
	if err != nil || count != 2 || images != 3 {
		t.Fatalf("stats count=%d images=%d err=%v", count, images, err)
	}
	var storedPlan model.EcommercePlan
	if err := json.Unmarshal([]byte(converted.PlanJSON), &storedPlan); err != nil {
		t.Fatal(err)
	}
	if len(storedPlan.PreviousImages) != 0 || len(storedPlan.Images) != 1 {
		t.Fatalf("converted plan = %+v", storedPlan)
	}
	converted, created, err = repo.ConvertEcommerceProjectRounds("user-1", "project-1", converted.Revision)
	if err != nil || created != 0 {
		t.Fatalf("second conversion created=%d err=%v", created, err)
	}
	count, _, _ = repo.EcommerceRoundStats("user-1", "project-1")
	if count != 2 {
		t.Fatalf("rounds duplicated: %d", count)
	}
}

func TestLegacySaveOnConvertedProjectSplitsInlineHistory(t *testing.T) {
	db := ecommerceRoundsTestDB(t)
	repo := New(db)
	project := ecommerceRoundsTestProject("{}")
	if err := repo.CreateEcommerceProject(project); err != nil {
		t.Fatal(err)
	}
	plan := model.EcommercePlan{
		Images: []model.EcommercePlanTask{ecommerceRoundsTestImage("active-1", "task-active", "")},
		PreviousImages: []model.EcommercePlanTask{
			ecommerceRoundsTestImage("old-1", "task-1", `{"productName":"A"}`),
			ecommerceRoundsTestImage("old-2", "task-2", `{"productName":"B"}`),
		},
	}
	raw, _ := json.Marshal(plan)
	legacy := *project
	legacy.PlanJSON = string(raw)
	legacy.DraftJSON = `{"productName":"商品"}`
	if err := repo.SaveEcommerceProject(&legacy, 1); err != nil {
		t.Fatal(err)
	}
	count, images, err := repo.EcommerceRoundStats("user-1", "project-1")
	if err != nil || count != 2 || images != 2 {
		t.Fatalf("rounds count=%d images=%d err=%v", count, images, err)
	}
	stored, err := repo.EcommerceProject("user-1", "project-1")
	if err != nil {
		t.Fatal(err)
	}
	var storedPlan model.EcommercePlan
	if err := json.Unmarshal([]byte(stored.PlanJSON), &storedPlan); err != nil {
		t.Fatal(err)
	}
	if len(storedPlan.PreviousImages) != 0 || len(storedPlan.Images) != 1 {
		t.Fatalf("legacy save kept inline history: %+v", storedPlan)
	}
	legacyAgain := *stored
	legacyAgain.PlanJSON = string(raw)
	if err := repo.SaveEcommerceProject(&legacyAgain, stored.Revision); err != nil {
		t.Fatal(err)
	}
	count, _, _ = repo.EcommerceRoundStats("user-1", "project-1")
	if count != 2 {
		t.Fatalf("legacy retry duplicated rounds: %d", count)
	}
}

func TestUpdateEcommerceRoundImageVersionAndIdempotency(t *testing.T) {
	db := ecommerceRoundsTestDB(t)
	repo := New(db)
	project := ecommerceRoundsTestProject(ecommerceRoundsTestPlan(ecommerceRoundsTestImage("image-1", "task-1", "")))
	if err := repo.CreateEcommerceProject(project); err != nil {
		t.Fatal(err)
	}
	next := *project
	next.PlanJSON = "{}"
	if err := repo.SaveEcommerceProjectRounds(&next, 1, EcommerceRoundsSaveOptions{RoundMode: true, AdvanceRound: true, ActiveRoundID: "active-1"}); err != nil {
		t.Fatal(err)
	}
	rounds, _, err := repo.EcommerceRoundPage("user-1", "project-1", 10, 0)
	if err != nil || len(rounds) != 1 {
		t.Fatalf("rounds=%d err=%v", len(rounds), err)
	}
	image := ecommerceRoundsTestImage("image-1", "task-2", "")
	image.Prompt = "edited"
	updated, changed, err := repo.UpdateEcommerceRoundImage("user-1", "project-1", rounds[0].ID, "image-1", EcommerceRoundImageUpdate{ExpectedVersion: rounds[0].Version, Image: &image})
	if err != nil || !changed || updated.Version != 2 {
		t.Fatalf("changed=%v version=%d err=%v", changed, updated.Version, err)
	}
	again, changed, err := repo.UpdateEcommerceRoundImage("user-1", "project-1", rounds[0].ID, "image-1", EcommerceRoundImageUpdate{ExpectedVersion: 2, Image: &image})
	if err != nil || changed || again.Version != 2 {
		t.Fatalf("idempotent changed=%v version=%d err=%v", changed, again.Version, err)
	}
	stale := ecommerceRoundsTestImage("image-1", "task-3", "")
	if _, _, err := repo.UpdateEcommerceRoundImage("user-1", "project-1", rounds[0].ID, "image-1", EcommerceRoundImageUpdate{ExpectedVersion: 1, Image: &stale}); !errors.Is(err, ErrEcommerceRoundConflict) {
		t.Fatalf("stale err = %v", err)
	}
	_, changed, err = repo.UpdateEcommerceRoundImage("user-1", "project-1", rounds[0].ID, "image-1", EcommerceRoundImageUpdate{ExpectedVersion: 2, Remove: true})
	if err != nil || !changed {
		t.Fatalf("remove changed=%v err=%v", changed, err)
	}
	removed, _, err := repo.UpdateEcommerceRoundImage("user-1", "project-1", rounds[0].ID, "image-1", EcommerceRoundImageUpdate{ExpectedVersion: 3, Remove: true})
	if err != nil || removed.ImageCount != 0 {
		t.Fatalf("imageCount=%d err=%v", removed.ImageCount, err)
	}
}
