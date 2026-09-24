package app

import (
	"encoding/json"
	"math"
	"strconv"
	"strings"
	"unicode/utf8"
)

const (
	defaultCloudAgentContextWindowTokens = 128_000
	defaultCloudAgentMaxOutputTokens     = 16_384
	minCloudAgentContextWindowTokens     = 4_096
	maxCloudAgentContextWindowTokens     = 10_000_000
)

type cloudAgentContextBudget struct {
	ContextWindowTokens int
	MaxOutputTokens     int
	OverheadTokens      int
	InputBudgetTokens   int
	CompactAtTokens     int
	Source              string
	// Configured 说明这份预算里的窗口是不是"模型自己声明的值"：false 表示没有解析到
	// 可用窗口、上面几个数都来自兜底默认值。压力读数据此决定要不要给出窗口占用率——
	// 拿默认窗口冒充真实能力（例如给未声明窗口的模型算一个"占满 80%"）会误导排查。
	Configured bool
}

func defaultCloudAgentContextBudget() cloudAgentContextBudget {
	budget := cloudAgentContextBudgetFor(defaultCloudAgentContextWindowTokens, defaultCloudAgentMaxOutputTokens, "default")
	budget.Configured = false
	return budget
}

func cloudAgentContextBudgetFor(contextWindow, maxOutput int, source string) cloudAgentContextBudget {
	configured := true
	if contextWindow < minCloudAgentContextWindowTokens || contextWindow > maxCloudAgentContextWindowTokens {
		contextWindow, configured = defaultCloudAgentContextWindowTokens, false
	}
	if maxOutput < 256 || maxOutput >= contextWindow {
		maxOutput = min(defaultCloudAgentMaxOutputTokens, contextWindow/4)
	}
	// Tool schemas, provider wrappers and the final recovery turn are part of the
	// request, but are not represented by the canonical message body alone. Keep
	// a bounded proportional reserve so a 1M model can still use its capacity.
	overhead := max(4_096, min(32_768, contextWindow/25))
	inputBudget := contextWindow - maxOutput - overhead
	if inputBudget < 1_024 {
		inputBudget = max(1_024, contextWindow/2)
	}
	return cloudAgentContextBudget{
		ContextWindowTokens: contextWindow,
		MaxOutputTokens:     maxOutput,
		OverheadTokens:      overhead,
		InputBudgetTokens:   inputBudget,
		CompactAtTokens:     max(1_024, inputBudget*85/100),
		Source:              source,
		Configured:          configured,
	}
}

// cloudAgentContextBudgetForRequest resolves the capability contract that will
// actually execute the next text turn. Logical models use the safe intersection
// of every eligible text route so route selection cannot choose a smaller window
// after the context was assembled.
func (s *Service) cloudAgentContextBudgetForRequest(req CloudAgentRequest) cloudAgentContextBudget {
	if s == nil || s.repo == nil {
		return defaultCloudAgentContextBudget()
	}
	if req.LogicalModelID != "" {
		if snapshot, err := s.routeCatalogSnapshot(); err == nil {
			if cached, ok := snapshot.Models[req.LogicalModelID]; ok {
				contextWindow, maxOutput := 0, 0
				for _, route := range cached.Routes {
					if normalizeCapability(route.CapabilitySpec.Capability) != "text" {
						continue
					}
					capability, err := normalizedChannelModelCapability(&route.ChannelModel)
					if err != nil || capability == nil || capability.Text == nil {
						continue
					}
					if contextWindow == 0 || capability.Text.ContextWindowTokens < contextWindow {
						contextWindow = capability.Text.ContextWindowTokens
					}
					if maxOutput == 0 || capability.Text.MaxOutputTokens < maxOutput {
						maxOutput = capability.Text.MaxOutputTokens
					}
				}
				if contextWindow > 0 && maxOutput > 0 {
					return cloudAgentContextBudgetFor(contextWindow, maxOutput, "logical-route-intersection")
				}
			}
		}
		return defaultCloudAgentContextBudget()
	}
	if req.ChannelID != "" && req.ChannelModelKey != "" {
		if capability := s.cloudAgentChannelTextCapability(req); capability != nil {
			return cloudAgentContextBudgetFor(capability.ContextWindowTokens, capability.MaxOutputTokens, "channel-model")
		}
	}
	return defaultCloudAgentContextBudget()
}

// cloudAgentChannelTextCapability resolves the text capability of the channel
// model this turn will actually run on. Logical models have no single channel
// model, so they return nil and keep the route-intersection path.
func (s *Service) cloudAgentChannelTextCapability(req CloudAgentRequest) *TextCapabilityConfig {
	if s == nil || s.repo == nil || req.ChannelID == "" || req.ChannelModelKey == "" {
		return nil
	}
	channelModel, err := s.repo.ChannelModelByKey(req.ChannelID, req.ChannelModelKey)
	if err != nil {
		return nil
	}
	capability, err := normalizedChannelModelCapability(channelModel)
	if err != nil || capability == nil || capability.Text == nil {
		return nil
	}
	return capability.Text
}

// cloudAgentEstimatedTokens is deliberately conservative for non-ASCII text.
// It is a planning estimate, not a provider tokenizer; underestimation would
// make a request fail only after reaching an upstream provider.
func cloudAgentEstimatedTokens(value []byte) int {
	if len(value) == 0 {
		return 1
	}
	ascii, nonASCII := 0, 0
	for len(value) > 0 {
		r, size := utf8.DecodeRune(value)
		if r == utf8.RuneError && size == 1 {
			nonASCII++
			value = value[1:]
			continue
		}
		if r < 0x80 {
			ascii++
		} else {
			nonASCII++
		}
		value = value[size:]
	}
	return max(1, int(math.Ceil(float64(ascii)/4+float64(nonASCII)*1.5)))
}

func cloudAgentRequestEstimatedTokens(request *canonicalAgentRequest) (int, error) {
	raw, err := json.Marshal(request)
	if err != nil {
		return 0, err
	}
	return cloudAgentEstimatedTokens(raw), nil
}

func cloudAgentContextBudgetMessage(budget cloudAgentContextBudget) string {
	return "用户指令与当前执行事实超过模型输入预算（" + formatTokenCount(budget.InputBudgetTokens) + " Token，能力来源：" + strings.TrimSpace(budget.Source) + "），请缩小本轮范围"
}

func formatTokenCount(value int) string {
	if value < 1_000 {
		return strconv.Itoa(value)
	}
	if value%1_000 == 0 {
		return strconv.Itoa(value/1_000) + "K"
	}
	return strconv.Itoa(value/1_000) + "K"
}
