package app

import (
	"context"
	"encoding/json"
	"strings"
	"testing"

	"gorm.io/gorm"
	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/repository"
)

func agentMediaFixture(t *testing.T) (*Service, *gorm.DB, cloudAgentMediaArgs) {
	t.Helper()
	s, db, _, _ := creationTestService(t)
	capability := DefaultModelCapabilityConfigForModel(string(model.ChannelInterfaceVolcengineArkVideo), "seedance-test")
	capability.Video.References.PromptMaxChars = 16000
	for _, row := range []any{
		&model.ChannelModel{ID: "video-cm", ChannelID: "channel", ModelKey: "seedance-test", DisplayName: "视频测试", Capability: "video", Protocol: model.ChannelInterfaceVolcengineArkVideo, CapabilityConfigJSON: mustEncodeModelCapabilityConfig(t, capability), BillingMode: "per_second", PriceConfigured: true, Enabled: true},
		&model.ChannelModelPriceTier{ID: "video-tier", ChannelModelID: "video-cm", SelectorKey: "{}", SelectorJSON: "{}", BillingMode: "per_second", UnitPriceMicrocredits: 1, PriceConfigured: true, Enabled: true},
		&model.Resource{ID: "ref-one", UserID: "user", Kind: "image", Status: "ready", MimeType: "image/png", Width: 640, Height: 480, Size: 50},
		&model.Resource{ID: "ref-two", UserID: "user", Kind: "image", Status: "ready", MimeType: "image/png", Width: 640, Height: 480, Size: 50},
		&model.Resource{ID: "private", UserID: "other", Kind: "image", Status: "ready", MimeType: "image/png"},
	} {
		if err := db.Create(row).Error; err != nil {
			t.Fatal(err)
		}
	}
	doc := map[string]any{"nodes": []map[string]any{
		{"id": "shot-1", "type": "text", "title": "镜头1", "position": map[string]any{"x": 10, "y": 10}, "width": 300, "metadata": map[string]any{"content": strings.Repeat("镜头完整指令", 500)}},
		{"id": "cat", "type": "image", "title": "叮当猫在飞", "position": map[string]any{"x": 10, "y": 300}, "width": 300, "metadata": map[string]any{"status": "success", "storageKey": "resource:ref-one", "content": "https://must-not-expose.invalid/one.png"}},
		{"id": "hero", "type": "image", "title": "古风奥特曼", "position": map[string]any{"x": 400, "y": 300}, "width": 300, "metadata": map[string]any{"status": "success", "storageKey": "resource:ref-two"}},
	}, "connections": []any{}}
	raw, _ := json.Marshal(doc)
	if err := db.Create(&model.CanvasProject{ID: "agent-canvas", UserID: "user", PayloadJSON: string(raw)}).Error; err != nil {
		t.Fatal(err)
	}
	audio := true
	a := cloudAgentMediaArgs{Mode: "video", Prompt: "镜头1，参考图1是英雄，参考图2是叮当猫", ChannelID: "channel", ChannelModelKey: "seedance-test", Duration: 12, Size: "9:16", VideoGenerateAudio: &audio, SnapshotHash: creationHash(doc), NodeID: "video-shot-1", Title: "镜头1视频", SourceNodeID: "shot-1", ReferenceNodeIDs: []string{"hero", "cat"}}
	return s, db, a
}

func agentMediaCall(a cloudAgentMediaArgs) cloudAgentCall {
	raw, _ := json.Marshal(a)
	call := cloudAgentCall{ID: "media-call"}
	call.Function.Name, call.Function.Arguments = "generate_media", string(raw)
	return call
}

func agentMediaRun(t *testing.T, s *Service, a cloudAgentMediaArgs, permission string, idempotencyKeys ...string) (*model.CloudAgentExecution, cloudAgentRuntime) {
	t.Helper()
	req := agentTestRequest()
	if len(idempotencyKeys) > 0 {
		req.IdempotencyKey = idempotencyKeys[0]
	}
	req.PermissionMode = permission
	req.Budget.MaxGenerationTasks = 2
	req.Budget.MaxVideoSeconds = 24
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
	state.ActiveTaskID = ""
	state.Calls = []cloudAgentCall{agentMediaCall(a)}
	if err = s.repo.MutateCloudAgent("user", run.ID, run.Revision, func(current *model.CloudAgentExecution, _ *repository.Repository) error {
		return cloudAgentSave(current, &state)
	}); err != nil {
		t.Fatal(err)
	}
	run, _ = s.repo.CloudAgent("user", run.ID)
	return run, state
}

func approveAgentMediaDraft(t *testing.T, s *Service, runID string) {
	t.Helper()
	run, err := s.CloudAgentRun("user", runID)
	if err != nil {
		t.Fatal(err)
	}
	if run.Status != "waiting_approval" || run.Approval == nil {
		stored, loadErr := s.repo.CloudAgent("user", runID)
		state, decodeErr := cloudAgentDecode(stored)
		if loadErr != nil {
			decodeErr = loadErr
		}
		if decodeErr != nil || state.MediaTaskID == "" {
			t.Fatalf("media generation was neither approved nor auto-submitted: status=%s task=%s err=%v", run.Status, state.MediaTaskID, decodeErr)
		}
		return
	}
	if err := s.DecideCloudAgentApproval("user", runID, run.Approval.ID, "approve", ""); err != nil {
		t.Fatal(err)
	}
	if err := s.advanceCloudAgentByID("user", runID); err != nil {
		t.Fatal(err)
	}
}

