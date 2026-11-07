package app

import (
	"context"
	"encoding/json"
	"strings"
	"testing"

	"gorm.io/gorm"
	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"
)

// agentMediaBatchFixture 在媒体测试画布上加两个视频占位节点，各自连一张已就绪的参考图。
func agentMediaBatchFixture(t *testing.T, extraNodes ...map[string]any) (*Service, *gorm.DB) {
	t.Helper()
	s, db, _ := agentMediaFixture(t)
	s.disablePiRuntime = true
	// 执行器由测试逐步推进，避免后台 goroutine 与断言抢同一份检查点。
	s.approvedMediaMu.Lock()
	s.approvedMediaClosed = true
	s.approvedMediaMu.Unlock()
	project, err := s.repo.CanvasProjectForUser("user", "agent-canvas")
	if err != nil {
		t.Fatal(err)
	}
	doc, err := creationDocument(project.PayloadJSON)
	if err != nil {
		t.Fatal(err)
	}
	video, _ := cloudAgentNodeCapabilityForType("video")
	nodes := creationMaps(doc["nodes"])
	nodes = append(nodes,
		map[string]any{"id": "v1", "type": "video", "title": "S01 视频", "position": map[string]any{"x": 900, "y": 10}, "width": 400, "height": 225, "metadata": video.Metadata("英雄在雨夜转身")},
		map[string]any{"id": "v2", "type": "video", "title": "S02 视频", "position": map[string]any{"x": 900, "y": 300}, "width": 400, "height": 225, "metadata": video.Metadata("叮当猫飞过屋顶")},
	)
	nodes = append(nodes, extraNodes...)
	doc["nodes"] = nodes
	doc["connections"] = []any{
		map[string]any{"id": "e1", "fromNodeId": "hero", "toNodeId": "v1"},
		map[string]any{"id": "e2", "fromNodeId": "cat", "toNodeId": "v2"},
	}
	raw, _ := json.Marshal(doc)
	if err := db.Model(&model.CanvasProject{}).Where("id = ?", "agent-canvas").Update("payload_json", string(raw)).Error; err != nil {
		t.Fatal(err)
	}
	return s, db
}

func agentMediaBatchRun(t *testing.T, s *Service, args map[string]any, maxGenerations int) (*model.CloudAgentExecution, cloudAgentRuntime) {
	t.Helper()
	req := agentTestRequest()
	req.PermissionMode = "auto"
	req.Budget.MaxGenerationTasks = maxGenerations
	req.Budget.MaxVideoSeconds = 60
	root, err := s.CreateCloudAgentRun("user", req, "")
	if err != nil {
		t.Fatal(err)
	}
	run, err := s.repo.CloudAgent("user", root.ID)
	if err != nil {
		t.Fatal(err)
	}
	state, err := cloudAgentDecode(run)
	if err != nil {
		t.Fatal(err)
	}
	raw, _ := json.Marshal(args)
	call := cloudAgentCall{ID: "batch-call"}
	call.Function.Name, call.Function.Arguments = "generate_media_batch", string(raw)
	state.ActiveTaskID = ""
	state.Calls = []cloudAgentCall{call}
	if err = s.repo.MutateCloudAgent("user", run.ID, run.Revision, func(current *model.CloudAgentExecution, _ *repository.Repository) error {
		return cloudAgentSave(current, &state)
	}); err != nil {
		t.Fatal(err)
	}
	run, _ = s.repo.CloudAgent("user", run.ID)
	state, _ = cloudAgentDecode(run)
	return run, state
}

func agentMediaBatchArgs(items ...string) map[string]any {
	entries := []map[string]any{}
	for _, id := range items {
		entries = append(entries, map[string]any{"nodeId": id})
	}
	return map[string]any{"mode": "video", "channelId": "channel", "channelModelKey": "seedance-test", "durationSeconds": 12, "size": "9:16", "videoGenerateAudio": true, "concurrency": 2, "maxRetriesPerItem": 0, "items": entries}
}

func agentMediaBatchState(t *testing.T, s *Service, runID string) (*model.CloudAgentExecution, cloudAgentRuntime) {
	t.Helper()
	run, err := s.repo.CloudAgent("user", runID)
	if err != nil {
		t.Fatal(err)
	}
	state, err := cloudAgentDecode(run)
	if err != nil {
		t.Fatal(err)
	}
	return run, state
}

