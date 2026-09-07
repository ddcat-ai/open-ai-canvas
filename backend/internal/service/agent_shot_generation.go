package service

import (
	"fmt"
	"net/http"
	"regexp"
	"sort"
	"strconv"
	"strings"

	"infinite-canvas/backend/internal/model"
)

/* ------------------------------------------------------------------ *
 * D-057B —— Server Executor：project_generate_shot 的服务端执行体
 *
 * 架构定位（D-056 / D-057A 专家裁决）：
 *   - **单一 Domain Semantics + 双执行通道**。Browser 通道与 Server 通道
 *     必须产出等价的业务请求，但语义锚点只有一处：本文件（Go 生产域）。
 *   - Browser 侧实现（web/src/services/api/shot-generate.ts）保留不删，
 *     用于交互式预览与人工确认；Server 侧用于自主生产。
 *   - **Node 侧零凭据**：渠道 baseUrl/apiKey/interfaceType 等供应链字段在
 *     执行期由 resolveProviderConfig（provider.go）以 DB 渠道表为准**强制覆盖**，
 *     调用方传与不传都不改变执行结果。因此这里构造 payload 时一行密钥都不碰。
 *
 * 语义基线（Browser）：
 *   - 提示词只取镜头当前修订版的 videoPrompt，Agent/服务端均不改写不拼装。
 *   - H3 模型从系统渠道目录里发现，不写死渠道 id。
 *   - 时长按模型上限钳制；分辨率默认 768p横；画幅固定 16:9。
 *   - operation 由参考图数量推导（0→text_to_video，1~2→image_to_video，
 *     >2→reference_to_video），与 web/src/lib/model-selection.ts 的
 *     inferVideoOperation 严格对齐。
 * ------------------------------------------------------------------ */

const (
	// 与 shot-generate.ts 的 DEFAULT_RESOLUTION 对齐。
	agentShotDefaultResolution = "768p横"
	// 与 shot-generate.ts 的 clampSeconds 兜底对齐。
	agentShotDefaultSeconds = 5
	agentShotMinSeconds     = 1
	agentShotFallbackMaxSec = 5
	agentShotMaxReference   = 4
	agentShotArtifactType   = "video"
	agentShotSource         = "agent-generate-shot"
)

var (
	agentH3ModelPattern = regexp.MustCompile(`(?i)^minimax_h3_`)
	// 与 shot-generate.ts discoverH3VideoModel 的 ordered 一一对应。
	agentH3OrderWithReferences = []*regexp.Regexp{
		regexp.MustCompile(`(?i)^minimax_h3_lightx2v_v5_15s$`),
		regexp.MustCompile(`(?i)^minimax_h3_lightx2v_v5$`),
	}
	agentH3OrderWithoutReferences = []*regexp.Regexp{
		regexp.MustCompile(`(?i)^minimax_h3_lightx2v_no_pic$`),
		regexp.MustCompile(`(?i)^minimax_h3_lightx2v_`),
	}
	agentH3SecondLimits = []agentH3SecondLimit{
		{match: regexp.MustCompile(`(?i)_v5_15s$`), maxSeconds: 15},
		{match: regexp.MustCompile(`(?i)_no_pic$`), maxSeconds: 15},
		{match: regexp.MustCompile(`(?i)_v5$`), maxSeconds: 10},
	}
)

type agentH3SecondLimit struct {
	match      *regexp.Regexp
	maxSeconds int
}

type agentH3Selection struct {
	ChannelID string
	Model     string
}

// AgentShotGenerateRequest 只描述业务语义：谁、哪个镜头、多长、多清晰、参考什么。
// 它不包含 channelId / apiKey / baseUrl 等任何供应链字段——那些属于生产域。
type AgentShotGenerateRequest struct {
	ShotID             string
	VideoSeconds       *int
	Resolution         string
	ReferenceImageURLs []string
	WorkflowStepID     string
}

// AgentShotGenerateResult 与 Browser 侧 GenerateShotResult 字段对齐，
// 额外带 Executor 标记以便可观测性区分产物来自哪条通道。
type AgentShotGenerateResult struct {
	TaskID       string `json:"taskId"`
	ShotID       string `json:"shotId"`
	UnitID       string `json:"unitId,omitempty"`
	Model        string `json:"model"`
	ChannelID    string `json:"channelId"`
	Operation    string `json:"operation"`
	VideoSeconds int    `json:"videoSeconds"`
	Resolution   string `json:"resolution"`
	Status       string `json:"status"`
	PromptSource string `json:"promptSource"`
	Executor     string `json:"executor"`
}

