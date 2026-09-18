package app

import (
	"errors"
	"strings"
	"time"
	"unicode/utf8"

	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/repository"
)

// 自研（2026-09-17）：运行中插话。
//
// 用户的诉求：Agent 一旦跑起来输入框就锁死，连「方向不对，别做这个」都说不出口。
// 更糟的是这条限制被写进了协议 —— 策略提示词要求模型「不要在回复正文里提问，运行中用户
// 无法打字」，于是模型拿不准时只能中途收尾弹选项卡，一轮就断在那里。
//
// 设计（2026-09-17 用户拍板）：
//   - **下一步生效**：不打断正在飞的模型调用 / 工具调用 / 已计费的媒体任务。
//     模型下一次开口前，插话作为一条 user 消息注入 —— 与既有「催办」同一通路
//     （见 advanceCloudAgent 里往 Canonical.Messages append role:user 的几处）。
//   - **等审批时入队**：run.Status == waiting_approval 时调度器本就不推进
//     （advanceCloudAgent 开头的状态闸），插话自然排在审批结论之后送达，不改审批语义。
//   - **送不出去要说实话**：步数/预算耗尽时 emit user_interjection_dropped，
//     绝不静默吞掉，也绝不替用户自动开新一轮（那是新的扣费）。
const (
	// 单条插话的字符数上限。与 ask_user 的回答、审批理由同量级 —— 插话是"补一句话"，
	// 不是第二条提示词；真需要长文应当走新一轮。
	cloudAgentInterjectionMaxRunes = 4000
	// 已送达/已丢弃的插话 id 只记最近这些，用于重试幂等。故意做成**有界**，
	// 不随运行时长增长（一轮跑几十步也不会把状态撑大）。
	cloudAgentInterjectionIDMemory = 32
	// 乐观并发重试次数。调度器每 ~2 秒也会写同一行（advanceCloudAgents），
	// 用户点一下撞上 CAS 冲突很正常 —— 重读重试，别把"冲突"甩到用户脸上。
	cloudAgentInterjectionAttempts = 4
)

// cloudAgentInterjection 一条尚未送达的插话。
type cloudAgentInterjection struct {
	ID        string    `json:"id"`
	Text      string    `json:"text"`
	CreatedAt time.Time `json:"createdAt"`
}

// cloudAgentAcceptsInterjection 只有还在推进的运行收插话：running / queued / waiting_approval。
// 终态（completed / failed / rejected / cancelled）一律拒绝，由前端回落成新一轮发送。
func cloudAgentAcceptsInterjection(status string) bool {
	return status == "running" || status == "queued" || status == "waiting_approval"
}

// cloudAgentInterjectionSeen 幂等判据：待送队列里有，或最近送过/丢过同一个 id。
func cloudAgentInterjectionSeen(state *cloudAgentRuntime, messageID string) bool {
	if state == nil || messageID == "" {
		return false
	}
	for _, item := range state.PendingInterjections {
		if item.ID == messageID {
			return true
		}
	}
	for _, id := range state.InterjectionIDs {
		if id == messageID {
			return true
		}
	}
	return false
}

// cloudAgentRememberInterjectionID 记住一个已处理的插话 id（有界环形，超出丢最旧的）。
func cloudAgentRememberInterjectionID(state *cloudAgentRuntime, messageID string) {
	if state == nil || messageID == "" {
		return
	}
	state.InterjectionIDs = append(state.InterjectionIDs, messageID)
	if len(state.InterjectionIDs) > cloudAgentInterjectionIDMemory {
		state.InterjectionIDs = state.InterjectionIDs[len(state.InterjectionIDs)-cloudAgentInterjectionIDMemory:]
	}
}

