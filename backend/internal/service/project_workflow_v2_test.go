package service

import (
	"reflect"
	"testing"
	"time"

	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/repository"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

func newProjectWorkflowV2TestService(t *testing.T) (*Service, *gorm.DB) {
	t.Helper()
	db, err := gorm.Open(sqlite.Open("file:"+newID()+"?mode=memory&cache=shared"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(
		&model.Project{}, &model.ProjectUnit{}, &model.CanvasProject{}, &model.Asset{}, &model.AssetVersion{}, &model.ProjectAssetLink{}, &model.ProjectAssetCandidate{},
		&model.AssetRepresentation{}, &model.CharacterVoiceBinding{},
		&model.Shot{}, &model.ShotRevision{}, &model.ShotArtifact{}, &model.ShotAssetReference{},
		&model.WorkflowTemplateVersion{}, &model.WorkflowInstance{}, &model.WorkflowStepInstance{}, &model.WorkflowStepTask{},
		&model.ProductionTaskLink{}, &model.Task{}, &model.Resource{},
	); err != nil {
		t.Fatal(err)
	}
	return &Service{repo: repository.New(db)}, db
}

func TestRegisterTaskOutputFromTaskPersistsMediaAssetAndArtifactIdempotently(t *testing.T) {
	service, db := newProjectWorkflowV2TestService(t)
	project, unit := seedWorkflowProject(t, db)
	if err := service.EnsureBuiltinProjectWorkflowTemplate(); err != nil {
		t.Fatal(err)
	}
	workflow, err := service.CreateUnitWorkflow("user-1", project.ID, unit.ID)
	if err != nil {
		t.Fatal(err)
	}
	var videoStep model.WorkflowStepInstance
	for _, step := range workflow.Steps {
		if step.StepKey == "video" {
			videoStep = step
		}
	}
	shot, err := service.CreateProjectShot("user-1", project.ID, CreateProjectShotRequest{UnitID: unit.ID, Title: "SC.01", Description: "人物抬头", DurationMs: 3000})
	if err != nil {
		t.Fatal(err)
	}
	submittedRevisionID := shot.CurrentRevisionID
	if _, _, err = service.CreateShotRevision("user-1", project.ID, shot.ID, ShotRevisionInput{PlotDescription: "任务提交后修改的镜头", DurationMs: 3000}); err != nil {
		t.Fatal(err)
	}
	now := time.Now()
	resource := model.Resource{ID: "resource-video-1", UserID: "user-1", Kind: "video", Status: model.ResourceStatusReady, MimeType: "video/mp4", Size: 1024, CreatedAt: now, UpdatedAt: now}
	if err := db.Create(&resource).Error; err != nil {
		t.Fatal(err)
	}
	task := model.Task{ID: "ac745990450a86d3365eb92ec26f378e", UserID: "user-1", ProjectID: project.ID, Type: "canvas_video", Status: model.TaskStatusSucceeded,
		InputJSON:  `{"metadata":{"workflowStepId":"` + videoStep.ID + `","domainProjectId":"` + project.ID + `","unitId":"` + unit.ID + `","shotId":"` + shot.ID + `","shotRevisionId":"` + submittedRevisionID + `","artifactType":"video","role":"output","artifactMetadata":{"model":"MiniMax-H3"}}}`,
		ResultJSON: `{"mode":"video","video":{"resourceId":"resource-video-1","storageKey":"resource:resource-video-1","mimeType":"video/mp4"}}`, CreatedAt: now, UpdatedAt: now}
	if err := db.Create(&task).Error; err != nil {
		t.Fatal(err)
	}
	if err := service.RegisterTaskOutputFromTask(task); err != nil {
		t.Fatal(err)
	}
	if err := service.RegisterTaskOutputFromTask(task); err != nil {
		t.Fatal(err)
	}
	assetID := workflowGeneratedEntityID("asset", task.ID)
	versionID := workflowGeneratedEntityID("version", task.ID)
	checks := []struct {
		table string
		where string
		value string
	}{
		{table: "assets", where: "id = ?", value: assetID},
		{table: "project_asset_links", where: "asset_id = ?", value: assetID},
		{table: "asset_representations", where: "task_id = ? AND role = 'output'", value: task.ID},
		{table: "shot_artifacts", where: "task_id = ? AND type = 'video'", value: task.ID},
	}
	for _, check := range checks {
		var count int64
		if err := db.Table(check.table).Where(check.where, check.value).Count(&count).Error; err != nil || count != 1 {
			t.Fatalf("%s count = %d, error = %v", check.table, count, err)
		}
	}
	var asset model.Asset
	if err := db.First(&asset, "id = ?", assetID).Error; err != nil {
		t.Fatal(err)
	}
	if len(asset.PrimaryVersionID) > 36 || asset.PrimaryVersionID != versionID {
		t.Fatalf("primary version ID = %q, want %q with at most 36 characters", asset.PrimaryVersionID, versionID)
	}
	var version model.AssetVersion
	if err := db.First(&version, "id = ?", versionID).Error; err != nil {
		t.Fatal(err)
	}
	if len(version.ID) > 36 {
		t.Fatalf("asset version ID length = %d, want at most 36", len(version.ID))
	}
	var artifact model.ShotArtifact
	if err := db.First(&artifact, "task_id = ?", task.ID).Error; err != nil {
		t.Fatal(err)
	}
	if artifact.RevisionID != submittedRevisionID {
		t.Fatalf("artifact revision = %q, want submitted revision %q", artifact.RevisionID, submittedRevisionID)
	}
	if artifact.MetadataJSON != `{"model":"MiniMax-H3"}` {
		t.Fatalf("artifact metadata = %q", artifact.MetadataJSON)
	}
}

func seedWorkflowProject(t *testing.T, db *gorm.DB) (model.Project, model.ProjectUnit) {
	t.Helper()
	now := time.Now()
	project := model.Project{ID: "project-1", UserID: "user-1", Name: "短剧", Status: model.ProjectStatusActive, Revision: 1, CreatedAt: now, UpdatedAt: now}
	unit := model.ProjectUnit{ID: "unit-1", ProjectID: project.ID, Kind: model.ProjectUnitKindChapter, Title: "第一章", Status: model.ProjectUnitStatusDraft, CreatedAt: now, UpdatedAt: now}
	if err := db.Create(&project).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&unit).Error; err != nil {
		t.Fatal(err)
	}
	return project, unit
}

func TestShortDramaWorkflowV2UsesProductionOrder(t *testing.T) {
	service, db := newProjectWorkflowV2TestService(t)
	project, unit := seedWorkflowProject(t, db)
	if err := service.EnsureBuiltinProjectWorkflowTemplate(); err != nil {
		t.Fatal(err)
	}
	workflow, err := service.CreateUnitWorkflow("user-1", project.ID, unit.ID)
	if err != nil {
		t.Fatal(err)
	}
	keys := make([]string, 0, len(workflow.Steps))
	for _, step := range workflow.Steps {
		keys = append(keys, step.StepKey)
	}
	want := []string{"story", "assets", "storyboard", "previz", "video", "delivery"}
	if !reflect.DeepEqual(keys, want) {
		t.Fatalf("step keys = %v, want %v", keys, want)
	}
	if workflow.Steps[0].Status != model.WorkflowStepStatusReady {
		t.Fatalf("first step status = %s, want ready", workflow.Steps[0].Status)
	}
}

func TestCreateProjectCharacterCandidatesIsIdempotentAcrossPendingAndConfirmed(t *testing.T) {
	service, db := newProjectWorkflowV2TestService(t)
	project, unit := seedWorkflowProject(t, db)
	request := CreateAssetCandidatesRequest{
		Source: assetCandidateSourceChapterCharacter,
		Candidates: []AssetCandidateInput{{
			UnitID: unit.ID, Name: " 小红帽 ", Category: string(model.AssetCategoryCharacter),
			Details: validCharacterCandidateDetails([]any{"小红"}),
		}},
	}

	created, err := service.CreateProjectAssetCandidates("user-1", project.ID, request)
	if err != nil {
		t.Fatal(err)
	}
	if len(created) != 1 {
		t.Fatalf("created candidates = %d, want 1", len(created))
	}
	created, err = service.CreateProjectAssetCandidates("user-1", project.ID, request)
	if err != nil {
		t.Fatal(err)
	}
	if len(created) != 0 {
		t.Fatalf("duplicate pending candidates = %d, want 0", len(created))
	}

	if _, err := service.ConfirmProjectAssetCandidate("user-1", project.ID, firstProjectCandidateID(t, db), ConfirmProjectAssetCandidateRequest{}); err != nil {
		t.Fatal(err)
	}
	created, err = service.CreateProjectAssetCandidates("user-1", project.ID, request)
	if err != nil {
		t.Fatal(err)
	}
	if len(created) != 0 {
		t.Fatalf("confirmed character was extracted again: %d", len(created))
	}
	var assetCount int64
	if err := db.Model(&model.Asset{}).Where("user_id = ? AND category = ?", "user-1", model.AssetCategoryCharacter).Count(&assetCount).Error; err != nil {
		t.Fatal(err)
	}
	if assetCount != 1 {
		t.Fatalf("character assets = %d, want 1", assetCount)
	}
}

func TestCreateProjectCharacterCandidatesRejectsNonChapterSource(t *testing.T) {
	service, db := newProjectWorkflowV2TestService(t)
	project, unit := seedWorkflowProject(t, db)
	_, err := service.CreateProjectAssetCandidates("user-1", project.ID, CreateAssetCandidatesRequest{
		Source:     "agent",
		Candidates: []AssetCandidateInput{{UnitID: unit.ID, Name: "猎人", Category: string(model.AssetCategoryCharacter), Details: validCharacterCandidateDetails(nil)}},
	})
	if err == nil {
		t.Fatal("agent source unexpectedly created a character candidate")
	}
}

func validCharacterCandidateDetails(aliases []any) map[string]any {
	return map[string]any{
		"role": "主角", "aliases": aliases, "appearance": "红色斗篷", "clothing": "红色兜帽与斗篷", "physique": "儿童体型",
		"personality": "勇敢", "voiceLanguage": "普通话", "voiceAge": "儿童", "voiceTimbre": "清亮",
	}
}

func firstProjectCandidateID(t *testing.T, db *gorm.DB) string {
	t.Helper()
	var candidate model.ProjectAssetCandidate
	if err := db.Order("created_at asc").First(&candidate).Error; err != nil {
		t.Fatal(err)
	}
	return candidate.ID
}

func TestWorkflowCompletionRequiresStageGate(t *testing.T) {
	service, db := newProjectWorkflowV2TestService(t)
	project, unit := seedWorkflowProject(t, db)
	if err := service.EnsureBuiltinProjectWorkflowTemplate(); err != nil {
		t.Fatal(err)
	}
	workflow, err := service.CreateUnitWorkflow("user-1", project.ID, unit.ID)
	if err != nil {
		t.Fatal(err)
	}
	step := workflow.Steps[0]
	if _, err := service.UpdateWorkflowStep("user-1", project.ID, step.ID, UpdateWorkflowStepRequest{Status: "running"}); err != nil {
		t.Fatal(err)
	}
	if _, err := service.UpdateWorkflowStep("user-1", project.ID, step.ID, UpdateWorkflowStepRequest{Status: "completed"}); err == nil {
		t.Fatal("empty chapter completed story gate")
	}
	unit.SourceText = "第一章正文"
	unit.UpdatedAt = time.Now()
	if err := db.Save(&unit).Error; err != nil {
		t.Fatal(err)
	}
	if _, err := service.UpdateWorkflowStep("user-1", project.ID, step.ID, UpdateWorkflowStepRequest{Status: "completed"}); err != nil {
		t.Fatal(err)
	}
}

func TestCreateShotRevisionInvalidatesExistingArtifacts(t *testing.T) {
	service, db := newProjectWorkflowV2TestService(t)
	project, unit := seedWorkflowProject(t, db)
	if err := service.EnsureBuiltinProjectWorkflowTemplate(); err != nil {
		t.Fatal(err)
	}
	workflow, err := service.CreateUnitWorkflow("user-1", project.ID, unit.ID)
	if err != nil {
		t.Fatal(err)
	}
	shot, err := service.CreateProjectShot("user-1", project.ID, CreateProjectShotRequest{UnitID: unit.ID, Title: "SC.01", Description: "人物推门进入", DurationMs: 3000})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.Model(&model.WorkflowStepInstance{}).Where("workflow_instance_id = ? AND step_key IN ?", workflow.Instance.ID, []string{"storyboard", "previz", "video", "delivery"}).Updates(map[string]any{"status": model.WorkflowStepStatusCompleted}).Error; err != nil {
		t.Fatal(err)
	}
	artifact := model.ShotArtifact{ID: "artifact-1", ProjectID: project.ID, UnitID: unit.ID, ShotID: shot.ID, RevisionID: shot.CurrentRevisionID, Type: "action_board", Version: 1, Status: "ready", Selected: true, CreatedAt: time.Now(), UpdatedAt: time.Now()}
	if err := db.Create(&artifact).Error; err != nil {
		t.Fatal(err)
	}
	updatedShot, revision, err := service.CreateShotRevision("user-1", project.ID, shot.ID, ShotRevisionInput{PlotDescription: "人物推门后停在门口", Action: "推门、停顿", DurationMs: 3500})
	if err != nil {
		t.Fatal(err)
	}
	if revision.Version != 2 || updatedShot.CurrentRevisionID != revision.ID {
		t.Fatalf("revision = v%d current=%s, want v2 current revision", revision.Version, updatedShot.CurrentRevisionID)
	}
	var storedArtifact model.ShotArtifact
	if err := db.First(&storedArtifact, "id = ?", artifact.ID).Error; err != nil {
		t.Fatal(err)
	}
	if storedArtifact.Status != "stale" || storedArtifact.Selected {
		t.Fatalf("artifact status=%s selected=%v, want stale false", storedArtifact.Status, storedArtifact.Selected)
	}
	var storyboardStep model.WorkflowStepInstance
	if err := db.First(&storyboardStep, "workflow_instance_id = ? AND step_key = ?", workflow.Instance.ID, "storyboard").Error; err != nil {
		t.Fatal(err)
	}
	if storyboardStep.Status != model.WorkflowStepStatusRunning {
		t.Fatalf("storyboard step status = %s, want running", storyboardStep.Status)
	}
	var videoStep model.WorkflowStepInstance
	if err := db.First(&videoStep, "workflow_instance_id = ? AND step_key = ?", workflow.Instance.ID, "video").Error; err != nil {
		t.Fatal(err)
	}
	if videoStep.Status != model.WorkflowStepStatusPending {
		t.Fatalf("video step status = %s, want pending", videoStep.Status)
	}
}

func TestReplaceProjectUnitShotsCreatesGeneratedAssetReferencesAtomically(t *testing.T) {
	service, db := newProjectWorkflowV2TestService(t)
	project, unit := seedWorkflowProject(t, db)
	now := time.Now()
	asset := model.Asset{ID: "asset-1", UserID: "user-1", Kind: "image", Category: model.AssetCategory("prop"), Status: model.AssetVersionStatus("ready"), PrimaryVersionID: "asset-version-1", Title: "旧信封", CreatedAt: now, UpdatedAt: now}
	version := model.AssetVersion{ID: "asset-version-1", AssetID: asset.ID, Version: 1, Status: model.AssetVersionStatus("ready"), CreatedAt: now, UpdatedAt: now}
	link := model.ProjectAssetLink{ID: "project-asset-link-1", ProjectID: project.ID, AssetID: asset.ID, CreatedAt: now}
	for _, item := range []any{&asset, &version, &link} {
		if err := db.Create(item).Error; err != nil {
			t.Fatal(err)
		}
	}

	shots, err := service.ReplaceProjectUnitShots("user-1", project.ID, unit.ID, ReplaceProjectUnitShotsRequest{ExpectedShotIDs: []string{}, Shots: []ReplaceProjectUnitShotInput{{
		CreateProjectShotRequest: CreateProjectShotRequest{Title: "SC.01", Description: "人物拾起信封", DurationMs: 3000, Revision: ShotRevisionInput{PlotDescription: "人物拾起信封"}},
		AssetVersionIDs:          []string{version.ID, version.ID},
	}}})
	if err != nil {
		t.Fatal(err)
	}
	if len(shots) != 1 {
		t.Fatalf("shot count = %d, want 1", len(shots))
	}
	var references []model.ShotAssetReference
	if err := db.Where("shot_id = ?", shots[0].ID).Find(&references).Error; err != nil {
		t.Fatal(err)
	}
	if len(references) != 1 || references[0].AssetVersionID != version.ID || references[0].Role != "reference" {
		t.Fatalf("references = %+v, want one generated reference", references)
	}
	_, err = service.ReplaceProjectUnitShots("user-1", project.ID, unit.ID, ReplaceProjectUnitShotsRequest{ExpectedShotIDs: []string{"stale-shot-id"}, Shots: []ReplaceProjectUnitShotInput{{
		CreateProjectShotRequest: CreateProjectShotRequest{Title: "SC.02", Description: "并发替换", DurationMs: 3000},
	}}})
	if err == nil || err.Error() != "本章分镜已发生变化，请刷新后重新确认" {
		t.Fatalf("concurrent replacement error = %v", err)
	}

	_, err = service.ReplaceProjectUnitShots("user-1", project.ID, unit.ID, ReplaceProjectUnitShotsRequest{Shots: []ReplaceProjectUnitShotInput{{
		CreateProjectShotRequest: CreateProjectShotRequest{Title: "SC.02", Description: "无效资产", DurationMs: 3000},
		AssetVersionIDs:          []string{"missing-version"},
	}}})
	if err == nil {
		t.Fatal("missing project asset version should reject replacement")
	}
	var storedShots int64
	if err := db.Model(&model.Shot{}).Where("project_id = ? AND unit_id = ?", project.ID, unit.ID).Count(&storedShots).Error; err != nil {
		t.Fatal(err)
	}
	if storedShots != 1 {
		t.Fatalf("stored shots = %d, want original replacement preserved", storedShots)
	}
}

func TestUnlinkShotAssetDeletesReferenceAndInvalidatesProduction(t *testing.T) {
	service, db := newProjectWorkflowV2TestService(t)
	project, unit := seedWorkflowProject(t, db)
	if err := service.EnsureBuiltinProjectWorkflowTemplate(); err != nil {
		t.Fatal(err)
	}
	workflow, err := service.CreateUnitWorkflow("user-1", project.ID, unit.ID)
	if err != nil {
		t.Fatal(err)
	}
	shot, err := service.CreateProjectShot("user-1", project.ID, CreateProjectShotRequest{UnitID: unit.ID, Title: "SC.01", Description: "人物走入画面", DurationMs: 3000})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.Model(&model.WorkflowStepInstance{}).Where("workflow_instance_id = ? AND step_key IN ?", workflow.Instance.ID, []string{"storyboard", "previz", "video", "delivery"}).Updates(map[string]any{"status": model.WorkflowStepStatusCompleted}).Error; err != nil {
		t.Fatal(err)
	}
	now := time.Now()
	reference := model.ShotAssetReference{ID: "reference-1", ShotID: shot.ID, AssetVersionID: "asset-version-1", Role: "reference", Status: "linked", CreatedAt: now}
	artifact := model.ShotArtifact{ID: "artifact-unlink-1", ProjectID: project.ID, UnitID: unit.ID, ShotID: shot.ID, Type: "video", Version: 1, Status: "ready", Selected: true, CreatedAt: now, UpdatedAt: now}
	for _, item := range []any{&reference, &artifact} {
		if err := db.Create(item).Error; err != nil {
			t.Fatal(err)
		}
	}

	if err := service.UnlinkShotAsset("user-2", project.ID, shot.ID, reference.ID); err == nil {
		t.Fatal("another user should not unlink the shot asset")
	}
	if err := service.UnlinkShotAsset("user-1", project.ID, shot.ID, reference.ID); err != nil {
		t.Fatal(err)
	}
	var referenceCount int64
	if err := db.Model(&model.ShotAssetReference{}).Where("id = ?", reference.ID).Count(&referenceCount).Error; err != nil {
		t.Fatal(err)
	}
	if referenceCount != 0 {
		t.Fatalf("reference count = %d, want 0", referenceCount)
	}
	var storedArtifact model.ShotArtifact
	if err := db.First(&storedArtifact, "id = ?", artifact.ID).Error; err != nil {
		t.Fatal(err)
	}
	if storedArtifact.Status != "stale" || storedArtifact.Selected {
		t.Fatalf("artifact status=%s selected=%v, want stale false", storedArtifact.Status, storedArtifact.Selected)
	}
	var storyboardStep model.WorkflowStepInstance
	if err := db.First(&storyboardStep, "workflow_instance_id = ? AND step_key = ?", workflow.Instance.ID, "storyboard").Error; err != nil {
		t.Fatal(err)
	}
	if storyboardStep.Status != model.WorkflowStepStatusRunning {
		t.Fatalf("storyboard step status = %s, want running", storyboardStep.Status)
	}
	if err := service.UnlinkShotAsset("user-1", project.ID, shot.ID, reference.ID); err == nil {
		t.Fatal("second unlink should report missing reference")
	}
}

func TestDeleteProjectShotCleansRelationsAndCompactsPositions(t *testing.T) {
	service, db := newProjectWorkflowV2TestService(t)
	project, unit := seedWorkflowProject(t, db)
	if err := service.EnsureBuiltinProjectWorkflowTemplate(); err != nil {
		t.Fatal(err)
	}
	workflow, err := service.CreateUnitWorkflow("user-1", project.ID, unit.ID)
	if err != nil {
		t.Fatal(err)
	}
	shots := make([]model.Shot, 0, 3)
	for index, title := range []string{"SC.01", "SC.02", "SC.03"} {
		shot, createErr := service.CreateProjectShot("user-1", project.ID, CreateProjectShotRequest{
			UnitID: unit.ID, Title: title, Description: "镜头画面", Position: index, DurationMs: 3000,
		})
		if createErr != nil {
			t.Fatal(createErr)
		}
		shots = append(shots, shot)
	}
	if err := db.Model(&model.WorkflowStepInstance{}).Where("workflow_instance_id = ? AND step_key IN ?", workflow.Instance.ID, []string{"storyboard", "previz", "video", "delivery"}).Updates(map[string]any{"status": model.WorkflowStepStatusCompleted}).Error; err != nil {
		t.Fatal(err)
	}
	target := shots[1]
	now := time.Now()
	reference := model.ShotAssetReference{ID: "delete-reference-1", ShotID: target.ID, AssetVersionID: "asset-version-1", Role: "reference", Status: "linked", CreatedAt: now}
	artifact := model.ShotArtifact{ID: "delete-artifact-1", ProjectID: project.ID, UnitID: unit.ID, ShotID: target.ID, RevisionID: target.CurrentRevisionID, Type: "video", Version: 1, Status: "ready", Selected: true, CreatedAt: now, UpdatedAt: now}
	candidate := model.ProjectAssetCandidate{ID: "delete-candidate-1", ProjectID: project.ID, UnitID: unit.ID, ShotID: target.ID, Name: "雨伞", Category: model.AssetCategory("prop"), Status: "pending_confirmation", DetailsJSON: "{}", CreatedAt: now, UpdatedAt: now}
	productionLink := model.ProductionTaskLink{ID: "delete-production-link-1", TaskID: "delete-task-1", ProjectID: project.ID, UnitID: unit.ID, ShotID: target.ID, ArtifactType: "video", CreatedAt: now, UpdatedAt: now}
	for _, item := range []any{&reference, &artifact, &candidate, &productionLink} {
		if err := db.Create(item).Error; err != nil {
			t.Fatal(err)
		}
	}

	if err := service.DeleteProjectShot("user-2", project.ID, target.ID); err == nil {
		t.Fatal("another user should not delete the shot")
	}
	if err := service.DeleteProjectShot("user-1", project.ID, target.ID); err != nil {
		t.Fatal(err)
	}

	var remaining []model.Shot
	if err := db.Where("project_id = ? AND unit_id = ?", project.ID, unit.ID).Order("position asc").Find(&remaining).Error; err != nil {
		t.Fatal(err)
	}
	if len(remaining) != 2 || remaining[0].ID != shots[0].ID || remaining[0].Position != 0 || remaining[1].ID != shots[2].ID || remaining[1].Position != 1 {
		t.Fatalf("remaining shots = %+v, want first and third compacted to positions 0 and 1", remaining)
	}
	for name, query := range map[string]*gorm.DB{
		"shot":            db.Model(&model.Shot{}).Where("id = ?", target.ID),
		"revision":        db.Model(&model.ShotRevision{}).Where("shot_id = ?", target.ID),
		"artifact":        db.Model(&model.ShotArtifact{}).Where("shot_id = ?", target.ID),
		"reference":       db.Model(&model.ShotAssetReference{}).Where("shot_id = ?", target.ID),
		"candidate":       db.Model(&model.ProjectAssetCandidate{}).Where("shot_id = ?", target.ID),
		"production link": db.Model(&model.ProductionTaskLink{}).Where("shot_id = ?", target.ID),
	} {
		var count int64
		if err := query.Count(&count).Error; err != nil {
			t.Fatal(err)
		}
		if count != 0 {
			t.Fatalf("%s count = %d, want 0", name, count)
		}
	}
	var storyboardStep model.WorkflowStepInstance
	if err := db.First(&storyboardStep, "workflow_instance_id = ? AND step_key = ?", workflow.Instance.ID, "storyboard").Error; err != nil {
		t.Fatal(err)
	}
	if storyboardStep.Status != model.WorkflowStepStatusRunning {
		t.Fatalf("storyboard step status = %s, want running", storyboardStep.Status)
	}
}

func TestUpdateChapterSourceInvalidatesAllUnitArtifacts(t *testing.T) {
	service, db := newProjectWorkflowV2TestService(t)
	project, unit := seedWorkflowProject(t, db)
	if err := service.EnsureBuiltinProjectWorkflowTemplate(); err != nil {
		t.Fatal(err)
	}
	workflow, err := service.CreateUnitWorkflow("user-1", project.ID, unit.ID)
	if err != nil {
		t.Fatal(err)
	}
	shot, err := service.CreateProjectShot("user-1", project.ID, CreateProjectShotRequest{UnitID: unit.ID, Title: "SC.01", Description: "旧剧情镜头", DurationMs: 3000})
	if err != nil {
		t.Fatal(err)
	}
	artifact := model.ShotArtifact{ID: "artifact-source-1", ProjectID: project.ID, UnitID: unit.ID, ShotID: shot.ID, RevisionID: shot.CurrentRevisionID, Type: "video", Version: 1, Status: "ready", Selected: true, CreatedAt: time.Now(), UpdatedAt: time.Now()}
	if err := db.Create(&artifact).Error; err != nil {
		t.Fatal(err)
	}
	if _, err := service.UpdateProjectUnit("user-1", project.ID, unit.ID, UpdateProjectUnitRequest{Title: unit.Title, SourceText: "修改后的章节正文"}); err != nil {
		t.Fatal(err)
	}
	var storedArtifact model.ShotArtifact
	if err := db.First(&storedArtifact, "id = ?", artifact.ID).Error; err != nil {
		t.Fatal(err)
	}
	if storedArtifact.Status != "stale" || storedArtifact.Selected {
		t.Fatalf("artifact status=%s selected=%v, want stale false", storedArtifact.Status, storedArtifact.Selected)
	}
	var storyStep model.WorkflowStepInstance
	if err := db.First(&storyStep, "workflow_instance_id = ? AND step_key = ?", workflow.Instance.ID, "story").Error; err != nil {
		t.Fatal(err)
	}
	if storyStep.Status != model.WorkflowStepStatusRunning {
		t.Fatalf("story step status = %s, want running", storyStep.Status)
	}
}

func TestRegisterTaskOutputAcceptsLinkedCanvasAndCreatesShotArtifact(t *testing.T) {
	service, db := newProjectWorkflowV2TestService(t)
	project, unit := seedWorkflowProject(t, db)
	if err := service.EnsureBuiltinProjectWorkflowTemplate(); err != nil {
		t.Fatal(err)
	}
	workflow, err := service.CreateUnitWorkflow("user-1", project.ID, unit.ID)
	if err != nil {
		t.Fatal(err)
	}
	shot, err := service.CreateProjectShot("user-1", project.ID, CreateProjectShotRequest{UnitID: unit.ID, Title: "SC.01", Description: "人物走入画面", DurationMs: 3000})
	if err != nil {
		t.Fatal(err)
	}
	canvas := model.CanvasProject{ID: "canvas-1", UserID: "user-1", ProjectID: project.ID, Title: "探索画布", CreatedAt: time.Now(), UpdatedAt: time.Now()}
	task := model.Task{ID: "task-1", UserID: "user-1", ProjectID: canvas.ID, Status: model.TaskStatusSucceeded, ResultJSON: `{}`, CreatedAt: time.Now(), UpdatedAt: time.Now()}
	resource := model.Resource{ID: "resource-1", UserID: "user-1", Kind: "image", Status: model.ResourceStatusReady, CreatedAt: time.Now(), UpdatedAt: time.Now()}
	for _, item := range []any{&canvas, &task, &resource} {
		if err := db.Create(item).Error; err != nil {
			t.Fatal(err)
		}
	}
	step := workflow.Steps[0]
	updatedStep, err := service.RegisterTaskOutput("user-1", project.ID, step.ID, RegisterTaskOutputRequest{TaskID: task.ID, UnitID: unit.ID, ShotID: shot.ID, ArtifactType: "storyboard", ResourceID: resource.ID, MediaType: "image"})
	if err != nil {
		t.Fatal(err)
	}
	if updatedStep.Status != model.WorkflowStepStatusRunning {
		t.Fatalf("step status = %s, want running until the unit gate is complete", updatedStep.Status)
	}
	var nextStep model.WorkflowStepInstance
	if err := db.First(&nextStep, "workflow_instance_id = ? AND position = ?", workflow.Instance.ID, 1).Error; err != nil {
		t.Fatal(err)
	}
	if nextStep.Status != model.WorkflowStepStatusPending {
		t.Fatalf("next step status = %s, want pending", nextStep.Status)
	}
	var productionLink model.ProductionTaskLink
	if err := db.First(&productionLink, "task_id = ?", task.ID).Error; err != nil {
		t.Fatal(err)
	}
	if productionLink.ProjectID != project.ID || productionLink.CanvasID != canvas.ID || productionLink.ShotID != shot.ID {
		t.Fatalf("unexpected production link: %+v", productionLink)
	}
	var storedArtifact model.ShotArtifact
	if err := db.First(&storedArtifact, "task_id = ?", task.ID).Error; err != nil {
		t.Fatal(err)
	}
	if storedArtifact.Type != "storyboard" || storedArtifact.Status != "ready" || !storedArtifact.Selected {
		t.Fatalf("unexpected shot artifact: %+v", storedArtifact)
	}
}
