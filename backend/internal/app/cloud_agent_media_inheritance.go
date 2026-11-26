package app

import (
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"gorm.io/gorm"
	"yingce/backend/internal/canvas/contract"
	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"
)

type cloudAgentMediaSourceChoice struct {
	NodeID string `json:"nodeId"`
	Label  string `json:"label"`
	TaskID string `json:"taskId,omitempty"`
}

type cloudAgentMediaSourceBinding struct {
	NodeID string `json:"nodeId"`
	TaskID string `json:"taskId,omitempty"`
}

type cloudAgentMediaSourceRequired struct{ Choices []cloudAgentMediaSourceChoice }

func (e *cloudAgentMediaSourceRequired) Error() string {
	return "画布已有生成版本，请先由用户确认版本来源或独立创作；尚未报价或提交任务"
}

func cloudAgentMediaSourceBindingKey(state *cloudAgentRuntime, call cloudAgentCall) string {
	return fmt.Sprintf("%d:%d:%s", state.Step, state.CallIndex, call.ID)
}

// 焦点和提示词不能证明修改对象；存在可继承版本时，省略来源必须进入用户确认。
func (s *Service) resolveCloudAgentMediaSource(run *model.CloudAgentExecution, state *cloudAgentRuntime, call cloudAgentCall, a *cloudAgentMediaArgs) error {
	if source, confirmed := state.MediaSourceBindings[cloudAgentMediaSourceBindingKey(state, call)]; confirmed {
		if a.InheritFromNodeID != "" && a.InheritFromNodeID != source.NodeID {
			return cloudAgentFieldError("inheritFromNodeId", "conflict", "来源与用户已确认的当前调用不一致，请重新申请生成")
		}
		a.InheritFromNodeID, a.InheritanceTaskID = source.NodeID, source.TaskID
		return nil
	}
	// 已冻结的调用，以及同一报价卡内的用户参数编辑，不因新增无关作品重新猜来源。
	if a.Prepared != nil {
		return nil
	}
	if state.Approval != nil && state.Approval.Prepared != nil && state.Approval.Call.ID == call.ID {
		var target struct {
			NodeID string `json:"nodeId"`
		}
		if json.Unmarshal([]byte(state.Approval.Call.Function.Arguments), &target) == nil && target.NodeID == a.NodeID {
			return nil
		}
	}
	if a.InheritFromNodeID != "" || call.Function.Name != "generate_media" {
		return nil
	}
	canvas, err := s.repo.CanvasProjectForUser(run.UserID, state.Request.CanvasID)
	if err != nil {
		return err
	}
	doc, err := creationDocument(canvas.PayloadJSON)
	if err != nil {
		return err
	}
	nodes, err := creationObjects(doc["nodes"])
	if err != nil {
		return err
	}
	if target := nodes[a.NodeID]; target != nil {
		meta, _ := target["metadata"].(map[string]any)
		a.InheritFromNodeID = stringValue(meta["inheritFromNodeId"])
		if a.InheritFromNodeID != "" {
			return nil
		}
		// 批量工具必须使用已存在的逐项占位节点，其规格按批量审批合同处理。
		if state.CallIndex >= 0 && state.CallIndex < len(state.Calls) && state.Calls[state.CallIndex].Function.Name == "generate_media_batch" {
			return nil
		}
	}
	choices := []cloudAgentMediaSourceChoice{{Label: "独立新建，不继承已有版本"}}
	for _, node := range creationMaps(doc["nodes"]) {
		if stringValue(node["type"]) != a.Mode {
			continue
		}
		meta, _ := node["metadata"].(map[string]any)
		taskID := firstNonEmpty(stringValue(meta["generationTaskId"]), stringValue(meta["taskId"]))
		if taskID == "" {
			continue
		}
		task, err := s.repo.TaskForUser(run.UserID, taskID)
		if errors.Is(err, gorm.ErrRecordNotFound) {
			continue
		}
		if err != nil {
			return err
		}
		var input struct {
			Mode     string         `json:"mode"`
			Config   map[string]any `json:"config"`
			Metadata struct {
				NodeID string `json:"nodeId"`
			} `json:"metadata"`
		}
		id := stringValue(node["id"])
		if task.ProjectID != canvas.ID || task.Type != "canvas_"+a.Mode || task.Status != model.TaskStatusSucceeded || json.Unmarshal([]byte(task.InputJSON), &input) != nil || input.Mode != a.Mode || input.Metadata.NodeID != id {
			continue
		}
		// 同名标题不能作为版本身份；画幅来自原执行输入，节点 ID 保证同规格版本也可区分。
		label := firstNonEmpty(stringValue(node["title"]), id) + " · " + id
		if size := stringValue(input.Config["size"]); size != "" {
			label = size + " · " + label
		}
		choices = append(choices, cloudAgentMediaSourceChoice{NodeID: id, Label: label, TaskID: task.ID})
	}
	if len(choices) > 1 {
		return &cloudAgentMediaSourceRequired{Choices: choices}
	}
	return nil
}