// InterjectCloudAgent 把用户在运行中发来的一句话排进本轮，等下一次模型调用送达。
// 返回当前待送达条数（含这一条）。
func (s *Service) InterjectCloudAgent(userID, id, messageID, text string) (int, error) {
	text = strings.TrimSpace(text)
	if text == "" {
		return 0, BadAuthRequest("插话内容不能为空")
	}
	if !utf8.ValidString(text) {
		return 0, BadAuthRequest("插话内容包含无效字符")
	}
	if utf8.RuneCountInString(text) > cloudAgentInterjectionMaxRunes {
		return 0, BadAuthRequest("插话内容过长")
	}
	if strings.ContainsRune(text, 0) {
		return 0, BadAuthRequest("插话内容包含无效字符")
	}
	if messageID == "" || !utf8.ValidString(messageID) || utf8.RuneCountInString(messageID) > 160 {
		return 0, BadAuthRequest("插话标识无效")
	}
	// 归属校验：不是本人的运行在这里就要 404，不能靠下面的 CAS 兜底
	// （否则错误形态会变成"冲突"，让人以为重试就好）。
	if _, _, err := s.cloudAgentTask(userID, id); err != nil {
		return 0, err
	}
	for attempt := 0; attempt < cloudAgentInterjectionAttempts; attempt++ {
		run, err := s.repo.CloudAgent(userID, id)
		if err != nil {
			return 0, err
		}
		// 读取路径用 cloudAgentDecode：运行可能已经结束（终态不用再校验当前执行合同），
		// 我们要的是"它到底结束了没有"，而不是"能不能继续跑"。
		state, err := cloudAgentDecode(run)
		if err != nil {
			return 0, err
		}
		if cloudAgentInterjectionSeen(&state, messageID) {
			return len(state.PendingInterjections), nil
		}
		if !cloudAgentAcceptsInterjection(run.Status) {
			return 0, creationConflict("本轮已经结束，这条消息将作为新一轮发送")
		}
		err = s.repo.MutateCloudAgent(userID, id, run.Revision, func(current *model.CloudAgentExecution, _ *repository.Repository) error {
			state.PendingInterjections = append(state.PendingInterjections, cloudAgentInterjection{ID: messageID, Text: text, CreatedAt: time.Now()})
			// 立刻发一条事件：用户点了发送就该在时间线上看到自己的话，
			// 也让多标签页/多设备对齐（另一个页签靠 SSE 收到这条）。
			state.event(id, "user_interjection", map[string]any{"messageId": messageID, "text": text})
			return cloudAgentSave(current, &state)
		})
		if errors.Is(err, repository.ErrCreationConflict) {
			continue
		}
		if err != nil {
			return 0, err
		}
		return len(state.PendingInterjections), nil
	}
	return 0, creationConflict("Agent 正在写入运行状态，请重试")
}

// cloudAgentDrainInterjections 把待送插话注入本轮对话。
//
// 调用点**必须**在 cloudAgentCompactContext 之后、用 canonical 发请求之前 —— 注入早了会被
// 上下文卸载动到，注入晚了这一步的模型就看不到。返回是否有内容被注入。
func cloudAgentDrainInterjections(runID string, state *cloudAgentRuntime) bool {
	if state == nil || len(state.PendingInterjections) == 0 {
		return false
	}
	for _, item := range state.PendingInterjections {
		// 前缀是给模型看的**结构信号**：与系统催办区分开，它会按"用户中途改了要求"来对待，
		// 而不是当成自己上一句的延续。
		state.Canonical.Messages = append(state.Canonical.Messages, map[string]any{
			"role":                     "user",
			"content":                  "【用户插话】" + item.Text,
			cloudAgentContextSourceKey: "user_interjection",
		})
		state.event(runID, "user_interjection_delivered", map[string]any{"messageId": item.ID, "text": item.Text})
		cloudAgentRememberInterjectionID(state, item.ID)
	}
	state.PendingInterjections = nil
	state.ActionNudged = false
	state.Canonical.ToolChoice = "auto"
	return true
}

// cloudAgentDropInterjections 运行已无法再开一步（步数上限、预算耗尽、失败收尾）时，
// 如实把它们退回给用户，而不是静默吞掉。
//
// 刻意不自动替用户开新一轮：那会产生用户没点过的扣费。前端收到这个事件后把消息标成
// 「未送达」并给一个「作为新一轮发送」的按钮。
func cloudAgentDropInterjections(runID, reason string, state *cloudAgentRuntime) bool {
	if state == nil || len(state.PendingInterjections) == 0 {
		return false
	}
	for _, item := range state.PendingInterjections {
		state.event(runID, "user_interjection_dropped", map[string]any{"messageId": item.ID, "text": item.Text, "reason": reason})
		cloudAgentRememberInterjectionID(state, item.ID)
	}
	state.PendingInterjections = nil
	return true
}

// cloudAgentStepBudgetExhausted 当前是否还开得起下一次模型调用（与 advanceCloudAgent 里
// 步数上限那道闸同一判据：0 表示不限）。
func cloudAgentStepBudgetExhausted(state *cloudAgentRuntime) bool {
	if state == nil {
		return true
	}
	limit := cloudAgentStepLimit(state.Request)
	return limit > 0 && state.Step >= limit
}
