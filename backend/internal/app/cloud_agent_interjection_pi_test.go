package app

// Pi 运行时路径的插话送达与退回测试。见 cloud_agent_interjection_pi.go。
import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"
	"time"

	"gorm.io/gorm"
	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"
)

// interjectionPiRoot 建立 Pi 模式的运行（root 任务不占活动任务位，插话送达发生在 /model 桥）。
func interjectionPiRoot(t *testing.T) (*Service, *gorm.DB, *CloudAgentRun) {
	t.Helper()
	s, db, _, _ := creationTestService(t)
	s.legacyCloudAgentRootTask = false
	if err := db.Create(&model.CanvasProject{ID: "agent-canvas", UserID: "user", PayloadJSON: `{"nodes":[]}`}).Error; err != nil {
		t.Fatal(err)
	}
	root, err := s.CreateCloudAgentRun("user", agentTestRequest(), "")
	if err != nil {
		t.Fatal(err)
	}
	return s, db, root
}

// interjectionApprovalRun 把运行摆进等待审批状态：挂起的工具调用与审批一一对应
// （检查点校验要求 Approval.Call 与 Calls[CallIndex] 一致）。
func interjectionApprovalRun(t *testing.T, s *Service, db *gorm.DB, run *model.CloudAgentExecution, state *cloudAgentRuntime) {
	t.Helper()
	call := cloudAgentCall{ID: "call-1"}
	call.Function.Name = "generate_media"
	call.Function.Arguments = "{}"
	run.Status = "waiting_approval"
	state.Calls = []cloudAgentCall{call}
	state.CallIndex = 0
	state.Approval = &cloudAgentApproval{ID: "ap-1", Call: call}
	if state.Decisions == nil {
		state.Decisions = map[string]string{}
	}
	interjectionSaveState(t, s, db, run, state)
}

// interjectionModelPayload 组装运行时风格的 /model 请求（conversation）。
func interjectionModelPayload(t *testing.T, messages []map[string]any) map[string]json.RawMessage {
	t.Helper()
	encoded, err := json.Marshal(messages)
	if err != nil {
		t.Fatal(err)
	}
	return map[string]json.RawMessage{
		"modelId":       json.RawMessage(`"text-test"`),
		"purpose":       json.RawMessage(`"conversation"`),
		"messages":      encoded,
		"thinkingLevel": json.RawMessage(`"off"`),
	}
}

// interjectionModelStep 桥接一次模型步：等待步任务入队（跳过建轮时的活动任务）、
// 把任务改成给定结果、等待桥返回。
func interjectionModelStep(t *testing.T, s *Service, db *gorm.DB, userID, runID string, messages []map[string]any, resultJSON string) map[string]any {
	t.Helper()
	stored, err := s.repo.CloudAgent(userID, runID)
	if err != nil {
		t.Fatal(err)
	}
	initialState, err := cloudAgentDecode(stored)
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	type outcome struct {
		result any
		err    error
	}
	done := make(chan outcome, 1)
	go func() {
		result, stepErr := s.cloudAgentPiModel(ctx, userID, runID, interjectionModelPayload(t, messages))
		done <- outcome{result: result, err: stepErr}
	}()
	var taskID string
	deadline := time.Now().Add(10 * time.Second)
	for time.Now().Before(deadline) {
		stored, readErr := s.repo.CloudAgent(userID, runID)
		if readErr != nil {
			t.Fatal(readErr)
		}
		state, decodeErr := cloudAgentDecode(stored)
		if decodeErr != nil {
			t.Fatal(decodeErr)
		}
		if state.ActiveTaskID != "" && state.ActiveTaskID != initialState.ActiveTaskID {
			taskID = state.ActiveTaskID
			break
		}
		select {
		case got := <-done:
			t.Fatalf("model bridge returned before scheduling: result=%v err=%v", got.result, got.err)
		case <-time.After(25 * time.Millisecond):
		}
	}
	if taskID == "" {
		t.Fatal("model step was never scheduled")
	}
	if err := db.Model(&model.Task{}).Where("id = ?", taskID).Updates(map[string]any{
		"status": model.TaskStatusSucceeded, "result_json": resultJSON,
	}).Error; err != nil {
		t.Fatal(err)
	}
	select {
	case got := <-done:
		if got.err != nil {
			t.Fatalf("model bridge failed: %v", got.err)
		}
		result, _ := got.result.(map[string]any)
		if result == nil {
			t.Fatalf("unexpected bridge result: %#v", got.result)
		}
		return result
	case <-ctx.Done():
		t.Fatal("model bridge did not return")
	}
	return nil
}

