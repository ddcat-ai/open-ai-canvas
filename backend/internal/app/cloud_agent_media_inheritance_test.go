package app

import (
	"encoding/json"
	"errors"
	"strings"
	"testing"

	"gorm.io/gorm"
	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"
)

func seedAgentMediaVersion(t *testing.T, s *Service, db *gorm.DB) {
	t.Helper()
	input := map[string]any{
		"mode": "video", "prompt": "原片",
		"config":          map[string]any{"channelId": "channel", "channelModelKey": "seedance-test", "size": "9:16", "videoSeconds": "6", "videoGenerateAudio": "false", "videoWatermark": "false"},
		"metadata":        map[string]any{"nodeId": "original"},
		"referenceImages": []any{map[string]any{"id": "hero", "storageKey": "resource:ref-two"}, map[string]any{"id": "cat", "storageKey": "resource:ref-one"}},
	}
	raw, _ := json.Marshal(input)
	if err := db.Create(&model.Task{ID: "original-task", UserID: "user", ProjectID: "agent-canvas", Type: "canvas_video", Status: model.TaskStatusSucceeded, InputJSON: string(raw)}).Error; err != nil {
		t.Fatal(err)
	}
	canvas, err := s.repo.CanvasProjectForUser("user", "agent-canvas")
	if err != nil {
		t.Fatal(err)
	}
	doc, _ := creationDocument(canvas.PayloadJSON)
	// 当前选用规格已被修改，继承仍必须以原任务的执行规格为准。
	doc["nodes"] = append(creationMaps(doc["nodes"]), map[string]any{"id": "original", "type": "video", "title": "原片", "metadata": map[string]any{"taskId": "original-task", "status": "success", "size": "16:9"}})
	raw, _ = json.Marshal(doc)
	if err := db.Model(canvas).Update("payload_json", string(raw)).Error; err != nil {
		t.Fatal(err)
	}
}

func TestCloudAgentMediaVersionPreservesExecutionThroughApproval(t *testing.T) {
	s, db, a := agentMediaFixture(t)
	seedAgentMediaVersion(t, s, db)
	run, state := agentMediaRun(t, s, a, "auto")
	call := cloudAgentCall{ID: "revise-original"}
	call.Function.Name = "generate_media"
	call.Function.Arguments = `{"mode":"video","prompt":"仅修改结尾","inheritFromNodeId":"original","channelId":"channel","channelModelKey":"seedance-test"}`
	state.Calls = []cloudAgentCall{call}
	if err := cloudAgentSave(run, &state); err != nil {
		t.Fatal(err)
	}
	if err := db.Save(run).Error; err != nil {
		t.Fatal(err)
	}
	if err := s.advanceCloudAgentByID("user", run.ID); err != nil {
		t.Fatal(err)
	}
	run, state = agentInterjectionState(t, s, run.ID)
	if state.Approval == nil {
		t.Fatalf("未进入审批：%s %s", run.Status, run.FailureMessage)
	}
	preview, _ := json.Marshal(state.Approval.Preview)
	if !strings.Contains(string(preview), "9:16") || !strings.Contains(string(preview), "original") {
		t.Fatalf("审批未展示实际画幅和来源：%s", preview)
	}
	approveAgentMediaDraft(t, s, run.ID)
	run, state = agentInterjectionState(t, s, run.ID)
	if state.MediaTaskID == "" {
		t.Fatalf("审批后未提交：%s %s", run.Status, run.FailureMessage)
	}
	task, err := s.repo.TaskForUser("user", state.MediaTaskID)
	if err != nil {
		t.Fatal(err)
	}
	var input map[string]any
	if err := json.Unmarshal([]byte(task.InputJSON), &input); err != nil {
		t.Fatal(err)
	}
	config := input["config"].(map[string]any)
	if config["size"] != "9:16" || config["videoSeconds"] != "6" || config["videoGenerateAudio"] != "false" || config["videoWatermark"] != "false" {
		t.Fatalf("执行规格漂移：%+v", config)
	}
	refs := creationMaps(input["referenceImages"])
	if len(refs) != 2 || refs[0]["id"] != "hero" || refs[1]["id"] != "cat" {
		t.Fatalf("引用未继承：%+v", refs)
	}
	original, _ := s.repo.TaskForUser("user", "original-task")
	if original.Status != model.TaskStatusSucceeded || original.ID == task.ID {
		t.Fatal("原任务被覆盖")
	}
}

