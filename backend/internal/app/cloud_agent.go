package app

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"log"
	"math"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"

	"gorm.io/gorm"
	"infinite-canvas/backend/internal/kernel"
	"infinite-canvas/backend/internal/model"
)

const cloudAgentOperation = "cloud_agent"

// A run is one immutable, durable model turn backed by a normal task. Subsequent
// turns reference the previous run, not a mutable in-memory conversation. This
// reuses transactional billing, worker leases, cancellation and text replay.
type CloudAgentRequest struct {
	ReasoningMode   string   `json:"reasoningMode,omitempty"`
	ProfileRevision string   `json:"profileRevision,omitempty"`
	CanvasID        string   `json:"canvasId"`
	Prompt          string   `json:"prompt"`
	Model           string   `json:"model,omitempty"`
	LogicalModelID  string   `json:"logicalModelId,omitempty"`
	ChannelID       string   `json:"channelId,omitempty"`
	ChannelModelKey string   `json:"channelModelKey,omitempty"`
	PermissionMode  string   `json:"permissionMode"`
	SkillIDs        []string `json:"skillIds,omitempty"`
	ContextScope    []string `json:"contextScope"`
	Budget          struct {
		MaxCredits         float64 `json:"maxCredits"`
		MaxGenerationTasks int     `json:"maxGenerationTasks,omitempty"`
		MaxVideoSeconds    int     `json:"maxVideoSeconds,omitempty"`
		// 0 = 不限制模型调用步数（与官方取消固定截断一致）。正数时夹到上限。
		MaxSteps int `json:"maxSteps,omitempty"`
	} `json:"budget"`
	IdempotencyKey string `json:"idempotencyKey"`
	// VisionEnabled 决定是否给模型暴露看图工具，由服务端在创建 run 时按渠道模型合同
	// （text.references.maxImages > 0）重新推导并覆盖，客户端传入值一律被忽略；
	// 必须持久化：工具授权校验每步都从落库状态重建，丢掉这个标记会让模型看得见工具
	// 却被判为"未获本轮权限授权"。
	VisionEnabled bool `json:"visionEnabled,omitempty"`
}

const cloudAgentMaxStepsLimit = 9999

func cloudAgentStepLimit(req CloudAgentRequest) int {
	if req.Budget.MaxSteps > 0 {
		return min(req.Budget.MaxSteps, cloudAgentMaxStepsLimit)
	}
	return 0
}

type cloudAgentState struct {
	Version        int                       `json:"version"`
	Request        CloudAgentRequest         `json:"request"`
	ParentID       string                    `json:"parentId"`
	Fingerprint    string                    `json:"fingerprint"`
	CreativeAnchor cloudAgentCreativeAnchor  `json:"creativeAnchor,omitempty"`
	Plan           []cloudAgentPlanItem      `json:"plan,omitempty"`
	Skills         []cloudAgentSkill         `json:"skills,omitempty"`
	Profile        cloudAgentProfileSnapshot `json:"profile"`
	Policy         cloudAgentPolicySnapshot  `json:"policy"`
}

type CloudAgentRun struct {
	ID             string              `json:"id"`
	CanvasID       string              `json:"canvasId"`
	ParentID       string              `json:"parentId,omitempty"`
	Status         string              `json:"status"`
	Revision       int64               `json:"revision"`
	CleanupPending bool                `json:"cleanupPending,omitempty"`
	FailureMessage string              `json:"failureMessage,omitempty"`
	PermissionMode string              `json:"permissionMode"`
	Model          string              `json:"model"`
	CreatedAt      time.Time           `json:"createdAt"`
	UpdatedAt      time.Time           `json:"updatedAt"`
	Events         []CloudAgentEvent   `json:"events,omitempty"`
	Skills         []cloudAgentSkill   `json:"skills,omitempty"`
	Approval       *cloudAgentApproval `json:"approval,omitempty"`
	SpentCredits   float64             `json:"spentCredits"`
	Step           int                 `json:"step"`
	ActiveMessage  map[string]string   `json:"activeMessage,omitempty"`
	// 事件已全量落库，运行详情只返回一页，因此必须把"这一页在整条日志里的位置"说清楚：
	// EventSeqBase 是本次返回的首条事件之前已入库的条数（不变量 events[i].seq ==
	// eventSeqBase + i + 1），EventCount 是该运行累计事件条数，LatestSeq 可直接当作下次
	// 增量读取的 sinceSeq，EventsTruncated 表示还有更早的记录没随本次返回。
	EventSeqBase    int  `json:"eventSeqBase"`
	EventCount      int  `json:"eventCount"`
	LatestSeq       int  `json:"latestSeq"`
	EventsTruncated bool `json:"eventsTruncated"`
}