func TestCloudAgentMediaApprovalCreatesNodeReferencesAndResult(t *testing.T) {
	s, db, a := agentMediaFixture(t)
	catalog, err := s.cloudAgentModelList(nil)
	if err != nil {
		t.Fatal(err)
	}
	encoded, _ := json.Marshal(catalog)
	if !strings.Contains(string(encoded), `"channelModelKey":"seedance-test"`) || strings.Contains(string(encoded), "logicalModelId") {
		t.Fatalf("wrong catalog: %s", encoded)
	}
	run, state := agentMediaRun(t, s, a, "request_approval")
	if err = s.advanceCloudAgentTool(run, &state); err != nil {
		t.Fatal(err)
	}
	var count int64
	db.Model(&model.Task{}).Where("type = ?", "canvas_video").Count(&count)
	if count != 0 {
		t.Fatal("charged/submitted before approval")
	}
	waiting, err := s.CloudAgentRun("user", run.ID)
	if err != nil || waiting.Approval == nil {
		t.Fatalf("missing approval: %v", err)
	}
	if err = s.DecideCloudAgentApproval("user", run.ID, waiting.Approval.ID, "approve", ""); err != nil {
		t.Fatal(err)
	}
	if err = s.advanceCloudAgentByID("user", run.ID); err != nil {
		t.Fatal(err)
	}
	run, _ = s.repo.CloudAgent("user", run.ID)
	state, _ = cloudAgentDecode(run)
	if state.MediaTaskID == "" {
		t.Fatalf("no media task: %s", run.StateJSON)
	}
	task, err := s.repo.TaskForUser("user", state.MediaTaskID)
	if err != nil {
		t.Fatal(err)
	}
	var input canvasGenerationInput
	if err = json.Unmarshal([]byte(task.InputJSON), &input); err != nil {
		t.Fatal(err)
	}
	if input.Config.Size != "9:16" || input.Config.VideoSeconds != "12" || input.Config.VideoGenerateAudio != "true" || len(input.ReferenceImages) != 2 || input.ReferenceImages[0].ID != "hero" || input.ReferenceImages[1].StorageKey != "resource:ref-one" || input.ReferenceImages[0].URL != "" {
		t.Fatalf("lost generation contract: %+v", input)
	}
	canvas, _ := s.repo.CanvasProjectForUser("user", "agent-canvas")
	doc, _ := creationDocument(canvas.PayloadJSON)
	nodes, _ := creationObjects(doc["nodes"])
	node := nodes[a.NodeID]
	if node == nil || node["type"] != "video" || node["metadata"].(map[string]any)["taskId"] != task.ID || len(creationMaps(doc["connections"])) != 3 {
		t.Fatalf("no node/edges: %s", canvas.PayloadJSON)
	}
	if err = s.advanceCloudAgentByID("user", run.ID); err != nil {
		t.Fatal(err)
	}
	db.Model(&model.Task{}).Where("type = ?", "canvas_video").Count(&count)
	if count != 1 {
		t.Fatal("replay duplicated task")
	}
	if err = db.Create(&model.Resource{ID: "output", UserID: "user", Kind: "video", Status: "ready", MimeType: "video/mp4", Width: 720, Height: 1280}).Error; err != nil {
		t.Fatal(err)
	}
	if err = db.Model(&model.Task{}).Where("id = ?", task.ID).Updates(map[string]any{"status": model.TaskStatusSucceeded, "result_json": `{"mode":"video","video":{"storageKey":"resource:output"}}`}).Error; err != nil {
		t.Fatal(err)
	}
	if err = s.advanceCloudAgentByID("user", run.ID); err != nil {
		t.Fatal(err)
	}
	canvas, _ = s.repo.CanvasProjectForUser("user", "agent-canvas")
	doc, _ = creationDocument(canvas.PayloadJSON)
	nodes, _ = creationObjects(doc["nodes"])
	meta := nodes[a.NodeID]["metadata"].(map[string]any)
	if meta["status"] != "success" || meta["storageKey"] != "resource:output" {
		t.Fatalf("result not persisted: %+v", meta)
	}
	run, _ = s.repo.CloudAgent("user", run.ID)
	state, _ = cloudAgentDecode(run)
	found := false
	for _, event := range state.Events {
		if event.Type == "canvas_updated" {
			found = true
		}
	}
	if !found || state.MediaTaskID != "" {
		t.Fatal("completion event/checkpoint missing")
	}
}

func TestCloudAgentMediaReferenceAndSnapshotGuards(t *testing.T) {
	s, db, a := agentMediaFixture(t)
	run, state := agentMediaRun(t, s, a, "auto")
	for _, test := range []struct {
		name   string
		change func(*cloudAgentMediaArgs)
	}{
		{"stale snapshot", func(v *cloudAgentMediaArgs) { v.SnapshotHash = "old" }},
		{"missing reference", func(v *cloudAgentMediaArgs) { v.ReferenceNodeIDs = []string{"missing"} }},
		{"text as media", func(v *cloudAgentMediaArgs) { v.ReferenceNodeIDs = []string{"shot-1"} }},
		{"duplicate reference", func(v *cloudAgentMediaArgs) { v.ReferenceNodeIDs = []string{"cat", "cat"} }},
		{"existing node", func(v *cloudAgentMediaArgs) { v.NodeID = "cat" }},
		{"mixed selection", func(v *cloudAgentMediaArgs) { v.LogicalModelID = "made-up" }},
		{"duration budget", func(v *cloudAgentMediaArgs) { v.Duration = 25 }},
	} {
		t.Run(test.name, func(t *testing.T) {
			bad := a
			test.change(&bad)
			if _, _, err := s.prepareCloudAgentMedia(run, &state, agentMediaCall(bad)); err == nil {
				t.Fatal("invalid request accepted")
			}
		})
	}
	if err := db.Model(&model.Resource{}).Where("id = ?", "ref-one").Update("status", "uploading").Error; err != nil {
		t.Fatal(err)
	}
	if _, _, err := s.prepareCloudAgentMedia(run, &state, agentMediaCall(a)); err == nil {
		t.Fatal("unready asset accepted")
	}
	if err := db.Model(&model.Resource{}).Where("id = ?", "ref-one").Update("user_id", "other").Error; err != nil {
		t.Fatal(err)
	}
	if _, _, err := s.prepareCloudAgentMedia(run, &state, agentMediaCall(a)); err == nil {
		t.Fatal("cross-user asset accepted")
	}
}