func TestCloudAgentMediaVersionRejectsInvalidSourceAndPreservesEmptyReferences(t *testing.T) {
	for _, scenario := range []string{"missing", "other-user", "other-canvas", "mode", "empty-references"} {
		t.Run(scenario, func(t *testing.T) {
			s, db, a := agentMediaFixture(t)
			seedAgentMediaVersion(t, s, db)
			source := "original"
			switch scenario {
			case "missing":
				source = "missing"
			case "other-user":
				db.Model(&model.Task{}).Where("id = ?", "original-task").Update("user_id", "other")
			case "other-canvas":
				db.Model(&model.Task{}).Where("id = ?", "original-task").Update("project_id", "other")
			case "mode":
				a.Mode = "image"
			}
			a.InheritFromNodeID, a.Size, a.Duration, a.SnapshotHash = source, "", 0, ""
			a.VideoGenerateAudio, a.ReferenceNodeIDs = nil, []string{}
			run, state := agentMediaRun(t, s, a, "auto")
			_, plan, err := s.prepareCloudAgentMedia(run, &state, agentMediaCall(a))
			if scenario != "empty-references" {
				if err == nil {
					t.Fatal("无效来源被接受")
				}
				return
			}
			if err != nil || len(plan.Args.ReferenceNodeIDs) != 0 {
				t.Fatalf("显式空引用被覆盖：%v %+v", err, plan)
			}
		})
	}
}

func TestCloudAgentMediaVersionApprovalBoundaries(t *testing.T) {
	for _, scenario := range []string{"edit", "original-settings", "reference-changed", "replay"} {
		t.Run(scenario, func(t *testing.T) {
			s, db, a := agentMediaFixture(t)
			seedAgentMediaVersion(t, s, db)
			run, state := agentMediaRun(t, s, a, "request_approval")
			call := cloudAgentCall{ID: "revise-original"}
			call.Function.Name = "generate_media"
			call.Function.Arguments = `{"mode":"video","prompt":"仅修改结尾","inheritFromNodeId":"original"}`
			state.Calls = []cloudAgentCall{call}
			if err := s.repo.MutateCloudAgent("user", run.ID, run.Revision, func(current *model.CloudAgentExecution, _ *repository.Repository) error {
				return cloudAgentSave(current, &state)
			}); err != nil {
				t.Fatal(err)
			}
			if err := s.advanceCloudAgentByID("user", run.ID); err != nil {
				t.Fatal(err)
			}
			run, state = agentInterjectionState(t, s, run.ID)
			if state.Approval == nil {
				t.Fatalf("未进入审批：%s %s", run.Status, run.FailureMessage)
			}
			approvalID := state.Approval.ID
			size, seconds := "9:16", 6
			var settings []*CloudAgentMediaSettings
			switch scenario {
			case "edit":
				size, seconds = "16:9", 8
				closed := false
				settings = []*CloudAgentMediaSettings{{ChannelID: "channel", ChannelModelKey: "seedance-test", Size: size, DurationSeconds: &seconds, VideoGenerateAudio: &closed, VideoWatermark: &closed}}
			case "original-settings":
				canvas, _ := s.repo.CanvasProjectForUser("user", "agent-canvas")
				doc, _ := creationDocument(canvas.PayloadJSON)
				nodes, _ := creationObjects(doc["nodes"])
				nodes["original"]["metadata"].(map[string]any)["size"] = "1:1"
				raw, _ := json.Marshal(doc)
				if err := db.Model(canvas).Update("payload_json", string(raw)).Error; err != nil {
					t.Fatal(err)
				}
			case "reference-changed":
				if err := db.Model(&model.Resource{}).Where("id = ?", "ref-two").Update("size", 51).Error; err != nil {
					t.Fatal(err)
				}
			}
			err := s.DecideCloudAgentApproval("user", run.ID, approvalID, "approve", "", settings...)
			if scenario != "reference-changed" && err != nil {
				t.Fatal(err)
			}
			if err == nil {
				if err := s.advanceCloudAgentByID("user", run.ID); err != nil {
					t.Fatal(err)
				}
			}
			run, state = agentInterjectionState(t, s, run.ID)
			if scenario == "reference-changed" {
				var count int64
				if err := db.Model(&model.Task{}).Where("agent_run_id = ? AND type = ?", run.ID, "canvas_video").Count(&count).Error; err != nil {
					t.Fatal(err)
				}
				if state.MediaTaskID != "" || count != 0 {
					t.Fatalf("引用已变化仍提交收费任务：%s %d", state.MediaTaskID, count)
				}
				return
			}
			if state.MediaTaskID == "" {
				t.Fatalf("未提交：%s %s", run.Status, run.FailureMessage)
			}
			task, err := s.repo.TaskForUser("user", state.MediaTaskID)
			if err != nil {
				t.Fatal(err)
			}
			var input canvasGenerationInput
			if err := json.Unmarshal([]byte(task.InputJSON), &input); err != nil {
				t.Fatal(err)
			}
			if input.Config.Size != size || input.Config.VideoSeconds != stringValue(seconds) {
				t.Fatalf("批准后的规格未冻结：%+v", input.Config)
			}
			if scenario == "replay" {
				if err := s.DecideCloudAgentApproval("user", run.ID, approvalID, "approve", ""); err != nil {
					t.Fatal(err)
				}
				var count int64
				if err := db.Model(&model.Task{}).Where("agent_run_id = ? AND type = ?", run.ID, "canvas_video").Count(&count).Error; err != nil {
					t.Fatal(err)
				}
				if count != 1 {
					t.Fatalf("重复审批创建 %d 个任务", count)
				}
			}
		})
	}
}

