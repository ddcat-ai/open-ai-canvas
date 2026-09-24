package app

import (
	"encoding/json"
	"math"
	"unicode"
	"unicode/utf8"
)

// cloudAgentContextPressure 是"这次请求还能装多少输入"的读数。
// 消费方（上下文计量弹窗、运行诊断）直接读这份结构，不自己再算一遍。
type cloudAgentContextPressure struct {
	EstimatedInputTokens int     `json:"estimatedInputTokens"`
	ContextWindowTokens  int     `json:"contextWindowTokens"`
	ReservedOutputTokens int     `json:"reservedOutputTokens"`
	UsableInputTokens    int     `json:"usableInputTokens"`
	PressureRatio        float64 `json:"pressureRatio"`
	SourceBytes          int     `json:"sourceBytes"`
	PromptChars          int     `json:"promptChars"`
	PromptLimitChars     int     `json:"promptLimitChars"`
	ModelLimitConfigured bool    `json:"modelLimitConfigured"`
	Estimate             bool    `json:"estimate"`
	// 三个窗口口径字段说明"这条读数按哪个算式算出来"：OverheadTokens 是工具 schema /
	// 协议包装 / 兜底轮的比例预留，InputBudgetTokens 才是真正可供输入使用的额度。
	OverheadTokens    int    `json:"overheadTokens,omitempty"`
	InputBudgetTokens int    `json:"inputBudgetTokens,omitempty"`
	BudgetSource      string `json:"budgetSource,omitempty"`
	// CompactAtTokens 是上游既有的"可重读正文就地裁剪"触发线（输入预算的 85%，见
	// compactCloudAgentContext）。它只是给读数一个参照刻度，不是本读数触发的动作。
	CompactAtTokens int `json:"compactAtTokens,omitempty"`
}

// cloudAgentProjectedInputTokens 合成"下一步输入 token"的权威读数：
// provider 锚点（模型自己的分词器读数）+ 本地估算的有符号增量；没有可用锚点时退回纯估算。
// 增量带符号是刻意的：上下文被裁剪（图片移出、正文卸载）后本地估算会变小，
// 投影也必须跟着变小，否则读数只会单调上涨。
func cloudAgentProjectedInputTokens(pressure cloudAgentContextPressure, state *cloudAgentRuntime) (int, string) {
	if state == nil || state.TokenAnchor == nil || !state.TokenAnchor.Accepted {
		return pressure.EstimatedInputTokens, "estimate"
	}
	anchor := state.TokenAnchor
	delta := pressure.EstimatedInputTokens - anchor.EstimatedTokens
	return max(0, int(anchor.InputTokens)+delta), "provider"
}

