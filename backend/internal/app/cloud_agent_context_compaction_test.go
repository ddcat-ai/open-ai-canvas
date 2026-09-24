package app

// 自研：画布 Agent「上下文超预算时压缩成检查点后继续本轮」的针对性用例。
import (
	"context"
	"encoding/json"
	"strings"
	"testing"

	"gorm.io/gorm"
	"infinite-canvas/backend/internal/agentcontext"
	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/repository"
)

// saveCloudAgentCompactionState 用真实保存路径持久化运行状态（消息、事件与检查点同事务），
// 而不是直接改写 state_json：检查点从 v2 起不再承载消息与事件，绕过持久化层会让行上的
// 计数与实际行数脱节。
func saveCloudAgentCompactionState(t *testing.T, s *Service, run *model.CloudAgentExecution, state *cloudAgentRuntime, mutate ...func(*model.CloudAgentExecution)) *model.CloudAgentExecution {
	t.Helper()
	if err := s.repo.MutateCloudAgent(run.UserID, run.ID, run.Revision, func(current *model.CloudAgentExecution, _ *repository.Repository) error {
		for _, apply := range mutate {
			apply(current)
		}
		return cloudAgentSave(current, state)
	}); err != nil {
		t.Fatalf("保存 Agent 状态失败: %v", err)
	}
	updated, err := s.repo.CloudAgent(run.UserID, run.ID)
	if err != nil {
		t.Fatalf("重新读取 Agent 运行失败: %v", err)
	}
	return updated
}

func decodeCloudAgentCompactionState(t *testing.T, s *Service, runID string) (*model.CloudAgentExecution, cloudAgentRuntime) {
	t.Helper()
	current, err := s.repo.CloudAgent("user", runID)
	if err != nil {
		t.Fatal(err)
	}
	state, err := cloudAgentDecode(current)
	if err != nil {
		t.Fatal(err)
	}
	return current, state
}

func cloudAgentCompactionEvents(t *testing.T, s *Service, run *model.CloudAgentExecution, kind string) []CloudAgentEvent {
	t.Helper()
	_, state := decodeCloudAgentCompactionState(t, s, run.ID)
	events := make([]CloudAgentEvent, 0, 2)
	for _, event := range state.Events {
		if event.Type == kind {
			events = append(events, event)
		}
	}
	return events
}

// smallWindowCompactionFixture 造一个"配了小上下文窗口的渠道模型 + 已经堆到压缩线的会话"。
// 窗口取 8K/2K，压缩线（输入预算的 85%）只有一千多 token，用例不必依赖真实模型。
func smallWindowCompactionFixture(t *testing.T) (*Service, *gorm.DB, *model.CloudAgentExecution, cloudAgentRuntime, cloudAgentContextBudget) {
	t.Helper()
	s, db, root := reliableAgentRoot(t)
	capability := DefaultModelCapabilityConfigForModel(string(model.ChannelInterfaceChatCompletion), "text-test")
	capability.Text.ContextWindowTokens = 8_000
	capability.Text.MaxOutputTokens = 2_000
	if err := db.Model(&model.ChannelModel{}).Where("id = ?", "cm").Update("capability_config_json", mustEncodeModelCapabilityConfig(t, capability)).Error; err != nil {
		t.Fatal(err)
	}
	run, state := decodeCloudAgentCompactionState(t, s, root.ID)
	budget := s.cloudAgentContextBudgetForRequest(state.Request)
	if budget.Source != "channel-model" {
		t.Fatalf("渠道模型窗口没有生效: %#v", budget)
	}
	state.Canonical.Messages = append(state.Canonical.Messages, map[string]any{"role": "user", "content": strings.Repeat("剧情前提与人物关系", 300)})
	// 用例直接考"下一步该不该压"：这一步没有在跑的模型任务。
	state.ActiveTaskID = ""
	run = saveCloudAgentCompactionState(t, s, run, &state)
	return s, db, run, state, budget
}