// CloudAgentRunViewOptions 是运行详情的读取选项：SinceSeq 只取该序号之后的增量，
// EventLimit 覆盖默认页大小。零值即默认视图（尾部一窗）。
type CloudAgentRunViewOptions struct {
	SinceSeq   int
	EventLimit int
}

func validateCloudAgentRequest(req *CloudAgentRequest) error {
	if req == nil {
		return BadAuthRequest("请求不能为空")
	}
	// IDs and protocol selectors are identifiers, not free-form text. Keep their
	// validation in one place so byte/rune and Unicode handling cannot drift.
	if err := validateCloudAgentID(req.CanvasID, "画布 ID", 80); err != nil {
		return err
	}
	req.CanvasID = strings.TrimSpace(req.CanvasID)
	if err := validateCloudAgentPrompt(req.Prompt, 16000); err != nil {
		return err
	}
	req.Prompt = strings.TrimSpace(req.Prompt)
	if err := validateCloudAgentID(req.IdempotencyKey, "幂等键", 128); err != nil || utf8.RuneCountInString(req.IdempotencyKey) < 8 {
		return BadAuthRequest("需要 8–128 个字符的幂等键")
	}
	if req.PermissionMode != "read_only" && req.PermissionMode != "request_approval" && req.PermissionMode != "auto" {
		return BadAuthRequest("无效的 Agent 执行权限")
	}
	for value, spec := range map[string]struct {
		label string
		limit int
	}{
		"model":           {"模型标识", 160},
		"logicalModelId":  {"逻辑模型 ID", 80},
		"channelId":       {"渠道 ID", 80},
		"channelModelKey": {"渠道模型标识", 160},
	} {
		if value == "model" && req.Model == "" || value == "logicalModelId" && req.LogicalModelID == "" || value == "channelId" && req.ChannelID == "" || value == "channelModelKey" && req.ChannelModelKey == "" {
			continue
		}
		var candidate string
		switch value {
		case "model":
			candidate = req.Model
		case "logicalModelId":
			candidate = req.LogicalModelID
		case "channelId":
			candidate = req.ChannelID
		case "channelModelKey":
			candidate = req.ChannelModelKey
		}
		if err := validateCloudAgentID(candidate, spec.label, spec.limit); err != nil {
			return err
		}
	}
	if req.ReasoningMode != "" && req.ReasoningMode != "off" && req.ReasoningMode != "auto" && req.ReasoningMode != "deep" {
		return BadAuthRequest("无效的 Agent 推理模式")
	}
	if req.ProfileRevision != "" {
		if err := validateCloudAgentID(req.ProfileRevision, "偏好版本", 120); err != nil {
			return err
		}
	}
	if req.LogicalModelID != "" {
		if req.ChannelID != "" || req.ChannelModelKey != "" {
			return BadAuthRequest("逻辑模型和系统渠道不能混用")
		}
	} else if req.ChannelID == "" || req.ChannelModelKey == "" {
		return BadAuthRequest("请选择后端受管文本模型；Agent 不接受浏览器自定义密钥或上游地址")
	} else if req.Model != "" && req.Model != req.ChannelModelKey {
		return BadAuthRequest("渠道模型标识与 model 不一致")
	}
	if req.Budget.MaxGenerationTasks < 0 || req.Budget.MaxVideoSeconds < 0 || req.Budget.MaxSteps < 0 {
		return BadAuthRequest("生成任务、视频秒数和模型调用步数预算不能为负数")
	}
	seen := map[string]bool{}
	for i, id := range req.SkillIDs {
		id = strings.TrimSpace(id)
		if err := validateCloudAgentID(id, "技能 ID", 80); err != nil || seen[id] {
			return BadAuthRequest("技能 ID 无效或重复")
		}
		req.SkillIDs[i] = id
		seen[id] = true
	}
	if req.PermissionMode == "read_only" && (req.Budget.MaxGenerationTasks != 0 || req.Budget.MaxVideoSeconds != 0) {
		return BadAuthRequest("只读模式不能设置生成预算")
	}
	if len(req.ContextScope) > 1 || (len(req.ContextScope) == 1 && req.ContextScope[0] != "canvas") {
		return BadAuthRequest("当前仅支持已保存画布摘要，其他上下文尚未开放")
	}
	if len(req.ContextScope) == 1 && req.ContextScope[0] == "canvas" {
		req.ContextScope[0] = "canvas"
	}
	if math.IsNaN(req.Budget.MaxCredits) || math.IsInf(req.Budget.MaxCredits, 0) || req.Budget.MaxCredits <= 0 || req.Budget.MaxCredits > 1000000 {
		return BadAuthRequest("本轮积分上限必须大于 0 且不超过 1000000")
	}
	return nil
}

