package app

import (
	"encoding/json"
	"fmt"
	"math"
	"sort"
	"strings"

	"infinite-canvas/backend/internal/agentcontext"
	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/repository"
)

// cloudAgentContextCompactionOperation 是"压缩历史"这次独立模型调用的任务操作名。
// 它必须与步进调用（cloud_agent_step）区分开：压缩不是本轮的一步，不计入步数上限，
// 失败也不会让整轮判死。
const cloudAgentContextCompactionOperation = "cloud_agent_context_compaction"

const (
	// cloudAgentMaxCompactionsPerRun 限制同一轮最多压几次：压完仍然超阈值时不能无限暂停
	// （检查点已经只剩少量历史，再压也不会更小），用完次数就回到上游的原有判死路径。
	cloudAgentMaxCompactionsPerRun = 4
	// cloudAgentContextKeepPairs 是压缩后原样保留的最近对话对数：检查点负责事实，最近两对
	// 负责"用户最后说了什么、模型最后答了什么"的语感与指代。
	cloudAgentContextKeepPairs = 2
)

// cloudAgentContextCompaction 是"暂停步进循环去压历史"的状态面：
// Status 为 requested（已请求、等调度起压缩任务）/ running（压缩任务已发出）。
type cloudAgentContextCompaction struct {
	Status      string `json:"status"`
	SourceBytes int    `json:"sourceBytes"`
	TurnCount   int    `json:"turnCount"`
	// Resume 表示这次是"中途暂停压缩"：压完继续本轮的步进，而不是收尾结束本轮。
	Resume bool `json:"resume,omitempty"`
}

// cloudAgentCompactionReading 是这次压缩判据的读数。它只用于触发事件与排查，
// 不是对外的事件契约（压力读数另有其事件，不在本特性范围内）。
type cloudAgentCompactionReading struct {
	ProjectedTokens   int     `json:"projectedTokens"`
	UsableInputTokens int     `json:"usableInputTokens"`
	CompactAtTokens   int     `json:"compactAtTokens"`
	PressureRatio     float64 `json:"pressureRatio"`
	BudgetSource      string  `json:"budgetSource"`
}

// cloudAgentCompactionReadingFor 把"下一步预计输入 token"接到上游已有的预算算式上。
//
// 阈值不在这里另定：上游 cloudAgentContextBudgetFor 已经把压缩线算成输入预算的 85%
// （CompactAtTokens），就地正文卸载用的就是它；语义压缩必须共用同一条线，否则会出现
// "显示还没到线、后台已经开始压"。
//
// 返回 configured=false 表示这次调用问不到真实模型窗口（cloudAgentContextBudgetForRequest
// 退回了首部默认预算，Source 为 default）：此时 token 线没有意义，调用方改用字节/条数兜底。
//
// 注意这条降级的代价：字节/条数兜底与窗口大小无关，所以**渠道没填 contextWindowTokens 时，
// 大窗口模型会远早于"装不下"就触发压缩**——每次压缩都要多花一次模型调用（额外计费）并把
// 细节换成摘要。部署时应为画布 Agent 使用的渠道模型/逻辑模型填写真实窗口（见 PR 风险说明）。
func cloudAgentCompactionReadingFor(budget cloudAgentContextBudget, projectedTokens int) (cloudAgentCompactionReading, bool) {
	reading := cloudAgentCompactionReading{
		ProjectedTokens:   projectedTokens,
		UsableInputTokens: budget.InputBudgetTokens,
		CompactAtTokens:   budget.CompactAtTokens,
		BudgetSource:      budget.Source,
	}
	if budget.InputBudgetTokens > 0 {
		reading.PressureRatio = math.Round(float64(projectedTokens)/float64(budget.InputBudgetTokens)*10000) / 10000
	}
	if budget.Source == "" || budget.Source == "default" {
		return reading, false
	}
	return reading, true
}