func TestCloudAgentImageCreatesReferencedNode(t *testing.T) {
	s, db, a := agentMediaFixture(t)
	capability := DefaultModelCapabilityConfigForModel(string(model.ChannelInterfaceGrokImage), "grok-image")
	for _, row := range []any{
		&model.ChannelModel{ID: "image-cm", ChannelID: "channel", ModelKey: "grok-image", Capability: "image", Protocol: model.ChannelInterfaceGrokImage, CapabilityConfigJSON: mustEncodeModelCapabilityConfig(t, capability), BillingMode: "fixed_request", PriceConfigured: true, Enabled: true},
		&model.ChannelModelPriceTier{ID: "image-tier", ChannelModelID: "image-cm", SelectorKey: "{}", SelectorJSON: "{}", BillingMode: "fixed_request", UnitPriceMicrocredits: 1, PriceConfigured: true, Enabled: true},
	} {
		if err := db.Create(row).Error; err != nil {
			t.Fatal(err)
		}
	}
	a.Mode, a.ChannelModelKey, a.Duration, a.VideoGenerateAudio = "image", "grok-image", 0, nil
	a.Size, a.Quality, a.NodeID = "1:1", "2k", "image-shot-1"
	a.ReferenceNodeIDs = []string{"cat"}
	run, _ := agentMediaRun(t, s, a, "request_approval")
	if err := s.advanceCloudAgentByID("user", run.ID); err != nil {
		t.Fatal(err)
	}
	approveAgentMediaDraft(t, s, run.ID)
	run, _ = s.repo.CloudAgent("user", run.ID)
	state, _ := cloudAgentDecode(run)
	if state.MediaTaskID == "" {
		t.Fatalf("image admission failed: %+v", state.Events[len(state.Events)-1])
	}
	task, err := s.repo.TaskForUser("user", state.MediaTaskID)
	if err != nil {
		t.Fatal(err)
	}
	var input canvasGenerationInput
	if err = json.Unmarshal([]byte(task.InputJSON), &input); err != nil {
		t.Fatal(err)
	}
	if task.Operation != "image_to_image" || len(input.ReferenceImages) != 1 || input.Config.Count != "1" || input.Config.Quality != "2k" {
		t.Fatal("image generation contract was lost")
	}
	canvas, _ := s.repo.CanvasProjectForUser("user", "agent-canvas")
	doc, _ := creationDocument(canvas.PayloadJSON)
	nodes, _ := creationObjects(doc["nodes"])
	if nodes[a.NodeID]["type"] != "image" || len(creationMaps(doc["connections"])) != 2 {
		t.Fatal("image node/references missing")
	}
}

func TestCloudAgentCanvasReadsFullPromptAssetsAndConnections(t *testing.T) {
	s, _, _ := agentMediaFixture(t)
	canvas, _ := s.repo.CanvasProjectForUser("user", "agent-canvas")
	doc, _ := creationDocument(canvas.PayloadJSON)
	result, err := cloudAgentCanvasState(s.repo, "user", "agent-canvas", doc, 0, []string{"shot-1", "cat"}, 0)
	if err != nil {
		t.Fatal(err)
	}
	raw, _ := json.Marshal(result)
	if strings.Contains(string(raw), "must-not-expose") || strings.Contains(string(raw), "storageKey") || strings.Contains(string(raw), "resource:ref-one") || !strings.Contains(string(raw), `"outputReference":{"ready":true}`) || !strings.Contains(string(raw), strings.Repeat("镜头完整指令", 500)) {
		t.Fatalf("incomplete/unsafe context: %.200s", raw)
	}
}

func TestCloudAgentMediaRejectAndInvalidModelDoNotCreateTasks(t *testing.T) {
	for _, scenario := range []string{"reject", "invalid-model", "stale-after-approval"} {
		t.Run(scenario, func(t *testing.T) {
			s, db, a := agentMediaFixture(t)
			if scenario == "invalid-model" {
				a.ChannelModelKey = "removed-model"
			}
			run, _ := agentMediaRun(t, s, a, "request_approval")
			if err := s.advanceCloudAgentByID("user", run.ID); err != nil {
				t.Fatal(err)
			}
			run, _ = s.repo.CloudAgent("user", run.ID)
			state, _ := cloudAgentDecode(run)
			if scenario == "invalid-model" {
				var count int64
				db.Model(&model.Task{}).Where("type = ?", "canvas_video").Count(&count)
				if state.Approval != nil || count != 0 || state.CallIndex != 1 {
					t.Fatal("invalid model created approval or task")
				}
				return
			}
			decision := "approve"
			if scenario == "reject" {
				decision = "reject"
			}
			if err := s.DecideCloudAgentApproval("user", run.ID, state.Approval.ID, decision, ""); err != nil {
				t.Fatal(err)
			}
			if scenario == "stale-after-approval" {
				if err := db.Model(&model.CanvasProject{}).Where("id = ?", "agent-canvas").Update("payload_json", `{"nodes":[],"connections":[]}`).Error; err != nil {
					t.Fatal(err)
				}
			}
			if err := s.advanceCloudAgentByID("user", run.ID); err != nil {
				t.Fatal(err)
			}
			run, _ = s.repo.CloudAgent("user", run.ID)
			state, _ = cloudAgentDecode(run)
			var count int64
			db.Model(&model.Task{}).Where("type = ?", "canvas_video").Count(&count)
			if scenario == "reject" {
				if run.Status != "rejected" || state.Approval != nil || state.CallIndex != 0 {
					t.Fatalf("rejection did not stop at the approval boundary: status=%s approval=%+v index=%d", run.Status, state.Approval, state.CallIndex)
				}
				for _, event := range state.Events {
					if event.Type == "tool_failed" || event.Type == "run_failed" {
						t.Fatalf("user rejection was reported as execution failure: %+v", event)
					}
				}
				if err := s.advanceCloudAgentByID("user", run.ID); err != nil {
					t.Fatal(err)
				}
				var modelSteps int64
				db.Model(&model.Task{}).Where("operation = ?", "cloud_agent_step").Count(&modelSteps)
				if modelSteps != 0 {
					t.Fatalf("rejected approval triggered %d follow-up model tasks", modelSteps)
				}
			} else if state.CallIndex != 1 || run.Status == "failed" {
				t.Fatalf("nonrecoverable approved-tool failure: index=%d status=%s", state.CallIndex, run.Status)
			}
			if count != 0 || state.Generations != 0 {
				t.Fatalf("unsafe submission or nonrecoverable tool failure: count=%d index=%d status=%s", count, state.CallIndex, run.Status)
			}
		})
	}
}

