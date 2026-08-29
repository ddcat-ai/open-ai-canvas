package service

import (
	"encoding/json"
	"errors"
	"testing"

	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/repository"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func newProjectDeleteTestService(t *testing.T) (*Service, *gorm.DB) {
	t.Helper()
	db, err := gorm.Open(sqlite.Open("file:"+newID()+"?mode=memory&cache=shared"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(
		&model.Project{},
		&model.ProjectUnit{},
		&model.CanvasProject{},
		&model.CanvasShare{},
		&model.CanvasUnitLink{},
		&model.ProjectAssetLink{},
		&model.ProjectAssetFolder{},
		&model.ProjectAssetCandidate{},
		&model.Asset{},
		&model.Task{},
		&model.Session{},
		&model.Shot{},
		&model.ShotRevision{},
		&model.ShotArtifact{},
		&model.ShotAssetReference{},
		&model.WorkflowInstance{},
		&model.WorkflowStepInstance{},
		&model.WorkflowStepTask{},
		&model.ProductionTaskLink{},
	); err != nil {
		t.Fatal(err)
	}
	return &Service{repo: repository.New(db)}, db
}

func TestDeleteProjectUnlinksCanvasAndKeepsIndependentRecords(t *testing.T) {
	service, db := newProjectDeleteTestService(t)
	project := model.Project{ID: "project-1", UserID: "user-1", Name: "短剧", Status: model.ProjectStatusActive}
	canvas := model.CanvasProject{ID: "canvas-1", UserID: "user-1", ProjectID: project.ID, Title: "分镜", PayloadJSON: `{"projectId":"project-1","nodes":[]}`}
	asset := model.Asset{ID: "asset-1", UserID: "user-1", Title: "角色", Status: model.AssetVersionStatusConfirmed}
	task := model.Task{ID: "task-1", UserID: "user-1", ProjectID: project.ID, Status: model.TaskStatusSucceeded, Prompt: "已完成"}
	canvasTask := model.Task{ID: "task-2", UserID: "user-1", ProjectID: canvas.ID, Status: model.TaskStatusSucceeded, Prompt: "画布任务"}
	session := model.Session{ID: "session-1", UserID: "user-1", ProjectID: project.ID, Status: model.SessionStatusCompleted}
	canvasSession := model.Session{ID: "session-2", UserID: "user-1", ProjectID: canvas.ID, Status: model.SessionStatusCompleted}
	seed := []any{
		&project,
		&canvas,
		&model.CanvasShare{ID: "share-1", UserID: "user-1", ProjectID: project.ID},
		&model.ProjectUnit{ID: "unit-1", ProjectID: project.ID, Title: "第一集"},
		&model.CanvasUnitLink{ID: "canvas-link-1", ProjectID: project.ID, CanvasID: canvas.ID, UnitID: "unit-1"},
		&asset,
		&model.ProjectAssetLink{ID: "asset-link-1", ProjectID: project.ID, AssetID: asset.ID},
		&model.ProjectAssetFolder{ID: "folder-1", ProjectID: project.ID, Name: "角色", NameKey: "角色"},
		&model.ProjectAssetCandidate{ID: "candidate-1", ProjectID: project.ID, UnitID: "unit-1", Name: "角色", Status: "pending_confirmation"},
		&model.Shot{ID: "shot-1", ProjectID: project.ID, UnitID: "unit-1", CurrentRevisionID: "revision-1", Title: "镜头一"},
		&model.ShotRevision{ID: "revision-1", ShotID: "shot-1", Version: 1, PlotDescription: "角色入场"},
		&model.ShotArtifact{ID: "artifact-1", ProjectID: project.ID, UnitID: "unit-1", ShotID: "shot-1", RevisionID: "revision-1", Type: "storyboard", Version: 1, Status: "ready"},
		&task,
		&canvasTask,
		&model.ProductionTaskLink{ID: "production-link-1", TaskID: task.ID, ProjectID: project.ID, UnitID: "unit-1", ShotID: "shot-1"},
		&session,
		&canvasSession,
	}
	for _, item := range seed {
		if err := db.Create(item).Error; err != nil {
			t.Fatal(err)
		}
	}

	if err := service.DeleteProject("user-1", project.ID); err != nil {
		t.Fatal(err)
	}

	var storedProject model.Project
	if err := db.First(&storedProject, "id = ?", project.ID).Error; !errors.Is(err, gorm.ErrRecordNotFound) {
		t.Fatalf("project error = %v, want record not found", err)
	}
	var storedCanvas model.CanvasProject
	if err := db.First(&storedCanvas, "id = ?", canvas.ID).Error; err != nil {
		t.Fatal(err)
	}
	if storedCanvas.ProjectID != "" {
		t.Fatalf("canvas project id = %q, want empty", storedCanvas.ProjectID)
	}
	var payload map[string]any
	if err := json.Unmarshal([]byte(storedCanvas.PayloadJSON), &payload); err != nil {
		t.Fatal(err)
	}
	if _, exists := payload["projectId"]; exists {
		t.Fatalf("canvas payload still contains deleted project id: %s", storedCanvas.PayloadJSON)
	}

	for _, check := range []struct {
		name  string
		model any
		where string
	}{
		{name: "canvas share", model: &model.CanvasShare{}, where: "project_id = ?"},
		{name: "canvas unit link", model: &model.CanvasUnitLink{}, where: "project_id = ?"},
		{name: "project unit", model: &model.ProjectUnit{}, where: "project_id = ?"},
		{name: "asset link", model: &model.ProjectAssetLink{}, where: "project_id = ?"},
		{name: "asset folder", model: &model.ProjectAssetFolder{}, where: "project_id = ?"},
		{name: "asset candidate", model: &model.ProjectAssetCandidate{}, where: "project_id = ?"},
		{name: "shot", model: &model.Shot{}, where: "project_id = ?"},
		{name: "shot artifact", model: &model.ShotArtifact{}, where: "project_id = ?"},
		{name: "production task link", model: &model.ProductionTaskLink{}, where: "project_id = ?"},
	} {
		var count int64
		if err := db.Model(check.model).Where(check.where, project.ID).Count(&count).Error; err != nil {
			t.Fatal(err)
		}
		if count != 0 {
			t.Fatalf("%s count = %d, want 0", check.name, count)
		}
	}
	var storedAsset model.Asset
	if err := db.First(&storedAsset, "id = ?", asset.ID).Error; err != nil {
		t.Fatalf("asset should remain in the account library: %v", err)
	}

	var storedTask model.Task
	if err := db.First(&storedTask, "id = ?", task.ID).Error; err != nil {
		t.Fatal(err)
	}
	if storedTask.ProjectID != "" {
		t.Fatalf("direct project task id = %q, want empty", storedTask.ProjectID)
	}
	var storedCanvasTask model.Task
	if err := db.First(&storedCanvasTask, "id = ?", canvasTask.ID).Error; err != nil {
		t.Fatal(err)
	}
	if storedCanvasTask.ProjectID != canvas.ID {
		t.Fatalf("independent canvas task project id = %q, want %q", storedCanvasTask.ProjectID, canvas.ID)
	}
	var storedSession model.Session
	if err := db.First(&storedSession, "id = ?", session.ID).Error; err != nil {
		t.Fatal(err)
	}
	if storedSession.ProjectID != "" {
		t.Fatalf("direct project session id = %q, want empty", storedSession.ProjectID)
	}
	var storedCanvasSession model.Session
	if err := db.First(&storedCanvasSession, "id = ?", canvasSession.ID).Error; err != nil {
		t.Fatal(err)
	}
	if storedCanvasSession.ProjectID != canvas.ID {
		t.Fatalf("independent canvas session project id = %q, want %q", storedCanvasSession.ProjectID, canvas.ID)
	}
}

func TestDeleteUserCanvasProjectDetachesTaskAndSessionScope(t *testing.T) {
	service, db := newProjectDeleteTestService(t)
	canvas := model.CanvasProject{ID: "canvas-delete-1", UserID: "user-1", Title: "待删除画布", PayloadJSON: `{"id":"canvas-delete-1"}`}
	task := model.Task{ID: "task-canvas-delete-1", UserID: "user-1", ProjectID: canvas.ID, Status: model.TaskStatusSucceeded, Prompt: "已完成"}
	session := model.Session{ID: "session-canvas-delete-1", UserID: "user-1", ProjectID: canvas.ID, Status: model.SessionStatusCompleted}
	canvasLink := model.CanvasUnitLink{ID: "canvas-link-delete-1", ProjectID: "project-1", CanvasID: canvas.ID, UnitID: "unit-1", Role: "primary"}
	for _, item := range []any{&canvas, &model.CanvasShare{ID: "share-canvas-delete-1", UserID: "user-1", ProjectID: canvas.ID}, &canvasLink, &task, &session} {
		if err := db.Create(item).Error; err != nil {
			t.Fatal(err)
		}
	}

	if err := service.DeleteUserCanvasProject("user-1", canvas.ID); err != nil {
		t.Fatal(err)
	}
	var storedCanvas model.CanvasProject
	if err := db.First(&storedCanvas, "id = ?", canvas.ID).Error; !errors.Is(err, gorm.ErrRecordNotFound) {
		t.Fatalf("canvas error = %v, want record not found", err)
	}
	var storedTask model.Task
	if err := db.First(&storedTask, "id = ?", task.ID).Error; err != nil {
		t.Fatal(err)
	}
	if storedTask.ProjectID != "" {
		t.Fatalf("task project id = %q, want empty", storedTask.ProjectID)
	}
	var storedSession model.Session
	if err := db.First(&storedSession, "id = ?", session.ID).Error; err != nil {
		t.Fatal(err)
	}
	if storedSession.ProjectID != "" {
		t.Fatalf("session project id = %q, want empty", storedSession.ProjectID)
	}
	var shareCount int64
	if err := db.Model(&model.CanvasShare{}).Where("project_id = ?", canvas.ID).Count(&shareCount).Error; err != nil {
		t.Fatal(err)
	}
	if shareCount != 0 {
		t.Fatalf("canvas share count = %d, want 0", shareCount)
	}
	var linkCount int64
	if err := db.Model(&model.CanvasUnitLink{}).Where("canvas_id = ?", canvas.ID).Count(&linkCount).Error; err != nil {
		t.Fatal(err)
	}
	if linkCount != 0 {
		t.Fatalf("canvas link count = %d, want 0", linkCount)
	}
}

func TestDeleteProjectRejectsActiveProjectOrCanvasTasks(t *testing.T) {
	service, db := newProjectDeleteTestService(t)
	project := model.Project{ID: "project-1", UserID: "user-1", Name: "短剧", Status: model.ProjectStatusActive}
	canvas := model.CanvasProject{ID: "canvas-1", UserID: "user-1", ProjectID: project.ID, Title: "分镜", PayloadJSON: `{"projectId":"project-1"}`}
	activeTask := model.Task{ID: "task-1", UserID: "user-1", ProjectID: canvas.ID, Status: model.TaskStatusRunning, Prompt: "生成中"}
	for _, item := range []any{&project, &canvas, &activeTask} {
		if err := db.Create(item).Error; err != nil {
			t.Fatal(err)
		}
	}

	err := service.DeleteProject("user-1", project.ID)
	if err == nil || err.Error() != "项目仍有进行中的生成任务，请等待任务完成或取消后再删除" {
		t.Fatalf("DeleteProject() error = %v", err)
	}
	var storedProject model.Project
	if err := db.First(&storedProject, "id = ?", project.ID).Error; err != nil {
		t.Fatalf("project should remain after rejected deletion: %v", err)
	}
	var storedTask model.Task
	if err := db.First(&storedTask, "id = ?", activeTask.ID).Error; err != nil {
		t.Fatal(err)
	}
	if storedTask.ProjectID != canvas.ID {
		t.Fatalf("active task project id = %q, want %q", storedTask.ProjectID, canvas.ID)
	}
}

func TestRepositoryDeleteProjectRechecksActiveTasksInsideTransaction(t *testing.T) {
	service, db := newProjectDeleteTestService(t)
	project := model.Project{ID: "project-1", UserID: "user-1", Name: "短剧", Status: model.ProjectStatusActive}
	canvas := model.CanvasProject{ID: "canvas-1", UserID: "user-1", ProjectID: project.ID, Title: "分镜", PayloadJSON: `{"projectId":"project-1"}`}
	activeTask := model.Task{ID: "task-1", UserID: "user-1", ProjectID: canvas.ID, Status: model.TaskStatusQueued, Prompt: "排队中"}
	for _, item := range []any{&project, &canvas, &activeTask} {
		if err := db.Create(item).Error; err != nil {
			t.Fatal(err)
		}
	}

	err := service.repo.DeleteProject("user-1", project.ID, []model.CanvasProject{canvas})
	if !errors.Is(err, repository.ErrProjectHasActiveTasks) {
		t.Fatalf("DeleteProject() error = %v, want active-task conflict", err)
	}
	var storedProject model.Project
	if err := db.First(&storedProject, "id = ?", project.ID).Error; err != nil {
		t.Fatalf("project should remain after repository conflict: %v", err)
	}
	var storedCanvas model.CanvasProject
	if err := db.First(&storedCanvas, "id = ?", canvas.ID).Error; err != nil {
		t.Fatal(err)
	}
	if storedCanvas.ProjectID != project.ID {
		t.Fatalf("canvas project id = %q, want %q", storedCanvas.ProjectID, project.ID)
	}
}

func TestDeleteProjectRejectsCanvasPayloadThatCannotBeUpdated(t *testing.T) {
	service, db := newProjectDeleteTestService(t)
	project := model.Project{ID: "project-1", UserID: "user-1", Name: "短剧", Status: model.ProjectStatusActive}
	canvas := model.CanvasProject{ID: "canvas-1", UserID: "user-1", ProjectID: project.ID, Title: "分镜", PayloadJSON: "{"}
	for _, item := range []any{&project, &canvas} {
		if err := db.Create(item).Error; err != nil {
			t.Fatal(err)
		}
	}

	if err := service.DeleteProject("user-1", project.ID); err == nil {
		t.Fatal("DeleteProject() error = nil for malformed canvas payload")
	}
	var storedProject model.Project
	if err := db.First(&storedProject, "id = ?", project.ID).Error; err != nil {
		t.Fatalf("project should remain after payload validation failure: %v", err)
	}
}