// interjectionSteerTexts 取响应里的 steer 正文（Go 内直接组装，是 []string）。
func interjectionSteerTexts(result map[string]any) []string {
	texts, _ := result["steeringMessages"].([]string)
	return texts
}

// interjectionSaveState 用生产同款 CAS 路径落库改过的运行态（直接 db.Save 会把
// Transcript 关联行追加而不是替换，污染下一次 decode 的 canonical）。
func interjectionSaveState(t *testing.T, s *Service, db *gorm.DB, run *model.CloudAgentExecution, state *cloudAgentRuntime) {
	t.Helper()
	if err := s.repo.MutateCloudAgent(run.UserID, run.ID, run.Revision, func(current *model.CloudAgentExecution, _ *repository.Repository) error {
		current.Status = run.Status
		return cloudAgentSave(current, state)
	}); err != nil {
		t.Fatal(err)
	}
}

// 运行中插话在下一次 /model 出队：进入本次请求的 canonical（带来源标记）、
// 发 delivered 事件、响应携带 steeringMessages 交给运行时 session.steer。
func TestCloudAgentPiInterjectionReachesModelRequest(t *testing.T) {
	s, db, root := interjectionPiRoot(t)
	if _, err := s.InterjectCloudAgent("user", root.ID, "msg-1", "改成 16:9"); err != nil {
		t.Fatal(err)
	}
	messages := []map[string]any{{"role": "user", "content": []any{map[string]any{"type": "text", "text": "继续"}}}}
	result := interjectionModelStep(t, s, db, "user", root.ID, messages, `{"text":"好的","toolCalls":[]}`)

	steered := interjectionSteerTexts(result)
	if len(steered) != 1 || steered[0] != "【用户插话】改成 16:9" {
		t.Fatalf("响应没有携带 steer 正文: %#v", result["steeringMessages"])
	}
	_, state := agentInterjectionState(t, s, root.ID)
	if len(state.PendingInterjections) != 0 {
		t.Fatalf("插话已送达却没有出队: %+v", state.PendingInterjections)
	}
	if !agentHasEvent(state, "user_interjection_delivered") {
		t.Fatal("送达时没有发 user_interjection_delivered 事件")
	}
	if len(state.InterjectionIDs) == 0 || state.InterjectionIDs[0] != "msg-1" {
		t.Fatalf("送达没有记住插话 id: %#v", state.InterjectionIDs)
	}
	// 最关键的一条：插话必须出现在真正发给模型的输入里，并带来源标记。
	var task model.Task
	last := state.TaskIDs[len(state.TaskIDs)-1]
	if err := db.First(&task, "id = ?", last).Error; err != nil {
		t.Fatal(err)
	}
	var input struct {
		AgentRequests struct {
			Canonical struct {
				Messages []map[string]any `json:"messages"`
			} `json:"canonical"`
		} `json:"agentRequests"`
	}
	if err := json.Unmarshal([]byte(task.InputJSON), &input); err != nil {
		t.Fatal(err)
	}
	delivered := false
	for _, message := range input.AgentRequests.Canonical.Messages {
		content, _ := message["content"].(string)
		if message["role"] == "user" && strings.Contains(content, "改成 16:9") {
			delivered = true
			if message[cloudAgentContextSourceKey] != "user_interjection" {
				t.Fatalf("送达进 canonical 的插话缺少来源标记: %#v", message)
			}
		}
	}
	if !delivered {
		t.Fatalf("插话没有进入模型请求的输入: %s", task.InputJSON)
	}
}

