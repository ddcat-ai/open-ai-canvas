// 画布 Agent 的只读工具：读取画布、节点、任务等，并按「工具 + 参数 + 画布快照」缓存结果。
//
// 单轮读取次数有上限（cloudAgentMaxReadToolCallsPerRun），防止模型陷入反复读取的循环。
// 图片标注（cloudAgentRenderImageAnnotations）在服务端合成，模型只拿到合成后的图。

package app

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"image"
	"image/color"
	"image/draw"
	"image/png"
	"strings"
	"time"

	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/repository"
)

func cloudAgentWrite(name string) bool {
	return name == "canvas_apply_ops" || name == "canvas_arrange_nodes" || name == "generate_media" || name == "image_layer_split" || name == "canvas_create_storyboard" || name == "canvas_edit_storyboard" || name == "canvas_edit_batch_table" || name == "canvas_create_character" || name == "previs_scene_create" || name == "previs_apply_patch"
}

// 同参缓存只能拦住“原样重复”的读取。模型也可能不断修改 offset、nodeIds 或
// profile scope 来绕过缓存，因此本轮还要限制所有只读快照工具的累计调用次数。
// 该上限高于正常画布分页读取所需次数，但足以在异常循环继续消耗模型额度前止损。
const cloudAgentMaxReadToolCallsPerRun = 32

func cloudAgentReadToolCacheable(name string) bool {
	switch name {
	case "agent_profile_read", "canvas_get_state", "canvas_read_storyboard", "previs_scene_read", "skill_read_file", "model_list":
		return true
	default:
		return false
	}
}

// cloudAgentReadToolReadOnly is the single read boundary for the Agent.  A
// tool must not be able to bypass the loop budget merely by using a different
// read endpoint.  Cacheability is deliberately narrower because task status
// and search results are allowed to change between calls.
func cloudAgentReadToolReadOnly(name string) bool {
	switch name {
	case "agent_profile_read", "canvas_get_state", "canvas_read_storyboard", "previs_scene_read", "canvas_read_batch_table", "canvas_list_node_types", "skill_read_file", "skill_search", "model_list", "recall_lessons", "task_get":
		return true
	default:
		return false
	}
}

func cloudAgentReadCacheKey(call cloudAgentCall) string {
	arguments := strings.TrimSpace(call.Function.Arguments)
	var value any
	if err := json.Unmarshal([]byte(arguments), &value); err == nil {
		if object, ok := value.(map[string]any); ok {
			// These defaults are semantically identical to omission. Canonicalizing
			// them prevents offset=0 retries from bypassing the read cache.
			switch call.Function.Name {
			case "skill_read_file", "canvas_get_state", "canvas_read_storyboard", "canvas_read_batch_table":
				for _, field := range []string{"offset", "connectionOffset", "storyboardOffset"} {
					if _, exists := object[field]; !exists {
						object[field] = float64(0)
					}
				}
			}
			value = object
		}
		if normalized, err := json.Marshal(value); err == nil {
			arguments = string(normalized)
		}
	}
	return call.Function.Name + ":" + arguments
}

// cloudAgentReadCacheKeyForState binds snapshot reads to the resource version
// that produced them. A read result must never survive an out-of-band canvas or
// skill update merely because the tool arguments stayed the same.
func cloudAgentReadCacheKeyForState(repo *repository.Repository, userID string, state *cloudAgentRuntime, call cloudAgentCall) string {
	key := cloudAgentReadCacheKey(call)
	if state == nil {
		return key
	}
	switch call.Function.Name {
	case "canvas_get_state", "canvas_read_storyboard", "previs_scene_read":
		if repo != nil {
			if canvas, err := repo.CanvasProjectForUser(userID, state.Request.CanvasID); err == nil && canvas != nil {
				return fmt.Sprintf("%s:canvas-revision:%d", key, canvas.Revision)
			}
		}
	case "skill_read_file":
		var args struct {
			SkillID string `json:"skillId"`
		}
		if json.Unmarshal([]byte(call.Function.Arguments), &args) == nil {
			for _, skill := range state.Skills {
				if skill.ID == args.SkillID {
					return fmt.Sprintf("%s:skill-version:%s:%s", key, skill.Version, skill.Hash)
				}
			}
		}
	}
	return key
}

