package app

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"math"
	"strings"
	"time"
	"unicode/utf8"

	"gorm.io/gorm"
	"infinite-canvas/backend/internal/kernel"
	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/prompts"
	"infinite-canvas/backend/internal/repository"
)

// A deterministic checkpoint failure must not be retried forever like a transient DB error.
var errCloudAgentCheckpoint = errors.New("invalid Agent checkpoint")

type CloudAgentEvent struct {
	EventID   string         `json:"eventId"`
	RunID     string         `json:"runId"`
	Seq       int            `json:"seq"`
	Type      string         `json:"type"`
	Payload   map[string]any `json:"payload"`
	CreatedAt time.Time      `json:"createdAt"`
}
type cloudAgentCall struct {
	ID       string `json:"id"`
	Function struct {
		Name      string `json:"name"`
		Arguments string `json:"arguments"`
	} `json:"function"`
}

type cloudAgentCachedToolResult struct {
	Result        json.RawMessage `json:"result,omitempty"`
	Error         string          `json:"error,omitempty"`
	ArgumentError bool            `json:"argumentError,omitempty"`
	// ReplayCount 记录同一只读结果被模型重复请求的次数。达到护栏后不再
	// 把缓存结果继续喂回模型，避免模型在同一结果上无限循环。
	ReplayCount int `json:"replayCount,omitempty"`
}

type cloudAgentReadLoopError struct {
	ToolName string
	Count    int
	Budget   bool
}

func (e *cloudAgentReadLoopError) Error() string {
	if e == nil {
		return "Agent 重复读取护栏已触发"
	}
	if e.Budget {
		return fmt.Sprintf("Agent 本轮只读工具调用已达到安全上限（%d 次），本轮已停止以避免继续消耗模型调用；请使用已有结果继续，不要继续读取画布", e.Count)
	}
	return fmt.Sprintf("Agent 连续重复读取同一份%s结果，本轮已停止以避免继续消耗模型调用；请让 Agent 使用已有结果继续，不要再次读取", e.ToolName)
}

type cloudAgentApproval struct {
	Prepared  *cloudAgentPreparedMedia  `json:"prepared,omitempty"`
	ModelName string                    `json:"modelName,omitempty"`
	ID        string                    `json:"approvalId"`
	Call      cloudAgentCall            `json:"call"`
	CallHash  string                    `json:"callHash,omitempty"`
	Preview   cloudAgentApprovalPreview `json:"preview"`
	Decision  string                    `json:"decision,omitempty"`
	Reason    string                    `json:"reason,omitempty"`
}
type cloudAgentRuntime struct {
	RuntimeRunID           string                                  `json:"-"`
	Request                CloudAgentRequest                       `json:"request"`
	Policy                 cloudAgentPolicySnapshot                `json:"policy"`
	ParentID               string                                  `json:"parentId,omitempty"`
	Fingerprint            string                                  `json:"fingerprint,omitempty"`
	CreativeAnchor         cloudAgentCreativeAnchor                `json:"creativeAnchor,omitempty"`
	TextHistory            []providerTextMessage                   `json:"textHistory,omitempty"`
	Skills                 []cloudAgentSkill                       `json:"skills"`
	SkillReads             map[string]bool                         `json:"skillReads,omitempty"`
	Profile                cloudAgentProfileSnapshot               `json:"profile"`
	ProfileReads           map[string]bool                         `json:"profileReads,omitempty"`
	ToolReadResults        map[string]cloudAgentCachedToolResult   `json:"toolReadResults,omitempty"`
	ToolReadReplays        map[string]int                          `json:"toolReadReplays,omitempty"`
	Canonical              canonicalAgentRequest                   `json:"canonical"`
	ActiveTaskID           string                                  `json:"activeTaskId"`
	ActiveTextDraft        string                                  `json:"activeTextDraft,omitempty"`
	MediaTaskID            string                                  `json:"mediaTaskId,omitempty"`
	TaskIDs                []string                                `json:"taskIds"`
	Step                   int                                     `json:"step"`
	Generations            int                                     `json:"generations"`
	VideoSeconds           int                                     `json:"videoSeconds"`
	Calls                  []cloudAgentCall                        `json:"calls"`
	CallIndex              int                                     `json:"callIndex"`
	ToolRepairs            map[string]cloudAgentToolRepair         `json:"toolRepairs,omitempty"`
	Approval               *cloudAgentApproval                     `json:"approval,omitempty"`
	Decisions              map[string]string                       `json:"decisions"`
	DecisionSettings       map[string]string                       `json:"decisionSettings,omitempty"`
	DecisionPreparedHashes map[string]string                       `json:"decisionPreparedHashes,omitempty"`
	ActionNudged           bool                                    `json:"actionNudged,omitempty"`
	EmptyOutputNudged      int                                     `json:"emptyOutputNudged,omitempty"`
	StepSnapshotHash       string                                  `json:"stepSnapshotHash,omitempty"`
	StoryboardTaskID       string                                  `json:"storyboardTaskId,omitempty"`
	Plan                   []cloudAgentPlanItem                    `json:"plan,omitempty"`
	PendingInterjections   []cloudAgentInterjection                `json:"pendingInterjections,omitempty"`
	TransientReferences    map[string]cloudAgentTransientReference `json:"transientReferences,omitempty"`
	InterjectionIDs        []string                                `json:"interjectionIds,omitempty"`
	Events                 []CloudAgentEvent                       `json:"events"`
	// EmptyOutputEscalated 记录"空输出已经升级重试过几次"（关思考 + 放大输出预算）。
	EmptyOutputEscalated int `json:"emptyOutputEscalated,omitempty"`
	// StepTimeoutEscalated 记录"单步墙钟到点后已经关思考重试过几次"。
	StepTimeoutEscalated int `json:"stepTimeoutEscalated,omitempty"`
	// ForceThinkingOff 让本步请求强制关闭上游思考：思考模型偶发把整个输出预算花在推理上，
	// 结果正文与工具调用皆空（实测 output_tokens 正好等于 maxOutputTokens）。
	ForceThinkingOff bool `json:"forceThinkingOff,omitempty"`
	// BoostStepOutputBudget 让本步请求使用放大后的输出预算（配合关思考重试）。
	BoostStepOutputBudget bool `json:"boostStepOutputBudget,omitempty"`
	// StepLimits 是本步实际生效的执行边界（管理员策略解析结果），只用于构造请求：
	// 不进状态 JSON——每次推进都按当时的策略重新解析，改配置无需重发本轮。
	StepLimits cloudAgentStepLimits `json:"-"`
	// ImageInspectCounts 记录本轮内每张图被查看的次数，用于"同一张图不要反复看"的护栏。
	ImageInspectCounts map[string]int `json:"imageInspectCounts,omitempty"`
	// ImageInspectionReads 以“节点 + 资源 + 画布 revision”为 key，避免同一张图在
	// 同一版本的画布里反复触发视觉输入。画布内容变化后 key 自然变化，允许重新识别。
	ImageInspectionReads map[string]int `json:"imageInspectionReads,omitempty"`
	// ImageInspectCalls 记录本轮所有图片识别工具调用次数（包括只回执文字的重复调用）。
	// 它与 ImageInspectCounts 一起进检查点，防止模型通过 refresh 或切换节点绕过总预算。
	ImageInspectCalls int `json:"imageInspectCalls,omitempty"`
	// ReadToolCalls 记录本轮会读取运行时只读快照的工具调用次数。除了同参缓存护栏，
	// 还需要一个跨参数的总上限，防止模型通过不断变化 offset/nodeIds 绕过重复读取保护。
	ReadToolCalls int `json:"readToolCalls,omitempty"`
	// PendingImageInspections 暂存"本批还有工具结果没入历史"的看图结果，等整批 tool
	// 结果都入历史后合并成一条 user 图片消息（见 cloudAgentFlushPendingImages）。
	//
	// 它必须进检查点，不能标 `json:"-"`：一次 advanceCloudAgent 只执行一个工具调用
	// （advanceCloudAgentTool 执行完就 return，下一批调用走下一次转移），而每次转移都
	// 从 StateJSON 重新解码（cloudAgentDecode）。进程内字段在下一个调用到来时必然为空，
	// 缓冲就白缓冲了。载荷只有回执与签名链接，几十字节级。
	PendingImageInspections []cloudAgentImageInspection `json:"pendingImageInspections,omitempty"`
}

type cloudAgentTransientReference struct {
	ID         string    `json:"id"`
	Name       string    `json:"name"`
	MIMEType   string    `json:"mimeType"`
	ResourceID string    `json:"resourceId"`
	ExpiresAt  time.Time `json:"expiresAt"`
}

func (s *Service) ensureCloudAgentExecution(task *model.Task, initial cloudAgentState) error {
	var input struct {
		TextHistory []providerTextMessage `json:"textHistory"`
		Requests    struct {
			Canonical canonicalAgentRequest `json:"canonical"`
		} `json:"agentRequests"`
	}
	if err := json.Unmarshal([]byte(task.InputJSON), &input); err != nil {
		return err
	}
	canonical := input.Requests.Canonical
	canonical.SystemPrompt = stripCloudAgentPlanBlock(canonical.SystemPrompt)
	canonical.Messages = stripCloudAgentRuntimeContext(canonical.Messages)
	limits, err := s.cloudAgentStepLimits()
	if err != nil {
		return err
	}
	state := cloudAgentRuntime{Request: initial.Request, Policy: initial.Policy, ParentID: initial.ParentID, Fingerprint: initial.Fingerprint, CreativeAnchor: initial.CreativeAnchor, TextHistory: input.TextHistory, Skills: initial.Skills, Profile: initial.Profile, Canonical: canonical, ActiveTaskID: task.ID, TaskIDs: []string{task.ID}, Step: 1, Decisions: map[string]string{}, Plan: initial.Plan, Events: []CloudAgentEvent{}, StepLimits: limits}
	if len(initial.Skills) > 0 {
		// skillIds makes the enablement auditable: usage telemetry can attribute a
		// run to the skills it actually loaded instead of only counting the total.
		skillIDs := make([]string, 0, len(initial.Skills))
		for _, skill := range initial.Skills {
			skillIDs = append(skillIDs, skill.ID)
		}
		state.event(task.ID, "tool_completed", map[string]any{"toolName": "skills_load", "skillIds": skillIDs, "text": fmt.Sprintf("已启用 %d 个技能，正文将按需读取", len(initial.Skills))})
	}
	run := &model.CloudAgentExecution{ID: task.ID, UserID: task.UserID, Status: "running", Revision: 1, CreatedAt: task.CreatedAt, UpdatedAt: time.Now()}
	if err := cloudAgentSave(run, &state); err != nil {
		return err
	}
	return s.repo.EnsureCloudAgent(run)
}
func (state *cloudAgentRuntime) event(id, kind string, payload map[string]any) {
	seq := len(state.Events) + 1
	state.Events = append(state.Events, CloudAgentEvent{EventID: fmt.Sprintf("%s:%d", id, seq), RunID: id, Seq: seq, Type: kind, Payload: payload, CreatedAt: time.Now()})
}
func cloudAgentDecode(run *model.CloudAgentExecution) (cloudAgentRuntime, error) {
	var state cloudAgentRuntime
	if run == nil || strings.TrimSpace(run.StateJSON) == "" {
		return state, errors.New("Agent runtime state is empty")
	}
	if err := json.Unmarshal([]byte(run.StateJSON), &state); err != nil {
		return state, fmt.Errorf("decode Agent runtime state: %w", err)
	}
	state.RuntimeRunID = run.ID
	if run.CheckpointVersion >= 2 {
		if len(run.Journal) != run.EventCount || len(run.Transcript) != run.MessageCount {
			return state, errors.New("Agent execution journal is incomplete")
		}
		state.Events = make([]CloudAgentEvent, 0, len(run.Journal))
		state.Canonical.Messages, state.TextHistory = nil, nil
		for _, record := range run.Journal {
			expected := len(state.Events) + 1
			if record.Sequence != expected {
				return state, errors.New("Agent event sequence is incomplete")
			}
			var event CloudAgentEvent
			if err := json.Unmarshal([]byte(record.EventJSON), &event); err != nil {
				return state, fmt.Errorf("decode Agent event: %w", err)
			}
			if event.Seq != record.Sequence || event.RunID != run.ID || event.EventID != fmt.Sprintf("%s:%d", run.ID, record.Sequence) {
				return state, errors.New("Agent event identity is invalid")
			}
			state.Events = append(state.Events, event)
		}
		for _, record := range run.Transcript {
			switch record.Kind {
			case "canonical":
				var message map[string]any
				if err := json.Unmarshal([]byte(record.MessageJSON), &message); err != nil {
					return state, fmt.Errorf("decode Agent message: %w", err)
				}
				if record.Sequence != len(state.Canonical.Messages)+1 {
					return state, errors.New("Agent message sequence is incomplete")
				}
				state.Canonical.Messages = append(state.Canonical.Messages, message)
			case "history":
				var message providerTextMessage
				if err := json.Unmarshal([]byte(record.MessageJSON), &message); err != nil {
					return state, fmt.Errorf("decode Agent history: %w", err)
				}
				if record.Sequence != len(state.TextHistory)+1 {
					return state, errors.New("Agent history sequence is incomplete")
				}
				state.TextHistory = append(state.TextHistory, message)
			default:
				return state, errors.New("Agent message kind is unsupported")
			}
		}
	}
	if err := validateCloudAgentRuntime(run, &state); err != nil {
		return state, err
	}
	return state, nil
}