func validateCloudAgentPrompt(value string, maxRunes int) error {
	if !utf8.ValidString(value) || strings.TrimSpace(value) == "" || utf8.RuneCountInString(strings.TrimSpace(value)) > maxRunes {
		return BadAuthRequest("需要有效画布和 1–16000 个字符的提示词")
	}
	for _, r := range value {
		if unicode.IsControl(r) && r != '\n' && r != '\r' && r != '\t' {
			return BadAuthRequest("提示词不能包含控制字符")
		}
	}
	return nil
}

func cloudAgentID(userID, key string) string {
	sum := sha256.Sum256([]byte(userID + "\x00" + key))
	return "ag" + hex.EncodeToString(sum[:16])
}

func cloudAgentFingerprint(req CloudAgentRequest, parent string) string {
	data, _ := json.Marshal(struct {
		Request CloudAgentRequest
		Parent  string
	}{req, parent})
	sum := sha256.Sum256(data)
	return hex.EncodeToString(sum[:])
}

func agentRunOutput(task *model.Task, state cloudAgentState) *CloudAgentRun {
	status := string(task.Status)
	if task.Status == model.TaskStatusSucceeded {
		status = "completed"
	}
	return &CloudAgentRun{ID: task.ID, CanvasID: task.ProjectID, ParentID: state.ParentID, Status: status, PermissionMode: state.Request.PermissionMode, Model: task.Model, CreatedAt: task.CreatedAt, UpdatedAt: task.UpdatedAt, Skills: state.Skills}
}

func (s *Service) cloudAgentTask(userID, id string) (*model.Task, cloudAgentState, error) {
	var input struct {
		Agent cloudAgentState `json:"cloudAgent"`
	}
	task, err := s.repo.TaskForUser(userID, id)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			err = kernel.NotFound("Agent 运行不存在")
		}
		return nil, input.Agent, err
	}
	if task.Operation != cloudAgentOperation {
		return nil, input.Agent, kernel.NotFound("Agent 运行不存在")
	}
	if json.Unmarshal([]byte(task.InputJSON), &input) == nil && input.Agent.Version == 1 && task.ID == cloudAgentID(userID, input.Agent.Request.IdempotencyKey) {
		return task, input.Agent, nil
	}
	// 成功、失败和取消任务的 InputJSON 都可能按存储配额策略压缩；执行
	// 记录才是完成后轮次的持久来源。运行中如果无法解析执行记录，不能
	// 返回一个可操作的审批/活动任务状态。
	run, err := s.repo.CloudAgent(userID, id)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			err = kernel.NotFound("Agent 运行不存在")
		}
		return nil, input.Agent, err
	}
	state, err := cloudAgentDecode(run)
	if err != nil {
		if cloudAgentTaskTerminal(task.Status) || cloudAgentRunTerminal(run.Status) {
			// 终态运行仍应可查询，但绝不从损坏的 runtime 伪造审批、权限、
			// 活动任务或技能内容。TaskForUser 已完成归属校验，画布 ID 仅
			// 使用任务自身的归属字段作为安全展示降级。
			return task, cloudAgentState{Version: 1, Request: CloudAgentRequest{CanvasID: task.ProjectID}}, nil
		}
		return nil, input.Agent, kernel.NotFound("Agent 运行不存在")
	}
	if task.ID != cloudAgentID(userID, state.Request.IdempotencyKey) || task.ProjectID != state.Request.CanvasID {
		return nil, input.Agent, kernel.NotFound("Agent 运行不存在")
	}
	input.Agent = cloudAgentState{Version: 1, Request: state.Request, ParentID: state.ParentID, Fingerprint: state.Fingerprint, CreativeAnchor: state.CreativeAnchor, Skills: state.Skills, Profile: state.Profile, Policy: state.Policy}
	return task, input.Agent, nil
}

