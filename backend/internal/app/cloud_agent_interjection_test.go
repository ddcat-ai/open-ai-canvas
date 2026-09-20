package app

// 自研（2026-09-17）：运行中插话。见 cloud_agent_interjection.go。
import (
	"strings"
	"testing"

	"infinite-canvas/backend/internal/model"
)

// agentInterjectionState 取回并解码某个运行的运行态。
func agentInterjectionState(t *testing.T, s *Service, id string) (*model.CloudAgentExecution, cloudAgentRuntime) {
	t.Helper()
	run, err := s.repo.CloudAgent("user", id)
	if err != nil {
		t.Fatal(err)
	}
	state, err := cloudAgentDecode(run)
	if err != nil {
		t.Fatal(err)
	}
	return run, state
}

// 插话必须在**下一次模型调用**里真的被送到 —— 这是整个功能的验收点：
// 只入队不算数，要能在发给模型的那份 canonical 里找到原文。
func TestCloudAgentInterjectionReachesNextModelRequest(t *testing.T) {
	s, db, root := reliableAgentRoot(t)
	if _, err := s.InterjectCloudAgent("user", root.ID, "msg-1", "先别生成视频，改成 16:9"); err != nil {
		t.Fatal(err)
	}
	run, state := agentInterjectionState(t, s, root.ID)
	if len(state.PendingInterjections) != 1 {
		t.Fatalf("插话没有入队: %+v", state.PendingInterjections)
	}
	if !agentHasEvent(state, "user_interjection") {
		t.Fatal("入队时没有发 user_interjection 事件（前端时间线看不到自己的话）")
	}
	// 让首个模型任务以「没有工具调用」结束 —— 这正是最容易丢插话的形态：
	// 模型自认为答完了，而同一条路径的默认行为是**收尾本轮**。
	if err := db.Model(&model.Task{}).Where("id = ?", root.ID).Updates(map[string]any{
		"status": model.TaskStatusSucceeded, "result_json": `{"text":"好的"}`,
	}).Error; err != nil {
		t.Fatal(err)
	}
	if err := s.advanceCloudAgentByID("user", root.ID); err != nil {
		t.Fatal(err)
	}
	run, state = agentInterjectionState(t, s, root.ID)
	if run.Status != "running" {
		t.Fatalf("有未送达插话时不该收尾，实际 status=%s", run.Status)
	}
	if len(state.PendingInterjections) != 1 {
		t.Fatal("插话在收尾闸处被吞掉了")
	}
	// 下一拍：游标已空 → 应当先把插话注入，再发新的模型任务。
	if err := s.advanceCloudAgentByID("user", root.ID); err != nil {
		t.Fatal(err)
	}
	run, state = agentInterjectionState(t, s, root.ID)
	if len(state.PendingInterjections) != 0 {
		t.Fatal("插话已送达却没有出队")
	}
	if !agentHasEvent(state, "user_interjection_delivered") {
		t.Fatal("送达时没有发 user_interjection_delivered 事件")
	}
	var delivered bool
	for _, message := range state.Canonical.Messages {
		content, _ := message["content"].(string)
		if strings.Contains(content, "先别生成视频，改成 16:9") && message["role"] == "user" {
			delivered = true
		}
	}
	if !delivered {
		t.Fatalf("插话没有进入本轮的对话：%+v", state.Canonical.Messages)
	}
	// 最关键的一条：它必须出现在**真正发给模型**的那份输入里。
	last := state.TaskIDs[len(state.TaskIDs)-1]
	var task model.Task
	if err := db.First(&task, "id = ?", last).Error; err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(task.InputJSON, "先别生成视频，改成 16:9") {
		t.Fatalf("插话没有进入模型请求的输入: %s", task.InputJSON)
	}
}

