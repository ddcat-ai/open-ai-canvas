// Package invite 承载邀请奖励域的纯策略逻辑：邀请配置的默认值与校验、邀请码工具、
// 奖励率解析与金额计算。auth 与 app 共用本包；本包只依赖 model，不得反向依赖 service/app。
package invite

import (
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"yingce/backend/internal/model"
)

// SettingKey 是邀请配置在 SystemSetting 中的键。值为整个 InvitePolicy 的 JSON，
// 不含需要加密的密钥类字段。
const SettingKey = "invite_policy"

// ItemRate 单个充值商品的奖励率覆盖；nil 表示未配置，回落通用一级/二级奖励率。
type ItemRate struct {
	L1RateBP *int64 `json:"l1RateBp,omitempty"`
	L2RateBP *int64 `json:"l2RateBp,omitempty"`
}

// InvitePolicy 邀请功能配置。金额字段以分（fen）存储，比率以基点（BP，1% = 100bp）存储，
// 划转比例以千分数存储（rateMilli = 比例 × 1000）。
type InvitePolicy struct {
	Enabled      bool     `json:"enabled"`
	Level        int      `json:"level"`        // 1 或 2
	RewardScopes []string `json:"rewardScopes"` // model.InviteRewardSource 子集

	L1RateBP int64 `json:"l1RateBp"` // 默认 500（5%）
	L2RateBP int64 `json:"l2RateBp"` // 默认 300（3%），Level=1 时不生效

	// RewardCountLimit 每名被邀请人最多前 N 笔订单产生奖励；0 = 无上限。
	RewardCountLimit int64 `json:"rewardCountLimit"`
	// InviteeCountLimit 每名邀请人下游（一级+二级）最多记录 N 名被邀请人；0 = 无限制。
	InviteeCountLimit int64 `json:"inviteeCountLimit"`
	AuditEnabled      bool  `json:"auditEnabled"`

	WithdrawEnabled    bool     `json:"withdrawEnabled"`
	WithdrawMinFen     int64    `json:"withdrawMinFen"`     // 默认 100（1 元），配置下限 1（0.01 元）
	WithdrawDailyLimit int64    `json:"withdrawDailyLimit"` // 默认 3；0 = 不限
	WithdrawFeeBP      int64    `json:"withdrawFeeBp"`      // 默认 0
	WithdrawMethods    []string `json:"withdrawMethods"`    // wechat|alipay|bank 子集

	TransferEnabled   bool  `json:"transferEnabled"`
	TransferRateMilli int64 `json:"transferRateMilli"` // 默认 1000（1 元 = 1 积分）
	TransferMinFen    int64 `json:"transferMinFen"`    // 默认 100（1 元）

	ProductRates map[string]ItemRate `json:"productRates,omitempty"`
}

// DefaultInvitePolicy 默认关闭邀请、提现和划转，管理员配置后才产生奖励。
func DefaultInvitePolicy() InvitePolicy {
	return InvitePolicy{
		Enabled:            false,
		Level:              1,
		RewardScopes:       []string{model.InviteRewardSourceProduct},
		L1RateBP:           500,
		L2RateBP:           300,
		WithdrawEnabled:    false,
		WithdrawMinFen:     100,
		WithdrawDailyLimit: 3,
		WithdrawFeeBP:      0,
		TransferEnabled:    false,
		TransferRateMilli:  1000,
		TransferMinFen:     100,
	}
}

// ParseInvitePolicy 从 SystemSetting JSON 解析配置；空值/无记录返回默认配置。
func ParseInvitePolicy(valueJSON string) (InvitePolicy, error) {
	trimmed := strings.TrimSpace(valueJSON)
	if trimmed == "" {
		return DefaultInvitePolicy(), nil
	}
	policy := DefaultInvitePolicy()
	if err := json.Unmarshal([]byte(trimmed), &policy); err != nil {
		return InvitePolicy{}, errors.New("邀请配置格式无效")
	}
	if err := NormalizeAndValidate(&policy); err != nil {
		return InvitePolicy{}, err
	}
	return policy, nil
}

// NormalizeAndValidate 归一化并校验配置；写入与读取共用同一套边界。
func NormalizeAndValidate(policy *InvitePolicy) error {
	if policy == nil {
		return errors.New("邀请配置不能为空")
	}
	if policy.Level != 1 && policy.Level != 2 {
		return errors.New("邀请层级只能是一级或二级")
	}
	if policy.RewardCountLimit < 0 || policy.InviteeCountLimit < 0 {
		return errors.New("邀请奖励次数与邀请人数上限不能为负数")
	}
	if err := validateScopes(policy); err != nil {
		return err
	}
	if err := validateRate("一级邀请奖励率", policy.L1RateBP); err != nil {
		return err
	}
	if policy.Level == 2 {
		if err := validateRate("二级邀请奖励率", policy.L2RateBP); err != nil {
			return err
		}
	}
	if policy.WithdrawMinFen < 1 {
		return errors.New("提现最低金额不能低于 0.01 元")
	}
	if policy.WithdrawDailyLimit < 0 {
		return errors.New("每日提现次数上限不能为负数")
	}
	if err := validateRate("提现手续费", policy.WithdrawFeeBP); err != nil {
		return err
	}
	policy.WithdrawMethods = normalizeScopes(policy.WithdrawMethods, []string{
		model.WithdrawMethodWechat, model.WithdrawMethodAlipay, model.WithdrawMethodBank,
	})
	if policy.WithdrawEnabled && len(policy.WithdrawMethods) == 0 {
		return errors.New("开启提现后必须至少选择一种提现方式")
	}
	if policy.TransferRateMilli < 1 {
		return errors.New("划转积分比例必须大于 0")
	}
	if policy.TransferMinFen < 1 {
		return errors.New("最低划转金额不能低于 0.01 元")
	}
	return validateItemRates(policy.ProductRates, "商品")
}

