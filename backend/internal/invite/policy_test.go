package invite

import (
	"testing"

	"yingce/backend/internal/model"
)

func TestDefaultInvitePolicyMatchesRequirements(t *testing.T) {
	policy := DefaultInvitePolicy()
	if policy.Enabled {
		t.Fatal("默认应关闭邀请功能")
	}
	if policy.Level != 1 {
		t.Fatalf("默认层级 = %d, want 1", policy.Level)
	}
	if policy.L1RateBP != 500 || policy.L2RateBP != 300 {
		t.Fatalf("默认奖励率 = %d/%d, want 500/300", policy.L1RateBP, policy.L2RateBP)
	}
	if policy.WithdrawEnabled {
		t.Fatal("提现默认应关闭")
	}
	if policy.WithdrawMinFen != 100 || policy.WithdrawDailyLimit != 3 || policy.WithdrawFeeBP != 0 {
		t.Fatalf("提现默认配置错误: %+v", policy)
	}
	if policy.TransferEnabled || policy.TransferRateMilli != 1000 || policy.TransferMinFen != 100 {
		t.Fatalf("划转默认配置错误: %+v", policy)
	}
	if err := NormalizeAndValidate(&policy); err != nil {
		t.Fatalf("默认配置应通过校验: %v", err)
	}
}

func TestNormalizeAndValidateBoundaries(t *testing.T) {
	base := DefaultInvitePolicy()

	invalid := base
	invalid.Level = 3
	if err := NormalizeAndValidate(&invalid); err == nil {
		t.Fatal("层级 3 应校验失败")
	}

	invalid = base
	invalid.Enabled = true
	invalid.RewardScopes = nil
	if err := NormalizeAndValidate(&invalid); err == nil {
		t.Fatal("开启邀请但无奖励范围应校验失败")
	}

	invalid = base
	invalid.L1RateBP = 10001
	if err := NormalizeAndValidate(&invalid); err == nil {
		t.Fatal("奖励率超过 100% 应校验失败")
	}

	invalid = base
	invalid.WithdrawEnabled = true
	invalid.WithdrawMethods = nil
	if err := NormalizeAndValidate(&invalid); err == nil {
		t.Fatal("开启提现但无方式应校验失败")
	}

	invalid = base
	invalid.WithdrawMinFen = 0
	if err := NormalizeAndValidate(&invalid); err == nil {
		t.Fatal("提现最低金额低于 0.01 元应校验失败")
	}

	invalid = base
	invalid.TransferRateMilli = 0
	if err := NormalizeAndValidate(&invalid); err == nil {
		t.Fatal("划转比例 0 应校验失败")
	}

	valid := base
	valid.WithdrawEnabled = true
	valid.WithdrawMethods = []string{"wechat", "alipay", "bank", "wechat", "unknown"}
	valid.WithdrawFeeBP = 300
	valid.Level = 2
	if err := NormalizeAndValidate(&valid); err != nil {
		t.Fatalf("合法配置不应报错: %v", err)
	}
	if len(valid.WithdrawMethods) != 3 {
		t.Fatalf("提现方式应去重并过滤未知项: %v", valid.WithdrawMethods)
	}
	if len(valid.RewardScopes) != 1 || valid.RewardScopes[0] != model.InviteRewardSourceProduct {
		t.Fatalf("奖励范围应保持稳定顺序: %v", valid.RewardScopes)
	}
}

func TestParseInvitePolicyEmptyFallsBackToDefault(t *testing.T) {
	policy, err := ParseInvitePolicy("")
	if err != nil {
		t.Fatal(err)
	}
	if policy.Enabled || policy.TransferEnabled || policy.WithdrawEnabled || policy.L1RateBP != 500 {
		t.Fatalf("空配置应回落默认: %+v", policy)
	}
	if _, err := ParseInvitePolicy("{invalid"); err == nil {
		t.Fatal("非法 JSON 应报错")
	}
	if _, err := ParseInvitePolicy(`{"withdrawFeeBp":10001}`); err == nil {
		t.Fatal("非法持久化费率应报错")
	}
}

