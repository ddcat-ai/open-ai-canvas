package app

import (
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"yingce/backend/internal/agentcontext"
	"yingce/backend/internal/model"
)

// A deterministic checkpoint failure must not be retried forever like a transient DB error.
var errCloudAgentCheckpoint = errors.New("invalid Agent checkpoint")

// cloudAgentCheckpointError keeps the save stage attached to a deterministic
// checkpoint failure.  Previously every failure was flattened to the same
// sentinel and advanceCloudAgent consequently told users that context had
// overflowed even when the actual problem was a corrupt event or an encoding
// failure.
type cloudAgentCheckpointError struct {
	Stage string
	Err   error
}

func (e *cloudAgentCheckpointError) Error() string {
	if e == nil {
		return errCloudAgentCheckpoint.Error()
	}
	if e.Stage == "" {
		return fmt.Sprintf("%v: %v", errCloudAgentCheckpoint, e.Err)
	}
	return fmt.Sprintf("%v (%s): %v", errCloudAgentCheckpoint, e.Stage, e.Err)
}

func (e *cloudAgentCheckpointError) Unwrap() error {
	if e == nil {
		return errCloudAgentCheckpoint
	}
	return e.Err
}

func (e *cloudAgentCheckpointError) Is(target error) bool {
	return target == errCloudAgentCheckpoint || (e != nil && errors.Is(e.Err, target))
}

func cloudAgentCheckpointFailure(stage string, err error) error {
	if err == nil {
		err = errors.New("unknown checkpoint failure")
	}
	return &cloudAgentCheckpointError{Stage: stage, Err: err}
}

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
	ItemID   string `json:"item_id,omitempty"`
	Function struct {
		Name      string `json:"name"`
		Arguments string `json:"arguments"`
	} `json:"function"`
}

type cloudAgentCachedToolResult struct {
	Result        json.RawMessage `json:"result,omitempty"`
	Error         string          `json:"error,omitempty"`
	ArgumentError bool            `json:"argumentError,omitempty"`
	// ReplayCount triggers a soft nudge for repeated results, never run failure.
	ReplayCount int `json:"replayCount,omitempty"`
}

type cloudAgentReadLoopError struct {
	ToolName   string
	Count      int
	Budget     bool
	ReasonCode string
}

func (e *cloudAgentReadLoopError) reasonCode() string {
	if e == nil || e.ReasonCode == "" {
		if e != nil && e.Budget {
			return "read_budget_exceeded"
		}
		return "repeated_read_guard"
	}
	return e.ReasonCode
}