func (s *Service) requestCloudAgentMediaSourceApproval(run *model.CloudAgentExecution, state *cloudAgentRuntime, call cloudAgentCall, required *cloudAgentMediaSourceRequired) error {
	return s.repo.MutateCloudAgent(run.UserID, run.ID, run.Revision, func(current *model.CloudAgentExecution, _ *repository.Repository) error {
		preview := cloudAgentApprovalPreview{Kind: "media_source", Title: "确认生成来源", Description: "请选择基于哪一版修改，或明确独立新建。确认来源后才解析规格和报价，本次确认不会提交收费任务。", Items: []cloudAgentApprovalPreviewItem{{Operation: "generate_media", Summary: "选择原片版本或独立创作"}}}
		state.Approval = &cloudAgentApproval{ID: fmt.Sprintf("%s-source-%d-%d", run.ID, state.Step, state.CallIndex), Call: call, CallHash: cloudAgentApprovalCallHash(call), Preview: preview, SourceChoices: required.Choices}
		current.Status = "waiting_approval"
		state.PiResumePrompt = ""
		state.event(run.ID, "approval_requested", map[string]any{"approvalId": state.Approval.ID, "toolName": call.Function.Name, "arguments": json.RawMessage(call.Function.Arguments), "preview": preview, "sourceChoices": required.Choices, "text": preview.Description})
		return cloudAgentSave(current, state)
	})
}

// 来源决定是可信控制面写入，与随后确认实际规格和费用的生成审批分开记账。
func (s *Service) decideCloudAgentMediaSource(run *model.CloudAgentExecution, state *cloudAgentRuntime, settings *CloudAgentMediaSettings) error {
	if settings == nil || settings.InheritFromNodeID == nil {
		return BadAuthRequest("请明确选择原片版本或独立创作，不能直接批准生成")
	}
	source := *settings.InheritFromNodeID
	allowed := false
	var sourceTaskID string
	for _, choice := range state.Approval.SourceChoices {
		if source == choice.NodeID {
			allowed, sourceTaskID = true, choice.TaskID
		}
	}
	if !allowed || state.CallIndex < 0 || state.CallIndex >= len(state.Calls) {
		return BadAuthRequest("来源不属于当前审批，请重新读取")
	}
	call := state.Approval.Call
	if cloudAgentApprovalCallHash(state.Calls[state.CallIndex]) != state.Approval.CallHash {
		return creationConflict("待确认的来源调用已变化")
	}
	var args map[string]json.RawMessage
	if err := decodeCloudAgentJSONObject(call.Function.Arguments, &args); err != nil {
		return err
	}
	// 保留原调用的字段存在性，不能把省略的模型选择或引用变成显式空值。
	encodedSource, err := json.Marshal(source)
	if err != nil {
		return err
	}
	args["inheritFromNodeId"] = encodedSource
	delete(args, "snapshotHash")
	if source != "" {
		// 来源选择表示新建版本，原片和已有目标草稿都不能被当作待覆盖的产物。
		delete(args, "nodeId")
	}
	raw, err := json.Marshal(args)
	if err != nil {
		return err
	}
	call.Function.Arguments = string(raw)
	approvalID := state.Approval.ID
	key := cloudAgentApprovalFollowUpKey(run.ID, approvalID)
	followUp := s.claimCloudAgentApprovalFollowUp(key)
	if followUp {
		defer s.releaseCloudAgentApprovalFollowUp(key)
	}
	err = s.repo.MutateCloudAgent(run.UserID, run.ID, run.Revision, func(current *model.CloudAgentExecution, _ *repository.Repository) error {
		if state.MediaSourceBindings == nil {
			state.MediaSourceBindings = map[string]cloudAgentMediaSourceBinding{}
		}
		state.MediaSourceBindings[cloudAgentMediaSourceBindingKey(state, call)] = cloudAgentMediaSourceBinding{NodeID: source, TaskID: sourceTaskID}
		id := state.Approval.ID
		state.Decisions[id] = "approve"
		if state.DecisionSettings == nil {
			state.DecisionSettings = map[string]string{}
		}
		state.DecisionSettings[id] = creationHash(settings)
		state.Calls[state.CallIndex] = call
		// 保留已批准的来源阶段，进程中断后由原有审批收尾接管，不能启动新的模型步骤。
		state.Approval.Call, state.Approval.CallHash, state.Approval.Decision = call, cloudAgentApprovalCallHash(call), "approve"
		current.Status = "running"
		state.event(run.ID, "approval_decided", map[string]any{"approvalId": id, "decision": "approve", "arguments": json.RawMessage(call.Function.Arguments), "text": "生成来源已确认，接下来核对实际规格与费用；尚未提交任务"})
		return cloudAgentSave(current, state)
	})
	if err != nil || !followUp {
		return err
	}
	return s.continueApprovedCloudAgentCall(run.UserID, run.ID, approvalID)
}

