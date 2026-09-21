package app

import (
	"strings"
	"unicode"
)

// CanvasAppearance is presentation-only; no free-form system prompts or tool permissions.
type CanvasAppearance struct {
	AgentName          string `json:"agentName"`
	LauncherLabel      string `json:"launcherLabel"`
	PanelTitle         string `json:"panelTitle"`
	WelcomeTitle       string `json:"welcomeTitle"`
	WelcomeDescription string `json:"welcomeDescription"`
	InputPlaceholder   string `json:"inputPlaceholder"`
	AvatarType         string `json:"avatarType"`
	Live2DResourceID   string `json:"live2dResourceId"`
	Live2DEntry        string `json:"live2dEntry"`
	AvatarHeight       int    `json:"avatarHeight"`
}

func defaultCanvasAppearance() CanvasAppearance {
	return CanvasAppearance{AgentName: "影策", LauncherLabel: "Agent", PanelTitle: "画布助手", WelcomeTitle: "在这里，和{agentName}让灵感，慢慢成形", WelcomeDescription: "从一个想法开始，和{agentName}一起创作。", InputPlaceholder: "输入操作指导；用 @ 引用画布节点，用 / 或 、 引用 Skills", AvatarType: "orb", AvatarHeight: 220}
}

func normalizeCanvasAppearance(value CanvasAppearance) (CanvasAppearance, error) {
	// Older API clients have no canvas object; keep their default presentation valid.
	if value == (CanvasAppearance{}) {
		return defaultCanvasAppearance(), nil
	}
	for _, field := range []struct {
		value    *string
		label    string
		max      int
		required bool
	}{
		{&value.AgentName, "助手名称", 24, true}, {&value.LauncherLabel, "入口文字", 24, false},
		{&value.PanelTitle, "面板标题", 40, true}, {&value.WelcomeTitle, "欢迎标题", 100, true},
		{&value.WelcomeDescription, "欢迎说明", 200, false}, {&value.InputPlaceholder, "输入提示", 160, true},
	} {
		*field.value = strings.TrimSpace(*field.value)
		if err := validateAppearanceCopy(*field.value, field.label, field.max, field.required); err != nil {
			return value, err
		}
	}
	for _, ch := range value.AgentName {
		if unicode.IsControl(ch) {
			return value, BadAuthRequest("助手名称不能包含控制字符")
		}
	}
	if value.AvatarType != "orb" && value.AvatarType != "live2d" {
		return value, BadAuthRequest("请选择有效的 Agent 形象类型")
	}
	if value.AvatarHeight < 120 || value.AvatarHeight > 360 {
		return value, BadAuthRequest("形象高度须在 120–360 之间")
	}
	if value.AvatarType == "live2d" && value.Live2DResourceID == "" {
		return value, BadAuthRequest("请先导入 Live2D 模型")
	}
	if value.Live2DResourceID == "" {
		value.Live2DEntry = ""
	}
	return value, nil
}