// 等审批期间入队的插话，在恢复后的第一次 /model 送达（模型这一步就能看到，
// 不用等 steer 在下一轮生效）。
func TestCloudAgentPiInterjectionQueuedDuringApprovalDeliversOnResume(t *testing.T) {
	s, db, root := interjectionPiRoot(t)
	run, state := agentInterjectionState(t, s, root.ID)
	interjectionApprovalRun(t, s, db, run, &state)
	if _, err := s.InterjectCloudAgent("user", root.ID, "msg-approval", "批准后按新要求来"); err != nil {
		t.Fatal(err)
	}
	// 审批批准、被暂停的工具执行完毕后的状态：审批已清、回到 running。
	// （真实链路里 advanceCloudAgentTool 执行工具时清理审批，之后才恢复会话。）
	run, state = agentInterjectionState(t, s, root.ID)
	run.Status = "running"
	state.Approval = nil
	state.Calls = nil
	state.CallIndex = 0
	interjectionSaveState(t, s, db, run, &state)
	messages := []map[string]any{{"role": "user", "content": []any{map[string]any{"type": "text", "text": "继续"}}}}
	interjectionModelStep(t, s, db, "user", root.ID, messages, `{"text":"好的","toolCalls":[]}`)
	_, state = agentInterjectionState(t, s, root.ID)
	if len(state.PendingInterjections) != 0 {
		t.Fatal("恢复后的第一步没有送达等审批时的插话")
	}
	if !agentHasEvent(state, "user_interjection_delivered") {
		t.Fatal("恢复送达没有发 user_interjection_delivered 事件")
	}
}

// 已送达插话经过运行时投影回写后来源标记被洗掉：下一步模型步按指纹补回，
// 且插话在两份历史之间不重复（长度相等时采用运行时投影，插话只出现一次）。
func TestCloudAgentPiInterjectionMarkerSurvivesRuntimeProjection(t *testing.T) {
	s, db, root := interjectionPiRoot(t)
	if _, err := s.InterjectCloudAgent("user", root.ID, "msg-1", "改成 16:9"); err != nil {
		t.Fatal(err)
	}
	first := []map[string]any{{"role": "user", "content": []any{map[string]any{"type": "text", "text": "继续"}}}}
	interjectionModelStep(t, s, db, "user", root.ID, first, `{"text":"好的","toolCalls":[]}`)
	_, state := agentInterjectionState(t, s, root.ID)
	if len(state.Canonical.Messages) == 0 || stringField(state.Canonical.Messages[len(state.Canonical.Messages)-1], "role") != "assistant" {
		t.Fatalf("这一步的助手回复没有落检查点: %+v", state.Canonical.Messages)
	}
	// 下一拍的运行时会话：插话（steer 落盘）排在助手回复之后，且不带标记。
	second := []map[string]any{
		{"role": "user", "content": []any{map[string]any{"type": "text", "text": "继续"}}},
		{"role": "assistant", "content": []any{map[string]any{"type": "text", "text": "好的"}}},
		{"role": "user", "content": []any{map[string]any{"type": "text", "text": "【用户插话】改成 16:9"}}},
	}
	result := interjectionModelStep(t, s, db, "user", root.ID, second, `{"text":"收到","toolCalls":[]}`)
	if len(interjectionSteerTexts(result)) != 0 {
		t.Fatalf("队列已空却再次返回 steer 正文: %#v", result["steeringMessages"])
	}
	_, state = agentInterjectionState(t, s, root.ID)
	var task model.Task
	last := state.TaskIDs[len(state.TaskIDs)-1]
	if err := db.First(&task, "id = ?", last).Error; err != nil {
		t.Fatal(err)
	}
	if got := strings.Count(task.InputJSON, "改成 16:9"); got != 1 {
		t.Fatalf("插话在两份历史之间重复或丢失: count=%d input=%s", got, task.InputJSON)
	}
	marked := false
	for _, message := range state.Canonical.Messages {
		content, _ := message["content"].(string)
		if strings.Contains(content, "改成 16:9") && message[cloudAgentContextSourceKey] == "user_interjection" {
			marked = true
		}
	}
	if !marked {
		t.Fatalf("运行时投影回写后插话标记没有被补回: %+v", state.Canonical.Messages)
	}
}