// 版本来源与文本来源、媒体参考分开；只读取当前用户当前画布已完成任务的执行输入。
// 不复制凭据、账单或任务身份，也不从原片尺寸、标题和最近任务推测规格。
func (s *Service) inheritCloudAgentMediaConfiguration(userID, canvasID string, a *cloudAgentMediaArgs, raw string) error {
	if a.Prepared != nil {
		config, _ := a.Prepared.Input["config"].(map[string]any)
		options, err := contract.OptionsFromTaskConfig(a.Mode, config)
		a.InheritedOptions = &options
		return err
	}
	if a.InheritFromNodeID == "" {
		return nil
	}
	fail := func() error {
		return cloudAgentFieldError("inheritFromNodeId", "invalid_value", "版本来源须为当前画布同类型的已完成生成节点，且原任务及引用仍可验证；请重新读取画布，不要省略来源后重试")
	}
	canvas, err := s.repo.CanvasProjectForUser(userID, canvasID)
	if err != nil {
		return err
	}
	doc, err := creationDocument(canvas.PayloadJSON)
	if err != nil {
		return err
	}
	nodes, err := creationObjects(doc["nodes"])
	if err != nil {
		return err
	}
	if target := nodes[a.NodeID]; target != nil {
		meta, _ := target["metadata"].(map[string]any)
		if stringValue(meta["inheritFromNodeId"]) != a.InheritFromNodeID {
			return fail()
		}
		_, options, err := cloudAgentMediaDraftConfiguration(*a, doc)
		a.InheritedOptions = &options
		return err
	}
	node := nodes[a.InheritFromNodeID]
	if node == nil || a.InheritFromNodeID == a.NodeID || stringValue(node["type"]) != a.Mode {
		return fail()
	}
	meta, _ := node["metadata"].(map[string]any)
	taskID := stringValue(meta["generationTaskId"])
	if taskID == "" {
		taskID = stringValue(meta["taskId"])
	}
	if a.InheritanceTaskID != "" && taskID != a.InheritanceTaskID {
		return cloudAgentFieldError("inheritFromNodeId", "conflict", "确认期间原节点已切换生成版本，请重新确认来源；未提交生成任务")
	}
	task, err := s.repo.TaskForUser(userID, taskID)
	if err != nil || task.ProjectID != canvasID || task.Type != "canvas_"+a.Mode || task.Status != model.TaskStatusSucceeded {
		return fail()
	}
	var input map[string]any
	if json.Unmarshal([]byte(task.InputJSON), &input) != nil || stringValue(input["mode"]) != a.Mode {
		return fail()
	}
	// 当前工具没有蒙版输入合同，不能把局部重绘悄悄变成整图编辑。
	if input["mask"] != nil {
		return cloudAgentFieldError("inheritFromNodeId", "unsupported_value", "原任务使用了蒙版，当前 Agent 不能完整继承；请从原图片编辑入口继续，未提交生成任务")
	}
	metadata, _ := input["metadata"].(map[string]any)
	if stringValue(metadata["nodeId"]) != a.InheritFromNodeID {
		return fail()
	}
	config, ok := input["config"].(map[string]any)
	if !ok {
		return fail()
	}
	options, err := contract.OptionsFromTaskConfig(a.Mode, config)
	if err != nil {
		return fail()
	}
	if (a.Mode == "video" && (options.Size == nil || options.DurationSeconds == nil)) || (a.Mode == "image" && options.Size == nil) {
		return fail()
	}
	if !a.ConfigurationChange.includes("model") {
		a.LogicalModelID, a.ChannelID, a.ChannelModelKey = task.LogicalModelID, "", ""
		if task.LogicalModelID == "" {
			a.ChannelID, a.ChannelModelKey = stringValue(config["channelId"]), stringValue(config["channelModelKey"])
		}
	}
	a.InheritedOptions = &options
	var provided map[string]json.RawMessage
	if json.Unmarshal([]byte(raw), &provided) != nil {
		return fail()
	}
	// nil 表示省略，显式 [] 表示清空；继承引用必须仍指向原执行使用的资源。
	if _, exists := provided["referenceNodeIds"]; !exists || a.ReferenceNodeIDs == nil {
		for _, field := range []string{"referenceImages", "referenceVideos", "referenceAudios", "referenceCharacters"} {
			for _, ref := range creationMaps(input[field]) {
				id := stringValue(ref["id"])
				current := nodes[id]
				if current == nil || id == "" {
					return fail()
				}
				currentMeta, _ := current["metadata"].(map[string]any)
				if key := stringValue(ref["storageKey"]); key != "" && (!strings.HasPrefix(key, "resource:") || stringValue(currentMeta["storageKey"]) != key) {
					return fail()
				}
				a.ReferenceNodeIDs = append(a.ReferenceNodeIDs, id)
			}
		}
	}
	for _, frame := range []struct {
		key   string
		value *string
	}{{"videoStartFrameNodeId", &a.VideoStartFrameNodeID}, {"videoEndFrameNodeId", &a.VideoEndFrameNodeID}} {
		if _, exists := provided[frame.key]; !exists {
			*frame.value = stringValue(metadata[frame.key])
		}
	}
	if _, exists := provided["audioVoiceBindings"]; !exists {
		encoded, err := json.Marshal(input["audioVoiceBindings"])
		if err != nil || json.Unmarshal(encoded, &a.AudioVoiceBindings) != nil {
			return fail()
		}
	}
	return nil
}