func cloudAgentReadToolCached(repo *repository.Repository, userID string, state *cloudAgentRuntime, call cloudAgentCall, services ...*Service) (any, error) {
	if !cloudAgentReadToolReadOnly(call.Function.Name) {
		return cloudAgentReadTool(repo, userID, state, call, services...)
	}
	if state == nil {
		return nil, errors.New("Agent 只读工具缺少运行时状态")
	}
	if !cloudAgentReadToolCacheable(call.Function.Name) {
		if state.ReadToolCalls >= cloudAgentMaxReadToolCallsPerRun {
			return nil, &cloudAgentReadLoopError{ToolName: call.Function.Name, Count: state.ReadToolCalls + 1, Budget: true, ReasonCode: "read_budget_exceeded"}
		}
		state.ReadToolCalls++
		return cloudAgentReadTool(repo, userID, state, call, services...)
	}
	key := cloudAgentReadCacheKeyForState(repo, userID, state, call)
	if state.ToolReadResults != nil {
		if cached, ok := state.ToolReadResults[key]; ok {
			if cached.Error != "" {
				// Only deterministic argument errors are persisted. Transient and
				// business errors never enter this branch.
				cachedErr := errors.New(cached.Error)
				if cached.ArgumentError {
					return nil, &cloudAgentArgumentError{cachedErr}
				}
				delete(state.ToolReadResults, key)
			} else {
				if state.ToolReadReplays == nil {
					state.ToolReadReplays = map[string]int{}
				}
				cached.ReplayCount = state.ToolReadReplays[key] + 1
				state.ToolReadReplays[key] = cached.ReplayCount
				state.ToolReadResults[key] = cached
				if len(cached.Result) == 0 {
					return nil, errors.New("缓存的 Agent 只读结果无效")
				}
				if !cloudAgentReadResultInContext(state, cached.Result) {
					// A compaction may have evicted the original tool body. Restore
					// the complete result exactly once so the model can continue.
					var restored any
					if err := json.Unmarshal(cached.Result, &restored); err != nil {
						return nil, errors.New("缓存的 Agent 只读结果无效")
					}
					return restored, nil
				}
				return map[string]any{
					"cacheReplay": true,
					"replayCount": cached.ReplayCount,
					"message":     "该只读结果已在当前上下文中，请直接使用已有结果，不要再次读取",
				}, nil
			}
		}
	}
	if state.ReadToolCalls >= cloudAgentMaxReadToolCallsPerRun {
		return nil, &cloudAgentReadLoopError{ToolName: call.Function.Name, Count: state.ReadToolCalls + 1, Budget: true, ReasonCode: "read_budget_exceeded"}
	}
	// Cache replays are not new reads. Only a cache miss consumes the bounded
	// read budget; otherwise a model repeating the same skill/page would still
	// terminate after 32 harmless acknowledgements.
	state.ReadToolCalls++

	state.readCacheExecution = true
	result, err := cloudAgentReadTool(repo, userID, state, call, services...)
	state.readCacheExecution = false
	if err != nil {
		// Argument errors are deterministic and safe to replay. IO, permission,
		// conflict and upstream errors must remain retryable and are not cached.
		var argumentErr *cloudAgentArgumentError
		if errors.As(err, &argumentErr) {
			if state.ToolReadResults == nil {
				state.ToolReadResults = map[string]cloudAgentCachedToolResult{}
			}
			state.ToolReadResults[key] = cloudAgentCachedToolResult{Error: cloudAgentSafeToolError(err), ArgumentError: true}
		}
		return result, err
	}
	encoded, marshalErr := json.Marshal(result)
	if marshalErr != nil {
		return result, marshalErr
	}
	if state.ToolReadResults == nil {
		state.ToolReadResults = map[string]cloudAgentCachedToolResult{}
	}
	state.ToolReadResults[key] = cloudAgentCachedToolResult{Result: encoded}
	return result, nil
}

