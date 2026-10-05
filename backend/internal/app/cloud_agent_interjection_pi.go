// Pi 运行时路径的插话送达与退回。
//
// 插话的入队、幂等与事件格式见 cloud_agent_interjection.go；送达点原本只有旧
// Go 执行循环（advanceCloudAgent 开步前 drain）。独立 Agent 运行时（Pi）接手
// 执行后调度循环不再推进，插话会一直停在待送队列里——本文件把 Pi 路径的送达
// 搬到 /model 模型步桥上：
//
//   - 出队发生在构建模型请求的 CAS 写入里（runCloudAgentModelStep）：插话追加
//     进本次请求的 canonical，模型这一步就能看到它；出队、追加与 delivered
//     事件在同一次写入落库，重试不会重复送达。
//   - 响应携带 steeringMessages，运行时逐条 session.steer：实测运行时在当前轮
//     工具执行完、下一次模型调用前把它作为 user 消息写进会话并落盘；即使模型
//     本轮没有工具调用，挂着的 steer 也会让会话再走一步，因此「最终回答时的
//     插话」由运行时自然续跑，无需服务端另开一步。
//   - 两份历史各有一份插话：下一次 /model 的 canonical 选取
//     （cloudAgentPiCanonicalForModelRequest）在长度相等时采用运行时投影，
//     插话不会重复；投影不带来源标记，转换后按已送达指纹补回。

package app

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"strings"
	"time"

	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/repository"
)

// cloudAgentInterjectionContent 插话进入对话的正文格式：前缀是给模型看的结构
// 信号——按「用户中途改了要求」对待，而不是上一句的延续。与旧循环保持一致。
func cloudAgentInterjectionContent(text string) string {
	return "【用户插话】" + text
}

func cloudAgentInterjectionDigest(content string) string {
	sum := sha256.Sum256([]byte(content))
	return hex.EncodeToString(sum[:])
}

// cloudAgentPiDeliverInterjections 把待送插话注入本轮对话（Pi 路径的送达点）。
// 必须在 runCloudAgentModelStep 的 CAS 写入里调用：出队、canonical 追加与
// delivered 事件由同一次写入落库。返回交给运行时 steer 的正文列表。
func cloudAgentPiDeliverInterjections(runID string, state *cloudAgentRuntime) []string {
	if state == nil || len(state.PendingInterjections) == 0 {
		return nil
	}
	texts := make([]string, 0, len(state.PendingInterjections))
	for _, item := range state.PendingInterjections {
		content := cloudAgentInterjectionContent(item.Text)
		state.Canonical.Messages = append(state.Canonical.Messages, map[string]any{
			"role":                     "user",
			"content":                  content,
			cloudAgentContextSourceKey: "user_interjection",
		})
		state.event(runID, "user_interjection_delivered", map[string]any{"messageId": item.ID, "text": item.Text})
		cloudAgentRememberInterjectionID(state, item.ID)
		// 指纹与插话 ID 共用同一个有界上限：只用于运行时投影后的标记补回，
		// 不承担幂等职责（那由 InterjectionIDs 负责）。
		state.DeliveredInterjectionDigests = append(state.DeliveredInterjectionDigests, cloudAgentInterjectionDigest(content))
		if len(state.DeliveredInterjectionDigests) > cloudAgentInterjectionIDMemory {
			state.DeliveredInterjectionDigests = state.DeliveredInterjectionDigests[len(state.DeliveredInterjectionDigests)-cloudAgentInterjectionIDMemory:]
		}
		texts = append(texts, content)
	}
	state.PendingInterjections = nil
	return texts
}

// cloudAgentRestoreInterjectionSources 按已送达指纹给 canonical 里的插话补回
// 来源标记。运行时投影只携带正文，每次模型步转换都会洗掉标记；跨轮续跑的
// 历史选取（cloudAgentContinuationHistory）靠标记识别插话，必须在每次转换后
// 补回。幂等：已有来源标记的消息不动。
func cloudAgentRestoreInterjectionSources(state *cloudAgentRuntime) {
	if state == nil || len(state.DeliveredInterjectionDigests) == 0 {
		return
	}
	for _, message := range state.Canonical.Messages {
		if stringField(message, "role") != "user" || stringField(message, cloudAgentContextSourceKey) != "" {
			continue
		}
		digest := cloudAgentInterjectionDigest(stringField(message, "content"))
		for _, delivered := range state.DeliveredInterjectionDigests {
			if digest == delivered {
				message[cloudAgentContextSourceKey] = "user_interjection"
				break
			}
		}
	}
}

