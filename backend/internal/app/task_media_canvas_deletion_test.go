package app

import (
	"context"
	"encoding/json"
	"errors"
	"testing"
	"time"

	"gorm.io/gorm"
	"yingce/backend/internal/model"
)

func TestStandaloneCanvasMediaCompletionAfterDeletion(t *testing.T) {
	for _, mode := range []string{"image", "video", "audio"} {
		for _, deletionStage := range []string{"before-materialization", "before-completion"} {
			t.Run(mode+"/"+deletionStage, func(t *testing.T) {
				s, db := newMediaRecoveryTestService(t)
				task := seedMediaTask(t, db, providerConfig{})
				task.Type, task.ProjectID = "canvas_"+mode, "standalone-canvas"
				input, err := json.Marshal(canvasGenerationInput{Mode: mode, Metadata: map[string]any{"nodeId": "output-node"}})
				if err != nil {
					t.Fatal(err)
				}
				task.InputJSON = string(input)
				canvas := model.CanvasProject{ID: task.ProjectID, UserID: task.UserID, PayloadJSON: `{}`}
				resource := model.Resource{ID: "ready-output", UserID: task.UserID, Kind: mode, Status: model.ResourceStatusReady, Provider: "local", ObjectKey: "generated", MimeType: mode + "/test", UploadKey: mediaUploadKey(task.ID, 0)}
				if err := db.Save(task).Error; err != nil {
					t.Fatal(err)
				}
				for _, record := range []any{&canvas, &resource} {
					if err := db.Create(record).Error; err != nil {
						t.Fatal(err)
					}
				}
				checkpoint := &mediaCheckpoint{Mode: mode, StartedAt: time.Now(), Items: []mediaCheckpointItem{{ResourceID: resource.ID}}}
				if err := s.saveMediaCheckpoint(task, checkpoint, "register"); err != nil {
					t.Fatal(err)
				}
				if deletionStage == "before-materialization" {
					if err := s.repo.DeleteCanvasProject(task.UserID, canvas.ID); err != nil {
						t.Fatal(err)
					}
				}
				output, err := s.resumeTaskMedia(context.Background(), task)
				if err != nil {
					t.Fatal(err)
				}
				if deletionStage == "before-completion" {
					if err := s.repo.DeleteCanvasProject(task.UserID, canvas.ID); err != nil {
						t.Fatal(err)
					}
				}
				encoded, err := json.Marshal(output)
				if err != nil {
					t.Fatal(err)
				}
				if err := s.saveTaskCompletionWithinStorageQuota(task, encoded, nil, false); err != nil {
					t.Fatal(err)
				}
				stored, err := s.repo.Task(task.ID)
				if err != nil || stored.ProjectID != "" || task.ProjectID != "" || stored.Status != model.TaskStatusSucceeded {
					t.Fatalf("completion restored stale association: memory=%q stored=%+v err=%v", task.ProjectID, stored, err)
				}
				if err := s.registerRecoveredMediaAssets(*stored); err != nil {
					t.Fatal(err)
				}
				assets, err := s.repo.Assets(task.UserID)
				if err != nil || len(assets) != 1 || assets[0].UserID != task.UserID || assets[0].Kind != mode {
					t.Fatalf("personal library: %+v err=%v", assets, err)
				}
				var payload struct {
					Metadata struct {
						ProjectIDs []string `json:"projectIds"`
					} `json:"metadata"`
				}
				if err := json.Unmarshal([]byte(assets[0].PayloadJSON), &payload); err != nil || len(payload.Metadata.ProjectIDs) != 0 {
					t.Fatalf("personal output retained project metadata: %+v err=%v", payload, err)
				}
				var links int64
				if err := db.Model(&model.ProjectAssetLink{}).Count(&links).Error; err != nil || links != 0 {
					t.Fatalf("unexpected project asset links: %d err=%v", links, err)
				}
				if _, err := s.repo.CanvasProjectForUser(task.UserID, canvas.ID); !errors.Is(err, gorm.ErrRecordNotFound) {
					t.Fatalf("deleted canvas resurrected: %v", err)
				}
			})
		}
	}
}