// cloudAgentContextShouldCompact 是"没配模型上下文上限"时的兜底判据：条数与字节任一到线即压缩。
// 阈值沿用上游既有的跨轮历史闸门（cloudAgentHistoryKeepRounds / cloudAgentHistoryMaxBytes），
// 不另造一套数字——同一份历史不能出现"跨轮已经裁掉、轮内却还认为没超"的两套口径。
func cloudAgentContextShouldCompact(historyMessages, encodedBytes int) bool {
	return agentcontext.ShouldCompact(historyMessages, encodedBytes, cloudAgentHistoryKeepRounds*2, cloudAgentHistoryMaxBytes)
}

// cloudAgentCompactionSourceFacts 量一份"被压材料"的读数（字节数 + 用户轮次）：
// 两种判据都要把它写进触发事件与压缩态，排查时才说得清压掉了多少历史。
func cloudAgentCompactionSourceFacts(state *cloudAgentRuntime) (int, int) {
	raw, err := json.Marshal(state.Canonical.Messages)
	if err != nil {
		raw = nil
	}
	return len(raw), cloudAgentConversationTurnCount(state.Canonical.Messages)
}

// cloudAgentCompactionEventPayload 是 context_compaction_requested 的载荷：
// 带上触发读数，排查时才能说清"到了多少、按哪个口径"。
func cloudAgentCompactionEventPayload(reading cloudAgentCompactionReading, hasReading bool, sourceBytes, turnCount int) map[string]any {
	payload := map[string]any{"reason": "threshold", "sourceBytes": sourceBytes, "turnCount": turnCount}
	if !hasReading {
		payload["basis"] = "bytes"
		return payload
	}
	payload["basis"] = "tokens"
	payload["projectedTokens"] = reading.ProjectedTokens
	payload["usableInputTokens"] = reading.UsableInputTokens
	payload["compactAtTokens"] = reading.CompactAtTokens
	payload["pressureRatio"] = reading.PressureRatio
	payload["budgetSource"] = reading.BudgetSource
	return payload
}

// cloudAgentRequestCompaction 在"下一步预计输入达到压缩线"时【暂停步进循环】：
// 先把历史压成结构化检查点，压完再用压缩后的上下文继续本轮，而不是带着接近满的上下文
// 再发一次请求、更不是直接判死。返回 true 表示已请求压缩，调用方应落库并结束这一步。
//
// 触发者只有两处：token 线（渠道/逻辑模型配了上下文窗口，取其中较小者）与字节/条数兜底。
func (s *Service) cloudAgentRequestCompaction(run *model.CloudAgentExecution, state *cloudAgentRuntime, budget cloudAgentContextBudget, projectedTokens int) (bool, error) {
	if run == nil || state == nil || state.ContextCompaction != nil {
		return false, nil
	}
	// 还有在跑的模型/媒体任务时先不评估：本轮的下一步本来就要等它回来。
	if state.ActiveTaskID != "" {
		return false, nil
	}
	// 次数上限：压完仍然超阈值时不能无限"暂停 → 压缩 → 再暂停"。
	if state.ContextCompactionCount >= cloudAgentMaxCompactionsPerRun {
		return false, nil
	}
	reading, hasReading := cloudAgentCompactionReadingFor(budget, projectedTokens)
	sourceBytes, turnCount := cloudAgentCompactionSourceFacts(state)
	needed := false
	if hasReading {
		needed = reading.ProjectedTokens >= reading.CompactAtTokens
	} else {
		needed = cloudAgentContextShouldCompact(len(state.Canonical.Messages), sourceBytes)
	}
	if !needed {
		return false, nil
	}
	state.ContextCompaction = &cloudAgentContextCompaction{Status: "requested", SourceBytes: sourceBytes, TurnCount: turnCount, Resume: true}
	state.event(run.ID, "context_compaction_requested", cloudAgentCompactionEventPayload(reading, hasReading, sourceBytes, turnCount))
	return true, s.repo.MutateCloudAgent(run.UserID, run.ID, run.Revision, func(current *model.CloudAgentExecution, _ *repository.Repository) error {
		return cloudAgentSave(current, state)
	})
}

