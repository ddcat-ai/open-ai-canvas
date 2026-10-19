package repository

import (
	"testing"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"yingce/backend/internal/model"
)

func TestTaskCompletionPreservesLatestProjectAssociation(t *testing.T) {
	for _, projectID := range []string{"", "current-project"} {
		t.Run("project="+projectID, func(t *testing.T) {
			db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
			if err != nil {
				t.Fatal(err)
			}
			sqlDB, err := db.DB()
			if err != nil {
				t.Fatal(err)
			}
			defer sqlDB.Close()
			if err := db.AutoMigrate(&model.Task{}, &model.Result{}); err != nil {
				t.Fatal(err)
			}
			task := &model.Task{ID: "task", UserID: "user", ProjectID: "old-canvas", Status: model.TaskStatusRunning}
			if err := db.Create(task).Error; err != nil {
				t.Fatal(err)
			}
			if err := db.Model(&model.Task{}).Where("id = ?", task.ID).Update("project_id", projectID).Error; err != nil {
				t.Fatal(err)
			}
			task.Status = model.TaskStatusSucceeded
			registered := false
			err = New(db).SaveTaskCompletionWithRegistration(task, model.TaskStatusRunning, nil, func(repo *Repository) error {
				registered = true
				current, err := repo.Task(task.ID)
				if err != nil {
					return err
				}
				if task.ProjectID != projectID || current.ProjectID != projectID {
					t.Errorf("registration used stale project: memory=%q stored=%q want=%q", task.ProjectID, current.ProjectID, projectID)
				}
				return nil
			})
			if err != nil || !registered {
				t.Fatalf("completion: registered=%v err=%v", registered, err)
			}
			current, err := New(db).Task(task.ID)
			if err != nil || current.ProjectID != projectID || current.Status != model.TaskStatusSucceeded {
				t.Fatalf("stored completion: %+v err=%v", current, err)
			}
		})
	}
}