// AgentGenerateShot 是 project_generate_shot 的 Server Executor 入口。
// 它复用与 Browser 通道完全相同的 CreateTask admission 流程，不另起一套写路径。
func (s *Service) AgentGenerateShot(userID string, projectID string, req AgentShotGenerateRequest) (*AgentShotGenerateResult, error) {
	projectID = strings.TrimSpace(projectID)
	if projectID == "" {
		return nil, NewAppError(http.StatusBadRequest, "projectId 必填")
	}
	shotID := strings.TrimSpace(req.ShotID)
	if shotID == "" {
		return nil, NewAppError(http.StatusBadRequest, "shotId 必填")
	}

	shot, err := s.repo.ShotForProject(projectID, shotID)
	if err != nil || shot == nil {
		return nil, NewAppError(http.StatusBadRequest, "镜头不存在或不属于该项目")
	}
	videoPrompt, durationMs, err := s.latestShotVideoPrompt(projectID, shotID, shot)
	if err != nil {
		return nil, err
	}

	references := make([]string, 0, len(req.ReferenceImageURLs))
	for _, raw := range req.ReferenceImageURLs {
		url := strings.TrimSpace(raw)
		if url == "" {
			continue
		}
		if len(references) >= agentShotMaxReference {
			return nil, NewAppError(http.StatusBadRequest, fmt.Sprintf("参考图最多 %d 张", agentShotMaxReference))
		}
		references = append(references, url)
	}

	selection, err := s.discoverH3VideoModel(len(references) > 0)
	if err != nil {
		return nil, err
	}
	videoSeconds := clampAgentShotSeconds(req.VideoSeconds, durationMs, agentShotMaxSecondsForModel(selection.Model))
	resolution := strings.TrimSpace(req.Resolution)
	if resolution == "" {
		resolution = agentShotDefaultResolution
	}
	operation := inferAgentVideoOperation(len(references))

	metadata := map[string]any{
		"shotId":       shot.ID,
		"artifactType": agentShotArtifactType,
		"source":       agentShotSource,
	}
	if shot.UnitID != "" {
		metadata["unitId"] = shot.UnitID
	}
	if stepID := strings.TrimSpace(req.WorkflowStepID); stepID != "" {
		metadata["workflowStepId"] = stepID
	}

	referenceImages := make([]map[string]any, 0, len(references))
	for index, url := range references {
		referenceImages = append(referenceImages, map[string]any{
			"id":      newID(),
			"name":    fmt.Sprintf("shot-reference-%d", index+1),
			"type":    "image/jpeg",
			"dataUrl": "",
			"url":     url,
		})
	}

	// config 只带业务参数：channelId + model 用于系统渠道校验，vquality/
	// videoSeconds 是真实生成参数。供应链字段由 resolveProviderConfig 在执行期
	// 以 DB 为准覆盖，这里刻意不传，避免任何凭据经过 Agent 通道。
	//
	// size 刻意留空：H3 渠道模型的 capability.ratios 是空数组（画面比例由
	// vquality 的「横/竖/1:1」表达），传 "16:9" 会被 ValidateTaskCapability
	// 判为「画面比例不在当前模型支持范围内」而拒绝（2026-09-07 生产副本实测）。
	config := map[string]any{
		"channelId":    selection.ChannelID,
		"model":        selection.Model,
		"size":         "",
		"vquality":     resolution,
		"videoSeconds": strconv.Itoa(videoSeconds),
	}

	task, err := s.CreateTask(userID, CreateTaskRequest{
		ProjectID: projectID,
		Type:      "canvas_video",
		Operation: operation,
		Prompt:    videoPrompt,
		Model:     selection.Model,
		Input: map[string]any{
			"mode":            "video",
			"prompt":          videoPrompt,
			"config":          config,
			"referenceImages": referenceImages,
			"referenceVideos": []any{},
			"referenceAudios": []any{},
			"metadata":        metadata,
		},
	})
	if err != nil {
		// CreateTask 已自带结构化错误；兜底包装保证 Agent 永远拿到明确文案而不是裸 500。
		return nil, WrapAppError(http.StatusInternalServerError, "创建生成任务失败", err)
	}

	result := &AgentShotGenerateResult{
		TaskID:       task.ID,
		ShotID:       shot.ID,
		Model:        selection.Model,
		ChannelID:    selection.ChannelID,
		Operation:    operation,
		VideoSeconds: videoSeconds,
		Resolution:   resolution,
		Status:       string(task.Status),
		PromptSource: "revision",
		Executor:     "server",
	}
	if shot.UnitID != "" {
		result.UnitID = shot.UnitID
	}
	return result, nil
}

