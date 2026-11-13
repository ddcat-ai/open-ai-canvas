package app

import (
	"encoding/json"
	"errors"
	"reflect"
	"strings"
	"testing"

	"gorm.io/gorm"
	agenttool "yingce/backend/internal/agent/tool"
	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"
)

func cloudAgentDramaPageFixture(t *testing.T) (*Service, *gorm.DB, *CloudAgentPageContext) {
	t.Helper()
	s, db, _, _ := creationTestService(t)
	video := dramaVideoFixture()
	videoCapability := mustEncodeModelCapabilityConfig(t, &ModelCapabilityConfig{Version: 1, Video: &video})
	for _, item := range []any{
		&model.ChannelModel{ID: "page-video", ChannelID: "channel", ModelKey: "page-video", Capability: "video", Protocol: model.ChannelInterfaceVolcengineArkVideo, Enabled: true, CapabilityConfigJSON: videoCapability},
		&model.Project{ID: "page-project", UserID: "user", Name: "分镜优化", Type: "drama"},
		&model.Project{ID: "foreign-project", UserID: "other", Name: "他人的短剧", Type: "drama"},
		&model.DramaProduction{ProjectID: "page-project", UserID: "user", Status: model.DramaStatusPaused, SettingsJSON: `{"mediaMode":"manual","videoContinuity":"parallel","models":{"video":{"channelId":"channel","modelKey":"page-video"}}}`},
		&model.DramaProduction{ProjectID: "foreign-project", UserID: "other", Status: model.DramaStatusPaused},
		&model.DramaEpisode{ID: "page-episode", ProjectID: "page-project", Number: 1, Revision: 7, Stage: model.DramaEpisodeReview, ShotCount: 2, Approved: true},
		&model.DramaEpisode{ID: "other-episode", ProjectID: "page-project", Number: 2, Revision: 3},
		&model.DramaEpisode{ID: "foreign-episode", ProjectID: "foreign-project", Number: 1, Revision: 2},
		&model.DramaShot{ID: "page-shot", ProjectID: "page-project", EpisodeID: "page-episode", Position: 0, SegmentIndex: 0, Action: "她抬头", Dialogue: "你来了", DurationMs: 3000},
		&model.DramaShot{ID: "next-shot", ProjectID: "page-project", EpisodeID: "page-episode", Position: 1, SegmentIndex: 0, Action: "她转身", DurationMs: 2000},
		&model.DramaShot{ID: "other-shot", ProjectID: "page-project", EpisodeID: "other-episode", Position: 0, SegmentIndex: 0, Action: "别集内容"},
		&model.DramaShot{ID: "foreign-shot", ProjectID: "foreign-project", EpisodeID: "foreign-episode", Position: 0, SegmentIndex: 0, Action: "他人内容"},
		&model.DramaSegment{ID: "page-segment", ProjectID: "page-project", EpisodeID: "page-episode", SegmentIndex: 0, PromptStatus: "ready", VideoPrompt: "旧提示词", VideoStatus: "ready", VideoResourceID: "prior-video", Revision: 2},
	} {
		if err := db.Create(item).Error; err != nil {
			t.Fatal(err)
		}
	}
	return s, db, &CloudAgentPageContext{Kind: "drama", ProjectID: "page-project", EpisodeID: "page-episode", ShotID: "page-shot"}
}

func cloudAgentDramaPageRequest(page *CloudAgentPageContext, key, permission string) CloudAgentRequest {
	req := unboundAgentTestRequest(key)
	req.PageContext, req.PermissionMode = page, permission
	return req
}

func cloudAgentDramaPageRead(t *testing.T, s *Service, page *CloudAgentPageContext, args map[string]any) map[string]any {
	t.Helper()
	result, err := cloudAgentHandleDramaShotRead(s.repo, "user", &cloudAgentRuntime{Request: CloudAgentRequest{PageContext: page}}, cloudAgentStoryboardCall(t, agenttool.DramaShotRead, "read-page-shot", args))
	if err != nil {
		t.Fatal(err)
	}
	return result.(map[string]any)
}