// 运行自然结束但队列里还有插话：预算够就作为续跑提示词再走一步（不标记完成）。
func TestCloudAgentPiInterjectionResumesAfterFinalAnswer(t *testing.T) {
	s, db, root := interjectionPiRoot(t)
	run, state := agentInterjectionState(t, s, root.ID)
	run.Status = "running"
	state.Request.Budget.MaxSteps = 3
	state.Step = 1
	state.PiAssistantResponses = 1
	state.Canonical.Messages = []map[string]any{
		{"role": "user", "content": "分析剧情"},
		{"role": "assistant", "content": "好的"},
	}
	interjectionSaveState(t, s, db, run, &state)
	if _, err := s.InterjectCloudAgent("user", root.ID, "msg-late", "补一句：加字幕"); err != nil {
		t.Fatal(err)
	}
	if err := s.completeCloudAgentPiRun("user", root.ID); err != nil {
		t.Fatal(err)
	}
	run, state = agentInterjectionState(t, s, root.ID)
	if run.Status != "running" {
		t.Fatalf("还有未送达插话且预算富余时不应完成，实际 status=%s", run.Status)
	}
	if len(state.PendingInterjections) != 0 {
		t.Fatal("完成闸没有出队插话")
	}
	if state.PiResumePrompt != "【用户插话】补一句：加字幕" {
		t.Fatalf("插话没有被写进续跑提示词: %q", state.PiResumePrompt)
	}
	if !agentHasEvent(state, "user_interjection_delivered") {
		t.Fatal("完成闸送达没有发 user_interjection_delivered 事件")
	}
	// 续跑提示词必须被识别为插话投递：恢复会话遇到定格快照时照常跑出去。
	if !cloudAgentPiResumePromptDeliversInterjection(&state) {
		t.Fatal("恢复闸没有识别插话续跑提示词")
	}
}

// 步数已尽时插话退回、运行照常完成。
func TestCloudAgentPiInterjectionDroppedWhenStepBudgetExhausted(t *testing.T) {
	s, db, root := interjectionPiRoot(t)
	run, state := agentInterjectionState(t, s, root.ID)
	run.Status = "running"
	state.Request.Budget.MaxSteps = 1
	state.Step = 1
	state.PiAssistantResponses = 1
	state.Canonical.Messages = []map[string]any{
		{"role": "user", "content": "分析剧情"},
		{"role": "assistant", "content": "好的"},
	}
	interjectionSaveState(t, s, db, run, &state)
	if _, err := s.InterjectCloudAgent("user", root.ID, "msg-late", "补一句：加字幕"); err != nil {
		t.Fatal(err)
	}
	if err := s.completeCloudAgentPiRun("user", root.ID); err != nil {
		t.Fatal(err)
	}
	run, state = agentInterjectionState(t, s, root.ID)
	if run.Status != "completed" {
		t.Fatalf("步数已尽时应完成收尾，实际 status=%s", run.Status)
	}
	if len(state.PendingInterjections) != 0 {
		t.Fatal("步数已尽时插话还挂在队列里")
	}
	if !agentHasEvent(state, "user_interjection_dropped") {
		t.Fatal("步数已尽时没有发 user_interjection_dropped 事件")
	}
}

