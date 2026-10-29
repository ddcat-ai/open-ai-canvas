package app

import (
	"io"
	"strings"
	"unicode/utf8"

	agenttool "yingce/backend/internal/agent/tool"
	"yingce/backend/internal/assets"
	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"
)

func cloudAgentHandleModelList(repo *repository.Repository, userID string, state *cloudAgentRuntime, call cloudAgentCall, services ...*Service) (any, error) {
	var service *Service
	if len(services) > 0 {
		service = services[0]
	}
	if service == nil {
		return nil, BadAuthRequest("模型目录服务不可用")
	}
	intent, err := service.cloudAgentModelIntent(userID, state.Request.CanvasID, call.Function.Arguments)
	if err != nil {
		return nil, err
	}
	return service.cloudAgentModelList(userID, intent)
}

func cloudAgentHandleAgentProfileRead(repo *repository.Repository, userID string, state *cloudAgentRuntime, call cloudAgentCall, services ...*Service) (any, error) {
	var args agenttool.ProfileReadArgs
	if err := decodeCloudAgentJSONObject(call.Function.Arguments, &args); err != nil {
		return nil, cloudAgentJSONArgumentError(err)
	}
	if args.Scope != model.AgentProfileScopeUser && args.Scope != model.AgentProfileScopeProject && args.Scope != model.AgentProfileScopeCanvas {
		return nil, BadAuthRequest("长期偏好作用域无效")
	}
	if state.ProfileReads == nil {
		state.ProfileReads = map[string]bool{}
	}
	if state.ProfileReads[args.Scope] {
		return nil, BadAuthRequest("本轮已读取该长期偏好层，请使用历史工具结果，不要重复读取")
	}
	available := make([]string, 0, len(state.Profile.Layers))
	for _, layer := range state.Profile.Layers {
		available = append(available, layer.Scope)
		if layer.Scope == args.Scope {
			state.ProfileReads[args.Scope] = true
			return map[string]any{"scope": layer.Scope, "revision": layer.Revision, "hash": layer.Hash, "content": layer.Content}, nil
		}
	}
	if len(available) == 0 {
		return nil, BadAuthRequest("本轮没有长期偏好层，不要调用 agent_profile_read")
	}
	return nil, BadAuthRequest("本轮固定快照中不存在该长期偏好层；本轮可读的层只有：" + strings.Join(available, "、") + "。不要再尝试其它层")
}

func cloudAgentHandlePlanUpdate(repo *repository.Repository, userID string, state *cloudAgentRuntime, call cloudAgentCall, services ...*Service) (any, error) {
	return cloudAgentApplyPlanUpdate(state, call)
}

func cloudAgentHandleAskUser(repo *repository.Repository, userID string, state *cloudAgentRuntime, call cloudAgentCall, services ...*Service) (any, error) {
	return cloudAgentAskUser(call, state)
}

func cloudAgentHandlePrevisSceneRead(repo *repository.Repository, userID string, state *cloudAgentRuntime, call cloudAgentCall, services ...*Service) (any, error) {
	return cloudAgentPrevisSceneRead(repo, userID, state.Request.CanvasID, call)
}

func cloudAgentHandlePrevisPreview(repo *repository.Repository, userID string, state *cloudAgentRuntime, call cloudAgentCall, services ...*Service) (any, error) {
	return cloudAgentPrevisPreview(repo, userID, state.Request.CanvasID, call)
}

func cloudAgentHandleCanvasListNodeTypes(repo *repository.Repository, userID string, state *cloudAgentRuntime, call cloudAgentCall, services ...*Service) (any, error) {
	if err := decodeCloudAgentJSONObject(call.Function.Arguments, &struct{}{}); err != nil {
		return nil, cloudAgentJSONArgumentError(err)
	}
	return cloudAgentNodeTypes(), nil
}