func TestCloudAgentDramaPageToolsUsePageScopeAndApproval(t *testing.T) {
	page := &CloudAgentPageContext{Kind: "drama", ProjectID: "project", EpisodeID: "episode", ShotID: "shot"}
	for _, mode := range []string{"read_only", "request_approval", "auto"} {
		req := cloudAgentDramaPageRequest(page, "scope-page-key", mode)
		advertised := map[string]bool{}
		for _, item := range cloudAgentTools(req) {
			advertised[item["function"].(map[string]any)["name"].(string)] = true
		}
		if !advertised[agenttool.DramaShotRead] || advertised[agenttool.DramaShotUpdate] != (mode != "read_only") {
			t.Fatalf("wrong page tools for %s: %v", mode, advertised)
		}
		if !agenttool.Of(agenttool.DramaShotUpdate).ApprovalRequired(mode) {
			t.Fatalf("page mutation bypassed approval in %s", mode)
		}
		if advertised[agenttool.CanvasGetState] || advertised[agenttool.DramaGetContext] || advertised[agenttool.GenerateMedia] {
			t.Fatal("page scope unexpectedly enabled canvas/media tools")
		}
	}
	if cloudAgentToolAllowed(CloudAgentRequest{PermissionMode: "auto"}, agenttool.DramaShotUpdate) || cloudAgentToolAllowed(CloudAgentRequest{PageContext: &CloudAgentPageContext{Kind: "unknown"}}, agenttool.DramaShotRead) {
		t.Fatal("unbound or invalid page exposed page tools")
	}
}

func TestCloudAgentDramaPageAdmissionValidatesOwnershipAndFreezesContext(t *testing.T) {
	s, db, page := cloudAgentDramaPageFixture(t)
	for _, invalid := range []CloudAgentPageContext{
		{Kind: "drama", ProjectID: "foreign-project", EpisodeID: "foreign-episode", ShotID: "foreign-shot"},
		{Kind: "drama", ProjectID: page.ProjectID, EpisodeID: page.EpisodeID, ShotID: "other-shot"},
		{Kind: "drama", ProjectID: page.ProjectID, EpisodeID: "foreign-episode"},
		{Kind: "drama", ProjectID: page.ProjectID, ShotID: page.ShotID},
		{Kind: "canvas", ProjectID: page.ProjectID},
	} {
		if _, err := s.CreateCloudAgentRun("user", cloudAgentDramaPageRequest(&invalid, "invalid-page-key", "auto"), ""); err == nil {
			t.Fatalf("invalid page accepted: %+v", invalid)
		}
	}
	req := cloudAgentDramaPageRequest(page, "valid-page-key", "auto")
	req.CanvasID = "some-canvas"
	if err := validateCloudAgentRequest(&req); err == nil {
		t.Fatal("mixed canvas and page scope accepted")
	}
	req.CanvasID = ""
	run, err := s.CreateCloudAgentRun("user", req, "")
	if err != nil || run.CanvasID != "" || run.PageContext == nil || run.PageContext.ShotID != page.ShotID {
		t.Fatalf("page run admission: %+v, %v", run, err)
	}
	page.ShotID = "next-shot"
	if run.PageContext.ShotID != "page-shot" {
		t.Fatal("returned run retained caller's mutable page pointer")
	}
	if _, err := s.CreateCloudAgentRun("user", req, ""); err == nil {
		t.Fatal("same key silently rebound an accepted page request")
	}
	if err := db.Model(&model.Task{}).Where("id = ?", run.ID).Update("input_json", "{}").Error; err != nil {
		t.Fatal(err)
	}
	loaded, err := s.CloudAgentRun("user", run.ID)
	if err != nil || loaded.PageContext == nil || loaded.PageContext.ShotID != "page-shot" {
		t.Fatalf("execution output lost frozen context after task compaction: %+v %v", loaded, err)
	}
}

