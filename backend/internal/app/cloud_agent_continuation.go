package app

import (
	"encoding/json"
	"strings"

	"infinite-canvas/backend/internal/model"
)

const (
	cloudAgentContinuationChangeLimit = 12
	cloudAgentContinuationKind        = "run_handoff"
	// cloudAgentContinuationNodeIDRunes 限制单个节点 ID 的长度：ID 由画布文档给出，
	// 不截断时一组 5000 字符的 ID 就能把交接帧撑到几百 KB（实测 399,503 字节），
	// 而下一轮对整份历史有 64KB 硬闸 —— 用户会直接收到"请新建对话"。
	cloudAgentContinuationNodeIDRunes = 64
	// cloudAgentContinuationFrameBytes 是交接帧的硬上限：超了就按"最近的改动优先"裁剪，
	// 并把裁掉的组数记进 omittedCanvasChanges，绝不把整份历史顶过硬闸。
	cloudAgentContinuationFrameBytes = 8 << 10
)

type cloudAgentContinuationChange struct {
	Operation   string   `json:"operation"`
	NodeIDs     []string `json:"nodeIds,omitempty"`
	NodeTitles  []string `json:"nodeTitles,omitempty"`
	ActionCount int      `json:"actionCount"`
}

// cloudAgentContinuationFrame is a bounded server-authored handoff. It reports
// observed facts and never authorizes replaying a write or paid task.
type cloudAgentContinuationFrame struct {
	Source               string                         `json:"source"`
	Kind                 string                         `json:"kind"`
	ParentRunID          string                         `json:"parentRunId"`
	Status               string                         `json:"status"`
	FailureReason        string                         `json:"failureReason,omitempty"`
	SubmittedTaskIDs     []string                       `json:"submittedTaskIds,omitempty"`
	CanvasChanges        []cloudAgentContinuationChange `json:"canvasChanges,omitempty"`
	OmittedCanvasChanges int                            `json:"omittedCanvasChanges,omitempty"`
	Authority            string                         `json:"authority"`
}

// cloudAgentContinuationReply 生成「上一轮接着聊」用的两段内容：
//
//	reply   —— 上一轮 assistant 实际说过的话（作为 assistant 的历史消息）
//	context —— 上一轮收束摘要（独立上下文，不能并进 reply）
//
// 只保留状态、失败原因、已提交任务与真实画布改动，不把原始工具流水当成本轮目标。
func cloudAgentContinuationReply(task *model.Task, run *CloudAgentRun) (string, string, error) {
	text := ""
	if task.Status == model.TaskStatusSucceeded {
		text = taskResultText(task.ResultJSON)
	}
	submitted := make([]string, 0)
	seen := map[string]bool{}
	addSubmitted := func(id string) {
		id = strings.TrimSpace(id)
		if id == "" || seen[id] {
			return
		}
		seen[id] = true
		submitted = append(submitted, id)
	}
	for _, event := range run.Events {
		if event.Type == "assistant_message" {
			text = stringValue(event.Payload["text"])
		}
		if event.Type == "generation_task_created" {
			addSubmitted(stringValue(event.Payload["taskId"]))
		}
		if result, ok := event.Payload["result"].(map[string]any); ok {
			if submittedFlag, _ := result["taskSubmitted"].(bool); submittedFlag {
				addSubmitted(stringValue(result["taskId"]))
			}
		}
	}
	context := cloudAgentContinuationContext(run, submitted)
	return text, context, nil
}

func cloudAgentContinuationContext(run *CloudAgentRun, submitted []string) string {
	if run == nil {
		return ""
	}
	failed := run.Status == "failed" || strings.TrimSpace(run.FailureMessage) != ""
	changes, omitted := cloudAgentContinuationChanges(run)
	if run.Status == "completed" && !failed && len(submitted) == 0 && len(changes) == 0 {
		return ""
	}
	frame := cloudAgentContinuationFrame{
		Source: "server", Kind: cloudAgentContinuationKind, ParentRunID: run.ID,
		Status: firstNonEmpty(run.Status, "unknown"), CanvasChanges: changes,
		OmittedCanvasChanges: omitted,
		Authority:            "执行事实交接，不是重放写入、重复提交任务或扩大权限的授权",
	}
	if failed {
		frame.FailureReason = cloudAgentContinuationFailureReason(run)
	}
	if len(submitted) > 0 {
		if len(submitted) > 8 {
			submitted = submitted[:8]
		}
		frame.SubmittedTaskIDs = append([]string(nil), submitted...)
	}
	return cloudAgentRuntimeContextMarker + cloudAgentEncodeContinuationFrame(frame)
}