func cloudAgentTaskTerminal(status model.TaskStatus) bool {
	return status == model.TaskStatusSucceeded || status == model.TaskStatusFailed || status == model.TaskStatusCancelled
}

func cloudAgentRunTerminal(status string) bool {
	return status == "completed" || status == "failed" || status == "cancelled" || status == "rejected"
}

func (s *Service) CloudAgentRun(userID, id string, options ...CloudAgentRunViewOptions) (*CloudAgentRun, error) {
	task, state, err := s.cloudAgentTask(userID, id)
	if err != nil {
		return nil, err
	}
	// A durable execution is authoritative once it exists. In particular, do
	// not try to reconstruct/overwrite a terminal run whose task input or
	// runtime blob was compacted or damaged; the output path has a deliberately
	// read-only, minimal fallback for that case. The ensure path is only for a
	// legacy root task whose execution row has not been created yet.
	if _, lookupErr := s.repo.CloudAgent(userID, id); errors.Is(lookupErr, gorm.ErrRecordNotFound) {
		if err := s.ensureCloudAgentExecution(task, state); err != nil {
			return nil, err
		}
	} else if lookupErr != nil {
		return nil, lookupErr
	}
	return s.cloudAgentExecutionOutput(task, state, options...)
}

// CloudAgentRunIfChanged keeps idle event streams on a small indexed read.
// The persisted revision, not a process-local notification, is authoritative
// across instances and after missed/disconnected notifications.
func (s *Service) CloudAgentRunIfChanged(userID, id string, revision int64, options ...CloudAgentRunViewOptions) (*CloudAgentRun, error) {
	current, err := s.repo.CloudAgentRevision(userID, id)
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, kernel.NotFound("Agent 运行不存在")
	}
	if err != nil {
		return nil, err
	}
	if current == revision {
		return nil, nil
	}
	return s.CloudAgentRun(userID, id, options...)
}