// cloudAgentContextPressurePayload 把读数摊成事件载荷。
//
// 两条硬规则（消费方不必猜）：
//  1. 两个量纲各自命名、互不覆盖：本地估算描述**下一次**请求（readingScope=next_request /
//     estimateMethod=local_v1），上游实测量的是**上一次**请求（providerMeasurementScope=
//     previous_request），两者不能画成同一条曲线。
//  2. 没有解析到模型自己声明的窗口时不下发窗口字段与占用率：宁可不给百分比，
//     也不要拿兜底默认窗口编一个看起来很像真的"已占用 80%"。
func cloudAgentContextPressurePayload(pressure cloudAgentContextPressure, state *cloudAgentRuntime, actual ...canonicalAgentRequest) map[string]any {
	payload := map[string]any{
		"estimatedInputTokens": pressure.EstimatedInputTokens,
		"sourceBytes":          pressure.SourceBytes,
		"promptChars":          pressure.PromptChars,
		"estimate":             pressure.Estimate,
		// provider usage measures the previous request; the estimate describes
		// the next request. Consumers must not draw them as one series.
		"readingScope": "next_request", "estimateMethod": "local_v1",
		// 快照版本与相位：读数属于"下一次请求发出之前"的测量。
		"schemaVersion": 2, "phase": "before_request",
	}
	if pressure.PromptLimitChars > 0 {
		payload["promptLimitChars"] = pressure.PromptLimitChars
	}
	payload["modelLimitConfigured"] = pressure.ModelLimitConfigured
	if pressure.ModelLimitConfigured {
		payload["contextWindowTokens"] = pressure.ContextWindowTokens
		payload["reservedOutputTokens"] = pressure.ReservedOutputTokens
		payload["usableInputTokens"] = pressure.UsableInputTokens
		payload["inputBudgetTokens"] = pressure.InputBudgetTokens
		payload["overheadTokens"] = pressure.OverheadTokens
		payload["compactAtTokens"] = pressure.CompactAtTokens
		payload["budgetSource"] = firstNonEmpty(pressure.BudgetSource, "channel-model")
		if pressure.UsableInputTokens > 0 {
			payload["pressureRatio"] = pressure.PressureRatio
		}
	}
	if state == nil {
		return payload
	}
	// 上游实测锚点：provider 用模型自己的分词器报出的 prompt 规模，是权威读数。
	projectedTokens, tokenSource := cloudAgentProjectedInputTokens(pressure, state)
	if anchor := state.TokenAnchor; anchor != nil {
		payload["anchorStep"] = anchor.Step
		payload["anchor"] = map[string]any{
			"id": anchor.TaskID, "valid": anchor.Accepted, "ageSteps": max(0, state.Step-anchor.Step),
		}
		if anchor.Accepted {
			payload["pressureTokens"] = anchor.InputTokens
			payload["providerMeasurementScope"] = "previous_request"
			payload["providerUsage"] = map[string]any{
				"inputTokens": anchor.InputTokens, "cacheReadTokens": anchor.CachedTokens,
				"uncachedInputTokens": max(0, anchor.InputTokens-anchor.CachedTokens),
				"outputTokens":        anchor.OutputTokens,
			}
			// anchorDeltaTokens 是"本地估算相对锚点那一步的增量"，与投影的分母无关：
			// 消费方拿它解释"较锚点 +N"，不能改成"投影 − 估算"。
			payload["anchorDeltaTokens"] = pressure.EstimatedInputTokens - anchor.EstimatedTokens
			if anchor.EstimatedTokens > 0 {
				payload["tokenScale"] = math.Round(float64(anchor.InputTokens)/float64(anchor.EstimatedTokens)*10000) / 10000
			}
			tokenSource = "provider"
		} else if anchor.RejectReason != "" {
			payload["anchorRejected"] = anchor.RejectReason
		}
	}
	payload["projectedTokens"] = projectedTokens
	payload["tokenSource"] = tokenSource
	// 两种量纲各自命名，消费方不需要靠 tokenSource 猜哪个数字属于哪把尺子。
	payload["measurementSource"] = tokenSource
	payload["normalizedInputTokens"] = pressure.EstimatedInputTokens
	if tokenSource == "provider" {
		payload["normalizedInputTokens"] = state.TokenAnchor.InputTokens
	}
	payload["projectedNextInputTokens"] = projectedTokens
	if pressure.UsableInputTokens > 0 && tokenSource == "provider" {
		payload["projectedPressureRatio"] = math.Min(9.99, float64(projectedTokens)/float64(pressure.UsableInputTokens))
	}
	payload["breakdown"] = cloudAgentContextBreakdownPayload(state, actual...)
	return payload
}