func TestCloudAgentMediaSourceChoicePrecedesQuoteAndCannotBeBypassed(t *testing.T) {
	for _, scenario := range []struct {
		source    string
		omitModel bool
	}{{"original", false}, {"", false}, {"original", true}, {"", true}} {
		choice := scenario.source
		name := firstNonEmpty(choice, "independent")
		if scenario.omitModel {
			name += "-without-model"
		}
		t.Run(name, func(t *testing.T) {
			s, db, a := agentMediaFixture(t)
			seedAgentMediaVersion(t, s, db)
			run, state := agentMediaRun(t, s, a, "request_approval")
			call := cloudAgentCall{ID: "original-problem"}
			call.Function.Name = "generate_media"
			call.Function.Arguments = `{"mode":"video","prompt":"只修改原片结尾，保持9:16竖屏","channelId":"channel","channelModelKey":"seedance-test","referenceNodeIds":["hero","cat"]}`
			if scenario.omitModel {
				call.Function.Arguments = strings.Replace(call.Function.Arguments, `,"channelId":"channel","channelModelKey":"seedance-test"`, "", 1)
				state.event(run.ID, "tool_completed", map[string]any{"toolName": "model_list", "arguments": `{"mode":"video","referenceNodeIds":["hero","cat"]}`, "result": map[string]any{"models": []map[string]any{{"capability": "video", "selection": map[string]any{"channelId": "channel", "channelModelKey": "seedance-test"}}}}})
			}
			state.Calls = []cloudAgentCall{call}
			if err := s.repo.MutateCloudAgent("user", run.ID, run.Revision, func(current *model.CloudAgentExecution, _ *repository.Repository) error {
				return cloudAgentSave(current, &state)
			}); err != nil {
				t.Fatal(err)
			}
			if err := s.advanceCloudAgentByID("user", run.ID); err != nil {
				t.Fatal(err)
			}
			run, state = agentInterjectionState(t, s, run.ID)
			if state.Approval == nil || len(state.Approval.SourceChoices) != 2 || state.Approval.Prepared != nil {
				t.Fatalf("漏传来源没有在报价前被阻止：%s %+v", run.Status, state.Approval)
			}
			sourceApprovalID := state.Approval.ID
			if err := s.DecideCloudAgentApproval("user", run.ID, sourceApprovalID, "approve", ""); err == nil {
				t.Fatal("没有来源选择也批准了生成")
			}
			invalid := "other-canvas-node"
			if err := s.DecideCloudAgentApproval("user", run.ID, sourceApprovalID, "approve", "", &CloudAgentMediaSettings{InheritFromNodeID: &invalid}); err == nil {
				t.Fatal("接受了非当前审批的来源")
			}
			var count int64
			if err := db.Model(&model.Task{}).Where("agent_run_id = ? AND type = ?", run.ID, "canvas_video").Count(&count).Error; err != nil {
				t.Fatal(err)
			}
			if count != 0 {
				t.Fatal("来源未确认就产生了任务")
			}
			settings := &CloudAgentMediaSettings{InheritFromNodeID: &choice}
			key := cloudAgentApprovalFollowUpKey(run.ID, sourceApprovalID)
			if choice != "" && !s.claimCloudAgentApprovalFollowUp(key) {
				t.Fatal("无法模拟审批收尾中断")
			}
			if err := s.DecideCloudAgentApproval("user", run.ID, sourceApprovalID, "approve", "", settings); err != nil {
				t.Fatal(err)
			}
			if choice != "" {
				s.releaseCloudAgentApprovalFollowUp(key)
				run, state = agentInterjectionState(t, s, run.ID)
				if !cloudAgentApprovedCallPending(run, &state, sourceApprovalID) || state.MediaTaskID != "" {
					t.Fatal("来源决定落库后不能恢复审批收尾")
				}
				if err := s.continueApprovedCloudAgentCall("user", run.ID, sourceApprovalID); err != nil {
					t.Fatal(err)
				}
			}
			run, state = agentInterjectionState(t, s, run.ID)
			if state.Approval == nil || state.Approval.ID == sourceApprovalID || state.Approval.Prepared == nil || len(state.Approval.SourceChoices) != 0 || state.MediaTaskID != "" {
				t.Fatalf("来源确认被当成收费授权，或未进入新的规格审批：%s %+v", run.Status, state.Approval)
			}
			var resolved cloudAgentMediaArgs
			if err := json.Unmarshal([]byte(state.Approval.Call.Function.Arguments), &resolved); err != nil {
				t.Fatal(err)
			}
			wantSize := "9:16"
			if choice == "" {
				wantSize = "16:9"
			}
			if resolved.Size != wantSize {
				t.Fatalf("来源确认后规格不正确：%s", resolved.Size)
			}
			if err := s.DecideCloudAgentApproval("user", run.ID, sourceApprovalID, "approve", "", settings); err != nil {
				t.Fatal(err)
			}
			probe := cloudAgentMediaArgs{Mode: "video", NodeID: "another-target"}
			if err := s.resolveCloudAgentMediaSource(run, &state, call, &probe); err != nil || probe.InheritFromNodeID != choice {
				t.Fatalf("持久化绑定未恢复：%+v %v", probe, err)
			}
			probe.InheritFromNodeID = "different-source"
			if err := s.resolveCloudAgentMediaSource(run, &state, call, &probe); err == nil {
				t.Fatal("模型改写了已确认来源")
			}
			state.Step++
			probe.InheritFromNodeID = ""
			var required *cloudAgentMediaSourceRequired
			if err := s.resolveCloudAgentMediaSource(run, &state, call, &probe); !errors.As(err, &required) {
				t.Fatalf("后续步骤借用了旧调用的确认：%v", err)
			}
			approveAgentMediaDraft(t, s, run.ID)
			run, state = agentInterjectionState(t, s, run.ID)
			if state.MediaTaskID == "" {
				t.Fatalf("最终规格审批未提交：%s %s", run.Status, run.FailureMessage)
			}
			task, err := s.repo.TaskForUser("user", state.MediaTaskID)
			if err != nil {
				t.Fatal(err)
			}
			var input canvasGenerationInput
			if err := json.Unmarshal([]byte(task.InputJSON), &input); err != nil {
				t.Fatal(err)
			}
			if input.Config.Size != wantSize {
				t.Fatalf("提交规格偏离最后批准值：%s", input.Config.Size)
			}
		})
	}
}

