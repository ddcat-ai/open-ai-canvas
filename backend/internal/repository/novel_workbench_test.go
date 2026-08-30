package repository

import (
	"testing"
	"time"

	"infinite-canvas/backend/internal/model"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func TestCommitNovelWorkbenchUnitIsAtomic(t *testing.T) {
	db, err := gorm.Open(sqlite.Open("file:novel-workbench-commit-atomic?mode=memory&cache=shared"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&model.Project{}, &model.NovelWorkbenchRun{}, &model.NovelWorkbenchArtifact{}, &model.ProjectUnit{}); err != nil {
		t.Fatal(err)
	}
	repo := New(db)
	now := time.Now()
	project := model.Project{ID: "project_atomic", UserID: "user_atomic", Name: "Atomic", Type: "novel", Status: model.ProjectStatusActive, CreatedAt: now, UpdatedAt: now}
	run := model.NovelWorkbenchRun{ID: "run_atomic", UserID: project.UserID, ProjectID: project.ID, OutputMode: "novel", EngineVersion: 2, Status: "running", Stage: "writing", PipelineStage: "unit", QualityPolicy: "strict", TargetUnitCount: 2, CurrentUnit: 1, CreatedAt: now, UpdatedAt: now}
	if err := db.Create(&project).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&run).Error; err != nil {
		t.Fatal(err)
	}

	committedRun := run
	committedRun.CompletedUnitCount = 1
	committedRun.CurrentUnit = 2
	committedRun.UpdatedAt = now.Add(time.Second)
	unit := model.ProjectUnit{ID: "unit_atomic_1", ProjectID: project.ID, Kind: model.ProjectUnitKindChapter, Title: "One", SourceText: "approved content", Status: model.ProjectUnitStatusCompleted, Position: 1, CreatedAt: now, UpdatedAt: committedRun.UpdatedAt}
	artifact := model.NovelWorkbenchArtifact{ID: "artifact_atomic_1", RunID: run.ID, ProjectID: project.ID, Unit: 1, Kind: "commit", Version: 2, ContentJSON: `{}`, CreatedAt: now, UpdatedAt: now}
	if err := repo.CommitNovelWorkbenchUnit(&committedRun, &unit, []model.NovelWorkbenchArtifact{artifact}); err != nil {
		t.Fatalf("initial atomic commit failed: %v", err)
	}

	var persistedRun model.NovelWorkbenchRun
	var persistedProject model.Project
	var artifactCount int64
	if err := db.First(&persistedRun, "id = ?", run.ID).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.First(&persistedProject, "id = ?", project.ID).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Model(&model.NovelWorkbenchArtifact{}).Where("run_id = ?", run.ID).Count(&artifactCount).Error; err != nil {
		t.Fatal(err)
	}
	if persistedRun.CompletedUnitCount != 1 || persistedProject.Revision != 1 || artifactCount != 1 {
		t.Fatalf("initial commit persistence mismatch: run=%d revision=%d artifacts=%d", persistedRun.CompletedUnitCount, persistedProject.Revision, artifactCount)
	}

	failingRun := persistedRun
	failingRun.CompletedUnitCount = 2
	failingRun.CurrentUnit = 3
	failingRun.UpdatedAt = now.Add(2 * time.Second)
	failingUnit := model.ProjectUnit{ID: "unit_atomic_2", ProjectID: project.ID, Kind: model.ProjectUnitKindChapter, Title: "Two", SourceText: "must roll back", Status: model.ProjectUnitStatusCompleted, Position: 2, CreatedAt: now, UpdatedAt: failingRun.UpdatedAt}
	duplicateArtifact := model.NovelWorkbenchArtifact{ID: artifact.ID, RunID: run.ID, ProjectID: project.ID, Unit: 2, Kind: "commit", Version: 2, ContentJSON: `{}`, CreatedAt: now, UpdatedAt: now}
	if err := repo.CommitNovelWorkbenchUnit(&failingRun, &failingUnit, []model.NovelWorkbenchArtifact{duplicateArtifact}); err == nil {
		t.Fatal("duplicate audit ID should fail the transaction")
	}

	var rolledBackUnitCount int64
	if err := db.Model(&model.ProjectUnit{}).Where("project_id = ? AND position = ?", project.ID, 2).Count(&rolledBackUnitCount).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.First(&persistedRun, "id = ?", run.ID).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.First(&persistedProject, "id = ?", project.ID).Error; err != nil {
		t.Fatal(err)
	}
	if rolledBackUnitCount != 0 || persistedRun.CompletedUnitCount != 1 || persistedProject.Revision != 1 {
		t.Fatalf("failed commit leaked state: units=%d completed=%d revision=%d", rolledBackUnitCount, persistedRun.CompletedUnitCount, persistedProject.Revision)
	}
}
