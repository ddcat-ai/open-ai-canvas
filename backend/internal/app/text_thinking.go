// 文本模型思考等级：统一档位、模型能力声明、档位解析与按协议写入上游请求。
//
// 统一档位是产品语义（off/minimal/low/medium/high/max），各家上游的参数名、取值和
// 开关方式都不同，所以模型能力里分开声明「开关怎么表达」(switch) 和「强度怎么表达」(intensity)。
// 写入位置只允许白名单字段，管理员不能借思考配置改写 model、messages 等请求字段。

package app

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	"yingce/backend/internal/model"
	protocolcontract "yingce/backend/internal/protocol"
)

const (
	ThinkingLevelOff     = "off"
	ThinkingLevelMinimal = "minimal"
	ThinkingLevelLow     = "low"
	ThinkingLevelMedium  = "medium"
	ThinkingLevelHigh    = "high"
	ThinkingLevelMax     = "max"

	// 请求侧的意图值，不是档位：auto = 用模型默认值；deep = 模型支持的最高档（不含 max）。
	ThinkingIntentAuto = "auto"
	ThinkingIntentDeep = "deep"

	ThinkingModeNone   = "none"
	ThinkingModeToggle = "toggle"
	ThinkingModeLevels = "levels"
	ThinkingModeAlways = "always"

	ThinkingSwitchNone         = "none"
	ThinkingSwitchOmit         = "omit"
	ThinkingSwitchEffortNone   = "effort-none"
	ThinkingSwitchEnableFlag   = "enable-flag"
	ThinkingSwitchThinkingType = "thinking-type"
	ThinkingSwitchBudgetZero   = "budget-zero"

	ThinkingIntensityNone        = "none"
	ThinkingIntensityEffort      = "effort"
	ThinkingIntensityBudget      = "budget"
	ThinkingIntensityGeminiLevel = "gemini-level"
	ThinkingIntensityModelSuffix = "model-suffix"

	// thinkingWireGemini 只用于思考参数写入：Gemini generateContent 的请求和响应仍由插件映射。
	thinkingWireGemini = "gemini"
)

var thinkingLevelOrder = []string{ThinkingLevelOff, ThinkingLevelMinimal, ThinkingLevelLow, ThinkingLevelMedium, ThinkingLevelHigh, ThinkingLevelMax}

// TextThinkingConfig 是文本模型的思考能力声明。Preset 只给后台回显，运行时只读展开后的字段，
// 以后调整预设不会悄悄改变已上线模型的请求。
type TextThinkingConfig struct {
	Preset    string                  `json:"preset,omitempty"`
	Mode      string                  `json:"mode"`
	Levels    []string                `json:"levels,omitempty"`
	Default   string                  `json:"default,omitempty"`
	Switch    ThinkingSwitchConfig    `json:"switch"`
	Intensity ThinkingIntensityConfig `json:"intensity"`
}

type ThinkingSwitchConfig struct {
	Kind string `json:"kind"`
	// OnValue 只用于 thinking-type：开启时写入的 type，默认 enabled，可配 auto/adaptive。
	OnValue string `json:"onValue,omitempty"`
}

type ThinkingIntensityConfig struct {
	Kind string `json:"kind"`
	// Field 为空时按协议取默认写入位置，见 thinkingEffortFields / thinkingBudgetFields。
	Field   string            `json:"field,omitempty"`
	Values  map[string]string `json:"values,omitempty"`
	Budgets map[string]int    `json:"budgets,omitempty"`
}

// 各协议允许写入的强度字段；第一个是默认值。
var thinkingEffortFields = map[string][]string{
	protocolcontract.TextWireChatCompletion: {"reasoning_effort", "reasoning.effort"},
	protocolcontract.TextWireResponses:      {"reasoning.effort"},
	protocolcontract.TextWireClaude:         {"output_config.effort"},
}

var thinkingBudgetFields = map[string][]string{
	protocolcontract.TextWireChatCompletion: {"thinking_budget", "reasoning.max_tokens"},
	protocolcontract.TextWireClaude:         {"thinking.budget_tokens"},
	thinkingWireGemini:                      {"generationConfig.thinkingConfig.thinkingBudget"},
}

var thinkingSwitchWires = map[string][]string{
	ThinkingSwitchEffortNone:   {protocolcontract.TextWireChatCompletion, protocolcontract.TextWireResponses},
	ThinkingSwitchEnableFlag:   {protocolcontract.TextWireChatCompletion},
	ThinkingSwitchThinkingType: {protocolcontract.TextWireChatCompletion, protocolcontract.TextWireClaude},
	ThinkingSwitchBudgetZero:   {protocolcontract.TextWireChatCompletion, thinkingWireGemini},
}

