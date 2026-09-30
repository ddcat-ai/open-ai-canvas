package app

import (
	"encoding/json"
	"strconv"
	"strings"
)

// cloudAgentTokenAnchor 是"上游实测 + 本地估算"的一对读数。
// 上游用量来自模型自己的分词器（provider 上报），是压力读数可以采信的权威值；
// 本地估算记录的是发出同一次请求时的读法，二者的差就是投影后续请求所需的换算基准。
type cloudAgentTokenAnchor struct {
	TaskID          string `json:"taskId"`
	Step            int    `json:"step"`
	InputTokens     int64  `json:"inputTokens"`
	CachedTokens    int64  `json:"cachedTokens"`
	OutputTokens    int64  `json:"outputTokens"`
	EstimatedTokens int    `json:"estimatedTokens"`
	SourceBytes     int    `json:"sourceBytes"`
	Accepted        bool   `json:"accepted"`
	RejectReason    string `json:"rejectReason,omitempty"`
	// Signature / Model / ChannelID 记录"定锚时的口径"：换了模型、线路、系统提示或工具 schema
	// 之后，旧实测不再可比，必须作废。
	Signature string `json:"signature,omitempty"`
	Model     string `json:"model,omitempty"`
	ChannelID string `json:"channelId,omitempty"`
	// ContextWindowTokens 是定锚时解析到的模型窗口：窗口是"离满窗还有多远"的分母，
	// 换了窗口（管理员改了渠道模型能力、或换了路由落点）之后同一个 token 数含义就变了。
	ContextWindowTokens int `json:"contextWindowTokens,omitempty"`
}

// cloudAgentAnchorMaxAgeSteps 是锚点的最长有效期：超过这么多步没有刷新就作废。
// 真机实测过"锚点冻结"——估算从 42,581 涨到 66,105，压力却一直停在老读数上。
const cloudAgentAnchorMaxAgeSteps = 3

// cloudAgentStepSignature 是"这一步的口径指纹"：模型/渠道/逻辑模型 + 系统提示 + 工具 schema。
// 它刻意不含消息正文：消息每步都在变，含进去等于每步作废，锚点就永远用不上。
func cloudAgentStepSignature(state *cloudAgentRuntime) string {
	if state == nil {
		return ""
	}
	return cloudAgentRequestSignature(state, state.Canonical, "", "")
}

func cloudAgentRequestSignature(state *cloudAgentRuntime, canonical canonicalAgentRequest, channelID, model string) string {
	tools, _ := json.Marshal(canonical.Tools)
	return creationHash(strings.Join([]string{
		state.Request.Model, state.Request.ChannelID, state.Request.ChannelModelKey, state.Request.LogicalModelID,
		channelID, model, canonical.SystemPrompt, string(tools),
	}, "\u0000"))
}

// cloudAgentAnchorWindowTokens 把预算折算成锚点口径的窗口读数：没有解析到模型自己声明的
// 窗口时报 0（未知），调用方据此跳过窗口比较，而不是拿兜底默认窗口当判据。
func cloudAgentAnchorWindowTokens(budget cloudAgentContextBudget) int {
	if !budget.Configured {
		return 0
	}
	return budget.ContextWindowTokens
}

// cloudAgentExpireTokenAnchor 让"口径已变、窗口已变或太久没刷新"的锚点作废。
// 只标记不删除：读数仍要能显示"这个实测是多少、为什么不再用它"。
func cloudAgentExpireTokenAnchor(runID string, state *cloudAgentRuntime, windowTokens int) {
	if state == nil {
		return
	}
	cloudAgentExpireTokenAnchorForRequest(runID, state, windowTokens, cloudAgentStepSignature(state), state.Request.Model, state.Request.ChannelID)
}