func cloudAgentHandleCanvasGetState(repo *repository.Repository, userID string, state *cloudAgentRuntime, call cloudAgentCall, services ...*Service) (any, error) {
	var args agenttool.CanvasGetStateArgs
	if err := decodeCloudAgentJSONObject(call.Function.Arguments, &args); err != nil {
		return nil, cloudAgentJSONArgumentError(err)
	}
	depth := 0
	if args.Depth != nil {
		depth = *args.Depth
	}
	if len(args.FocusNodeIDs) > 0 && args.Depth == nil {
		depth = 1
	}
	if args.Offset < 0 || args.ConnectionOffset < 0 || args.StoryboardOffset < 0 {
		return nil, &cloudAgentArgumentError{BadAuthRequest("画布读取参数无效：offset、connectionOffset、storyboardOffset 必须是非负整数")}
	}
	if len(args.NodeIDs) > 8 {
		return nil, &cloudAgentArgumentError{BadAuthRequest("画布读取参数无效：nodeIds 最多包含8个节点ID")}
	}
	if len(args.FocusNodeIDs) > 8 {
		return nil, &cloudAgentArgumentError{BadAuthRequest("画布读取参数无效：focusNodeIds 最多包含8个节点ID")}
	}
	if len(args.NodeIDs) > 0 && len(args.FocusNodeIDs) > 0 {
		return nil, &cloudAgentArgumentError{BadAuthRequest("画布读取参数无效：nodeIds 与 focusNodeIds 互斥")}
	}
	if depth < 0 || depth > 3 {
		return nil, &cloudAgentArgumentError{BadAuthRequest("画布读取参数无效：depth 必须为0到3")}
	}
	if len(args.FocusNodeIDs) == 0 && args.Depth != nil {
		return nil, &cloudAgentArgumentError{BadAuthRequest("画布读取参数无效：depth 只能与 focusNodeIds 一起使用")}
	}
	includeRelated := args.IncludeRelated != nil && *args.IncludeRelated
	if includeRelated && len(args.FocusNodeIDs) == 0 {
		return nil, &cloudAgentArgumentError{BadAuthRequest("画布读取参数无效：includeRelated 只能与 focusNodeIds 一起使用")}
	}
	if includeRelated && args.Depth != nil {
		return nil, &cloudAgentArgumentError{BadAuthRequest("画布读取参数无效：includeRelated 与 depth 不能同时使用")}
	}
	canvas, err := repo.CanvasProjectForUser(userID, state.Request.CanvasID)
	if err != nil {
		return nil, err
	}
	doc, err := creationDocument(canvas.PayloadJSON)
	if err != nil {
		return nil, err
	}
	if len(args.FocusNodeIDs) > 0 {
		if includeRelated {
			return cloudAgentCanvasStateWithRelated(repo, userID, state.Request.CanvasID, doc, args.Offset, args.FocusNodeIDs, args.StoryboardOffset, args.ConnectionOffset)
		}
		return cloudAgentCanvasStateWithFocus(repo, userID, state.Request.CanvasID, doc, args.Offset, args.FocusNodeIDs, depth, args.StoryboardOffset, args.ConnectionOffset)
	}
	return cloudAgentCanvasState(repo, userID, state.Request.CanvasID, doc, args.Offset, args.NodeIDs, args.StoryboardOffset, args.ConnectionOffset)
}