// 下一步预计输入超过可用输入预算的压缩线时：暂停步进循环去压缩，而不是直接判死。
func TestCloudAgentCompactionRequestsWhenTokenLineReached(t *testing.T) {
	s, _, run, state, budget := smallWindowCompactionFixture(t)
	if requested, err := s.cloudAgentRequestCompaction(run, &state, budget, budget.CompactAtTokens-1); err != nil || requested {
		t.Fatalf("未到压缩线却请求了压缩: requested=%v err=%v", requested, err)
	}
	if state.ContextCompaction != nil {
		t.Fatalf("未到压缩线却改了状态: %+v", state.ContextCompaction)
	}

	requested, err := s.cloudAgentRequestCompaction(run, &state, budget, budget.CompactAtTokens)
	if err != nil || !requested {
		t.Fatalf("到压缩线没有暂停: requested=%v err=%v", requested, err)
	}
	if state.ContextCompaction == nil || state.ContextCompaction.Status != "requested" || !state.ContextCompaction.Resume {
		t.Fatalf("压缩态 = %+v，应为 requested + resume", state.ContextCompaction)
	}
	// 暂停这一步不能顺手结束本轮：压完还要继续。
	final, persisted := decodeCloudAgentCompactionState(t, s, run.ID)
	if final.Status != "running" {
		t.Fatalf("暂停把本轮改成了 %q", final.Status)
	}
	if persisted.ContextCompaction == nil || !persisted.ContextCompaction.Resume {
		t.Fatalf("压缩态没有落库: %+v", persisted.ContextCompaction)
	}
	events := cloudAgentCompactionEvents(t, s, final, "context_compaction_requested")
	if len(events) != 1 {
		t.Fatalf("context_compaction_requested 事件数 = %d", len(events))
	}
	payload := events[0].Payload
	// 事件从持久化状态里读回来，数字都是 float64。
	if payload["basis"] != "tokens" || payload["compactAtTokens"] != float64(budget.CompactAtTokens) {
		t.Fatalf("触发读数 = %+v", payload)
	}
	if ratio, ok := payload["pressureRatio"].(float64); !ok || ratio < 0.84 {
		t.Fatalf("压力读数 = %+v", payload["pressureRatio"])
	}
}

// 没有配模型上下文窗口时退回字节/条数兜底判据，且兜底判据同样必须"暂停而不是判死"。
func TestCloudAgentCompactionFallsBackToBytesWithoutModelWindow(t *testing.T) {
	s, db, root := reliableAgentRoot(t)
	run, state := decodeCloudAgentCompactionState(t, s, root.ID)
	// 渠道模型没有能力配置时，预算算式退回首部默认值，Source 变成 default：
	// 这时 token 线没有意义，只能按字节/条数兜底。
	if err := db.Model(&model.ChannelModel{}).Where("id = ?", "cm").Update("capability_config_json", "{}").Error; err != nil {
		t.Fatal(err)
	}
	state.ActiveTaskID = ""
	budget := s.cloudAgentContextBudgetForRequest(state.Request)
	if budget.Source != "default" {
		t.Fatalf("用例前提是渠道没有配上下文窗口: %#v", budget)
	}
	// 20 条用户消息 = 上游跨轮历史闸门（最近 10 轮 × 2）；它们都是 user，无法被就地卸载。
	for index := 0; index < cloudAgentHistoryKeepRounds*2; index++ {
		state.Canonical.Messages = append(state.Canonical.Messages, map[string]any{"role": "user", "content": "第 " + string(rune('A'+index%26)) + " 次要求：继续推进分镜"})
	}
	state.Step = 3
	run = saveCloudAgentCompactionState(t, s, run, &state)

	// 走真实推进路径：这一步在上游会被"超预算"判死，现在应该只是暂停。
	if err := s.advanceCloudAgent(run); err != nil {
		t.Fatalf("推进失败: %v", err)
	}
	final, persisted := decodeCloudAgentCompactionState(t, s, run.ID)
	if final.Status != "running" {
		t.Fatalf("超预算把本轮判死了: %q（失败信息 %q）", final.Status, final.FailureMessage)
	}
	if persisted.ContextCompaction == nil || persisted.ContextCompaction.Status != "requested" {
		t.Fatalf("兜底判据没有暂停步进: %+v", persisted.ContextCompaction)
	}
	if persisted.Step != 3 {
		t.Fatalf("暂停不该推进步数: step = %d", persisted.Step)
	}
	events := cloudAgentCompactionEvents(t, s, final, "context_compaction_requested")
	if len(events) != 1 || events[0].Payload["basis"] != "bytes" {
		t.Fatalf("兜底触发事件 = %+v", events)
	}
}

