package app

import (
	"encoding/json"
	"fmt"
	"sort"
	"strings"

	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"
)

type cloudAgentCreationOutputRef struct {
	TaskID      string `json:"taskId"`
	OutputIndex int    `json:"outputIndex"`
}

func cloudAgentCreationSessionTask(repo *repository.Repository, userID string, state *cloudAgentRuntime, taskID string) (*model.Task, error) {
	if state.Request.Surface != "creation" || state.Request.SessionID == "" {
		return nil, BadAuthRequest("当前入口没有创作会话")
	}
	task, err := repo.TaskForUser(userID, taskID)
	if err != nil {
		return nil, err
	}
	if cloudAgentCreationContextAllowsTask(state.Request, task) && (task.Type == "canvas_image" || task.Type == "canvas_video") {
		return task, nil
	}
	owner, err := repo.CloudAgent(userID, task.AgentRunID)
	if err != nil || owner.Surface != "creation" || owner.SessionID != state.Request.SessionID || task.ProjectID != "" || (task.Type != "canvas_image" && task.Type != "canvas_video") {
		return nil, BadAuthRequest("只能读取本会话的图片或视频任务")
	}
	return task, nil
}

func cloudAgentCreationTaskOutputs(task *model.Task) []map[string]any {
	var result map[string]any
	if task.Status != model.TaskStatusSucceeded || json.Unmarshal([]byte(task.ResultJSON), &result) != nil {
		return nil
	}
	media := creationMaps(result["images"])
	if video, ok := result["video"].(map[string]any); ok {
		media = append(media, video)
	}
	outputs := make([]map[string]any, 0, len(media))
	for i, item := range media {
		id := stringField(item, "resourceId")
		if id == "" && strings.HasPrefix(stringField(item, "storageKey"), "resource:") {
			id = strings.TrimPrefix(stringField(item, "storageKey"), "resource:")
		}
		// Keep the exact output position even when a legacy output has no usable resource.
		outputs = append(outputs, map[string]any{"outputIndex": i + 1, "resourceId": id, "ready": id != ""})
	}
	return outputs
}

func cloudAgentCreationOutputResource(repo *repository.Repository, userID string, state *cloudAgentRuntime, ref cloudAgentCreationOutputRef) (*model.Resource, *model.Task, error) {
	task, err := cloudAgentCreationSessionTask(repo, userID, state, ref.TaskID)
	if err != nil {
		return nil, nil, err
	}
	outputs := cloudAgentCreationTaskOutputs(task)
	if ref.OutputIndex < 1 || ref.OutputIndex > len(outputs) {
		return nil, nil, BadAuthRequest("该任务的指定成品尚未生成或序号不存在，请先查真实任务结果")
	}
	id := stringField(outputs[ref.OutputIndex-1], "resourceId")
	resource, err := repo.ResourceForUser(userID, id)
	if err != nil || resource.Status != model.ResourceStatusReady || !(strings.HasPrefix(resource.MimeType, "image/") || strings.HasPrefix(resource.MimeType, "video/")) {
		return nil, nil, BadAuthRequest("成品资源尚未就绪、已删除或不属于当前用户")
	}
	return resource, task, nil
}