func agentCanvasNode(t *testing.T, s *Service, id string) map[string]any {
	t.Helper()
	project, err := s.repo.CanvasProjectForUser("user", "agent-canvas")
	if err != nil {
		t.Fatal(err)
	}
	doc, _ := creationDocument(project.PayloadJSON)
	return cloudAgentNodeByID(creationMaps(doc["nodes"]), id)
}

func TestCloudAgentMediaBatchOneApprovalSubmitsInParallelAndWritesBack(t *testing.T) {
	s, db := agentMediaBatchFixture(t)
	run, state := agentMediaBatchRun(t, s, agentMediaBatchArgs("v1", "v2"), 4)
	if err := s.advanceCloudAgentTool(run, &state); err != nil {
		t.Fatal(err)
	}
	var tasks int64
	db.Model(&model.Task{}).Where("type = ?", "canvas_video").Count(&tasks)
	if tasks != 0 {
		t.Fatal("batch submitted tasks before approval")
	}
	waiting, err := s.CloudAgentRun("user", run.ID)
	if err != nil || waiting.Status != "waiting_approval" || waiting.Approval == nil {
		t.Fatalf("batch should wait for one approval: status=%v err=%v", waiting.Status, err)
	}
	if waiting.Approval.Preview.Kind != "media_batch" || len(waiting.Approval.Preview.Items) != 2 {
		t.Fatalf("approval must list every item: %#v", waiting.Approval.Preview)
	}
	if meta, _ := agentCanvasNode(t, s, "v1")["metadata"].(map[string]any); meta["agentDraftRunId"] != run.ID {
		t.Fatalf("draft not prepared on placeholder: %#v", meta)
	}

	if err := s.DecideCloudAgentApproval("user", run.ID, waiting.Approval.ID, "approve", ""); err != nil {
		t.Fatal(err)
	}
	ctx := context.Background()
	for step := 0; step < 2; step++ {
		if _, err := s.stepCloudAgentMediaBatch(ctx, "user", run.ID); err != nil {
			t.Fatal(err)
		}
	}
	db.Model(&model.Task{}).Where("type = ?", "canvas_video").Count(&tasks)
	if tasks != 2 {
		t.Fatalf("expected both items submitted under one approval, got %d tasks", tasks)
	}
	_, state = agentMediaBatchState(t, s, run.ID)
	if state.Generations != 2 || state.MediaBatch.inFlight() != 2 {
		t.Fatalf("batch counters wrong: generations=%d inFlight=%d", state.Generations, state.MediaBatch.inFlight())
	}
	if meta, _ := agentCanvasNode(t, s, "v2")["metadata"].(map[string]any); meta["taskId"] == nil || meta["taskId"] == "" {
		t.Fatalf("submitted task not bound to its node: %#v", meta)
	}

	if err := db.Model(&model.Task{}).Where("type = ?", "canvas_video").Updates(map[string]any{"status": model.TaskStatusFailed, "error": "上游超时"}).Error; err != nil {
		t.Fatal(err)
	}
	done := false
	for step := 0; step < 6 && !done; step++ {
		if done, err = s.stepCloudAgentMediaBatch(ctx, "user", run.ID); err != nil {
			t.Fatal(err)
		}
	}
	if !done {
		t.Fatal("batch did not finish after all tasks ended")
	}
	_, state = agentMediaBatchState(t, s, run.ID)
	if state.MediaBatch.Phase != cloudAgentMediaBatchPhaseDone || state.CallIndex != 1 {
		t.Fatalf("batch phase/call cursor wrong: phase=%s callIndex=%d", state.MediaBatch.Phase, state.CallIndex)
	}
	receipt, ok := cloudAgentToolMessage(&state, "batch-call")
	if !ok || !strings.Contains(receipt, "批次完成") || !strings.Contains(receipt, "失败") {
		t.Fatalf("batch receipt missing: %s", receipt)
	}
	if !strings.Contains(state.PiResumePrompt, "批次已结束") {
		t.Fatalf("resume prompt must hand the receipt back to the agent: %q", state.PiResumePrompt)
	}
}

