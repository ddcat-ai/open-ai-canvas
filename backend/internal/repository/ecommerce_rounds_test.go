package repository

import (
	"encoding/json"
	"errors"
	"fmt"
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

func TestConvertEcommerceProjectRoundsKeepsAdjacentDraftBoundaries(t *testing.T) {
	db := ecommerceRoundsTestDB(t)
	repo := New(db)
	draftA := `{"productName":"A"}`
	draftB := `{"productName":"B"}`
	plan := model.EcommercePlan{
		Images: []model.EcommercePlanTask{ecommerceRoundsTestImage("active-1", "task-active", "")},
		PreviousImages: []model.EcommercePlanTask{
			ecommerceRoundsTestImage("a-1", "task-a1", draftA),
			ecommerceRoundsTestImage("a-2", "task-a2", draftA),
			ecommerceRoundsTestImage("b-1", "task-b1", draftB),
			ecommerceRoundsTestImage("a-3", "task-a3", draftA),
		},
	}
	raw, _ := json.Marshal(plan)
	project := &model.EcommerceProject{ID: "project-1", UserID: "user-1", Name: "商品", Status: "draft", DraftJSON: `{}`, PlanJSON: string(raw), Revision: 1}
	if err := repo.CreateEcommerceProject(project); err != nil {
		t.Fatal(err)
	}
	if _, created, err := repo.ConvertEcommerceProjectRounds("user-1", "project-1", 1); err != nil || created != 3 {
		t.Fatalf("created=%d err=%v", created, err)
	}
	rounds, total, err := repo.EcommerceRoundPage("user-1", "project-1", 10, 0)
	if err != nil || total != 3 || len(rounds) != 3 {
		t.Fatalf("total=%d len=%d err=%v", total, len(rounds), err)
	}
	want := [][]string{{"a-3"}, {"b-1"}, {"a-1", "a-2"}}
	for index, round := range rounds {
		if round.Ordinal != 3-index {
			t.Fatalf("round %d ordinal=%d", index, round.Ordinal)
		}
		var archived model.EcommercePlan
		if err := json.Unmarshal([]byte(round.PlanJSON), &archived); err != nil {
			t.Fatal(err)
		}
		ids := make([]string, 0, len(archived.Images))
		for _, image := range archived.Images {
			ids = append(ids, image.ID)
		}
		if len(ids) != len(want[index]) {
			t.Fatalf("round %d images=%v want %v", round.Ordinal, ids, want[index])
		}
		for i := range ids {
			if ids[i] != want[index][i] {
				t.Fatalf("round %d images=%v want %v", round.Ordinal, ids, want[index])
			}
		}
	}
}

func TestArchiveKeepsFailedAndRunningTaskCards(t *testing.T) {
	db := ecommerceRoundsTestDB(t)
	repo := New(db)
	project := ecommerceRoundsTestProject(ecommerceRoundsTestPlan(
		ecommerceRoundsTestImage("ok", "task-ok", ""),
		ecommerceRoundsTestImage("failed", "task-failed", ""),
		ecommerceRoundsTestImage("running", "task-running", ""),
	))
	if err := repo.CreateEcommerceProject(project); err != nil {
		t.Fatal(err)
	}
	stored := *project
	stored.PlanJSON = "{}"
	if err := repo.SaveEcommerceProjectRounds(&stored, 1, EcommerceRoundsSaveOptions{RoundMode: true, AdvanceRound: true, ActiveRoundID: "active-1"}); err != nil {
		t.Fatal(err)
	}
	rounds, _, err := repo.EcommerceRoundPage("user-1", "project-1", 10, 0)
	if err != nil || len(rounds) != 1 || rounds[0].ImageCount != 3 {
		t.Fatalf("rounds=%d err=%v", len(rounds), err)
	}
	var archived model.EcommercePlan
	if err := json.Unmarshal([]byte(rounds[0].PlanJSON), &archived); err != nil {
		t.Fatal(err)
	}
	got := make([]string, 0, 3)
	for _, image := range archived.Images {
		got = append(got, image.TaskID)
	}
	want := []string{"task-ok", "task-failed", "task-running"}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("task ids=%v want %v", got, want)
		}
	}
}