// cloudAgentPiInterjectionResumePrompt 完成闸把待送插话合成一条续跑提示词。
// 多条插话合并后正文与任何单条的指纹都对不上，恢复闸
// （cloudAgentPiResumePromptDeliversInterjection）会把它当成遗留提示词清空，
// 已标记送达的插话就到不了模型；所以合并后的正文也记一份指纹。
func cloudAgentPiInterjectionResumePrompt(runID string, state *cloudAgentRuntime) string {
	texts := cloudAgentPiDeliverInterjections(runID, state)
	prompt := strings.Join(texts, "\n")
	if len(texts) > 1 {
		state.DeliveredInterjectionDigests = append(state.DeliveredInterjectionDigests, cloudAgentInterjectionDigest(prompt))
		if len(state.DeliveredInterjectionDigests) > cloudAgentInterjectionIDMemory {
			state.DeliveredInterjectionDigests = state.DeliveredInterjectionDigests[len(state.DeliveredInterjectionDigests)-cloudAgentInterjectionIDMemory:]
		}
	}
	return prompt
}

// cloudAgentPiResumePromptDeliversInterjection 判断恢复提示词是否为完成闸写下
// 的插话续跑（见 completeCloudAgentPiRun）。这类提示词必须真正跑出去；崩溃
// 恢复遇到的「快照已定格 + 上一次恢复遗留的提示词」才按原口径清空收尾。
func cloudAgentPiResumePromptDeliversInterjection(state *cloudAgentRuntime) bool {
	if state == nil || state.PiResumePrompt == "" || len(state.DeliveredInterjectionDigests) == 0 {
		return false
	}
	digest := cloudAgentInterjectionDigest(state.PiResumePrompt)
	for _, delivered := range state.DeliveredInterjectionDigests {
		if digest == delivered {
			return true
		}
	}
	return false
}

// cloudAgentPiRunAtFinalAnswer 运行是否停在「模型已给出最终回答」的边界：
// 没有挂起的工具批次、任务或审批，canonical 最后一条是不带工具调用的助手回复。
func cloudAgentPiRunAtFinalAnswer(state *cloudAgentRuntime) bool {
	if state == nil || state.ActiveTaskID != "" || state.MediaTaskID != "" || state.Approval != nil || state.ContextCompaction != nil {
		return false
	}
	if state.CallIndex < len(state.Calls) {
		return false
	}
	messages := state.Canonical.Messages
	if len(messages) == 0 {
		return false
	}
	last := messages[len(messages)-1]
	if stringField(last, "role") != "assistant" {
		return false
	}
	_, hasCalls := last["tool_calls"]
	return !hasCalls
}

// settleCloudAgentPiFinalAnswer 处理「最终回答之后插话 steer 续步、而步数预算
// 已在最后一步用光」的收尾：回答本身已带着插话完成，按旧循环口径收尾为
// completed 并退回剩余插话，而不是把整轮判成失败。普通步数耗尽（工具调用之后
// 想再开一步）不满足最终回答边界，保持原有失败路径。收尾后运行时以模型步失败
// 退出，failPiRunner 看到终态不会再写状态。
func (s *Service) settleCloudAgentPiFinalAnswer(userID, runID string) {
	for attempt := 0; attempt < cloudAgentInterjectionAttempts; attempt++ {
		run, err := s.repo.CloudAgent(userID, runID)
		if err != nil {
			return
		}
		state, err := cloudAgentDecode(run)
		if err != nil {
			return
		}
		if cloudAgentRunTerminal(run.Status) || run.Status == "waiting_approval" || run.Status == "waiting_user" {
			return
		}
		if !cloudAgentPiRunAtFinalAnswer(&state) {
			return
		}
		err = s.repo.MutateCloudAgent(userID, runID, run.Revision, func(current *model.CloudAgentExecution, _ *repository.Repository) error {
			if cloudAgentRunTerminal(current.Status) || current.Status == "waiting_approval" || current.Status == "waiting_user" {
				return nil
			}
			cloudAgentDropInterjections(runID, "本轮已达到模型调用上限", &state)
			current.Status = "completed"
			state.event(runID, "run_completed", map[string]any{"text": "Agent 已完成", "timestamp": time.Now().Unix()})
			return cloudAgentSave(current, &state)
		})
		if !errors.Is(err, repository.ErrCreationConflict) {
			return
		}
	}
}