// cloudAgentDecodeForExecution is the only decoder for paths that may resume
// model/tool execution. Historical reads intentionally use cloudAgentDecode:
// a completed turn keeps its frozen policy and capability snapshot and remains
// valid conversation context after the current runtime contract advances.
func cloudAgentDecodeForExecution(run *model.CloudAgentExecution) (cloudAgentRuntime, error) {
	state, err := cloudAgentDecode(run)
	if err != nil {
		return state, WrapAppError(409, "Agent 运行记录无法安全恢复；请新建一轮消息", err)
	}
	if err := validateCloudAgentPolicySnapshot(state.Policy); err != nil {
		return state, WrapAppError(409, "Agent 运行使用旧版执行合同，无法继续原运行；请新建一轮消息", err)
	}
	return state, nil
}

func validateCloudAgentRuntime(run *model.CloudAgentExecution, state *cloudAgentRuntime) error {
	if run == nil || state == nil {
		return errors.New("Agent runtime state is missing")
	}
	if run.ID == "" {
		// Package-level tool tests use an in-memory runtime without a durable
		// execution identity. Durable rows are always validated below.
		return nil
	}
	if state.Request.CanvasID == "" || state.Request.Prompt == "" || state.Request.PermissionMode == "" {
		return errors.New("Agent runtime request is incomplete")
	}
	if err := validateCloudAgentRequest(&state.Request); err != nil {
		return fmt.Errorf("invalid Agent runtime request: %w", err)
	}
	if err := validateCloudAgentPolicySnapshotStructure(state.Policy); err != nil {
		return err
	}
	if err := validateCloudAgentProfileSnapshot(state.Profile, state.Policy); err != nil {
		return err
	}
	for scope, read := range state.ProfileReads {
		found := false
		for _, layer := range state.Profile.Layers {
			found = found || layer.Scope == scope
		}
		if !read || !found {
			return errors.New("Agent runtime profile read history is invalid")
		}
	}
	if state.Step < 0 || state.Generations < 0 || state.VideoSeconds < 0 {
		return errors.New("Agent runtime budget or step is invalid")
	}
	if state.ImageInspectCalls < 0 {
		return errors.New("Agent runtime image inspection budget is invalid")
	}
	if state.ReadToolCalls < 0 {
		return errors.New("Agent runtime read tool budget is invalid")
	}
	for nodeID, count := range state.ImageInspectCounts {
		if strings.TrimSpace(nodeID) == "" || count < 0 {
			return errors.New("Agent runtime image inspection counts are invalid")
		}
	}
	for key, count := range state.ImageInspectionReads {
		if strings.TrimSpace(key) == "" || count < 0 {
			return errors.New("Agent runtime image inspection read history is invalid")
		}
	}
	for key, count := range state.ToolReadReplays {
		if strings.TrimSpace(key) == "" || count < 0 {
			return errors.New("Agent runtime read replay history is invalid")
		}
	}
	if (state.Request.Budget.MaxGenerationTasks > 0 && state.Generations > state.Request.Budget.MaxGenerationTasks) || (state.Request.Budget.MaxVideoSeconds > 0 && state.VideoSeconds > state.Request.Budget.MaxVideoSeconds) {
		return errors.New("Agent runtime generation budget is invalid")
	}
	if state.CallIndex < 0 || state.CallIndex > len(state.Calls) || len(state.Calls) > cloudAgentMaxToolCalls {
		return errors.New("Agent runtime call cursor is invalid")
	}
	for toolName, repair := range state.ToolRepairs {
		if toolName == "" || utf8.RuneCountInString(toolName) > 80 || repair.Attempt < 1 || repair.Attempt > cloudAgentToolAttemptLimit || repair.GroupID == "" {
			return errors.New("Agent runtime tool repair state is invalid")
		}
		if err := validateCloudAgentID(repair.GroupID, "工具纠错组 ID", 240); err != nil {
			return err
		}
	}
	if state.ActiveTaskID != "" && state.MediaTaskID != "" {
		return errors.New("Agent runtime has multiple active tasks")
	}
	if len(state.TaskIDs) == 0 {
		return errors.New("Agent runtime task history is invalid")
	}
	seenTasks := make(map[string]struct{}, len(state.TaskIDs))
	for _, taskID := range state.TaskIDs {
		if err := validateCloudAgentID(taskID, "任务 ID", 80); err != nil {
			return err
		}
		if _, exists := seenTasks[taskID]; exists {
			return errors.New("Agent runtime task history contains duplicates")
		}
		seenTasks[taskID] = struct{}{}
	}
	if state.ActiveTaskID != "" && !cloudAgentContainsString(state.TaskIDs, state.ActiveTaskID) {
		return errors.New("Agent runtime active task is not in task history")
	}
	if state.MediaTaskID != "" {
		if !cloudAgentContainsString(state.TaskIDs, state.MediaTaskID) || state.CallIndex >= len(state.Calls) || state.Calls[state.CallIndex].Function.Name != "generate_media" {
			return errors.New("Agent runtime media task is not attached to current call")
		}
	}
	if state.Decisions == nil || state.Events == nil {
		return errors.New("Agent runtime maps are missing")
	}
	for index, event := range state.Events {
		if event.RunID != run.ID || event.Seq != index+1 || event.EventID == "" || event.Type == "" || event.Payload == nil || event.CreatedAt.IsZero() {
			return errors.New("Agent runtime event history is invalid")
		}
		if err := validateCloudAgentID(event.EventID, "事件 ID", 240); err != nil {
			return err
		}
		raw, err := json.Marshal(event.Payload)
		if err != nil || len(raw) > 128<<10 {
			return errors.New("Agent runtime event payload is too large")
		}
	}
	for _, call := range state.Calls {
		if err := validateCloudAgentID(call.ID, "工具调用 ID", 160); err != nil || call.Function.Name == "" || utf8.RuneCountInString(call.Function.Name) > 80 || !utf8.ValidString(call.Function.Name) {
			return errors.New("Agent runtime tool call is invalid")
		}
		if len(call.Function.Arguments) > 32000 {
			return errors.New("Agent runtime tool arguments are too large")
		}
		if err := decodeCloudAgentJSONObject(call.Function.Arguments, &map[string]any{}); err != nil {
			return errors.New("Agent runtime tool arguments are invalid")
		}
	}
	if state.Approval != nil {
		if err := validateCloudAgentID(state.Approval.ID, "审批 ID", 200); err != nil || state.CallIndex >= len(state.Calls) {
			return errors.New("Agent runtime approval is invalid")
		}
		current := state.Calls[state.CallIndex]
		if state.Approval.Call.ID != current.ID || state.Approval.Call.Function.Name != current.Function.Name || state.Approval.Call.Function.Arguments != current.Function.Arguments {
			return errors.New("Agent runtime approval does not match current call")
		}
		if state.Approval.Decision != "" && state.Approval.Decision != "approve" && state.Approval.Decision != "reject" {
			return errors.New("Agent runtime approval decision is invalid")
		}
	}
	if state.CallIndex == len(state.Calls) && state.Approval != nil {
		return errors.New("Agent runtime has approval without a pending call")
	}
	return nil
}

func validateCloudAgentPolicySnapshot(snapshot cloudAgentPolicySnapshot) error {
	if err := validateCloudAgentPolicySnapshotStructure(snapshot); err != nil {
		return err
	}
	if snapshot.CompilerVersion != cloudAgentCompilerVersion {
		return errors.New("Agent runtime policy compiler is unsupported")
	}
	if snapshot.CapabilitySetVersion != cloudAgentCapabilitySetVersion {
		return errors.New("Agent runtime capability contract is unsupported")
	}
	if snapshot.ReasoningMode != "off" && snapshot.ReasoningMode != "auto" && snapshot.ReasoningMode != "deep" {
		return errors.New("Agent runtime reasoning mode is invalid")
	}
	system, media, err := prompts.LoadAgentPolicies()
	if err != nil {
		return fmt.Errorf("load Agent runtime policies: %w", err)
	}
	if snapshot.SystemPolicyID != system.ID || snapshot.SystemPolicyVersion != system.Version || snapshot.MediaPolicyID != media.ID || snapshot.MediaPolicyVersion != media.Version {
		return errors.New("Agent runtime policy version is unsupported")
	}
	// An existing run keeps its admitted prompt and tool schema. Never resume it
	// against changed policies or capabilities under an unchanged version label.
	if snapshot.SystemPolicyHash != system.Hash || snapshot.MediaPolicyHash != media.Hash || snapshot.CapabilitySetHash != cloudAgentCapabilitySetHash() {
		return errors.New("Agent runtime policy or capability contract has changed")
	}
	return nil
}