// 插话 steer 续步撞上步数上限：模型已带着插话给出最终回答，收尾为 completed
// 并退回剩余插话，而不是把整轮判失败；停在工具结果上的普通步数耗尽不受影响。
func TestCloudAgentPiSteeredContinuationCompletesAtFinalAnswer(t *testing.T) {
	s, db, root := interjectionPiRoot(t)
	run, state := agentInterjectionState(t, s, root.ID)
	run.Status = "running"
	state.Request.Budget.MaxSteps = 1
	state.Step = 1
	state.PiAssistantResponses = 1
	state.Canonical.Messages = []map[string]any{
		{"role": "user", "content": "分析剧情"},
		{"role": "assistant", "content": "好的"},
	}
	interjectionSaveState(t, s, db, run, &state)
	if _, err := s.InterjectCloudAgent("user", root.ID, "msg-late", "补一句"); err != nil {
		t.Fatal(err)
	}
	s.settleCloudAgentPiFinalAnswer("user", root.ID)
	run, state = agentInterjectionState(t, s, root.ID)
	if run.Status != "completed" {
		t.Fatalf("最终回答边界上应完成收尾，实际 status=%s", run.Status)
	}
	if len(state.PendingInterjections) != 0 || !agentHasEvent(state, "user_interjection_dropped") {
		t.Fatal("收尾时没有退回插话")
	}

	// 对照：canonical 停在工具结果上（工具批次之后想再开一步）不是最终回答边界，
	// 保持原有失败路径。
	run, state = agentInterjectionState(t, s, root.ID)
	run.Status = "running"
	state.Canonical.Messages = []map[string]any{
		{"role": "user", "content": "分析剧情"},
		{"role": "assistant", "content": "画一张", "tool_calls": []any{map[string]any{"id": "call-1"}}},
		{"role": "tool", "tool_call_id": "call-1", "content": "{}"},
	}
	interjectionSaveState(t, s, db, run, &state)
	if _, err := s.InterjectCloudAgent("user", root.ID, "msg-late-2", "补一句"); err != nil {
		t.Fatal(err)
	}
	s.settleCloudAgentPiFinalAnswer("user", root.ID)
	run, _ = agentInterjectionState(t, s, root.ID)
	if run.Status != "running" {
		t.Fatalf("工具批次后的步数耗尽不属于最终回答边界，实际 status=%s", run.Status)
	}
}

// 运行失败、被取消、审批被拒时，队列里的插话全部退回。
func TestCloudAgentPiInterjectionsDroppedOnTerminalPaths(t *testing.T) {
	t.Run("failed", func(t *testing.T) {
		s, _, root := interjectionPiRoot(t)
		if _, err := s.InterjectCloudAgent("user", root.ID, "msg-f", "还在吗"); err != nil {
			t.Fatal(err)
		}
		s.failPiRunner(root.ID, "user", errors.New("模型调用失败"))
		run, state := agentInterjectionState(t, s, root.ID)
		if run.Status != "failed" || len(state.PendingInterjections) != 0 || !agentHasEvent(state, "user_interjection_dropped") {
			t.Fatalf("失败收尾没有退回插话: status=%s pending=%+v", run.Status, state.PendingInterjections)
		}
	})
	t.Run("cancelled", func(t *testing.T) {
		s, _, root := interjectionPiRoot(t)
		if _, err := s.InterjectCloudAgent("user", root.ID, "msg-c", "还在吗"); err != nil {
			t.Fatal(err)
		}
		if err := s.CancelCloudAgent(context.Background(), "user", root.ID); err != nil {
			t.Fatal(err)
		}
		run, state := agentInterjectionState(t, s, root.ID)
		if run.Status != "cancelled" || len(state.PendingInterjections) != 0 || !agentHasEvent(state, "user_interjection_dropped") {
			t.Fatalf("取消没有退回插话: status=%s pending=%+v", run.Status, state.PendingInterjections)
		}
	})
	t.Run("rejected", func(t *testing.T) {
		s, db, root := interjectionPiRoot(t)
		run, state := agentInterjectionState(t, s, root.ID)
		interjectionApprovalRun(t, s, db, run, &state)
		if _, err := s.InterjectCloudAgent("user", root.ID, "msg-r", "还在吗"); err != nil {
			t.Fatal(err)
		}
		if err := s.DecideCloudAgentApproval("user", root.ID, "ap-1", "reject", "不要生成"); err != nil {
			t.Fatal(err)
		}
		run, state = agentInterjectionState(t, s, root.ID)
		if run.Status != "rejected" || len(state.PendingInterjections) != 0 || !agentHasEvent(state, "user_interjection_dropped") {
			t.Fatalf("拒绝审批没有退回插话: status=%s pending=%+v", run.Status, state.PendingInterjections)
		}
	})
}

