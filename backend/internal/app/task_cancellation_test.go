package app

import (
	"context"
	"testing"
	"time"

	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/repository"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func TestCancelTaskCancelsRunningTask(t *testing.T) {
	db, err := gorm.Open(sqlite.Open("file:"+newID()+"?mode=memory&cache=shared"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&model.Task{}); err != nil {
		t.Fatal(err)
	}
	startedAt := time.Now()
	task := model.Task{
		ID:        "running-task",
		UserID:    "user-1",
		Status:    model.TaskStatusRunning,
		Stage:     "后端接管任务",
		StartedAt: &startedAt,
	}
	if err := db.Create(&task).Error; err != nil {
		t.Fatal(err)
	}

	svc := &Service{repo: repository.New(db)}
	cancelled, err := svc.CancelTask(context.Background(), task.UserID, task.ID)
	if err != nil {
		t.Fatalf("CancelTask() error = %v", err)
	}
	if cancelled.Status != model.TaskStatusCancelled {
		t.Fatalf("CancelTask() status = %s, want cancelled", cancelled.Status)
	}

	stored, err := svc.repo.TaskForUser(task.UserID, task.ID)
	if err != nil {
		t.Fatal(err)
	}
	if stored.Status != model.TaskStatusCancelled || stored.CompletedAt == nil {
		t.Fatalf("running task was not cancelled: status=%s completedAt=%v", stored.Status, stored.CompletedAt)
	}
}

func TestCancelTaskRejectsUserCancellationAfterProviderStageStarts(t *testing.T) {
	for _, stage := range []string{"调用生成模型", "正在连接上游", "上游生成中", "后台仍在生成", "等待上游任务同步", "generating", "submitting", "submitted", "submission_unknown", "provider_processing", "作品已生成，正在保存"} {
		t.Run(stage, func(t *testing.T) {
			db, err := gorm.Open(sqlite.Open("file:"+newID()+"?mode=memory&cache=shared"), &gorm.Config{})
			if err != nil {
				t.Fatal(err)
			}
			if err := db.AutoMigrate(&model.Task{}); err != nil {
				t.Fatal(err)
			}
			task := model.Task{ID: "provider-stage-task", UserID: "user-1", Status: model.TaskStatusRunning, Stage: stage}
			if err := db.Create(&task).Error; err != nil {
				t.Fatal(err)
			}

			svc := &Service{repo: repository.New(db)}
			if _, err := svc.CancelTask(context.Background(), task.UserID, task.ID); err == nil || err.Error() != "第三方请求已提交，任务不可取消" {
				t.Fatalf("CancelTask() error = %v", err)
			}
		})
	}
}

func TestCancelTaskRejectsUserCancellationDuringMediaMaterialization(t *testing.T) {
	db, err := gorm.Open(sqlite.Open("file:"+newID()+"?mode=memory&cache=shared"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&model.Task{}); err != nil {
		t.Fatal(err)
	}
	task := model.Task{ID: "media-stage-task", UserID: "user-1", Status: model.TaskStatusRunning, Stage: "作品已生成，正在保存", MediaStage: "upload"}
	if err := db.Create(&task).Error; err != nil {
		t.Fatal(err)
	}

	svc := &Service{repo: repository.New(db)}
	if _, err := svc.CancelTask(context.Background(), task.UserID, task.ID); err == nil || err.Error() != "第三方请求已提交，任务不可取消" {
		t.Fatalf("CancelTask() error = %v", err)
	}
}

func TestInternalCancellationStillCoordinatesSubmittedTask(t *testing.T) {
	db, err := gorm.Open(sqlite.Open("file:"+newID()+"?mode=memory&cache=shared"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&model.Task{}); err != nil {
		t.Fatal(err)
	}
	task := model.Task{ID: "submitted-child", UserID: "user-1", Status: model.TaskStatusRunning, Stage: "上游生成中", ProviderRequestID: "provider-request-1"}
	if err := db.Create(&task).Error; err != nil {
		t.Fatal(err)
	}

	svc := &Service{repo: repository.New(db)}
	cancelled, err := svc.taskLifecycle().cancelTaskWithIntent(context.Background(), task.UserID, task.ID, model.TaskCancellationIntent{Source: model.TaskCancellationParentFailed})
	if err != nil {
		t.Fatalf("internal cancel error = %v", err)
	}
	if cancelled.Status != model.TaskStatusCancelled || cancelled.CancellationSource != model.TaskCancellationParentFailed {
		t.Fatalf("internal cancel = %+v", cancelled)
	}
}

func TestCancelTaskCancelsQueuedTask(t *testing.T) {
	db, err := gorm.Open(sqlite.Open("file:"+newID()+"?mode=memory&cache=shared"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&model.Task{}); err != nil {
		t.Fatal(err)
	}
	task := model.Task{ID: "queued-task", UserID: "user-1", Status: model.TaskStatusQueued, Stage: "等待队列调度"}
	if err := db.Create(&task).Error; err != nil {
		t.Fatal(err)
	}

	svc := &Service{repo: repository.New(db)}
	cancelled, err := svc.CancelTask(context.Background(), task.UserID, task.ID)
	if err != nil {
		t.Fatalf("CancelTask() error = %v", err)
	}
	if cancelled.Status != model.TaskStatusCancelled {
		t.Fatalf("CancelTask() status = %s, want cancelled", cancelled.Status)
	}

	storedTask, err := svc.repo.TaskForUser(task.UserID, task.ID)
	if err != nil {
		t.Fatal(err)
	}
	if storedTask.Status != model.TaskStatusCancelled || storedTask.CompletedAt == nil {
		t.Fatalf("queued task was not cancelled: status=%s completedAt=%v", storedTask.Status, storedTask.CompletedAt)
	}
}

func TestCancelTaskRejectsTaskWithProviderRequestID(t *testing.T) {
	for _, status := range []model.TaskStatus{model.TaskStatusQueued, model.TaskStatusRunning} {
		t.Run(string(status), func(t *testing.T) {
			db, err := gorm.Open(sqlite.Open("file:"+newID()+"?mode=memory&cache=shared"), &gorm.Config{})
			if err != nil {
				t.Fatal(err)
			}
			if err := db.AutoMigrate(&model.Task{}); err != nil {
				t.Fatal(err)
			}
			task := model.Task{
				ID:                "submitted-" + string(status),
				UserID:            "user-1",
				Status:            status,
				ProviderRequestID: "provider-request-1",
			}
			if err := db.Create(&task).Error; err != nil {
				t.Fatal(err)
			}

			svc := &Service{repo: repository.New(db)}
			if _, err := svc.CancelTask(context.Background(), task.UserID, task.ID); err == nil || err.Error() != "第三方请求已提交，任务不可取消" {
				t.Fatalf("CancelTask() error = %v", err)
			}

			stored, err := svc.repo.TaskForUser(task.UserID, task.ID)
			if err != nil {
				t.Fatal(err)
			}
			if stored.Status != status || stored.ProviderRequestID != task.ProviderRequestID {
				t.Fatalf("submitted task changed after cancellation attempt: status=%s providerRequestId=%q", stored.Status, stored.ProviderRequestID)
			}
		})
	}
}