// 未配置强度取值时按 maxOutputTokens 的比例给预算。
var thinkingBudgetRatios = map[string]float64{
	ThinkingLevelMinimal: 0.1, ThinkingLevelLow: 0.2, ThinkingLevelMedium: 0.4, ThinkingLevelHigh: 0.6, ThinkingLevelMax: 0.8,
}

const (
	thinkingBudgetFloor         = 1024
	thinkingBudgetFallbackLimit = 16384
)

// textThinkingPresets 是后台的快捷模板。取值以各家官方文档为准，型号差异由管理员在档位里增删。
var textThinkingPresets = map[string]TextThinkingConfig{
	"openai-gpt5": {Mode: ThinkingModeLevels, Levels: []string{"off", "minimal", "low", "medium", "high", "max"},
		Switch: ThinkingSwitchConfig{Kind: ThinkingSwitchEffortNone}, Intensity: ThinkingIntensityConfig{Kind: ThinkingIntensityEffort, Values: map[string]string{"max": "xhigh"}}},
	"openai-o": {Mode: ThinkingModeAlways, Levels: []string{"low", "medium", "high"}, Default: "medium",
		Switch: ThinkingSwitchConfig{Kind: ThinkingSwitchNone}, Intensity: ThinkingIntensityConfig{Kind: ThinkingIntensityEffort}},
	"claude-adaptive": {Mode: ThinkingModeAlways, Levels: []string{"low", "medium", "high", "max"},
		Switch: ThinkingSwitchConfig{Kind: ThinkingSwitchNone}, Intensity: ThinkingIntensityConfig{Kind: ThinkingIntensityEffort, Field: "output_config.effort"}},
	"claude-budget": {Mode: ThinkingModeLevels, Levels: []string{"off", "low", "medium", "high"}, Default: "off",
		Switch: ThinkingSwitchConfig{Kind: ThinkingSwitchOmit}, Intensity: ThinkingIntensityConfig{Kind: ThinkingIntensityBudget, Field: "thinking.budget_tokens"}},
	"gemini-3-pro": {Mode: ThinkingModeAlways, Levels: []string{"low", "high"},
		Switch: ThinkingSwitchConfig{Kind: ThinkingSwitchNone}, Intensity: ThinkingIntensityConfig{Kind: ThinkingIntensityGeminiLevel}},
	"gemini-3-flash": {Mode: ThinkingModeAlways, Levels: []string{"minimal", "low", "medium", "high"},
		Switch: ThinkingSwitchConfig{Kind: ThinkingSwitchNone}, Intensity: ThinkingIntensityConfig{Kind: ThinkingIntensityGeminiLevel}},
	"gemini-2.5": {Mode: ThinkingModeLevels, Levels: []string{"off", "low", "medium", "high"},
		Switch: ThinkingSwitchConfig{Kind: ThinkingSwitchBudgetZero}, Intensity: ThinkingIntensityConfig{Kind: ThinkingIntensityBudget}},
	"deepseek": {Mode: ThinkingModeLevels, Levels: []string{"off", "low", "high", "max"},
		Switch: ThinkingSwitchConfig{Kind: ThinkingSwitchThinkingType}, Intensity: ThinkingIntensityConfig{Kind: ThinkingIntensityEffort, Field: "reasoning_effort"}},
	"qwen-hybrid": {Mode: ThinkingModeToggle, Levels: []string{"off", "medium"},
		Switch: ThinkingSwitchConfig{Kind: ThinkingSwitchEnableFlag}, Intensity: ThinkingIntensityConfig{Kind: ThinkingIntensityNone}},
	"qwen-budget": {Mode: ThinkingModeLevels, Levels: []string{"off", "low", "medium", "high"},
		Switch: ThinkingSwitchConfig{Kind: ThinkingSwitchEnableFlag}, Intensity: ThinkingIntensityConfig{Kind: ThinkingIntensityBudget, Field: "thinking_budget"}},
	"thinking-type-toggle": {Mode: ThinkingModeToggle, Levels: []string{"off", "medium"},
		Switch: ThinkingSwitchConfig{Kind: ThinkingSwitchThinkingType}, Intensity: ThinkingIntensityConfig{Kind: ThinkingIntensityNone}},
	"openrouter": {Mode: ThinkingModeLevels, Levels: []string{"off", "minimal", "low", "medium", "high", "max"},
		Switch: ThinkingSwitchConfig{Kind: ThinkingSwitchEffortNone}, Intensity: ThinkingIntensityConfig{Kind: ThinkingIntensityEffort, Field: "reasoning.effort"}},
	"model-suffix": {Mode: ThinkingModeToggle, Levels: []string{"off", "medium"}, Default: "off",
		Switch: ThinkingSwitchConfig{Kind: ThinkingSwitchOmit}, Intensity: ThinkingIntensityConfig{Kind: ThinkingIntensityModelSuffix, Values: map[string]string{"medium": "-thinking"}}},
}