// cloudAgentContextBreakdownPayload 报"这次要发出去的请求被谁占着"：三个 canonical 桶
// 加上编译进系统提示的各分段，用的是与占用读数同一把估算尺子。
// 桶合计与 canonical 总量的差是协议外壳（tool choice、缓存键），单独报而不摊进任何一个桶。
func cloudAgentContextBreakdownPayload(state *cloudAgentRuntime, actual ...canonicalAgentRequest) map[string]any {
	canonical := state.Canonical
	if len(actual) > 0 {
		canonical = actual[0]
	}
	system := []byte(canonical.SystemPrompt)
	tools, _ := json.Marshal(canonical.Tools)
	messages, _ := json.Marshal(canonical.Messages)
	whole, _ := json.Marshal(canonical)
	systemTokens, toolTokens, messageTokens := estimateCloudAgentTokens(system), estimateCloudAgentTokens(tools), estimateCloudAgentTokens(messages)
	// 构成永远由本地估算给出；已有上游实测锚点时再给一份按锚点比例换算的读数，
	// 让展示口径与 provider 的计数同尺度（原值不覆盖）。
	scale := 1.0
	if anchor := state.TokenAnchor; anchor != nil && anchor.Accepted && anchor.EstimatedTokens > 0 {
		scale = float64(anchor.InputTokens) / float64(anchor.EstimatedTokens)
	}
	scaled := func(tokens int) int { return int(math.Round(float64(tokens) * scale)) }
	var systemSegments []cloudAgentContextSegment
	if segments := state.Policy.SystemSegments; len(segments) > 0 {
		// 分段必须把 system 桶填满：编译之外拼接的块（个人记忆）由
		// cloudAgentRecordMemorySegment 登记，剩余零头（标题、分隔与拼接文本）归入"其它"。
		// 否则分段合计会小于 system 桶，看起来像少算了一截。
		systemSegments = append([]cloudAgentContextSegment{}, segments...)
		accountedBytes, accountedTokens := 0, 0
		for _, segment := range systemSegments {
			accountedBytes += segment.Bytes
			accountedTokens += segment.Tokens
		}
		if remainder := len(system) - accountedBytes; remainder > 0 {
			systemSegments = append(systemSegments, cloudAgentContextSegment{
				Key: "other", Label: "其它（标题与拼接）", Bytes: remainder,
				Tokens: max(0, systemTokens-accountedTokens),
			})
		}
		// 逐段向上取整不满足可加性（Σ⌈ascii/4⌉ ≥ ⌈Σascii/4⌉），所以 system 桶的 token
		// 口径直接取分段合计：桶与分段是同一份分解，消费方会拿分段算占比，
		// 两边差几 token 就会显示成"分段占了 101%"。
		systemTokens = 0
		for index := range systemSegments {
			systemSegments[index].ScaledTokens = scaled(systemSegments[index].Tokens)
			systemTokens += systemSegments[index].Tokens
		}
	}
	buckets := []map[string]any{
		{"key": "system", "label": "系统提示（含画布摘要）", "bytes": len(system), "tokens": systemTokens, "scaledTokens": scaled(systemTokens)},
		{"key": "tools", "label": "工具 schema", "bytes": len(tools), "tokens": toolTokens, "scaledTokens": scaled(toolTokens)},
		{"key": "messages", "label": "会话消息（含工具结果）", "bytes": len(messages), "tokens": messageTokens, "scaledTokens": scaled(messageTokens)},
	}
	bucketBytes := len(system) + len(tools) + len(messages)
	breakdown := map[string]any{
		"totalBytes": len(whole), "totalTokens": estimateCloudAgentTokens(whole),
		"bucketBytes": bucketBytes, "bucketTokens": systemTokens + toolTokens + messageTokens,
		"envelopeBytes":     max(0, len(whole)-bucketBytes),
		"buckets":           buckets,
		"tokenScale":        math.Round(scale*10000) / 10000,
		"scaledTotalTokens": scaled(estimateCloudAgentTokens(whole)),
	}
	if len(systemSegments) > 0 {
		breakdown["systemSegments"] = systemSegments
	}
	return breakdown
}

// estimateCloudAgentTokens 是计量用的本地估算：ASCII 按 4 字节 1 token，CJK 等非 ASCII
// 按 1 字符 1 token 计，数值上刻意保守（CJK 创作内容偏多）。
//
// 它与同文件的 cloudAgentEstimatedTokens 不是同一把尺子，也不要合并：后者是
// **请求准入**的判据（非 ASCII 按 1.5 token/字符，宁可高估也不能把装不下的请求放出去），
// 这里是**读数与锚点**的基准——锚点的采信区间（0.5×–2×）与 tokenScale 都是照着这把尺子
// 标定的，换尺子等于把标定作废。它只是压力展示，既不是计费 token 数，
// 也不能替代上游 tokenizer。
func estimateCloudAgentTokens(value []byte) int {
	if len(value) == 0 {
		return 0
	}
	asciiUnits, nonASCII := 0, 0
	for len(value) > 0 {
		r, size := utf8.DecodeRune(value)
		if r == utf8.RuneError && size == 1 {
			asciiUnits++
			value = value[1:]
			continue
		}
		value = value[size:]
		if r <= unicode.MaxASCII {
			asciiUnits++
		} else {
			nonASCII++
		}
	}
	return int(math.Ceil(float64(asciiUnits)/4.0)) + nonASCII
}