// The catalogue is metadata only. Reading one exact output authorizes that
// source for this turn; it never silently adds every historical image to a job.
func cloudAgentCreationMediaRead(repo *repository.Repository, userID string, state *cloudAgentRuntime, call cloudAgentCall) (any, error) {
	var args struct {
		TaskID      string `json:"taskId"`
		OutputIndex int    `json:"outputIndex"`
		RunID       string `json:"runId"`
		Offset      int    `json:"offset"`
		ResourceID  string `json:"resourceId"`
		BeforeRunID string `json:"beforeRunId"`
	}
	if err := decodeCloudAgentJSONObject(call.Function.Arguments, &args); err != nil {
		return nil, cloudAgentJSONArgumentError(err)
	}
	if state.Request.Surface != "creation" || state.Request.SessionID == "" || args.Offset < 0 {
		return nil, BadAuthRequest("需要当前创作会话及有效目录位置")
	}
	if args.ResourceID != "" {
		if args.TaskID != "" || args.OutputIndex != 0 {
			return nil, BadAuthRequest("精读历史上传图与任务成品不能同时指定")
		}
		if args.RunID == "" {
			for _, attachment := range state.Request.Attachments {
				if attachment.ResourceID != args.ResourceID {
					continue
				}
				resource, err := repo.ResourceForUser(userID, attachment.ResourceID)
				if err != nil || resource.Status != model.ResourceStatusReady || !strings.HasPrefix(strings.ToLower(resource.MimeType), attachment.Kind+"/") {
					return nil, BadAuthRequest("本轮素材不存在、不属于当前用户、尚未就绪或媒体类型不匹配")
				}
				state.bindCreationImage(call.ID, attachment.ResourceID, attachment.Kind)
				return map[string]any{"resourceId": attachment.ResourceID, "kind": attachment.Kind, "name": attachment.Name, "guidance": "已选定当前上传素材；图片优先进入下一步模型视觉输入，实际是否附图以 visualInputStatus 为准。不改变用户附件或生成引用；需要回看其他图片时按 resourceId 或 taskId/outputIndex 精读。"}, nil
			}
		}
		attachment, err := cloudAgentCreationHistoricalAttachment(repo, userID, state, args.ResourceID, args.RunID)
		if err != nil {
			return nil, err
		}
		if len(state.CreationOutputRefs)+len(state.CreationAttachmentRefs) >= 16 {
			if _, exists := state.CreationAttachmentRefs[args.ResourceID]; !exists {
				return nil, BadAuthRequest("本轮最多精读 16 个历史素材，请缩小目标范围")
			}
		}
		if state.CreationAttachmentRefs == nil {
			state.CreationAttachmentRefs = map[string]string{}
		}
		state.CreationAttachmentRefs[args.ResourceID] = args.RunID
		state.bindCreationImage(call.ID, attachment.ResourceID, attachment.Kind)
		return map[string]any{"resourceId": attachment.ResourceID, "runId": args.RunID, "kind": attachment.Kind, "name": attachment.Name, "guidance": "已选定历史素材，仅作为后台上下文，不加入当前消息附件。图片优先进入下一步视觉输入，实际是否附图以 visualInputStatus 为准。需要引用时在生成参数 attachmentResourceIds 中明确指定，并用 references 说明用途；无关新创作不引用。"}, nil
	}
	if args.TaskID != "" {
		ref := cloudAgentCreationOutputRef{TaskID: args.TaskID, OutputIndex: args.OutputIndex}
		resource, task, err := cloudAgentCreationOutputResource(repo, userID, state, ref)
		if err != nil {
			return nil, err
		}
		if state.CreationOutputRefs == nil {
			state.CreationOutputRefs = map[string]cloudAgentCreationOutputRef{}
		}
		if len(state.CreationOutputRefs)+len(state.CreationAttachmentRefs) >= 16 {
			if _, exists := state.CreationOutputRefs[resource.ID]; !exists {
				return nil, BadAuthRequest("本轮最多精读 16 个成品，请缩小目标范围")
			}
		}
		state.CreationOutputRefs[resource.ID] = ref
		kind := strings.SplitN(resource.MimeType, "/", 2)[0]
		state.bindCreationImage(call.ID, resource.ID, kind)
		return map[string]any{"taskId": task.ID, "runId": task.AgentRunID, "outputIndex": args.OutputIndex, "resourceId": resource.ID, "kind": kind, "prompt": truncateRunes(task.Prompt, 1600), "guidance": "已选定此成品。编辑时将 resourceId 放入 attachmentResourceIds，references 说明保留与修改部分；仅查看不会自动把它作为生成参考。图片优先进入下一步视觉输入，实际是否附图以 visualInputStatus 为准；视频仅返回元数据。"}, nil
	}
	references, nextRunID, err := cloudAgentCreationHistoricalCatalogue(repo, userID, state, args.RunID, args.BeforeRunID)
	if err != nil {
		return nil, err
	}
	var ordinaryTaskIDs []string
	for _, entry := range state.Request.CreationContext {
		ordinaryTaskIDs = append(ordinaryTaskIDs, entry.TaskIDs...)
	}
	tasks, err := repo.CreationMediaTasks(userID, state.Request.SessionID, args.RunID, args.Offset, 21, ordinaryTaskIDs...)
	if err != nil {
		return nil, err
	}
	next := 0
	if len(tasks) > 20 {
		tasks, next = tasks[:20], args.Offset+20
	}
	items := make([]map[string]any, 0, len(tasks))
	for i := range tasks {
		task := &tasks[i]
		var input struct {
			Metadata struct {
				Title string `json:"title"`
			} `json:"metadata"`
		}
		_ = json.Unmarshal([]byte(task.InputJSON), &input)
		items = append(items, map[string]any{"taskIndex": args.Offset + i + 1, "taskId": task.ID, "runId": task.AgentRunID, "kind": strings.TrimPrefix(task.Type, "canvas_"), "title": input.Metadata.Title, "prompt": truncateRunes(task.Prompt, 1200), "status": task.Status, "outputs": cloudAgentCreationTaskOutputs(task)})
	}
	return map[string]any{"items": items, "references": references, "nextOffset": next, "nextBeforeRunId": nextRunID, "guidance": "items 为生成任务，按提交顺序列出；taskIndex 是任务序号，outputIndex 是任务内成品序号。references 为历史上传素材，仅元数据。先按用户意图定位目标：成品传 taskId/outputIndex，历史上传传 resourceId 及目录中的 runId（普通模式历史无 runId）。ready=false 不可选；多个合理候选先澄清。任务用 offset、历史上传用 beforeRunId 分别续页；查看目录不会把素材加入本轮附件或生成参考。"}, nil
}