func TestCloudAgentMediaChangedCanvasRollsBackAdmission(t *testing.T) {
	s, db, a := agentMediaFixture(t)
	run, state := agentMediaRun(t, s, a, "auto")
	req, plan, err := s.prepareCloudAgentMedia(run, &state, agentMediaCall(a))
	if err != nil {
		t.Fatal(err)
	}
	ordersBefore, err := s.repo.BillingOrdersByTaskIDs("user", state.TaskIDs)
	if err != nil {
		t.Fatal(err)
	}
	if err := db.Model(&model.CanvasProject{}).Where("id = ?", "agent-canvas").Update("payload_json", `{"nodes":[],"connections":[]}`).Error; err != nil {
		t.Fatal(err)
	}
	if err := s.enqueueCloudAgentTask(run, &state, req, plan); err != nil {
		t.Fatal(err)
	}
	run, _ = s.repo.CloudAgent("user", run.ID)
	state, _ = cloudAgentDecode(run)
	ordersAfter, _ := s.repo.BillingOrdersByTaskIDs("user", state.TaskIDs)
	var tasks, orders int64
	db.Model(&model.Task{}).Where("type = ?", "canvas_video").Count(&tasks)
	db.Model(&model.BillingOrder{}).Count(&orders)
	if tasks != 0 || orders != int64(len(ordersBefore)) || len(ordersAfter) != len(ordersBefore) || state.Generations != 0 || state.MediaTaskID != "" || state.CallIndex != 1 {
		t.Fatal("failed canvas CAS left a media task, charge or consumed budget")
	}
}

func TestCloudAgentMediaFillsMissingSnapshotHash(t *testing.T) {
	s, db, a := agentMediaFixture(t)
	if sqlDB, err := db.DB(); err == nil {
		t.Cleanup(func() { _ = sqlDB.Close() })
	}
	want := a.SnapshotHash
	a.SnapshotHash = ""
	run, state := agentMediaRun(t, s, a, "auto", "fill-missing-snapshot")
	_, plan, err := s.prepareCloudAgentMedia(run, &state, agentMediaCall(a))
	if err != nil {
		t.Fatalf("missing snapshotHash should be filled from current canvas: %v", err)
	}
	if plan.Args.SnapshotHash == "" {
		t.Fatal("filled snapshotHash is empty")
	}
	canvas, _ := s.repo.CanvasProjectForUser("user", "agent-canvas")
	doc, _ := creationDocument(canvas.PayloadJSON)
	if plan.Args.SnapshotHash != cloudAgentMediaContentHash(doc) {
		t.Fatalf("filled hash %s, want media content hash", plan.Args.SnapshotHash)
	}
	if want == "" {
		t.Fatal("fixture snapshot missing")
	}
}

func TestCloudAgentMediaFailedTaskUpdatesNode(t *testing.T) {
	s, db, a := agentMediaFixture(t)
	run, _ := agentMediaRun(t, s, a, "request_approval")
	if err := s.advanceCloudAgentByID("user", run.ID); err != nil {
		t.Fatal(err)
	}
	approveAgentMediaDraft(t, s, run.ID)
	run, _ = s.repo.CloudAgent("user", run.ID)
	state, _ := cloudAgentDecode(run)
	if state.MediaTaskID == "" {
		t.Fatal("media task missing")
	}
	taskID := state.MediaTaskID
	if err := db.Model(&model.Task{}).Where("id = ?", taskID).Updates(map[string]any{"status": model.TaskStatusFailed, "error": "上游拒绝该生成规格"}).Error; err != nil {
		t.Fatal(err)
	}
	if err := s.advanceCloudAgentByID("user", run.ID); err != nil {
		t.Fatal(err)
	}
	canvas, _ := s.repo.CanvasProjectForUser("user", "agent-canvas")
	doc, _ := creationDocument(canvas.PayloadJSON)
	nodes, _ := creationObjects(doc["nodes"])
	if nodes[a.NodeID]["metadata"].(map[string]any)["status"] != "error" {
		t.Fatal("failed generation remained loading")
	}
	run, _ = s.repo.CloudAgent("user", run.ID)
	state, _ = cloudAgentDecode(run)
	last := state.Events[len(state.Events)-1]
	result, _ := last.Payload["result"].(map[string]any)
	if last.Type != "tool_failed" || result["taskId"] != taskID || result["nodeId"] != a.NodeID || !strings.Contains(stringValue(result["error"]), "上游拒绝该生成规格") {
		t.Fatalf("failure lost diagnostic details: %+v", last)
	}
	if run.Status == "failed" {
		t.Fatalf("media task failure must keep the agent run alive: status=%s events=%d", run.Status, len(state.Events))
	}
}