func TestStandaloneCanvasManualMediaRecoveryKeepsOriginalTask(t *testing.T) {
	s, db := newMediaRecoveryTestService(t)
	task := seedMediaTask(t, db, providerConfig{})
	task.ProjectID = "deleted-standalone-canvas"
	task.InputJSON = `{"mode":"image","metadata":{"nodeId":"output-node"}}`
	if err := db.Save(task).Error; err != nil {
		t.Fatal(err)
	}
	resource := model.Resource{ID: "ready-output", UserID: task.UserID, Kind: "image", Status: model.ResourceStatusReady, Provider: "local", ObjectKey: "generated", MimeType: "image/png", UploadKey: mediaUploadKey(task.ID, 0)}
	if err := db.Create(&resource).Error; err != nil {
		t.Fatal(err)
	}
	checkpoint := &mediaCheckpoint{Mode: "image", StartedAt: time.Now(), Items: []mediaCheckpointItem{{ResourceID: resource.ID}}}
	if err := s.saveMediaCheckpoint(task, checkpoint, "register"); err != nil {
		t.Fatal(err)
	}
	if err := db.Model(task).Updates(map[string]any{"status": model.TaskStatusFailed, "lease_owner": "", "lease_expires_at": nil}).Error; err != nil {
		t.Fatal(err)
	}
	if _, err := s.RecoverTaskMedia("other-user", task.ID); err == nil {
		t.Fatal("another user recovered the task")
	}
	queued, err := s.RecoverTaskMedia(task.UserID, task.ID)
	if err != nil || queued.ID != task.ID || queued.Status != model.TaskStatusQueued {
		t.Fatalf("manual recovery: %+v err=%v", queued, err)
	}
	claimed, err := s.repo.ClaimNextTask("recovery-worker", time.Minute)
	if err != nil || claimed == nil {
		t.Fatalf("claim: %+v err=%v", claimed, err)
	}
	if err := s.taskWorker().processClaimedTask(claimed, nil); err != nil {
		t.Fatal(err)
	}
	stored, err := s.repo.Task(task.ID)
	if err != nil || stored.Status != model.TaskStatusSucceeded || stored.UserID != task.UserID {
		t.Fatalf("recovery completion: %+v err=%v", stored, err)
	}
	assets, err := s.repo.Assets(task.UserID)
	if err != nil || len(assets) != 1 {
		t.Fatalf("personal library: %+v err=%v", assets, err)
	}
	var orders int64
	if err := db.Model(&model.BillingOrder{}).Count(&orders).Error; err != nil || orders != 0 {
		t.Fatalf("recovery created a billing order: %d err=%v", orders, err)
	}
}

func TestMediaTaskProjectKeepsDomainGuards(t *testing.T) {
	s, db := newMediaRecoveryTestService(t)
	for _, record := range []any{
		&model.Project{ID: "active-project", UserID: "media-user", Name: "active", Status: model.ProjectStatusActive},
		&model.Project{ID: "archived-project", UserID: "media-user", Name: "archived", Status: model.ProjectStatusArchived},
		&model.CanvasProject{ID: "archived-canvas", UserID: "media-user", ProjectID: "archived-project"},
		&model.CanvasProject{ID: "orphaned-domain-canvas", UserID: "media-user", ProjectID: "deleted-project"},
	} {
		if err := db.Create(record).Error; err != nil {
			t.Fatal(err)
		}
	}
	for _, tc := range []struct {
		name, taskType, projectID, input, wantProject string
		wantError                                     bool
	}{
		{"active-project", "canvas_image", "active-project", `{"metadata":{"nodeId":"node"}}`, "active-project", false},
		{"archived-project", "canvas_image", "archived-project", `{"metadata":{"nodeId":"node"}}`, "", true},
		{"archived-canvas", "canvas_image", "archived-canvas", `{"metadata":{"nodeId":"node"}}`, "", true},
		{"orphaned-domain-canvas", "canvas_image", "orphaned-domain-canvas", `{"metadata":{"nodeId":"node"}}`, "", true},
		{"deleted-domain-project", "canvas_image", "deleted-project", `{"domainProjectId":"deleted-project","metadata":{"nodeId":"node"}}`, "", true},
		{"deleted-metadata-project", "canvas_image", "deleted-project", `{"metadata":{"nodeId":"node","domainProjectId":"deleted-project"}}`, "", true},
		{"detached-deleted-domain-project", "canvas_image", "", `{"domainProjectId":"deleted-project","metadata":{"nodeId":"node"}}`, "", true},
		{"detached-archived-domain-project", "canvas_image", "", `{"metadata":{"nodeId":"node","domainProjectId":"archived-project"}}`, "", true},
		{"workflow", "canvas_video", "missing", `{"workflowStepId":"step","metadata":{"nodeId":"node"}}`, "", true},
		{"metadata-workflow", "canvas_audio", "missing", `{"metadata":{"nodeId":"node","workflowStepId":"step"}}`, "", true},
		{"missing-node", "canvas_image", "missing", `{}`, "", true},
		{"blank-node", "canvas_image", "missing", `{"metadata":{"nodeId":" "}}`, "", true},
		{"invalid-input", "canvas_image", "missing", `invalid`, "", true},
		{"non-media", "canvas_text", "missing", `{"metadata":{"nodeId":"node"}}`, "", true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			projectID, err := s.mediaTaskProject(&model.Task{UserID: "media-user", Type: tc.taskType, ProjectID: tc.projectID, InputJSON: tc.input})
			if (err != nil) != tc.wantError || projectID != tc.wantProject {
				t.Fatalf("project=%q err=%v", projectID, err)
			}
		})
	}
}