func cloudAgentExpireTokenAnchorForRequest(runID string, state *cloudAgentRuntime, windowTokens int, signature, model, channelID string) {
	if state == nil || state.TokenAnchor == nil || !state.TokenAnchor.Accepted {
		return
	}
	anchor := state.TokenAnchor
	if anchor.Signature != "" && anchor.Signature != signature {
		switch {
		case anchor.Model != "" && anchor.Model != model:
			anchor.RejectReason = "模型已变化，锚点作废"
			state.event(runID, "context_transition", map[string]any{"kind": "model_changed", "reason": "anchor_signature_changed", "text": anchor.RejectReason})
		case anchor.ChannelID != "" && anchor.ChannelID != channelID:
			anchor.RejectReason = "供应线路已变化，锚点作废"
			state.event(runID, "context_transition", map[string]any{"kind": "route_changed", "reason": "anchor_signature_changed", "text": anchor.RejectReason})
		default:
			anchor.RejectReason = "系统提示或工具 schema 已变化，锚点作废"
		}
		anchor.Accepted = false
		return
	}
	if windowTokens > 0 && anchor.ContextWindowTokens > 0 && windowTokens != anchor.ContextWindowTokens {
		anchor.RejectReason = "模型窗口已变化，锚点作废"
		anchor.Accepted = false
		state.event(runID, "context_transition", map[string]any{
			"kind": "window_changed", "reason": "anchor_window_changed",
			"before": map[string]any{"contextWindowTokens": anchor.ContextWindowTokens},
			"after":  map[string]any{"contextWindowTokens": windowTokens},
			"text":   anchor.RejectReason,
		})
		return
	}
	if state.Step-anchor.Step > cloudAgentAnchorMaxAgeSteps {
		anchor.RejectReason = "锚点超过 " + strconv.Itoa(cloudAgentAnchorMaxAgeSteps) + " 步未刷新，已作废"
		anchor.Accepted = false
	}
}

// cloudAgentAnchorMinRatio / MaxRatio 是采信上游用量的合理区间。
// 实测与自估差出一个量级时通常意味着换了模型或计量口径（例如上游只报缓存命中、
// 或走了不同的协议分支），此时宁可继续用估算，也不要把压力曲线锚到错误基准上。
const (
	cloudAgentAnchorMinRatio = 0.5
	cloudAgentAnchorMaxRatio = 2.0
)

// recordCloudAgentTokenAnchor 用上一步的上游实测用量给上下文压力定锚。
// 幂等：同一任务只采信一次；没有实测或比值离谱时记录拒绝原因并保留估算。
// 当前请求的口径变化要等到实际任务输入确定后再判断，不能拿运行态副本替代请求信封。
func (s *Service) recordCloudAgentTokenAnchor(userID string, state *cloudAgentRuntime) {
	if s == nil || state == nil {
		return
	}
	if s.repo == nil || state.LastStepTaskID == "" || state.LastStepEstimate <= 0 || state.LastStepSignature == "" {
		return
	}
	// 只有"模型调用"这一步能配锚点：媒体任务发的是另一份请求（另一套信封），
	// 拿它当锚点会把压力算到错误的信封上。
	if state.LastStepOperation != cloudAgentStepOperation {
		return
	}
	if state.TokenAnchor != nil && state.TokenAnchor.TaskID == state.LastStepTaskID {
		return
	}
	log, ok, err := s.repo.APICallLogUsageForTask(userID, state.LastStepTaskID)
	if err != nil || !ok {
		return
	}
	// A routed model may select another channel after the request was assembled.
	// Do not project that provider's tokenizer onto a different known route.
	if log.ChannelID != "" && state.LastStepChannelID != "" && log.ChannelID != state.LastStepChannelID {
		return
	}
	anchor := &cloudAgentTokenAnchor{
		TaskID: state.LastStepTaskID, Step: state.Step, InputTokens: log.InputTokens,
		CachedTokens: log.CachedTokens, OutputTokens: log.OutputTokens,
		EstimatedTokens: state.LastStepEstimate, SourceBytes: state.LastStepSourceBytes,
		Signature: state.LastStepSignature, Model: state.LastStepModel, ChannelID: state.LastStepChannelID,
		ContextWindowTokens: state.LastStepWindowTokens,
	}
	ratio := float64(anchor.InputTokens) / float64(anchor.EstimatedTokens)
	switch {
	case ratio < cloudAgentAnchorMinRatio:
		anchor.RejectReason = "上游实测远低于本地估算，可能换了模型或口径"
	case ratio > cloudAgentAnchorMaxRatio:
		anchor.RejectReason = "上游实测远高于本地估算，可能换了模型或口径"
	default:
		anchor.Accepted = true
	}
	state.TokenAnchor = anchor
}