func TestArchiveDeduplicatesRetriesButKeepsDifferentTaskIdentities(t *testing.T) {
	db := ecommerceRoundsTestDB(t)
	repo := New(db)
	first := ecommerceRoundsTestImage("image-a", "task-a", "")
	first.Prompt = "same visual"
	project := ecommerceRoundsTestProject(ecommerceRoundsTestPlan(first))
	if err := repo.CreateEcommerceProject(project); err != nil {
		t.Fatal(err)
	}
	second := ecommerceRoundsTestImage("image-b", "task-b", "")
	second.Prompt = "same visual"
	stored := *project
	stored.PlanJSON = ecommerceRoundsTestPlan(second)
	if err := repo.SaveEcommerceProjectRounds(&stored, 1, EcommerceRoundsSaveOptions{RoundMode: true, AdvanceRound: true, ActiveRoundID: "active-1"}); err != nil {
		t.Fatal(err)
	}
	if err := repo.SaveEcommerceProjectRounds(&stored, 2, EcommerceRoundsSaveOptions{RoundMode: true, AdvanceRound: true, ActiveRoundID: stored.ActiveRoundID}); err != nil {
		t.Fatal(err)
	}
	if count, images, err := repo.EcommerceRoundStats("user-1", "project-1"); err != nil || count != 2 || images != 2 {
		t.Fatalf("count=%d images=%d err=%v", count, images, err)
	}
	if ecommerceRoundKey(`{}`, []model.EcommercePlanTask{first}) == ecommerceRoundKey(`{}`, []model.EcommercePlanTask{second}) {
		t.Fatal("identical visuals with different task identities collapsed into one dedup key")
	}
}

func TestLegacyReplayDoesNotResurrectEditedOrRemovedRoundImage(t *testing.T) {
	db := ecommerceRoundsTestDB(t)
	repo := New(db)
	original := []model.EcommercePlanTask{
		ecommerceRoundsTestImage("image-1", "task-1", ""),
		ecommerceRoundsTestImage("image-2", "task-2", ""),
	}
	project := ecommerceRoundsTestProject(ecommerceRoundsTestPlan(original...))
	if err := repo.CreateEcommerceProject(project); err != nil {
		t.Fatal(err)
	}
	stored := *project
	stored.PlanJSON = "{}"
	if err := repo.SaveEcommerceProjectRounds(&stored, 1, EcommerceRoundsSaveOptions{RoundMode: true, AdvanceRound: true, ActiveRoundID: "active-1"}); err != nil {
		t.Fatal(err)
	}
	rounds, _, err := repo.EcommerceRoundPage("user-1", "project-1", 10, 0)
	if err != nil || len(rounds) != 1 {
		t.Fatalf("rounds=%d err=%v", len(rounds), err)
	}
	edited := ecommerceRoundsTestImage("image-1", "task-1", "")
	edited.Prompt = "edited prompt"
	if _, _, err := repo.UpdateEcommerceRoundImage("user-1", "project-1", rounds[0].ID, "image-1", EcommerceRoundImageUpdate{ExpectedVersion: 1, Image: &edited}); err != nil {
		t.Fatal(err)
	}
	removed, _, err := repo.UpdateEcommerceRoundImage("user-1", "project-1", rounds[0].ID, "image-2", EcommerceRoundImageUpdate{ExpectedVersion: 2, Remove: true})
	if err != nil || removed.ImageCount != 1 {
		t.Fatalf("remove imageCount=%d err=%v", removed.ImageCount, err)
	}

	replay := *project
	replay.PlanJSON = string(mustJSON(t, model.EcommercePlan{
		Images:         []model.EcommercePlanTask{},
		PreviousImages: originalWithDraft(original, `{"productName":"replayed"}`),
	}))
	current, err := repo.EcommerceProject("user-1", "project-1")
	if err != nil {
		t.Fatal(err)
	}
	replay.Revision = current.Revision
	if err := repo.SaveEcommerceProject(&replay, current.Revision); err != nil {
		t.Fatal(err)
	}
	if count, images, err := repo.EcommerceRoundStats("user-1", "project-1"); err != nil || count != 1 || images != 1 {
		t.Fatalf("replay duplicated rounds: count=%d images=%d err=%v", count, images, err)
	}
	after, err := repo.EcommerceRound("user-1", "project-1", rounds[0].ID)
	if err != nil {
		t.Fatal(err)
	}
	if after.Version != 3 || after.ImageCount != 1 {
		t.Fatalf("edited round overwritten: version=%d images=%d", after.Version, after.ImageCount)
	}
	var archived model.EcommercePlan
	if err := json.Unmarshal([]byte(after.PlanJSON), &archived); err != nil {
		t.Fatal(err)
	}
	if len(archived.Images) != 1 || archived.Images[0].ID != "image-1" || archived.Images[0].Prompt != "edited prompt" {
		t.Fatalf("archived plan resurrected removed or overwritten image: %+v", archived.Images)
	}
}

