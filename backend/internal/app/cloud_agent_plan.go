package app

import (
	"fmt"
	"strings"
)

type cloudAgentPlanItem struct {
	ID     string `json:"id"`
	Title  string `json:"title"`
	Status string `json:"status"`
}

func cloudAgentPendingPlanItems(plan []cloudAgentPlanItem) []string {
	pending := make([]string, 0, len(plan))
	for _, item := range plan {
		if item.Status != "done" {
			pending = append(pending, item.Title)
		}
	}
	return pending
}

func cloudAgentPlanBlock(plan []cloudAgentPlanItem) string {
	if len(plan) == 0 {
		return ""
	}
	var b strings.Builder
	b.WriteString(cloudAgentPlanBlockMarker)
	b.WriteString("当前用户消息是本轮目标。清单只辅助推进仍覆盖在该目标下的步骤；用户已改口时不要回头确认上一轮有没有做完。每完成一项就调用 plan_update 更新它的 status。\n\n")
	for _, item := range plan {
		mark := "未开始"
		switch item.Status {
		case "doing":
			mark = "进行中"
		case "done":
			mark = "已完成"
		}
		b.WriteString(fmt.Sprintf("- [%s] %s. %s\n", mark, item.ID, item.Title))
	}
	return b.String()
}

const cloudAgentPlanBlockMarker = "\n\n## 本轮待办清单\n\n"
const cloudAgentRuntimeContextMarker = "【运行状态】"

func stripCloudAgentPlanBlock(system string) string {
	if i := strings.Index(system, cloudAgentPlanBlockMarker); i >= 0 {
		return system[:i]
	}
	return system
}

func isCloudAgentRuntimeContextMessage(message map[string]any) bool {
	if stringField(message, "role") != "user" {
		return false
	}
	return strings.HasPrefix(strings.TrimSpace(stringField(message, "content")), cloudAgentRuntimeContextMarker)
}

func stripCloudAgentRuntimeContext(messages []map[string]any) []map[string]any {
	if len(messages) == 0 || !isCloudAgentRuntimeContextMessage(messages[len(messages)-1]) {
		return messages
	}
	return messages[:len(messages)-1]
}

func attachCloudAgentPlan(canonical *canonicalAgentRequest, plan []cloudAgentPlanItem) {
	if canonical == nil {
		return
	}
	canonical.SystemPrompt = stripCloudAgentPlanBlock(canonical.SystemPrompt)
	canonical.Messages = stripCloudAgentRuntimeContext(canonical.Messages)
	block := cloudAgentPlanBlock(plan)
	if block == "" {
		return
	}
	canonical.Messages = append(canonical.Messages, map[string]any{
		"role":    "user",
		"content": cloudAgentRuntimeContextMarker + "这不是新的用户指令，只是当前待办状态。当前用户消息仍是本轮目标。\n" + strings.TrimSpace(block),
	})
}

func cloudAgentPlanRequiresFirstApproval(state *cloudAgentRuntime, call cloudAgentCall) bool {
	if state == nil || state.Approval != nil || len(state.Plan) != 0 || state.Request.PermissionMode != "request_approval" {
		return false
	}
	_, ok := cloudAgentPlanApprovalPreview(call)
	return ok
}

func cloudAgentLastMessageIsUserInstruction(messages []map[string]any) bool {
	if len(messages) == 0 {
		return false
	}
	last := messages[len(messages)-1]
	if stringField(last, "role") != "user" {
		return false
	}
	content := strings.TrimSpace(stringField(last, "content"))
	if content == "" {
		return false
	}
	if strings.HasPrefix(content, cloudAgentRuntimeContextMarker) {
		return false
	}
	if strings.HasPrefix(content, "【用户插话】") {
		return true
	}
	if strings.Contains(content, "待办清单") || strings.Contains(content, "现在就调用工具") {
		return false
	}
	return true
}

func cloudAgentUserFirstPrefix(state *cloudAgentRuntime) string {
	if state == nil || !cloudAgentLastMessageIsUserInstruction(state.Canonical.Messages) {
		return ""
	}
	last := state.Canonical.Messages[len(state.Canonical.Messages)-1]
	userText := truncateRunes(strings.TrimSpace(stringField(last, "content")), 200)
	return "用户刚给了新要求：「" + userText + "」。**先按用户的最新要求来做**，做完再继续下面这件事："
}

func cloudAgentPlanNudgeContent(state *cloudAgentRuntime, pendingTitle string) string {
	return cloudAgentUserFirstPrefix(state) + "待办清单里「" + pendingTitle + "」还没完成，这一轮不能算结束。请按这个循环推进：**执行 → 检查结果 → 用 plan_update 更新该项状态 → 做下一项**。现在就调用工具继续。"
}