func TestCloudAgentModelListFiltersActualReferences(t *testing.T) {
	s, db, _ := agentMediaFixture(t)
	config := DefaultModelCapabilityConfigForModel(string(model.ChannelInterfaceVolcengineArkVideo), "text-only")
	config.Video.Operations = []string{"text_to_video"}
	config.Video.DefaultOperation = "text_to_video"
	config.Video.References.MaxImages = 0
	config.Video.References.MaxVideos = 0
	config.Video.References.MaxAudios = 0
	if err := db.Create(&model.ChannelModel{ID: "text-only", ChannelID: "channel", ModelKey: "text-only", Capability: "video", Protocol: model.ChannelInterfaceVolcengineArkVideo, CapabilityConfigJSON: mustEncodeModelCapabilityConfig(t, config), BillingMode: "per_second", PriceConfigured: true, Enabled: true}).Error; err != nil {
		t.Fatal(err)
	}
	for _, tc := range []struct {
		args     string
		wantText bool
	}{
		{`{}`, true},
		{`{"mode":"video","referenceNodeIds":[]}`, true},
		{`{"mode":"video","referenceNodeIds":["hero","cat"]}`, false},
	} {
		intent, err := s.cloudAgentModelIntent("user", "agent-canvas", tc.args)
		if err != nil {
			t.Fatal(err)
		}
		catalog, err := s.cloudAgentModelList(intent)
		if err != nil {
			t.Fatal(err)
		}
		encoded, _ := json.Marshal(catalog)
		if strings.Contains(string(encoded), `"channelModelKey":"text-only"`) != tc.wantText || !strings.Contains(string(encoded), `"channelModelKey":"seedance-test"`) {
			t.Fatalf("unexpected filtered catalog for %s: %s", tc.args, encoded)
		}
		if intent != nil && !tc.wantText && (intent.Inputs["image"] != 2 || intent.Operation != "image_to_video") {
			t.Fatalf("intent = %+v", intent)
		}
	}
	for _, args := range []string{`{"mode":"video","referenceNodeIds":["hero","hero"]}`, `{"mode":"video","referenceNodeIds":["missing"]}`, `{"referenceNodeIds":["hero"]}`, `{"mode":"audio","referenceNodeIds":["hero"]}`} {
		if _, err := s.cloudAgentModelIntent("user", "agent-canvas", args); err == nil {
			t.Fatalf("accepted %s", args)
		}
	}
	if _, err := s.cloudAgentModelIntent("other", "agent-canvas", `{"mode":"video"}`); err == nil {
		t.Fatal("cross-user canvas accepted")
	}
	if err := db.Model(&model.ChannelModel{}).Where("id = ?", "video-cm").Update("capability_config_json", mustEncodeModelCapabilityConfig(t, config)).Error; err != nil {
		t.Fatal(err)
	}
	intent, err := s.cloudAgentModelIntent("user", "agent-canvas", `{"mode":"video","referenceNodeIds":["hero","cat"]}`)
	if err != nil {
		t.Fatal(err)
	}
	catalog, err := s.cloudAgentModelList(intent)
	if err != nil {
		t.Fatal(err)
	}
	if len(catalog.(map[string]any)["models"].([]map[string]any)) != 0 {
		t.Fatal("no-match query fell back to incompatible models")
	}
}

func TestCloudAgentMediaDraftReuseLifecycle(t *testing.T) {
	for _, tc := range []struct {
		name, status, ownerUser, ownerCanvas        string
		cleanup, submitted, result, locked, allowed bool
	}{
		{name: "completed", status: "completed", allowed: true},
		{name: "cancelled", status: "cancelled", allowed: true},
		{name: "failed", status: "failed", allowed: true},
		{name: "approval", status: "waiting_approval"},
		{name: "running", status: "running"},
		{name: "cleanup", status: "cancelled", cleanup: true},
		{name: "submitted", status: "completed", submitted: true},
		{name: "result", status: "completed", result: true},
		{name: "locked", status: "completed", locked: true},
		{name: "other user", status: "completed", ownerUser: "other"},
		{name: "other canvas", status: "completed", ownerCanvas: "other"},
		{name: "plain placeholder", allowed: true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			s, db, a := agentMediaFixture(t)
			meta := map[string]any{"status": "idle", "locked": tc.locked, "composerContent": "保留的草稿"}
			if tc.status != "" {
				owner := &model.CloudAgentExecution{ID: "old-run", UserID: firstNonEmpty(tc.ownerUser, "user"), CanvasID: firstNonEmpty(tc.ownerCanvas, "agent-canvas"), Status: tc.status, CleanupPending: tc.cleanup}
				if err := db.Create(owner).Error; err != nil {
					t.Fatal(err)
				}
				meta["agentDraftRunId"] = owner.ID
			}
			if tc.submitted {
				meta["taskId"] = "existing-task"
			}
			if tc.result {
				meta["storageKey"] = "resource:existing"
			}
			canvas, _ := s.repo.CanvasProjectForUser("user", "agent-canvas")
			doc, _ := creationDocument(canvas.PayloadJSON)
			doc["nodes"] = append(creationMaps(doc["nodes"]), map[string]any{"id": a.NodeID, "type": "video", "metadata": meta})
			raw, _ := json.Marshal(doc)
			if err := db.Model(canvas).Update("payload_json", string(raw)).Error; err != nil {
				t.Fatal(err)
			}
			a.DraftRunID, a.SnapshotHash = "next-run", cloudAgentCanvasHash(doc)
			_, _, _, err := cloudAgentMediaDocument(s.repo, "user", "agent-canvas", a)
			if (err == nil) != tc.allowed {
				t.Fatalf("allowed=%v error=%v", tc.allowed, err)
			}
		})
	}
}

