package app

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"slices"
	"sort"
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

const cloudAgentPlanBlockMarker = "\n\n## 本轮待办清单\n\n"

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
	return stringField(message, cloudAgentContextSourceKey) == "runtime"
}

func stripCloudAgentRuntimeContext(messages []map[string]any) []map[string]any {
	if len(messages) == 0 || !isCloudAgentRuntimeContextMessage(messages[len(messages)-1]) {
		return messages
	}
	var context cloudAgentRuntimeContext
	content := strings.TrimPrefix(stringField(messages[len(messages)-1], "content"), cloudAgentRuntimeContextMarker)
	if json.Unmarshal([]byte(content), &context) != nil || context.Kind != cloudAgentContextPlan {
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
	if len(plan) == 0 {
		return
	}
	canonical.Messages = append(slices.Clone(canonical.Messages), cloudAgentRuntimeMessage(cloudAgentRuntimeContext{Kind: cloudAgentContextPlan, Items: plan}))
}

func cloudAgentPlanRequiresFirstApproval(state *cloudAgentRuntime, call cloudAgentCall) bool {
	if state == nil || state.Request.Surface == "creation" || state.Approval != nil || len(state.Plan) != 0 || state.Request.PermissionMode != "request_approval" {
		return false
	}
	_, ok := cloudAgentPlanApprovalPreview(call)
	return ok
}

func cloudAgentPlanNudgeMessage(state *cloudAgentRuntime, pendingTitle string) map[string]any {
	return cloudAgentRuntimeMessage(cloudAgentRuntimeContext{
		Kind: cloudAgentContextPendingPlan, PendingTitle: pendingTitle,
		LatestUserMessage: cloudAgentLatestUserInstruction(state.Canonical.Messages),
	})
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
	if !slices.Equal(state.Plan, args.Items) {
		state.ActionNudged = false
	}
	state.Plan = args.Items
	return map[string]any{"items": args.Items, "pendingTitles": cloudAgentPendingPlanItems(args.Items)}, nil
}

func cloudAgentConfirmationPointFingerprint(_ string, options []map[string]any, fields []map[string]any) string {
	// Options and form field definitions are the durable identity of a decision point.
	// Question wording is intentionally ignored so harmless paraphrases do not consume
	// another confirmation round.
	parts := make([]string, 0, len(options)+len(fields))
	for _, option := range options {
		label := strings.ToLower(strings.Join(strings.Fields(stringValue(option["label"])), " "))
		detail := strings.ToLower(strings.Join(strings.Fields(stringValue(option["detail"])), " "))
		parts = append(parts, "option\x00"+label+"\x00"+detail)
	}
	for _, field := range fields {
		id := strings.ToLower(strings.Join(strings.Fields(stringValue(field["id"])), " "))
		typ := strings.ToLower(strings.Join(strings.Fields(stringValue(field["type"])), " "))
		parts = append(parts, "field\x00"+id+"\x00"+typ+"\x00"+stringValue(field["defaultValue"]))
	}
	sort.Strings(parts)
	canonical := strings.Join(parts, "\x00")
	sum := sha256.Sum256([]byte(canonical))
	return hex.EncodeToString(sum[:])
}

func cloudAgentHasConfirmationFingerprint(state *cloudAgentRuntime, fingerprint string) bool {
	if state == nil || fingerprint == "" {
		return false
	}
	for _, existing := range state.ConfirmationFingerprints {
		if existing == fingerprint {
			return true
		}
	}
	return false
}

func cloudAgentAskUser(call cloudAgentCall, states ...*cloudAgentRuntime) (any, error) {
	var state *cloudAgentRuntime
	if len(states) > 0 {
		state = states[0]
	}
	var args struct {
		Question   string `json:"question"`
		QuestionID string `json:"questionId"`
		Options    []struct {
			Label  string `json:"label"`
			Detail string `json:"detail"`
		} `json:"options"`
		Fields []struct {
			ID      string `json:"id"`
			Title   string `json:"title"`
			Type    string `json:"type"`
			Options []struct {
				ID          string `json:"id"`
				Label       string `json:"label"`
				Detail      string `json:"detail"`
				Recommended bool   `json:"recommended"`
			} `json:"options"`
			DefaultValue string `json:"defaultValue"`
			Required     bool   `json:"required"`
			AllowCustom  bool   `json:"allowCustom"`
			Placeholder  string `json:"placeholder"`
		} `json:"fields"`
		AllowFreeform *bool `json:"allowFreeform"`
		Round         int   `json:"round"`
		MaxRounds     int   `json:"maxRounds"`
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
	fields := make([]map[string]any, 0, len(args.Fields))
	validTypes := map[string]bool{"single_select": true, "segmented": true, "text": true, "textarea": true, "model_picker": true}
	for _, field := range args.Fields {
		id := strings.TrimSpace(field.ID)
		title := strings.TrimSpace(field.Title)
		if id == "" || title == "" || !validTypes[field.Type] {
			continue
		}
		entry := map[string]any{"id": truncateRunes(id, 80), "title": truncateRunes(title, 80), "type": field.Type, "required": field.Required, "allowCustom": field.AllowCustom}
		if value := strings.TrimSpace(field.DefaultValue); value != "" {
			entry["defaultValue"] = truncateRunes(value, 200)
		}
		if placeholder := strings.TrimSpace(field.Placeholder); placeholder != "" {
			entry["placeholder"] = truncateRunes(placeholder, 200)
		}
		fieldOptions := make([]map[string]any, 0, len(field.Options))
		for _, option := range field.Options {
			label := strings.TrimSpace(option.Label)
			if label == "" {
				continue
			}
			optionEntry := map[string]any{"label": truncateRunes(label, 100), "recommended": option.Recommended}
			if id := strings.TrimSpace(option.ID); id != "" {
				optionEntry["id"] = truncateRunes(id, 80)
			}
			if detail := strings.TrimSpace(option.Detail); detail != "" {
				optionEntry["detail"] = truncateRunes(detail, 180)
			}
			fieldOptions = append(fieldOptions, optionEntry)
		}
		if len(fieldOptions) > 8 {
			fieldOptions = fieldOptions[:8]
		}
		if len(fieldOptions) > 0 {
			entry["options"] = fieldOptions
		}
		fields = append(fields, entry)
	}
	if len(fields) > 6 {
		fields = fields[:6]
	}
	if len(fields) > 0 && len(options) > 0 {
		return nil, BadAuthRequest("ask_user 的 options 与 fields 只能二选一；多个参数请只使用 fields")
	}
	if len(fields) == 0 && len(options) < 2 {
		return nil, BadAuthRequest("ask_user 必须提供动态表单字段，或至少 2 个候选项；若你自己能定，直接做完继续，不要问")
	}
	allowFreeform := true
	if args.AllowFreeform != nil {
		allowFreeform = *args.AllowFreeform
	}
	maxRounds := cloudAgentMaxConfirmationRounds
	currentRound := 1
	fingerprint := cloudAgentConfirmationPointFingerprint(question, options, fields)
	duplicate := false
	if state != nil {
		currentRound = state.ConfirmationRounds + 1
		duplicate = cloudAgentHasConfirmationFingerprint(state, fingerprint)
	}
	payload := map[string]any{
		"phase":         "question",
		"kind":          "form",
		"question":      truncateRunes(question, 400),
		"options":       options,
		"fields":        fields,
		"questionId":    truncateRunes(strings.TrimSpace(args.QuestionID), 100),
		"allowFreeform": allowFreeform,
		"round":         currentRound,
		"maxRounds":     maxRounds,
	}
	if len(fields) == 0 {
		payload["kind"] = "choice"
		delete(payload, "fields")
	}
	if duplicate || currentRound > maxRounds {
		payload["phase"] = "defaulted"
		payload["defaulted"] = true
		payload["reason"] = "repeated_confirmation_point"
		if currentRound > maxRounds {
			payload["reason"] = "confirmation_round_limit"
		}
		payload["text"] = "确认次数已达到上限或确认点已重复。请使用安全默认方案继续，不要再次询问；最终回复中列出采用的默认假设。"
		if state != nil {
			state.PendingConfirmationFingerprint = ""
		}
		return payload, nil
	}
	if state != nil {
		state.ConfirmationRounds = currentRound
		state.ConfirmationFingerprints = append(state.ConfirmationFingerprints, fingerprint)
		state.PendingConfirmationFingerprint = fingerprint
	}
	return payload, nil
}

// skipRemainingCloudAgentCalls 结束本批剩余调用（ask_user 之后本轮不再继续执行）。
// 末尾的 flush 让"本批前面的看图结果"仍能落在全部 tool 结果之后：这批调用到这里已经
// 完整（每个声明的 tool_call_id 都有回执），但本轮就此结束、不会再走 advanceCloudAgent
// 的兜底 flush，少了这一步缓冲的图片会被丢掉。
func skipRemainingCloudAgentCalls(runID string, state *cloudAgentRuntime) {
	for index := state.CallIndex + 1; index < len(state.Calls); index++ {
		cloudAgentToolResult(runID, state, state.Calls[index], map[string]any{"skipped": true}, BadAuthRequest("本轮已结束（等待用户决定），该调用未执行"))
	}
	cloudAgentFlushPendingImages(state)
}

func cloudAgentCanonicalWithPlan(state *cloudAgentRuntime) canonicalAgentRequest {
	canonical := state.Canonical
	attachCloudAgentPlan(&canonical, state.Plan)
	return canonical
}
