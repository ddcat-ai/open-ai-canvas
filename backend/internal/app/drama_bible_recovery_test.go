package app

import (
	"encoding/json"
	"testing"

	"yingce/backend/internal/model"
)

func TestDramaBibleRecoveryReusesOriginalTaskOnRetry(t *testing.T) {
	svc, fake := newDramaTestService(t)
	summary := createTestDramaWithMedia(t, svc, DramaReviewAuto, DramaMediaManual)
	projectID := summary.Project.ID
	raw, err := json.Marshal(map[string]string{"mode": "text", "text": `{"characters":[{"name":"甲","appearance":"白衣","looks":[]}],"name":"乙","appearance":"红衣","looks":[]}],"props":[],"scenes":[]}`})
	if err != nil {
		t.Fatal(err)
	}
	task := model.Task{ID: newID(), UserID: "usr-drama", ProjectID: projectID, Type: "canvas_text", Status: model.TaskStatusSucceeded, ResultJSON: string(raw)}
	job := model.DramaJob{ID: newID(), ProjectID: projectID, Kind: model.DramaJobBible, Status: model.DramaJobFailed, TaskID: task.ID, Error: "作品圣经解析失败"}
	if err := fake.db.Create(&task).Error; err != nil {
		t.Fatal(err)
	}
	if err := fake.db.Create(&job).Error; err != nil {
		t.Fatal(err)
	}
	if err := svc.repo.UpdateDramaProduction(projectID, map[string]any{"status": model.DramaStatusPaused, "pause_reason": job.Error}); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.RetryFailedDrama("someone", projectID); err == nil {
		t.Fatal("retry must still enforce project ownership")
	}
	if _, err := svc.RetryFailedDrama("usr-drama", projectID); err != nil {
		t.Fatal(err)
	}
	runDramaTicks(t, svc, projectID, 1)
	var saved model.DramaJob
	if err := fake.db.First(&saved, "id = ?", job.ID).Error; err != nil {
		t.Fatal(err)
	}
	if saved.Status != model.DramaJobSucceeded || saved.TaskID != task.ID || fake.byKind["bible"] != 0 {
		t.Fatalf("retry must re-apply the paid result without generating another bible: %+v %v", saved, fake.byKind)
	}
	storedTask, err := svc.repo.Task(task.ID)
	if err != nil || storedTask.ResultJSON != string(raw) {
		t.Fatalf("original task result must remain intact: %v", err)
	}
	casts, err := svc.repo.DramaCasts(projectID)
	if err != nil || len(casts) != 2 || casts[0].Name != "甲" || casts[1].Name != "乙" {
		t.Fatalf("all recovered characters must be persisted: %+v %v", casts, err)
	}
}