func TestResolveRatesPrefersItemOverride(t *testing.T) {
	l1 := int64(800)
	l2 := int64(100)
	policy := DefaultInvitePolicy()
	policy.Level = 2
	policy.ProductRates = map[string]ItemRate{"product-1": {L1RateBP: &l1, L2RateBP: &l2}}

	l1Rate, l2Rate := ResolveRates(&policy, model.InviteRewardSourceProduct, "product-1")
	if l1Rate != 800 || l2Rate != 100 {
		t.Fatalf("单品覆盖未生效: %d/%d", l1Rate, l2Rate)
	}
	l1Rate, l2Rate = ResolveRates(&policy, model.InviteRewardSourceProduct, "product-other")
	if l1Rate != 500 || l2Rate != 300 {
		t.Fatalf("未覆盖单品应回落通用: %d/%d", l1Rate, l2Rate)
	}
	partial := DefaultInvitePolicy()
	partial.Level = 2
	partial.ProductRates = map[string]ItemRate{"product-1": {L1RateBP: &l1}}
	l1Rate, l2Rate = ResolveRates(&partial, model.InviteRewardSourceProduct, "product-1")
	if l1Rate != 800 || l2Rate != 300 {
		t.Fatalf("部分覆盖应保留未覆盖项的通用值: %d/%d", l1Rate, l2Rate)
	}
	levelOne := DefaultInvitePolicy()
	l1Rate, l2Rate = ResolveRates(&levelOne, model.InviteRewardSourceProduct, "product-1")
	if l1Rate != 500 || l2Rate != 0 {
		t.Fatalf("一级层级下二级率必须为 0: %d/%d", l1Rate, l2Rate)
	}
}

func TestScopeAllows(t *testing.T) {
	policy := DefaultInvitePolicy()
	policy.RewardScopes = []string{model.InviteRewardSourceProduct}
	if !ScopeAllows(&policy, model.InviteRewardSourceProduct) {
		t.Fatal("product 应在范围内")
	}
	if ScopeAllows(&policy, "unsupported") {
		t.Fatal("未知类型不应在范围内")
	}
}

func TestRewardAmountMicroYuanExactness(t *testing.T) {
	cases := []struct {
		amountFen int64
		rateBP    int64
		want      int64
	}{
		{10000, 500, 5_000_000}, // 100 元 × 5% = 5 元
		{10000, 300, 3_000_000}, // 100 元 × 3% = 3 元
		{9999, 500, 4_999_500},  // 非整除金额仍精确
		{1, 1, 1},               // 0.01 元 × 0.01% = 1 微元
		{100, 0, 0},             // 0 率无奖励
		{0, 500, 0},             // 0 元订单无奖励
		{-1, 500, 0},            // 非法金额防御
	}
	for _, tc := range cases {
		if got := RewardAmountMicroYuan(tc.amountFen, tc.rateBP); got != tc.want {
			t.Fatalf("RewardAmountMicroYuan(%d, %d) = %d, want %d", tc.amountFen, tc.rateBP, got, tc.want)
		}
	}
}

func TestValidateInviteCode(t *testing.T) {
	if err := ValidateInviteCode(""); err != nil {
		t.Fatalf("空邀请码应合法（选填）: %v", err)
	}
	code, err := GenerateInviteCode()
	if err != nil {
		t.Fatal(err)
	}
	if err := ValidateInviteCode(code); err != nil {
		t.Fatalf("生成的邀请码应合法: %v", err)
	}
	if len(code) != 8 {
		t.Fatalf("邀请码长度 = %d, want 8", len(code))
	}
	for _, bad := range []string{"123", "0OIL2ABC", "ABCDEF,!"} {
		if err := ValidateInviteCode(bad); err == nil {
			t.Fatalf("非法邀请码 %q 应报错", bad)
		}
	}
	if got := NormalizeInviteCode(" abcd2345 "); got != "ABCD2345" {
		t.Fatalf("NormalizeInviteCode = %q", got)
	}
}
