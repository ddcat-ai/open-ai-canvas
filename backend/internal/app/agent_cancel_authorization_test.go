package app

import (
	"context"
	"errors"
	"reflect"
	"testing"

	"yingce/backend/internal/database"
	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func TestCancelCloudAgentAuthorizesBeforeStoppingPiRunner(t *testing.T) {
	for _, damaged := range []bool{false, true} {
		name := "valid_runtime"
		if damaged {
			name = "damaged_runtime"
		}
		t.Run(name, func(t *testing.T) {
			s, db, root := cancelAuthorizationFixture(t)
			if damaged {
				if err := db.Model(&model.CloudAgentExecution{}).Where("id = ?", root.ID).Update("state_json", "broken").Error; err != nil {
					t.Fatal(err)
				}
			}
			before, err := s.repo.CloudAgent("user", root.ID)
			if err != nil {
				t.Fatal(err)
			}
			if _, decodeErr := cloudAgentDecode(before); (decodeErr != nil) != damaged {
				t.Fatalf("runtime fixture damaged=%v, decode error=%v", damaged, decodeErr)
			}
			taskBefore, err := s.repo.TaskForUser("user", root.ID)
			if err != nil {
				t.Fatal(err)
			}
			// Fake the coordinator's runner cancellation boundary; no Node or model calls.
			cancelCalls := 0
			s.piRunners = map[string]context.CancelFunc{root.ID: func() { cancelCalls++ }}
			err = s.CancelCloudAgent(context.Background(), "other-user", root.ID)
			var appErr *AppError
			if !errors.As(err, &appErr) || appErr.Status != 404 {
				t.Fatalf("foreign cancel error = %v, want NotFound", err)
			}
			if cancelCalls != 0 {
				t.Fatalf("unauthorized cancel reached Pi runner: calls=%d", cancelCalls)
			}
			after, err := s.repo.CloudAgent("user", root.ID)
			if err != nil {
				t.Fatal(err)
			}
			taskAfter, err := s.repo.TaskForUser("user", root.ID)
			if err != nil {
				t.Fatal(err)
			}
			if !reflect.DeepEqual(before, after) || !reflect.DeepEqual(taskBefore, taskAfter) {
				t.Fatal("foreign cancel changed the owner's execution or task")
			}
			if err := s.CancelCloudAgent(context.Background(), "user", root.ID); err != nil {
				t.Fatalf("owner cancel: %v", err)
			}
			if cancelCalls != 1 {
				t.Fatalf("owner cancel calls=%d, want 1", cancelCalls)
			}
			after, err = s.repo.CloudAgent("user", root.ID)
			if err != nil {
				t.Fatal(err)
			}
			if after.Status != "cancelled" || after.CleanupPending {
				t.Fatalf("owner cancellation incomplete: status=%s pending=%v", after.Status, after.CleanupPending)
			}
			taskAfter, err = s.repo.TaskForUser("user", root.ID)
			if err != nil || taskAfter.Status != model.TaskStatusCancelled {
				t.Fatalf("owner task cancellation incomplete: task=%v err=%v", taskAfter, err)
			}
		})
	}
}

func cancelAuthorizationFixture(t *testing.T) (*Service, *gorm.DB, *model.Task) {
	t.Helper()
	db, err := gorm.Open(sqlite.Open("file:"+newID()+"?mode=memory&cache=shared"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	sqlDB, err := db.DB()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = sqlDB.Close() })
	if err := db.AutoMigrate(database.Models()...); err != nil {
		t.Fatal(err)
	}
	req := agentTestRequest()
	profile := cloudAgentProfileSnapshot{Revision: agentProfileRevision(nil), Hash: agentProfileHash("")}
	_, policy, err := compileCloudAgentPolicies(req, defaultCanvasAppearance().AgentName, nil, "", profile)
	if err != nil {
		t.Fatal(err)
	}
	root := &model.Task{ID: cloudAgentID("user", req.IdempotencyKey), UserID: "user", Operation: cloudAgentOperation, Status: model.TaskStatusQueued}
	state := cloudAgentRuntime{Request: req, Policy: policy, Profile: profile, TaskIDs: []string{root.ID}, Decisions: map[string]string{}, Events: []CloudAgentEvent{}}
	run := &model.CloudAgentExecution{ID: root.ID, UserID: root.UserID, Status: "running", Revision: 1}
	if err := cloudAgentSave(run, &state); err != nil {
		t.Fatal(err)
	}
	for _, row := range []any{root, run} {
		if err := db.Create(row).Error; err != nil {
			t.Fatal(err)
		}
	}
	return &Service{repo: repository.New(db)}, db, root
}

func TestTaskCancelAndRetryRejectForeignInput(t *testing.T) {
	for _, action := range []string{"cancel", "retry"} {
		t.Run(action, func(t *testing.T) {
			db, err := gorm.Open(sqlite.Open("file:"+newID()+"?mode=memory&cache=shared"), &gorm.Config{})
			if err != nil {
				t.Fatal(err)
			}
			sqlDB, err := db.DB()
			if err != nil {
				t.Fatal(err)
			}
			t.Cleanup(func() { _ = sqlDB.Close() })
			if err := db.AutoMigrate(&model.Task{}); err != nil {
				t.Fatal(err)
			}
			task := model.Task{ID: "private-task", UserID: "owner", Status: model.TaskStatusQueued, InputJSON: `{"prompt":"owner-private-input"}`}
			if action == "retry" {
				task.Status = model.TaskStatusFailed
			}
			if err := db.Create(&task).Error; err != nil {
				t.Fatal(err)
			}
			s := &Service{repo: repository.New(db)}
			// Observe actual rows returned by the database, not merely the final error.
			// An unscoped read followed by an ownership check must also fail this test.
			rowsRead := int64(0)
			if err := db.Callback().Query().After("gorm:query").Register("test:task_input_reads", func(tx *gorm.DB) {
				if tx.Statement.Table == "tasks" && tx.RowsAffected > 0 {
					rowsRead += tx.RowsAffected
				}
			}); err != nil {
				t.Fatal(err)
			}
			before, err := s.repo.TaskForUser("owner", task.ID)
			if err != nil || rowsRead != 1 || before.InputJSON != task.InputJSON {
				t.Fatalf("input read observer calibration failed: rows=%d err=%v", rowsRead, err)
			}
			rowsRead = 0
			var result *model.Task
			if action == "cancel" {
				result, err = s.CancelTask(context.Background(), "other-user", task.ID)
			} else {
				result, err = s.RetryTask("other-user", task.ID)
			}
			if !errors.Is(err, gorm.ErrRecordNotFound) || result != nil {
				t.Fatalf("foreign %s returned task=%v err=%v, want record not found", action, result, err)
			}
			if rowsRead != 0 {
				t.Fatalf("foreign %s read another user's task input: rows=%d", action, rowsRead)
			}
			after, err := s.repo.TaskForUser("owner", task.ID)
			if err != nil || !reflect.DeepEqual(before, after) {
				t.Fatalf("foreign %s changed stored task: err=%v", action, err)
			}
		})
	}
}