func thinkingLevelRank(level string) int {
	for index, item := range thinkingLevelOrder {
		if item == level {
			return index
		}
	}
	return -1
}

func isThinkingLevel(level string) bool { return thinkingLevelRank(level) >= 0 }

// ValidateThinkingLevelRequest 校验请求侧的思考档位：空、auto、deep 或统一档位。
func ValidateThinkingLevelRequest(value string) error {
	switch strings.TrimSpace(value) {
	case "", ThinkingIntentAuto, ThinkingIntentDeep:
		return nil
	}
	if isThinkingLevel(strings.TrimSpace(value)) {
		return nil
	}
	return BadAuthRequest(fmt.Sprintf("思考等级 %q 无效，仅支持 off、minimal、low、medium、high、max、auto、deep", value))
}

// normalizeTextThinkingConfig 展开预设并校验。wire 为空表示保存时无法确定协议格式，只做通用校验。
func normalizeTextThinkingConfig(value *TextThinkingConfig, wire string, maxOutputTokens int) (*TextThinkingConfig, error) {
	if value == nil {
		return nil, nil
	}
	config := *value
	config.Preset = strings.TrimSpace(config.Preset)
	if preset, ok := textThinkingPresets[config.Preset]; ok {
		if config.Mode == "" {
			config.Mode = preset.Mode
		}
		if config.Levels == nil {
			config.Levels = append([]string(nil), preset.Levels...)
		}
		if config.Default == "" && value.Mode == "" {
			config.Default = preset.Default
		}
		if config.Switch.Kind == "" {
			config.Switch = preset.Switch
		}
		if config.Intensity.Kind == "" {
			config.Intensity = preset.Intensity
			config.Intensity.Values = cloneStringMap(preset.Intensity.Values)
		}
	}
	config.Mode = strings.TrimSpace(config.Mode)
	if config.Mode == ThinkingModeNone {
		return &TextThinkingConfig{Preset: config.Preset, Mode: ThinkingModeNone, Switch: ThinkingSwitchConfig{Kind: ThinkingSwitchNone}, Intensity: ThinkingIntensityConfig{Kind: ThinkingIntensityNone}}, nil
	}
	if config.Mode != ThinkingModeToggle && config.Mode != ThinkingModeLevels && config.Mode != ThinkingModeAlways {
		return nil, BadAuthRequest("思考模式仅支持 none、toggle、levels 或 always")
	}
	levels, err := normalizeThinkingLevels(config.Levels)
	if err != nil {
		return nil, err
	}
	config.Levels = levels
	hasOff := thinkingLevelsContain(levels, ThinkingLevelOff)
	switch config.Mode {
	case ThinkingModeToggle:
		if len(levels) != 2 || !hasOff {
			return nil, BadAuthRequest("开关型思考只能配置「关闭」加一个开启档位")
		}
	case ThinkingModeAlways:
		if hasOff {
			return nil, BadAuthRequest("必须思考的模型不能包含「关闭」档位")
		}
	case ThinkingModeLevels:
		if len(levels) < 2 {
			return nil, BadAuthRequest("分档思考至少需要两个档位")
		}
	}
	config.Default = strings.TrimSpace(config.Default)
	if config.Default != "" && !thinkingLevelsContain(levels, config.Default) {
		return nil, BadAuthRequest("默认思考档位必须属于支持的档位")
	}
	config.Switch.Kind = strings.TrimSpace(config.Switch.Kind)
	switch config.Switch.Kind {
	case ThinkingSwitchNone:
		if hasOff {
			return nil, BadAuthRequest("思考开关为「不能关闭」时不能包含「关闭」档位")
		}
	case ThinkingSwitchOmit, ThinkingSwitchEffortNone, ThinkingSwitchEnableFlag, ThinkingSwitchBudgetZero:
	case ThinkingSwitchThinkingType:
		config.Switch.OnValue = strings.TrimSpace(config.Switch.OnValue)
		switch config.Switch.OnValue {
		case "", "enabled", "auto", "adaptive":
		default:
			return nil, BadAuthRequest("thinking.type 开启值仅支持 enabled、auto 或 adaptive")
		}
	default:
		return nil, BadAuthRequest("思考开关方式无效")
	}
	if err := normalizeThinkingIntensity(&config.Intensity, levels, maxOutputTokens); err != nil {
		return nil, err
	}
	if config.Switch.Kind == ThinkingSwitchEffortNone && config.Intensity.Kind != ThinkingIntensityEffort {
		return nil, BadAuthRequest("「effort 发 none 关闭」需要强度方式为 effort")
	}
	if config.Switch.Kind == ThinkingSwitchBudgetZero && config.Intensity.Kind != ThinkingIntensityBudget {
		return nil, BadAuthRequest("「预算发 0 关闭」需要强度方式为 budget")
	}
	if wire != "" {
		if err := validateTextThinkingWire(&config, wire); err != nil {
			return nil, err
		}
	}
	return &config, nil
}

