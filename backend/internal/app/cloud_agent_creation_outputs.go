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
	}
	if err := decodeCloudAgentJSONObject(call.Function.Arguments, &args); err != nil {
		return nil, cloudAgentJSONArgumentError(err)
	}
	if state.Request.Surface != "creation" || state.Request.SessionID == "" || args.Offset < 0 {
		return nil, BadAuthRequest("需要当前创作会话及有效目录位置")
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
		if len(state.CreationOutputRefs) >= 16 {
			if _, exists := state.CreationOutputRefs[resource.ID]; !exists {
				return nil, BadAuthRequest("本轮最多精读 16 个成品，请缩小目标范围")
			}
		}
		state.CreationOutputRefs[resource.ID] = ref
		return map[string]any{"taskId": task.ID, "runId": task.AgentRunID, "outputIndex": args.OutputIndex, "resourceId": resource.ID, "kind": strings.SplitN(resource.MimeType, "/", 2)[0], "prompt": truncateRunes(task.Prompt, 1600), "guidance": "已选定此成品。编辑时将 resourceId 放入 attachmentResourceIds，references 说明保留与修改部分；仅查看不会自动把它作为生成参考。图片内容将按当前对话模型能力附在下一步，视频仅返回元数据。"}, nil
	}
	tasks, err := repo.CreationMediaTasks(userID, state.Request.SessionID, args.RunID, args.Offset, 21)
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
	return map[string]any{"items": items, "nextOffset": next, "guidance": "按提交顺序列出；taskIndex 是任务序号，outputIndex 是该任务内成品序号，不混为总图号。结合用户指向的轮次和实际成品顺序定位第几张；按内容查找时提示词只是索引，需精读候选图。多个合理候选先澄清。传 taskId 和 outputIndex 读取目标原图。"}, nil
}

func cloudAgentCreationRequestWithOutputs(repo *repository.Repository, userID string, state *cloudAgentRuntime) (CloudAgentRequest, error) {
	req := state.Request
	req.Attachments = append([]CloudAgentAttachment(nil), req.Attachments...)
	seen := map[string]bool{}
	for _, item := range req.Attachments {
		seen[item.ResourceID] = true
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
