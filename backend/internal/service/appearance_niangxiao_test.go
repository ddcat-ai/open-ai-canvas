package service

import "testing"

// niangxiao 酿笑坊皮肤是本地化资产（D-053 待办落地）：
// ①必须存在于默认主题列表；②整个默认列表必须能通过校验器（classic 默认不可改删等约束）。
func TestDefaultSkinThemesIncludeNiangxiao(t *testing.T) {
	themes := defaultAppearanceSkinThemes()
	found := false
	for _, theme := range themes {
		if theme.ID == "niangxiao" {
			found = true
			if theme.Name != "酿笑坊" {
				t.Fatalf("niangxiao name = %q, want 酿笑坊", theme.Name)
			}
		}
	}
	if !found {
		t.Fatal("default skin themes must include niangxiao")
	}
	if err := validateAppearanceSkinThemes(themes, "classic"); err != nil {
		t.Fatalf("default themes must pass validation: %v", err)
	}
	// 双模式主色锚点：亮=藏青 navy，暗=鎏金 gold（防以后误改配色）
	var niangxiaoSkin AppearanceSkinTheme
	for _, theme := range themes {
		if theme.ID == "niangxiao" {
			niangxiaoSkin = theme
		}
	}
	if got := niangxiaoSkin.Tokens.Light.Primary; got != "#0a2540" {
		t.Fatalf("niangxiao light primary = %q, want navy #0a2540", got)
	}
	if got := niangxiaoSkin.Tokens.Dark.Primary; got != "#c9a961" {
		t.Fatalf("niangxiao dark primary = %q, want gold #c9a961", got)
	}
}