func originalWithDraft(images []model.EcommercePlanTask, draft string) []model.EcommercePlanTask {
	result := make([]model.EcommercePlanTask, 0, len(images))
	for _, image := range images {
		image.SourceDraft = json.RawMessage(draft)
		result = append(result, image)
	}
	return result
}

func mustJSON(t *testing.T, value any) []byte {
	t.Helper()
	raw, err := json.Marshal(value)
	if err != nil {
		t.Fatal(err)
	}
	return raw
}

func TestConvertEcommerceProjectRoundsRollsBackOnInterrupt(t *testing.T) {
	db := ecommerceRoundsTestDB(t)
	repo := New(db)
	plan := model.EcommercePlan{
		Images: []model.EcommercePlanTask{ecommerceRoundsTestImage("active-1", "task-active", "")},
		PreviousImages: []model.EcommercePlanTask{
			ecommerceRoundsTestImage("old-1", "task-1", `{"productName":"A"}`),
			ecommerceRoundsTestImage("old-2", "task-2", `{"productName":"B"}`),
		},
	}
	raw, _ := json.Marshal(plan)
	project := &model.EcommerceProject{ID: "project-1", UserID: "user-1", Name: "商品", Status: "draft", DraftJSON: `{}`, PlanJSON: string(raw), Revision: 1}
	if err := repo.CreateEcommerceProject(project); err != nil {
		t.Fatal(err)
	}
	roundCreates := 0
	const callback = "test:interrupt_second_round"
	if err := db.Callback().Create().Before("gorm:create").Register(callback, func(tx *gorm.DB) {
		if tx.Statement.Schema != nil && tx.Statement.Schema.Table == "ecommerce_rounds" {
			roundCreates++
			if roundCreates == 2 {
				tx.AddError(errors.New("injected interruption"))
			}
		}
	}); err != nil {
		t.Fatal(err)
	}
	if _, _, err := repo.ConvertEcommerceProjectRounds("user-1", "project-1", 1); err == nil {
		t.Fatal("interrupted conversion reported success")
	}
	count, _, err := repo.EcommerceRoundStats("user-1", "project-1")
	if err != nil || count != 0 {
		t.Fatalf("partial rounds survived rollback: count=%d err=%v", count, err)
	}
	stored, err := repo.EcommerceProject("user-1", "project-1")
	if err != nil || stored.Revision != 1 || stored.ActiveRoundID != "" {
		t.Fatalf("project changed after rollback: revision=%d active=%q err=%v", stored.Revision, stored.ActiveRoundID, err)
	}
	var storedPlan model.EcommercePlan
	if err := json.Unmarshal([]byte(stored.PlanJSON), &storedPlan); err != nil || len(storedPlan.PreviousImages) != 2 {
		t.Fatalf("legacy history lost after rollback: %+v err=%v", storedPlan, err)
	}
	if err := db.Callback().Create().Remove(callback); err != nil {
		t.Fatal(err)
	}
	if _, created, err := repo.ConvertEcommerceProjectRounds("user-1", "project-1", 1); err != nil || created != 2 {
		t.Fatalf("retry created=%d err=%v", created, err)
	}
	if count, images, err := repo.EcommerceRoundStats("user-1", "project-1"); err != nil || count != 2 || images != 2 {
		t.Fatalf("retry stats count=%d images=%d err=%v", count, images, err)
	}
}

