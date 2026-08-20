package repository

import (
	"testing"
	"time"

	"infinite-canvas/backend/internal/model"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

// 验证 text-replay 闭环：text_replay 任务可写增量，完成后置为 succeeded 并写入最终正文。
func TestTextReplayLifecycle(t *testing.T) {
	db, err := gorm.Open(sqlite.Open("file:text-replay-lifecycle?mode=memory&cache=shared"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&model.Task{}, &model.TaskTextDelta{}); err != nil {
		t.Fatal(err)
	}
	task := model.Task{
		ID: "replay-1", UserID: "user-1", Type: "text", Prompt: "写一段剧本",
		Status: model.TaskStatusTextReplay, Stage: "文本持久化（前端自管）",
	}
	if err := db.Create(&task).Error; err != nil {
		t.Fatal(err)
	}

	repo := New(db)
	now := time.Now()
	limits := TextReplayLimits{MaxTaskBytes: 1 << 20, MaxUserBytes: 1 << 20, MaxTaskEvents: 100}

	// text_replay 状态应允许写入增量（未结束）
	if _, err := repo.AppendTaskTextDelta("user-1", "replay-1", "第一段内容", now.Add(time.Hour), limits); err != nil {
		t.Fatalf("text_replay 任务写入增量失败: %v", err)
	}
	if _, err := repo.AppendTaskTextDelta("user-1", "replay-1", "第二段内容", now.Add(time.Hour), limits); err != nil {
		t.Fatalf("text_replay 任务写入增量失败: %v", err)
	}

	// 完成：写入最终正文并置为 succeeded
	resultJSON := `{"mode":"text","text":"第一段内容第二段内容"}`
	completed, err := repo.CompleteTextReplayTask("user-1", "replay-1", resultJSON, now)
	if err != nil {
		t.Fatal(err)
	}
	if !completed {
		t.Fatal("expected complete to succeed")
	}
	stored, err := repo.Task("replay-1")
	if err != nil {
		t.Fatal(err)
	}
	if stored.Status != model.TaskStatusSucceeded {
		t.Fatalf("expected status succeeded, got %s", stored.Status)
	}
	if stored.ResultJSON != resultJSON {
		t.Fatalf("unexpected result_json: %s", stored.ResultJSON)
	}
	if stored.CompletedAt == nil {
		t.Fatal("expected completed_at set")
	}

	// 已完成的 text_replay 任务不能再写入增量（进入 closed）
	if _, err := repo.AppendTaskTextDelta("user-1", "replay-1", "追加", now.Add(time.Hour), limits); err == nil {
		t.Fatal("expected ErrTextReplayClosed after completion")
	}

	// 重复完成应返回 completed=false（状态已不是 text_replay）
	again, err := repo.CompleteTextReplayTask("user-1", "replay-1", resultJSON, now.Add(time.Minute))
	if err != nil {
		t.Fatal(err)
	}
	if again {
		t.Fatal("expected second complete to be a no-op")
	}

	// 非 text_replay 任务不能完成
	other := model.Task{ID: "queued-1", UserID: "user-1", Type: "text", Status: model.TaskStatusQueued}
	if err := db.Create(&other).Error; err != nil {
		t.Fatal(err)
	}
	done, err := repo.CompleteTextReplayTask("user-1", "queued-1", resultJSON, now)
	if err != nil {
		t.Fatal(err)
	}
	if done {
		t.Fatal("queued task must not be completable as text_replay")
	}
}