func TestCloudAgentMediaBatchRejectsBusyNodeAsCorrectableArgument(t *testing.T) {
	s, _ := agentMediaBatchFixture(t, map[string]any{"id": "busy", "type": "video", "title": "已在生成", "position": map[string]any{"x": 1400, "y": 10}, "metadata": map[string]any{"status": "loading", "taskId": "other-task", "prompt": "x"}})
	run, state := agentMediaBatchRun(t, s, agentMediaBatchArgs("v1", "busy"), 4)
	if err := s.advanceCloudAgentTool(run, &state); err != nil {
		t.Fatal(err)
	}
	run, state = agentMediaBatchState(t, s, run.ID)
	if run.Status != "running" || state.MediaBatch != nil {
		t.Fatalf("a busy node must not fail the run or open a batch: status=%s batch=%v", run.Status, state.MediaBatch)
	}
	receipt, ok := cloudAgentToolMessage(&state, "batch-call")
	if !ok || !strings.Contains(receipt, "items[1].nodeId") {
		t.Fatalf("model should be told which item to drop: %s", receipt)
	}
}

func TestCloudAgentMediaBatchRespectsGenerationBudget(t *testing.T) {
	s, db := agentMediaBatchFixture(t)
	run, state := agentMediaBatchRun(t, s, agentMediaBatchArgs("v1", "v2"), 1)
	if err := s.advanceCloudAgentTool(run, &state); err != nil {
		t.Fatal(err)
	}
	run, state = agentMediaBatchState(t, s, run.ID)
	if run.Status != "running" || state.Approval != nil {
		t.Fatalf("over-budget batch must not reach approval: status=%s", run.Status)
	}
	receipt, _ := cloudAgentToolMessage(&state, "batch-call")
	if !strings.Contains(receipt, "最多还能生成 1 条") {
		t.Fatalf("budget reason missing: %s", receipt)
	}
	var tasks int64
	db.Model(&model.Task{}).Where("type = ?", "canvas_video").Count(&tasks)
	if tasks != 0 {
		t.Fatal("over-budget batch created tasks")
	}
}

func TestCloudAgentPreflightReportsMissingPromptAndBlockedNodes(t *testing.T) {
	s, _ := agentMediaBatchFixture(t, map[string]any{"id": "empty", "type": "video", "title": "空提示词", "position": map[string]any{"x": 1400, "y": 300}, "metadata": map[string]any{"status": "idle"}})
	_, state := agentMediaBatchRun(t, s, agentMediaBatchArgs("v1"), 4)
	call := cloudAgentCall{ID: "preflight"}
	raw, _ := json.Marshal(map[string]any{"mode": "video", "items": []map[string]any{{"nodeId": "v1"}, {"nodeId": "empty"}}})
	call.Function.Name, call.Function.Arguments = "canvas_preflight", string(raw)
	result, err := cloudAgentHandleCanvasPreflight(s.repo, "user", &state, call, s)
	if err != nil {
		t.Fatal(err)
	}
	report := result.(map[string]any)
	if report["failed"] != 1 || report["ok"] != false {
		t.Fatalf("preflight should fail only the empty node: %#v", report)
	}
	if !strings.Contains(stringValue(report["summary"]), "1 失败") {
		t.Fatalf("summary should count failures: %v", report["summary"])
	}
}