func TestConvertEcommerceProjectWithoutHistoryPersistsActiveRound(t *testing.T) {
	db := ecommerceRoundsTestDB(t)
	repo := New(db)
	plan := model.EcommercePlan{Images: []model.EcommercePlanTask{ecommerceRoundsTestImage("active-1", "", "")}}
	raw, _ := json.Marshal(plan)
	project := &model.EcommerceProject{ID: "project-1", UserID: "user-1", Name: "商品", Status: "draft", DraftJSON: `{}`, PlanJSON: string(raw), Revision: 1}
	if err := repo.CreateEcommerceProject(project); err != nil {
		t.Fatal(err)
	}
	converted, created, err := repo.ConvertEcommerceProjectRounds("user-1", "project-1", 1)
	if err != nil {
		t.Fatal(err)
	}
	if created != 0 || converted.ActiveRoundID == "" || converted.Revision != 2 {
		t.Fatalf("created=%d active=%q revision=%d", created, converted.ActiveRoundID, converted.Revision)
	}
	again, created, err := repo.ConvertEcommerceProjectRounds("user-1", "project-1", converted.Revision)
	if err != nil || created != 0 || again.Revision != converted.Revision || again.ActiveRoundID != converted.ActiveRoundID {
		t.Fatalf("second conversion created=%d revision=%d err=%v", created, again.Revision, err)
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

// The save payload must stay bounded by the active round regardless of how
// much history a project accumulated; archived images are read from pages.
func TestConvertedSavePayloadStaysBoundedWithHistory(t *testing.T) {
	baseline := 0
	for _, archived := range []int{0, 42, 100, 500} {
		t.Run(fmt.Sprintf("%d-archived", archived), func(t *testing.T) {
			db := ecommerceRoundsTestDB(t)
			repo := New(db)
			previous := make([]model.EcommercePlanTask, 0, archived)
			for i := 0; i < archived; i++ {
				previous = append(previous, ecommerceRoundsTestImage(fmt.Sprintf("old-%d", i), fmt.Sprintf("task-old-%d", i), fmt.Sprintf(`{"batch":%d}`, i/6)))
			}
			active := make([]model.EcommercePlanTask, 0, 6)
			for i := 0; i < 6; i++ {
				active = append(active, ecommerceRoundsTestImage(fmt.Sprintf("active-%d", i), fmt.Sprintf("task-active-%d", i), `{"batch":"active"}`))
			}
			raw, _ := json.Marshal(model.EcommercePlan{Images: active, PreviousImages: previous})
			project := &model.EcommerceProject{ID: "project-1", UserID: "user-1", Name: "商品", Status: "draft", DraftJSON: `{"productName":"商品"}`, PlanJSON: string(raw), Revision: 1}
			if err := repo.CreateEcommerceProject(project); err != nil {
				t.Fatal(err)
			}
			converted, created, err := repo.ConvertEcommerceProjectRounds("user-1", "project-1", 1)
			if err != nil {
				t.Fatal(err)
			}
			if archived == 0 && created != 0 {
				t.Fatalf("created=%d without history", created)
			}
			var stored model.EcommercePlan
			if err := json.Unmarshal([]byte(converted.PlanJSON), &stored); err != nil {
				t.Fatal(err)
			}
			if len(stored.PreviousImages) != 0 || len(stored.Images) != 6 {
				t.Fatalf("stored plan previous=%d active=%d", len(stored.PreviousImages), len(stored.Images))
			}
			payload, err := json.Marshal(map[string]any{
				"revision": converted.Revision,
				"name":     converted.Name,
				"draft":    json.RawMessage(converted.DraftJSON),
				"plan":     stored,
			})
			if err != nil {
				t.Fatal(err)
			}
			if len(payload) > 64<<10 {
				t.Fatalf("save payload = %d bytes", len(payload))
			}
			if archived == 0 {
				baseline = len(payload)
			} else if len(payload) != baseline {
				t.Fatalf("save payload grew from %d to %d bytes with %d archived images", baseline, len(payload), archived)
			}

			seenImages, before, pages := 0, 0, 0
			for {
				rounds, total, err := repo.EcommerceRoundPage("user-1", "project-1", 10, before)
				if err != nil {
					t.Fatal(err)
				}
				if total != int64(created) {
					t.Fatalf("total=%d created=%d", total, created)
				}
				if len(rounds) == 0 {
					break
				}
				for _, round := range rounds {
					seenImages += round.ImageCount
				}
				before = rounds[len(rounds)-1].Ordinal
				pages++
				if pages > 100 {
					t.Fatal("history pagination did not terminate")
				}
			}
			if seenImages != archived {
				t.Fatalf("history images = %d, archived = %d", seenImages, archived)
			}
		})
	}
}
