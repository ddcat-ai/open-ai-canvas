package app

import (
	"strings"
	"unicode"
)

// CanvasAppearance controls presentation and the Agent's name, never free-form system prompts or tool permissions.
type CanvasAppearance struct {
	AgentName              string            `json:"agentName"`
	LauncherLabel          string            `json:"launcherLabel"`
	PanelTitle             string            `json:"panelTitle"`
	WelcomeTitle           string            `json:"welcomeTitle"`
	WelcomeDescription     string            `json:"welcomeDescription"`
	InputPlaceholder       string            `json:"inputPlaceholder"`
	AvatarType             string            `json:"avatarType"`
	Live2DResourceID       string            `json:"live2dResourceId"`
	Live2DEntry            string            `json:"live2dEntry"`
	AvatarBundleResourceID string            `json:"avatarBundleResourceId"`
	AvatarClipStates       map[string]string `json:"avatarClipStates,omitempty"`
	AvatarHeight           int               `json:"avatarHeight"`
}

func defaultCanvasAppearance() CanvasAppearance {
	return CanvasAppearance{
		AgentName: "影策", LauncherLabel: "Agent", PanelTitle: "画布助手",
		WelcomeTitle:       "在这里，和{agentName}让灵感，慢慢成形",
		WelcomeDescription: "从一个想法开始，和{agentName}一起创作。",
		InputPlaceholder:   "输入操作指导；用 @ 引用画布节点，用 / 或 、 引用 Skills",
		AvatarType:         "bundle",
		AvatarClipStates: map[string]string{
			"idle": "idle", "queued": "sleep_loop", "running": "working_loop", "waiting_approval": "think",
			"completed": "wave", "failed": "wipe_sweat", "cancelled": "lie_down", "rejected": "think",
		},
		AvatarHeight: 220,
	}
}

func normalizeCanvasAppearance(value CanvasAppearance) (CanvasAppearance, error) {
	// Older API clients have no canvas object; keep their default presentation valid.
	if isEmptyCanvasAppearance(value) {
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
	if value.AvatarType != "orb" && value.AvatarType != "live2d" && value.AvatarType != "bundle" {
		return value, BadAuthRequest("请选择有效的 Agent 形象类型")
	}
	if value.AvatarHeight < 120 || value.AvatarHeight > 360 {
		return value, BadAuthRequest("形象高度须在 120–360 之间")
	}
	if value.AvatarType == "live2d" && value.Live2DResourceID == "" {
		return value, BadAuthRequest("请先导入 Live2D 模型")
	}
	value.AvatarBundleResourceID = strings.TrimSpace(value.AvatarBundleResourceID)
	if len(value.AvatarBundleResourceID) > 80 {
		return value, BadAuthRequest("Agent 动画包资源 ID 无效")
	}
	for state, clip := range value.AvatarClipStates {
		clip = strings.TrimSpace(clip)
		if !validAvatarState(state) || !validAvatarClipID(clip) {
			return value, BadAuthRequest("Agent 状态动画配置无效")
		}
		value.AvatarClipStates[state] = clip
	}
	if value.Live2DResourceID == "" {
		value.Live2DEntry = ""
	}
	return value, nil
}

func isEmptyCanvasAppearance(value CanvasAppearance) bool {
	return value.AgentName == "" && value.LauncherLabel == "" && value.PanelTitle == "" && value.WelcomeTitle == "" &&
		value.WelcomeDescription == "" && value.InputPlaceholder == "" && value.AvatarType == "" && value.Live2DResourceID == "" &&
		value.Live2DEntry == "" && value.AvatarBundleResourceID == "" && len(value.AvatarClipStates) == 0 && value.AvatarHeight == 0
}

func validAvatarState(state string) bool {
	switch state {
	case "idle", "queued", "running", "waiting_approval", "completed", "failed", "cancelled", "rejected":
		return true
	default:
		return false
	}
}

func validAvatarClipID(value string) bool {
	if len(value) == 0 || len(value) > 64 {
		return false
	}
	for _, r := range value {
		if !(r >= 'a' && r <= 'z' || r >= 'A' && r <= 'Z' || r >= '0' && r <= '9' || r == '_' || r == '-') {
			return false
		}
	}
	return true
}