// CreateCloudAgentRun validates every capability before admission. The task PK
// is deterministic per user/key. Competing requests may race, but task creation
// and credit reservation share a transaction: only one can commit.
func (s *Service) CreateCloudAgentRun(userID string, req CloudAgentRequest, parentID string) (*CloudAgentRun, error) {
	if err := validateCloudAgentRequest(&req); err != nil {
		return nil, err
	}
	if userID == "" {
		return nil, kernel.Unauthorized("请先登录")
	}
	canvas, err := s.repo.CanvasProjectForUser(userID, req.CanvasID)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, kernel.NotFound("画布不存在或尚未保存到服务端，请先完成画布同步")
		}
		return nil, err
	}
	// Resolve and freeze the effective preference document before idempotency
	// lookup. A retry without an explicit revision must still refer to the same
	// immutable input; a changed profile therefore cannot silently create a
	// different run under the same key.
	profile, err := s.cloudAgentProfileSnapshot(userID, req.CanvasID)
	if err != nil {
		return nil, err
	}
	if req.ProfileRevision != "" && req.ProfileRevision != profile.Revision {
		return nil, creationConflict("Agent 偏好已变化，请重新读取后提交")
	}
	req.ProfileRevision = profile.Revision
	id := cloudAgentID(userID, req.IdempotencyKey)
	fingerprint := cloudAgentFingerprint(req, parentID)
	if existing, state, lookupErr := s.cloudAgentTask(userID, id); lookupErr == nil {
		if state.Fingerprint == "" || state.Fingerprint != fingerprint {
			return nil, kernel.NewAppError(409, "幂等键已用于不同请求，请使用新的幂等键")
		}
		return s.CloudAgentRun(userID, existing.ID)
	} else {
		var appErr *AppError
		if !errors.As(lookupErr, &appErr) || appErr.Status != 404 {
			return nil, lookupErr
		}
	}
	var history []providerTextMessage
	var creativeAnchor cloudAgentCreativeAnchor
	var inheritedPlan []cloudAgentPlanItem
	if parentID != "" {
		parent, _, parentErr := s.cloudAgentTask(userID, parentID)
		if parentErr != nil {
			return nil, parentErr
		}
		if parent.ProjectID != req.CanvasID {
			return nil, kernel.Forbidden("不能跨画布追加 Agent 消息")
		}
		if parent.Status == model.TaskStatusQueued || parent.Status == model.TaskStatusRunning {
			return nil, kernel.NewAppError(409, "上一轮仍在执行，请等待结束")
		}
		superseded := s.cloudAgentParentCanBeSuperseded(userID, parentID)
		if err := s.advanceCloudAgentByID(userID, parentID); err != nil {
			return nil, err
		}
		// 续轮收束要读上一轮**全部**事件（运行详情默认只返回尾部一窗）：长会话一旦被截断，
		// 新轮就看不到上一轮改过哪些节点、提交过哪些任务，表现为"忘了自己做过什么"。
		parentRun, err := s.CloudAgentRun(userID, parentID, CloudAgentRunViewOptions{EventLimit: cloudAgentContinuationEventLimit})
		if err != nil {
			return nil, err
		}
		if superseded {
			log.Printf("agent run %s cannot resume after a contract change; continuing in a new turn", parentID)
		} else if !cloudAgentRunTerminal(parentRun.Status) || parentRun.CleanupPending {
			return nil, kernel.NewAppError(409, "上一轮 Agent 尚未结束")
		}
		parentExecution, err := s.repo.CloudAgent(userID, parentID)
		if err != nil {
			return nil, err
		}
		parentState, err := cloudAgentDecode(parentExecution)
		if err != nil {
			return nil, WrapAppError(409, "上一轮 Agent 历史记录不完整，无法继续对话；请新建对话", err)
		}
		inheritedPlan = parentState.Plan
		// 视觉事实跨轮继承：这一轮已经看过的画面与模型自己写下的观察随锚点带过来，
		// 否则新轮会把看过的图重新标成"没有视觉识别证据"并再花一次视觉 token。
		creativeAnchor = parentState.CreativeAnchor
		history = parentState.TextHistory
		if history == nil {
			history = cloudAgentLegacyHistory(parentState.Canonical.Messages, parent.Prompt)
		}
		text, context, err := cloudAgentContinuationReply(parent, parentRun)
		if err != nil {
			return nil, err
		}
		// 压缩时 TextHistory 与 Canonical 长度相同；压缩后本轮仍可能继续回答或收到插话。
		// 只补压缩边界之后的内容，不能重复原始要求，也不能丢掉最终回复。
		history = cloudAgentContinuationHistory(history, parentState, parent.Prompt, text)
		// 事实交接帧不能因为压缩而缺席：长会话恰恰最需要它，而且"别重复提交收费任务"的
		// 依据只在这份帧里（它带的是上一轮真实的工具结果与画布改动）。
		if strings.TrimSpace(context) != "" {
			history = append(history, providerTextMessage{Role: "user", Content: context, AgentContextSource: "continuation"})
		}
	}
	history = trimCloudAgentTextHistory(history, cloudAgentHistoryKeepRounds, cloudAgentHistoryMaxBytes)
	encodedHistory, err := json.Marshal(history)
	if err != nil {
		return nil, err
	}
	if len(encodedHistory) > cloudAgentHistoryMaxBytes {
		return nil, BadAuthRequest("对话上下文超过 64KB，请新建对话")
	}
	var inheritedAnchor *cloudAgentCreativeAnchor
	if creativeAnchor.Version > 0 {
		inheritedAnchor = &creativeAnchor
	}
	creativeAnchor, err = cloudAgentCreativeAnchorForCanvas(s.repo, userID, canvas, req.Prompt, inheritedAnchor)
	if err != nil {
		return nil, err
	}
	skillSnapshots, err := s.cloudAgentSkills(userID, req.SkillIDs)
	if err != nil {
		return nil, err
	}
	// 看图能力取决于本轮渠道模型自己的合同（text.references.maxImages），在建 run 时定格并
	// 持久化：工具授权每步都从落库状态重建，运行期间不再变化，客户端传入值被忽略。
	req.VisionEnabled = s.cloudAgentVisionEnabled(req)
	canvasSummary := ""
	if len(req.ContextScope) != 0 {
		canvasSummary, err = cloudAgentCanvasSummary(canvas)
		if err != nil {
			return nil, err
		}
	}
	system, policy, err := compileCloudAgentPolicies(req, skillSnapshots, canvasSummary, profile, creativeAnchor)
	if err != nil {
		return nil, err
	}
	state := cloudAgentState{Version: 1, Request: req, ParentID: parentID, Fingerprint: fingerprint, CreativeAnchor: creativeAnchor, Plan: inheritedPlan, Skills: skillSnapshots, Profile: profile, Policy: policy}
	canonical := cloudAgentCanonicalFor(system, history, req.Prompt, req, len(profile.Layers) > 0)
	s.attachCloudAgentLessons(&canonical, userID, req.Prompt)
	canonical.PromptCacheKey = cloudAgentPromptCacheKey(req.CanvasID, canonical.SystemPrompt)
	attachCloudAgentPlan(&canonical, inheritedPlan)
	input := map[string]any{"mode": "text", "prompt": req.Prompt, "textHistory": history, "textOptions": map[string]any{"stream": true, "thinking": cloudAgentReasoningEnabled(policy.ReasoningMode)}, "cloudAgent": state,
		"agentRequests": map[string]any{"canonical": canonical},
		"config":        map[string]any{"channelId": req.ChannelID, "channelModelKey": req.ChannelModelKey, "model": firstNonEmpty(req.ChannelModelKey, req.Model), "systemPrompt": system}}
	task, err := s.CreateTask(userID, CreateTaskRequest{ProjectID: req.CanvasID, Type: "canvas_text", Operation: cloudAgentOperation, Prompt: req.Prompt, Model: req.Model, LogicalModelID: req.LogicalModelID, Input: input,
		admission: &taskAdmission{ID: id, MaxCharge: int64(math.Floor(req.Budget.MaxCredits * float64(CreditScale)))}})
	if err != nil {
		// A concurrent identical request may have won the transaction. Never
		// replace its result or reserve credits a second time.
		if existing, stored, readErr := s.cloudAgentTask(userID, id); readErr == nil {
			if stored.Fingerprint == "" || stored.Fingerprint != fingerprint {
				return nil, kernel.NewAppError(409, "幂等键已用于不同请求")
			}
			return s.CloudAgentRun(userID, existing.ID)
		}
		return nil, err
	}
	return s.CloudAgentRun(userID, task.ID)
}