// 压缩结果合法时：历史被换成「检查点 + 回执 + 最近 2 对」，并 Resume 继续本轮的步进。
func TestCloudAgentCompactionResumesStepLoopWithCheckpoint(t *testing.T) {
	s, db, run, state, budget := smallWindowCompactionFixture(t)
	state.Canonical.Messages = append(state.Canonical.Messages,
		map[string]any{"role": "assistant", "content": "已读取分镜"},
		map[string]any{"role": "user", "content": "把第 4 行补上光影"},
		map[string]any{"role": "assistant", "content": "好的，先看一下现有配色"},
	)
	lastTaskID, lastEstimate := state.LastStepTaskID, state.LastStepEstimate
	state.TokenAnchor = &cloudAgentTokenAnchor{TaskID: lastTaskID, Step: state.Step, InputTokens: 10000, EstimatedTokens: lastEstimate, Accepted: true}
	run = saveCloudAgentCompactionState(t, s, run, &state)
	stepBefore := state.Step
	pressureCount := len(cloudAgentCompactionEvents(t, s, run, "context_pressure"))
	if requested, err := s.cloudAgentRequestCompaction(run, &state, budget, budget.CompactAtTokens); err != nil || !requested {
		t.Fatalf("没有触发压缩: %v", err)
	}
	run, _ = decodeCloudAgentCompactionState(t, s, run.ID)
	if err := s.advanceCloudAgent(run); err != nil {
		t.Fatalf("发起压缩失败: %v", err)
	}
	_, persisted := decodeCloudAgentCompactionState(t, s, run.ID)
	if persisted.ContextCompaction == nil || persisted.ContextCompaction.Status != "running" {
		t.Fatalf("压缩任务发出后状态 = %+v", persisted.ContextCompaction)
	}
	if persisted.Step != stepBefore {
		t.Fatalf("压缩调用占掉了步数: %d → %d", stepBefore, persisted.Step)
	}
	if persisted.LastStepTaskID != lastTaskID || persisted.LastStepEstimate != lastEstimate || persisted.TokenAnchor == nil || !persisted.TokenAnchor.Accepted {
		t.Fatalf("压缩调用不得覆盖普通模型步骤和锚点: last=%s estimate=%d anchor=%+v", persisted.LastStepTaskID, persisted.LastStepEstimate, persisted.TokenAnchor)
	}
	if got := len(cloudAgentCompactionEvents(t, s, run, "context_pressure")); got != pressureCount {
		t.Fatalf("压缩任务不得发普通模型请求读数: %d → %d", pressureCount, got)
	}
	task, err := s.repo.TaskForUser("user", persisted.ActiveTaskID)
	if err != nil {
		t.Fatal(err)
	}
	// 压缩是一次独立模型调用：用同一个渠道，但操作名与步进调用区分开。
	if task.Operation != cloudAgentContextCompactionOperation || task.Type != "canvas_text" {
		t.Fatalf("压缩任务 = %s/%s", task.Type, task.Operation)
	}
	// 检查点里的轮次数以服务端自己的计数为准（模型写的数字不可信）。
	checkpoint := agentcontext.Checkpoint{
		Version: agentcontext.Version, HistorySummary: "用户要求补齐分镜光影", ScriptDesign: "冷色调 + 左手伤口连续性",
		CurrentWork: "改写第 4 行", NextStep: "写入节点", PendingTasks: []string{"task-1 仍在运行，先查询"},
		CompactedTurnCount: 5,
	}
	body, err := json.Marshal(checkpoint)
	if err != nil {
		t.Fatal(err)
	}
	result, err := json.Marshal(map[string]any{"text": string(body)})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.Model(&model.Task{}).Where("id = ?", task.ID).Updates(map[string]any{"status": model.TaskStatusSucceeded, "result_json": string(result)}).Error; err != nil {
		t.Fatal(err)
	}
	run, _ = decodeCloudAgentCompactionState(t, s, run.ID)

	if err := s.advanceCloudAgent(run); err != nil {
		t.Fatalf("收压缩结果失败: %v", err)
	}
	final, persisted := decodeCloudAgentCompactionState(t, s, run.ID)
	if final.Status != "running" {
		t.Fatalf("Resume 应继续本轮，实际状态 = %q", final.Status)
	}
	if persisted.ContextCompaction != nil {
		t.Fatalf("压缩态没有收干净: %+v", persisted.ContextCompaction)
	}
	if persisted.ContextCompactionCount != 1 {
		t.Fatalf("压缩次数 = %d", persisted.ContextCompactionCount)
	}
	if persisted.ContextCheckpoint == nil || persisted.ContextCheckpoint.HistorySummary != "用户要求补齐分镜光影" {
		t.Fatalf("检查点 = %+v", persisted.ContextCheckpoint)
	}
	if len(persisted.ContextCheckpoint.PendingTasks) != 0 {
		t.Fatalf("模型虚构的待办任务进入了服务端事实: %+v", persisted.ContextCheckpoint.PendingTasks)
	}
	if !persisted.HistoryIncludesCurrent {
		t.Fatal("压缩换过历史，续轮交接不能再把本轮追加一遍")
	}
	if persisted.ActiveTaskID != "" {
		t.Fatalf("压缩完成后仍挂着活跃任务: %q", persisted.ActiveTaskID)
	}
	// 会话被换成「检查点 + 回执 + 最近两对」，旧的 20 条大消息不再进上下文。
	messages := persisted.Canonical.Messages
	if len(messages) != 6 {
		t.Fatalf("压缩后的消息数 = %d: %+v", len(messages), messages)
	}
	if !strings.Contains(stringField(messages[0], "content"), "<agent-context-checkpoint>") {
		t.Fatalf("首条不是检查点: %+v", messages[0])
	}
	if stringField(messages[1], "role") != "assistant" || stringField(messages[1], "content") != agentcontext.Acknowledgement {
		t.Fatalf("检查点后面没有跟回执: %+v", messages[1])
	}
	if stringField(messages[len(messages)-1], "content") != "好的，先看一下现有配色" {
		t.Fatalf("最近对话没有保留: %+v", messages[len(messages)-1])
	}
	events := cloudAgentCompactionEvents(t, s, final, "context_compacted")
	if len(events) != 1 {
		t.Fatalf("context_compacted 事件数 = %d", len(events))
	}
	payload := events[0].Payload
	if payload["mode"] != "model" || payload["resume"] != true || payload["historyMessages"] != float64(len(messages)) {
		t.Fatalf("context_compacted 载荷 = %+v", payload)
	}
	if turns, ok := payload["compactedTurnCount"].(float64); !ok || turns <= 0 {
		t.Fatalf("检查点轮次数 = %+v", payload["compactedTurnCount"])
	}
	if dropped, ok := payload["droppedTurns"].(float64); !ok || dropped <= 0 {
		t.Fatalf("被压掉的轮次数 = %+v", payload["droppedTurns"])
	}
}