func cloudAgentCreationRequestWithOutputs(repo *repository.Repository, userID string, state *cloudAgentRuntime) (CloudAgentRequest, error) {
	req := state.Request
	req.Attachments = append([]CloudAgentAttachment(nil), req.Attachments...)
	seen := map[string]bool{}
	for _, item := range req.Attachments {
		seen[item.ResourceID] = true
	}
	historyIDs := make([]string, 0, len(state.CreationAttachmentRefs))
	for id := range state.CreationAttachmentRefs {
		historyIDs = append(historyIDs, id)
	}
	sort.Strings(historyIDs)
	for _, id := range historyIDs {
		attachment, err := cloudAgentCreationHistoricalAttachment(repo, userID, state, id, state.CreationAttachmentRefs[id])
		if err != nil {
			return req, err
		}
		if !seen[id] {
			req.Attachments = append(req.Attachments, attachment)
			seen[id] = true
		}
	}
	// Iterate selected reads in a deterministic order for a stable model prefix.
	ids := make([]string, 0, len(state.CreationOutputRefs))
	for id := range state.CreationOutputRefs {
		ids = append(ids, id)
	}
	sort.Strings(ids)
	for _, id := range ids {
		ref := state.CreationOutputRefs[id]
		resource, _, err := cloudAgentCreationOutputResource(repo, userID, state, ref)
		if err != nil {
			return req, err
		}
		if resource.ID != id {
			return req, BadAuthRequest("成品资源已变化，请重新读取目标图")
		}
		if !seen[id] {
			req.Attachments = append(req.Attachments, CloudAgentAttachment{ResourceID: id, StorageKey: "resource:" + id, Kind: strings.SplitN(resource.MimeType, "/", 2)[0], Role: "reference", Name: fmt.Sprintf("成品 %s 第%d张", ref.TaskID, ref.OutputIndex)})
		}
	}
	return req, nil
}