// 旧运行记录没有单独保存历史；只从模型请求中当前用户消息之前的严格交替前缀恢复。
func cloudAgentLegacyHistory(messages []map[string]interface{}, currentPrompt string) []providerTextMessage {
	currentIndex := -1
	for index, message := range messages {
		role, _ := message["role"].(string)
		content, _ := message["content"].(string)
		if role != "user" && role != "assistant" {
			break
		}
		if role == "user" && content == currentPrompt {
			currentIndex = index
		}
	}
	if currentIndex < 0 || currentIndex%2 != 0 {
		return nil
	}
	history := make([]providerTextMessage, 0, currentIndex)
	for index := 0; index < currentIndex; index++ {
		role, _ := messages[index]["role"].(string)
		content, ok := messages[index]["content"].(string)
		if !ok || role != []string{"user", "assistant"}[index%2] {
			return nil
		}
		// 来源标记必须一起搬：丢了它，旧会话里的运行时交接消息会被当成真人轮次参与裁剪。
		message := providerTextMessage{Role: role, Content: content}
		if source, ok := messages[index][cloudAgentContextSourceKey].(string); ok && source != "" && source != "runtime" {
			message.AgentContextSource = source
		}
		history = append(history, message)
	}
	return history
}

func cloudAgentContinuationHistory(history []providerTextMessage, state cloudAgentRuntime, prompt, reply string) []providerTextMessage {
	if !state.HistoryIncludesCurrent {
		// The user's goal survives a failed first model call too. Tool facts are
		// context, not authorization to replay a write or charge a second time.
		history = append(history, providerTextMessage{Role: "user", Content: prompt})
		for _, message := range state.Canonical.Messages {
			if stringField(message, cloudAgentContextSourceKey) == "user_interjection" {
				history = append(history, providerTextMessage{Role: "user", Content: stringField(message, "content")})
			}
		}
		return append(history, providerTextMessage{Role: "assistant", Content: reply})
	}
	// TextHistory 是压缩瞬间的 canonical 快照；之后只有 canonical 会追加模型回复。
	// 终态取消/失败可能没有新回复，不能拿压缩前的最后一条 assistant 伪装成新回复。
	after := state.Canonical.Messages[len(state.TextHistory):]
	for _, message := range after {
		if stringField(message, cloudAgentContextSourceKey) == "user_interjection" {
			history = append(history, providerTextMessage{Role: "user", Content: stringField(message, "content")})
		}
	}
	if strings.TrimSpace(reply) != "" {
		for i := len(after) - 1; i >= 0; i-- {
			message := after[i]
			if stringField(message, "role") == "assistant" && stringField(message, "content") == reply {
				if _, hasCalls := message["tool_calls"]; !hasCalls {
					history = append(history, providerTextMessage{Role: "assistant", Content: reply})
				}
				break
			}
		}
	}
	return history
}