// 压完仍然超阈值时不能无限暂停：同一轮的压缩次数有上限。
func TestCloudAgentCompactionStopsAtAttemptLimit(t *testing.T) {
	s, _, run, state, budget := smallWindowCompactionFixture(t)
	state.ContextCompactionCount = cloudAgentMaxCompactionsPerRun
	if requested, err := s.cloudAgentRequestCompaction(run, &state, budget, budget.CompactAtTokens*4); err != nil || requested {
		t.Fatalf("超过次数上限仍然暂停: requested=%v err=%v", requested, err)
	}
	if state.ContextCompaction != nil {
		t.Fatalf("超过次数上限仍然改了状态: %+v", state.ContextCompaction)
	}

	// 还有一次余额时可以压；压完余额用尽，下一次请求不再暂停。
	state.ContextCompactionCount = cloudAgentMaxCompactionsPerRun - 1
	requested, err := s.cloudAgentRequestCompaction(run, &state, budget, budget.CompactAtTokens*4)
	if err != nil || !requested {
		t.Fatalf("余额内没有压缩: requested=%v err=%v", requested, err)
	}
	run, persisted := decodeCloudAgentCompactionState(t, s, run.ID)
	persisted.ContextCompactionCount = cloudAgentMaxCompactionsPerRun
	run = saveCloudAgentCompactionState(t, s, run, &persisted, func(current *model.CloudAgentExecution) {
		current.Status = "running"
	})
	requested, err = s.cloudAgentRequestCompaction(run, &persisted, budget, budget.CompactAtTokens*4)
	if err != nil || requested {
		t.Fatalf("次数用尽后仍然暂停: requested=%v err=%v", requested, err)
	}
}

// 压缩调用失败时走服务端保底检查点：整轮既不判死，也不会因为压缩失败丢掉上下文。
func TestCloudAgentCompactionUsesFallbackCheckpointOnModelFailure(t *testing.T) {
	s, db, run, state, budget := smallWindowCompactionFixture(t)
	if requested, err := s.cloudAgentRequestCompaction(run, &state, budget, budget.CompactAtTokens); err != nil || !requested {
		t.Fatalf("没有触发压缩: %v", err)
	}
	run, _ = decodeCloudAgentCompactionState(t, s, run.ID)
	if err := s.advanceCloudAgent(run); err != nil {
		t.Fatalf("发起压缩失败: %v", err)
	}
	_, persisted := decodeCloudAgentCompactionState(t, s, run.ID)
	if err := db.Model(&model.Task{}).Where("id = ?", persisted.ActiveTaskID).
		Updates(map[string]any{"status": model.TaskStatusFailed, "error": "上游 500"}).Error; err != nil {
		t.Fatal(err)
	}
	run, _ = decodeCloudAgentCompactionState(t, s, run.ID)

	if err := s.advanceCloudAgent(run); err != nil {
		t.Fatalf("收压缩结果失败: %v", err)
	}
	final, persisted := decodeCloudAgentCompactionState(t, s, run.ID)
	if final.Status != "running" {
		t.Fatalf("压缩失败把整轮搞死了: %q（失败信息 %q）", final.Status, final.FailureMessage)
	}
	if persisted.ContextCheckpoint == nil {
		t.Fatal("压缩失败没有落保底检查点")
	}
	if persisted.ContextCompaction != nil || persisted.ContextCompactionCount != 1 {
		t.Fatalf("压缩态 = %+v，次数 = %d", persisted.ContextCompaction, persisted.ContextCompactionCount)
	}
	events := cloudAgentCompactionEvents(t, s, final, "context_compacted")
	if len(events) != 1 || events[0].Payload["mode"] != "fallback" || events[0].Payload["resume"] != true {
		t.Fatalf("保底检查点事件 = %+v", events)
	}
	if events[0].Payload["reason"] == nil {
		t.Fatalf("保底检查点必须说明原因: %+v", events[0].Payload)
	}
}