func cloudAgentReadTool(repo *repository.Repository, userID string, state *cloudAgentRuntime, call cloudAgentCall, services ...*Service) (any, error) {
	var service *Service
	if len(services) > 0 {
		service = services[0]
	}
	switch call.Function.Name {
	case "model_list":
		if service == nil {
			return nil, BadAuthRequest("模型目录服务不可用")
		}
		intent, err := service.cloudAgentModelIntent(userID, state.Request.CanvasID, call.Function.Arguments)
		if err != nil {
			return nil, err
		}
		return service.cloudAgentModelList(intent)
	case "agent_profile_read":
		var args struct {
			Scope string `json:"scope"`
		}
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
	case "plan_update":
		return cloudAgentApplyPlanUpdate(state, call)
	case "ask_user":
		return cloudAgentAskUser(call, state)
	case "recall_lessons":
		return cloudAgentRecallLessons(repo, userID, call)
	case "remember_lesson":
		return cloudAgentRememberLesson(repo, userID, state, call)
	case "previs_scene_read":
		return cloudAgentPrevisSceneRead(repo, userID, state.Request.CanvasID, call)
	case "previs_preview":
		return cloudAgentPrevisPreview(repo, userID, state.Request.CanvasID, call)
	case "canvas_list_node_types":
		if err := decodeCloudAgentJSONObject(call.Function.Arguments, &struct{}{}); err != nil {
			return nil, cloudAgentJSONArgumentError(err)
		}
		return cloudAgentNodeTypes(), nil
	case "canvas_get_state":
		var args struct {
			Offset           int      `json:"offset"`
			ConnectionOffset int      `json:"connectionOffset"`
			NodeIDs          []string `json:"nodeIds"`
			FocusNodeIDs     []string `json:"focusNodeIds"`
			Depth            *int     `json:"depth"`
			IncludeRelated   *bool    `json:"includeRelated"`
			StoryboardOffset int      `json:"storyboardOffset"`
		}
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
	case "canvas_read_storyboard":
		var args struct {
			NodeID string `json:"nodeId"`
			Offset int    `json:"offset"`
		}
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
	case "canvas_read_batch_table":
		var args struct {
			NodeID string `json:"nodeId"`
			Offset int    `json:"offset"`
		}
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
	case "image_text_detect":
		var args struct {
			NodeID string `json:"nodeId"`
		}
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
	case "image_annotation_render":
		if len(services) == 0 || services[0] == nil {
			return nil, BadAuthRequest("标注资源存储不可用")
		}
		return cloudAgentRenderImageAnnotations(repo, userID, state, call, services[0])
	case "skill_search":
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
		return cloudAgentSearchSkills(state.Skills, args.Keyword, args.Limit)
	case "skill_read_file":
		var args struct {
			SkillID string `json:"skillId"`
			Path    string `json:"path"`
			Offset  int    `json:"offset"`
		}
		if err := decodeCloudAgentJSONObject(call.Function.Arguments, &args); err != nil {
			return nil, cloudAgentJSONArgumentError(err)
		}
		if args.Offset < 0 || (args.Path == "" && args.Offset != 0) {
			return nil, BadAuthRequest("技能读取偏移无效")
		}
		for _, skill := range state.Skills {
			if skill.ID == args.SkillID {
				if args.Path == "" {
					return map[string]any{"version": skill.Version, "entryPath": cloudAgentSkillEntryPath, "files": cloudAgentSkillPaths(skill), "guidance": "先读取 SKILL.md，再只读取入口明确引用且当前任务需要的参考文件。只能读取 files 中列出的路径；不要重复列目录或猜测路径"}, nil
				}
				if service != nil {
					detail, err := service.SkillDetail(userID, skill.ID)
					if err != nil {
						return nil, err
					}
					if !detail.IsAdded || detail.Status != 1 || detail.VersionID != skill.Version || detail.ContentHash != skill.Hash {
						return nil, creationConflict("技能已更新或不可用，请重试")
					}
					if args.Path == cloudAgentSkillEntryPath {
						return cloudAgentSkillPage(skill.Version, args.Path, detail.Instruction, args.Offset)
					}
					if _, ok := skill.Files[args.Path]; !ok {
						return nil, BadAuthRequest("参考文件未包含在本轮固定快照中")
					}
					file, err := service.SkillPackageFile(userID, skill.ID, args.Path)
					if err != nil {
						return nil, err
					}
					if file.Binary {
						return nil, BadAuthRequest("不支持读取二进制技能文件")
					}
					latest, err := service.SkillDetail(userID, skill.ID)
					if err != nil {
						return nil, err
					}
					if !latest.IsAdded || latest.Status != 1 || latest.VersionID != skill.Version || latest.ContentHash != skill.Hash {
						return nil, creationConflict("技能已更新或不可用，请重试")
					}
					return cloudAgentSkillPage(skill.Version, args.Path, file.Content, args.Offset)
				}
				if args.Path == cloudAgentSkillEntryPath && strings.TrimSpace(skill.Instruction) != "" {
					return map[string]any{"version": skill.Version, "path": args.Path, "content": skill.Instruction}, nil
				}
				if content, ok := skill.Files[args.Path]; ok && content != "" {
					return map[string]any{"version": skill.Version, "path": args.Path, "content": content}, nil
				}
				return nil, BadAuthRequest(fmt.Sprintf("参考文件未包含在本轮固定快照中；可读路径：%s。不要重试此路径", strings.Join(cloudAgentSkillPaths(skill), ", ")))
			}
		}
		return nil, BadAuthRequest("技能未在本轮启用，或参考文件未包含在固定快照中")
	case "task_get":
		var args struct {
			TaskID string `json:"taskId"`
		}
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
	return nil, BadAuthRequest("未知工具")
}

func cloudAgentRenderImageAnnotations(repo *repository.Repository, userID string, state *cloudAgentRuntime, call cloudAgentCall, service *Service) (any, error) {
	var args struct {
		NodeID      string `json:"nodeId"`
		Annotations []struct {
			Label string  `json:"label"`
			X     float64 `json:"x"`
			Y     float64 `json:"y"`
		} `json:"annotations"`
	}
	if err := decodeCloudAgentJSONObject(call.Function.Arguments, &args); err != nil {
		return nil, cloudAgentJSONArgumentError(err)
	}
	if err := validateCloudAgentID(args.NodeID, "图片节点ID", 80); err != nil {
		return nil, err
	}
	if len(args.Annotations) == 0 || len(args.Annotations) > 30 {
		return nil, BadAuthRequest("标注数量必须在1到30之间")
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
	width, height := 1024.0, 1024.0
	if v, ok := node["width"].(float64); ok && v > 0 {
		width = v
	}
	if v, ok := node["height"].(float64); ok && v > 0 {
		height = v
	}
	if width < 1 || height < 1 || width > 8192 || height > 8192 || width*height > 16_777_216 {
		return nil, BadAuthRequest("标注图片尺寸超过 1600 万像素预算，请先缩小图片节点")
	}
	if state.RuntimeRunID == "" {
		return nil, BadAuthRequest("标注缺少运行归属")
	}
	canvasImage := image.NewRGBA(image.Rect(0, 0, int(width), int(height)))
	red := color.RGBA{R: 239, G: 68, B: 68, A: 255}
	white := color.RGBA{R: 255, G: 255, B: 255, A: 255}
	for _, item := range args.Annotations {
		if item.X < 0 || item.X > 1 || item.Y < 0 || item.Y > 1 || strings.TrimSpace(item.Label) == "" {
			return nil, BadAuthRequest("标注坐标必须在0到1之间且文字不能为空")
		}
		x, y := int(item.X*width), int(item.Y*height)
		drawFilledCircle(canvasImage, x, y, 18, red)
		// A white center keeps markers visually distinct on dark and light images.
		drawFilledCircle(canvasImage, x, y, 8, white)
	}
	var encoded bytes.Buffer
	if err := png.Encode(&encoded, canvasImage); err != nil {
		return nil, fmt.Errorf("编码标注参考图失败: %w", err)
	}
	if state.TransientReferences == nil {
		state.TransientReferences = map[string]cloudAgentTransientReference{}
	}
	refID := "annotation-" + call.ID
	identity := "agent-annotation:" + state.RuntimeRunID + ":" + call.ID + ":" + creationHash(call.Function.Arguments)
	resource, err := service.UploadResourceFile(userID, "annotation-overlay.png", int64(encoded.Len()), "image", int(width), int(height), 0, bytes.NewReader(encoded.Bytes()), identity)
	if err != nil {
		return nil, err
	}
	expiresAt := time.Now().Add(24 * time.Hour)
	if err := repo.UpsertCloudAgentResourceLeases(userID, state.RuntimeRunID, "annotation:"+call.ID, []string{resource.ID}, expiresAt); err != nil {
		return nil, err
	}
	state.TransientReferences[refID] = cloudAgentTransientReference{ID: refID, Name: "annotation-overlay.png", MIMEType: "image/png", ResourceID: resource.ID, ExpiresAt: expiresAt}
	return map[string]any{"nodeId": args.NodeID, "width": width, "height": height, "annotationCount": len(args.Annotations), "referenceTransientId": refID, "mimeType": "image/png", "referenceOrder": []string{args.NodeID, refID}, "expiresAt": expiresAt, "persisted": true}, nil
}

func drawFilledCircle(dst draw.Image, cx, cy, radius int, fill color.Color) {
	for y := cy - radius; y <= cy+radius; y++ {
		for x := cx - radius; x <= cx+radius; x++ {
			dx, dy := x-cx, y-cy
			if dx*dx+dy*dy <= radius*radius {
				dst.Set(x, y, fill)
			}
		}
	}
}