// validateCloudAgentPolicySnapshotStructure validates the frozen historical
// record without treating the current binary as its authorization source.
// Version/hash equality with the current runtime is checked separately, only
// when an old run is about to execute again.
func validateCloudAgentPolicySnapshotStructure(snapshot cloudAgentPolicySnapshot) error {
	for _, field := range []struct {
		name  string
		value string
	}{
		{"policy compiler", snapshot.CompilerVersion},
		{"system policy ID", snapshot.SystemPolicyID},
		{"media policy ID", snapshot.MediaPolicyID},
		{"capability set version", snapshot.CapabilitySetVersion},
	} {
		if strings.TrimSpace(field.value) == "" || !utf8.ValidString(field.value) || utf8.RuneCountInString(field.value) > 120 {
			return fmt.Errorf("Agent runtime %s is invalid", field.name)
		}
	}
	if snapshot.SystemPolicyVersion <= 0 || snapshot.MediaPolicyVersion <= 0 {
		return errors.New("Agent runtime policy version is invalid")
	}
	if snapshot.ReasoningMode != "off" && snapshot.ReasoningMode != "auto" && snapshot.ReasoningMode != "deep" {
		return errors.New("Agent runtime reasoning mode is invalid")
	}
	for _, field := range []struct {
		name  string
		value string
	}{
		{"system policy hash", snapshot.SystemPolicyHash},
		{"media policy hash", snapshot.MediaPolicyHash},
		{"capability set hash", snapshot.CapabilitySetHash},
		{"profile revision", snapshot.ProfileRevision},
		{"profile hash", snapshot.ProfileHash},
	} {
		if !cloudAgentSHA256(field.value) {
			return fmt.Errorf("Agent runtime %s is invalid", field.name)
		}
	}
	return nil
}

func cloudAgentSHA256(value string) bool {
	if len(value) != 64 {
		return false
	}
	for _, r := range value {
		if !((r >= '0' && r <= '9') || (r >= 'a' && r <= 'f')) {
			return false
		}
	}
	return true
}

func cloudAgentContainsString(values []string, target string) bool {
	for _, value := range values {
		if value == target {
			return true
		}
	}
	return false
}
func cloudAgentSave(run *model.CloudAgentExecution, state *cloudAgentRuntime) error {
	if run == nil || state == nil {
		return errors.New("Agent runtime state is missing")
	}
	// 轮内唯一裁剪 = 图片：超出保留轮次的看图结果换成文字回执（正文一律保留）。
	// 上游每一步都会重新读取历史里的图片并按视觉 token 计费，保留整段历史既贵又没有新信息。
	if changed, pruned := cloudAgentPruneInspectedImages(&state.Canonical, nil); changed && run.ID != "" {
		state.event(run.ID, "context_images_pruned", map[string]any{
			"prunedImages": pruned, "retentionRounds": cloudAgentImageRetentionRounds,
			"text": "已把超出保留轮次的看图结果移出模型上下文（保留文字回执与 nodeId）",
		})
	}
	if run.ID != "" {
		if err := validateCloudAgentRuntime(run, state); err != nil {
			return fmt.Errorf("%w: %v", errCloudAgentCheckpoint, err)
		}
		for index, event := range state.Events {
			sequence := index + 1
			if event.Seq != sequence || event.RunID != run.ID || event.EventID != fmt.Sprintf("%s:%d", run.ID, sequence) {
				return fmt.Errorf("%w: Agent event sequence or identity is invalid", errCloudAgentCheckpoint)
			}
		}
	}
	checkpoint := *state
	checkpoint.Canonical.Messages = nil
	checkpoint.TextHistory = nil
	checkpoint.Events = nil
	raw, err := json.Marshal(checkpoint)
	if err != nil {
		return fmt.Errorf("%w: %v", errCloudAgentCheckpoint, err)
	}
	if len(raw) > 512<<10 {
		return fmt.Errorf("%w: Agent 状态超过 512KB 上限", errCloudAgentCheckpoint)
	}
	run.CanvasID, run.ActiveTaskID, run.MediaTaskID = state.Request.CanvasID, state.ActiveTaskID, state.MediaTaskID
	run.ParentID = state.ParentID
	if run.Title == "" {
		run.Title = truncateRunes(state.Request.Prompt, 80)
	}
	run.Journal = make([]model.CloudAgentEventRecord, 0, len(state.Events))
	for _, event := range state.Events {
		body, err := json.Marshal(event)
		if err != nil {
			return fmt.Errorf("%w: encode Agent event: %v", errCloudAgentCheckpoint, err)
		}
		run.Journal = append(run.Journal, model.CloudAgentEventRecord{RunID: run.ID, UserID: run.UserID, Sequence: event.Seq, EventJSON: string(body), CreatedAt: event.CreatedAt})
	}
	run.Transcript = make([]model.CloudAgentMessageRecord, 0, len(state.Canonical.Messages)+len(state.TextHistory))
	for index, message := range state.Canonical.Messages {
		body, err := json.Marshal(message)
		if err != nil {
			return fmt.Errorf("%w: encode Agent message: %v", errCloudAgentCheckpoint, err)
		}
		run.Transcript = append(run.Transcript, model.CloudAgentMessageRecord{RunID: run.ID, UserID: run.UserID, Kind: "canonical", Sequence: index + 1, MessageJSON: string(body)})
	}
	for index, message := range state.TextHistory {
		body, err := json.Marshal(message)
		if err != nil {
			return fmt.Errorf("%w: encode Agent history: %v", errCloudAgentCheckpoint, err)
		}
		run.Transcript = append(run.Transcript, model.CloudAgentMessageRecord{RunID: run.ID, UserID: run.UserID, Kind: "history", Sequence: index + 1, MessageJSON: string(body)})
	}
	run.CheckpointVersion, run.EventCount, run.MessageCount = 2, len(run.Journal), len(run.Transcript)
	run.StateJSON = string(raw)
	return nil
}
func (s *Service) cloudAgentExecutionOutput(task *model.Task, initial cloudAgentState) (*CloudAgentRun, error) {
	run, err := s.repo.CloudAgent(task.UserID, task.ID)
	if err != nil {
		return nil, err
	}
	state, stateErr := cloudAgentDecode(run)
	if stateErr != nil {
		// A terminal failed run must remain readable even if its durable runtime
		// blob was damaged. Do not invent permissions or approval state; expose
		// only the identity available from the original task input.
		state = cloudAgentRuntime{Request: initial.Request, ParentID: initial.ParentID, CreativeAnchor: initial.CreativeAnchor, Skills: initial.Skills, Profile: initial.Profile, TaskIDs: []string{task.ID}, Events: []CloudAgentEvent{}}
	}
	out := agentRunOutput(task, initial)
	out.Status = run.Status
	out.Revision, out.CleanupPending, out.FailureMessage = run.Revision, run.CleanupPending, run.FailureMessage
	out.UpdatedAt = run.UpdatedAt
	out.Events = state.Events
	out.Approval = state.Approval
	if cloudAgentRunTerminal(run.Status) {
		out.Approval = nil
	}
	out.Step = state.Step
	if stateErr == nil && state.ActiveTaskID != "" && (run.Status == "running" || run.Status == "queued") {
		active, err := s.repo.TaskForUser(task.UserID, state.ActiveTaskID)
		if err != nil {
			return nil, err
		}
		if active.TextDraft != "" {
			out.ActiveMessage = map[string]string{"messageId": active.ID, "text": active.TextDraft}
		}
	}
	out.Skills = make([]cloudAgentSkill, 0, len(state.Skills))
	for _, skill := range state.Skills {
		skill.Instruction = ""
		skill.Files = nil
		out.Skills = append(out.Skills, skill)
	}
	orders, err := s.repo.BillingOrdersByTaskIDs(task.UserID, state.TaskIDs)
	if err != nil {
		return nil, err
	}
	for _, order := range orders {
		out.SpentCredits += float64(order.AmountMicrocredits) / float64(CreditScale)
	}
	return out, nil
}

// Runs one bounded transition at a time; no model HTTP call or approval wait holds a DB lock.
func (s *Service) advanceCloudAgentByID(userID, id string) error {
	// Do not decode the task input/runtime before checking for an existing
	// execution. A damaged runtime must be terminally recoverable, not
	// accidentally replaced by a fresh execution row.
	task, err := s.repo.TaskForUser(userID, id)
	if err != nil {
		return err
	}
	if task.Operation != cloudAgentOperation {
		return kernel.NotFound("Agent 运行不存在")
	}
	run, lookupErr := s.repo.CloudAgent(userID, id)
	if errors.Is(lookupErr, gorm.ErrRecordNotFound) {
		_, initial, taskErr := s.cloudAgentTask(userID, id)
		if taskErr != nil {
			return taskErr
		}
		if err := s.ensureCloudAgentExecution(task, initial); err != nil {
			return err
		}
		run, lookupErr = s.repo.CloudAgent(userID, id)
	}
	if lookupErr != nil {
		return lookupErr
	}
	return s.advanceCloudAgent(run)
}
func (s *Service) advanceCloudAgents() {
	s.agentSchedulerMu.Lock()
	defer s.agentSchedulerMu.Unlock()
	roots, err := s.repo.CloudAgentRoots()
	if err != nil {
		log.Printf("agent recovery: %v", err)
		return
	}
	for _, task := range roots {
		_, state, e := s.cloudAgentTask(task.UserID, task.ID)
		if e == nil {
			e = s.ensureCloudAgentExecution(&task, state)
		}
		if e != nil {
			log.Printf("agent recovery %s: %v", task.ID, e)
		}
	}
	runs, err := s.repo.ActiveCloudAgentsAfter(s.agentSchedulerCursor, 50)
	if err == nil && len(runs) == 0 && s.agentSchedulerCursor != "" {
		s.agentSchedulerCursor = ""
		runs, err = s.repo.ActiveCloudAgentsAfter("", 50)
	}
	if err != nil {
		log.Printf("agent scheduler: %v", err)
		return
	}
	for i := range runs {
		s.agentSchedulerCursor = runs[i].ID
		if s.terminateStuckCloudAgent(&runs[i]) {
			continue
		}
		err = s.advanceCloudAgent(&runs[i])
		if err == nil {
			s.clearCloudAgentSchedulerConflict(runs[i].ID)
			continue
		}
		if errors.Is(err, repository.ErrCreationConflict) {
			s.noteCloudAgentSchedulerConflict(runs[i].ID)
			continue
		}
		log.Printf("agent transition %s: %v", runs[i].ID, err)
	}
}