// 压缩模型输出不合规（不是 JSON / 版本不对）时同样退到保底检查点。
func TestCloudAgentCompactionRejectsInvalidModelCheckpoint(t *testing.T) {
	s, db, run, state, budget := smallWindowCompactionFixture(t)
	if requested, err := s.cloudAgentRequestCompaction(run, &state, budget, budget.CompactAtTokens); err != nil || !requested {
		t.Fatalf("没有触发压缩: %v", err)
	}
	run, _ = decodeCloudAgentCompactionState(t, s, run.ID)
	if err := s.advanceCloudAgent(run); err != nil {
		t.Fatal(err)
	}
	_, persisted := decodeCloudAgentCompactionState(t, s, run.ID)
	body, err := json.Marshal(map[string]any{"text": `{"version":99,"historySummary":"瞎编"}`})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.Model(&model.Task{}).Where("id = ?", persisted.ActiveTaskID).
		Updates(map[string]any{"status": model.TaskStatusSucceeded, "result_json": string(body)}).Error; err != nil {
		t.Fatal(err)
	}
	run, _ = decodeCloudAgentCompactionState(t, s, run.ID)
	if err := s.advanceCloudAgent(run); err != nil {
		t.Fatal(err)
	}
	final, persisted := decodeCloudAgentCompactionState(t, s, run.ID)
	if final.Status != "running" || persisted.ContextCheckpoint == nil {
		t.Fatalf("不合规输出没有退到保底检查点: status=%q checkpoint=%+v", final.Status, persisted.ContextCheckpoint)
	}
	events := cloudAgentCompactionEvents(t, s, final, "context_compacted")
	if len(events) != 1 || events[0].Payload["mode"] != "fallback" {
		t.Fatalf("不合规输出的压缩事件 = %+v", events)
	}
}

// 压缩期间被取消：收尾要落保底检查点 + context_compacted(mode=fallback)，且终态不被改写。
func TestCloudAgentCancelledRunFinalizesInterruptedCompaction(t *testing.T) {
	s, db, root := reliableAgentRoot(t)
	run, state := decodeCloudAgentCompactionState(t, s, root.ID)
	state.Canonical.Messages = []map[string]any{
		{"role": "user", "content": "把分镜里第 1 到第 3 行补上光影"},
		{"role": "assistant", "content": "已读完分镜，准备写入"},
	}
	state.TextHistory = []providerTextMessage{{Role: "user", Content: "上一轮的要求"}, {Role: "assistant", Content: "上一轮的回复"}}
	state.ContextCompaction = &cloudAgentContextCompaction{Status: "running", Resume: true, TurnCount: 4, SourceBytes: 180000}
	state.ActiveTaskID = "task-compaction"
	state.TaskIDs = append(state.TaskIDs, "task-compaction")
	if err := db.Create(&model.Task{
		ID: "task-compaction", UserID: "user", ProjectID: state.Request.CanvasID, Type: "canvas_text",
		Status: model.TaskStatusRunning, Operation: cloudAgentContextCompactionOperation,
	}).Error; err != nil {
		t.Fatal(err)
	}
	run = saveCloudAgentCompactionState(t, s, run, &state, func(current *model.CloudAgentExecution) {
		current.Status = "cancelled"
		current.CleanupPending = true
		current.ActiveTaskID = "task-compaction"
	})

	if err := s.finishCloudAgentCleanup(context.Background(), run); err != nil {
		t.Fatal(err)
	}
	final, persisted := decodeCloudAgentCompactionState(t, s, run.ID)
	if final.Status != "cancelled" {
		t.Fatalf("终态被改写: %q", final.Status)
	}
	if final.CleanupPending {
		t.Fatal("收尾没有完成")
	}
	if persisted.ContextCompaction != nil {
		t.Fatalf("压缩态没有收干净: %+v", persisted.ContextCompaction)
	}
	if persisted.ContextCheckpoint == nil {
		t.Fatal("取消期间没有落保底检查点")
	}
	if persisted.ContextCheckpoint.CompactedTurnCount != 4 {
		t.Fatalf("检查点轮次数 = %d", persisted.ContextCheckpoint.CompactedTurnCount)
	}
	events := cloudAgentCompactionEvents(t, s, final, "context_compacted")
	if len(events) != 1 {
		t.Fatalf("context_compacted 事件数 = %d", len(events))
	}
	if events[0].Payload["mode"] != "fallback" || events[0].Payload["resume"] != true {
		t.Fatalf("压缩事件载荷 = %+v", events[0].Payload)
	}
	if events[0].Payload["reason"] == nil {
		t.Fatalf("中断收尾必须说明原因: %+v", events[0].Payload)
	}
	// 收尾是幂等的：CleanupPending 已清掉后再跑一次不会重复落事件。
	if err := s.finishCloudAgentCleanup(context.Background(), final); err != nil {
		t.Fatal(err)
	}
	if got := len(cloudAgentCompactionEvents(t, s, final, "context_compacted")); got != 1 {
		t.Fatalf("收尾不幂等，事件数 = %d", got)
	}
}