func TestCloudAgentMediaInheritancePreservesExplicitAudioMode(t *testing.T) {
	s, db, _ := agentMediaFixture(t)
	if err := db.Create(&model.Resource{ID: "voice-ref", UserID: "user", Kind: "audio", Status: model.ResourceStatusReady, MimeType: "audio/mpeg", Size: 100}).Error; err != nil {
		t.Fatal(err)
	}
	canvas, _ := s.repo.CanvasProjectForUser("user", "agent-canvas")
	doc, _ := creationDocument(canvas.PayloadJSON)
	doc["nodes"] = append(creationMaps(doc["nodes"]), map[string]any{"id": "audio-draft", "type": "audio", "metadata": map[string]any{"status": "idle", "audioMode": "tts", "channelId": "channel", "channelModelKey": "audio-test"}}, map[string]any{"id": "voice-node", "type": "audio", "metadata": map[string]any{"status": "success", "storageKey": "resource:voice-ref"}})
	raw, _ := json.Marshal(doc)
	if err := db.Model(canvas).Update("payload_json", string(raw)).Error; err != nil {
		t.Fatal(err)
	}
	a := cloudAgentMediaArgs{Mode: "audio", AudioMode: "unified_edit", Prompt: "按参考音频编辑", ChannelID: "channel", ChannelModelKey: "audio-test", NodeID: "audio-draft", ReferenceNodeIDs: []string{"voice-node"}}
	run, state := agentMediaRun(t, s, a, "request_approval")
	_, plan, err := s.prepareCloudAgentMedia(run, &state, agentMediaCall(a))
	if err != nil {
		t.Fatal(err)
	}
	if plan.Args.AudioMode != "unified_edit" {
		t.Fatalf("显式模式被覆盖：%s", plan.Args.AudioMode)
	}
}