func (s *Service) advanceCloudAgent(run *model.CloudAgentExecution) (err error) {
	defer func() {
		if errors.Is(err, errCloudAgentCheckpoint) {
			err = s.terminateCloudAgent(run, "Agent 上下文或执行记录超过安全限制，本轮已停止；已有任务结果保留在任务中心")
		}
	}()
	if run.CleanupPending {
		return s.finishCloudAgentCleanup(context.Background(), run)
	}
	if run.Status != "running" && run.Status != "queued" {
		return nil
	}
	state, err := cloudAgentDecodeForExecution(run)
	if err != nil {
		var appErr *AppError
		if errors.As(err, &appErr) && appErr != nil {
			return s.terminateCloudAgent(run, appErr.Message)
		}
		return s.terminateCloudAgent(run, "Agent 运行状态损坏，本轮已停止")
	}
	// 单步边界每次推进都重新解析：管理员改配置后，正在跑的这一轮下一步就用新值。
	state.StepLimits, err = s.cloudAgentStepLimits()
	if err != nil {
		return err
	}
	if state.ActiveTaskID != "" {
		task, err := s.repo.TaskForUser(run.UserID, state.ActiveTaskID)
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return s.terminateCloudAgent(run, "Agent 模型任务已不存在，本轮已停止")
		}
		if err != nil {
			return err // Transient database failures must not terminate a live task.
		}
		if task.Status == model.TaskStatusQueued || task.Status == model.TaskStatusRunning {
			// 将已持久化的模型增量转成 Agent 事件；不拆分完整答案伪装成流式。
			if task.TextDraft != state.ActiveTextDraft {
				delta := ""
				eventType := "assistant_snapshot"
				payload := map[string]any{"messageId": task.ID, "text": task.TextDraft, "replace": true}
				if strings.HasPrefix(task.TextDraft, state.ActiveTextDraft) {
					delta = strings.TrimPrefix(task.TextDraft, state.ActiveTextDraft)
					if delta == "" {
						return nil
					}
					eventType = "assistant_delta"
					payload = map[string]any{"messageId": task.ID, "text": delta}
				}
				if err := s.repo.MutateCloudAgent(run.UserID, run.ID, run.Revision, func(current *model.CloudAgentExecution, repo *repository.Repository) error {
					state.event(run.ID, eventType, payload)
					state.ActiveTextDraft = task.TextDraft
					return cloudAgentSave(current, &state)
				}); err != nil {
					return err
				}
			}
			return nil
		}
		var result struct {
			Text      string           `json:"text"`
			Reasoning string           `json:"reasoning"`
			ToolCalls []cloudAgentCall `json:"toolCalls"`
			Legacy    []cloudAgentCall `json:"tool_calls"`
		}
		if task.Status == model.TaskStatusSucceeded {
			if err := json.Unmarshal([]byte(task.ResultJSON), &result); err != nil {
				return s.terminateCloudAgent(run, "模型任务结果损坏，本轮已停止")
			}
			calls := result.ToolCalls
			if len(calls) == 0 {
				calls = result.Legacy
			}
			if violation := cloudAgentOutputViolation(result.Text, len(calls)); violation != "" {
				return s.correctCloudAgentOutput(run, &state, violation)
			}
			if err := validateCloudAgentCalls(calls); err != nil {
				return s.correctCloudAgentOutput(run, &state, "工具调用无效或重复（callId 不能重复、参数必须是 JSON 对象）")
			}
			result.ToolCalls = calls
		}
		if task.Status != model.TaskStatusSucceeded && cloudAgentTruncatedToolArguments(task) {
			return s.correctCloudAgentTruncatedCalls(run, &state)
		}
		if cloudAgentEmptyModelOutput(task) {
			if state.EmptyOutputNudged < cloudAgentMaxEmptyOutputNudges {
				return s.correctCloudAgentEmptyOutput(run, &state)
			}
			// 催过仍然空：改为"关思考 + 放大输出预算"重试同一步，而不是把整轮判死。
			if state.EmptyOutputEscalated < cloudAgentMaxEmptyOutputEscalations {
				return s.correctCloudAgentEmptyOutputEscalation(run, &state)
			}
		}
		// 单步墙钟到点同样是可恢复失败：关思考重试一次，而不是把整轮判死。
		if cloudAgentStepTimedOut(task) && state.StepTimeoutEscalated < cloudAgentMaxStepTimeoutEscalations {
			return s.correctCloudAgentStepTimeout(run, &state)
		}
		return s.repo.MutateCloudAgent(run.UserID, run.ID, run.Revision, func(current *model.CloudAgentExecution, repo *repository.Repository) error {
			if task.Status != model.TaskStatusSucceeded {
				current.Status = "failed"
				text, reason := cloudAgentModelFailure(task)
				current.FailureMessage = truncateRunes(text, 1000)
				cloudAgentDropInterjections(run.ID, "本轮已结束："+truncateRunes(text, 120), &state)
				state.event(run.ID, "run_failed", map[string]any{"text": text, "reason": reason, "taskId": task.ID})
				return cloudAgentSave(current, &state)
			}
			calls := result.ToolCalls
			if result.Reasoning != "" {
				state.event(run.ID, "reasoning_message", map[string]any{"messageId": task.ID + ":reasoning", "text": truncateRunes(result.Reasoning, 8000)})
			}
			if result.Text != "" {
				state.event(run.ID, "assistant_message", map[string]any{"messageId": task.ID, "text": result.Text})
				// 普通正文可能是读取失败或多图混合回答，不能自动归为某张图的视觉事实。
				if len(calls) == 0 {
					state.Canonical.Messages = append(state.Canonical.Messages, map[string]any{"role": "assistant", "content": result.Text})
				}
			}
			state.ActiveTaskID = ""
			if len(calls) > 0 || strings.TrimSpace(result.Text) != "" {
				state.EmptyOutputNudged = 0
			}
			state.Canonical.ToolChoice = "auto"
			state.Calls = calls
			state.CallIndex = 0
			state.StepSnapshotHash = cloudAgentCaptureStepSnapshotHash(calls)
			if len(calls) > 0 {
				state.Canonical.Messages = append(state.Canonical.Messages, map[string]any{"role": "assistant", "content": result.Text, "tool_calls": calls})
			}
			if len(calls) == 0 {
				if len(state.PendingInterjections) > 0 {
					if !cloudAgentStepBudgetExhausted(&state) {
						return cloudAgentSave(current, &state)
					}
					cloudAgentDropInterjections(run.ID, "本轮已达到模型调用上限", &state)
				}
				if !cloudAgentStepBudgetExhausted(&state) && !state.ActionNudged {
					if pending := cloudAgentPendingPlanItems(state.Plan); len(pending) > 0 {
						state.ActionNudged = true
						state.Canonical.Messages = append(state.Canonical.Messages, cloudAgentPlanNudgeMessage(&state, pending[0]))
						return cloudAgentSave(current, &state)
					}
				}
				current.Status = "completed"
			}
			return cloudAgentSave(current, &state)
		})
	}
	if state.CallIndex < len(state.Calls) {
		return s.advanceCloudAgentTool(run, &state)
	}
	// 兜底 flush：本批调用都执行完了（无论最后一个调用是不是看图、有没有被中断），
	// 缓冲里的图片必须在这里合并成一条 user 消息落到全部 tool 结果之后。少了这一步，
	// "看图不是最后一个调用"的批次会把图片永久丢掉，而对应的 tool 回执已经在历史里。
	// 幂等：正常路径（最后一个调用就是看图）已经在 cloudAgentRecordToolResult 里 flush 过。
	cloudAgentFlushPendingImages(&state)
	contextBudget := s.cloudAgentContextBudgetForRequest(state.Request)
	if compactCloudAgentContext(&state.Canonical, contextBudget) {
		// Evicted read bodies must be obtainable again after compaction.
		state.SkillReads = nil
		state.ProfileReads = nil
	}
	if stepLimit := cloudAgentStepLimit(state.Request); stepLimit > 0 && state.Step >= stepLimit {
		return s.failCloudAgent(run, &state, fmt.Sprintf("达到 %d 次模型调用上限，本轮已停止", stepLimit))
	}
	cloudAgentDrainInterjections(run.ID, &state)
	// 轮内唯一裁剪 = 图片：超出保留轮次的看图结果换成文字回执（正文一律保留）。
	// 它必须在压缩判定之前跑：图片是最贵的一类内容，先移出再评估 token 压力才有意义。
	if changed, pruned := cloudAgentPruneInspectedImages(&state.Canonical, nil); changed {
		state.event(run.ID, "context_images_pruned", map[string]any{
			"prunedImages": pruned, "retentionRounds": cloudAgentImageRetentionRounds,
			"text": "图片裁剪：移出超出保留轮次的看图结果",
		})
	}
	canonical, contextErr := s.cloudAgentModelContext(run, &state, contextBudget)
	if contextErr != nil {
		var appErr *AppError
		if errors.As(contextErr, &appErr) {
			return s.failCloudAgent(run, &state, appErr.Message)
		}
		return contextErr
	}
	s.attachCloudAgentLessons(&canonical, run.UserID, cloudAgentLessonTaskText(&state))
	references, refErr := s.cloudAgentImageReferences(run.UserID, state.Request, &canonical)
	if refErr != nil {
		return s.failCloudAgent(run, &state, cloudAgentSafeToolError(refErr))
	}
	// 单步输出上限与思考开关：默认按策略给每一步带上界（不带上界时上游按剩余上下文放行，
	// 思考模型可以把单步拖到几分钟）；空输出升级重试时改为关思考 + 放大预算。
	stepThinking := cloudAgentReasoningEnabled(state.Policy.ReasoningMode) && !state.ForceThinkingOff
	stepOutputTokens := cloudAgentStepOutputBudget(state.StepLimits, state.BoostStepOutputBudget)
	input := map[string]any{"mode": "text", "prompt": state.Request.Prompt, "agentRequests": map[string]any{"canonical": canonical}, "config": map[string]any{"channelId": state.Request.ChannelID, "channelModelKey": state.Request.ChannelModelKey, "model": firstNonEmpty(state.Request.ChannelModelKey, state.Request.Model)}, "textOptions": map[string]any{"stream": true, "thinking": stepThinking, "maxOutputTokens": stepOutputTokens}}
	if len(references) > 0 {
		input["referenceImages"] = references
	}
	tokens, tokenErr := cloudAgentRequestEstimatedTokens(&canonical)
	if tokenErr != nil {
		return s.failCloudAgent(run, &state, "模型上下文估算失败，请稍后重试")
	}
	if tokens > contextBudget.InputBudgetTokens {
		return s.failCloudAgent(run, &state, cloudAgentContextBudgetMessage(contextBudget))
	}
	req := CreateTaskRequest{ProjectID: state.Request.CanvasID, Type: "canvas_text", Operation: "cloud_agent_step", Prompt: state.Request.Prompt, Model: state.Request.Model, LogicalModelID: state.Request.LogicalModelID, Input: input}
	return s.enqueueCloudAgentTask(run, &state, req, nil)
}

func compactCloudAgentContext(request *canonicalAgentRequest, budget cloudAgentContextBudget) bool {
	if request == nil {
		return false
	}
	tokens, err := cloudAgentRequestEstimatedTokens(request)
	if err != nil || tokens < budget.CompactAtTokens {
		return false
	}
	// Retain the latest complete tool turn. Never remove call/result envelopes,
	// user instructions, call arguments or write receipts to fabricate a summary.
	cut := len(request.Messages) - 1
	for cut > 0 && stringField(request.Messages[cut], "role") == "tool" {
		cut--
	}
	changed := false
	for _, message := range request.Messages[:max(0, cut)] {
		if stringField(message, "role") != "tool" {
			continue
		}
		var result map[string]any
		if json.Unmarshal([]byte(stringField(message, "content")), &result) != nil || result["contextCompacted"] == true {
			continue
		}
		// Only omit re-readable bodies. Preserve IDs, errors, generation status,
		// approvals and all other structured facts verbatim.
		omitted := false
		if nodes, ok := result["nodes"].([]any); ok {
			facts := make([]map[string]any, 0, len(nodes))
			for _, value := range nodes {
				if node, ok := value.(map[string]any); ok {
					fact := map[string]any{"nodeId": node["id"]}
					for _, key := range []string{"generation", "generationDraft", "outputReference"} {
						if value, exists := node[key]; exists {
							fact[key] = value
						}
					}
					if len(fact) > 1 {
						facts = append(facts, fact)
					}
				}
			}
			if len(facts) > 0 {
				result["observedFacts"] = facts
			}
		}
		for _, key := range []string{"content", "nodes"} {
			if _, exists := result[key]; exists {
				delete(result, key)
				omitted = true
			}
		}
		if !omitted {
			continue
		}
		result["contextCompacted"] = true
		result["guidance"] = "历史读取正文已移出模型上下文；需要时重新读取。保留的历史状态不是当前状态，也不是执行授权，不得据此重复提交生成。"
		body, err := json.Marshal(result)
		if err != nil || len(body) >= len(stringField(message, "content")) {
			continue
		}
		message["content"] = string(body)
		changed = true
	}
	return changed
}