func normalizeThinkingLevels(values []string) ([]string, error) {
	seen := map[string]bool{}
	for _, value := range values {
		level := strings.TrimSpace(value)
		if !isThinkingLevel(level) {
			return nil, BadAuthRequest(fmt.Sprintf("思考档位 %q 无效", value))
		}
		seen[level] = true
	}
	levels := make([]string, 0, len(seen))
	for _, level := range thinkingLevelOrder {
		if seen[level] {
			levels = append(levels, level)
		}
	}
	if len(levels) == 0 {
		return nil, BadAuthRequest("请至少配置一个思考档位")
	}
	return levels, nil
}

func normalizeThinkingIntensity(value *ThinkingIntensityConfig, levels []string, maxOutputTokens int) error {
	value.Kind = strings.TrimSpace(value.Kind)
	value.Field = strings.TrimSpace(value.Field)
	for level := range value.Values {
		if !thinkingLevelsContain(levels, level) || level == ThinkingLevelOff {
			return BadAuthRequest(fmt.Sprintf("思考取值映射里的档位 %q 不在支持的开启档位中", level))
		}
	}
	for level := range value.Budgets {
		if !thinkingLevelsContain(levels, level) || level == ThinkingLevelOff {
			return BadAuthRequest(fmt.Sprintf("思考预算里的档位 %q 不在支持的开启档位中", level))
		}
	}
	switch value.Kind {
	case ThinkingIntensityNone:
		value.Field, value.Values, value.Budgets = "", nil, nil
	case ThinkingIntensityEffort:
		value.Budgets = nil
		for level, wireValue := range value.Values {
			if strings.TrimSpace(wireValue) == "" {
				return BadAuthRequest(fmt.Sprintf("档位 %s 的上游取值不能为空", level))
			}
		}
		if value.Field != "" && !thinkingFieldAllowed(thinkingEffortFields, value.Field) {
			return BadAuthRequest("思考强度字段不在允许的写入位置中")
		}
	case ThinkingIntensityBudget:
		value.Values = nil
		for level, budget := range value.Budgets {
			if budget < thinkingBudgetFloor {
				return BadAuthRequest(fmt.Sprintf("档位 %s 的思考预算不能小于 %d", level, thinkingBudgetFloor))
			}
			if maxOutputTokens > 0 && budget >= maxOutputTokens {
				return BadAuthRequest(fmt.Sprintf("档位 %s 的思考预算必须小于最大输出 Token", level))
			}
		}
		if value.Field != "" && !thinkingFieldAllowed(thinkingBudgetFields, value.Field) {
			return BadAuthRequest("思考预算字段不在允许的写入位置中")
		}
	case ThinkingIntensityGeminiLevel:
		value.Field, value.Budgets = "", nil
	case ThinkingIntensityModelSuffix:
		value.Field, value.Budgets = "", nil
		for _, level := range levels {
			if level == ThinkingLevelOff {
				continue
			}
			suffix := strings.TrimSpace(value.Values[level])
			if suffix == "" || strings.ContainsAny(suffix, " /?#") {
				return BadAuthRequest(fmt.Sprintf("档位 %s 需要配置不含空格和斜杠的模型名后缀", level))
			}
		}
	default:
		return BadAuthRequest("思考强度方式无效")
	}
	return nil
}

