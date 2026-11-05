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
