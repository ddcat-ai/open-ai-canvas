package app

import (
	"context"
	"errors"
	"strings"
	"testing"

	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"

	"gorm.io/gorm"
)

func TestWaitCloudAgentTaskReadsOnlyStatusUntilTerminal(t *testing.T) {
	for _, terminal := range []model.TaskStatus{model.TaskStatusSucceeded, model.TaskStatusFailed, model.TaskStatusCancelled} {
		t.Run(string(terminal), func(t *testing.T) {
			db := newSQLiteTestDB(t)
			if err := db.AutoMigrate(&model.Task{}); err != nil {
				t.Fatal(err)
			}
			task := model.Task{ID: "waiting", Status: model.TaskStatusRunning, InputJSON: strings.Repeat("x", 1<<20), TextDraft: strings.Repeat("y", 1<<20), ResultJSON: `{"text":"finished"}`, Error: "generation failed"}
			if err := db.Create(&task).Error; err != nil {
				t.Fatal(err)
			}
			statusReads, fullReads := 0, 0
			if err := db.Callback().Query().After("gorm:query").Register("test:wait_projection", func(tx *gorm.DB) {
				if tx.Statement.Table != "tasks" {
					return
				}
				if len(tx.Statement.Selects) == 1 && tx.Statement.Selects[0] == "status" {
					statusReads++
					row := tx.Statement.Dest.(*model.Task)
					if row.InputJSON != "" || row.TextDraft != "" || row.ResultJSON != "" {
						t.Error("status query loaded payload columns")
					}
					if statusReads == 3 {
						if err := db.Model(&model.Task{}).Where("id = ?", task.ID).Update("status", terminal).Error; err != nil {
							t.Error(err)
						}
					}
				} else {
					fullReads++
					if statusReads < 4 {
						t.Error("loaded full task before terminal status")
					}
				}
			}); err != nil {
				t.Fatal(err)
			}
			result, err := (&Service{repo: repository.New(db)}).waitCloudAgentTask(t.Context(), task.ID)
			if terminal == model.TaskStatusSucceeded {
				if err != nil || result == nil || result.ResultJSON != task.ResultJSON || result.InputJSON != task.InputJSON {
					t.Fatalf("terminal result missing payload: err=%v", err)
				}
			} else if err == nil || result != nil || err.Error() != BadAuthRequest(userFacingTaskFailure(&model.Task{Status: terminal, Error: task.Error})).Error() {
				t.Fatalf("failure result=%v err=%v", result, err)
			}
			if statusReads != 4 || fullReads != 1 {
				t.Fatalf("status reads=%d full reads=%d", statusReads, fullReads)
			}
		})
	}
}

func TestWaitCloudAgentTaskCancelledBeforeQuery(t *testing.T) {
	ctx, cancel := context.WithCancel(t.Context())
	cancel()
	db := newSQLiteTestDB(t)
	queries := 0
	if err := db.Callback().Query().Before("gorm:query").Register("test:cancelled_wait", func(*gorm.DB) { queries++ }); err != nil {
		t.Fatal(err)
	}
	_, err := (&Service{repo: repository.New(db)}).waitCloudAgentTask(ctx, "waiting")
	if !errors.Is(err, context.Canceled) || queries != 0 {
		t.Fatalf("error=%v queries=%d", err, queries)
	}
}

func TestWaitCloudAgentTaskRechecksTerminalAfterRetry(t *testing.T) {
	db := newSQLiteTestDB(t)
	if err := db.AutoMigrate(&model.Task{}); err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&model.Task{ID: "retry", Status: model.TaskStatusFailed}).Error; err != nil {
		t.Fatal(err)
	}
	reads := 0
	if err := db.Callback().Query().After("gorm:query").Register("test:retry_between_reads", func(tx *gorm.DB) {
		reads++
		var next model.TaskStatus
		if reads == 1 {
			next = model.TaskStatusRunning
		} else if reads == 3 {
			next = model.TaskStatusSucceeded
		} else {
			return
		}
		if err := db.Model(&model.Task{}).Where("id = ?", "retry").Update("status", next).Error; err != nil {
			t.Error(err)
		}
	}); err != nil {
		t.Fatal(err)
	}
	result, err := (&Service{repo: repository.New(db)}).waitCloudAgentTask(t.Context(), "retry")
	if err != nil || result == nil || result.Status != model.TaskStatusSucceeded {
		t.Fatalf("result=%+v err=%v", result, err)
	}
}
