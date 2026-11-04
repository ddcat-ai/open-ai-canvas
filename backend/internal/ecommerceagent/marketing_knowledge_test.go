package ecommerceagent

import (
	"strings"
	"testing"
)

func TestMarketingKnowledgeUsesObservedCategoryOnlyAsMethod(t *testing.T) {
	for _, tc := range []struct{ product, profile, risk string }{
		{"奶瓶", "母婴", "安全性"}, {"耳机", "数码", "降噪"},
		{"护肤品", "美妆", "功效"}, {"服装", "服装鞋履", "面料成分"},
		{"咖啡机", "家电", "功率"}, {"家具", "家居", "承重"}, {"食品", "食品", "营养"},
		{"盲盒手办", "玩具收藏", "授权"}, {"猫咪背包", "宠物", "适用品种"},
		{"旅行行李箱", "箱包旅行", "登机适配"}, {"银色项链", "珠宝首饰", "贵金属纯度"},
		{"跑步护膝", "运动健身", "训练效果"}, {"露营帐篷", "户外露营", "防水"},
		{"车载手机支架", "汽车用品", "适配车型"}, {"电钻工具", "工业工具", "扭矩"},
		{"文件夹", "办公文具", "容量"}, {"花盆", "园艺植物", "适用植物"},
		{"礼盒", "礼赠文创图书", "礼盒内容"},
	} {
		t.Run(tc.product, func(t *testing.T) {
			got := MarketingKnowledge(tc.product)
			for _, want := range []string{"品类营销方法：" + tc.profile, tc.risk, "不是该商品事实"} {
				if !strings.Contains(got, want) {
					t.Fatalf("missing %q in %q", want, got)
				}
			}
		})
	}
	if got := MarketingKnowledge(""); !strings.Contains(got, "先观察商品") || !strings.Contains(got, "不得当成事实") {
		t.Fatalf("unsafe fallback: %s", got)
	}
}

func TestMarketingKnowledgePrioritizesSpecificCategoriesOverBroadMatches(t *testing.T) {
	for _, tc := range []struct{ product, want string }{
		{"宠物背包", "品类营销方法：宠物"},
		{"手提包", "品类营销方法：箱包旅行"},
		{"瑜伽垫", "品类营销方法：运动健身"},
		{"园艺花盆", "品类营销方法：园艺植物"},
		{"车载手机支架", "品类营销方法：汽车用品"},
	} {
		if got := MarketingKnowledge(tc.product); !strings.Contains(got, tc.want) {
			t.Errorf("%q selected the wrong profile: %s", tc.product, got)
		}
	}
}