// 步数/预算已经把下一次模型调用用光时，插话送不出去 —— 必须如实退回，
// 不能静默吞掉，也不能替用户自动开新一轮（那是用户没点过的扣费）。
func TestCloudAgentInterjectionDroppedWhenNoStepLeft(t *testing.T) {
	s, db, root := reliableAgentRoot(t)
	run, state := agentInterjectionState(t, s, root.ID)
	state.Request.Budget.MaxSteps = 1
	if err := cloudAgentSave(run, &state); err != nil {
		t.Fatal(err)
	}
	if err := db.Save(run).Error; err != nil {
		t.Fatal(err)
	}
	if _, err := s.InterjectCloudAgent("user", root.ID, "msg-budget", "改一下方向"); err != nil {
		t.Fatal(err)
	}
	if err := db.Model(&model.Task{}).Where("id = ?", root.ID).Updates(map[string]any{
		"status": model.TaskStatusSucceeded, "result_json": `{"text":"好的"}`,
	}).Error; err != nil {
		t.Fatal(err)
	}
	if err := s.advanceCloudAgentByID("user", root.ID); err != nil {
		t.Fatal(err)
	}
	run, state = agentInterjectionState(t, s, root.ID)
	if len(state.PendingInterjections) != 0 {
		t.Fatal("开不起下一步了，插话却还挂在队列里")
	}
	if !agentHasEvent(state, "user_interjection_dropped") {
		t.Fatal("插话被静默吞掉了：没有 user_interjection_dropped 事件")
	}
	// 退回不等于放行：不能因为插话又把这一轮续起来（那会突破步数上限）。
	if run.Status == "running" {
		t.Fatal("步数已满却因为插话继续开步")
	}
}

// 同一 messageId 重发（网络重试 / 用户连点）只能入队一次。
func TestCloudAgentInterjectionIsIdempotentByMessageID(t *testing.T) {
	s, _, root := reliableAgentRoot(t)
	first, err := s.InterjectCloudAgent("user", root.ID, "msg-same", "同一句话")
	if err != nil {
		t.Fatal(err)
	}
	second, err := s.InterjectCloudAgent("user", root.ID, "msg-same", "同一句话")
	if err != nil {
		t.Fatal(err)
	}
	if first != 1 || second != 1 {
		t.Fatalf("重试把同一条插话入队了两次: first=%d second=%d", first, second)
	}
	_, state := agentInterjectionState(t, s, root.ID)
	if len(state.PendingInterjections) != 1 {
		t.Fatalf("队列里应当只有一条: %+v", state.PendingInterjections)
	}
}

// 运行已经结束就不再收插话 —— 前端据此回落成「新一轮」。
func TestCloudAgentInterjectionRejectedOnFinishedRun(t *testing.T) {
	s, db, root := reliableAgentRoot(t)
	if err := db.Model(&model.CloudAgentExecution{}).Where("id = ?", root.ID).Update("status", "completed").Error; err != nil {
		t.Fatal(err)
	}
	if _, err := s.InterjectCloudAgent("user", root.ID, "msg-done", "太晚了"); err == nil {
		t.Fatal("已结束的运行仍然收下了插话")
	}
}

// 输入校验：空内容、超长、坏 id 一律拒绝（服务端不能只靠 handler 早筛）。
func TestCloudAgentInterjectionValidation(t *testing.T) {
	s, _, root := reliableAgentRoot(t)
	if _, err := s.InterjectCloudAgent("user", root.ID, "msg-empty", "   "); err == nil {
		t.Fatal("空插话被接受了")
	}
	if _, err := s.InterjectCloudAgent("user", root.ID, "msg-long", strings.Repeat("字", cloudAgentInterjectionMaxRunes+1)); err == nil {
		t.Fatal("超长插话被接受了")
	}
	if _, err := s.InterjectCloudAgent("user", root.ID, "", "没有 id"); err == nil {
		t.Fatal("缺 messageId 被接受了")
	}
	if _, err := s.InterjectCloudAgent("someone-else", root.ID, "msg-other", "别人的运行"); err == nil {
		t.Fatal("别人的运行被插话了")
	}
}

func agentHasEvent(state cloudAgentRuntime, kind string) bool {
	for _, event := range state.Events {
		if event.Type == kind {
			return true
		}
	}
	return false
}