func TestCloudAgentMediaInheritanceRejectsMaskInsteadOfDroppingIt(t *testing.T) {
	s, db, a := agentMediaFixture(t)
	seedAgentMediaVersion(t, s, db)
	logical := seedAgentLogicalImageModel(t, s, db)
	input := map[string]any{"mode": "image", "prompt": "局部重绘", "config": map[string]any{"size": "16:9", "imageResolution": "2k", "quality": "high"}, "metadata": map[string]any{"nodeId": "original"}, "referenceImages": []any{map[string]any{"id": "hero", "storageKey": "resource:ref-two"}}, "mask": map[string]any{"id": "cat", "storageKey": "resource:ref-one"}}
	raw, _ := json.Marshal(input)
	if err := db.Model(&model.Task{}).Where("id = ?", "original-task").Updates(map[string]any{"type": "canvas_image", "logical_model_id": logical.ID, "input_json": string(raw)}).Error; err != nil {
		t.Fatal(err)
	}
	canvas, _ := s.repo.CanvasProjectForUser("user", "agent-canvas")
	doc, _ := creationDocument(canvas.PayloadJSON)
	nodes, _ := creationObjects(doc["nodes"])
	nodes["original"]["type"] = "image"
	raw, _ = json.Marshal(doc)
	if err := db.Model(canvas).Update("payload_json", string(raw)).Error; err != nil {
		t.Fatal(err)
	}
	run, state := agentMediaRun(t, s, a, "request_approval")
	call := cloudAgentCall{ID: "image-revision"}
	call.Function.Name, call.Function.Arguments = "generate_media", `{"mode":"image","prompt":"仅修改局部","inheritFromNodeId":"original"}`
	_, _, err := s.prepareCloudAgentMedia(run, &state, call)
	var fieldErr *cloudAgentFieldArgumentError
	if !errors.As(err, &fieldErr) || fieldErr.Field != "inheritFromNodeId" {
		t.Fatalf("蒙版未被明确拒绝：%v", err)
	}
}