func validateScopes(policy *InvitePolicy) error {
	policy.RewardScopes = normalizeScopes(policy.RewardScopes, []string{
		model.InviteRewardSourceProduct,
	})
	if policy.Enabled && len(policy.RewardScopes) == 0 {
		return errors.New("开启邀请后必须至少选择一个奖励范围")
	}
	return nil
}

func validateItemRates(rates map[string]ItemRate, label string) error {
	for id, rate := range rates {
		if strings.TrimSpace(id) == "" {
			return fmt.Errorf("%s奖励率配置包含空 ID", label)
		}
		if rate.L1RateBP != nil {
			if err := validateRate(fmt.Sprintf("%s一级奖励率", label), *rate.L1RateBP); err != nil {
				return err
			}
		}
		if rate.L2RateBP != nil {
			if err := validateRate(fmt.Sprintf("%s二级奖励率", label), *rate.L2RateBP); err != nil {
				return err
			}
		}
	}
	return nil
}

func validateRate(label string, rateBP int64) error {
	if rateBP < 0 || rateBP > 10000 {
		return fmt.Errorf("%s必须在 0%% 到 100%% 之间", label)
	}
	return nil
}

// normalizeScopes 修剪、去重并只保留 allowed 中出现过的取值，保持稳定顺序。
func normalizeScopes(values []string, allowed []string) []string {
	seen := map[string]bool{}
	result := make([]string, 0, len(values))
	for _, value := range values {
		trimmed := strings.TrimSpace(value)
		if trimmed == "" || seen[trimmed] {
			continue
		}
		for _, candidate := range allowed {
			if trimmed == candidate {
				seen[trimmed] = true
				result = append(result, trimmed)
			}
		}
	}
	return result
}

// ScopeAllows 判断某来源订单是否在奖励范围内。
func ScopeAllows(policy *InvitePolicy, source string) bool {
	for _, scope := range policy.RewardScopes {
		if scope == source {
			return true
		}
	}
	return false
}

// ResolveRates 返回某笔订单适用的（一级, 二级）基点率：单品覆盖优先，回落通用配置；
// 层级为一级时二级率恒为 0。
func ResolveRates(policy *InvitePolicy, source string, itemID string) (int64, int64) {
	l1, l2 := policy.L1RateBP, policy.L2RateBP
	var override *ItemRate
	switch source {
	case model.InviteRewardSourceProduct:
		if policy.ProductRates != nil {
			if value, ok := policy.ProductRates[itemID]; ok {
				override = &value
			}
		}
	}
	if override != nil {
		if override.L1RateBP != nil {
			l1 = *override.L1RateBP
		}
		if override.L2RateBP != nil {
			l2 = *override.L2RateBP
		}
	}
	if policy.Level < 2 {
		l2 = 0
	}
	return l1, l2
}

// RewardAmountMicroYuan 由订单分金额与基点率计算奖励微元：
// 1 分 = 1e4 微元、1% = 100bp，因此 amountFen × rateBP 恰为微元且整数精确。
func RewardAmountMicroYuan(amountFen, rateBP int64) int64 {
	if amountFen <= 0 || rateBP <= 0 {
		return 0
	}
	return amountFen * rateBP
}

// PublicPolicy 是匿名/用户端可见的策略投影：不含单品覆盖明细等内部配置。
type PublicPolicy struct {
	Enabled            bool     `json:"enabled"`
	Level              int      `json:"level"`
	RewardScopes       []string `json:"rewardScopes"`
	L1RateBP           int64    `json:"l1RateBp"`
	L2RateBP           int64    `json:"l2RateBp"`
	AuditEnabled       bool     `json:"auditEnabled"`
	WithdrawEnabled    bool     `json:"withdrawEnabled"`
	WithdrawMinFen     int64    `json:"withdrawMinFen"`
	WithdrawDailyLimit int64    `json:"withdrawDailyLimit"`
	WithdrawFeeBP      int64    `json:"withdrawFeeBp"`
	WithdrawMethods    []string `json:"withdrawMethods"`
	TransferEnabled    bool     `json:"transferEnabled"`
	TransferRateMilli  int64    `json:"transferRateMilli"`
	TransferMinFen     int64    `json:"transferMinFen"`
}

// PublicProjection 生成对外投影。
func PublicProjection(policy *InvitePolicy) PublicPolicy {
	if policy == nil {
		policy = &InvitePolicy{}
	}
	return PublicPolicy{
		Enabled:            policy.Enabled,
		Level:              policy.Level,
		RewardScopes:       append([]string{}, policy.RewardScopes...),
		L1RateBP:           policy.L1RateBP,
		L2RateBP:           policy.L2RateBP,
		AuditEnabled:       policy.AuditEnabled,
		WithdrawEnabled:    policy.WithdrawEnabled,
		WithdrawMinFen:     policy.WithdrawMinFen,
		WithdrawDailyLimit: policy.WithdrawDailyLimit,
		WithdrawFeeBP:      policy.WithdrawFeeBP,
		WithdrawMethods:    append([]string{}, policy.WithdrawMethods...),
		TransferEnabled:    policy.TransferEnabled,
		TransferRateMilli:  policy.TransferRateMilli,
		TransferMinFen:     policy.TransferMinFen,
	}
}