func TestCloudAgentBuildBoardCreatesGroupedPlaceholdersAndBindings(t *testing.T) {
	s, db, _ := agentMediaFixture(t)
	rows := []any{
		map[string]any{"id": "r1", "durationSeconds": float64(4), "imageGenerationPrompt": "雪夜院门", "videoMotionPrompt": "门缓缓推开"},
		map[string]any{"id": "r2", "durationSeconds": float64(4), "plotDescription": "老者磨墨"},
		map[string]any{"id": "r3", "durationSeconds": float64(4), "imageGenerationPrompt": "书童打盹", "videoMotionPrompt": "灯火摇曳"},
	}
	doc := map[string]any{"nodes": []any{
		map[string]any{"id": "sb", "type": "script", "title": "古装测试", "position": map[string]any{"x": 0, "y": 0}, "width": 920, "height": 360, "metadata": map[string]any{"status": "idle", "workflowKind": "script", "storyboard": map[string]any{"rows": rows, "visibleColumns": []any{}, "referenceNodeIds": []any{}}}},
	}, "connections": []any{}}
	raw, _ := json.Marshal(doc)
	if err := db.Model(&model.CanvasProject{}).Where("id = ?", "agent-canvas").Update("payload_json", string(raw)).Error; err != nil {
		t.Fatal(err)
	}
	project, _ := s.repo.CanvasProjectForUser("user", "agent-canvas")
	current, _ := creationDocument(project.PayloadJSON)
	args := map[string]any{
		"snapshotHash": cloudAgentCanvasHash(current), "storyboardNodeId": "sb", "overview": "# 目标\n三镜头试片",
		"assets": []map[string]any{{"id": "a-old", "category": "character", "title": "老者", "prompt": "白发老者", "rowIds": []string{"r2"}}},
		"acts":   []map[string]any{{"label": "第一幕", "rowIds": []string{"r1", "r2"}}},
	}
	encoded, _ := json.Marshal(args)
	call := cloudAgentCall{ID: "board-call"}
	call.Function.Name, call.Function.Arguments = "canvas_build_board", string(encoded)
	policy, err := s.RuntimePolicy()
	if err != nil {
		t.Fatal(err)
	}
	result, err := applyCloudAgentBuildBoard(s.repo, "user", "agent-canvas", call, policy)
	if err != nil {
		t.Fatal(err)
	}
	counts := result.(map[string]any)["counts"].(map[string]int)
	if counts["keyframes"] != 3 || counts["videos"] != 3 || counts["assets"] != 1 || counts["overview"] != 1 {
		t.Fatalf("board did not create every placeholder: %#v", counts)
	}
	project, _ = s.repo.CanvasProjectForUser("user", "agent-canvas")
	after, _ := creationDocument(project.PayloadJSON)
	nodes := creationMaps(after["nodes"])
	framed := 0
	for _, node := range nodes {
		if stringValue(node["parentId"]) != "" {
			framed++
		}
	}
	if framed < 5 {
		t.Fatalf("act and asset placeholders should live in frames, got %d children", framed)
	}
	storyboard := cloudAgentNodeByID(nodes, "sb")
	table := storyboard["metadata"].(map[string]any)["storyboard"].(map[string]any)
	for _, row := range creationMaps(table["rows"]) {
		if stringValue(row["imageNodeId"]) == "" || stringValue(row["videoNodeId"]) == "" {
			t.Fatalf("row outputs not bound: %#v", row)
		}
	}
	// 第二次调用只补缺失内容，不重复建节点。
	args["snapshotHash"] = cloudAgentCanvasHash(after)
	encoded, _ = json.Marshal(args)
	call.Function.Arguments = string(encoded)
	again, err := applyCloudAgentBuildBoard(s.repo, "user", "agent-canvas", call, policy)
	if err != nil {
		t.Fatal(err)
	}
	if summary := stringValue(again.(map[string]any)["summary"]); !strings.Contains(summary, "没有新增") {
		t.Fatalf("rebuilding an existing board must be a no-op: %s", summary)
	}
}

