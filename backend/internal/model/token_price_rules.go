package model

import (
	"encoding/json"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"time"
)

// TokenPricingLocation 是分时 Token 价格的判定时区。固定东八区，不依赖宿主机 tzdata。
var TokenPricingLocation = time.FixedZone("Asia/Shanghai", 8*60*60)

// MaxTokenPriceRules 是一个价格档最多配置的分时与上下文规则数。
const MaxTokenPriceRules = 48

// TokenPriceRule 是文本 Token 价格档上的一条分时与上下文规则。
// 时段按任务创建时的东八区时间判定，上下文档位按上游返回的真实输入 Token（含缓存命中与写入）判定；
// 规则按顺序取第一条同时命中的，全部未命中时使用价格档的基础 Token 单价。
type TokenPriceRule struct {
	Enabled bool `json:"enabled"`
	// Weekdays 取 1（周一）到 7（周日）。
	Weekdays []int `json:"weekdays"`
	// Start 含、End 不含，格式 HH:MM；End 可写 24:00 表示到当天结束。不支持跨零点，跨零点请拆成两条。
	Start string `json:"start"`
	End   string `json:"end"`
	// MinInputTokens 含、MaxInputTokens 不含；MaxInputTokens 为 0 表示不限上限。
	MinInputTokens                   int64 `json:"minInputTokens"`
	MaxInputTokens                   int64 `json:"maxInputTokens"`
	InputTokenPriceMicrocredits      int64 `json:"inputTokenPriceMicrocredits"`
	OutputTokenPriceMicrocredits     int64 `json:"outputTokenPriceMicrocredits"`
	CachedTokenPriceMicrocredits     int64 `json:"cachedTokenPriceMicrocredits"`
	CacheWriteTokenPriceMicrocredits int64 `json:"cacheWriteTokenPriceMicrocredits"`
}

// ParseTokenPriceClock 把 HH:MM 解析为当天第几分钟。allowEndOfDay 为 true 时接受 24:00。
func ParseTokenPriceClock(value string, allowEndOfDay bool) (int, error) {
	parts := strings.Split(strings.TrimSpace(value), ":")
	if len(parts) != 2 || len(parts[0]) != 2 || len(parts[1]) != 2 {
		return 0, fmt.Errorf("时间 %q 必须是 HH:MM", value)
	}
	hour, hourErr := strconv.Atoi(parts[0])
	minute, minuteErr := strconv.Atoi(parts[1])
	if hourErr != nil || minuteErr != nil || minute < 0 || minute > 59 || hour < 0 {
		return 0, fmt.Errorf("时间 %q 必须是 HH:MM", value)
	}
	total := hour*60 + minute
	if total > 24*60 || (total == 24*60 && !allowEndOfDay) || (hour == 24 && minute != 0) {
		return 0, fmt.Errorf("时间 %q 超出范围", value)
	}
	return total, nil
}

// MatchesTime 判断 at（任意时区，内部换算到东八区）是否落在规则的星期与时段内。
func (r TokenPriceRule) MatchesTime(at time.Time) bool {
	local := at.In(TokenPricingLocation)
	weekday := int(local.Weekday())
	if weekday == 0 {
		weekday = 7
	}
	dayMatched := false
	for _, day := range r.Weekdays {
		if day == weekday {
			dayMatched = true
			break
		}
	}
	if !dayMatched {
		return false
	}
	start, startErr := ParseTokenPriceClock(r.Start, false)
	end, endErr := ParseTokenPriceClock(r.End, true)
	if startErr != nil || endErr != nil {
		return false
	}
	minute := local.Hour()*60 + local.Minute()
	return minute >= start && minute < end
}

// BillingTokenPriceRule 是订单固化的一条候选规则：时段已在下单时判定，
// 结算只按真实输入 Token 选档。单价已按分组与计价货币换算为微积分。
type BillingTokenPriceRule struct {
	// Rule 是规则在价格档内的序号（从 1 起），用于账单回溯。
	Rule           int   `json:"rule"`
	MinInputTokens int64 `json:"minInputTokens"`
	MaxInputTokens int64 `json:"maxInputTokens"`
	Input          int64 `json:"input"`
	Output         int64 `json:"output"`
	Cached         int64 `json:"cached"`
	CacheWrite     int64 `json:"cacheWrite"`
}

// MatchBillingTokenPriceRule 按顺序取第一条覆盖 inputTokens 的候选规则；预授权与结算共用。
func MatchBillingTokenPriceRule(rules []BillingTokenPriceRule, inputTokens int64) (BillingTokenPriceRule, bool) {
	for _, rule := range rules {
		if inputTokens >= rule.MinInputTokens && (rule.MaxInputTokens <= 0 || inputTokens < rule.MaxInputTokens) {
			return rule, true
		}
	}
	return BillingTokenPriceRule{}, false
}

// TokenPriceSet 是一次结算实际使用的四类 Token 单价（微积分 / 百万 Token）。
type TokenPriceSet struct {
	Input, Output, Cached, CacheWrite int64
}

// EncodeBillingTokenPriceRules 生成订单快照；没有候选规则时返回空串，旧订单语义不变。
func EncodeBillingTokenPriceRules(rules []BillingTokenPriceRule) (string, error) {
	if len(rules) == 0 {
		return "", nil
	}
	encoded, err := json.Marshal(rules)
	if err != nil {
		return "", err
	}
	return string(encoded), nil
}

// BillingTokenPriceRules 解码订单固化的候选规则。快照损坏时返回错误，结算不能静默回退基础价。
func (o BillingOrder) BillingTokenPriceRules() ([]BillingTokenPriceRule, error) {
	raw := strings.TrimSpace(o.TokenPriceRulesJSON)
	if raw == "" {
		return nil, nil
	}
	var rules []BillingTokenPriceRule
	if err := json.Unmarshal([]byte(raw), &rules); err != nil {
		return nil, errors.New("订单分时 Token 价格快照无效")
	}
	return rules, nil
}

// TokenPrices 返回结算应使用的 Token 单价与命中的规则序号（0 表示基础价）。
func (o BillingOrder) TokenPrices(inputTokens int64) (TokenPriceSet, int, error) {
	base := TokenPriceSet{Input: o.InputTokenPriceMicrocredits, Output: o.OutputTokenPriceMicrocredits, Cached: o.CachedTokenPriceMicrocredits, CacheWrite: o.CacheWriteTokenPriceMicrocredits}
	rules, err := o.BillingTokenPriceRules()
	if err != nil {
		return base, 0, err
	}
	if rule, ok := MatchBillingTokenPriceRule(rules, inputTokens); ok {
		return TokenPriceSet{Input: rule.Input, Output: rule.Output, Cached: rule.Cached, CacheWrite: rule.CacheWrite}, rule.Rule, nil
	}
	return base, 0, nil
}