func TestCloudAgentMediaSourceBindingRejectsChangedGeneration(t *testing.T) {
	s, db, a := agentMediaFixture(t)
	seedAgentMediaVersion(t, s, db)
	run, state := agentMediaRun(t, s, a, "request_approval")
	call := agentMediaCall(a)
	state.MediaSourceBindings = map[string]cloudAgentMediaSourceBinding{cloudAgentMediaSourceBindingKey(&state, call): {NodeID: "original", TaskID: "original-task"}}
	original, err := s.repo.TaskForUser("user", "original-task")
	if err != nil {
		t.Fatal(err)
	}
	original.ID = "replacement-task"
	if err := db.Create(original).Error; err != nil {
		t.Fatal(err)
	}
	canvas, _ := s.repo.CanvasProjectForUser("user", "agent-canvas")
	doc, _ := creationDocument(canvas.PayloadJSON)
	nodes, _ := creationObjects(doc["nodes"])
	nodes["original"]["metadata"].(map[string]any)["taskId"] = "replacement-task"
	raw, _ := json.Marshal(doc)
	if err := db.Model(canvas).Update("payload_json", string(raw)).Error; err != nil {
		t.Fatal(err)
	}
	a.SnapshotHash = ""
	_, _, err = s.prepareCloudAgentMedia(run, &state, agentMediaCall(a))
	var fieldErr *cloudAgentFieldArgumentError
	if !errors.As(err, &fieldErr) || fieldErr.Field != "inheritFromNodeId" {
		t.Fatalf("来源节点换了执行版本却继续继承：%v", err)
	}
}

func TestCloudAgentMediaSourceChoicesDistinguishSameTitleVersions(t *testing.T) {
	s, db, a := agentMediaFixture(t)
	seedAgentMediaVersion(t, s, db)
	task, err := s.repo.TaskForUser("user", "original-task")
	if err != nil {
		t.Fatal(err)
	}
	var input map[string]any
	if err := json.Unmarshal([]byte(task.InputJSON), &input); err != nil {
		t.Fatal(err)
	}
	input["metadata"].(map[string]any)["nodeId"] = "second"
	input["config"].(map[string]any)["size"] = "16:9"
	raw, _ := json.Marshal(input)
	task.ID, task.InputJSON = "second-task", string(raw)
	if err := db.Create(task).Error; err != nil {
		t.Fatal(err)
	}
	canvas, _ := s.repo.CanvasProjectForUser("user", "agent-canvas")
	doc, _ := creationDocument(canvas.PayloadJSON)
	nodes, _ := creationObjects(doc["nodes"])
	nodes["original"]["title"] = "视频创作"
	doc["nodes"] = append(creationMaps(doc["nodes"]), map[string]any{"id": "second", "type": "video", "title": "视频创作", "metadata": map[string]any{"status": "success", "taskId": "second-task"}})
	raw, _ = json.Marshal(doc)
	if err := db.Model(canvas).Update("payload_json", string(raw)).Error; err != nil {
		t.Fatal(err)
	}
	run, state := agentMediaRun(t, s, a, "request_approval")
	call := cloudAgentCall{ID: "choose-source"}
	call.Function.Name, call.Function.Arguments = "generate_media", `{"mode":"video","prompt":"只修改结尾","channelId":"channel","channelModelKey":"seedance-test"}`
	_, _, err = s.prepareCloudAgentMedia(run, &state, call)
	var required *cloudAgentMediaSourceRequired
	if !errors.As(err, &required) || len(required.Choices) != 3 {
		t.Fatalf("来源选择不完整：%v", err)
	}
	seen := map[string]bool{}
	for _, choice := range required.Choices {
		if seen[choice.Label] {
			t.Fatalf("同名版本无法区分：%q", choice.Label)
		}
		seen[choice.Label] = true
		if choice.NodeID != "" && !strings.Contains(choice.Label, choice.NodeID) {
			t.Fatalf("来源缺少稳定身份：%+v", choice)
		}
		if choice.NodeID == "original" && !strings.Contains(choice.Label, "9:16") {
			t.Fatalf("误用了原节点后来选择的画幅：%s", choice.Label)
		}
		if choice.NodeID == "second" && !strings.Contains(choice.Label, "16:9") {
			t.Fatalf("第二版画幅错误：%s", choice.Label)
		}
	}
}

