package service

import (
	"reflect"
	"testing"
	"time"

	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/repository"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func newProjectWorkflowV2TestService(t *testing.T) (*Service, *gorm.DB) {
	t.Helper()
	db, err := gorm.Open(sqlite.Open("file:"+newID()+"?mode=memory&cache=shared"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(
		&model.Project{}, &model.ProjectUnit{}, &model.CanvasProject{}, &model.Asset{}, &model.AssetVersion{}, &model.ProjectAssetLink{},
		&model.Shot{}, &model.ShotRevision{}, &model.ShotArtifact{}, &model.ShotAssetReference{},
		&model.WorkflowTemplateVersion{}, &model.WorkflowInstance{}, &model.WorkflowStepInstance{}, &model.WorkflowStepTask{},
		&model.ProductionTaskLink{}, &model.Task{}, &model.Resource{},
	); err != nil {
		t.Fatal(err)
	}
	return &Service{repo: repository.New(db)}, db
}

func seedWorkflowProject(t *testing.T, db *gorm.DB) (model.Project, model.ProjectUnit) {
	t.Helper()
	now := time.Now()
	project := model.Project{ID: "project-1", UserID: "user-1", Name: "短剧", Status: model.ProjectStatusActive, Revision: 1, CreatedAt: now, UpdatedAt: now}
	unit := model.ProjectUnit{ID: "unit-1", ProjectID: project.ID, Kind: model.ProjectUnitKindChapter, Title: "第一章", Status: model.ProjectUnitStatusDraft, CreatedAt: now, UpdatedAt: now}
	if err := db.Create(&project).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&unit).Error; err != nil {
		t.Fatal(err)
	}
	return project, unit
}

func TestShortDramaWorkflowV2UsesProductionOrder(t *testing.T) {
	service, db := newProjectWorkflowV2TestService(t)
	project, unit := seedWorkflowProject(t, db)
	if err := service.EnsureBuiltinProjectWorkflowTemplate(); err != nil {
		t.Fatal(err)
	}
	workflow, err := service.CreateUnitWorkflow("user-1", project.ID, unit.ID)
	if err != nil {
		t.Fatal(err)
	}
	keys := make([]string, 0, len(workflow.Steps))
	for _, step := range workflow.Steps {
		keys = append(keys, step.StepKey)
	}
	want := []string{"story", "assets", "storyboard", "previz", "video", "delivery"}
	if !reflect.DeepEqual(keys, want) {
		t.Fatalf("step keys = %v, want %v", keys, want)
	}
	if workflow.Steps[0].Status != model.WorkflowStepStatusReady {
		t.Fatalf("first step status = %s, want ready", workflow.Steps[0].Status)
	}
}

func TestWorkflowCompletionRequiresStageGate(t *testing.T) {
	service, db := newProjectWorkflowV2TestService(t)
	project, unit := seedWorkflowProject(t, db)
	if err := service.EnsureBuiltinProjectWorkflowTemplate(); err != nil {
		t.Fatal(err)
	}
	workflow, err := service.CreateUnitWorkflow("user-1", project.ID, unit.ID)
	if err != nil {
		t.Fatal(err)
	}
	step := workflow.Steps[0]
	if _, err := service.UpdateWorkflowStep("user-1", project.ID, step.ID, UpdateWorkflowStepRequest{Status: "running"}); err != nil {
		t.Fatal(err)
	}
	if _, err := service.UpdateWorkflowStep("user-1", project.ID, step.ID, UpdateWorkflowStepRequest{Status: "completed"}); err == nil {
		t.Fatal("empty chapter completed story gate")
	}
	unit.SourceText = "第一章正文"
	unit.UpdatedAt = time.Now()
	if err := db.Save(&unit).Error; err != nil {
		t.Fatal(err)
	}
	if _, err := service.UpdateWorkflowStep("user-1", project.ID, step.ID, UpdateWorkflowStepRequest{Status: "completed"}); err != nil {
		t.Fatal(err)
	}
}

func TestCreateShotRevisionInvalidatesExistingArtifacts(t *testing.T) {
	service, db := newProjectWorkflowV2TestService(t)
	project, unit := seedWorkflowProject(t, db)
	if err := service.EnsureBuiltinProjectWorkflowTemplate(); err != nil {
		t.Fatal(err)
	}
	workflow, err := service.CreateUnitWorkflow("user-1", project.ID, unit.ID)
	if err != nil {
		t.Fatal(err)
	}
	shot, err := service.CreateProjectShot("user-1", project.ID, CreateProjectShotRequest{UnitID: unit.ID, Title: "SC.01", Description: "人物推门进入", DurationMs: 3000})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.Model(&model.WorkflowStepInstance{}).Where("workflow_instance_id = ? AND step_key IN ?", workflow.Instance.ID, []string{"storyboard", "previz", "video", "delivery"}).Updates(map[string]any{"status": model.WorkflowStepStatusCompleted}).Error; err != nil {
		t.Fatal(err)
	}
	artifact := model.ShotArtifact{ID: "artifact-1", ProjectID: project.ID, UnitID: unit.ID, ShotID: shot.ID, RevisionID: shot.CurrentRevisionID, Type: "action_board", Version: 1, Status: "ready", Selected: true, CreatedAt: time.Now(), UpdatedAt: time.Now()}
	if err := db.Create(&artifact).Error; err != nil {
		t.Fatal(err)
	}
	updatedShot, revision, err := service.CreateShotRevision("user-1", project.ID, shot.ID, ShotRevisionInput{PlotDescription: "人物推门后停在门口", Action: "推门、停顿", DurationMs: 3500})
	if err != nil {
		t.Fatal(err)
	}
	if revision.Version != 2 || updatedShot.CurrentRevisionID != revision.ID {
		t.Fatalf("revision = v%d current=%s, want v2 current revision", revision.Version, updatedShot.CurrentRevisionID)
	}
	var storedArtifact model.ShotArtifact
	if err := db.First(&storedArtifact, "id = ?", artifact.ID).Error; err != nil {
		t.Fatal(err)
	}
	if storedArtifact.Status != "stale" || storedArtifact.Selected {
		t.Fatalf("artifact status=%s selected=%v, want stale false", storedArtifact.Status, storedArtifact.Selected)
	}
	var storyboardStep model.WorkflowStepInstance
	if err := db.First(&storyboardStep, "workflow_instance_id = ? AND step_key = ?", workflow.Instance.ID, "storyboard").Error; err != nil {
		t.Fatal(err)
	}
	if storyboardStep.Status != model.WorkflowStepStatusRunning {
		t.Fatalf("storyboard step status = %s, want running", storyboardStep.Status)
	}
	var videoStep model.WorkflowStepInstance
	if err := db.First(&videoStep, "workflow_instance_id = ? AND step_key = ?", workflow.Instance.ID, "video").Error; err != nil {
		t.Fatal(err)
	}
	if videoStep.Status != model.WorkflowStepStatusPending {
		t.Fatalf("video step status = %s, want pending", videoStep.Status)
	}
}

func TestUpdateChapterSourceInvalidatesAllUnitArtifacts(t *testing.T) {
	service, db := newProjectWorkflowV2TestService(t)
	project, unit := seedWorkflowProject(t, db)
	if err := service.EnsureBuiltinProjectWorkflowTemplate(); err != nil {
		t.Fatal(err)
	}
	workflow, err := service.CreateUnitWorkflow("user-1", project.ID, unit.ID)
	if err != nil {
		t.Fatal(err)
	}
	shot, err := service.CreateProjectShot("user-1", project.ID, CreateProjectShotRequest{UnitID: unit.ID, Title: "SC.01", Description: "旧剧情镜头", DurationMs: 3000})
	if err != nil {
		t.Fatal(err)
	}
	artifact := model.ShotArtifact{ID: "artifact-source-1", ProjectID: project.ID, UnitID: unit.ID, ShotID: shot.ID, RevisionID: shot.CurrentRevisionID, Type: "video", Version: 1, Status: "ready", Selected: true, CreatedAt: time.Now(), UpdatedAt: time.Now()}
	if err := db.Create(&artifact).Error; err != nil {
		t.Fatal(err)
	}
	if _, err := service.UpdateProjectUnit("user-1", project.ID, unit.ID, UpdateProjectUnitRequest{Title: unit.Title, SourceText: "修改后的章节正文"}); err != nil {
		t.Fatal(err)
	}
	var storedArtifact model.ShotArtifact
	if err := db.First(&storedArtifact, "id = ?", artifact.ID).Error; err != nil {
		t.Fatal(err)
	}
	if storedArtifact.Status != "stale" || storedArtifact.Selected {
		t.Fatalf("artifact status=%s selected=%v, want stale false", storedArtifact.Status, storedArtifact.Selected)
	}
	var storyStep model.WorkflowStepInstance
	if err := db.First(&storyStep, "workflow_instance_id = ? AND step_key = ?", workflow.Instance.ID, "story").Error; err != nil {
		t.Fatal(err)
	}
	if storyStep.Status != model.WorkflowStepStatusRunning {
		t.Fatalf("story step status = %s, want running", storyStep.Status)
	}
}

func TestRegisterTaskOutputAcceptsLinkedCanvasAndCreatesShotArtifact(t *testing.T) {
	service, db := newProjectWorkflowV2TestService(t)
	project, unit := seedWorkflowProject(t, db)
	if err := service.EnsureBuiltinProjectWorkflowTemplate(); err != nil {
		t.Fatal(err)
	}
	workflow, err := service.CreateUnitWorkflow("user-1", project.ID, unit.ID)
	if err != nil {
		t.Fatal(err)
	}
	shot, err := service.CreateProjectShot("user-1", project.ID, CreateProjectShotRequest{UnitID: unit.ID, Title: "SC.01", Description: "人物走入画面", DurationMs: 3000})
	if err != nil {
		t.Fatal(err)
	}
	canvas := model.CanvasProject{ID: "canvas-1", UserID: "user-1", ProjectID: project.ID, Title: "探索画布", CreatedAt: time.Now(), UpdatedAt: time.Now()}
	task := model.Task{ID: "task-1", UserID: "user-1", ProjectID: canvas.ID, Status: model.TaskStatusSucceeded, ResultJSON: `{}`, CreatedAt: time.Now(), UpdatedAt: time.Now()}
	resource := model.Resource{ID: "resource-1", UserID: "user-1", Kind: "image", Status: model.ResourceStatusReady, CreatedAt: time.Now(), UpdatedAt: time.Now()}
	for _, item := range []any{&canvas, &task, &resource} {
		if err := db.Create(item).Error; err != nil {
			t.Fatal(err)
		}
	}
	step := workflow.Steps[0]
	updatedStep, err := service.RegisterTaskOutput("user-1", project.ID, step.ID, RegisterTaskOutputRequest{TaskID: task.ID, UnitID: unit.ID, ShotID: shot.ID, ArtifactType: "storyboard", ResourceID: resource.ID, MediaType: "image"})
	if err != nil {
		t.Fatal(err)
	}
	if updatedStep.Status != model.WorkflowStepStatusRunning {
		t.Fatalf("step status = %s, want running until the unit gate is complete", updatedStep.Status)
	}
	var nextStep model.WorkflowStepInstance
	if err := db.First(&nextStep, "workflow_instance_id = ? AND position = ?", workflow.Instance.ID, 1).Error; err != nil {
		t.Fatal(err)
	}
	if nextStep.Status != model.WorkflowStepStatusPending {
		t.Fatalf("next step status = %s, want pending", nextStep.Status)
	}
	var productionLink model.ProductionTaskLink
	if err := db.First(&productionLink, "task_id = ?", task.ID).Error; err != nil {
		t.Fatal(err)
	}
	if productionLink.ProjectID != project.ID || productionLink.CanvasID != canvas.ID || productionLink.ShotID != shot.ID {
		t.Fatalf("unexpected production link: %+v", productionLink)
	}
	var storedArtifact model.ShotArtifact
	if err := db.First(&storedArtifact, "task_id = ?", task.ID).Error; err != nil {
		t.Fatal(err)
	}
	if storedArtifact.Type != "storyboard" || storedArtifact.Status != "ready" || !storedArtifact.Selected {
		t.Fatalf("unexpected shot artifact: %+v", storedArtifact)
	}
}
