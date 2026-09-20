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
}

func defaultCloudAgentContextBudget() cloudAgentContextBudget {
	return cloudAgentContextBudgetFor(defaultCloudAgentContextWindowTokens, defaultCloudAgentMaxOutputTokens, "default")
}

func cloudAgentContextBudgetFor(contextWindow, maxOutput int, source string) cloudAgentContextBudget {
	if contextWindow < minCloudAgentContextWindowTokens || contextWindow > maxCloudAgentContextWindowTokens {
		contextWindow = defaultCloudAgentContextWindowTokens
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
		if channelModel, err := s.repo.ChannelModelByKey(req.ChannelID, req.ChannelModelKey); err == nil {
			if capability, err := normalizedChannelModelCapability(channelModel); err == nil && capability != nil && capability.Text != nil {
				return cloudAgentContextBudgetFor(capability.Text.ContextWindowTokens, capability.Text.MaxOutputTokens, "channel-model")
			}
		}
	}
	return defaultCloudAgentContextBudget()
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