const (
	cloudAgentCanvasSummaryMaxNodes    = 80
	cloudAgentCanvasSummaryBudgetBytes = 60 << 10
)

func cloudAgentCanvasSummary(canvas *model.CanvasProject) (string, error) {
	var payload struct {
		Nodes []struct {
			ID       string         `json:"id"`
			Type     string         `json:"type"`
			Title    string         `json:"title"`
			Metadata map[string]any `json:"metadata"`
		} `json:"nodes"`
	}
	if err := json.Unmarshal([]byte(canvas.PayloadJSON), &payload); err != nil {
		return "", BadAuthRequest("服务端画布内容无法解析，请先重新同步")
	}
	nodes := make([]map[string]any, 0)
	for index, node := range payload.Nodes {
		if index >= cloudAgentCanvasSummaryMaxNodes {
			break
		}
		descriptor, known := cloudAgentNodeCapabilityForType(node.Type)
		item := map[string]any{"id": truncateRunes(node.ID, 100), "type": truncateRunes(node.Type, 40), "title": truncateRunes(node.Title, 300)}
		if known {
			projected, err := cloudAgentProjectNodeFields(map[string]any{"title": node.Title}, node.Metadata, descriptor, descriptor.SummaryFields, 600, false, 0)
			if err != nil {
				return "", err
			}
			for key, value := range projected {
				item[key] = value
			}
		} else {
			item["agentSupported"] = false
			item["agentUnsupportedReason"] = "仅展示基础信息；当前 Agent 不支持操作此类型节点"
		}
		nodes = append(nodes, item)
		encoded, err := json.Marshal(nodes)
		if err != nil {
			return "", err
		}
		if len(encoded) > cloudAgentCanvasSummaryBudgetBytes {
			nodes = nodes[:len(nodes)-1]
			break
		}
	}
	summary := map[string]any{"title": truncateRunes(canvas.Title, 240), "savedAt": canvas.UpdatedAt, "totalNodes": len(payload.Nodes), "includedNodes": len(nodes), "nodes": nodes}
	if omitted := len(payload.Nodes) - len(nodes); omitted > 0 {
		summary["omittedNodes"] = omitted
	}
	data, err := json.Marshal(summary)
	if err != nil {
		return "", err
	}
	return string(data), nil
}
