package app

import (
	"encoding/json"
	"errors"
	"strings"
	"testing"
	"time"

	canvasdomain "yingce/backend/internal/canvas"
	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"

	"gorm.io/gorm"
)

func TestConfirmChapterVisualAssetsKeepImageDefinitions(t *testing.T) {
	for _, category := range []model.AssetCategory{model.AssetCategoryEnvironment, model.AssetCategoryProp} {
		t.Run(string(category), func(t *testing.T) {
			svc, db := newProjectWorkflowV2TestService(t)
			project, unit := seedWorkflowProject(t, db)
			candidates, err := svc.CreateProjectAssetCandidates("user-1", project.ID, CreateAssetCandidatesRequest{
				Source: assetCandidateSourceChapterCharacter,
				Candidates: []AssetCandidateInput{{UnitID: unit.ID, Name: "藏书阁", Category: string(category),
					Details: map[string]any{"description": "木质书架与旧书", "prompt": "古风藏书阁，柔和光线"}}},
			})
			if err != nil || len(candidates) != 1 {
				t.Fatalf("candidates: %v, %v", candidates, err)
			}
			summary, err := svc.ConfirmProjectAssetCandidate("user-1", project.ID, candidates[0].ID, ConfirmProjectAssetCandidateRequest{})
			if err != nil {
				t.Fatal(err)
			}
			if summary.MediaType != "entity" {
				t.Fatalf("expected image definition entity, got %s", summary.MediaType)
			}
			var asset model.Asset
			if err := db.First(&asset, "id = ?", summary.ID).Error; err != nil {
				t.Fatal(err)
			}
			var payload struct {
				Data struct {
					Definition map[string]any `json:"definition"`
				} `json:"data"`
			}
			if err := json.Unmarshal([]byte(asset.PayloadJSON), &payload); err != nil {
				t.Fatal(err)
			}
			if payload.Data.Definition["prompt"] != "古风藏书阁，柔和光线" {
				t.Fatalf("definition lost: %s", asset.PayloadJSON)
			}
			// 未出图不得假装存在可引用的图片资源。
			if summary.StorageKey != "" {
				t.Fatalf("unexpected image locator: %s", summary.StorageKey)
			}
		})
	}
}

func TestProjectAssetImageReplacementKeepsExistingCanvasReferences(t *testing.T) {
	svc, db, projectID, asset := seedProjectVisualAsset(t, model.AssetCategoryEnvironment)
	first, err := svc.BindProjectAssetImage("user-1", projectID, asset.ID, BindProjectAssetImageRequest{ResourceID: "image-1", ExpectedVersionID: asset.PrimaryVersionID})
	if err != nil {
		t.Fatal(err)
	}
	raw := json.RawMessage(`{"nodes":[{"id":"scene-node","type":"image","metadata":{"assetId":"` + asset.ID + `","storageKey":"resource:image-1"}}]}`)
	if err := db.Create(&model.CanvasProject{ID: "existing-canvas", UserID: "user-1", PayloadJSON: string(raw)}).Error; err != nil {
		t.Fatal(err)
	}
	image2 := model.Resource{ID: "image-2", UserID: "user-1", Kind: "image", Status: model.ResourceStatusReady, Width: 800, Height: 600, MimeType: "image/png"}
	if err := db.Create(&image2).Error; err != nil {
		t.Fatal(err)
	}
	_, err = svc.BindProjectAssetImage("user-1", projectID, asset.ID, BindProjectAssetImageRequest{ResourceID: image2.ID, ExpectedVersionID: first.PrimaryVersionID})
	if err != nil {
		t.Fatal(err)
	}
	guard := canvasdomain.New(svc.repo, nil)
	if err := guard.ValidateCanvasMediaAssets("user-1", raw); err != nil {
		t.Fatalf("existing canvas became unsavable: %v", err)
	}
	latest, err := svc.repo.AssetForUser("user-1", asset.ID)
	if err != nil {
		t.Fatal(err)
	}
	if err := guard.ValidateAssetCanvasReferences("user-1", *latest); err != nil {
		t.Fatalf("saving refreshed asset failed: %v", err)
	}
	if err := guard.ValidateAssetReplacementCanvasReferences("user-1", []model.Asset{*latest}); err != nil {
		t.Fatalf("saving snapshot failed: %v", err)
	}
	forged := json.RawMessage(`{"nodes":[{"id":"forged","type":"image","metadata":{"assetId":"` + asset.ID + `","storageKey":"resource:foreign-image"}}]}`)
	if err := guard.ValidateCanvasMediaAssets("user-1", forged); err == nil {
		t.Fatal("unowned historical image accepted")
	}
}