// cloudAgentConversationTurnCount 数的是"用户轮次"，且不把检查点摘要算成一轮：
// 摘要是模型写的历史，不是用户原话，把它算进去会让下一轮的轮次口径凭空变大。
func cloudAgentConversationTurnCount(messages []map[string]any) int {
	count := 0
	for _, message := range messages {
		if stringField(message, "role") != "user" {
			continue
		}
		content := stringField(message, "content")
		if stringField(message, cloudAgentContextSourceKey) == "checkpoint" {
			if checkpoint, err := agentcontext.ParseFrame(content); err == nil {
				if checkpoint.CompactedTurnCount > count {
					count = checkpoint.CompactedTurnCount
				}
				continue
			}
		}
		count++
	}
	return count
}

// cloudAgentContextFacts 把本轮事件收敛成"可摘要的服务端事实"。
// 只保留有执行含义的事件类型，并丢掉技能读取的正文回执：压缩模型需要知道"做过什么、
// 什么还没回来"，不需要重新读一遍工具输出。
func cloudAgentContextFacts(events []CloudAgentEvent) []map[string]any {
	start := max(0, len(events)-200)
	facts := make([]map[string]any, 0, len(events)-start)
	for _, event := range events[start:] {
		switch event.Type {
		case "tool_completed", "tool_failed", "generation_task_created", "approval_decided", "run_failed", "canvas_updated":
		default:
			continue
		}
		if stringValue(event.Payload["toolName"]) == "skills_load" {
			continue
		}
		fact := map[string]any{"event": event.Type, "seq": event.Seq}
		for _, key := range []string{"toolName", "callId", "nodeId", "nodeIds", "referenceNodeIds", "taskId", "title", "summary", "status", "decision", "phase", "taskSubmitted", "reason", "operation"} {
			if value, ok := event.Payload[key]; ok {
				fact[key] = value
			}
		}
		if result, ok := event.Payload["result"].(map[string]any); ok {
			for _, key := range []string{"nodeId", "nodeIds", "referenceNodeIds", "taskId", "title", "summary", "status", "phase", "taskSubmitted"} {
				if value, exists := result[key]; exists {
					fact[key] = value
				}
			}
		}
		if event.Type == "canvas_updated" {
			// The durable canvas event stores changes under actions, not top-level
			// nodeIds. Keep only bounded identities, never the full canvasPatch.
			ids := make([]string, 0, 3)
			for _, action := range creationMaps(event.Payload["actions"]) {
				if id := stringValue(action["nodeId"]); id != "" && !cloudAgentContainsString(ids, id) {
					ids = append(ids, id)
					if len(ids) == 3 {
						break
					}
				}
			}
			if len(ids) > 0 {
				fact["nodeIds"] = ids
			}
			if event.Payload["requiresRefresh"] == true {
				fact["requiresRefresh"] = true
			}
		}
		facts = append(facts, fact)
	}
	return facts
}

func cloudAgentJSON(value any) string {
	raw, err := json.Marshal(value)
	if err != nil {
		return "null"
	}
	return string(raw)
}

func cloudAgentContextCompactionPrompt(state *cloudAgentRuntime) string {
	turnCount := cloudAgentConversationTurnCount(state.Canonical.Messages)
	if state.ContextCompaction != nil && state.ContextCompaction.TurnCount > turnCount {
		turnCount = state.ContextCompaction.TurnCount
	}
	return agentcontext.BuildPrompt(agentcontext.Source{
		ConversationJSON: cloudAgentJSON(state.Canonical.Messages),
		OperationsJSON:   cloudAgentJSON(cloudAgentContextFacts(state.Events)),
		CreativeJSON:     cloudAgentJSON(state.CreativeAnchor),
		PreferencesJSON:  cloudAgentJSON(state.Profile.Layers),
		DecisionsJSON:    cloudAgentJSON(state.Decisions),
		TurnCount:        turnCount,
	})
}

