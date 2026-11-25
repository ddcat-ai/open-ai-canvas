package app

import (
	"fmt"
	"testing"
	"time"

	"yingce/backend/internal/model"
)

func TestDressingTaskRecoveryFiltersBeforePagination(t *testing.T) {
	svc, db, _, _ := creationTestService(t)
	now := time.Now()
	for i := 0; i < 65; i++ {
		owner, character := "user", "other"
		if i < 3 {
			character = "person"
		}
		if i == 0 {
			owner = "foreign"
		}
		task := model.Task{ID: fmt.Sprintf("task-%02d", i), UserID: owner, Type: "canvas_image", Status: model.TaskStatusSucceeded, InputJSON: fmt.Sprintf(`{"metadata":{"source":"character-dressing-table","dressing":{"characterAssetId":%q}}}`, character), CreatedAt: now.Add(time.Duration(i) * time.Minute)}
		if err := db.Create(&task).Error; err != nil {
			t.Fatal(err)
		}
	}
	page, err := svc.TasksWithOptions("user", TaskListOptions{Limit: 1, CharacterAssetID: "person"})
	if err != nil || len(page) != 1 || page[0].ID != "task-02" {
		t.Fatalf("first page = %#v, %v", page, err)
	}
	page, err = svc.TasksWithOptions("user", TaskListOptions{Limit: 1, CharacterAssetID: "person", BeforeTaskID: "task-02"})
	if err != nil || len(page) != 1 || page[0].ID != "task-01" {
		t.Fatalf("older page = %#v, %v", page, err)
	}
}