func TestCloudAgentMediaPreviousDraftRequiresNewApproval(t *testing.T) {
	s, db, a := agentMediaFixture(t)
	run, state := agentMediaRun(t, s, a, "request_approval")
	if err := s.advanceCloudAgentTool(run, &state); err != nil {
		t.Fatal(err)
	}
	if err := s.CancelCloudAgent(context.Background(), "user", run.ID); err != nil {
		t.Fatal(err)
	}
	canvas, _ := s.repo.CanvasProjectForUser("user", "agent-canvas")
	doc, _ := creationDocument(canvas.PayloadJSON)
	view, err := cloudAgentCanvasState(s.repo, "user", "agent-canvas", doc, 0, []string{a.NodeID}, 0)
	if err != nil {
		t.Fatal(err)
	}
	encoded, _ := json.Marshal(view)
	if !strings.Contains(string(encoded), `"ownerStatus":"cancelled"`) || !strings.Contains(string(encoded), `"submitted":false`) {
		t.Fatalf("missing draft lifecycle: %s", encoded)
	}
	a.SnapshotHash = cloudAgentCanvasHash(doc)
	a.ReferenceNodeIDs = []string{"hero"}
	next, nextState := agentMediaRun(t, s, a, "request_approval", "resume-draft-next-turn")
	if next.ID == run.ID {
		t.Fatal("expected a distinct run")
	}
	if err := s.advanceCloudAgentTool(next, &nextState); err != nil {
		t.Fatal(err)
	}
	latest, err := s.CloudAgentRun("user", next.ID)
	if err != nil || latest.Approval == nil {
		t.Fatalf("new approval missing: %+v %v", latest, err)
	}
	canvas, _ = s.repo.CanvasProjectForUser("user", "agent-canvas")
	doc, _ = creationDocument(canvas.PayloadJSON)
	if len(creationMaps(doc["nodes"])) != 4 {
		t.Fatal("resuming duplicated the node")
	}
	edges := creationMaps(doc["connections"])
	if len(edges) != 2 {
		t.Fatalf("stale draft references retained: %+v", edges)
	}
	for _, edge := range edges {
		if stringValue(edge["fromNodeId"]) == "cat" {
			t.Fatal("removed reference still connected")
		}
	}
	var count int64
	if err := db.Model(&model.Task{}).Where("type = ?", "canvas_video").Count(&count).Error; err != nil {
		t.Fatal(err)
	}
	if count != 0 {
		t.Fatal("resuming charged before new approval")
	}
	approveAgentMediaDraft(t, s, next.ID)
	if err := db.Model(&model.Task{}).Where("type = ?", "canvas_video").Count(&count).Error; err != nil {
		t.Fatal(err)
	}
	if count != 1 {
		t.Fatalf("approved task count = %d", count)
	}
}

func TestCloudAgentAutoMediaSubmitsWithoutApproval(t *testing.T) {
	s, db, a := agentMediaFixture(t)
	// Omitted size and duration should be filled by the selected model's catalog
	// defaults during admission instead of producing a repair turn.
	a.Size = ""
	a.Duration = 0
	run, _ := agentMediaRun(t, s, a, "auto")
	var ordersBefore int64
	if err := db.Model(&model.BillingOrder{}).Count(&ordersBefore).Error; err != nil {
		t.Fatal(err)
	}
	if err := s.advanceCloudAgentByID("user", run.ID); err != nil {
		t.Fatal(err)
	}
	run, _ = s.repo.CloudAgent("user", run.ID)
	state, err := cloudAgentDecode(run)
	if err != nil {
		t.Fatal(err)
	}
	if run.Status == "waiting_approval" || state.Approval != nil {
		t.Fatalf("auto mode unexpectedly requested approval: status=%s approval=%+v", run.Status, state.Approval)
	}
	if state.MediaTaskID == "" {
		t.Fatalf("auto mode did not submit a media task: %+v", state.Events)
	}
	for _, event := range state.Events {
		if event.Type == "approval_requested" {
			t.Fatal("auto mode emitted an approval event")
		}
	}
	task, err := s.repo.TaskForUser("user", state.MediaTaskID)
	if err != nil {
		t.Fatal(err)
	}
	var input canvasGenerationInput
	if err := json.Unmarshal([]byte(task.InputJSON), &input); err != nil {
		t.Fatal(err)
	}
	if input.Config.Size == "" || input.Config.VideoSeconds == "" {
		t.Fatalf("model defaults were not resolved: %+v", input.Config)
	}
	canvas, _ := s.repo.CanvasProjectForUser("user", "agent-canvas")
	doc, _ := creationDocument(canvas.PayloadJSON)
	nodes, _ := creationObjects(doc["nodes"])
	meta, _ := nodes[a.NodeID]["metadata"].(map[string]any)
	if meta["status"] != "loading" || meta["taskId"] != task.ID || meta["agentDraftRunId"] != nil {
		t.Fatalf("auto submission did not finalize the draft: %+v", meta)
	}
	var tasks, orders int64
	if err := db.Model(&model.Task{}).Where("type = ?", "canvas_video").Count(&tasks).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Model(&model.BillingOrder{}).Count(&orders).Error; err != nil {
		t.Fatal(err)
	}
	if tasks != 1 || orders != ordersBefore+1 {
		t.Fatalf("auto submission created unexpected records: tasks=%d orders=%d before=%d", tasks, orders, ordersBefore)
	}
	// Re-entering a submitted call is idempotent and must not reserve/submit a
	// second generation.
	if err := s.advanceCloudAgentByID("user", run.ID); err != nil {
		t.Fatal(err)
	}
	if err := db.Model(&model.Task{}).Where("type = ?", "canvas_video").Count(&tasks).Error; err != nil {
		t.Fatal(err)
	}
	if tasks != 1 {
		t.Fatalf("re-entering auto media duplicated task: %d", tasks)
	}

	// Admission failures are still non-billed tool failures and do not create an
	// approval or a draft task.
	invalidService, invalidDB, invalidArgs := agentMediaFixture(t)
	invalidArgs.ChannelModelKey = "removed-model"
	invalidRun, _ := agentMediaRun(t, invalidService, invalidArgs, "auto")
	var invalidOrdersBefore int64
	if err := invalidDB.Model(&model.BillingOrder{}).Count(&invalidOrdersBefore).Error; err != nil {
		t.Fatal(err)
	}
	if err := invalidService.advanceCloudAgentByID("user", invalidRun.ID); err != nil {
		t.Fatal(err)
	}
	invalidRun, _ = invalidService.repo.CloudAgent("user", invalidRun.ID)
	invalidState, err := cloudAgentDecode(invalidRun)
	if err != nil {
		t.Fatal(err)
	}
	var invalidTasks, invalidOrders int64
	if err := invalidDB.Model(&model.Task{}).Where("type = ?", "canvas_video").Count(&invalidTasks).Error; err != nil {
		t.Fatal(err)
	}
	if err := invalidDB.Model(&model.BillingOrder{}).Count(&invalidOrders).Error; err != nil {
		t.Fatal(err)
	}
	if invalidTasks != 0 || invalidOrders != invalidOrdersBefore || invalidState.Approval != nil {
		t.Fatalf("invalid auto admission created side effects: tasks=%d orders=%d before=%d approval=%+v", invalidTasks, invalidOrders, invalidOrdersBefore, invalidState.Approval)
	}

	approvalService, approvalDB, approvalArgs := agentMediaFixture(t)
	approvalRun, _ := agentMediaRun(t, approvalService, approvalArgs, "request_approval")
	var approvalOrdersBefore int64
	if err := approvalDB.Model(&model.BillingOrder{}).Count(&approvalOrdersBefore).Error; err != nil {
		t.Fatal(err)
	}
	if err := approvalService.advanceCloudAgentByID("user", approvalRun.ID); err != nil {
		t.Fatal(err)
	}
	approvalRun, _ = approvalService.repo.CloudAgent("user", approvalRun.ID)
	approvalState, err := cloudAgentDecode(approvalRun)
	if err != nil {
		t.Fatal(err)
	}
	if approvalRun.Status != "waiting_approval" || approvalState.Approval == nil {
		t.Fatalf("request_approval stopped bypassing approval: status=%s approval=%+v", approvalRun.Status, approvalState.Approval)
	}
	var approvalTasks, approvalOrders int64
	if err := approvalDB.Model(&model.Task{}).Where("type = ?", "canvas_video").Count(&approvalTasks).Error; err != nil {
		t.Fatal(err)
	}
	if err := approvalDB.Model(&model.BillingOrder{}).Count(&approvalOrders).Error; err != nil {
		t.Fatal(err)
	}
	if approvalTasks != 0 || approvalOrders != approvalOrdersBefore {
		t.Fatalf("request_approval submitted before decision: tasks=%d orders=%d before=%d", approvalTasks, approvalOrders, approvalOrdersBefore)
	}
}

