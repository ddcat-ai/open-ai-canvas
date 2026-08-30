package service

import (
	"testing"
	"time"

	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/repository"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func newProjectSettingsTestService(t *testing.T) (*Service, *gorm.DB) {
	t.Helper()
	db, err := gorm.Open(sqlite.Open("file:"+newID()+"?mode=memory&cache=shared"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(
		&model.Project{}, &model.ProjectUnit{}, &model.Resource{}, &model.Asset{}, &model.AssetVersion{}, &model.AssetRepresentation{},
		&model.CanvasProject{}, &model.StyleProfile{}, &model.ProjectAssetCandidate{}, &model.WorkflowInstance{}, &model.WorkflowStepInstance{},
		&model.Shot{}, &model.ShotArtifact{}, &model.VoiceProfile{},
	); err != nil {
		t.Fatal(err)
	}
	return &Service{repo: repository.New(db)}, db
}

func TestUpdateProjectCoverRequiresOwnedReadyImage(t *testing.T) {
	service, db := newProjectSettingsTestService(t)
	now := time.Now()
	project := model.Project{ID: "project-cover", UserID: "user-1", Name: "短剧", Status: model.ProjectStatusActive, Revision: 1, CreatedAt: now, UpdatedAt: now}
	resources := []model.Resource{
		{ID: "cover-ready", UserID: "user-1", Kind: "image", Status: model.ResourceStatusReady},
		{ID: "cover-pending", UserID: "user-1", Kind: "image", Status: model.ResourceStatusPending},
		{ID: "cover-video", UserID: "user-1", Kind: "video", Status: model.ResourceStatusReady},
		{ID: "cover-other-user", UserID: "user-2", Kind: "image", Status: model.ResourceStatusReady},
	}
	if err := db.Create(&project).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&resources).Error; err != nil {
		t.Fatal(err)
	}

	coverID := "cover-ready"
	updated, err := service.UpdateProject("user-1", project.ID, UpdateProjectRequest{CoverResourceID: &coverID})
	if err != nil {
		t.Fatal(err)
	}
	if updated.CoverResourceID != coverID {
		t.Fatalf("cover resource id = %q, want %q", updated.CoverResourceID, coverID)
	}
	var persisted model.Project
	if err := db.First(&persisted, "id = ?", project.ID).Error; err != nil {
		t.Fatal(err)
	}
	if persisted.CoverResourceID != coverID {
		t.Fatalf("persisted cover resource id = %q, want %q", persisted.CoverResourceID, coverID)
	}

	for _, invalidID := range []string{"cover-pending", "cover-video", "cover-other-user", "missing"} {
		if _, err := service.UpdateProject("user-1", project.ID, UpdateProjectRequest{CoverResourceID: &invalidID}); err == nil {
			t.Fatalf("UpdateProject cover %q succeeded, want validation error", invalidID)
		}
	}

	empty := ""
	cleared, err := service.UpdateProject("user-1", project.ID, UpdateProjectRequest{CoverResourceID: &empty})
	if err != nil {
		t.Fatal(err)
	}
	if cleared.CoverResourceID != "" {
		t.Fatalf("cover resource id = %q after clear", cleared.CoverResourceID)
	}
	if err := db.First(&persisted, "id = ?", project.ID).Error; err != nil {
		t.Fatal(err)
	}
	if persisted.CoverResourceID != "" {
		t.Fatalf("persisted cover resource id = %q after clear", persisted.CoverResourceID)
	}
}

func TestUpdateProjectPersistsDefaultGenerationModels(t *testing.T) {
	service, db := newProjectSettingsTestService(t)
	now := time.Now()
	project := model.Project{ID: "project-model-defaults", UserID: "user-1", Name: "短剧", Status: model.ProjectStatusActive, Revision: 1, CreatedAt: now, UpdatedAt: now}
	if err := db.Create(&project).Error; err != nil {
		t.Fatal(err)
	}

	imageModel := " system-channel::image-model "
	videoModel := "user-channel::MiniMax-H3"
	updated, err := service.UpdateProject("user-1", project.ID, UpdateProjectRequest{DefaultImageModel: &imageModel, DefaultVideoModel: &videoModel})
	if err != nil {
		t.Fatal(err)
	}
	if updated.DefaultImageModel != "system-channel::image-model" || updated.DefaultVideoModel != videoModel {
		t.Fatalf("updated model defaults = %q / %q", updated.DefaultImageModel, updated.DefaultVideoModel)
	}

	var persisted model.Project
	if err := db.First(&persisted, "id = ?", project.ID).Error; err != nil {
		t.Fatal(err)
	}
	if persisted.DefaultImageModel != updated.DefaultImageModel || persisted.DefaultVideoModel != updated.DefaultVideoModel {
		t.Fatalf("persisted model defaults = %q / %q", persisted.DefaultImageModel, persisted.DefaultVideoModel)
	}

	empty := ""
	cleared, err := service.UpdateProject("user-1", project.ID, UpdateProjectRequest{DefaultVideoModel: &empty})
	if err != nil {
		t.Fatal(err)
	}
	if cleared.DefaultVideoModel != "" {
		t.Fatalf("default video model = %q after clear", cleared.DefaultVideoModel)
	}
}

func TestProjectUnitSummaryPersistsWordCount(t *testing.T) {
	service, db := newProjectSettingsTestService(t)
	now := time.Now()
	project := model.Project{ID: "project-words", UserID: "user-1", Name: "长篇短剧", Status: model.ProjectStatusActive, Revision: 1, CreatedAt: now, UpdatedAt: now}
	if err := db.Create(&project).Error; err != nil {
		t.Fatal(err)
	}

	unit, err := service.CreateProjectUnit("user-1", project.ID, CreateProjectUnitRequest{Title: "第一章", SourceText: "<p>张振天&nbsp;归来</p>"})
	if err != nil {
		t.Fatal(err)
	}
	if unit.WordCount != 6 {
		t.Fatalf("created word count = %d, want 6", unit.WordCount)
	}

	unit, err = service.UpdateProjectUnit("user-1", project.ID, unit.ID, UpdateProjectUnitRequest{Title: unit.Title, SourceText: "<p>新的正文</p>"})
	if err != nil {
		t.Fatal(err)
	}
	if unit.WordCount != 4 {
		t.Fatalf("updated word count = %d, want 4", unit.WordCount)
	}

	summaries, err := service.repo.ProjectUnitSummaries(project.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(summaries) != 1 || summaries[0].WordCount != 4 || summaries[0].SourceText != "" {
		t.Fatalf("summary = %+v", summaries)
	}
}

func TestProjectCoverAppearsInResourceReferences(t *testing.T) {
	service, db := newProjectSettingsTestService(t)
	project := model.Project{ID: "project-cover-reference", UserID: "user-1", Name: "封面引用", CoverResourceID: "cover-resource"}
	if err := db.Create(&project).Error; err != nil {
		t.Fatal(err)
	}
	snapshot, err := service.repo.ResourceReferenceSnapshot("user-1", "", []string{"cover-resource"})
	if err != nil {
		t.Fatal(err)
	}
	if len(snapshot.Direct) != 1 || snapshot.Direct[0].ResourceID != "cover-resource" || snapshot.Direct[0].Kind != "项目主图" {
		t.Fatalf("direct references = %+v", snapshot.Direct)
	}
}