func TestCloudAgentDramaPageReadDirectoryAndTargetBoundary(t *testing.T) {
	s, _, page := cloudAgentDramaPageFixture(t)
	result := cloudAgentDramaPageRead(t, s, page, map[string]any{})
	if result["revision"] != int64(7) || result["shotId"] != "page-shot" || result["shot"].(*model.DramaShot).Dialogue != "你来了" {
		t.Fatalf("incorrect latest shot: %+v", result)
	}
	state := &cloudAgentRuntime{Request: CloudAgentRequest{PageContext: page}}
	for _, args := range []map[string]any{{"shotId": "next-shot"}, {"episodeId": "other-episode"}, {"projectId": "foreign-project"}} {
		if _, err := cloudAgentHandleDramaShotRead(s.repo, "user", state, cloudAgentStoryboardCall(t, agenttool.DramaShotRead, "bad-read", args)); err == nil {
			t.Fatalf("read escaped frozen context: %+v", args)
		}
	}
	page.ShotID = ""
	result = cloudAgentDramaPageRead(t, s, page, map[string]any{"limit": 1})
	if result["hasMore"] != true || result["nextOffset"] != 1 || len(result["shots"].([]map[string]any)) != 1 {
		t.Fatalf("missing bounded shot directory: %+v", result)
	}
	result = cloudAgentDramaPageRead(t, s, page, map[string]any{"shotId": "next-shot"})
	if result["shotId"] != "next-shot" {
		t.Fatal("directory selection did not narrow target")
	}
	page.EpisodeID = ""
	result = cloudAgentDramaPageRead(t, s, page, map[string]any{"limit": 1})
	if result["total"] != 2 || len(result["episodes"].([]map[string]any)) != 1 {
		t.Fatalf("project directory leaked other project: %+v", result)
	}
}

func TestCloudAgentDramaPageContinuationFreezesNewScopeAfterCompaction(t *testing.T) {
	for _, nextShot := range []string{"next-shot", ""} {
		t.Run("next_"+nextShot, func(t *testing.T) {
			s, db, page := cloudAgentDramaPageFixture(t)
			root, err := s.CreateCloudAgentRun("user", cloudAgentDramaPageRequest(page, "page-scope-root", "auto"), "")
			if err != nil {
				t.Fatal(err)
			}
			if err := db.Model(&model.Task{}).Where("id = ?", root.ID).Updates(map[string]any{"status": model.TaskStatusSucceeded, "result_json": `{"text":"好的"}`, "input_json": "{}"}).Error; err != nil {
				t.Fatal(err)
			}
			if err := db.Model(&model.CloudAgentExecution{}).Where("id = ?", root.ID).Updates(map[string]any{"status": "completed", "cleanup_pending": false}).Error; err != nil {
				t.Fatal(err)
			}
			var nextPage *CloudAgentPageContext
			if nextShot != "" {
				nextPage = &CloudAgentPageContext{Kind: "drama", ProjectID: page.ProjectID, EpisodeID: page.EpisodeID, ShotID: nextShot}
			}
			next, err := s.CreateCloudAgentRun("user", cloudAgentDramaPageRequest(nextPage, "page-scope-next", "auto"), root.ID)
			if err != nil {
				t.Fatal(err)
			}
			if !sameCloudAgentPageContext(next.PageContext, nextPage) {
				t.Fatalf("continuation retained the old page target: %+v", next.PageContext)
			}
			execution, err := s.repo.CloudAgent("user", next.ID)
			if err != nil {
				t.Fatal(err)
			}
			state, err := cloudAgentDecode(execution)
			if err != nil {
				t.Fatal(err)
			}
			found := false
			for _, message := range state.TextHistory {
				var frame struct {
					Kind                string                 `json:"kind"`
					PreviousPageContext *CloudAgentPageContext `json:"previousPageContext"`
					PageContext         *CloudAgentPageContext `json:"pageContext"`
				}
				if json.Unmarshal([]byte(message.Content), &frame) == nil && frame.Kind == "scope_change" && sameCloudAgentPageContext(frame.PreviousPageContext, page) && sameCloudAgentPageContext(frame.PageContext, nextPage) {
					found = message.AgentContextSource == "continuation"
				}
			}
			if !found {
				t.Fatal("continuation lost the previous/current page scope after task compaction")
			}
		})
	}
}