func TestCloudAgentMediaPromptCountsUnicodeCharacters(t *testing.T) {
	s, _, a := agentMediaFixture(t)
	run, state := agentMediaRun(t, s, a, "auto")
	const mentions = "@图片1 @图片2"
	a.Prompt = strings.Repeat("镜", 16000-len([]rune(mentions))) + mentions
	if _, _, err := s.prepareCloudAgentMedia(run, &state, agentMediaCall(a)); err != nil {
		t.Fatal(err)
	}
	a.Prompt += "头"
	if _, _, err := s.prepareCloudAgentMedia(run, &state, agentMediaCall(a)); err == nil || !strings.Contains(err.Error(), "16001") {
		t.Fatal("missing exact character count")
	}
}

func TestCloudAgentMediaCancellationUpdatesNode(t *testing.T) {
	s, _, a := agentMediaFixture(t)
	run, _ := agentMediaRun(t, s, a, "request_approval")
	if err := s.advanceCloudAgentByID("user", run.ID); err != nil {
		t.Fatal(err)
	}
	approveAgentMediaDraft(t, s, run.ID)
	if err := s.CancelCloudAgent(context.Background(), "user", run.ID); err != nil {
		t.Fatal(err)
	}
	canvas, _ := s.repo.CanvasProjectForUser("user", "agent-canvas")
	doc, _ := creationDocument(canvas.PayloadJSON)
	nodes, _ := creationObjects(doc["nodes"])
	if nodes[a.NodeID]["metadata"].(map[string]any)["status"] != "error" {
		t.Fatal("cancelled generation remained loading")
	}
	run, _ = s.repo.CloudAgent("user", run.ID)
	state, _ := cloudAgentDecode(run)
	if run.Status != "cancelled" || state.MediaTaskID != "" {
		t.Fatal("cancellation did not checkpoint media completion")
	}
}

func TestCloudAgentStoryboardPrecisionAndPermission(t *testing.T) {
	storyboard := map[string]any{"rows": []any{
		map[string]any{"id": "shot-1", "shotNumber": float64(1), "videoMotionPrompt": strings.Repeat("切镜指令", 500), "assetBindings": []any{map[string]any{"nodeId": "hero", "role": "character", "url": "do-not-expose"}}, "private": "do-not-expose"},
		map[string]any{"id": "shot-2", "videoMotionPrompt": "下一镜头"},
	}}
	result := cloudAgentStoryboardState(storyboard, 0, true)
	raw, _ := json.Marshal(result)
	if !strings.Contains(string(raw), strings.Repeat("切镜指令", 500)) || strings.Contains(string(raw), "do-not-expose") || result["nextOffset"] != 1 {
		t.Fatal("storyboard context missing full prompt, pagination or privacy boundary")
	}
	next := cloudAgentStoryboardState(storyboard, 1, true)
	if next["hasMore"] != false || next["rows"].([]any)[0].(map[string]any)["id"] != "shot-2" {
		t.Fatal("storyboard pagination failed")
	}
	req := agentTestRequest()
	req.PermissionMode, req.ContextScope, req.Budget.MaxGenerationTasks = "auto", nil, 1
	if cloudAgentToolAllowed(req, "generate_media") || cloudAgentToolAllowed(req, "canvas_apply_ops") {
		t.Fatal("canvas writes exposed without context permission")
	}
}