func validateTextThinkingWire(config *TextThinkingConfig, wire string) error {
	if wires, ok := thinkingSwitchWires[config.Switch.Kind]; ok && !containsCapabilityString(wires, wire) {
		return BadAuthRequest(fmt.Sprintf("当前接口格式（%s）不支持这种思考开关写法", wire))
	}
	switch config.Intensity.Kind {
	case ThinkingIntensityEffort:
		if _, ok := thinkingEffortField(config.Intensity.Field, wire); !ok {
			return BadAuthRequest(fmt.Sprintf("当前接口格式（%s）不支持 effort 思考强度或该字段", wire))
		}
	case ThinkingIntensityBudget:
		if _, ok := thinkingBudgetField(config.Intensity.Field, wire); !ok {
			return BadAuthRequest(fmt.Sprintf("当前接口格式（%s）不支持思考预算或该字段", wire))
		}
	case ThinkingIntensityGeminiLevel:
		if wire != thinkingWireGemini {
			return BadAuthRequest("thinkingLevel 只适用于 Gemini generateContent 接口")
		}
	case ThinkingIntensityModelSuffix:
		if wire == thinkingWireGemini {
			return BadAuthRequest("Gemini generateContent 的模型名在请求路径里，不能用模型名后缀切换思考")
		}
	}
	if wire == thinkingWireGemini && config.Intensity.Kind == ThinkingIntensityNone && config.Mode != ThinkingModeAlways {
		return BadAuthRequest("Gemini generateContent 需要配置 thinkingLevel 或 thinkingBudget")
	}
	return nil
}

func thinkingFieldAllowed(fields map[string][]string, field string) bool {
	for _, items := range fields {
		if containsCapabilityString(items, field) {
			return true
		}
	}
	return false
}

func thinkingEffortField(field, wire string) (string, bool) {
	return thinkingWireField(thinkingEffortFields, field, wire)
}

func thinkingBudgetField(field, wire string) (string, bool) {
	return thinkingWireField(thinkingBudgetFields, field, wire)
}

func thinkingWireField(fields map[string][]string, field, wire string) (string, bool) {
	allowed := fields[wire]
	if len(allowed) == 0 {
		return "", false
	}
	if field == "" {
		return allowed[0], true
	}
	return field, containsCapabilityString(allowed, field)
}

func thinkingLevelsContain(levels []string, level string) bool {
	return containsCapabilityString(levels, level)
}

func cloneStringMap(values map[string]string) map[string]string {
	if values == nil {
		return nil
	}
	result := make(map[string]string, len(values))
	for key, value := range values {
		result[key] = value
	}
	return result
}

// legacyTextThinkingConfig 是模型未声明思考能力时的行为：开 = medium，默认关闭。
// Claude 网关可能默认开启思考，关闭时显式发送 disabled；其他协议省略参数。
// Gemini 和插件自定义接口没有通用写法，视为不支持。
func legacyTextThinkingConfig(wire string) *TextThinkingConfig {
	switch wire {
	case protocolcontract.TextWireChatCompletion, protocolcontract.TextWireResponses:
		return &TextThinkingConfig{Mode: ThinkingModeToggle, Levels: []string{"off", "medium"}, Default: "off",
			Switch: ThinkingSwitchConfig{Kind: ThinkingSwitchOmit}, Intensity: ThinkingIntensityConfig{Kind: ThinkingIntensityEffort}}
	case protocolcontract.TextWireClaude:
		return &TextThinkingConfig{Mode: ThinkingModeToggle, Levels: []string{"off", "medium"}, Default: "off",
			Switch: ThinkingSwitchConfig{Kind: ThinkingSwitchThinkingType}, Intensity: ThinkingIntensityConfig{Kind: ThinkingIntensityBudget, Budgets: map[string]int{"medium": thinkingBudgetFloor}}}
	default:
		return &TextThinkingConfig{Mode: ThinkingModeNone}
	}
}

// effectiveTextThinkingConfig 取本次请求实际生效的思考能力：模型声明优先，未声明按协议兜底。
func effectiveTextThinkingConfig(input canvasGenerationInput, wire string) *TextThinkingConfig {
	if capability := input.Config.CapabilityConfig; capability != nil && capability.Text != nil && capability.Text.Thinking != nil {
		return capability.Text.Thinking
	}
	return legacyTextThinkingConfig(wire)
}