func TestCloudAgentDramaPagePreviewMatchesPersistedValues(t *testing.T) {
	s, db, page := cloudAgentDramaPageFixture(t)
	priorPrompt := strings.Repeat("旧", 2000)
	nextPrompt := strings.Repeat("🌅", 1999) + "尾"
	if err := db.Model(&model.DramaShot{}).Where("id = ?", page.ShotID).Update("image_prompt", priorPrompt).Error; err != nil {
		t.Fatal(err)
	}
	call := cloudAgentStoryboardCall(t, agenttool.DramaShotUpdate, "preview-exact-values", map[string]any{"expectedRevision": 7, "fields": map[string]any{"dialogue": " \n你终于来了 \n", "imagePrompt": nextPrompt, "durationSeconds": 3.125}})
	preview, err := cloudAgentPreviewDramaShotUpdate(s.repo, "user", page, call, s)
	if err != nil {
		t.Fatal(err)
	}
	if preview.Items[0].NodeTitle != "分镜优化 · 第 1 集 · 镜头 1" || !strings.Contains(preview.Description, "分镜优化") || preview.Items[0].NodeTypeLabel != "短剧分镜" || preview.Items[0].NodeID != "" {
		t.Fatalf("preview target cannot be displayed correctly: %+v", preview.Items[0])
	}
	wantDetails := []string{"目标：项目 分镜优化（page-project） · 集 page-episode · 镜头 page-shot", "台词：你来了 → 你终于来了", "首帧提示词：" + priorPrompt + " → " + nextPrompt, "时长：3 秒 → 3.125 秒"}
	if !reflect.DeepEqual(preview.Items[0].Details, wantDetails) {
		t.Fatal("preview truncated or changed the values that will be saved")
	}
	value, err := applyCloudAgentDramaShotUpdate(s.repo, "user", page, call, s)
	if err != nil {
		t.Fatal(err)
	}
	result := value.(map[string]any)
	persisted, err := s.repo.DramaShot(page.ProjectID, page.ShotID)
	if err != nil {
		t.Fatal(err)
	}
	if persisted.Dialogue != "你终于来了" || persisted.ImagePrompt != nextPrompt || persisted.DurationMs != 3125 {
		t.Fatalf("saved fields differ from approval: %+v", persisted)
	}
	if !reflect.DeepEqual(result["shot"], persisted) || !reflect.DeepEqual(result["preview"].(cloudAgentApprovalPreview).Items, preview.Items) {
		t.Fatal("write receipt differs from saved row or approved preview")
	}
}