// 失败轮同样是终态：中断收尾只能落检查点，不能把 failed 写成 completed。
func TestCloudAgentFailedRunStaysFailedWhenCompactionFinalized(t *testing.T) {
	s, db, root := reliableAgentRoot(t)
	run, state := decodeCloudAgentCompactionState(t, s, root.ID)
	state.Canonical.Messages = []map[string]any{{"role": "user", "content": "继续"}, {"role": "assistant", "content": "好的"}}
	state.ContextCompaction = &cloudAgentContextCompaction{Status: "requested", Resume: true, TurnCount: 2}
	state.ActiveTaskID = ""
	run = saveCloudAgentCompactionState(t, s, run, &state)
	if err := db.Model(&model.CloudAgentExecution{}).Where("id = ?", root.ID).Update("status", "failed").Error; err != nil {
		t.Fatal(err)
	}
	run, state = decodeCloudAgentCompactionState(t, s, run.ID)

	if err := s.finalizeCloudAgentInterruptedCompaction(run, &state, "本轮在压缩期间结束，已使用服务端保底检查点"); err != nil {
		t.Fatal(err)
	}
	final, _ := decodeCloudAgentCompactionState(t, s, run.ID)
	if final.Status != "failed" {
		t.Fatalf("失败轮被复活成 %q", final.Status)
	}
	if len(cloudAgentCompactionEvents(t, s, final, "context_compacted")) != 1 {
		t.Fatal("失败轮没有落保底检查点")
	}
}

// 没有停在压缩上的轮次：收尾不该凭空写一条压缩事件。
func TestCloudAgentCleanupWithoutPendingCompactionWritesNoCheckpointEvent(t *testing.T) {
	s, db, root := reliableAgentRoot(t)
	run, _ := decodeCloudAgentCompactionState(t, s, root.ID)
	if err := db.Model(&model.CloudAgentExecution{}).Where("id = ?", root.ID).
		Updates(map[string]any{"status": "cancelled", "cleanup_pending": true}).Error; err != nil {
		t.Fatal(err)
	}
	run, _ = decodeCloudAgentCompactionState(t, s, run.ID)
	if err := s.finishCloudAgentCleanup(context.Background(), run); err != nil {
		t.Fatal(err)
	}
	if got := len(cloudAgentCompactionEvents(t, s, run, "context_compacted")); got != 0 {
		t.Fatalf("无压缩态的收尾写了 %d 条压缩事件", got)
	}
}