func seedProjectVisualAsset(t *testing.T, category model.AssetCategory) (*Service, *gorm.DB, string, ProjectAssetSummary) {
	t.Helper()
	svc, db := newProjectWorkflowV2TestService(t)
	project, unit := seedWorkflowProject(t, db)
	candidates, err := svc.CreateProjectAssetCandidates("user-1", project.ID, CreateAssetCandidatesRequest{
		Source:     assetCandidateSourceChapterCharacter,
		Candidates: []AssetCandidateInput{{UnitID: unit.ID, Name: "铜印", Category: string(category), Details: map[string]any{"description": "磨损铜印", "prompt": "古代铜印特写"}}},
	})
	if err != nil || len(candidates) != 1 {
		t.Fatalf("candidates: %v %v", candidates, err)
	}
	asset, err := svc.ConfirmProjectAssetCandidate("user-1", project.ID, candidates[0].ID, ConfirmProjectAssetCandidateRequest{})
	if err != nil {
		t.Fatal(err)
	}
	now := time.Now()
	for _, resource := range []model.Resource{
		{ID: "image-1", UserID: "user-1", Kind: "image", Status: model.ResourceStatusReady, Width: 800, Height: 600, Size: 100, MimeType: "image/png", CreatedAt: now, UpdatedAt: now},
		{ID: "foreign-image", UserID: "user-2", Kind: "image", Status: model.ResourceStatusReady, Width: 800, Height: 600, MimeType: "image/png"},
		{ID: "video-1", UserID: "user-1", Kind: "video", Status: model.ResourceStatusReady},
		{ID: "pending-image", UserID: "user-1", Kind: "image", Status: model.ResourceStatusPending},
		{ID: "missing-dimensions", UserID: "user-1", Kind: "image", Status: model.ResourceStatusReady, MimeType: "image/png"},
	} {
		if err := db.Create(&resource).Error; err != nil {
			t.Fatal(err)
		}
	}
	return svc, db, project.ID, asset
}

func TestBindProjectAssetImagePreservesIdentityAndVersions(t *testing.T) {
	svc, _, projectID, asset := seedProjectVisualAsset(t, model.AssetCategoryProp)
	if asset.Visual == nil || asset.Visual.Status != "missing" || asset.Visual.Definition["prompt"] != "古代铜印特写" {
		t.Fatalf("missing visual definition: %+v", asset)
	}
	bound, err := svc.BindProjectAssetImage("user-1", projectID, asset.ID, BindProjectAssetImageRequest{ResourceID: "image-1", ExpectedVersionID: asset.PrimaryVersionID})
	if err != nil {
		t.Fatal(err)
	}
	if bound.ID != asset.ID || bound.MediaType != "image" || bound.StorageKey != "resource:image-1" || bound.VersionCount != 2 || bound.Visual.Status != "ready" {
		t.Fatalf("bad bound asset: %+v", bound)
	}
	previous, err := svc.repo.AssetVersion(asset.PrimaryVersionID)
	if err != nil || previous.DefinitionJSON == "{}" {
		t.Fatalf("previous definition lost: %+v %v", previous, err)
	}
	current, err := svc.repo.AssetVersion(bound.PrimaryVersionID)
	if err != nil || current.DefinitionJSON != previous.DefinitionJSON {
		t.Fatalf("definition changed: %+v %v", current, err)
	}
	reps, err := svc.repo.AssetRepresentations(bound.PrimaryVersionID)
	if err != nil || len(reps) != 1 || reps[0].ResourceID != "image-1" {
		t.Fatalf("image reference: %+v %v", reps, err)
	}
	// 再绑定产生新版本，上一张图片所属版本必须仍可用于镜头。
	newer, err := svc.BindProjectAssetImage("user-1", projectID, asset.ID, BindProjectAssetImageRequest{ResourceID: "image-1", ExpectedVersionID: bound.PrimaryVersionID})
	if err != nil || newer.VersionCount != 3 {
		t.Fatalf("next bind: %+v %v", newer, err)
	}
	reps, err = svc.repo.AssetRepresentations(bound.PrimaryVersionID)
	if err != nil || len(reps) != 1 || reps[0].ResourceID != "image-1" {
		t.Fatalf("historical image lost: %+v %v", reps, err)
	}
}

func TestBindProjectAssetImageRejectsInvalidWrites(t *testing.T) {
	for _, tc := range []struct{ name, userID, projectID, resourceID, versionID string }{
		{"foreign-user", "user-2", "project-1", "image-1", "current"},
		{"unlinked-project", "user-1", "other-project", "image-1", "current"},
		{"foreign-resource", "user-1", "project-1", "foreign-image", "current"},
		{"not-image", "user-1", "project-1", "video-1", "current"},
		{"not-ready", "user-1", "project-1", "pending-image", "current"},
		{"missing-dimensions", "user-1", "project-1", "missing-dimensions", "current"},
		{"empty-resource", "user-1", "project-1", "", "current"},
		{"empty-version", "user-1", "project-1", "image-1", ""},
		{"stale-version", "user-1", "project-1", "image-1", "stale"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			svc, db, _, asset := seedProjectVisualAsset(t, model.AssetCategoryEnvironment)
			if err := db.Create(&model.Project{ID: "other-project", UserID: "user-1", Name: "无关联项目", Status: model.ProjectStatusActive}).Error; err != nil {
				t.Fatal(err)
			}
			versionID := tc.versionID
			if versionID == "current" {
				versionID = asset.PrimaryVersionID
			}
			_, err := svc.BindProjectAssetImage(tc.userID, tc.projectID, asset.ID, BindProjectAssetImageRequest{ResourceID: tc.resourceID, ExpectedVersionID: versionID})
			if err == nil {
				t.Fatal("invalid write accepted")
			}
			versions, err := svc.repo.AssetVersions(asset.ID)
			if err != nil || len(versions) != 1 {
				t.Fatalf("partial write: %+v %v", versions, err)
			}
		})
	}
}