func TestCloudAgentDramaPageUpdateUsesBusinessRulesAndRejectsStaleApproval(t *testing.T) {
	s, _, page := cloudAgentDramaPageFixture(t)
	call := cloudAgentStoryboardCall(t, agenttool.DramaShotUpdate, "edit-page-shot", map[string]any{"expectedRevision": 7, "fields": map[string]any{"dialogue": "好久不见", "camera": "缓慢推近"}})
	preview, err := cloudAgentPreviewDramaShotUpdate(s.repo, "user", page, call, s)
	if err != nil || len(preview.Items) != 1 || preview.Items[0].Operation != "update_drama_shot" {
		t.Fatalf("preview: %+v %v", preview, err)
	}
	before, _ := s.repo.DramaShot(page.ProjectID, page.ShotID)
	if before.Dialogue != "你来了" {
		t.Fatal("preview mutated the shot")
	}
	value, err := applyCloudAgentDramaShotUpdate(s.repo, "user", page, call, s)
	if err != nil {
		t.Fatal(err)
	}
	result := value.(map[string]any)
	shot, _ := s.repo.DramaShot(page.ProjectID, page.ShotID)
	segment, _ := s.repo.DramaSegments(page.EpisodeID)
	episode, _ := s.repo.DramaEpisode(page.ProjectID, page.EpisodeID)
	if shot.Dialogue != "好久不见" || shot.Camera != "缓慢推近" || segment[0].PromptStatus != "stale" || segment[0].VideoStatus != "stale" || episode.Approved || result["revision"] != episode.Revision {
		t.Fatalf("business mutation/invalidations missing: %+v %+v %+v %+v", shot, segment, episode, result)
	}
	if _, err := applyCloudAgentDramaShotUpdate(s.repo, "user", page, call, s); err == nil {
		t.Fatal("replayed old revision wrote twice")
	}
	call = cloudAgentStoryboardCall(t, agenttool.DramaShotUpdate, "stale-approval", map[string]any{"expectedRevision": episode.Revision, "fields": map[string]any{"dialogue": "助手待审批的版本"}})
	if _, err := cloudAgentPreviewDramaShotUpdate(s.repo, "user", page, call, s); err != nil {
		t.Fatal(err)
	}
	human := "人工刚刚修改的版本"
	if _, err := s.UpdateDramaShot("user", page.ProjectID, page.ShotID, UpdateDramaShotRequest{Dialogue: &human}); err != nil {
		t.Fatal(err)
	}
	_, err = applyCloudAgentDramaShotUpdate(s.repo, "user", page, call, s)
	var appErr *AppError
	if !errors.As(err, &appErr) || appErr.Reason != "drama_shot_revision_conflict" {
		t.Fatalf("expected explicit revision conflict, got %v", err)
	}
	shot, _ = s.repo.DramaShot(page.ProjectID, page.ShotID)
	if shot.Dialogue != human {
		t.Fatal("old approval overwrote a human edit")
	}
}

func TestCloudAgentDramaPageUpdateValidationAndRollback(t *testing.T) {
	s, _, page := cloudAgentDramaPageFixture(t)
	for _, fields := range []map[string]any{{}, {"action": strings.Repeat("长", 1001)}, {"durationSeconds": 61}, {"transition": "unsupported"}, {"videoResourceId": "forged-resource"}} {
		call := cloudAgentStoryboardCall(t, agenttool.DramaShotUpdate, "invalid-edit", map[string]any{"expectedRevision": 7, "fields": fields})
		if _, err := cloudAgentPreviewDramaShotUpdate(s.repo, "user", page, call, s); err == nil {
			t.Fatalf("invalid fields accepted: %+v", fields)
		}
	}
	for _, target := range []struct {
		userID string
		args   map[string]any
	}{
		{"other", map[string]any{}},
		{"user", map[string]any{"shotId": "next-shot"}},
		{"user", map[string]any{"episodeId": "other-episode", "shotId": "other-shot"}},
		{"user", map[string]any{"episodeId": "foreign-episode", "shotId": "foreign-shot"}},
	} {
		target.args["expectedRevision"], target.args["fields"] = 7, map[string]any{"dialogue": "不得写入"}
		call := cloudAgentStoryboardCall(t, agenttool.DramaShotUpdate, "invalid-edit-target", target.args)
		if _, err := cloudAgentPreviewDramaShotUpdate(s.repo, target.userID, page, call, s); err == nil {
			t.Fatalf("preview escaped frozen context: %+v", target)
		}
		if _, err := applyCloudAgentDramaShotUpdate(s.repo, target.userID, page, call, s); err == nil {
			t.Fatalf("write escaped frozen context: %+v", target)
		}
	}
	call := cloudAgentStoryboardCall(t, agenttool.DramaShotUpdate, "rollback-edit", map[string]any{"expectedRevision": 7, "fields": map[string]any{"dialogue": "should roll back"}})
	failure := errors.New("checkpoint cannot commit")
	err := s.repo.Transaction(func(tx *repository.Repository) error {
		if _, err := applyCloudAgentDramaShotUpdate(tx, "user", page, call, s); err != nil {
			return err
		}
		return failure
	})
	if !errors.Is(err, failure) {
		t.Fatal(err)
	}
	shot, _ := s.repo.DramaShot(page.ProjectID, page.ShotID)
	episode, _ := s.repo.DramaEpisode(page.ProjectID, page.EpisodeID)
	if shot.Dialogue != "你来了" || episode.Revision != 7 {
		t.Fatal("failed checkpoint left a partial shot mutation")
	}
}