func TestCloudAgentMediaBatchApprovalEditsRefreshQuoteAndSubmittedTasks(t *testing.T) {
	for _, overrideDuration := range []bool{false, true} {
		t.Run(map[bool]string{false: "preserve_item_durations", true: "replace_all_durations"}[overrideDuration], func(t *testing.T) {
			s, db := agentMediaBatchFixture(t)
			var alternative model.ChannelModel
			if err := db.First(&alternative, "id = ?", "video-cm").Error; err != nil {
				t.Fatal(err)
			}
			alternative.ID, alternative.ModelKey, alternative.DisplayName = "video-alternative", "seedance-alternative", "替代视频模型"
			if err := db.Create(&alternative).Error; err != nil {
				t.Fatal(err)
			}
			if err := db.Create(&model.ChannelModelPriceTier{ID: "alternative-tier", ChannelModelID: alternative.ID, SelectorKey: "{}", SelectorJSON: "{}", BillingMode: "per_second", UnitPriceMicrocredits: 2, PriceConfigured: true, Enabled: true}).Error; err != nil {
				t.Fatal(err)
			}
			args := agentMediaBatchArgs("v1", "v2")
			args["items"].([]map[string]any)[1]["durationSeconds"] = 6
			args["maxRetriesPerItem"], args["canary"] = 1, true
			run, state := agentMediaBatchRun(t, s, args, 4)
			if err := s.advanceCloudAgentTool(run, &state); err != nil {
				t.Fatal(err)
			}
			_, before := agentMediaBatchState(t, s, run.ID)
			id := before.Approval.ID
			audio, watermark, seconds := false, false, 8
			settings := CloudAgentMediaSettings{ChannelID: "channel", ChannelModelKey: alternative.ModelKey, Size: "9:16", VideoGenerateAudio: &audio, VideoWatermark: &watermark}
			if overrideDuration {
				settings.DurationSeconds = &seconds
			}
			if err := s.DecideCloudAgentApproval("user", run.ID, id, "approve", "", &settings); err != nil {
				t.Fatal(err)
			}
			_, edited := agentMediaBatchState(t, s, run.ID)
			if edited.MediaBatch.ModelName != alternative.DisplayName || edited.MediaBatch.Concurrency != 2 || !edited.MediaBatch.Canary || edited.MediaBatch.MaxRetries != 1 || edited.MediaBatch.ID != before.MediaBatch.ID {
				t.Fatalf("batch identity/settings were lost: %+v", edited.MediaBatch)
			}
			var sum int64
			for index, item := range edited.MediaBatch.Items {
				wantDuration := []int{12, 6}[index]
				if overrideDuration {
					wantDuration = seconds
				}
				var stored, previous cloudAgentMediaArgs
				_ = json.Unmarshal([]byte(item.Arguments), &stored)
				_ = json.Unmarshal([]byte(before.MediaBatch.Items[index].Arguments), &previous)
				if stored.ChannelModelKey != alternative.ModelKey || stored.Duration != wantDuration || item.Duration != wantDuration || stored.Prompt != previous.Prompt || creationHash(stored.ReferenceNodeIDs) != creationHash(previous.ReferenceNodeIDs) || item.NodeID != previous.NodeID {
					t.Fatalf("edited item lost approved intent: %+v", stored)
				}
				if item.Amount != int64(wantDuration*2) || item.SpecHash == before.MediaBatch.Items[index].SpecHash || item.ResolvedHash == before.MediaBatch.Items[index].ResolvedHash {
					t.Fatalf("quote/hashes were not refreshed: %+v", item)
				}
				sum += item.Amount
			}
			if edited.MediaBatch.CapMicrocredits != sum*2 || !strings.Contains(edited.Approval.Preview.Description, alternative.DisplayName) || edited.Approval.CallHash == before.Approval.CallHash {
				t.Fatalf("approval preview/cap/hash not refreshed: %+v", edited.Approval)
			}
			if err := s.DecideCloudAgentApproval("user", run.ID, id, "approve", "", &settings); err != nil {
				t.Fatal(err)
			}
			changed := settings
			changed.Size = "16:9"
			if err := s.DecideCloudAgentApproval("user", run.ID, id, "approve", "", &changed); err == nil {
				t.Fatal("conflicting approval retry accepted")
			}
			var count int64
			db.Model(&model.Task{}).Where("type = ?", "canvas_video").Count(&count)
			if count != 0 {
				t.Fatal("editing approval submitted a task before the batch executor")
			}
			// Submit each approved item directly to verify the persisted contract,
			// while keeping the canary/concurrency controls unchanged above.
			policy, err := s.RuntimePolicy()
			if err != nil {
				t.Fatal(err)
			}
			for index := range edited.MediaBatch.Items {
				current, latest := agentMediaBatchState(t, s, run.ID)
				if err := s.submitCloudAgentMediaBatchItem(current, &latest, index, policy); err != nil {
					t.Fatal(err)
				}
			}
			_, submitted := agentMediaBatchState(t, s, run.ID)
			for index, item := range submitted.MediaBatch.Items {
				task, err := s.repo.TaskForUser("user", item.taskID())
				if err != nil {
					t.Fatalf("task missing: %v; item=%+v", err, item)
				}
				var input canvasGenerationInput
				if err := json.Unmarshal([]byte(task.InputJSON), &input); err != nil {
					t.Fatal(err)
				}
				wantDuration := []string{"12", "6"}[index]
				if overrideDuration {
					wantDuration = "8"
				}
				if input.Config.Model != alternative.ModelKey || input.Config.VideoSeconds != wantDuration || input.Config.VideoGenerateAudio != "false" || input.Config.VideoWatermark != "false" || len(input.ReferenceImages) != 1 {
					t.Fatalf("task did not retain edited batch settings: %+v", input.Config)
				}
			}
		})
	}
}