func cloudAgentHandleCanvasReadText(repo *repository.Repository, userID string, state *cloudAgentRuntime, call cloudAgentCall, services ...*Service) (any, error) {
	var service *Service
	if len(services) > 0 {
		service = services[0]
	}
	var args agenttool.CanvasReadTextArgs
	if err := decodeCloudAgentJSONObject(call.Function.Arguments, &args); err != nil {
		return nil, cloudAgentJSONArgumentError(err)
	}
	if err := validateCloudAgentID(args.NodeID, "文本节点ID", 80); err != nil || args.Offset < 0 {
		return nil, &cloudAgentArgumentError{BadAuthRequest("文本节点ID或分页参数无效")}
	}
	if args.MaxChars == 0 {
		args.MaxChars = 16000
	}
	if args.MaxChars < 1 || args.MaxChars > 16000 {
		return nil, &cloudAgentArgumentError{BadAuthRequest("maxChars 必须在1到16000之间")}
	}
	canvas, err := repo.CanvasProjectForUser(userID, state.Request.CanvasID)
	if err != nil {
		return nil, err
	}
	doc, err := creationDocument(canvas.PayloadJSON)
	if err != nil {
		return nil, err
	}
	nodes, err := creationObjects(doc["nodes"])
	if err != nil {
		return nil, err
	}
	node := nodes[args.NodeID]
	if node == nil {
		return nil, BadAuthRequest("目标文本节点不在当前画布")
	}
	kind := stringValue(node["type"])
	meta, _ := node["metadata"].(map[string]any)
	if kind != "text" && kind != "markdown" && kind != "file" {
		return nil, BadAuthRequest("目标节点不是可读取的文本或文件节点")
	}
	if stringValue(meta["workflowKind"]) == "character" {
		return nil, BadAuthRequest("角色卡正文不是普通文本，请读取 character 字段")
	}
	content := stringValue(meta["content"])
	resourceID := assets.ResourceID(stringValue(meta["storageKey"]))
	if resourceID == "" {
		resourceID = assets.ResourceID(content)
	}
	if resourceID != "" {
		if service == nil {
			return nil, BadAuthRequest("文本资源读取服务不可用")
		}
		resource, resourceErr := repo.ResourceForUser(userID, resourceID)
		if resourceErr != nil {
			return nil, resourceErr
		}
		if resource.Status != model.ResourceStatusReady {
			return nil, BadAuthRequest("文本资源尚未上传完成")
		}
		if !isReadableTextResource(resource) {
			return nil, BadAuthRequest("该文件不是可直接读取的文本资源")
		}
		const maxTextResourceBytes = 32 << 20
		if resource.Size > maxTextResourceBytes {
			return nil, BadAuthRequest("文本资源超过32MB，请先拆分文件后再读取")
		}
		stream, streamErr := service.OpenResourceRange(userID, resourceID, "")
		if streamErr != nil {
			return nil, streamErr
		}
		defer stream.Body.Close()
		body, readErr := io.ReadAll(io.LimitReader(stream.Body, maxTextResourceBytes+1))
		if readErr != nil {
			return nil, readErr
		}
		if len(body) > maxTextResourceBytes {
			return nil, BadAuthRequest("文本资源超过32MB，请先拆分文件后再读取")
		}
		content = string(body)
	}
	if strings.TrimSpace(content) == "" {
		return map[string]any{"nodeId": args.NodeID, "title": stringValue(node["title"]), "content": "", "offset": args.Offset, "nextOffset": 0, "hasMore": false}, nil
	}
	runes := []rune(content)
	if args.Offset > len(runes) {
		return nil, &cloudAgentArgumentError{BadAuthRequest("文本读取 offset 超出正文长度")}
	}
	end := min(len(runes), args.Offset+args.MaxChars)
	chunk := string(runes[args.Offset:end])
	return map[string]any{
		"nodeId": args.NodeID, "title": stringValue(node["title"]),
		"content": chunk, "offset": args.Offset, "nextOffset": end,
		"hasMore": end < len(runes), "totalChars": utf8.RuneCountInString(content),
	}, nil
}

func cloudAgentHandleCanvasReadStoryboard(repo *repository.Repository, userID string, state *cloudAgentRuntime, call cloudAgentCall, services ...*Service) (any, error) {
	var args agenttool.StoryboardReadArgs
	if err := decodeCloudAgentJSONObject(call.Function.Arguments, &args); err != nil {
		return nil, cloudAgentJSONArgumentError(err)
	}
	if err := validateCloudAgentID(args.NodeID, "分镜节点ID", 80); err != nil || args.Offset < 0 {
		return nil, BadAuthRequest("分镜节点ID或分页参数无效")
	}
	canvas, err := repo.CanvasProjectForUser(userID, state.Request.CanvasID)
	if err != nil {
		return nil, err
	}
	doc, err := creationDocument(canvas.PayloadJSON)
	if err != nil {
		return nil, err
	}
	if _, _, _, err := storyboardNodeFromDocument(doc, args.NodeID); err != nil {
		return nil, err
	}
	view, err := cloudAgentCanvasState(repo, userID, state.Request.CanvasID, doc, 0, []string{args.NodeID}, args.Offset)
	if err != nil {
		return nil, err
	}
	return cloudAgentStoryboardReadResult(view, args.NodeID, cloudAgentNodeHash(doc, args.NodeID))
}

func cloudAgentHandleCanvasReadBatchTable(repo *repository.Repository, userID string, state *cloudAgentRuntime, call cloudAgentCall, services ...*Service) (any, error) {
	var args agenttool.BatchTableReadArgs
	if err := decodeCloudAgentJSONObject(call.Function.Arguments, &args); err != nil {
		return nil, cloudAgentJSONArgumentError(err)
	}
	if err := validateCloudAgentID(args.NodeID, "批量创作表节点ID", 80); err != nil || args.Offset < 0 {
		return nil, BadAuthRequest("批量创作表节点ID或分页参数无效")
	}
	canvas, err := repo.CanvasProjectForUser(userID, state.Request.CanvasID)
	if err != nil {
		return nil, err
	}
	doc, err := creationDocument(canvas.PayloadJSON)
	if err != nil {
		return nil, err
	}
	if _, _, _, _, err := batchTableNodeFromDocument(doc, args.NodeID); err != nil {
		return nil, err
	}
	view, err := cloudAgentCanvasState(repo, userID, state.Request.CanvasID, doc, 0, []string{args.NodeID}, args.Offset)
	if err != nil {
		return nil, err
	}
	return cloudAgentBatchTableReadResult(view, args.NodeID, cloudAgentNodeHash(doc, args.NodeID))
}