func validateCloudAgentCalls(calls []cloudAgentCall) error {
	seen := make(map[string]bool, len(calls))
	for _, call := range calls {
		if err := validateCloudAgentID(call.ID, "工具调用 ID", 160); err != nil || seen[call.ID] || call.Function.Name == "" || len(call.Function.Name) > 80 || !utf8.ValidString(call.Function.Name) {
			return errors.New("invalid Agent tool call")
		}
		if err := decodeCloudAgentJSONObject(call.Function.Arguments, &map[string]any{}); err != nil || len(call.Function.Arguments) > 32000 {
			return errors.New("invalid Agent tool arguments")
		}
		seen[call.ID] = true
	}
	return nil
}

func (s *Service) terminateCloudAgent(run *model.CloudAgentExecution, message string) error {
	if run == nil {
		return errors.New(message)
	}
	if err := s.repo.MarkCloudAgentFailed(run.UserID, run.ID, run.Revision, message); err != nil && !errors.Is(err, repository.ErrCreationConflict) {
		return err
	}
	return nil
}

func (s *Service) failCloudAgent(run *model.CloudAgentExecution, state *cloudAgentRuntime, message string) error {
	return s.repo.MutateCloudAgent(run.UserID, run.ID, run.Revision, func(current *model.CloudAgentExecution, _ *repository.Repository) error {
		current.Status = "failed"
		current.FailureMessage = truncateRunes(message, 1000)
		cloudAgentDropInterjections(run.ID, "本轮已结束："+truncateRunes(message, 120), state)
		state.event(run.ID, "run_failed", map[string]any{"text": message})
		return cloudAgentSave(current, state)
	})
}

// failCloudAgentAdmission records deterministic tool admission failures in the
// same checkpoint transaction. Transient repository errors must still escape
// the caller so the scheduler can retry them.
func failCloudAgentAdmission(current *model.CloudAgentExecution, state *cloudAgentRuntime, runID string, err error) error {
	message := cloudAgentSafeToolError(err)
	current.Status = "failed"
	current.FailureMessage = message
	state.Approval = nil
	state.event(runID, "run_failed", map[string]any{
		"text":   message,
		"reason": "tool_admission_failed",
	})
	return cloudAgentSave(current, state)
}

// Only expose known failure categories; raw provider errors can contain URLs and credentials.
func cloudAgentModelFailure(task *model.Task) (string, string) {
	detail, reason := "模型任务未成功", "model_task_failed"
	if diagnostic := taskExecutionDiagnostic(task); diagnostic != nil && diagnostic.Code == string(ReasonUpstreamDNSFailed) {
		return "模型服务域名解析失败，请检查渠道域名和后端 DNS 配置；本轮已停止。请在任务中心检查模型任务 " + task.ID, string(ReasonUpstreamDNSFailed)
	}
	raw := strings.ToLower(task.Error)
	switch {
	case strings.Contains(task.Error, "没有返回内容"):
		// 思考模型的典型失败：整个输出预算被推理吃掉，正文与工具调用皆空。
		detail, reason = "上游连续返回空内容（通常是思考占满输出预算）；已自动关思考并放大预算重试仍失败，建议换用非思考模型或调小上下文", "model_empty_output"
	case strings.Contains(task.Error, cloudAgentStepTimeoutError):
		detail, reason = "单步模型调用超过执行时限仍未返回（长思考或上下文过大时常见）；已自动关思考重试仍超时，可在管理端调大 Agent 单步超时", "model_step_timeout"
	case strings.Contains(raw, "connection reset by peer"):
		detail, reason = "模型连接被对端或中间网络设备重置", "model_connection_reset"
	case strings.Contains(raw, "timeout"), strings.Contains(raw, "deadline exceeded"):
		detail, reason = "模型请求超时", "model_request_timeout"
	case strings.Contains(raw, "connection refused"):
		detail, reason = "无法连接模型服务（连接被拒绝）", "model_connection_refused"
	}
	return detail + "；本轮已停止。请在任务中心检查模型任务 " + task.ID, reason
}

func cloudAgentSafeToolError(err error) string {
	if err == nil {
		return ""
	}
	var readLoopErr *cloudAgentReadLoopError
	if errors.As(err, &readLoopErr) {
		return readLoopErr.Error()
	}
	var appErr *AppError
	if errors.As(err, &appErr) && appErr != nil {
		message := strings.TrimSpace(appErr.Message)
		if cloudAgentSafeUserMessage(message) {
			return message
		}
	}
	return "工具执行失败，请检查输入或稍后重试"
}

func cloudAgentSafeUserMessage(message string) bool {
	if message == "" || !utf8.ValidString(message) || strings.ContainsAny(message, "\x00\r\n") || utf8.RuneCountInString(message) > 240 {
		return false
	}
	lower := strings.ToLower(message)
	for _, marker := range []string{
		"http://", "https://", "ftp://", "file://", "authorization", "cookie", "secret", "token", "api_key", "apikey", "x-api-key",
		"/var/", "/tmp/", "\\", "stack trace", "traceback", " at ", "sql:", "sqlite", "postgres",
	} {
		if strings.Contains(lower, marker) {
			return false
		}
	}
	return true
}

// cloudAgentSafeMediaTaskError preserves a short, user-facing task diagnostic
// while refusing provider details that commonly contain URLs, credentials, or
// internal request metadata. Task.Error is not a safe presentation field.
func cloudAgentSafeMediaTaskError(task *model.Task) string {
	if task == nil {
		return "媒体任务未成功"
	}
	detail := strings.TrimSpace(task.Error)
	if detail == "" || !utf8.ValidString(detail) || strings.ContainsAny(detail, "\r\n\x00") {
		return "媒体任务未成功"
	}
	lower := strings.ToLower(detail)
	for _, marker := range []string{
		"http://", "https://", "ftp://", "authorization", "cookie", "secret", "token", "api_key", "apikey", "x-api-key",
	} {
		if strings.Contains(lower, marker) {
			return "媒体任务未成功"
		}
	}
	runes := []rune(detail)
	if len(runes) > 240 {
		detail = string(runes[:240]) + "…"
	}
	return detail
}