// latestShotVideoPrompt 取镜头最新修订版的 videoPrompt。
// 与 Browser 侧 resolveShotPrompt 等价：按 version 倒序取第一条，缺提示词直接报错护栏。
func (s *Service) latestShotVideoPrompt(projectID string, shotID string, shot *model.Shot) (string, int64, error) {
	revisions, err := s.repo.ProjectShotRevisions(projectID)
	if err != nil {
		return "", 0, WrapAppError(http.StatusInternalServerError, "读取镜头修订版失败", err)
	}
	var latest *model.ShotRevision
	for index := range revisions {
		item := revisions[index]
		if item.ShotID != shotID {
			continue
		}
		if latest == nil || item.Version > latest.Version {
			latest = &revisions[index]
		}
	}
	videoPrompt := ""
	durationMs := int64(0)
	if latest != nil {
		videoPrompt = strings.TrimSpace(latest.VideoPrompt)
		durationMs = latest.DurationMs
	}
	if durationMs <= 0 {
		durationMs = shot.DurationMs
	}
	if videoPrompt == "" {
		title := strings.TrimSpace(shot.Title)
		if title == "" {
			title = shotID
		}
		return "", 0, NewAppError(http.StatusBadRequest, fmt.Sprintf("镜头「%s」的当前版本还没有视频提示词（videoPrompt），请先在镜头编辑里填写后再生成", title))
	}
	return videoPrompt, durationMs, nil
}

// discoverH3VideoModel 从系统渠道目录发现 MiniMax H3 视频模型。
// 与 Browser 侧 discoverH3VideoModel 同语义：先按优先级模式匹配，再退化为首个候选。
// 差异仅在于数据源——Browser 读前端 store 的目录缓存，Server 读后端渠道表（更权威）。
func (s *Service) discoverH3VideoModel(withReferences bool) (agentH3Selection, error) {
	channels, err := s.repo.SystemChannels(false)
	if err != nil {
		return agentH3Selection{}, WrapAppError(http.StatusInternalServerError, "读取系统渠道目录失败", err)
	}
	sort.Slice(channels, func(i, j int) bool { return channels[i].ID < channels[j].ID })

	var candidates []agentH3Selection
	for _, channel := range channels {
		models, listErr := s.repo.ChannelModels(channel.ID, false)
		if listErr != nil {
			continue
		}
		for _, item := range models {
			if !item.Enabled || !agentH3ModelPattern.MatchString(item.ModelKey) {
				continue
			}
			candidates = append(candidates, agentH3Selection{ChannelID: channel.ID, Model: item.ModelKey})
		}
	}
	if len(candidates) == 0 {
		return agentH3Selection{}, NewAppError(http.StatusBadRequest, "模型目录里没有 MiniMax H3 视频模型：请先在后台配置渠道并同步模型目录")
	}
	ordered := agentH3OrderWithoutReferences
	if withReferences {
		ordered = agentH3OrderWithReferences
	}
	for _, pattern := range ordered {
		for _, candidate := range candidates {
			if pattern.MatchString(candidate.Model) {
				return candidate, nil
			}
		}
	}
	return candidates[0], nil
}

func agentShotMaxSecondsForModel(model string) int {
	for _, limit := range agentH3SecondLimits {
		if limit.match.MatchString(model) {
			return limit.maxSeconds
		}
	}
	return agentShotFallbackMaxSec
}

// clampAgentShotSeconds 与 Browser 侧 clampSeconds 逐行对齐：
// 显式值无效（≤0）时回落到 min(5, 上限)；有效值取 [1, 上限] 内的四舍五入整数。
func clampAgentShotSeconds(requested *int, durationMs int64, maxSeconds int) int {
	if requested != nil {
		value := *requested
		if value <= 0 {
			return minInt(agentShotDefaultSeconds, maxSeconds)
		}
		return maxInt(agentShotMinSeconds, minInt(value, maxSeconds))
	}
	fallback := agentShotDefaultSeconds
	if durationMs > 0 {
		// (durationMs+500)/1000 的整数除法 == JS 的 Math.round(durationMs/1000)；
		// 不足 1s 时浏览器经 Math.max(1, ...) 取 1s（不是 5s）——这里必须同口径，
		// 否则 0<durationMs<500 的镜头两条通道会产出不同时长（D-056 单一语义）。
		fallback = int((durationMs + 500) / 1000)
		if fallback < agentShotMinSeconds {
			fallback = agentShotMinSeconds
		}
	}
	return maxInt(agentShotMinSeconds, minInt(fallback, maxSeconds))
}

// inferAgentVideoOperation 与 web/src/lib/model-selection.ts 的 inferVideoOperation 对齐。
// 注意：>2 张参考图会升级为 reference_to_video，不能简单写成「有图就是图生视频」。
func inferAgentVideoOperation(imageCount int) string {
	if imageCount > 2 {
		return "reference_to_video"
	}
	if imageCount > 0 {
		return "image_to_video"
	}
	return "text_to_video"
}

// minInt 复用 tapnow_adapter.go 中的同名工具；maxInt 为本文件新增。
func maxInt(left int, right int) int {
	if left > right {
		return left
	}
	return right
}