// 保留最近 N 对消息的不变量：不以 tool/带工具调用的 assistant 开头，不把摘要当轮次。
func TestCloudAgentCompactionKeepsRecentCompleteTurns(t *testing.T) {
	messages := []map[string]any{
		{"role": "user", "content": "第一轮要求"},
		{"role": "assistant", "content": "第一轮回复"},
		{"role": "user", "content": "第二轮要求"},
		{"role": "assistant", "content": "", "tool_calls": []any{map[string]any{"id": "call-1"}}},
		{"role": "tool", "content": `{"ok":true}`},
		{"role": "assistant", "content": "第二轮回复"},
		{"role": "user", "content": "<agent-context-checkpoint>\n{\"version\":1}\n</agent-context-checkpoint>", cloudAgentContextSourceKey: "checkpoint"},
		{"role": "user", "content": "第三轮要求"},
		{"role": "assistant", "content": "第三轮回复"},
	}
	recent := cloudAgentCompleteTurnTail(messages, cloudAgentContextKeepPairs)
	if len(recent) != 4 {
		t.Fatalf("最近对话 = %+v", recent)
	}
	if recent[0].Role != "user" || recent[0].Content != "第二轮要求" || recent[len(recent)-1].Content != "第三轮回复" {
		t.Fatalf("保留的不是最近两对完整对话: %+v", recent)
	}
	for _, message := range recent {
		if message.Role == "tool" {
			t.Fatal("保留了一条孤立的工具回执")
		}
	}
	// 只有一对时不应把更早的一对带进来。
	if got := cloudAgentCompleteTurnTail(messages, 1); len(got) != 2 || got[0].Content != "第三轮要求" {
		t.Fatalf("保留一对 = %+v", got)
	}
}

// 压缩调用与步进调用一样属于"一次模型调用"，必须同样受单步墙钟约束。
func TestCloudAgentModelOperationCoversContextCompaction(t *testing.T) {
	if !cloudAgentModelOperation(&model.Task{Operation: cloudAgentContextCompactionOperation}) {
		t.Fatal("压缩调用没有按单步口径计时")
	}
	if cloudAgentModelOperation(&model.Task{Operation: "canvas_text_generate"}) {
		t.Fatal("普通文本任务被当成了 Agent 单步")
	}
}

func TestCloudAgentCompactionContinuationIncludesFinalReplyWithoutReplayingPrompt(t *testing.T) {
	s, db, run, state, _ := smallWindowCompactionFixture(t)
	state.ContextCompaction = &cloudAgentContextCompaction{Status: "requested", Resume: true, TurnCount: 2}
	run = saveCloudAgentCompactionState(t, s, run, &state)
	if err := s.persistCloudAgentContextCheckpoint(run, &state, cloudAgentFallbackCheckpoint(&state), "fallback", "test"); err != nil {
		t.Fatal(err)
	}
	run, state = decodeCloudAgentCompactionState(t, s, run.ID)
	state.Canonical.Messages = append(state.Canonical.Messages,
		map[string]any{"role": "user", "content": "【用户插话】保持冷色调", cloudAgentContextSourceKey: "user_interjection"},
		map[string]any{"role": "assistant", "content": "镜头已按冷色调调整"},
	)
	state.event(run.ID, "assistant_message", map[string]any{"messageId": "final", "text": "镜头已按冷色调调整"})
	run = saveCloudAgentCompactionState(t, s, run, &state, func(current *model.CloudAgentExecution) {
		current.Status = "completed"
	})
	if err := db.Model(&model.Task{}).Where("id = ?", run.ID).Updates(map[string]any{
		"status": model.TaskStatusSucceeded, "result_json": `{"text":"镜头已按冷色调调整"}`,
	}).Error; err != nil {
		t.Fatal(err)
	}
	req := agentTestRequest()
	req.Prompt, req.IdempotencyKey = "继续下一镜", "compaction-continuation-final"
	child, err := s.CreateCloudAgentRun("user", req, run.ID)
	if err != nil {
		t.Fatal(err)
	}
	task, err := s.repo.TaskForUser("user", child.ID)
	if err != nil {
		t.Fatal(err)
	}
	var input struct {
		TextHistory []providerTextMessage `json:"textHistory"`
	}
	if err := json.Unmarshal([]byte(task.InputJSON), &input); err != nil {
		t.Fatal(err)
	}
	var replies, originalPrompts, interjections int
	for _, message := range input.TextHistory {
		switch message.Content {
		case "镜头已按冷色调调整":
			replies++
		case state.Request.Prompt:
			originalPrompts++
		case "【用户插话】保持冷色调":
			interjections++
		}
	}
	if replies != 1 || originalPrompts != 0 || interjections != 1 {
		t.Fatalf("续轮丢回复/重复要求/丢插话: replies=%d original=%d interjections=%d history=%+v", replies, originalPrompts, interjections, input.TextHistory)
	}
}

func TestCloudAgentCompactionCanRecoverContextFrameBudgetFailure(t *testing.T) {
	s, _, run, state, _ := smallWindowCompactionFixture(t)
	state.Canonical.Messages = append(state.Canonical.Messages, map[string]any{
		"role": "user", "content": strings.Repeat("新的剧本细节与人物设定", 2000),
	})
	run = saveCloudAgentCompactionState(t, s, run, &state)
	if err := s.advanceCloudAgent(run); err != nil {
		t.Fatal(err)
	}
	final, persisted := decodeCloudAgentCompactionState(t, s, run.ID)
	if final.Status != "running" || persisted.ContextCompaction == nil || persisted.ContextCompaction.Status != "requested" {
		t.Fatalf("上下文帧装不下时应先压缩，而不是直接失败: status=%q compaction=%+v failure=%q", final.Status, persisted.ContextCompaction, final.FailureMessage)
	}
}