func cloudAgentToolResult(runID string, state *cloudAgentRuntime, call cloudAgentCall, result any, err error) bool {
	payload := map[string]any{"toolName": call.Function.Name, "callId": call.ID, "arguments": call.Function.Arguments}
	if call.Function.Name == "skill_read_file" {
		var args struct {
			SkillID string `json:"skillId"`
			Path    string `json:"path"`
		}
		if json.Unmarshal([]byte(call.Function.Arguments), &args) == nil {
			payload["skillId"], payload["path"] = args.SkillID, args.Path
			for _, skill := range state.Skills {
				if skill.ID == args.SkillID {
					payload["skillName"] = skill.Name
					break
				}
			}
		}
	}
	kind := "tool_completed"
	if err != nil {
		detail, ok := result.(map[string]any)
		if !ok || detail == nil {
			detail = map[string]any{}
		}
		// 模型漏了必填字段（或参数不是对象）时，即便业务校验抛的是普通 AppError，也按
		// "参数契约错误"处理：把本轮实际暴露的 schema 回给模型，它才改得对。
		// 只在业务侧确实按参数问题拒绝（400/422）时套用：上游 5xx 或网络错误即便同时漏字段，
		// 也该算上游故障，别把锅扣到参数上。已分类的参数错误不再套壳，避免覆盖更精确的反馈。
		var appErr *AppError
		var existingArgumentErr *cloudAgentArgumentError
		if missing := cloudAgentMissingRequiredArguments(state.Canonical.Tools, call); len(missing) > 0 &&
			!errors.As(err, &existingArgumentErr) &&
			errors.As(err, &appErr) && appErr != nil && (appErr.Status == 400 || appErr.Status == 422) {
			err = &cloudAgentFieldArgumentError{
				error: &cloudAgentArgumentError{err},
				Field: strings.Join(missing, ","), Issue: "required",
			}
		}
		message := cloudAgentSafeToolError(err)
		detail["error"] = message
		var admissionErr *cloudAgentMediaAdmissionError
		if errors.As(err, &admissionErr) {
			detail["reason"], detail["nodeId"] = admissionErr.Reason, admissionErr.NodeID
		}
		var argumentErr *cloudAgentArgumentError
		if errors.As(err, &argumentErr) {
			detail["reason"] = "invalid_tool_arguments"
			var fieldErr *cloudAgentFieldArgumentError
			if errors.As(err, &fieldErr) {
				detail["field"], detail["issue"] = fieldErr.Field, fieldErr.Issue
			}
			// Use this run's advertised contract, including its permission scope.
			for _, tool := range state.Canonical.Tools {
				function, _ := tool["function"].(map[string]any)
				if function["name"] == call.Function.Name {
					detail["parameters"] = function["parameters"]
					break
				}
			}
			detail["guidance"] = "本次调用未执行，请按 parameters 修正参数后重试，不要重复提交相同的错误参数"
			if call.Function.Name == "canvas_get_state" {
				detail["exampleArguments"] = map[string]any{}
			}
			if call.Function.Name == "canvas_apply_ops" {
				detail["exampleArguments"] = map[string]any{"snapshotHash": "<canvas_get_state.snapshotHash>", "ops": []any{map[string]any{"type": "add_node", "id": "<new-node-id>", "nodeType": "text", "content": "<content>"}}}
			}
		}
		// 稳定归类 + 可行动字段：只加标注，不改任何放行/拒绝判定。
		// allowed 与执行器用的是同一份判定（cloudAgentToolAllowed 是纯函数，结果一致）。
		if class, retryable, requiredAction := cloudAgentToolErrorClass(state.Request, call, err, cloudAgentToolAllowed(state.Request, call.Function.Name)); class != "" {
			detail["errorClass"], detail["errorClassLabel"] = class, cloudAgentToolErrorLabel(class)
			detail["retryable"] = retryable
			if requiredAction != "" {
				detail["requiredAction"] = requiredAction
			}
			payload["errorClass"] = class
		}
		result = detail
		kind = "tool_failed"
		payload["text"] = message
	} else {
		payload["text"] = "工具执行成功"
	}
	if inspection, ok := result.(cloudAgentImageInspection); ok && err == nil {
		receipt, _ := json.Marshal(inspection.Receipt)
		payload["result"] = inspection.Receipt
		state.event(runID, kind, payload)
		// tool 角色只接受字符串内容（四种上游图式都是纯文本），因此工具回执照常入历史，
		// 图片另起一条 user 消息携带，并显式标注为数据而非指令。
		state.Canonical.Messages = append(state.Canonical.Messages,
			map[string]any{"role": "tool", "tool_call_id": call.ID, "content": string(receipt)})
		// 重复查看时只回执文字（ImageURL 为空），不再附图。
		if strings.TrimSpace(inspection.ImageURL) != "" {
			cloudAgentStageImageInspection(state, inspection)
		}
		// 一批里可能有多个调用（模型一次发起 parallel tool calls），上游要求
		// assistant(tool_calls) 之后紧跟每一个 tool_call_id 的 tool 消息，所以图片
		// 不能插在 tool 结果之间。只有本批最后一个调用执行完，才把整批缓冲合并成
		// 一条 user 消息追加在全部 tool 结果之后。
		if state.CallIndex+1 >= len(state.Calls) {
			cloudAgentFlushPendingImages(state)
		}
		state.CallIndex++
		state.Approval = nil
		// 看图是只读成功路径，不占自动纠错名额（那名额只给写/生成类工具的预执行参数错误）。
		return false
	}
	exhausted := cloudAgentTrackToolRepair(runID, state, call, result, err, payload)
	raw, _ := json.Marshal(result)
	payload["result"] = result
	if call.Function.Name == "skill_read_file" && err == nil {
		// SSE/UI needs the read receipt, not another durable copy of skill text.
		if fields, ok := result.(map[string]any); ok {
			receipt := make(map[string]any, len(fields))
			for key, value := range fields {
				if key != "content" {
					receipt[key] = value
				}
			}
			payload["result"] = receipt
		}
	}
	state.event(runID, kind, payload)
	state.Canonical.Messages = append(state.Canonical.Messages, map[string]any{"role": "tool", "tool_call_id": call.ID, "content": string(raw)})
	state.CallIndex++
	state.Approval = nil
	return exhausted
}
func (s *Service) advanceCloudAgentTool(run *model.CloudAgentExecution, state *cloudAgentRuntime) error {
	if state.CallIndex < 0 || state.CallIndex >= len(state.Calls) {
		return s.failCloudAgent(run, state, "Agent 工具调用状态无效，本轮已停止")
	}
	call := state.Calls[state.CallIndex]
	call = s.cloudAgentRefreshStepSnapshotHash(run, state, call)
	state.Calls[state.CallIndex] = call
	if state.Approval != nil && state.Approval.Decision == "" {
		return nil
	}
	if state.Approval != nil && state.Approval.Decision != "" && state.Approval.CallHash != "" && state.Approval.CallHash != cloudAgentApprovalCallHash(call) {
		return s.terminateCloudAgent(run, "审批内容与待执行操作不一致，本轮已停止")
	}
	allowed := cloudAgentToolAllowed(state.Request, call.Function.Name)
	if allowed && cloudAgentWrite(call.Function.Name) && (state.Request.PermissionMode == "request_approval" || call.Function.Name == "generate_media" || call.Function.Name == "image_layer_split") && state.Approval == nil {
		var plan *cloudAgentMediaPlan
		var modelName string
		var mediaRequest CreateTaskRequest
		var preparedTask *model.Task
		var mediaPreparation *creationTaskPreparation
		policy, err := s.RuntimePolicy()
		if err != nil {
			return s.terminateCloudAgent(run, "Agent 运行策略不可用，本轮已停止")
		}
		if call.Function.Name == "generate_media" || call.Function.Name == "image_layer_split" {
			mediaCall := cloudAgentMediaCall(call)
			req, prepared, err := s.prepareCloudAgentMedia(run, state, mediaCall)
			if err != nil {
				return s.cloudAgentMediaError(run, state, "admission", false, false, err)
			}
			// Dry admission validates the selected model and prompt limits without a task or charge.
			mediaPreparation = &creationTaskPreparation{}
			req.creationPrepare = mediaPreparation
			preparedTask, err = s.CreateTask(run.UserID, req)
			if err != nil {
				return s.cloudAgentMediaError(run, state, "admission", false, false, err)
			}
			mediaRequest = req
			plan = prepared
			modelName, err = s.cloudAgentMediaModelName(plan.Args)
			if err != nil {
				return s.cloudAgentMediaError(run, state, "admission", false, false, err)
			}
		}
		s.storageMu.Lock()
		defer s.storageMu.Unlock()
		return s.repo.MutateCloudAgent(run.UserID, run.ID, run.Revision, func(current *model.CloudAgentExecution, repo *repository.Repository) error {
			var preview cloudAgentApprovalPreview
			var preparedMedia *cloudAgentPreparedMedia
			if plan != nil {
				if err := createCloudAgentMediaNode(repo, run.UserID, state.Request.CanvasID, plan, nil, policy, cloudAgentCanvasEventRecorder(run.ID, state)); err != nil {
					return err
				}
				canvas, err := repo.CanvasProjectForUser(run.UserID, state.Request.CanvasID)
				if err != nil {
					return err
				}
				doc, err := creationDocument(canvas.PayloadJSON)
				if err != nil {
					return err
				}
				plan.Args.SnapshotHash = cloudAgentMediaContentHash(doc)
				raw, err := json.Marshal(plan.Args)
				if err != nil {
					return err
				}
				call.Function.Arguments = string(raw)
				state.Calls[state.CallIndex] = call
				preview = cloudAgentMediaApprovalPreview(plan, modelName)
				preparedMedia, err = prepareCloudAgentMediaApproval(repo, run.UserID, doc, plan, mediaRequest, preparedTask, mediaPreparation.Order)
				if err != nil {
					return err
				}
			} else {
				var mutationErr error
				switch call.Function.Name {
				case "canvas_create_storyboard":
					storyboardPlan, err := prepareCloudAgentStoryboardCreate(repo, run.UserID, state.Request.CanvasID, call)
					mutationErr = err
					if err == nil {
						preview = storyboardPlan.Preview
					}
				case "canvas_edit_storyboard":
					storyboardPlan, err := prepareCloudAgentStoryboardEdit(repo, run.UserID, state.Request.CanvasID, call)
					mutationErr = err
					if err == nil {
						preview = storyboardPlan.Preview
					}
				case "canvas_edit_batch_table":
					batchPlan, err := prepareCloudAgentBatchTableEdit(repo, run.UserID, state.Request.CanvasID, call)
					mutationErr = err
					if err == nil {
						preview = batchPlan.Preview
					}
				case "canvas_arrange_nodes":
					arrangePlan, err := prepareCloudAgentArrangeNodes(repo, run.UserID, state.Request.CanvasID, call)
					mutationErr = err
					if err == nil {
						preview = arrangePlan.Preview
					}
				default:
					canvasPlan, err := prepareCloudAgentCanvasMutation(repo, run.UserID, state.Request.CanvasID, call)
					mutationErr = err
					if err == nil {
						preview = canvasPlan.Preview
					}
				}
				if mutationErr != nil {
					var argumentErr *cloudAgentArgumentError
					if errors.As(mutationErr, &argumentErr) {
						cloudAgentRecordToolResult(current, state, call, nil, mutationErr)
						return cloudAgentSave(current, state)
					}
					var appErr *AppError
					if errors.As(mutationErr, &appErr) && appErr != nil {
						return failCloudAgentAdmission(current, state, run.ID, mutationErr)
					}
					return mutationErr
				}
			}
			state.Approval = &cloudAgentApproval{ID: fmt.Sprintf("%s-%d-%d", run.ID, state.Step, state.CallIndex), Call: call, CallHash: cloudAgentApprovalCallHash(call), Preview: preview, ModelName: modelName, Prepared: preparedMedia}
			if preparedMedia != nil {
				if err := pinCloudAgentPreparedMedia(repo, run.UserID, run.ID, state.Approval.ID, preparedMedia); err != nil {
					return err
				}
			}
			current.Status = "waiting_approval"
			state.event(run.ID, "approval_requested", map[string]any{"approvalId": state.Approval.ID, "toolName": call.Function.Name, "modelName": modelName, "arguments": json.RawMessage(call.Function.Arguments), "preview": preview, "prepared": preparedMedia.publicView(), "text": preview.Description})
			return cloudAgentSave(current, state)
		})
	}
	if allowed && call.Function.Name == "plan_update" && cloudAgentPlanRequiresFirstApproval(state, call) {
		if preview, ok := cloudAgentPlanApprovalPreview(call); ok {
			return s.repo.MutateCloudAgent(run.UserID, run.ID, run.Revision, func(current *model.CloudAgentExecution, _ *repository.Repository) error {
				approvalID := fmt.Sprintf("%s-%d-%d", run.ID, state.Step, state.CallIndex)
				state.Approval = &cloudAgentApproval{ID: approvalID, Call: call, CallHash: cloudAgentApprovalCallHash(call), Preview: preview}
				current.Status = "waiting_approval"
				state.event(run.ID, "approval_requested", map[string]any{"approvalId": approvalID, "toolName": call.Function.Name, "arguments": json.RawMessage(call.Function.Arguments), "preview": preview, "text": preview.Description})
				return cloudAgentSave(current, state)
			})
		}
	}
	if allowed && (call.Function.Name == "generate_media" || call.Function.Name == "image_layer_split") && state.Approval != nil && state.Approval.Decision == "approve" {
		return s.advanceCloudAgentMedia(run, state, cloudAgentMediaCall(call))
	}
	policy, err := s.RuntimePolicy()
	if err != nil {
		return s.terminateCloudAgent(run, "Agent 运行策略不可用，本轮已停止")
	}
	var modelList any
	var modelListErr error
	if allowed && call.Function.Name == "model_list" {
		intent, e := s.cloudAgentModelIntent(run.UserID, state.Request.CanvasID, call.Function.Arguments)
		modelListErr = e
		if e == nil {
			modelList, modelListErr = s.cloudAgentModelList(intent)
		}
	}
	// 看图的资源与能力校验在写事务外完成；真实图片只在模型任务执行时读取。
	var inspectionResult any
	var inspectionErr error
	if allowed && call.Function.Name == "canvas_inspect_image" && state.Request.VisionEnabled {
		inspectionResult, inspectionErr = s.prepareCloudAgentImageInspection(run.UserID, state.Request.CanvasID, state, call)
		if errors.Is(inspectionErr, errCloudAgentImageInspectionBudget) {
			return s.failCloudAgent(run, state, cloudAgentImageInspectionBudgetMessage)
		}
	}
	// Skill reads use the domain repository and filesystem, not the checkpoint
	// transaction's connection. Read first to avoid nesting DB reads on SQLite.
	var skillResult any
	var skillErr error
	if allowed && (call.Function.Name == "skill_read_file" || call.Function.Name == "image_annotation_render") {
		state.RuntimeRunID = run.ID
		skillResult, skillErr = cloudAgentReadTool(s.repo, run.UserID, state, call, s)
	}
	s.storageMu.Lock()
	defer s.storageMu.Unlock()
	return s.repo.MutateCloudAgent(run.UserID, run.ID, run.Revision, func(current *model.CloudAgentExecution, repo *repository.Repository) error {
		var result any
		var toolErr error
		switch {
		case !allowed:
			// 幻觉出来的工具名与"真被权限挡住"要分开反馈：前者模型根本不该发这个调用，
			// 后者是授权边界问题。两者仍然一律拒绝，只是给模型的下一步更明确。
			if !cloudAgentPlatformToolNames()[call.Function.Name] {
				toolErr = BadAuthRequest("模型调用了不存在的工具「" + truncateRunes(call.Function.Name, 60) + "」，本轮已拒绝；请只使用本轮工具表里列出的工具")
			} else {
				toolErr = BadAuthRequest("工具未获本轮权限授权")
			}
		case call.Function.Name == "canvas_apply_ops":
			result, toolErr = applyCloudAgentCanvas(repo, run.UserID, state.Request.CanvasID, call, policy, cloudAgentCanvasEventRecorder(run.ID, state))
		case call.Function.Name == "canvas_arrange_nodes":
			result, toolErr = applyCloudAgentArrangeNodes(repo, run.UserID, state.Request.CanvasID, call, policy, cloudAgentCanvasEventRecorder(run.ID, state))
		case call.Function.Name == "canvas_create_storyboard", call.Function.Name == "canvas_edit_storyboard":
			result, toolErr = applyCloudAgentStoryboardMutation(repo, run.UserID, state.Request.CanvasID, call, policy, cloudAgentCanvasEventRecorder(run.ID, state))
		case call.Function.Name == "canvas_edit_batch_table":
			result, toolErr = applyCloudAgentBatchTableMutation(repo, run.UserID, state.Request.CanvasID, call, policy, cloudAgentCanvasEventRecorder(run.ID, state))
		case call.Function.Name == "model_list":
			result, toolErr = modelList, modelListErr
		case call.Function.Name == "canvas_inspect_image":
			result, toolErr = inspectionResult, inspectionErr
			if toolErr == nil && inspectionResult != nil {
				if inspection, ok := inspectionResult.(cloudAgentImageInspection); ok {
					state.markCanvasImageInspection(stringValue(inspection.Receipt["nodeId"]), strings.TrimSpace(inspection.ImageURL) != "")
					if inspection.CacheKey != "" {
						if state.ImageInspectionReads == nil {
							state.ImageInspectionReads = map[string]int{}
						}
						state.ImageInspectionReads[inspection.CacheKey]++
					}
				}
			}
		case call.Function.Name == "skill_read_file", call.Function.Name == "image_annotation_render":
			result, toolErr = skillResult, skillErr
		default:
			result, toolErr = cloudAgentReadToolCached(repo, run.UserID, state, call)
		}
		if toolErr == nil && cloudAgentWrite(call.Function.Name) {
			// A successful canvas mutation changes the read model. Do not replay a
			// pre-mutation canvas snapshot later in the same Agent run.
			state.ToolReadResults = nil
			state.ToolReadReplays = nil
		}
		var readLoopErr *cloudAgentReadLoopError
		if errors.As(toolErr, &readLoopErr) {
			cloudAgentRecordToolResult(current, state, call, result, toolErr)
			current.Status = "failed"
			current.FailureMessage = truncateRunes(readLoopErr.Error(), 1000)
			cloudAgentDropInterjections(run.ID, "本轮已结束："+truncateRunes(current.FailureMessage, 120), state)
			state.event(run.ID, "run_failed", map[string]any{
				"text": current.FailureMessage, "reason": "repeated_read_guard",
				"toolName": call.Function.Name, "repeatCount": readLoopErr.Count,
			})
			return cloudAgentSave(current, state)
		}
		if call.Function.Name == "plan_update" && toolErr == nil {
			state.event(run.ID, "plan_updated", map[string]any{"items": state.Plan, "pendingTitles": cloudAgentPendingPlanItems(state.Plan)})
		}
		if call.Function.Name == "ask_user" && toolErr == nil {
			payload, _ := result.(map[string]any)
			state.event(run.ID, "user_question", payload)
			cloudAgentRecordToolResult(current, state, call, result, nil)
			skipRemainingCloudAgentCalls(run.ID, state)
			current.Status = "completed"
			return cloudAgentSave(current, state)
		}
		cloudAgentRecordToolResult(current, state, call, result, toolErr)
		return cloudAgentSave(current, state)
	})
}