// cloudAgentContextPressure 解析"这次请求能用多少输入"。
//
// 没有解析到真实窗口时 UsableInputTokens 保持 0 且 ModelLimitConfigured=false，
// 消费方据此显示"未配置模型上限"而不是编一个占用率。
func (s *Service) cloudAgentContextPressure(canonical canonicalAgentRequest, prompt string, request CloudAgentRequest) cloudAgentContextPressure {
	raw, _ := json.Marshal(canonical)
	pressure := cloudAgentContextPressure{
		EstimatedInputTokens: estimateCloudAgentTokens(raw),
		SourceBytes:          len(raw),
		PromptChars:          utf8.RuneCountInString(prompt),
		Estimate:             true,
	}
	// 提示词字符上限只来自渠道模型能力（逻辑模型没有单一渠道模型，保持 0 = 不声明）。
	if text := s.cloudAgentChannelTextCapability(request); text != nil {
		pressure.PromptLimitChars = text.References.PromptMaxChars
	}
	budget := s.cloudAgentContextBudgetForRequest(request)
	if !budget.Configured {
		return pressure
	}
	pressure.ModelLimitConfigured = true
	pressure.ContextWindowTokens = budget.ContextWindowTokens
	pressure.ReservedOutputTokens = budget.MaxOutputTokens
	pressure.OverheadTokens = budget.OverheadTokens
	pressure.InputBudgetTokens = budget.InputBudgetTokens
	pressure.CompactAtTokens = budget.CompactAtTokens
	pressure.BudgetSource = budget.Source
	// 展示口径与请求准入判据共用同一份输入预算：否则会出现"界面 79%、后台按 82% 拒绝"。
	pressure.UsableInputTokens = budget.InputBudgetTokens
	if pressure.UsableInputTokens > 0 {
		pressure.PressureRatio = math.Min(9.99, float64(pressure.EstimatedInputTokens)/float64(pressure.UsableInputTokens))
	}
	return pressure
}

// canonicalAgentRequestFromInput 从已落库的任务输入里取回"实际发出去的那份 canonical"：
// 压力读数与锚点都必须对着真实信封，而不是内存里另算一份可能与准入改写结果不同的副本。
func canonicalAgentRequestFromInput(input map[string]any) (canonicalAgentRequest, bool) {
	requests, ok := input["agentRequests"].(map[string]any)
	if !ok {
		return canonicalAgentRequest{}, false
	}
	if requests["canonical"] == nil {
		return canonicalAgentRequest{}, false
	}
	raw, err := json.Marshal(requests["canonical"])
	if err != nil {
		return canonicalAgentRequest{}, false
	}
	var canonical canonicalAgentRequest
	if json.Unmarshal(raw, &canonical) != nil {
		return canonical, false
	}
	return canonical, true
}

// cloudAgentNoteContextWindowResolved 在"窗口从未确认变为已确认"时落一条 context_transition。
//
// 这一步只在读数口径变化时发生（例如早先拿不到模型能力、后来解析到了窗口）：真实上下文
// 没有变小，消费方必须能把它标成"模型窗口已识别"，否则一识别就被画成上下文骤降。
func cloudAgentNoteContextWindowResolved(runID string, state *cloudAgentRuntime, pressure cloudAgentContextPressure) {
	if state == nil || runID == "" || !pressure.ModelLimitConfigured || state.ContextWindowKnown {
		return
	}
	state.ContextWindowKnown = true
	state.event(runID, "context_transition", map[string]any{
		"kind": "window_resolved", "reason": "window_resolved",
		"after": map[string]any{
			"contextWindowTokens": pressure.ContextWindowTokens, "usableInputTokens": pressure.UsableInputTokens,
			"source": firstNonEmpty(pressure.BudgetSource, "channel-model"),
		},
		"text": "模型窗口已识别：读数改用窗口口径，这不是上下文变少",
	})
}
