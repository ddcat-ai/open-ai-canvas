package app

import (
	"errors"
	"testing"

	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"
)

// 派发期间作业被取消：任务与作业绑定在同一事务里，绑定落空时任务一起回滚，不留下无人认领的任务。
func TestPersistDramaTaskRollsBackWhenJobChanged(t *testing.T) {
	svc, fake := newDramaTestService(t)
	project := createTestDrama(t, svc, DramaReviewAuto).Project.ID
	job := model.DramaJob{ID: newID(), ProjectID: project, Status: model.DramaJobQueued, Kind: model.DramaJobBible, Label: "作品圣经"}
	if err := fake.db.Create(&job).Error; err != nil {
		t.Fatal(err)
	}
	stale := job
	if err := fake.db.Model(&model.DramaJob{}).Where("id = ?", job.ID).Update("status", model.DramaJobCanceled).Error; err != nil {
		t.Fatal(err)
	}
	orphan := &model.Task{ID: newID(), UserID: "usr-drama", ProjectID: project, Type: "canvas_text", Status: model.TaskStatusQueued, InputJSON: "{}"}
	if _, err := svc.persistDramaTask(&stale, orphan, nil); !errors.Is(err, repository.ErrDramaJobChanged) {
		t.Fatalf("persist on canceled job = %v", err)
	}
	var count int64
	if err := fake.db.Model(&model.Task{}).Where("id = ?", orphan.ID).Count(&count).Error; err != nil || count != 0 {
		t.Fatalf("task must roll back with the failed binding: count=%d err=%v", count, err)
	}
	var stored model.DramaJob
	if err := fake.db.First(&stored, "id = ?", job.ID).Error; err != nil || stored.Status != model.DramaJobCanceled || stored.TaskID != "" {
		t.Fatalf("canceled job overwritten: %+v %v", stored, err)
	}

	if err := fake.db.Model(&model.DramaJob{}).Where("id = ?", job.ID).Update("status", model.DramaJobQueued).Error; err != nil {
		t.Fatal(err)
	}
	fresh := job
	task := &model.Task{ID: newID(), UserID: "usr-drama", ProjectID: project, Type: "canvas_text", Status: model.TaskStatusQueued, InputJSON: "{}"}
	if _, err := svc.persistDramaTask(&fresh, task, nil); err != nil {
		t.Fatal(err)
	}
	if err := fake.db.First(&stored, "id = ?", job.ID).Error; err != nil {
		t.Fatal(err)
	}
	if stored.Status != model.DramaJobRunning || stored.TaskID != task.ID || stored.StartedAt == nil || fresh.TaskID != task.ID {
		t.Fatalf("binding not stored: %+v", stored)
	}
	startedAt := *stored.StartedAt

	// 精简续任务：作业已在运行，换绑新任务时保留原开始时间。
	next := &model.Task{ID: newID(), UserID: "usr-drama", ProjectID: project, Type: "canvas_text", Status: model.TaskStatusQueued, InputJSON: "{}"}
	if _, err := svc.persistDramaTask(&fresh, next, nil); err != nil {
		t.Fatal(err)
	}
	if err := fake.db.First(&stored, "id = ?", job.ID).Error; err != nil {
		t.Fatal(err)
	}
	if stored.TaskID != next.ID || stored.StartedAt == nil || !stored.StartedAt.Equal(startedAt) {
		t.Fatalf("continuation must keep start time: %+v want %v", stored, startedAt)
	}
}

// 结算记录按 attempts_json 乐观锁写入：旧行的 NULL 也能匹配；已被改动的作业返回冲突，不改作品花费缓存。
func TestRecordDramaJobCostUsesOptimisticAttempts(t *testing.T) {
	svc, fake := newDramaTestService(t)
	project := createTestDrama(t, svc, DramaReviewAuto).Project.ID
	job := model.DramaJob{ID: newID(), ProjectID: project, Status: model.DramaJobRunning, Kind: model.DramaJobBible, TaskID: "task-a", Label: "作品圣经"}
	if err := fake.db.Create(&job).Error; err != nil {
		t.Fatal(err)
	}
	if err := fake.db.Exec("UPDATE drama_jobs SET attempts_json = NULL WHERE id = ?", job.ID).Error; err != nil {
		t.Fatal(err)
	}
	before := mustDramaProduction(t, svc, project).SpentMicrocredits
	recordDramaAttempt(&job, "task-a", string(model.TaskStatusSucceeded), "", 40)
	job.CostMicrocredits = 40
	if err := svc.repo.RecordDramaJobCost(&job, ""); err != nil {
		t.Fatalf("legacy NULL attempts must match: %v", err)
	}
	var stored model.DramaJob
	if err := fake.db.First(&stored, "id = ?", job.ID).Error; err != nil || stored.CostMicrocredits != 40 || !dramaAttemptRecorded(&stored, "task-a") {
		t.Fatalf("attempt not stored: %+v %v", stored, err)
	}
	if err := svc.repo.RecordDramaJobCost(&job, ""); !errors.Is(err, repository.ErrDramaJobChanged) {
		t.Fatalf("stale attempts must conflict: %v", err)
	}
	if after := mustDramaProduction(t, svc, project).SpentMicrocredits; after != before {
		t.Fatalf("job cost must not touch the production spend cache: %d -> %d", before, after)
	}
}