// image_layer_split deliberately reuses the canonical media admission path.
// Keeping the alias at this boundary preserves one approval, billing and
// write-back implementation while exposing a task-specific Agent affordance.
func cloudAgentMediaCall(call cloudAgentCall) cloudAgentCall {
	if call.Function.Name != "image_layer_split" {
		return call
	}
	var args map[string]any
	if err := json.Unmarshal([]byte(call.Function.Arguments), &args); err == nil {
		args["mode"] = "image"
		if raw, err := json.Marshal(args); err == nil {
			call.Function.Arguments = string(raw)
		}
	}
	return call
}

func (s *Service) enqueueCloudAgentTask(run *model.CloudAgentExecution, state *cloudAgentRuntime, req CreateTaskRequest, media *cloudAgentMediaPlan) error {
	orders, err := s.repo.BillingOrdersByTaskIDs(run.UserID, state.TaskIDs)
	if err != nil {
		return err
	}
	remaining := int64(math.Floor(state.Request.Budget.MaxCredits * float64(CreditScale)))
	for _, order := range orders {
		remaining -= order.AmountMicrocredits
	}
	if remaining < 0 {
		return s.failCloudAgent(run, state, "Agent 累计预算已耗尽")
	}
	var prepared *cloudAgentPreparedMedia
	approvalID, generationID := "", ""
	if media != nil {
		if state.Approval == nil || state.Approval.Prepared == nil {
			return s.cloudAgentMediaError(run, state, "admission", false, false, creationConflict("缺少已批准的生成准备态，请重新申请审批；未提交任务"))
		}
		prepared = state.Approval.Prepared
		approvalID, generationID = state.Approval.ID, prepared.GenerationID
		refs, refErr := cloudAgentPreparedReferences(s.repo, run.UserID, prepared)
		if refErr != nil {
			return s.cloudAgentMediaError(run, state, "admission", false, false, refErr)
		}
		if req.Input == nil {
			req.Input = map[string]any{}
		}
		for _, field := range []string{"referenceImages", "referenceVideos", "referenceAudios"} {
			delete(req.Input, field)
		}
		for field, value := range refs {
			req.Input[field] = value
		}
	}
	prepare := &creationTaskPreparation{}
	req.admission = &taskAdmission{ID: cloudAgentID(run.UserID, fmt.Sprintf("%s:task:%d", run.ID, len(state.TaskIDs))), MaxCharge: remaining, AgentRunID: run.ID, GenerationID: generationID, ApprovalID: approvalID}
	req.creationPrepare = prepare
	task, err := s.CreateTask(run.UserID, req)
	if err != nil {
		if media != nil {
			return s.cloudAgentMediaError(run, state, "admission", false, false, err)
		}
		return s.failCloudAgent(run, state, cloudAgentSafeToolError(err))
	}
	var input map[string]any
	if err = json.Unmarshal([]byte(task.InputJSON), &input); err != nil {
		if media != nil {
			return s.cloudAgentMediaError(run, state, "admission", false, false, err)
		}
		return err
	}
	if media != nil {
		requested, _ := req.Input["config"].(map[string]any)
		resolved, _ := input["config"].(map[string]any)
		if err := validateCloudAgentResolvedMediaOptions(requested, resolved); err != nil {
			return s.cloudAgentMediaError(run, state, "admission", false, false, err)
		}
	}
	if err = s.protectTaskSecrets(input); err != nil {
		if media != nil {
			return s.cloudAgentMediaError(run, state, "admission", false, false, err)
		}
		return err
	}
	raw, err := json.Marshal(input)
	if err != nil {
		if media != nil {
			return s.cloudAgentMediaError(run, state, "admission", false, false, err)
		}
		return err
	}
	task.InputJSON = string(raw)
	if prepare.Order != nil {
		task.BillingOrderID = prepare.Order.ID
	}
	policy, err := s.RuntimePolicy()
	if err != nil {
		if media != nil {
			return s.cloudAgentMediaError(run, state, "admission", false, false, err)
		}
		return err
	}
	s.storageMu.Lock()
	defer s.storageMu.Unlock()
	err = s.repo.MutateCloudAgent(run.UserID, run.ID, run.Revision, func(current *model.CloudAgentExecution, repo *repository.Repository) error {
		if media != nil {
			canvas, err := repo.CanvasProjectForUser(run.UserID, state.Request.CanvasID)
			if err != nil {
				return err
			}
			doc, err := creationDocument(canvas.PayloadJSON)
			if err != nil {
				return err
			}
			if err := validateCloudAgentPreparedAdmission(repo, run.UserID, prepared, task, prepare.Order, doc, media.Args); err != nil {
				return err
			}
			if err := createCloudAgentMediaNode(repo, run.UserID, state.Request.CanvasID, media, task, policy, cloudAgentCanvasEventRecorder(run.ID, state)); err != nil {
				return err
			}
		}
		if err := createTaskWithStorageQuotaRepository(repo, task, prepare.Order, policy); err != nil {
			return err
		}
		if media != nil && prepared != nil {
			if err := repo.TransferCloudAgentResourceLeases(run.UserID, approvalID, "task:"+task.ID, task.ID, prepared.Quote.ExpiresAt); err != nil {
				return err
			}
		}
		state.TaskIDs = append(state.TaskIDs, task.ID)
		if media != nil {
			state.MediaTaskID = task.ID
			state.Generations++
			state.VideoSeconds += media.Args.Duration
			state.event(run.ID, "generation_task_created", map[string]any{"toolName": "generate_media", "taskId": task.ID, "nodeId": media.Args.NodeID, "title": media.Args.Title, "mode": media.Args.Mode, "canvasId": state.Request.CanvasID, "referenceNodeIds": media.Args.ReferenceNodeIDs, "text": "媒体节点与引用连线已创建，生成任务已提交"})
		} else {
			state.ActiveTaskID = task.ID
			state.Step++
		}
		return cloudAgentSave(current, state)
	})
	if err != nil && media != nil {
		// Rollback may have happened after checkpoint edits. Reload before recording
		// a tool failure; never turn a stale worker revision into a second result.
		latest, readErr := s.repo.CloudAgent(run.UserID, run.ID)
		if readErr != nil || latest.Revision != run.Revision {
			return err
		}
		fresh, decodeErr := cloudAgentDecode(latest)
		if decodeErr != nil {
			return decodeErr
		}
		return s.cloudAgentMediaError(latest, &fresh, "admission", false, false, err)
	}
	return err
}

func (s *Service) cloudAgentMediaError(run *model.CloudAgentExecution, state *cloudAgentRuntime, phase string, submitted, terminal bool, err error) error {
	return s.repo.MutateCloudAgent(run.UserID, run.ID, run.Revision, func(current *model.CloudAgentExecution, _ *repository.Repository) error {
		if state.CallIndex < 0 || state.CallIndex >= len(state.Calls) {
			current.Status = "failed"
			state.event(run.ID, "run_failed", map[string]any{"text": "Agent 媒体调用状态无效，本轮已停止"})
			return cloudAgentSave(current, state)
		}
		cloudAgentRecordToolResult(current, state, state.Calls[state.CallIndex], map[string]any{"phase": phase, "taskSubmitted": submitted}, err)
		if submitted {
			state.MediaTaskID = ""
		}
		if terminal {
			current.Status = "failed"
			state.event(run.ID, "run_failed", map[string]any{"text": "媒体任务已提交，但结果处理失败；任务不会自动重试"})
		}
		return cloudAgentSave(current, state)
	})
}