func cloudAgentPlanRequiredNudgeContent(state *cloudAgentRuntime) string {
	return cloudAgentUserFirstPrefix(state) + "你还没有把这次要做的事列成待办清单，服务端无法判断是否做完。请先用 plan_update 把剩余工作一次列全（一项一个可验收的产出，例如「生成镜头2视频」），再按清单逐项推进：每完成一项就更新该项状态，然后做下一项。现在就调用工具。"
}

func cloudAgentPlanApprovalPreview(call cloudAgentCall) (cloudAgentApprovalPreview, bool) {
	var args struct {
		Items []cloudAgentPlanItem `json:"items"`
	}
	if err := decodeCloudAgentJSONObject(call.Function.Arguments, &args); err != nil {
		return cloudAgentApprovalPreview{}, false
	}
	items := make([]cloudAgentApprovalPreviewItem, 0, len(args.Items))
	for _, entry := range args.Items {
		title := strings.TrimSpace(entry.Title)
		if title == "" {
			continue
		}
		items = append(items, cloudAgentApprovalPreviewItem{Operation: "plan_step", Summary: truncateRunes(title, 240)})
	}
	if len(items) < 2 {
		return cloudAgentApprovalPreview{}, false
	}
	return cloudAgentApprovalPreview{
		Kind:        "plan",
		Title:       "确认执行计划",
		Description: fmt.Sprintf("Agent 把这轮任务拆成 %d 步。确认后才会开始执行；暂不执行则会让它改用别的做法。", len(items)),
		Items:       items,
	}, true
}

func cloudAgentApplyPlanUpdate(state *cloudAgentRuntime, call cloudAgentCall) (any, error) {
	var args struct {
		Items []cloudAgentPlanItem `json:"items"`
	}
	if err := decodeCloudAgentJSONObject(call.Function.Arguments, &args); err != nil {
		return nil, BadAuthRequest("工具参数必须是只含支持字段的JSON对象")
	}
	if len(args.Items) > 20 {
		return nil, BadAuthRequest("待办清单最多 20 项")
	}
	seen := map[string]bool{}
	for i := range args.Items {
		args.Items[i].ID = strings.TrimSpace(args.Items[i].ID)
		args.Items[i].Title = strings.TrimSpace(args.Items[i].Title)
		if args.Items[i].ID == "" || args.Items[i].Title == "" {
			return nil, BadAuthRequest("待办的 id 和 title 不能为空")
		}
		if seen[args.Items[i].ID] {
			return nil, BadAuthRequest("待办 id 重复：" + args.Items[i].ID)
		}
		seen[args.Items[i].ID] = true
		switch args.Items[i].Status {
		case "pending", "doing", "done":
		default:
			args.Items[i].Status = "pending"
		}
	}
	state.Plan = args.Items
	return map[string]any{"items": args.Items, "pendingTitles": cloudAgentPendingPlanItems(args.Items)}, nil
}

func cloudAgentAskUser(call cloudAgentCall) (any, error) {
	var args struct {
		Question string `json:"question"`
		Options  []struct {
			Label  string `json:"label"`
			Detail string `json:"detail"`
		} `json:"options"`
		AllowFreeform *bool `json:"allowFreeform"`
	}
	if err := decodeCloudAgentJSONObject(call.Function.Arguments, &args); err != nil {
		return nil, BadAuthRequest("工具参数必须是只含支持字段的JSON对象")
	}
	question := strings.TrimSpace(args.Question)
	if question == "" {
		return nil, BadAuthRequest("ask_user 必须给出 question：把要用户拍板的那一个问题一句话写清")
	}
	options := make([]map[string]any, 0, len(args.Options))
	for _, option := range args.Options {
		label := strings.TrimSpace(option.Label)
		if label == "" {
			continue
		}
		entry := map[string]any{"label": truncateRunes(label, 120)}
		if detail := strings.TrimSpace(option.Detail); detail != "" {
			entry["detail"] = truncateRunes(detail, 240)
		}
		options = append(options, entry)
	}
	if len(options) < 2 {
		return nil, BadAuthRequest("ask_user 至少要给 2 个候选项；若你自己能定，直接做完继续，不要问")
	}
	if len(options) > 6 {
		options = options[:6]
	}
	allowFreeform := true
	if args.AllowFreeform != nil {
		allowFreeform = *args.AllowFreeform
	}
	return map[string]any{
		"phase":         "question",
		"question":      truncateRunes(question, 400),
		"options":       options,
		"allowFreeform": allowFreeform,
	}, nil
}

func skipRemainingCloudAgentCalls(runID string, state *cloudAgentRuntime) {
	for index := state.CallIndex + 1; index < len(state.Calls); index++ {
		cloudAgentToolResult(runID, state, state.Calls[index], map[string]any{"skipped": true}, BadAuthRequest("本轮已结束（等待用户决定），该调用未执行"))
	}
}

func cloudAgentCanonicalWithPlan(state *cloudAgentRuntime) canonicalAgentRequest {
	canonical := state.Canonical
	attachCloudAgentPlan(&canonical, state.Plan)
	return canonical
}
