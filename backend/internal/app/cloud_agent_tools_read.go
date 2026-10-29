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
	agenttool "yingce/backend/internal/agent/tool"

	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"
)

// 工具分类统一由 internal/agent/tool 注册表推导，这里只保留 app 内的薄封装。
func cloudAgentWrite(name string) bool { return agenttool.Of(name).Write() }

func cloudAgentMediaTool(name string) bool { return agenttool.Of(name).Media() }

// 同参缓存只能拦住“原样重复”的读取。模型也可能不断修改 offset、nodeIds 或
// profile scope 来绕过缓存，因此本轮还要限制所有只读快照工具的累计调用次数。
// 该上限高于正常画布分页读取所需次数，但足以在异常循环继续消耗模型额度前止损。
const cloudAgentMaxReadToolCallsPerRun = 32

// 同一份缓存结果连续回放达到这个次数时只触发一次软收敛：下一步暂时收起只读工具，
// 让模型使用已有事实继续回复。这里不直接结束运行，也不把 run 标为 failed。
const cloudAgentMaxReadReplaysBeforeNudge = 4

func cloudAgentReadToolCacheable(name string) bool { return agenttool.Of(name).Cacheable }

// cloudAgentReadToolReadOnly is the single read boundary for the Agent.  A
// tool must not be able to bypass the loop budget merely by using a different
// read endpoint.  Cacheability is deliberately narrower because task status
// and search results are allowed to change between calls.
func cloudAgentReadToolReadOnly(name string) bool { return agenttool.Of(name).ReadOnly() }

func cloudAgentToolsWithoutReadTools(tools []map[string]interface{}) []map[string]interface{} {
	filtered := make([]map[string]interface{}, 0, len(tools))
	for _, tool := range tools {
		function, _ := tool["function"].(map[string]interface{})
		if name := stringValue(function["name"]); cloudAgentReadToolReadOnly(name) || agenttool.Of(name).Vision {
			continue
		}
		filtered = append(filtered, tool)
	}
	return filtered
}

func cloudAgentReadCacheKey(call cloudAgentCall) string {
	arguments := strings.TrimSpace(call.Function.Arguments)
	var value any
	if err := json.Unmarshal([]byte(arguments), &value); err == nil {
		if object, ok := value.(map[string]any); ok {
			// These defaults are semantically identical to omission. Canonicalizing
			// them prevents offset=0 retries from bypassing the read cache.
			for _, field := range agenttool.Of(call.Function.Name).OffsetDefaults {
				if _, exists := object[field]; !exists {
					object[field] = float64(0)
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
	switch agenttool.Of(call.Function.Name).CacheScope {
	case agenttool.CacheCanvasRevision:
		if repo != nil {
			if canvas, err := repo.CanvasProjectForUser(userID, state.Request.CanvasID); err == nil && canvas != nil {
				return fmt.Sprintf("%s:canvas-revision:%d", key, canvas.Revision)
			}
		}
	case agenttool.CacheSkillVersion:
		var args struct {
			SkillID string `json:"skillId"`
		}
		if json.Unmarshal([]byte(call.Function.Arguments), &args) == nil {
			if version := state.SkillVersions[args.SkillID]; version != "" {
				return fmt.Sprintf("%s:skill-version:%s", key, version)
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
				if cached.ReplayCount >= cloudAgentMaxReadReplaysBeforeNudge && !state.ReadLoopNudge {
					state.ReadLoopNudge = true
					state.ReadLoopToolName = call.Function.Name
					state.ReadLoopCount = cached.ReplayCount
				}
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
	// Cache replays have their own soft guard. Only a cache miss consumes the
	// real-read budget; neither guard terminates the run.
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
	binding, known := cloudAgentRegistry().Lookup(call.Function.Name)
	if !known || binding.Handler.Read == nil {
		return nil, BadAuthRequest("未知或不可读取的工具")
	}
	return binding.Handler.Read(repo, userID, state, call, services...)
}

func isReadableTextResource(resource *model.Resource) bool {
	if resource == nil {
		return false
	}
	mimeType := strings.ToLower(strings.TrimSpace(resource.MimeType))
	if strings.HasPrefix(mimeType, "text/") {
		return true
	}
	for _, suffix := range []string{".txt", ".md", ".markdown", ".json", ".csv", ".xml", ".rtf"} {
		if strings.HasSuffix(strings.ToLower(resource.ObjectKey), suffix) {
			return true
		}
	}
	return false
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
