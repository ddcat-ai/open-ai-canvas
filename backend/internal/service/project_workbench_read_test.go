package service

import (
	"fmt"
	"testing"
	"time"

	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/repository"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func newProjectWorkbenchReadTestService(t *testing.T) (*Service, *gorm.DB) {
	t.Helper()
	db, err := gorm.Open(sqlite.Open("file:"+newID()+"?mode=memory&cache=shared"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(
		&model.Project{}, &model.ProjectUnit{}, &model.CanvasProject{}, &model.CanvasUnitLink{},
		&model.Asset{}, &model.AssetVersion{}, &model.AssetRepresentation{}, &model.ProjectAssetLink{}, &model.ProjectAssetCandidate{},
		&model.CharacterVoiceBinding{}, &model.VoiceProfile{},
		&model.Shot{}, &model.ShotRevision{}, &model.ShotArtifact{}, &model.ShotAssetReference{},
		&model.WorkflowInstance{}, &model.WorkflowStepInstance{}, &model.Task{},
	); err != nil {
		t.Fatal(err)
	}
	return &Service{repo: repository.New(db)}, db
}

func TestProjectUnitWorkspaceResolvesHistoricalVisualAndCurrentCharacterVoice(t *testing.T) {
	service, db := newProjectWorkbenchReadTestService(t)
	project := seedWorkbenchProject(t, db)
	unit := model.ProjectUnit{ID: "unit-1", ProjectID: project.ID, Title: "第一章", Status: model.ProjectUnitStatusReady}
	asset := model.Asset{
		ID: "character-1", UserID: "user-1", Title: "张天昊", Kind: "entity", Category: model.AssetCategoryCharacter,
		Status: model.AssetVersionStatusConfirmed, PrimaryVersionID: "character-v2", PayloadJSON: `{}`,
	}
	seed := []any{
		&unit,
		&asset,
		&model.ProjectAssetLink{ID: "link-1", ProjectID: project.ID, AssetID: asset.ID},
		&model.AssetVersion{ID: "character-v1", AssetID: asset.ID, Version: 1, Status: model.AssetVersionStatusConfirmed, DefinitionJSON: `{}`},
		&model.AssetVersion{ID: "character-v2", AssetID: asset.ID, Version: 2, Status: model.AssetVersionStatusConfirmed, DefinitionJSON: `{"voiceLanguage":"普通话","voiceAge":"青年男性","voiceTimbre":"略带疲惫和震惊"}`},
		&model.AssetRepresentation{ID: "representation-v1", TaskID: "visual-v1", AssetVersionID: "character-v1", ResourceID: "character-image-v1", MediaType: "image/png", Role: "primary"},
		&model.AssetRepresentation{ID: "representation-v2", TaskID: "visual-v2", AssetVersionID: "character-v2", ResourceID: "character-image-v2", MediaType: "image/png", Role: "primary"},
		&model.VoiceProfile{ID: "voice-1", UserID: "user-1", Name: "张天昊声音", Provider: "custom", VoiceKey: "voice-1", Language: "普通话", Timbre: "青年男声", SampleResourceID: "voice-sample-1", Status: "active", CompatibleModelsJSON: `[]`},
		&model.CharacterVoiceBinding{ID: "binding-1", AssetVersionID: "character-v2", VoiceProfileID: "voice-1", Instructions: "内心独白语气"},
		&model.Shot{ID: "shot-1", ProjectID: project.ID, UnitID: unit.ID, Position: 0},
		&model.ShotAssetReference{ID: "reference-1", ShotID: "shot-1", AssetVersionID: "character-v1", Role: "reference", Status: "linked"},
	}
	for _, item := range seed {
		if err := db.Create(item).Error; err != nil {
			t.Fatal(err)
		}
	}

	workspace, err := service.ProjectUnitWorkspace("user-1", project.ID, unit.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(workspace.ShotReferences) != 1 {
		t.Fatalf("shot references = %d, want 1", len(workspace.ShotReferences))
	}
	reference := workspace.ShotReferences[0]
	if reference.ReferencedVersion.ID != "character-v1" || len(reference.ReferencedVersion.Representations) != 1 || reference.ReferencedVersion.Representations[0].ResourceID != "character-image-v1" {
		t.Fatalf("historical visual snapshot not preserved: %+v", reference.ReferencedVersion)
	}
	if reference.Asset.Character == nil || reference.Asset.Character.VersionID != "character-v2" || reference.Asset.Character.Voice == nil {
		t.Fatalf("current character card not resolved: %+v", reference.Asset.Character)
	}
	if reference.Asset.Character.Voice.Profile.SampleResourceID != "voice-sample-1" || reference.Asset.Character.Voice.Instructions != "内心独白语气" {
		t.Fatalf("current character voice not resolved: %+v", reference.Asset.Character.Voice)
	}
}

func seedWorkbenchProject(t *testing.T, db *gorm.DB) model.Project {
	t.Helper()
	project := model.Project{ID: "project-1", UserID: "user-1", Name: "长篇短剧", Status: model.ProjectStatusActive}
	if err := db.Create(&project).Error; err != nil {
		t.Fatal(err)
	}
	return project
}

func TestProjectOverviewUsesAggregatesWithoutLoadingProjectCollections(t *testing.T) {
	service, db := newProjectWorkbenchReadTestService(t)
	project := seedWorkbenchProject(t, db)
	for index := 0; index < 12; index++ {
		status := model.ProjectUnitStatusReady
		if index < 3 {
			status = model.ProjectUnitStatusCompleted
		}
		unit := model.ProjectUnit{ID: fmt.Sprintf("unit-%02d", index), ProjectID: project.ID, Title: fmt.Sprintf("第%d章", index+1), Position: index, WordCount: 1200, Status: status}
		if err := db.Create(&unit).Error; err != nil {
			t.Fatal(err)
		}
		if index < 4 {
			if err := db.Create(&model.Shot{ID: fmt.Sprintf("shot-%02d", index), ProjectID: project.ID, UnitID: unit.ID, Position: 0}).Error; err != nil {
				t.Fatal(err)
			}
		}
	}
	overview, err := service.ProjectOverview("user-1", project.ID)
	if err != nil {
		t.Fatal(err)
	}
	if overview.Metrics.UnitCount != 12 || overview.Metrics.CompletedUnitCount != 3 || overview.Metrics.ShotCount != 4 {
		t.Fatalf("unexpected overview metrics: %+v", overview.Metrics)
	}
	if overview.Metrics.TotalWordCount != 14_400 || overview.Metrics.UnitsWithoutShots != 8 {
		t.Fatalf("unexpected aggregate totals: %+v", overview.Metrics)
	}
	if len(overview.Units) != 8 {
		t.Fatalf("overview units = %d, want capped 8", len(overview.Units))
	}
	if overview.Units[0].Unit.SourceText != "" {
		t.Fatal("overview unit unexpectedly contains source text")
	}
}

func TestProjectUnitWorkspaceIsolatesShotsAndBoundAssetsByUnit(t *testing.T) {
	service, db := newProjectWorkbenchReadTestService(t)
	project := seedWorkbenchProject(t, db)
	unit1 := model.ProjectUnit{ID: "unit-1", ProjectID: project.ID, Title: "第一章", Status: model.ProjectUnitStatusReady}
	unit2 := model.ProjectUnit{ID: "unit-2", ProjectID: project.ID, Title: "第二章", Position: 1, Status: model.ProjectUnitStatusReady}
	asset1 := model.Asset{ID: "asset-1", UserID: "user-1", Title: "角色甲", Kind: "image", Category: model.AssetCategoryOther, Status: model.AssetVersionStatusConfirmed}
	asset2 := model.Asset{ID: "asset-2", UserID: "user-1", Title: "角色乙", Kind: "image", Category: model.AssetCategoryOther, Status: model.AssetVersionStatusConfirmed}
	seed := []any{
		&unit1, &unit2, &asset1, &asset2,
		&model.AssetVersion{ID: "version-1", AssetID: asset1.ID, Version: 1, Status: model.AssetVersionStatusConfirmed},
		&model.AssetVersion{ID: "version-2", AssetID: asset2.ID, Version: 1, Status: model.AssetVersionStatusConfirmed},
		&model.ProjectAssetLink{ID: "link-1", ProjectID: project.ID, AssetID: asset1.ID},
		&model.ProjectAssetLink{ID: "link-2", ProjectID: project.ID, AssetID: asset2.ID},
		&model.Shot{ID: "shot-1", ProjectID: project.ID, UnitID: unit1.ID, Position: 0},
		&model.Shot{ID: "shot-2", ProjectID: project.ID, UnitID: unit2.ID, Position: 0},
		&model.ShotRevision{ID: "revision-1", ShotID: "shot-1", Version: 1},
		&model.ShotRevision{ID: "revision-2", ShotID: "shot-2", Version: 1},
		&model.ShotArtifact{ID: "artifact-1", ProjectID: project.ID, UnitID: unit1.ID, ShotID: "shot-1", Version: 1},
		&model.ShotArtifact{ID: "artifact-2", ProjectID: project.ID, UnitID: unit2.ID, ShotID: "shot-2", Version: 1},
		&model.ShotAssetReference{ID: "reference-1", ShotID: "shot-1", AssetVersionID: "version-1", Status: "linked"},
		&model.ShotAssetReference{ID: "reference-2", ShotID: "shot-2", AssetVersionID: "version-2", Status: "linked"},
		&model.ProjectAssetCandidate{ID: "candidate-1", ProjectID: project.ID, UnitID: unit1.ID, Name: "甲"},
		&model.ProjectAssetCandidate{ID: "candidate-2", ProjectID: project.ID, UnitID: unit2.ID, Name: "乙"},
	}
	for _, item := range seed {
		if err := db.Create(item).Error; err != nil {
			t.Fatal(err)
		}
	}
	workspace, err := service.ProjectUnitWorkspace("user-1", project.ID, unit1.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(workspace.Shots) != 1 || workspace.Shots[0].ID != "shot-1" || len(workspace.ShotRevisions) != 1 || workspace.ShotRevisions[0].ID != "revision-1" {
		t.Fatalf("workspace leaked another unit: shots=%+v revisions=%+v", workspace.Shots, workspace.ShotRevisions)
	}
	if len(workspace.ShotArtifacts) != 1 || workspace.ShotArtifacts[0].ID != "artifact-1" || len(workspace.ShotReferences) != 1 || workspace.ShotReferences[0].ID != "reference-1" {
		t.Fatalf("workspace artifact isolation failed: artifacts=%+v references=%+v", workspace.ShotArtifacts, workspace.ShotReferences)
	}
	if len(workspace.AssetCandidates) != 1 || workspace.AssetCandidates[0].ID != "candidate-1" || len(workspace.Assets) != 1 || workspace.Assets[0].ID != "asset-1" {
		t.Fatalf("workspace asset isolation failed: candidates=%+v assets=%+v", workspace.AssetCandidates, workspace.Assets)
	}
}

func TestProjectCanvasesPageReturnsLinksOnlyForCurrentPage(t *testing.T) {
	service, db := newProjectWorkbenchReadTestService(t)
	project := seedWorkbenchProject(t, db)
	if err := db.Create(&model.ProjectUnit{ID: "unit-1", ProjectID: project.ID, Title: "第一章"}).Error; err != nil {
		t.Fatal(err)
	}
	now := time.Now()
	for index := 0; index < 5; index++ {
		canvasID := fmt.Sprintf("canvas-%d", index)
		if err := db.Create(&model.CanvasProject{ID: canvasID, UserID: "user-1", ProjectID: project.ID, Title: canvasID, UpdatedAt: now.Add(time.Duration(index) * time.Minute)}).Error; err != nil {
			t.Fatal(err)
		}
		if err := db.Create(&model.CanvasUnitLink{ID: "link-" + canvasID, ProjectID: project.ID, CanvasID: canvasID, UnitID: "unit-1"}).Error; err != nil {
			t.Fatal(err)
		}
	}
	page, err := service.ProjectCanvasesPage("user-1", project.ID, 2, 2)
	if err != nil {
		t.Fatal(err)
	}
	if page.Total != 5 || len(page.Canvases) != 2 || len(page.CanvasUnitLinks) != 2 || !page.HasMore {
		t.Fatalf("unexpected canvas page: %+v", page)
	}
	pageIDs := map[string]bool{page.Canvases[0].ID: true, page.Canvases[1].ID: true}
	for _, link := range page.CanvasUnitLinks {
		if !pageIDs[link.CanvasID] {
			t.Fatalf("link %s does not belong to the current canvas page", link.CanvasID)
		}
	}
	units, err := service.ProjectUnitSummaries("user-1", project.ID)
	if err != nil {
		t.Fatal(err)
	}
	if units.CanvasCounts["unit-1"] != 5 {
		t.Fatalf("unit canvas count = %d, want 5", units.CanvasCounts["unit-1"])
	}
}

func TestProjectAssetsPagePaginatesAndReturnsFacets(t *testing.T) {
	service, db := newProjectWorkbenchReadTestService(t)
	project := seedWorkbenchProject(t, db)
	for index := 0; index < 6; index++ {
		category := model.AssetCategoryProp
		folderID := "folder-b"
		if index < 2 {
			category = model.AssetCategoryCharacter
			folderID = "folder-a"
		}
		asset := model.Asset{ID: fmt.Sprintf("asset-%d", index), UserID: "user-1", Title: fmt.Sprintf("资产%d", index), Kind: "image", Category: category, Status: model.AssetVersionStatusConfirmed}
		if err := db.Create(&asset).Error; err != nil {
			t.Fatal(err)
		}
		if err := db.Create(&model.ProjectAssetLink{ID: fmt.Sprintf("link-%d", index), ProjectID: project.ID, AssetID: asset.ID, FolderID: folderID}).Error; err != nil {
			t.Fatal(err)
		}
	}
	page, err := service.ProjectAssetsPage("user-1", project.ID, 2, 2, "prop", "image", "", nil, "")
	if err != nil {
		t.Fatal(err)
	}
	if page.Total != 4 || len(page.Assets) != 2 || page.CategoryCounts["character"] != 2 || page.CategoryCounts["prop"] != 4 {
		t.Fatalf("unexpected asset page/facets: %+v", page)
	}
	if page.FolderCounts["folder-a"] != 2 || page.FolderCounts["folder-b"] != 4 {
		t.Fatalf("unexpected folder facets: %+v", page.FolderCounts)
	}
}

func TestProjectAssetCandidatesPageSearchesNamesWithinFilters(t *testing.T) {
	service, db := newProjectWorkbenchReadTestService(t)
	project := seedWorkbenchProject(t, db)
	candidates := []model.ProjectAssetCandidate{
		{ID: "candidate-1", ProjectID: project.ID, UnitID: "unit-1", Name: "红色雨伞", Category: model.AssetCategoryProp, Status: "pending_confirmation"},
		{ID: "candidate-2", ProjectID: project.ID, UnitID: "unit-1", Name: "蓝色雨衣", Category: model.AssetCategoryProp, Status: "pending_confirmation"},
		{ID: "candidate-3", ProjectID: project.ID, UnitID: "unit-2", Name: "红色雨伞场景", Category: model.AssetCategoryEnvironment, Status: "pending_confirmation"},
	}
	if err := db.Create(&candidates).Error; err != nil {
		t.Fatal(err)
	}
	page, err := service.ProjectAssetCandidatesPage("user-1", project.ID, 1, 20, "unit-1", "pending_confirmation", "prop", "雨伞")
	if err != nil {
		t.Fatal(err)
	}
	if page.Total != 1 || len(page.Candidates) != 1 || page.Candidates[0].ID != "candidate-1" {
		t.Fatalf("unexpected candidate search result: %+v", page)
	}
}
