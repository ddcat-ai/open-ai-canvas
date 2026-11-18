package app

import (
	"testing"
	"yingce/backend/internal/model"
)

func TestDeleteTryOnBatch(t *testing.T) {
	for _, scenario := range []string{"completed", "running", "other-user", "rollback", "canvas-reference", "task-reference"} {
		t.Run(scenario, func(t *testing.T) {
			svc, db, _ := newResourceDeletionTestService(t)
			task := model.Task{ID: "tryon-task", UserID: "user-1", WorkbenchKind: "image", Status: model.TaskStatusSucceeded, InputJSON: `{"metadata":{"source":"workbench","workbench":{"batch":{"id":"tryon_pose_test123","index":0,"count":1}}}}`, ResultJSON: `{}`}
			if scenario == "running" {
				task.Status = model.TaskStatusRunning
			}
			asset := model.Asset{ID: "generated-asset", UserID: "user-1", Kind: "image", PayloadJSON: `{"metadata":{"taskId":"tryon-task"},"data":{"storageKey":"resource:generated-resource"}}`}
			resource := model.Resource{ID: "generated-resource", UserID: "user-1", Provider: "unsupported-test-provider", ObjectKey: "generated.png", Status: model.ResourceStatusReady}
			for _, record := range []any{&task, &asset, &resource, &model.Asset{ID: "input-asset", UserID: "user-1", PayloadJSON: `{}`}} {
				if err := db.Create(record).Error; err != nil {
					t.Fatal(err)
				}
			}
			if scenario == "rollback" {
				if err := db.Exec(`CREATE TRIGGER reject_tryon_delete BEFORE DELETE ON tasks BEGIN SELECT RAISE(ABORT, 'injected failure'); END`).Error; err != nil {
					t.Fatal(err)
				}
			}
			if scenario == "canvas-reference" {
				if err := db.Create(&model.CanvasProject{ID: "using-canvas", UserID: "user-1", PayloadJSON: `{"nodes":[{"data":{"storageKey":"resource:generated-resource"}}]}`}).Error; err != nil {
					t.Fatal(err)
				}
			}
			if scenario == "task-reference" {
				if err := db.Create(&model.Task{ID: "using-task", UserID: "user-1", Status: model.TaskStatusRunning, InputJSON: `{"references":[{"storageKey":"resource:generated-resource"}]}`}).Error; err != nil {
					t.Fatal(err)
				}
			}
			userID := "user-1"
			if scenario == "other-user" {
				userID = "user-2"
			}
			ids, err := svc.DeleteTryOnBatch(userID, "tryon_pose_test123")
			wantError := scenario == "running" || scenario == "rollback" || scenario == "canvas-reference" || scenario == "task-reference"
			if (err != nil) != wantError {
				t.Fatalf("error=%v, expected error=%v", err, wantError)
			}
			want := int64(1)
			if scenario == "completed" {
				want = 0
				if len(ids) != 1 {
					t.Fatalf("deleted assets=%v", ids)
				}
			}
			for _, record := range []any{&model.Task{}, &model.Asset{}, &model.Resource{}} {
				var count int64
				key := "generated-resource"
				switch record.(type) {
				case *model.Task:
					key = "tryon-task"
				case *model.Asset:
					key = "generated-asset"
				}
				if err := db.Model(record).Where("id = ?", key).Count(&count).Error; err != nil || count != want {
					t.Fatalf("%T count=%d want=%d err=%v", record, count, want, err)
				}
			}
			var count int64
			if err := db.Model(&model.Asset{}).Where("id = ?", "input-asset").Count(&count).Error; err != nil || count != 1 {
				t.Fatal("input asset was removed", err)
			}
			if scenario == "completed" {
				if _, err := svc.DeleteTryOnBatch(userID, "tryon_pose_test123"); err != nil {
					t.Fatalf("repeat delete: %v", err)
				}
				tasks, err := svc.repo.TasksWithWorkbenchKind(userID, 100, "", false, "image")
				if err != nil || len(tasks) != 0 {
					t.Fatalf("batch reappeared: %v %v", tasks, err)
				}
			}
		})
	}
}