func cloudAgentHandleImageTextDetect(repo *repository.Repository, userID string, state *cloudAgentRuntime, call cloudAgentCall, services ...*Service) (any, error) {
	var args agenttool.ImageNodeArgs
	if err := decodeCloudAgentJSONObject(call.Function.Arguments, &args); err != nil {
		return nil, cloudAgentJSONArgumentError(err)
	}
	if err := validateCloudAgentID(args.NodeID, "图片节点ID", 80); err != nil {
		return nil, err
	}
	canvas, err := repo.CanvasProjectForUser(userID, state.Request.CanvasID)
	if err != nil {
		return nil, err
	}
	doc, err := creationDocument(canvas.PayloadJSON)
	if err != nil {
		return nil, err
	}
	nodes, err := creationObjects(doc["nodes"])
	if err != nil {
		return nil, err
	}
	node := nodes[args.NodeID]
	if node == nil || stringValue(node["type"]) != "image" {
		return nil, BadAuthRequest("目标节点不是图片节点")
	}
	ref, _, err := cloudAgentReference(repo, userID, node)
	if err != nil {
		return nil, err
	}
	return map[string]any{"nodeId": args.NodeID, "reference": ref, "status": "ready_for_visual_detection", "outputSchema": []string{"original", "text", "location"}, "nextStep": "使用视觉模型对该参考图返回 JSON 数组；不要把识别结果写回画布"}, nil
}

func cloudAgentHandleImageAnnotationRender(repo *repository.Repository, userID string, state *cloudAgentRuntime, call cloudAgentCall, services ...*Service) (any, error) {
	if len(services) == 0 || services[0] == nil {
		return nil, BadAuthRequest("标注资源存储不可用")
	}
	return cloudAgentRenderImageAnnotations(repo, userID, state, call, services[0])
}

func cloudAgentHandleSkillSearch(repo *repository.Repository, userID string, state *cloudAgentRuntime, call cloudAgentCall, services ...*Service) (any, error) {
	var args struct {
		Keyword string `json:"keyword"`
		Limit   int    `json:"limit"`
		// 容忍模型顺手带上的 skillId（对齐 skill_read_file 的参数习惯）：
		// 检索范围恒为本轮已启用技能，该字段仅接收不生效。
		SkillID string `json:"skillId,omitempty"`
	}
	if err := decodeCloudAgentJSONObject(call.Function.Arguments, &args); err != nil {
		return nil, cloudAgentJSONArgumentError(err)
	}
	service := cloudAgentToolService(services)
	if service == nil {
		return nil, BadAuthRequest("技能服务不可用")
	}
	skills, err := service.cloudAgentSkillPoolForSearch(userID, state)
	if err != nil {
		return nil, err
	}
	return cloudAgentSearchSkills(skills, args.Keyword, args.Limit)
}

func cloudAgentHandleSkillReadFile(repo *repository.Repository, userID string, state *cloudAgentRuntime, call cloudAgentCall, services ...*Service) (any, error) {
	var service *Service
	if len(services) > 0 {
		service = services[0]
	}
	var args agenttool.SkillReadArgs
	if err := decodeCloudAgentJSONObject(call.Function.Arguments, &args); err != nil {
		return nil, cloudAgentJSONArgumentError(err)
	}
	if args.Offset < 0 || (args.Path == "" && args.Offset != 0) {
		return nil, BadAuthRequest("技能读取偏移无效")
	}
	if service == nil {
		return nil, BadAuthRequest("技能服务不可用")
	}
	return service.cloudAgentReadSkillFile(userID, state, args)
}

func cloudAgentHandleTaskGet(repo *repository.Repository, userID string, state *cloudAgentRuntime, call cloudAgentCall, services ...*Service) (any, error) {
	var args agenttool.TaskGetArgs
	if err := decodeCloudAgentJSONObject(call.Function.Arguments, &args); err != nil {
		return nil, cloudAgentJSONArgumentError(err)
	}
	task, err := repo.TaskForUser(userID, args.TaskID)
	if err != nil {
		return nil, err
	}
	if task.ProjectID != state.Request.CanvasID {
		return nil, BadAuthRequest("不能读取其他画布的任务")
	}
	result := cloudAgentTaskDiagnostic(repo, task)
	result["status"] = task.Status
	result["text"] = truncateRunes(taskResultText(task.ResultJSON), 4000)
	return result, nil
}