func TestCloudAgentCanvasCreatesTypedNodesAndEdges(t *testing.T) {
	s, _, a := agentMediaFixture(t)
	policy, err := s.RuntimePolicy()
	if err != nil {
		t.Fatal(err)
	}
	call := cloudAgentCall{}
	args := map[string]any{"snapshotHash": a.SnapshotHash, "ops": []map[string]any{
		{"type": "add_node", "id": "blank-video", "nodeType": "video", "title": "镜头占位", "content": "生成提示词"},
		{"type": "add_node", "id": "group", "nodeType": "frame", "title": "镜头组"},
		{"type": "connect_nodes", "id": "ref-edge", "fromNodeId": "cat", "toNodeId": "blank-video"},
	}}
	raw, _ := json.Marshal(args)
	call.Function.Arguments = string(raw)
	if _, err = applyCloudAgentCanvas(s.repo, "user", "agent-canvas", call, policy); err != nil {
		t.Fatal(err)
	}
	canvas, _ := s.repo.CanvasProjectForUser("user", "agent-canvas")
	doc, _ := creationDocument(canvas.PayloadJSON)
	nodes, _ := creationObjects(doc["nodes"])
	meta := nodes["blank-video"]["metadata"].(map[string]any)
	if meta["content"] != "" || meta["prompt"] != "生成提示词" || meta["composerContent"] != "生成提示词" || len(creationMaps(doc["connections"])) != 1 {
		t.Fatal("typed nodes/edges missing")
	}
}

func TestCloudAgentCanvasUpdatesExistingVideoDraftThroughCapabilityContract(t *testing.T) {
	s, db, _ := agentMediaFixture(t)
	policy, err := s.RuntimePolicy()
	if err != nil {
		t.Fatal(err)
	}
	canvas, err := s.repo.CanvasProjectForUser("user", "agent-canvas")
	if err != nil {
		t.Fatal(err)
	}
	doc, err := creationDocument(canvas.PayloadJSON)
	if err != nil {
		t.Fatal(err)
	}
	nodes := creationMaps(doc["nodes"])
	nodes = append(nodes, map[string]any{
		"id": "video-1789310237935-mmh3-baby-fullmoon", "type": "video", "title": "旧视频草稿",
		"position": map[string]any{"x": float64(200), "y": float64(80)}, "width": float64(720), "height": float64(405),
		"metadata": map[string]any{
			"content": "", "prompt": "原始已提交提示词", "composerContent": "原始草稿", "status": "error",
			"referenceNodeIds": []any{"cat"}, "referenceIssue": "参考资产尚未准备完成",
		},
	})
	doc["nodes"] = nodes
	rawDocument, _ := json.Marshal(doc)
	if err := db.Model(&model.CanvasProject{}).Where("id = ? AND user_id = ?", canvas.ID, "user").Update("payload_json", string(rawDocument)).Error; err != nil {
		t.Fatal(err)
	}

	call := cloudAgentCall{ID: "update-video-draft"}
	arguments, _ := json.Marshal(map[string]any{
		"snapshotHash": cloudAgentCanvasHash(doc),
		"ops": []map[string]any{{
			"type": "update_node", "id": "video-1789310237935-mmh3-baby-fullmoon",
			"patch": map[string]any{"title": "满月庆祝视频草稿（舒缓呼吸感）", "content": "下一版舒缓视频提示词"},
		}},
	})
	call.Function.Arguments = string(arguments)
	if _, err := applyCloudAgentCanvas(s.repo, "user", canvas.ID, call, policy); err != nil {
		t.Fatal(err)
	}

	updatedCanvas, err := s.repo.CanvasProjectForUser("user", canvas.ID)
	if err != nil {
		t.Fatal(err)
	}
	updatedDocument, err := creationDocument(updatedCanvas.PayloadJSON)
	if err != nil {
		t.Fatal(err)
	}
	updatedNodes, err := creationObjects(updatedDocument["nodes"])
	if err != nil {
		t.Fatal(err)
	}
	updated := updatedNodes["video-1789310237935-mmh3-baby-fullmoon"]
	metadata := updated["metadata"].(map[string]any)
	if updated["title"] != "满月庆祝视频草稿（舒缓呼吸感）" || metadata["composerContent"] != "下一版舒缓视频提示词" {
		t.Fatalf("video draft was not updated: %#v", updated)
	}
	if metadata["prompt"] != "原始已提交提示词" || metadata["status"] != "error" || metadata["referenceIssue"] != "参考资产尚未准备完成" {
		t.Fatalf("video task state or submission snapshot was overwritten: %#v", metadata)
	}
}

func TestCloudAgentMediaDependencyIgnoresNodeMovement(t *testing.T) {
	s, _, args := agentMediaFixture(t)
	canvas, err := s.repo.CanvasProjectForUser("user", "agent-canvas")
	if err != nil {
		t.Fatal(err)
	}
	doc, err := creationDocument(canvas.PayloadJSON)
	if err != nil {
		t.Fatal(err)
	}
	nodeList := append(creationMaps(doc["nodes"]), map[string]any{
		"id": "video-shot-1", "type": "video", "title": "镜头1视频",
		"position": map[string]any{"x": 100.0, "y": 100.0}, "width": 360.0, "height": 640.0,
		"metadata": map[string]any{"status": "idle", "prompt": args.Prompt, "agentDraftRunId": "run-current"},
	})
	normalizedNodes, err := json.Marshal(nodeList)
	if err != nil {
		t.Fatal(err)
	}
	var decodedNodes []any
	if err := json.Unmarshal(normalizedNodes, &decodedNodes); err != nil {
		t.Fatal(err)
	}
	doc["nodes"] = decodedNodes
	args.DraftRunID = "run-current"
	base, err := cloudAgentMediaDependencyHash(doc, args)
	if err != nil {
		t.Fatal(err)
	}
	moved := cloneCreationDocument(doc)
	nodes, err := creationObjects(moved["nodes"])
	if err != nil {
		t.Fatal(err)
	}
	for _, id := range []string{"video-shot-1", "cat", "hero", "shot-1"} {
		node := nodes[id]
		position := node["position"].(map[string]any)
		position["x"] = position["x"].(float64) + 240
		position["y"] = position["y"].(float64) + 120
	}
	got, err := cloudAgentMediaDependencyHash(moved, args)
	if err != nil {
		t.Fatal(err)
	}
	if got != base {
		t.Fatalf("moving target or input nodes changed generation dependency: base=%s got=%s", base, got)
	}
}