func TestCloudAgentMediaBatchApprovalInvalidEditsRemainPending(t *testing.T) {
	s, db := agentMediaBatchFixture(t)
	run, state := agentMediaBatchRun(t, s, agentMediaBatchArgs("v1", "v2"), 4)
	if err := s.advanceCloudAgentTool(run, &state); err != nil {
		t.Fatal(err)
	}
	_, before := agentMediaBatchState(t, s, run.ID)
	var beforeOrders int64
	db.Model(&model.BillingOrder{}).Count(&beforeOrders)
	settings := CloudAgentMediaSettings{ChannelID: "channel", ChannelModelKey: "seedance-test", Size: "9:16"}
	negative := -1
	invalid := []CloudAgentMediaSettings{
		{ChannelID: "channel", ChannelModelKey: "missing", Size: "9:16"},
		{LogicalModelID: "mixed", ChannelID: "channel", ChannelModelKey: "seedance-test", Size: "9:16"},
		{ChannelID: "channel", ChannelModelKey: "seedance-test", Size: "invalid-size"},
		{ChannelID: "channel", ChannelModelKey: "seedance-test", DurationSeconds: &negative},
	}
	for _, edit := range invalid {
		if err := s.DecideCloudAgentApproval("user", run.ID, before.Approval.ID, "approve", "", &edit); err == nil {
			t.Fatalf("invalid settings accepted: %+v", edit)
		}
	}
	if err := s.DecideCloudAgentApproval("other", run.ID, before.Approval.ID, "approve", "", &settings); err == nil {
		t.Fatal("cross-user batch approval accepted")
	}
	current, after := agentMediaBatchState(t, s, run.ID)
	if current.Status != "waiting_approval" || creationHash(after.MediaBatch) != creationHash(before.MediaBatch) || after.Approval.CallHash != before.Approval.CallHash {
		t.Fatal("invalid edit changed the pending approval")
	}
	var count int64
	db.Model(&model.Task{}).Where("type = ?", "canvas_video").Count(&count)
	if count != 0 {
		t.Fatal("invalid approval created generation tasks")
	}
	db.Model(&model.BillingOrder{}).Count(&count)
	if count != beforeOrders {
		t.Fatal("invalid approval created billing orders")
	}
}

func TestCloudAgentMediaBatchImageApprovalEditsApplyToEveryTask(t *testing.T) {
	image, _ := cloudAgentNodeCapabilityForType("image")
	s, db := agentMediaBatchFixture(t,
		map[string]any{"id": "i1", "type": "image", "title": "图片一", "metadata": image.Metadata("雨夜街道")},
		map[string]any{"id": "i2", "type": "image", "title": "图片二", "metadata": image.Metadata("屋顶")},
	)
	capability := DefaultModelCapabilityConfigForModel(string(model.ChannelInterfaceGrokImage), "grok-image")
	for _, key := range []string{"grok-image", "grok-image-alternative"} {
		for _, row := range []any{
			&model.ChannelModel{ID: key, ChannelID: "channel", ModelKey: key, DisplayName: key, Capability: "image", Protocol: model.ChannelInterfaceGrokImage, CapabilityConfigJSON: mustEncodeModelCapabilityConfig(t, capability), BillingMode: "fixed_request", PriceConfigured: true, Enabled: true},
			&model.ChannelModelPriceTier{ID: key + "-tier", ChannelModelID: key, SelectorKey: "{}", SelectorJSON: "{}", BillingMode: "fixed_request", UnitPriceMicrocredits: 1, PriceConfigured: true, Enabled: true},
		} {
			if err := db.Create(row).Error; err != nil {
				t.Fatal(err)
			}
		}
	}
	args := map[string]any{"mode": "image", "channelId": "channel", "channelModelKey": "grok-image", "size": "1:1", "imageResolution": "2k", "items": []map[string]any{{"nodeId": "i1"}, {"nodeId": "i2"}}}
	run, state := agentMediaBatchRun(t, s, args, 4)
	if err := s.advanceCloudAgentTool(run, &state); err != nil {
		t.Fatal(err)
	}
	_, before := agentMediaBatchState(t, s, run.ID)
	if before.Approval == nil {
		t.Fatalf("image batch did not reach approval: %+v", before.Events)
	}
	settings := CloudAgentMediaSettings{ChannelID: "channel", ChannelModelKey: "grok-image-alternative", Size: "16:9", ImageResolution: "1k"}
	invalid := settings
	seconds := 8
	invalid.DurationSeconds = &seconds
	if err := s.DecideCloudAgentApproval("user", run.ID, before.Approval.ID, "approve", "", &invalid); err == nil {
		t.Fatal("image batch accepted video settings")
	}
	if err := s.DecideCloudAgentApproval("user", run.ID, before.Approval.ID, "approve", "", &settings); err != nil {
		t.Fatal(err)
	}
	for step := 0; step < 2; step++ {
		if _, err := s.stepCloudAgentMediaBatch(context.Background(), "user", run.ID); err != nil {
			t.Fatal(err)
		}
	}
	_, submitted := agentMediaBatchState(t, s, run.ID)
	for _, item := range submitted.MediaBatch.Items {
		task, err := s.repo.TaskForUser("user", item.taskID())
		if err != nil {
			t.Fatalf("image task missing: %v; item=%+v", err, item)
		}
		var input canvasGenerationInput
		if err := json.Unmarshal([]byte(task.InputJSON), &input); err != nil {
			t.Fatal(err)
		}
		if input.Config.Model != settings.ChannelModelKey || input.Config.Size != settings.Size || input.Config.ImageResolution != settings.ImageResolution {
			t.Fatalf("image task did not retain approved settings: %+v", input.Config)
		}
	}
}