func TestCloudAgentMediaInheritancePreservesReferenceSyncChoice(t *testing.T) {
	for _, enableInApproval := range []bool{false, true} {
		t.Run(map[bool]string{false: "inherit-disabled", true: "explicitly-enable"}[enableInApproval], func(t *testing.T) {
			s, db, a := agentMediaFixture(t)
			seedAgentMediaVersion(t, s, db)
			original, err := s.repo.TaskForUser("user", "original-task")
			if err != nil {
				t.Fatal(err)
			}
			var originalInput map[string]any
			if err := json.Unmarshal([]byte(original.InputJSON), &originalInput); err != nil {
				t.Fatal(err)
			}
			originalInput["config"].(map[string]any)["videoArkPrivateAssetUpload"] = "false"
			raw, _ := json.Marshal(originalInput)
			if err := db.Model(original).Update("input_json", string(raw)).Error; err != nil {
				t.Fatal(err)
			}
			run, state := agentMediaRun(t, s, a, "request_approval")
			call := cloudAgentCall{ID: "sync-choice-version"}
			call.Function.Name, call.Function.Arguments = "generate_media", `{"mode":"video","prompt":"仅改结尾","inheritFromNodeId":"original"}`
			state.Calls = []cloudAgentCall{call}
			if err := s.repo.MutateCloudAgent("user", run.ID, run.Revision, func(current *model.CloudAgentExecution, _ *repository.Repository) error {
				return cloudAgentSave(current, &state)
			}); err != nil {
				t.Fatal(err)
			}
			if err := s.advanceCloudAgentByID("user", run.ID); err != nil {
				t.Fatal(err)
			}
			run, state = agentInterjectionState(t, s, run.ID)
			if state.Approval == nil {
				t.Fatalf("未进入审批：%s %s", run.Status, run.FailureMessage)
			}
			var approved cloudAgentMediaArgs
			if err := json.Unmarshal([]byte(state.Approval.Call.Function.Arguments), &approved); err != nil {
				t.Fatal(err)
			}
			if approved.VideoArkPrivateAssetUpload == nil || *approved.VideoArkPrivateAssetUpload {
				t.Fatal("报价审批丢失了同步关闭选项")
			}
			if enableInApproval {
				settings := &CloudAgentMediaSettings{ChannelID: approved.ChannelID, ChannelModelKey: approved.ChannelModelKey, Size: approved.Size, Quality: approved.Quality, DurationSeconds: &approved.Duration, VideoGenerateAudio: approved.VideoGenerateAudio, VideoWatermark: approved.VideoWatermark, VideoArkPrivateAssetUpload: &enableInApproval}
				if err := s.DecideCloudAgentApproval("user", run.ID, state.Approval.ID, "approve", "", settings); err != nil {
					t.Fatal(err)
				}
				if err := s.advanceCloudAgentByID("user", run.ID); err != nil {
					t.Fatal(err)
				}
			} else {
				approveAgentMediaDraft(t, s, run.ID)
			}
			run, state = agentInterjectionState(t, s, run.ID)
			if state.MediaTaskID == "" {
				t.Fatalf("未提交任务：%s %s", run.Status, run.FailureMessage)
			}
			task, err := s.repo.TaskForUser("user", state.MediaTaskID)
			if err != nil {
				t.Fatal(err)
			}
			var actual canvasGenerationInput
			if err := json.Unmarshal([]byte(task.InputJSON), &actual); err != nil {
				t.Fatal(err)
			}
			if actual.Config.ArkPrivateAssetUpload != stringValue(enableInApproval) {
				t.Fatalf("同步选项偏离用户决定：%q", actual.Config.ArkPrivateAssetUpload)
			}
			canvas, _ := s.repo.CanvasProjectForUser("user", "agent-canvas")
			doc, _ := creationDocument(canvas.PayloadJSON)
			nodes, _ := creationObjects(doc["nodes"])
			meta := nodes[stringValue(actual.Metadata["nodeId"])]["metadata"].(map[string]any)
			if meta["arkPrivateAssetUpload"] != stringValue(enableInApproval) {
				t.Fatalf("节点设置镜像不同步：%+v", meta)
			}
			options := meta["generationSpec"].(map[string]any)["options"].(map[string]any)
			if options["arkPrivateAssetUpload"] != enableInApproval {
				t.Fatalf("生成合同未保存同步选项：%+v", options)
			}
		})
	}
}