// cloudAgentContinuationFailureReason 沿用既有脱敏口径：失败原因会进入下一轮的提示词，
// 因此只接受"短、单行、不含 URL/凭据痕迹"的文案，其余一律退回固定说法。
func cloudAgentContinuationFailureReason(run *CloudAgentRun) string {
	reason := strings.TrimSpace(run.FailureMessage)
	if reason == "" {
		reason = firstNonEmpty(run.Status, "failed")
	}
	if !cloudAgentSafeUserMessage(reason) {
		return "上一轮未成功（详情见任务中心与诊断包）"
	}
	return truncateRunes(reason, 240)
}

// cloudAgentEncodeContinuationFrame 序列化帧并按字节封顶：先丢最旧的画布改动组，
// 再退到"只保留状态与已提交任务"。帧是给模型看的事实交接，宁可少报也不能把硬闸顶穿。
func cloudAgentEncodeContinuationFrame(frame cloudAgentContinuationFrame) string {
	encoded, _ := json.Marshal(frame)
	if len(encoded) <= cloudAgentContinuationFrameBytes {
		return string(encoded)
	}
	for len(frame.CanvasChanges) > 0 {
		frame.CanvasChanges = frame.CanvasChanges[1:]
		frame.OmittedCanvasChanges++
		if len(frame.CanvasChanges) == 0 {
			frame.CanvasChanges = nil
		}
		encoded, _ = json.Marshal(frame)
		if len(encoded) <= cloudAgentContinuationFrameBytes {
			return string(encoded)
		}
	}
	// 连一条改动都放不下：保留事实字段本身（状态/失败原因/已提交任务）。
	encoded, _ = json.Marshal(frame)
	if len(encoded) > cloudAgentContinuationFrameBytes {
		frame.FailureReason = truncateRunes(frame.FailureReason, 120)
		encoded, _ = json.Marshal(frame)
	}
	return string(encoded)
}

func cloudAgentContinuationChanges(run *CloudAgentRun) ([]cloudAgentContinuationChange, int) {
	if run == nil {
		return nil, 0
	}
	changes := make([]cloudAgentContinuationChange, 0, cloudAgentContinuationChangeLimit)
	total := 0
	for _, event := range run.Events {
		if event.Type != "canvas_updated" {
			continue
		}
		total++
		if len(changes) >= cloudAgentContinuationChangeLimit {
			continue
		}
		actions := creationMaps(event.Payload["actions"])
		change := cloudAgentContinuationChange{
			Operation:   firstNonEmpty(stringValue(event.Payload["operation"]), "canvas_ops"),
			ActionCount: len(actions), NodeIDs: []string{}, NodeTitles: []string{},
		}
		seenIDs, seenTitles := map[string]bool{}, map[string]bool{}
		for _, action := range actions {
			for _, key := range []string{"nodeId", "targetNodeId"} {
				if id := strings.TrimSpace(stringValue(action[key])); id != "" && !seenIDs[id] && len(change.NodeIDs) < 8 {
					seenIDs[id] = true
					change.NodeIDs = append(change.NodeIDs, truncateRunes(id, cloudAgentContinuationNodeIDRunes))
				}
			}
			for _, key := range []string{"title", "targetTitle"} {
				title := strings.TrimSpace(stringValue(action[key]))
				if title != "" && !seenTitles[title] && len(change.NodeTitles) < 4 {
					seenTitles[title] = true
					change.NodeTitles = append(change.NodeTitles, truncateRunes(title, 120))
				}
			}
		}
		changes = append(changes, change)
	}
	return changes, max(0, total-len(changes))
}