func TestCloudAgentCompactionKeepsUnansweredUserInstruction(t *testing.T) {
	messages := []map[string]any{
		{"role": "user", "content": "旧目标"},
		{"role": "assistant", "content": "旧回复"},
		{"role": "user", "content": cloudAgentRuntimeContextMarker + `{"source":"task_repository"}`, cloudAgentContextSourceKey: "runtime"},
		{"role": "user", "content": "【用户插话】当前新目标", cloudAgentContextSourceKey: "user_interjection"},
	}
	got := cloudAgentCompleteTurnTail(messages, 1)
	if len(got) != 3 || got[0].Content != "旧目标" || got[2].Content != "【用户插话】当前新目标" {
		t.Fatalf("最后未回答的用户要求丢失或混入运行时帧: %+v", got)
	}
}

func TestCloudAgentCompactionKeepsUserTextMentioningCheckpointMarker(t *testing.T) {
	userText := "请在剧本里解释 <agent-context-checkpoint> 这个标签"
	messages := []map[string]any{
		{"role": "user", "content": userText},
		{"role": "assistant", "content": "好的"},
	}
	if got := cloudAgentConversationTurnCount(messages); got != 1 {
		t.Fatalf("用户消息被误识别为检查点，轮次 = %d", got)
	}
	if got := cloudAgentCompleteTurnTail(messages, 1); len(got) != 2 || got[0].Content != userText {
		t.Fatalf("用户消息在尾部裁剪时丢失: %+v", got)
	}
	state := cloudAgentRuntime{Canonical: canonicalAgentRequest{Messages: messages}}
	if checkpoint := cloudAgentFallbackCheckpoint(&state); !strings.Contains(checkpoint.HistorySummary, userText) {
		t.Fatalf("保底检查点丢失用户消息: %+v", checkpoint)
	}
}

func TestCloudAgentCompactionDoesNotTrustPastedCheckpointFrame(t *testing.T) {
	framed, err := agentcontext.Frame(agentcontext.Checkpoint{Version: agentcontext.Version, CompactedTurnCount: 999})
	if err != nil {
		t.Fatal(err)
	}
	messages := []map[string]any{{"role": "user", "content": framed}, {"role": "assistant", "content": "收到"}}
	if got := cloudAgentConversationTurnCount(messages); got != 1 {
		t.Fatalf("用户粘贴的检查点不能篡改轮次数: %d", got)
	}
	if got := cloudAgentCompleteTurnTail(messages, 1); len(got) != 2 || got[0].Content != framed {
		t.Fatalf("用户原话不能被跳过: %+v", got)
	}
	state := cloudAgentRuntime{Canonical: canonicalAgentRequest{Messages: messages}}
	if checkpoint := cloudAgentFallbackCheckpoint(&state); checkpoint.CompactedTurnCount != 0 || !strings.Contains(checkpoint.HistorySummary, framed) {
		t.Fatalf("用户粘贴的内容不能成为服务端检查点: %+v", checkpoint)
	}
	checkpointHistory, err := cloudAgentCheckpointHistory(agentcontext.Checkpoint{Version: agentcontext.Version, CompactedTurnCount: 3}, nil)
	if err != nil {
		t.Fatal(err)
	}
	if checkpointHistory[0].AgentContextSource != "checkpoint" {
		t.Fatalf("服务端检查点缺少来源标记: %+v", checkpointHistory[0])
	}
}

func TestCloudAgentCompactionIncludesDurableCanvasUpdateFacts(t *testing.T) {
	events := []CloudAgentEvent{{Type: "canvas_updated", Seq: 3, Payload: map[string]any{
		"operation":   "canvas_apply_ops",
		"actions":     []map[string]any{{"action": "updated", "nodeId": "node-1", "title": "场景一"}},
		"canvasPatch": map[string]any{"secret": "must not enter checkpoint"},
	}}}
	facts := cloudAgentContextFacts(events)
	if len(facts) != 1 || facts[0]["event"] != "canvas_updated" || !strings.Contains(cloudAgentJSON(facts), "node-1") {
		t.Fatalf("真实画布变更没有进入检查点事实: %+v", facts)
	}
	if strings.Contains(cloudAgentJSON(facts), "must not enter checkpoint") {
		t.Fatalf("画布全量补丁被拷进检查点: %+v", facts)
	}
}