// resolveThinkingLevel 把请求的档位或意图归一到模型实际支持的档位。
// 返回空字符串表示不发送任何思考参数，交给上游默认行为。
func resolveThinkingLevel(config *TextThinkingConfig, requested string) (string, error) {
	requested = strings.TrimSpace(requested)
	if err := ValidateThinkingLevelRequest(requested); err != nil {
		return "", err
	}
	if config == nil || config.Mode == ThinkingModeNone || len(config.Levels) == 0 {
		return "", nil
	}
	switch requested {
	case "", ThinkingIntentAuto:
		return config.Default, nil
	case ThinkingIntentDeep:
		deepest := ""
		for _, level := range config.Levels {
			if level != ThinkingLevelOff && level != ThinkingLevelMax {
				deepest = level
			}
		}
		if deepest == "" {
			deepest = config.Levels[len(config.Levels)-1]
		}
		return deepest, nil
	}
	if thinkingLevelsContain(config.Levels, requested) {
		return requested, nil
	}
	if requested == ThinkingLevelOff {
		// 不能关闭的模型降到最低开启档，而不是发一个上游会拒绝的关闭参数。
		return config.Levels[0], nil
	}
	// 就近取档，等距取低档；开启请求不会被归到 off。
	target := thinkingLevelRank(requested)
	best, bestDistance := "", 0
	for _, level := range config.Levels {
		if level == ThinkingLevelOff {
			continue
		}
		distance := thinkingLevelRank(level) - target
		if distance < 0 {
			distance = -distance
		}
		if best == "" || distance < bestDistance {
			best, bestDistance = level, distance
		}
	}
	if best == "" {
		return ThinkingLevelOff, nil
	}
	return best, nil
}

// textThinkingWire 是本次请求写入思考参数时使用的协议格式。agent 为 true 时取插件的 agent 路径格式。
func textThinkingWire(ctx context.Context, interfaceType string, agent bool) string {
	switch interfaceType {
	case string(model.ChannelInterfaceChatCompletion):
		return protocolcontract.TextWireChatCompletion
	case string(model.ChannelInterfaceOpenAIResponse):
		return protocolcontract.TextWireResponses
	case string(model.ChannelInterfaceClaudeAPI):
		return protocolcontract.TextWireClaude
	}
	wire := declaredTextWire(ctx, interfaceType)
	if agent {
		wire = declaredAgentWire(ctx, interfaceType)
	}
	if wire != "" {
		return wire
	}
	if adapter, ok := declarativeProtocolAdapterForContext(ctx, interfaceType); ok {
		summary := adapter.Metadata().Create
		if agent {
			summary = adapter.Metadata().Agent
		}
		if isGeminiGenerateContentPath(protocolcontract.OperationPath(summary)) {
			return thinkingWireGemini
		}
	}
	if interfaceType == "" {
		// 旧任务没有接口类型时走 Responses 兜底，与 runLegacyTextTask 一致。
		return protocolcontract.TextWireResponses
	}
	return ""
}

// thinkingWireForProtocol 在后台保存模型配置时确定协议格式；确定不了返回空，只做通用校验。
func thinkingWireForProtocol(protocol string, registry *protocolcontract.Registry) string {
	switch protocol {
	case string(model.ChannelInterfaceChatCompletion):
		return protocolcontract.TextWireChatCompletion
	case string(model.ChannelInterfaceOpenAIResponse):
		return protocolcontract.TextWireResponses
	case string(model.ChannelInterfaceClaudeAPI):
		return protocolcontract.TextWireClaude
	}
	if registry == nil {
		return ""
	}
	adapter, ok := registry.Resolve(protocol)
	if !ok {
		return ""
	}
	metadata := adapter.Metadata()
	if metadata.TextWire != "" {
		return metadata.TextWire
	}
	if metadata.AgentWire != "" {
		return metadata.AgentWire
	}
	if isGeminiGenerateContentPath(protocolcontract.OperationPath(metadata.Create)) {
		return thinkingWireGemini
	}
	return ""
}

func isGeminiGenerateContentPath(path string) bool {
	path = strings.ToLower(strings.TrimSpace(path))
	if index := strings.IndexAny(path, "?#"); index >= 0 {
		path = path[:index]
	}
	return strings.HasSuffix(path, ":generatecontent") || strings.HasSuffix(path, ":streamgeneratecontent")
}

// textThinkingPlan 是一次请求解析后的思考决定。
type textThinkingPlan struct {
	Config *TextThinkingConfig
	// Level 为空表示不发送思考参数。
	Level string
}

func (p textThinkingPlan) enabled() bool {
	return p.Level != "" && p.Level != ThinkingLevelOff
}

func resolveTextThinkingPlan(input canvasGenerationInput, wire string) (textThinkingPlan, error) {
	config := effectiveTextThinkingConfig(input, wire)
	level, err := resolveThinkingLevel(config, input.TextOptions.ThinkingLevel)
	if err != nil {
		return textThinkingPlan{}, err
	}
	return textThinkingPlan{Config: config, Level: level}, nil
}