// cloudAgentFallbackCheckpoint 是压缩失败时的**服务端保底检查点**：不依赖模型输出，
// 只把服务端已有的事实（用户要求、创作锚点、偏好、决策、事件流水）整理成同一份契约。
// 有它才能保证"压缩调用失败"只是少了一份更好的摘要，而不是整轮没有上下文可用。
func cloudAgentFallbackCheckpoint(state *cloudAgentRuntime) agentcontext.Checkpoint {
	checkpoint := agentcontext.Checkpoint{Version: agentcontext.Version}
	if state.ContextCompaction != nil {
		checkpoint.CompactedTurnCount = state.ContextCompaction.TurnCount
	}
	var history []string
	for _, message := range state.Canonical.Messages {
		role := stringField(message, "role")
		content := strings.TrimSpace(stringField(message, "content"))
		if stringField(message, cloudAgentContextSourceKey) == "checkpoint" {
			if previous, err := agentcontext.ParseFrame(content); err == nil {
				checkpoint = previous
				continue
			}
		}
		if (role == "user" || role == "assistant") && content != "" {
			history = append(history, role+": "+truncateRunes(content, 1800))
		}
	}
	if len(history) > 8 {
		history = history[len(history)-8:]
	}
	currentHistory := strings.Join(history, "\n")
	checkpoint.HistorySummary = truncateRunes(strings.TrimSpace(checkpoint.HistorySummary+"\n"+currentHistory), 10000)
	checkpoint.ScriptDesign = truncateRunes(strings.TrimSpace(checkpoint.ScriptDesign+"\n"+state.CreativeAnchor.UserPrompt+"\n"+currentHistory), 10000)
	checkpoint.CurrentWork = truncateRunes(state.Request.Prompt, 3000)
	checkpoint.NextStep = "继续当前工作；执行前重新读取画布和任务状态，并优先处理未完成任务。"
	// 锚点不再携带权限与"可自行决定"清单（用户消息定义目标），这里只把跨步必须记住的
	// 视觉事实带进摘要：否则压缩后模型会重新声称"没有视觉识别证据"并重复看图。
	for _, asset := range state.CreativeAnchor.ReferenceAssets {
		if asset.VisualIdentity != "inspected" {
			continue
		}
		checkpoint.Decisions = append(checkpoint.Decisions, fmt.Sprintf("已查看过画面 %s（%s），无需重复看图", asset.NodeID, asset.Type))
	}
	checkpoint.Constraints = append(checkpoint.Constraints, fmt.Sprintf("权限模式：%s；本轮预算上限：%.4f credits", state.Request.PermissionMode, state.Request.Budget.MaxCredits))
	for _, layer := range state.Profile.Layers {
		if content := strings.TrimSpace(layer.Content); content != "" {
			checkpoint.UserPreferences = append(checkpoint.UserPreferences, layer.Scope+": "+truncateRunes(content, 2400))
		}
	}
	keys := make([]string, 0, len(state.Decisions))
	for key := range state.Decisions {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	for _, key := range keys {
		checkpoint.Decisions = append(checkpoint.Decisions, key+": "+truncateRunes(state.Decisions[key], 1200))
	}
	for _, fact := range cloudAgentContextFacts(state.Events) {
		encoded := truncateRunes(cloudAgentJSON(fact), 1200)
		checkpoint.OperationHistory = append(checkpoint.OperationHistory, encoded)
		if fact["event"] == "generation_task_created" || stringValue(fact["status"]) == "running" {
			checkpoint.PendingTasks = append(checkpoint.PendingTasks, encoded)
		}
	}
	if len(checkpoint.OperationHistory) > 24 {
		checkpoint.OperationHistory = checkpoint.OperationHistory[len(checkpoint.OperationHistory)-24:]
	}
	if len(checkpoint.PendingTasks) > 12 {
		checkpoint.PendingTasks = checkpoint.PendingTasks[len(checkpoint.PendingTasks)-12:]
	}
	return checkpoint
}

// cloudAgentBoundCheckpoint 把检查点压进固定预算：它是"省上下文"的手段，自己不能变成
// 新的超预算输入。只截断、不新增事实。
func cloudAgentBoundCheckpoint(checkpoint agentcontext.Checkpoint) agentcontext.Checkpoint {
	checkpoint.HistorySummary = truncateRunes(checkpoint.HistorySummary, 3000)
	checkpoint.ScriptDesign = truncateRunes(checkpoint.ScriptDesign, 4000)
	checkpoint.CurrentWork = truncateRunes(checkpoint.CurrentWork, 800)
	checkpoint.NextStep = truncateRunes(checkpoint.NextStep, 500)
	bound := func(values []string, maxItems, maxRunes int) []string {
		if len(values) > maxItems {
			values = values[len(values)-maxItems:]
		}
		result := make([]string, 0, len(values))
		for _, value := range values {
			result = append(result, truncateRunes(value, maxRunes))
		}
		return result
	}
	checkpoint.OperationHistory = bound(checkpoint.OperationHistory, 10, 150)
	checkpoint.PendingTasks = bound(checkpoint.PendingTasks, 6, 150)
	checkpoint.Decisions = bound(checkpoint.Decisions, 8, 150)
	checkpoint.Constraints = bound(checkpoint.Constraints, 8, 150)
	checkpoint.UserPreferences = bound(checkpoint.UserPreferences, 6, 300)
	return checkpoint
}

// cloudAgentCompleteTurnTail 取会话尾部最近 pairs 轮**完整**对话。
//
// 按轮次裁剪时必须成立的不变量（与上游既有口径一致）：
//   - 绝不以 assistant(tool_calls) 或 tool 回执开头：不制造"有调用没结果"的半截轮次；
//   - 带工具调用的 assistant 一律不进这里——它的调用参数与结果不在纯文本对里，
//     留下来会让下一轮收到一个永远闭合不了的调用；
//   - 检查点正文（<agent-context-checkpoint>）不算一轮，避免把摘要当成用户原话。
func cloudAgentCompleteTurnTail(messages []map[string]any, pairs int) []providerTextMessage {
	complete := make([]providerTextMessage, 0, max(0, pairs)*2)
	var pending *providerTextMessage
	for _, message := range messages {
		role, content := stringField(message, "role"), strings.TrimSpace(stringField(message, "content"))
		if (role != "user" && role != "assistant") || content == "" || stringField(message, cloudAgentContextSourceKey) == "runtime" || stringField(message, cloudAgentContextSourceKey) == "continuation" {
			continue
		}
		if stringField(message, cloudAgentContextSourceKey) == "checkpoint" {
			if _, err := agentcontext.ParseFrame(content); err == nil {
				continue
			}
		}
		if role == "user" {
			candidate := providerTextMessage{Role: role, Content: content}
			pending = &candidate
			continue
		}
		if _, hasCalls := message["tool_calls"]; hasCalls || pending == nil {
			continue
		}
		complete = append(complete, *pending, providerTextMessage{Role: role, Content: content})
		pending = nil
	}
	start := max(0, len(complete)-max(0, pairs)*2)
	result := append([]providerTextMessage(nil), complete[start:]...)
	// 尚未收到回答的最后一条用户要求也必须原样保留；否则压缩会把当前目标
	// 只交给不可信的模型摘要，模型漏写时下一步便静默失去用户指令。
	if pending != nil {
		result = append(result, *pending)
	}
	return result
}

// cloudAgentRetainedTurnCount 数的是"压缩后仍原样留在上下文里的用户轮次"。
func cloudAgentRetainedTurnCount(retained []providerTextMessage) int {
	count := 0
	for _, message := range retained {
		if message.Role == "user" {
			count++
		}
	}
	return count
}

// cloudAgentCheckpointHistory 组装压缩后的历史：检查点 + 回执 + 最近 N 对原文。
// 回执是必须的——它让检查点这段 user 消息后面紧跟 assistant，历史仍保持正常交替。
func cloudAgentCheckpointHistory(checkpoint agentcontext.Checkpoint, recent []providerTextMessage) ([]providerTextMessage, error) {
	framed, err := agentcontext.Frame(checkpoint)
	if err != nil {
		return nil, err
	}
	history := []providerTextMessage{{Role: "user", Content: framed, AgentContextSource: "checkpoint"}, {Role: "assistant", Content: agentcontext.Acknowledgement}}
	return append(history, recent...), nil
}

// enqueueCloudAgentContextCompaction 发出一次**独立的模型调用**做压缩：不流式、不带工具、
// 用同一个渠道（同一份记账口径），但它的结果只用于生成检查点，不进入面向用户的消息流。
func (s *Service) enqueueCloudAgentContextCompaction(run *model.CloudAgentExecution, state *cloudAgentRuntime) error {
	prompt := cloudAgentContextCompactionPrompt(state)
	input := map[string]any{
		"mode": "text", "prompt": prompt,
		"config":      map[string]any{"channelId": state.Request.ChannelID, "channelModelKey": state.Request.ChannelModelKey, "model": firstNonEmpty(state.Request.ChannelModelKey, state.Request.Model), "systemPrompt": "只执行服务端上下文压缩合同。不要调用工具，不要生成面向用户的回复。"},
		"textOptions": map[string]any{"stream": false, "thinking": false},
	}
	req := CreateTaskRequest{ProjectID: state.Request.CanvasID, Type: "canvas_text", Operation: cloudAgentContextCompactionOperation, Prompt: prompt, Model: state.Request.Model, LogicalModelID: state.Request.LogicalModelID, Input: input}
	return s.enqueueCloudAgentTask(run, state, req, nil)
}

// advanceCloudAgentContextCompaction 收压缩任务的结果。任何失败都退到保底检查点：
// 压缩是"省上下文"的优化，不能因为一次模型调用失败就把整轮搞死。
func (s *Service) advanceCloudAgentContextCompaction(run *model.CloudAgentExecution, state *cloudAgentRuntime, task *model.Task) error {
	if task.Status == model.TaskStatusQueued || task.Status == model.TaskStatusRunning {
		return nil
	}
	checkpoint := cloudAgentFallbackCheckpoint(state)
	mode, reason := "fallback", "压缩模型任务未成功，已使用服务端保底检查点"
	if task.Status == model.TaskStatusSucceeded {
		var result struct {
			Text string `json:"text"`
		}
		if err := json.Unmarshal([]byte(task.ResultJSON), &result); err == nil {
			if parsed, parseErr := agentcontext.Parse(result.Text); parseErr == nil {
				// JSON 合同只能证明形状，不能证明任务 ID、审批和执行结果是真的。
				// 执行事实只取本轮服务端事件，不采纳模型写的 operation/pending 列表。
				parsed.OperationHistory = checkpoint.OperationHistory
				parsed.PendingTasks = checkpoint.PendingTasks
				checkpoint, mode, reason = parsed, "model", ""
			} else {
				reason = "压缩模型输出不符合检查点合同，已使用服务端保底检查点"
			}
		} else {
			reason = "压缩模型结果损坏，已使用服务端保底检查点"
		}
	}
	if state.ContextCompaction != nil {
		// 检查点里的轮次数以服务端自己的计数为准，模型写的数字不可信。
		checkpoint.CompactedTurnCount = state.ContextCompaction.TurnCount
	}
	return s.persistCloudAgentContextCheckpoint(run, state, checkpoint, mode, reason)
}

func (s *Service) persistCloudAgentContextCheckpoint(run *model.CloudAgentExecution, state *cloudAgentRuntime, checkpoint agentcontext.Checkpoint, mode, reason string) error {
	return s.writeCloudAgentContextCheckpoint(run, state, checkpoint, mode, reason, false)
}

// finalizeCloudAgentInterruptedCompaction 收拾"停在压缩上"的终态轮次。
//
// 压缩是「暂停步进 → 压完继续」的中途动作：本轮在压缩期间被取消（或已经失败）时，
// 调度器不会再推进这一轮，于是 ContextCompaction 会永远挂在 requested/running 上
// （界面一直显示"正在压缩"），那份检查点也永远落不了盘。这里按服务端保底检查点收口。
func (s *Service) finalizeCloudAgentInterruptedCompaction(run *model.CloudAgentExecution, state *cloudAgentRuntime, reason string) error {
	if run == nil || state == nil || state.ContextCompaction == nil {
		return nil
	}
	checkpoint := cloudAgentFallbackCheckpoint(state)
	checkpoint.CompactedTurnCount = state.ContextCompaction.TurnCount
	return s.writeCloudAgentContextCheckpoint(run, state, checkpoint, "fallback", reason, true)
}

// writeCloudAgentContextCheckpoint 是落检查点的唯一实现。
//
// keepTerminal=true 用于「本轮已经是终态」的收尾：只落检查点、历史与事件，不改运行状态
// （否则一次失败轮的收尾会把 failed 写成 completed，等于凭空复活一轮）。
func (s *Service) writeCloudAgentContextCheckpoint(run *model.CloudAgentExecution, state *cloudAgentRuntime, checkpoint agentcontext.Checkpoint, mode, reason string, keepTerminal bool) error {
	checkpoint = cloudAgentBoundCheckpoint(checkpoint)
	turnsBefore := cloudAgentConversationTurnCount(state.Canonical.Messages)
	recent := cloudAgentCompleteTurnTail(state.Canonical.Messages, cloudAgentContextKeepPairs)
	history, err := cloudAgentCheckpointHistory(checkpoint, recent)
	if err != nil {
		return fmt.Errorf("%w: %v", errCloudAgentCheckpoint, err)
	}
	return s.repo.MutateCloudAgent(run.UserID, run.ID, run.Revision, func(current *model.CloudAgentExecution, _ *repository.Repository) error {
		state.ContextCheckpoint = &checkpoint
		state.TextHistory = history
		state.HistoryIncludesCurrent = true
		state.Canonical.Messages = make([]map[string]any, 0, len(history))
		for _, message := range history {
			entry := map[string]any{"role": message.Role, "content": message.Content}
			// 压缩重建也必须保留来源标记，否则交接身份在压缩后就丢了（旧会话会被多算轮次）。
			if message.AgentContextSource != "" {
				entry[cloudAgentContextSourceKey] = message.AgentContextSource
			}
			state.Canonical.Messages = append(state.Canonical.Messages, entry)
		}
		// 消息整体被替换：写路径按 kind 逐条 upsert 并删除 sequence 超出新条数的尾部行，
		// 因此"条数变少/全变"都能正确落库。
		// 历史被换成检查点，早期读取回执也一起没了：不清"已读过去重"标记，模型再要技能正文
		// 会被回一句"本轮已请求过该技能路径，请使用历史工具结果"，而那份历史已经不存在。
		state.SkillReads, state.ProfileReads = nil, nil
		state.ActiveTaskID, state.ActiveTextDraft = "", ""
		// 中途暂停压缩（Resume）：压完继续本轮的步进，并记一次次数上限。
		// 收尾压缩（resume=false）本来就要结束本轮；keepTerminal=true 表示本轮已是终态
		// （取消/失败的收尾），只落检查点与事件，绝不把 failed/cancelled 改写成 completed。
		resume := state.ContextCompaction != nil && state.ContextCompaction.Resume
		state.ContextCompaction = nil
		if resume {
			state.ContextCompactionCount++
		} else if !keepTerminal {
			current.Status = "completed"
		}
		payload := map[string]any{
			"mode": mode, "resume": resume,
			"compactedTurnCount": checkpoint.CompactedTurnCount,
			"historyMessages":    len(history),
			// 被折进检查点的轮次数 = 压缩前的用户轮次 − 原样保留的最近轮次：
			// 不能拿"压缩后再数一遍"来做差，检查点自己携带轮次数会把保留的那几轮重复计入。
			"droppedTurns": max(0, turnsBefore-cloudAgentRetainedTurnCount(recent)),
		}
		if reason != "" {
			payload["reason"] = reason
		}
		state.event(run.ID, "context_compacted", payload)
		return cloudAgentSave(current, state)
	})
}