func TestFinalizeProjectAssetImageTaskIsIdempotentAndDoesNotOverwriteNewerVersion(t *testing.T) {
	svc, _, projectID, asset := seedProjectVisualAsset(t, model.AssetCategoryEnvironment)
	input, _ := json.Marshal(map[string]any{"metadata": map[string]any{"operation": "project_asset_image", "projectAssetId": asset.ID, "projectAssetVersionId": asset.PrimaryVersionID}})
	task := model.Task{ID: "image-task", UserID: "user-1", ProjectID: projectID, InputJSON: string(input)}
	result := map[string]interface{}{"images": []interface{}{map[string]interface{}{"resourceId": "image-1"}}}
	applied, err := svc.finalizeProjectAssetImageTask(task, result)
	if err != nil || !applied {
		t.Fatalf("first finalize: %v %v", applied, err)
	}
	applied, err = svc.finalizeProjectAssetImageTask(task, result)
	if err != nil || applied || result["projectAssetImageStatus"] != "bound" {
		t.Fatalf("replayed finalize: %v %v", applied, err)
	}
	task.ID = "late-task"
	applied, err = svc.finalizeProjectAssetImageTask(task, result)
	if err != nil || applied || result["projectAssetImageStatus"] != "stale" {
		t.Fatalf("stale finalize: %v %v %+v", applied, err, result)
	}
	versions, err := svc.repo.AssetVersions(asset.ID)
	if err != nil || len(versions) != 2 {
		t.Fatalf("replay wrote extra version: %+v %v", versions, err)
	}
}

func TestBindProjectAssetImageRejectsForeignVersionPointer(t *testing.T) {
	svc, db, projectID, asset := seedProjectVisualAsset(t, model.AssetCategoryEnvironment)
	foreign := model.AssetVersion{ID: "foreign-version", AssetID: "someone-else", DefinitionJSON: `{"prompt":"private"}`}
	if err := db.Create(&foreign).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Model(&model.Asset{}).Where("id = ?", asset.ID).Update("primary_version_id", foreign.ID).Error; err != nil {
		t.Fatal(err)
	}
	if _, err := svc.BindProjectAssetImage("user-1", projectID, asset.ID, BindProjectAssetImageRequest{ResourceID: "image-1", ExpectedVersionID: foreign.ID}); err == nil {
		t.Fatal("copied a version from another asset")
	}
}

func TestAssetImageBindingCommitsWithTaskSuccessAndLease(t *testing.T) {
	for _, state := range []string{"running", "cancelled", "lost-lease"} {
		t.Run(state, func(t *testing.T) {
			svc, db, projectID, asset := seedProjectVisualAsset(t, model.AssetCategoryEnvironment)
			if err := db.AutoMigrate(&model.SystemSetting{}, &model.CanvasProject{}, &model.TaskLog{}, &model.Result{}, &model.ApiCallLog{}, &model.TaskTextDelta{}); err != nil {
				t.Fatal(err)
			}
			input, _ := json.Marshal(map[string]any{"metadata": map[string]any{"operation": "project_asset_image", "projectAssetId": asset.ID, "projectAssetVersionId": asset.PrimaryVersionID}})
			task := model.Task{ID: "final-task", UserID: "user-1", ProjectID: projectID, Status: model.TaskStatusRunning, InputJSON: string(input)}
			stored := task
			if state == "cancelled" {
				stored.Status = model.TaskStatusCancelled
			}
			if state == "lost-lease" {
				stored.LeaseOwner = "new-worker"
			}
			if err := db.Create(&stored).Error; err != nil {
				t.Fatal(err)
			}
			err := svc.saveTaskCompletionWithinStorageQuota(&task, []byte(`{"images":[{"resourceId":"image-1"}]}`), nil, false)
			versions, readErr := svc.repo.AssetVersions(asset.ID)
			if readErr != nil {
				t.Fatal(readErr)
			}
			if state == "running" {
				if err != nil || len(versions) != 2 {
					t.Fatalf("successful task did not bind: %v versions=%d", err, len(versions))
				}
				persisted, err := svc.repo.Task(task.ID)
				if err != nil || persisted.Status != model.TaskStatusSucceeded || !strings.Contains(persisted.ResultJSON, `"projectAssetImageStatus":"bound"`) {
					t.Fatalf("binding state not saved with success: %+v %v", persisted, err)
				}
			} else if !errors.Is(err, repository.ErrTaskStateConflict) || len(versions) != 1 {
				t.Fatalf("inactive task changed the asset: %v versions=%d", err, len(versions))
			}
		})
	}
}