// applyTextThinking 按模型声明把思考档位写进上游请求体，返回是否开启了思考。
// 请求档位在任务创建与执行入口已校验；这里解析失败时不写参数。
func applyTextThinking(body map[string]interface{}, input canvasGenerationInput, wire string) bool {
	if wire == protocolcontract.TextWireClaude {
		// Messages API no longer accepts sampling controls; remove them even when thinking is omitted.
		delete(body, "temperature")
		delete(body, "top_p")
		delete(body, "top_k")
	}
	plan, err := resolveTextThinkingPlan(input, wire)
	if err != nil || plan.Level == "" || plan.Config == nil {
		return false
	}
	return writeTextThinking(body, plan, wire, input.MaxOutputTokens)
}

func writeTextThinking(body map[string]interface{}, plan textThinkingPlan, wire string, maxOutputTokens int) bool {
	config := plan.Config
	level := plan.Level
	if level == ThinkingLevelOff {
		switch config.Switch.Kind {
		case ThinkingSwitchEffortNone:
			if field, ok := thinkingEffortField(config.Intensity.Field, wire); ok {
				setThinkingField(body, field, "none")
			}
		case ThinkingSwitchEnableFlag:
			body["enable_thinking"] = false
		case ThinkingSwitchThinkingType:
			body["thinking"] = map[string]interface{}{"type": "disabled"}
		case ThinkingSwitchBudgetZero:
			if field, ok := thinkingBudgetField(config.Intensity.Field, wire); ok {
				setThinkingField(body, field, 0)
			}
		}
		return false
	}
	switch config.Switch.Kind {
	case ThinkingSwitchEnableFlag:
		body["enable_thinking"] = true
	case ThinkingSwitchThinkingType:
		body["thinking"] = map[string]interface{}{"type": defaultString(config.Switch.OnValue, "enabled")}
	}
	switch config.Intensity.Kind {
	case ThinkingIntensityEffort:
		field, ok := thinkingEffortField(config.Intensity.Field, wire)
		if !ok {
			return false
		}
		setThinkingField(body, field, defaultString(config.Intensity.Values[level], level))
		if wire == protocolcontract.TextWireClaude {
			body["thinking"] = map[string]interface{}{"type": "adaptive"}
		}
	case ThinkingIntensityBudget:
		field, ok := thinkingBudgetField(config.Intensity.Field, wire)
		if !ok {
			return false
		}
		budget := thinkingBudgetFor(config, level, thinkingOutputLimit(body, wire, maxOutputTokens))
		if wire == protocolcontract.TextWireClaude {
			body["thinking"] = map[string]interface{}{"type": "enabled", "budget_tokens": budget}
			ensureClaudeThinkingMaxTokens(body, budget, maxOutputTokens)
		} else {
			setThinkingField(body, field, budget)
		}
	case ThinkingIntensityGeminiLevel:
		setThinkingField(body, "generationConfig.thinkingConfig.thinkingLevel", defaultString(config.Intensity.Values[level], level))
	case ThinkingIntensityModelSuffix:
		if modelName, ok := body["model"].(string); ok && modelName != "" {
			suffix := config.Intensity.Values[level]
			if !strings.HasSuffix(modelName, suffix) {
				body["model"] = modelName + suffix
			}
		}
	}
	if wire == protocolcontract.TextWireResponses {
		if reasoning, ok := body["reasoning"].(map[string]interface{}); ok {
			reasoning["summary"] = "auto"
		} else {
			body["reasoning"] = map[string]interface{}{"summary": "auto"}
		}
	}
	return true
}

// thinkingOutputLimit 取本次请求的输出上限，预算按它的比例分配。
func thinkingOutputLimit(body map[string]interface{}, wire string, maxOutputTokens int) int {
	for _, field := range []string{"max_tokens", "max_output_tokens", "max_completion_tokens"} {
		if value := intFromAny(body[field]); value > 0 {
			return value
		}
	}
	if wire == thinkingWireGemini {
		if config, ok := body["generationConfig"].(map[string]interface{}); ok {
			if value := intFromAny(config["maxOutputTokens"]); value > 0 {
				return value
			}
		}
	}
	if maxOutputTokens > 0 {
		return maxOutputTokens
	}
	return thinkingBudgetFallbackLimit
}

func thinkingBudgetFor(config *TextThinkingConfig, level string, limit int) int {
	if budget := config.Intensity.Budgets[level]; budget > 0 {
		return budget
	}
	ratio := thinkingBudgetRatios[level]
	if ratio == 0 {
		ratio = thinkingBudgetRatios[ThinkingLevelMedium]
	}
	budget := int(float64(limit) * ratio)
	if budget < thinkingBudgetFloor {
		budget = thinkingBudgetFloor
	}
	return budget
}