func (e *cloudAgentReadLoopError) Error() string {
	if e == nil {
		return "Agent 重复读取护栏已触发"
	}
	if e.Budget {
		return fmt.Sprintf("Agent 本轮只读工具调用已达到安全上限（%d 次），重复读取已软收敛；请使用已有结果继续，不要继续读取", e.Count)
	}
	return fmt.Sprintf("Agent 连续重复读取同一份%s结果，重复读取已软收敛；请使用已有结果继续，不要再次读取", e.ToolName)
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
	RuntimeRunID       string                                `json:"-"`
	Request            CloudAgentRequest                     `json:"request"`
	Policy             cloudAgentPolicySnapshot              `json:"policy"`
	ParentID           string                                `json:"parentId,omitempty"`
	Fingerprint        string                                `json:"fingerprint,omitempty"`
	CreativeAnchor     cloudAgentCreativeAnchor              `json:"creativeAnchor,omitempty"`
	TextHistory        []providerTextMessage                 `json:"textHistory,omitempty"`
	Skills             []cloudAgentSkill                     `json:"skills"`
	Profile            cloudAgentProfileSnapshot             `json:"profile"`
	ProfileReads       map[string]bool                       `json:"profileReads,omitempty"`
	ToolReadResults    map[string]cloudAgentCachedToolResult `json:"toolReadResults,omitempty"`
	ToolReadReplays    map[string]int                        `json:"toolReadReplays,omitempty"`
	readCacheExecution bool                                  `json:"-"`
	Canonical          canonicalAgentRequest                 `json:"canonical"`
	ActiveTaskID       string                                `json:"activeTaskId"`
	ActiveTextDraft    string                                `json:"activeTextDraft,omitempty"`
	MediaTaskID        string                                `json:"mediaTaskId,omitempty"`
	TaskIDs            []string                              `json:"taskIds"`
	Step               int                                   `json:"step"`
	Generations        int                                   `json:"generations"`
	VideoSeconds       int                                   `json:"videoSeconds"`
	Calls              []cloudAgentCall                      `json:"calls"`
	CallIndex          int                                   `json:"callIndex"`
	ToolRepairs        map[string]cloudAgentToolRepair       `json:"toolRepairs,omitempty"`
	Approval           *cloudAgentApproval                   `json:"approval,omitempty"`
	// AutoPreparedMedia is the durable admission checkpoint for permissionMode=auto.
	// It prevents a worker restart between dry admission and billed submission from
	// re-running admission or creating the draft node a second time.
	AutoPreparedMedia              *cloudAgentPreparedMedia                `json:"autoPreparedMedia,omitempty"`
	AutoPreparedCallHash           string                                  `json:"autoPreparedCallHash,omitempty"`
	Decisions                      map[string]string                       `json:"decisions"`
	DecisionSettings               map[string]string                       `json:"decisionSettings,omitempty"`
	DecisionPreparedHashes         map[string]string                       `json:"decisionPreparedHashes,omitempty"`
	ActionNudged                   bool                                    `json:"actionNudged,omitempty"`
	EmptyOutputNudged              int                                     `json:"emptyOutputNudged,omitempty"`
	InvalidArgumentSteps           int                                     `json:"invalidArgumentSteps,omitempty"`
	StepSnapshotHash               string                                  `json:"stepSnapshotHash,omitempty"`
	StoryboardTaskID               string                                  `json:"storyboardTaskId,omitempty"`
	Plan                           []cloudAgentPlanItem                    `json:"plan,omitempty"`
	ConfirmationRounds             int                                     `json:"confirmationRounds,omitempty"`
	ConfirmationFingerprints       []string                                `json:"confirmationFingerprints,omitempty"`
	PendingConfirmationFingerprint string                                  `json:"pendingConfirmationFingerprint,omitempty"`
	PendingInterjections           []cloudAgentInterjection                `json:"pendingInterjections,omitempty"`
	PiResumePrompt                 string                                  `json:"piResumePrompt,omitempty"`
	TransientReferences            map[string]cloudAgentTransientReference `json:"transientReferences,omitempty"`
	InterjectionIDs                []string                                `json:"interjectionIds,omitempty"`
	// 已送达插话正文的 SHA-256 指纹（有界）。运行时投影回写 canonical 时不带
	// 来源标记，模型步按指纹补回 user_interjection，见 cloud_agent_interjection_pi.go。
	DeliveredInterjectionDigests []string          `json:"deliveredInterjectionDigests,omitempty"`
	Events                       []CloudAgentEvent `json:"events"`
	// PiAssistantResponses counts successful assistant message_end events from
	// the Pi runtime. Completion must not be inferred from a clean Node exit:
	// a provider/session error can otherwise be reported as a successful run.
	PiAssistantResponses        int    `json:"piAssistantResponses,omitempty"`
	LessonEligibleToolSuccesses int    `json:"lessonEligibleToolSuccesses,omitempty"`
	RememberLessonSuccesses     int    `json:"rememberLessonSuccesses,omitempty"`
	IsGenerating                bool   `json:"isGenerating,omitempty"`
	LastError                   string `json:"lastError,omitempty"`
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
	// ReadLoopNudge 是一次性的软收敛信号：下一步模型请求暂时不提供只读工具，
	// 让 Agent 使用已有结果回复、提问或执行有实际变化的写操作。它不结束运行。
	ReadLoopNudge    bool   `json:"readLoopNudge,omitempty"`
	ReadLoopToolName string `json:"readLoopToolName,omitempty"`
	ReadLoopCount    int    `json:"readLoopCount,omitempty"`
	// PendingImageInspections 暂存"本批还有工具结果没入历史"的看图结果，等整批 tool
	// 结果都入历史后合并成一条 user 图片消息（见 cloudAgentFlushPendingImages）。
	//
	// 它必须进检查点，不能标 `json:"-"`：一次 advanceCloudAgent 只执行一个工具调用
	// （advanceCloudAgentTool 执行完就 return，下一批调用走下一次转移），而每次转移都
	// 从 StateJSON 重新解码（cloudAgentDecode）。进程内字段在下一个调用到来时必然为空，
	// 缓冲就白缓冲了。载荷只有回执与签名链接，几十字节级。
	PendingImageInspections []cloudAgentImageInspection `json:"pendingImageInspections,omitempty"`
	// 以下三个字段属于"超预算时压缩成检查点后继续本轮"（见 cloud_agent_context_compaction.go）。
	// ContextCompactionCount 是本轮已经压过几次：压完仍然超阈值时不能无限暂停。
	ContextCompactionCount int `json:"contextCompactionCount,omitempty"`
	// ContextCheckpoint 是最近一次落盘的结构化检查点；ContextCompaction 是"正在压缩"的状态面
	// （requested 已请求 / running 压缩任务已发出），Resume 表示压完继续本轮而不是收尾结束。
	ContextCheckpoint *agentcontext.Checkpoint     `json:"contextCheckpoint,omitempty"`
	ContextCompaction *cloudAgentContextCompaction `json:"contextCompaction,omitempty"`
	// HistoryIncludesCurrent 说明 TextHistory 是压缩瞬间的 canonical 快照：
	// 续轮只补快照之后的新插话与最终回复，不能重复已压缩的用户要求。
	HistoryIncludesCurrent bool `json:"historyIncludesCurrent,omitempty"`
	// EventSeqBase 是本次载入的事件窗口之前已入库的条数，不变量是
	// events[i].Seq == EventSeqBase + i + 1。事件全量在 cloud_agent_event_records，
	// 内存只保留最近一窗（repository.CloudAgentJournalWindow），因此它是"窗口在整条
	// 日志里的偏移"，而不是累计条数。只在内存里有效，不进检查点（检查点里的事件为空）。
	EventSeqBase int `json:"-"`
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
		Config      map[string]any        `json:"config"`
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
	carrier := task.Status == model.TaskStatusTextReplay
	// The Pi root is a non-billable control-plane carrier, but it is still the
	// durable task identity for this run. Keep it in TaskIDs even though it is
	// not an active model task; validation and recovery use TaskIDs as the run's
	// immutable task-history anchor. Leaving this nil makes every new Pi run
	// fail its first checkpoint with "Agent runtime task history is invalid".
	state := cloudAgentRuntime{Request: initial.Request, Policy: initial.Policy, ParentID: initial.ParentID, Fingerprint: initial.Fingerprint, CreativeAnchor: initial.CreativeAnchor, TextHistory: input.TextHistory, Skills: initial.Skills, Profile: initial.Profile, Canonical: canonical, ActiveTaskID: "", TaskIDs: []string{task.ID}, Step: 0, Decisions: map[string]string{}, Plan: initial.Plan, ConfirmationRounds: initial.ConfirmationRounds, ConfirmationFingerprints: append([]string(nil), initial.ConfirmationFingerprints...), PendingConfirmationFingerprint: "", Events: []CloudAgentEvent{}, StepLimits: limits}
	if !carrier {
		state.ActiveTaskID = task.ID
		state.Step = 1
	}
	if len(initial.Skills) > 0 {
		// skillIds makes the enablement auditable: usage telemetry can attribute a
		// run to the skills it actually loaded instead of only counting the total.
		skillIDs := make([]string, 0, len(initial.Skills))
		for _, skill := range initial.Skills {
			skillIDs = append(skillIDs, skill.ID)
		}
		state.event(task.ID, "tool_completed", map[string]any{"toolName": "skills_load", "skillIds": skillIDs, "text": fmt.Sprintf("已启用 %d 个技能，正文将按需读取", len(initial.Skills))})
	}
	if len(state.Plan) > 0 {
		// 继承的待办清单必须挂到本轮：前端按 plan-<runId> 展示清单，不发这条事件时
		// 界面会一直停在上一轮（已结束）的清单上，显示"未完成项已停止"。
		state.event(task.ID, "plan_updated", map[string]any{"items": state.Plan, "pendingTitles": cloudAgentPendingPlanItems(state.Plan), "inherited": true})
	}
	if carrier {
		// The carrier is deliberately not a model call. Pi will create the first
		// governed cloud_agent_step through the model bridge below.
		run := &model.CloudAgentExecution{ID: task.ID, UserID: task.UserID, Status: "running", Revision: 1, CreatedAt: task.CreatedAt, UpdatedAt: time.Now()}
		if err := cloudAgentSave(run, &state); err != nil {
			return err
		}
		return s.repo.EnsureCloudAgent(run)
	}
	// 非 Pi 的旧入口仍保留运行状态初始化，但上下文占用统一由 Pi SDK
	// 在实际模型调用前上报；这里不再生成 Go 侧估算读数。
	run := &model.CloudAgentExecution{ID: task.ID, UserID: task.UserID, Status: "running", Revision: 1, CreatedAt: task.CreatedAt, UpdatedAt: time.Now()}
	if err := cloudAgentSave(run, &state); err != nil {
		return err
	}
	return s.repo.EnsureCloudAgent(run)
}

func (state *cloudAgentRuntime) event(id, kind string, payload map[string]any) {
	// 序号接在"已载入窗口 + 窗口之前已入库条数"之后，与 EventSeqBase 的不变量一致。
	seq := state.EventSeqBase + len(state.Events) + 1
	state.Events = append(state.Events, CloudAgentEvent{EventID: fmt.Sprintf("%s:%d", id, seq), RunID: id, Seq: seq, Type: kind, Payload: payload, CreatedAt: time.Now()})
}