// 同一 messageId 重复提交不会送达两次：已送达的 id 被记住，重发直接短路。
func TestCloudAgentPiInterjectionRedeliveryIsIdempotent(t *testing.T) {
	s, db, root := interjectionPiRoot(t)
	if _, err := s.InterjectCloudAgent("user", root.ID, "msg-1", "改成 16:9"); err != nil {
		t.Fatal(err)
	}
	messages := []map[string]any{{"role": "user", "content": []any{map[string]any{"type": "text", "text": "继续"}}}}
	interjectionModelStep(t, s, db, "user", root.ID, messages, `{"text":"好的","toolCalls":[]}`)
	count, err := s.InterjectCloudAgent("user", root.ID, "msg-1", "改成 16:9")
	if err != nil {
		t.Fatal(err)
	}
	if count != 0 {
		t.Fatalf("已送达的插话被重新入队: pending=%d", count)
	}
	_, state := agentInterjectionState(t, s, root.ID)
	if len(state.PendingInterjections) != 0 {
		t.Fatal("重复提交把插话又放回了队列")
	}
	delivered := 0
	for _, event := range state.Events {
		if event.Type == "user_interjection_delivered" {
			delivered++
		}
	}
	if delivered != 1 {
		t.Fatalf("delivered 事件出现 %d 次，应当只有 1 次", delivered)
	}
}

// 完成闸一次带走多条插话时，合并后的续跑提示词也必须被恢复闸识别；
// 否则它会被当成遗留提示词清空，已标记送达的插话到不了模型。
func TestCloudAgentPiInterjectionResumePromptRecognisedForSeveralInterjections(t *testing.T) {
	s, db, root := interjectionPiRoot(t)
	run, state := agentInterjectionState(t, s, root.ID)
	run.Status = "running"
	state.Request.Budget.MaxSteps = 3
	state.Step = 1
	state.PiAssistantResponses = 1
	state.Canonical.Messages = []map[string]any{
		{"role": "user", "content": "分析剧情"},
		{"role": "assistant", "content": "好的"},
	}
	interjectionSaveState(t, s, db, run, &state)
	for id, text := range map[string]string{"msg-late-1": "加字幕", "msg-late-2": "再配个背景音乐"} {
		if _, err := s.InterjectCloudAgent("user", root.ID, id, text); err != nil {
			t.Fatal(err)
		}
	}
	if err := s.completeCloudAgentPiRun("user", root.ID); err != nil {
		t.Fatal(err)
	}
	run, state = agentInterjectionState(t, s, root.ID)
	if run.Status != "running" || len(state.PendingInterjections) != 0 {
		t.Fatalf("status=%s pending=%d", run.Status, len(state.PendingInterjections))
	}
	if !strings.Contains(state.PiResumePrompt, "加字幕") || !strings.Contains(state.PiResumePrompt, "再配个背景音乐") {
		t.Fatalf("续跑提示词缺少插话: %q", state.PiResumePrompt)
	}
	if !cloudAgentPiResumePromptDeliversInterjection(&state) {
		t.Fatal("恢复闸没有识别多条插话合并后的续跑提示词")
	}
}