func TestCloudAgentMediaBatchApprovalEditRevalidatesEntireBatch(t *testing.T) {
	for _, scenario := range []string{"generation_budget", "duration_budget", "credit_budget", "second_item_reference"} {
		t.Run(scenario, func(t *testing.T) {
			s, db := agentMediaBatchFixture(t)
			run, state := agentMediaBatchRun(t, s, agentMediaBatchArgs("v1", "v2"), 4)
			if err := s.advanceCloudAgentTool(run, &state); err != nil {
				t.Fatal(err)
			}
			run, state = agentMediaBatchState(t, s, run.ID)
			switch scenario {
			case "generation_budget":
				state.Request.Budget.MaxGenerationTasks = 1
			case "duration_budget":
				state.Request.Budget.MaxVideoSeconds = 15
			case "credit_budget":
				state.Request.Budget.MaxCredits = 15 / float64(CreditScale)
			case "second_item_reference":
				if err := db.Model(&model.Resource{}).Where("id = ?", "ref-one").Update("user_id", "other").Error; err != nil {
					t.Fatal(err)
				}
			}
			if err := s.repo.MutateCloudAgent("user", run.ID, run.Revision, func(current *model.CloudAgentExecution, _ *repository.Repository) error {
				return cloudAgentSave(current, &state)
			}); err != nil {
				t.Fatal(err)
			}
			_, before := agentMediaBatchState(t, s, run.ID)
			var beforeOrders int64
			db.Model(&model.BillingOrder{}).Count(&beforeOrders)
			seconds := 8
			settings := CloudAgentMediaSettings{ChannelID: "channel", ChannelModelKey: "seedance-test", Size: "9:16", DurationSeconds: &seconds}
			if err := s.DecideCloudAgentApproval("user", run.ID, before.Approval.ID, "approve", "", &settings); err == nil {
				t.Fatal("invalid whole-batch admission accepted")
			}
			current, after := agentMediaBatchState(t, s, run.ID)
			if current.Status != "waiting_approval" || creationHash(after.MediaBatch) != creationHash(before.MediaBatch) || after.Approval.CallHash != before.Approval.CallHash {
				t.Fatal("failed whole-batch admission partially persisted")
			}
			var count int64
			db.Model(&model.BillingOrder{}).Count(&count)
			if count != beforeOrders {
				t.Fatal("failed whole-batch admission created billing orders")
			}
			db.Model(&model.Task{}).Where("type = ?", "canvas_video").Count(&count)
			if count != 0 {
				t.Fatal("failed whole-batch admission submitted tasks")
			}
		})
	}
}