// ensureClaudeThinkingMaxTokens 保证 max_tokens 大于思考预算，并给正文和工具参数留出空间。
func ensureClaudeThinkingMaxTokens(body map[string]interface{}, budget, maxOutputTokens int) {
	current := intFromAny(body["max_tokens"])
	required := budget + thinkingBudgetFloor
	if current > budget {
		return
	}
	if maxOutputTokens > 0 && required > maxOutputTokens {
		required = maxOutputTokens
	}
	if required <= budget {
		required = budget + 1
	}
	body["max_tokens"] = required
}

func setThinkingField(body map[string]interface{}, path string, value interface{}) {
	parts := strings.Split(path, ".")
	current := body
	for _, part := range parts[:len(parts)-1] {
		next, ok := current[part].(map[string]interface{})
		if !ok {
			next = map[string]interface{}{}
			current[part] = next
		}
		current = next
	}
	current[parts[len(parts)-1]] = value
}

func intFromAny(value interface{}) int {
	switch number := value.(type) {
	case int:
		return number
	case int64:
		return int(number)
	case float64:
		return int(number)
	}
	return 0
}

// markAgentReasoningWire 给带思考内容的 Agent 结果记上产生它的协议。思考签名和
// reasoning_content 只能回传给同一协议，运行中换模型后必须丢弃。
func markAgentReasoningWire(result map[string]interface{}, wire string) {
	if result == nil {
		return
	}
	if stringField(result, "reasoning") != "" || len(interfaceSlice(result["reasoningBlocks"])) > 0 {
		result["reasoningWire"] = wire
	}
}

// agentReasoningPassback 是模型步交给 Pi 运行时保存的思考回传内容，随 Pi 的 thinking 块
// （thinkingSignature 字段）往返，下一步再还原到 canonical assistant 消息上。
type agentReasoningPassback struct {
	Wire   string        `json:"wire"`
	Blocks []interface{} `json:"blocks,omitempty"`
}

func decodeAgentReasoningPassback(raw string) (agentReasoningPassback, bool) {
	var passback agentReasoningPassback
	if !strings.HasPrefix(strings.TrimSpace(raw), "{") || json.Unmarshal([]byte(raw), &passback) != nil || passback.Wire == "" {
		return agentReasoningPassback{}, false
	}
	return passback, true
}

// canonicalAssistantReasoning 把模型步结果里的思考内容整理成 canonical assistant 消息字段。
func canonicalAssistantReasoning(message map[string]any, reasoning, wire string, blocks []interface{}) {
	if wire == "" {
		return
	}
	if wire == protocolcontract.TextWireClaude {
		if len(blocks) > 0 {
			message["reasoning_blocks"] = blocks
			message["reasoning_wire"] = wire
		}
		return
	}
	if wire == protocolcontract.TextWireChatCompletion && strings.TrimSpace(reasoning) != "" {
		message["reasoning_content"] = reasoning
		message["reasoning_wire"] = wire
	}
}

// attachCanonicalAgentReasoning 只回传同协议产生的思考内容；Claude 块必须原样带签名。
// 原始协议内容不能按展示限制截断，整体状态容量仍由已有 checkpoint 边界校验。
func attachCanonicalAgentReasoning(converted, message map[string]interface{}, claude bool) {
	wire := stringField(message, "reasoning_wire")
	if claude {
		if wire == protocolcontract.TextWireClaude {
			if blocks := interfaceSlice(message["reasoning_blocks"]); len(blocks) > 0 {
				converted["reasoning_blocks"] = blocks
			}
		}
		return
	}
	if wire == protocolcontract.TextWireChatCompletion {
		if reasoning := stringField(message, "reasoning_content"); reasoning != "" {
			converted["reasoning_content"] = reasoning
		}
	}
}

// claudeToolLoopMissingThinking 判断会话是否停在一轮没有 Claude 思考块的工具循环里：
// 最后一条 user 消息之后存在工具调用，且最近的工具调用消息没有同协议的思考块。
func claudeToolLoopMissingThinking(source *canonicalAgentRequest) bool {
	if source == nil {
		return false
	}
	for index := len(source.Messages) - 1; index >= 0; index-- {
		message := source.Messages[index]
		switch {
		case stringField(message, "role") == "user":
			return false
		case stringField(message, "type") == "function_call":
			return true
		case stringField(message, "role") == "assistant" && len(canonicalAgentToolCalls(message["tool_calls"])) > 0:
			return stringField(message, "reasoning_wire") != protocolcontract.TextWireClaude || len(interfaceSlice(message["reasoning_blocks"])) == 0
		}
	}
	return false
}