func TestCloudAgentDramaPageAutoRunStillApprovesAndCommitsOnce(t *testing.T) {
	s, _, page := cloudAgentDramaPageFixture(t)
	root, err := s.CreateCloudAgentRun("user", cloudAgentDramaPageRequest(page, "page-approval-run", "auto"), "")
	if err != nil {
		t.Fatal(err)
	}
	run, _ := s.repo.CloudAgent("user", root.ID)
	state, _ := cloudAgentDecode(run)
	state.ActiveTaskID = ""
	state.Calls = []cloudAgentCall{cloudAgentStoryboardCall(t, agenttool.DramaShotUpdate, "runtime-shot-call", map[string]any{"expectedRevision": 7, "fields": map[string]any{"dialogue": "已审批版本"}})}
	state.CallIndex = 0
	if err := s.repo.MutateCloudAgent("user", run.ID, run.Revision, func(current *model.CloudAgentExecution, _ *repository.Repository) error {
		current.Status = "running"
		return cloudAgentSave(current, &state)
	}); err != nil {
		t.Fatal(err)
	}
	run, _ = s.repo.CloudAgent("user", root.ID)
	if err := s.advanceCloudAgentTool(run, &state); err != nil {
		t.Fatal(err)
	}
	run, _ = s.repo.CloudAgent("user", root.ID)
	state, _ = cloudAgentDecode(run)
	shot, _ := s.repo.DramaShot(page.ProjectID, page.ShotID)
	if run.Status != "waiting_approval" || state.Approval == nil || shot.Dialogue != "你来了" {
		t.Fatalf("auto mode skipped approval: %s %+v %+v", run.Status, state.Approval, shot)
	}
	approvalID := state.Approval.ID
	if err := s.DecideCloudAgentApproval("user", run.ID, approvalID, "approve", ""); err != nil {
		t.Fatal(err)
	}
	shot, _ = s.repo.DramaShot(page.ProjectID, page.ShotID)
	episode, _ := s.repo.DramaEpisode(page.ProjectID, page.EpisodeID)
	if shot.Dialogue != "已审批版本" || episode.Revision != 8 {
		t.Fatalf("approved write did not apply once: %+v %+v", shot, episode)
	}
	if err := s.DecideCloudAgentApproval("user", run.ID, approvalID, "approve", ""); err != nil {
		t.Fatal(err)
	}
	after, _ := s.repo.DramaEpisode(page.ProjectID, page.EpisodeID)
	if after.Revision != episode.Revision {
		t.Fatal("duplicate approval applied the write twice")
	}
	stored, _ := s.repo.CloudAgent("user", run.ID)
	state, _ = cloudAgentDecode(stored)
	found := false
	for _, event := range state.Events {
		if event.Type == "tool_completed" && event.Payload["toolName"] == agenttool.DramaShotUpdate {
			encoded, _ := json.Marshal(event.Payload["result"])
			found = strings.Contains(string(encoded), `"shotId":"page-shot"`) && strings.Contains(string(encoded), `"projectId":"page-project"`)
		}
	}
	if !found {
		t.Fatal("write committed without a matching tool receipt")
	}
}