func (s *Service) advanceCloudAgentMedia(run *model.CloudAgentExecution, state *cloudAgentRuntime, call cloudAgentCall) error {
	if state.MediaTaskID != "" {
		task, err := s.repo.TaskForUser(run.UserID, state.MediaTaskID)
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return s.cloudAgentMediaError(run, state, "completion", true, true, BadAuthRequest("媒体任务不存在或已失去归属，结果未回写画布"))
		}
		if err != nil {
			return err
		}
		if task.Status == model.TaskStatusQueued || task.Status == model.TaskStatusRunning {
			return nil
		}
		policy, err := s.RuntimePolicy()
		if err != nil {
			return err
		}
		var target struct {
			NodeID string `json:"nodeId"`
		}
		if err := json.Unmarshal([]byte(call.Function.Arguments), &target); err != nil || validateCloudAgentID(target.NodeID, "生成节点ID", 80) != nil {
			return s.cloudAgentMediaError(run, state, "completion", true, true, BadAuthRequest("已提交媒体任务的目标节点记录无效，未回写画布"))
		}
		s.storageMu.Lock()
		defer s.storageMu.Unlock()
		return s.repo.MutateCloudAgent(run.UserID, run.ID, run.Revision, func(current *model.CloudAgentExecution, repo *repository.Repository) error {
			before, readErr := repo.CanvasProjectForUser(run.UserID, state.Request.CanvasID)
			nodeID, writeErr := completeCloudAgentMediaNode(repo, run.UserID, state.Request.CanvasID, target.NodeID, task, policy)
			if writeErr != nil {
				var appErr *AppError
				if !errors.Is(writeErr, gorm.ErrRecordNotFound) && !(errors.As(writeErr, &appErr) && (appErr.Status == 400 || appErr.Status == 409)) {
					return writeErr // Retry persistence, never resubmit the billed generation.
				}
			}
			// A deleted canvas/node must still checkpoint the tool failure. Only
			// a matched node can have changed and require an atomic canvas delta.
			if nodeID != "" {
				if readErr != nil {
					return readErr
				}
				if err := emitCloudAgentCanvasChange(repo, run.ID, state, cloudAgentMutationInput{UserID: run.UserID, CanvasID: state.Request.CanvasID, BeforeJSON: before.PayloadJSON, Operation: "generate_media_complete"}); err != nil {
					return err
				}
			}
			result := map[string]any{"phase": "completion", "taskSubmitted": true, "taskId": task.ID, "nodeId": nodeID, "targetNodeId": target.NodeID, "status": task.Status}
			var toolErr error
			generationMessage := ""
			writebackMessage, writebackReason := "", ""
			if task.Status != model.TaskStatusSucceeded {
				generationMessage = truncateRunes(cloudAgentSafeMediaTaskError(task), 90)
				if !cloudAgentSafeUserMessage(generationMessage) {
					generationMessage = "媒体任务未成功"
				}
				result["generationError"] = generationMessage
				toolErr = BadAuthRequest("媒体任务未成功：" + generationMessage + "；请在任务中心查看任务详情，不会自动重试收费生成")
				result["summary"] = "媒体任务未成功；任务记录保留在任务中心"
			}
			if writeErr != nil {
				writebackMessage = truncateRunes(cloudAgentSafeToolError(writeErr), 60)
				writebackReason = "canvas_writeback_failed"
				var writeback *cloudAgentMediaWritebackError
				if errors.As(writeErr, &writeback) {
					writebackReason = writeback.reason
				}
				result["writebackError"], result["writebackReason"] = writebackMessage, writebackReason
				message := "媒体任务已成功，但画布回写未完成：" + writebackMessage
				if generationMessage != "" {
					message = "媒体任务未成功：" + generationMessage + "；任务状态也未回写画布：" + writebackMessage
				}
				toolErr = BadAuthRequest(message + "。请在任务中心查看详情，不会自动重试收费生成")
				result["summary"] = "画布回写未完成；任务记录保留在任务中心"
			}
			if task.Status == model.TaskStatusSucceeded && writeErr == nil {
				result["summary"] = "生成结果已回写画布节点"
			}
			if writeErr != nil {
				recordTaskWritebackDiagnostic(task, target.NodeID, "failed", writebackReason, writeErr)
			} else {
				recordTaskWritebackDiagnostic(task, target.NodeID, "succeeded", "", nil)
			}
			if err := repo.UpdateTaskExecutionDiagnostic(run.UserID, task.ID, task.ExecutionDiagnosticJSON); err != nil {
				return err
			}
			// A billed generation failure is a tool result, not a dead run: the
			// model must still be able to tell the user what happened. Only a
			// canvas write that cannot land is terminal for the whole turn.
			if writeErr != nil {
				if current.Status != "cancelled" {
					current.Status = "failed"
				}
				current.FailureMessage = cloudAgentSafeToolError(toolErr)
				state.event(run.ID, "run_failed", map[string]any{
					"text": current.FailureMessage, "taskId": task.ID, "nodeId": target.NodeID,
					"reason": result["writebackReason"], "generationStatus": task.Status,
					"generationError": generationMessage, "writebackError": result["writebackError"],
				})
			}
			cloudAgentToolResult(run.ID, state, call, result, toolErr)
			state.MediaTaskID = ""
			return cloudAgentSave(current, state)
		})
	}
	req, plan, err := s.prepareCloudAgentMedia(run, state, call)
	if err != nil {
		return s.cloudAgentMediaError(run, state, "admission", false, false, err)
	}
	return s.enqueueCloudAgentTask(run, state, req, plan)
}

func (s *Service) DecideCloudAgentApproval(userID, id, approvalID, decision, reason string, mediaSettings ...*CloudAgentMediaSettings) error {
	// Resource leases are a protection mechanism only. Expiry cleanup is safe to
	// run on the control-plane path and never changes the approval decision.
	if err := s.repo.ReleaseExpiredCloudAgentResourceLeases(time.Now().UTC()); err != nil {
		return err
	}
	var settings *CloudAgentMediaSettings
	if len(mediaSettings) > 1 {
		return BadAuthRequest("只能提交一组生成参数")
	}
	if len(mediaSettings) == 1 {
		settings = mediaSettings[0]
	}
	if settings != nil && decision != "approve" {
		return BadAuthRequest("仅批准生成时可修改生成参数")
	}
	if decision != "approve" && decision != "reject" {
		return BadAuthRequest("无效审批决定")
	}
	if len(reason) > 2000 {
		return BadAuthRequest("审批理由过长")
	}
	if _, _, err := s.cloudAgentTask(userID, id); err != nil {
		return err
	}
	run, err := s.repo.CloudAgent(userID, id)
	if err != nil {
		return err
	}
	state, err := cloudAgentDecodeForExecution(run)
	if err != nil {
		return err
	}
	if previous, ok := state.Decisions[approvalID]; ok {
		if previous == decision && (settings == nil || state.DecisionSettings[approvalID] == creationHash(settings)) {
			return nil
		}
		return creationConflict("该审批已有不同决定")
	}
	if run.Status != "waiting_approval" || state.Approval == nil || state.Approval.ID != approvalID {
		return creationConflict("审批不存在或已过期")
	}
	s.storageMu.Lock()
	defer s.storageMu.Unlock()
	return s.repo.MutateCloudAgent(userID, id, run.Revision, func(current *model.CloudAgentExecution, repo *repository.Repository) error {
		if settings != nil {
			if err := s.updateCloudAgentMediaApproval(repo, run, &state, *settings); err != nil {
				return err
			}
		}
		state.Approval.Decision = decision
		state.Approval.Reason = reason
		state.Decisions[approvalID] = decision
		if settings != nil {
			if state.DecisionSettings == nil {
				state.DecisionSettings = map[string]string{}
			}
			state.DecisionSettings[approvalID] = creationHash(settings)
		}
		if decision == "approve" && state.Approval.Prepared != nil {
			if state.DecisionPreparedHashes == nil {
				state.DecisionPreparedHashes = map[string]string{}
			}
			state.DecisionPreparedHashes[approvalID] = state.Approval.Prepared.Hash
		}
		if decision == "reject" {
			// Rejection is a user control-plane decision, not a failed tool
			// invocation. Make it terminal before the scheduler can advance the
			// pending call; no tool result, canvas mutation, generation task or
			// follow-up model request may be produced from this decision.
			current.Status = "rejected"
			current.FailureMessage = ""
			state.Approval = nil
			state.event(id, "approval_decided", map[string]any{
				"approvalId": approvalID,
				"decision":   decision,
				"reason":     reason,
				"text":       "已拒绝本次生成，草稿节点仍保留在画布中；未提交任务、未产生扣费。你可以继续编辑后重新申请。",
			})
			if err := repo.ReleaseCloudAgentResourceLeases(userID, approvalID); err != nil {
				return err
			}
			return cloudAgentSave(current, &state)
		}
		current.Status = "running"
		payload := map[string]any{"approvalId": approvalID, "decision": decision, "arguments": json.RawMessage(state.Approval.Call.Function.Arguments), "preview": state.Approval.Preview, "modelName": state.Approval.ModelName}
		if state.Approval.Prepared != nil {
			payload["preparedHash"] = state.Approval.Prepared.Hash
			payload["generationId"] = state.Approval.Prepared.GenerationID
		}
		state.event(id, "approval_decided", payload)
		return cloudAgentSave(current, &state)
	})
}
func (s *Service) CancelCloudAgent(ctx context.Context, userID, id string) error {
	// Cancellation is a control-plane operation. It must remain available even
	// when the user-facing runtime blob is damaged, so authenticate/authorize
	// from the task row first instead of calling CloudAgentRun up front.
	task, err := s.repo.TaskForUser(userID, id)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return kernel.NotFound("Agent 运行不存在")
		}
		return err
	}
	if task.Operation != cloudAgentOperation {
		return kernel.NotFound("Agent 运行不存在")
	}
	run, err := s.repo.CloudAgent(userID, id)
	if errors.Is(err, gorm.ErrRecordNotFound) {
		// Legacy root tasks may not have an execution row yet. The normal read
		// path validates the signed/deterministic task identity before creating it.
		if _, err = s.CloudAgentRun(userID, id); err != nil {
			return err
		}
		run, err = s.repo.CloudAgent(userID, id)
	}
	if err != nil {
		return err
	}
	if run.Status == "completed" || (run.Status == "failed" && !run.CleanupPending) {
		return nil
	}
	if run.Status != "failed" {
		// Persist intent independently of the transcript. Retrying also repairs
		// legacy cancelled rows that crashed before cancelling their children.
		state, decodeErr := cloudAgentDecode(run)
		err = s.repo.MutateCloudAgent(userID, id, run.Revision, func(current *model.CloudAgentExecution, _ *repository.Repository) error {
			firstCancellation := current.Status != "cancelled"
			current.Status = "cancelled"
			current.CleanupPending = true
			if decodeErr == nil {
				current.CanvasID, current.ActiveTaskID, current.MediaTaskID = state.Request.CanvasID, state.ActiveTaskID, state.MediaTaskID
				if firstCancellation {
					state.event(id, "run_cancelled", map[string]any{"source": "user_request", "activeTaskId": state.ActiveTaskID, "mediaTaskId": state.MediaTaskID, "text": "用户取消接口已接收请求，正在取消关联任务"})
					if saveErr := cloudAgentSave(current, &state); saveErr != nil {
						// Cancellation must still work if the transcript is oversized.
						log.Printf("[cloud-agent] cancellation event unavailable for run %s: checkpoint rejected", id)
					}
				}
			} else {
				log.Printf("[cloud-agent] cancellation event unavailable for run %s: invalid transcript", id)
			}
			return nil
		})
		if err != nil {
			return err
		}
	}
	latest, err := s.repo.CloudAgent(userID, id)
	if err != nil {
		return err
	}
	return s.finishCloudAgentCleanup(ctx, latest)
}
