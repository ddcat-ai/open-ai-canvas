package service

import (
	"fmt"
	"reflect"
	"regexp"
	"strings"
	"unicode"
	"unicode/utf8"
)

const maxAppearanceSkinThemes = 16

var (
	appearanceSkinIDPattern = regexp.MustCompile(`^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$`)
	appearanceColorPattern  = regexp.MustCompile(`^#[0-9a-fA-F]{6}(?:[0-9a-fA-F]{2})?$`)
)

// AppearanceSkinModeTokens is deliberately an allowlist instead of arbitrary CSS.
// Every value is validated as a six- or eight-digit hex color before it is exposed
// by the public appearance endpoint.
type AppearanceSkinModeTokens struct {
	Canvas                    string `json:"canvas"`
	Surface                   string `json:"surface"`
	SurfaceSubtle             string `json:"surfaceSubtle"`
	SurfaceRaised             string `json:"surfaceRaised"`
	Overlay                   string `json:"overlay"`
	Text                      string `json:"text"`
	TextMuted                 string `json:"textMuted"`
	Border                    string `json:"border"`
	Control                   string `json:"control"`
	ControlHover              string `json:"controlHover"`
	ControlActive             string `json:"controlActive"`
	ControlBorder             string `json:"controlBorder"`
	ControlFocus              string `json:"controlFocus"`
	ControlDisabledBackground string `json:"controlDisabledBackground"`
	ControlDisabledForeground string `json:"controlDisabledForeground"`
	SwitchChecked             string `json:"switchChecked"`
	SwitchCheckedHover        string `json:"switchCheckedHover"`
	SwitchCheckedHandle       string `json:"switchCheckedHandle"`
	SwitchUnchecked           string `json:"switchUnchecked"`
	SwitchUncheckedHover      string `json:"switchUncheckedHover"`
	SwitchUncheckedHandle     string `json:"switchUncheckedHandle"`
	Primary                   string `json:"primary"`
	PrimaryHover              string `json:"primaryHover"`
	PrimaryActive             string `json:"primaryActive"`
	PrimaryForeground         string `json:"primaryForeground"`
	Selected                  string `json:"selected"`
	SelectedHover             string `json:"selectedHover"`
	SelectedActive            string `json:"selectedActive"`
	SelectedForeground        string `json:"selectedForeground"`
	Icon                      string `json:"icon"`
	IconMuted                 string `json:"iconMuted"`
	IconActive                string `json:"iconActive"`
	Success                   string `json:"success"`
	Warning                   string `json:"warning"`
	Danger                    string `json:"danger"`
	DangerHover               string `json:"dangerHover"`
	DangerActive              string `json:"dangerActive"`
	DangerForeground          string `json:"dangerForeground"`
	Info                      string `json:"info"`
	Workspace                 string `json:"workspace"`
	WorkspaceGrid             string `json:"workspaceGrid"`
	AdminBackground           string `json:"adminBackground"`
	AdminSurface              string `json:"adminSurface"`
	AdminSubtle               string `json:"adminSubtle"`
	AdminStrong               string `json:"adminStrong"`
	AuthBackground            string `json:"authBackground"`
	AuthPanel                 string `json:"authPanel"`
	AuthCard                  string `json:"authCard"`
	AuthAccent                string `json:"authAccent"`
	AuthMuted                 string `json:"authMuted"`
}

type AppearanceSkinComponentTokens struct {
	ButtonRadius       int    `json:"buttonRadius"`
	InputRadius        int    `json:"inputRadius"`
	CardRadius         int    `json:"cardRadius"`
	OverlayRadius      int    `json:"overlayRadius"`
	MenuRadius         int    `json:"menuRadius"`
	CheckboxRadius     int    `json:"checkboxRadius"`
	ControlHeight      int    `json:"controlHeight"`
	ControlHeightSmall int    `json:"controlHeightSmall"`
	ControlHeightLarge int    `json:"controlHeightLarge"`
	BorderWidth        int    `json:"borderWidth"`
	FocusRingWidth     int    `json:"focusRingWidth"`
	IconSize           int    `json:"iconSize"`
	ButtonFontWeight   int    `json:"buttonFontWeight"`
	HoverLift          int    `json:"hoverLift"`
	MotionFast         int    `json:"motionFast"`
	MotionNormal       int    `json:"motionNormal"`
	ShadowStyle        string `json:"shadowStyle"`
}

type AppearanceSkinTokens struct {
	Light      AppearanceSkinModeTokens      `json:"light"`
	Dark       AppearanceSkinModeTokens      `json:"dark"`
	Components AppearanceSkinComponentTokens `json:"components"`
}

type AppearanceSkinTheme struct {
	ID          string               `json:"id"`
	Name        string               `json:"name"`
	Description string               `json:"description"`
	Locked      bool                 `json:"locked"`
	Tokens      AppearanceSkinTokens `json:"tokens"`
}

func defaultAppearanceSkinThemes() []AppearanceSkinTheme {
	classic := defaultClassicAppearanceSkin()
	studio := cloneAppearanceSkin(classic, "studio-indigo", "青瓷工作室", "雾白青瓷 · 珊瑚点睛")
	studio.Tokens.Light = tintAppearanceSkinMode(studio.Tokens.Light, appearanceSkinPalette{
		canvas: "#f6f8f9", surface: "#ffffff", subtle: "#edf4f3", raised: "#d7e8e5", overlay: "#ffffff", text: "#142026", muted: "#607079", border: "#d5e0e2",
		primary: "#087f76", primaryHover: "#076d66", primaryActive: "#095c57", primaryForeground: "#ffffff", selected: "#dff4f0", selectedHover: "#ccebe6", selectedActive: "#b9e3dd", selectedForeground: "#075f59", info: "#dd7a38",
		switchChecked: "#087f76", switchCheckedHover: "#076d66", switchCheckedHandle: "#ffffff", switchUnchecked: "#a8b7b9", switchUncheckedHover: "#899b9e", switchUncheckedHandle: "#ffffff",
		success: "#16866f", warning: "#c46722", danger: "#c83f3a", dangerHover: "#ad3532", dangerActive: "#922e2c", dangerForeground: "#ffffff",
		workspace: "#ffffff", grid: "#e8f2f0", adminBackground: "#eef3f4", adminSurface: "#ffffff", adminSubtle: "#f5f9f9", adminStrong: "#dce9e8", authBackground: "#071a1d", authPanel: "#0b2226", authCard: "#0d272b", authAccent: "#72eadc", authMuted: "#8db9b4",
	})
	studio.Tokens.Dark = tintAppearanceSkinMode(studio.Tokens.Dark, appearanceSkinPalette{
		canvas: "#0b1215", surface: "#121d21", subtle: "#142428", raised: "#203a3b", overlay: "#172328", text: "#e7f4f2", muted: "#8ca6a7", border: "#294044",
		primary: "#43d8c7", primaryHover: "#72eadc", primaryActive: "#2db9aa", primaryForeground: "#052724", selected: "#193735", selectedHover: "#214743", selectedActive: "#28554f", selectedForeground: "#baf5ee", info: "#ff9e57",
		switchChecked: "#31bfae", switchCheckedHover: "#43d8c7", switchCheckedHandle: "#052724", switchUnchecked: "#3f5559", switchUncheckedHover: "#526a6d", switchUncheckedHandle: "#e7f4f2",
		success: "#4ade80", warning: "#ffb454", danger: "#ff7875", dangerHover: "#ff9a98", dangerActive: "#df5e5b", dangerForeground: "#2d0808",
		workspace: "#111d21", grid: "#17292c", adminBackground: "#0c171a", adminSurface: "#132126", adminSubtle: "#192a2e", adminStrong: "#21383a", authBackground: "#061416", authPanel: "#091c20", authCard: "#0d272b", authAccent: "#72eadc", authMuted: "#8db9b4",
	})
	studio.Tokens.Components = appearanceSkinComponentPreset(8, 8, 14, 14, 10, 5)

	warm := cloneAppearanceSkin(classic, "warm-persimmon", "暖柿纸境", "米纸暖棕 · 柿橙强调")
	warm.Tokens.Light = tintAppearanceSkinMode(warm.Tokens.Light, appearanceSkinPalette{
		canvas: "#fbf7f2", surface: "#fffdf9", subtle: "#f6ebe3", raised: "#ead2c2", overlay: "#fffdf9", text: "#35261f", muted: "#806b61", border: "#e5d6cb",
		primary: "#b94f2f", primaryHover: "#9e4128", primaryActive: "#843621", primaryForeground: "#fffaf6", selected: "#f8e0cf", selectedHover: "#f1d1bb", selectedActive: "#e9c1a6", selectedForeground: "#8c3d25", info: "#c58a3b",
		switchChecked: "#a84a2f", switchCheckedHover: "#bd5b3c", switchCheckedHandle: "#fffaf6", switchUnchecked: "#c7b3a7", switchUncheckedHover: "#aa9182", switchUncheckedHandle: "#fffdf9",
		success: "#4d7f50", warning: "#bd6819", danger: "#bd3d32", dangerHover: "#a33229", dangerActive: "#892a23", dangerForeground: "#fffaf6",
		workspace: "#fffdf9", grid: "#f3e9e1", adminBackground: "#f6eee7", adminSurface: "#fffdf9", adminSubtle: "#faf3ed", adminStrong: "#ead8ca", authBackground: "#1f1410", authPanel: "#291813", authCard: "#361f17", authAccent: "#ffc08b", authMuted: "#b99d89",
	})
	warm.Tokens.Dark = tintAppearanceSkinMode(warm.Tokens.Dark, appearanceSkinPalette{
		canvas: "#1b1210", surface: "#291a16", subtle: "#33211b", raised: "#493027", overlay: "#31201a", text: "#f8e9df", muted: "#b89c8c", border: "#50372e",
		primary: "#ef8a61", primaryHover: "#ffab83", primaryActive: "#d87350", primaryForeground: "#37140a", selected: "#4b2a20", selectedHover: "#5b3427", selectedActive: "#6b3e2e", selectedForeground: "#ffd9c4", info: "#f0b36c",
		switchChecked: "#df7752", switchCheckedHover: "#ef8a61", switchCheckedHandle: "#37140a", switchUnchecked: "#65483d", switchUncheckedHover: "#7b5a4c", switchUncheckedHandle: "#f8e9df",
		success: "#8dcc72", warning: "#f2b35f", danger: "#ff8375", dangerHover: "#ffa094", dangerActive: "#df6a5e", dangerForeground: "#32100b",
		workspace: "#241714", grid: "#31201b", adminBackground: "#1c1210", adminSurface: "#291b17", adminSubtle: "#35231d", adminStrong: "#493027", authBackground: "#160d0a", authPanel: "#21120e", authCard: "#361f17", authAccent: "#ffc08b", authMuted: "#b99d89",
	})
	warm.Tokens.Components = appearanceSkinComponentPreset(10, 10, 16, 18, 12, 5)

	violet := cloneAppearanceSkin(classic, "brand-violet", "霓光紫境", "冷白雾紫 · 夜幕电光")
	violet.Tokens.Light = tintAppearanceSkinMode(violet.Tokens.Light, appearanceSkinPalette{
		canvas: "#f8f7fc", surface: "#ffffff", subtle: "#f0eefb", raised: "#dfd9f5", overlay: "#ffffff", text: "#211b35", muted: "#716a86", border: "#ddd8ec",
		primary: "#6656d9", primaryHover: "#5847c7", primaryActive: "#4939b2", primaryForeground: "#ffffff", selected: "#ebe8ff", selectedHover: "#ded9ff", selectedActive: "#d0c9ff", selectedForeground: "#4f3fb5", info: "#8f61e8",
		switchChecked: "#6656d9", switchCheckedHover: "#5847c7", switchCheckedHandle: "#ffffff", switchUnchecked: "#b4afc5", switchUncheckedHover: "#9891ae", switchUncheckedHandle: "#ffffff",
		success: "#2f966e", warning: "#b96f16", danger: "#c73559", dangerHover: "#ac2c4b", dangerActive: "#912640", dangerForeground: "#ffffff",
		workspace: "#ffffff", grid: "#f0eef8", adminBackground: "#f1f0f7", adminSurface: "#ffffff", adminSubtle: "#f7f6fb", adminStrong: "#e4e0f1", authBackground: "#110d20", authPanel: "#17112b", authCard: "#211936", authAccent: "#b4a8ff", authMuted: "#958dad",
	})
	violet.Tokens.Dark = tintAppearanceSkinMode(violet.Tokens.Dark, appearanceSkinPalette{
		canvas: "#0f0c19", surface: "#171321", subtle: "#201a2f", raised: "#302746", overlay: "#1c1734", text: "#f2efff", muted: "#a9a2bd", border: "#39304d",
		primary: "#9a90ff", primaryHover: "#b5adff", primaryActive: "#8175ed", primaryForeground: "#171126", selected: "#292347", selectedHover: "#352d59", selectedActive: "#40366a", selectedForeground: "#ddd9ff", info: "#c45dff",
		switchChecked: "#8175ed", switchCheckedHover: "#9a90ff", switchCheckedHandle: "#171126", switchUnchecked: "#504967", switchUncheckedHover: "#665d7f", switchUncheckedHandle: "#f2efff",
		success: "#5bd6a2", warning: "#ffc46b", danger: "#ff7795", dangerHover: "#ff99ae", dangerActive: "#df607f", dangerForeground: "#310b17",
		workspace: "#15111f", grid: "#211b30", adminBackground: "#110e1a", adminSurface: "#191524", adminSubtle: "#211b30", adminStrong: "#302746", authBackground: "#0b0812", authPanel: "#120d20", authCard: "#211936", authAccent: "#b4a8ff", authMuted: "#958dad",
	})
	violet.Tokens.Components = appearanceSkinComponentPreset(7, 7, 12, 14, 9, 4)

	return []AppearanceSkinTheme{classic, studio, warm, violet}
}

func defaultClassicAppearanceSkin() AppearanceSkinTheme {
	return AppearanceSkinTheme{
		ID: "classic", Name: "经典黑白", Description: "项目原始样式 · 不可修改", Locked: true,
		Tokens: AppearanceSkinTokens{
			Light: AppearanceSkinModeTokens{
				Canvas: "#ffffff", Surface: "#ffffff", SurfaceSubtle: "#f7f7f7", SurfaceRaised: "#ececec", Overlay: "#ffffff", Text: "#171717", TextMuted: "#737373", Border: "#e5e5e5",
				Control: "#ffffff", ControlHover: "#f5f5f5", ControlActive: "#ececec", ControlBorder: "#d1d1d1", ControlFocus: "#171717", ControlDisabledBackground: "#f2f2f2", ControlDisabledForeground: "#a3a3a3", SwitchChecked: "#16a34a", SwitchCheckedHover: "#15803d", SwitchCheckedHandle: "#ffffff", SwitchUnchecked: "#b8b8b8", SwitchUncheckedHover: "#9f9f9f", SwitchUncheckedHandle: "#ffffff",
				Primary: "#171717", PrimaryHover: "#303030", PrimaryActive: "#404040", PrimaryForeground: "#ffffff", Selected: "#e8e8e8", SelectedHover: "#dedede", SelectedActive: "#d5d5d5", SelectedForeground: "#171717",
				Icon: "#3f3f46", IconMuted: "#a1a1aa", IconActive: "#171717", Success: "#16a34a", Warning: "#d97706", Danger: "#dc2626", DangerHover: "#b91c1c", DangerActive: "#991b1b", DangerForeground: "#ffffff", Info: "#2563eb", Workspace: "#ffffff", WorkspaceGrid: "#f3f3f3",
				AdminBackground: "#f3f4f6", AdminSurface: "#ffffff", AdminSubtle: "#f7f8fa", AdminStrong: "#eceff3", AuthBackground: "#08090c", AuthPanel: "#0b0c10", AuthCard: "#121318", AuthAccent: "#93c5fd", AuthMuted: "#8a8b91",
			},
			Dark: AppearanceSkinModeTokens{
				Canvas: "#0a0a0a", Surface: "#181818", SurfaceSubtle: "#202020", SurfaceRaised: "#2a2a2a", Overlay: "#1f1f20", Text: "#f5f5f5", TextMuted: "#a3a3a3", Border: "#2d2d2d",
				Control: "#202020", ControlHover: "#292929", ControlActive: "#333333", ControlBorder: "#4a4a4a", ControlFocus: "#f5f5f5", ControlDisabledBackground: "#252525", ControlDisabledForeground: "#737373", SwitchChecked: "#22c55e", SwitchCheckedHover: "#4ade80", SwitchCheckedHandle: "#071a0f", SwitchUnchecked: "#525252", SwitchUncheckedHover: "#686868", SwitchUncheckedHandle: "#f5f5f5",
				Primary: "#f5f5f5", PrimaryHover: "#ffffff", PrimaryActive: "#e5e5e5", PrimaryForeground: "#171717", Selected: "#2b2b2b", SelectedHover: "#343434", SelectedActive: "#3d3d3d", SelectedForeground: "#f5f5f5",
				Icon: "#d4d4d8", IconMuted: "#71717a", IconActive: "#ffffff", Success: "#4ade80", Warning: "#fbbf24", Danger: "#f87171", DangerHover: "#fca5a5", DangerActive: "#ef4444", DangerForeground: "#2b0808", Info: "#60a5fa", Workspace: "#181818", WorkspaceGrid: "#222222",
				AdminBackground: "#101010", AdminSurface: "#181818", AdminSubtle: "#202020", AdminStrong: "#2a2a2a", AuthBackground: "#08090c", AuthPanel: "#0b0c10", AuthCard: "#121318", AuthAccent: "#93c5fd", AuthMuted: "#8a8b91",
			},
			Components: appearanceSkinComponentPreset(6, 6, 12, 12, 8, 4),
		},
	}
}

type appearanceSkinPalette struct {
	canvas, surface, subtle, raised, overlay, text, muted, border                                                        string
	primary, primaryHover, primaryActive, primaryForeground, selected, selectedHover, selectedActive, selectedForeground string
	switchChecked, switchCheckedHover, switchCheckedHandle, switchUnchecked, switchUncheckedHover, switchUncheckedHandle string
	success, warning, danger, dangerHover, dangerActive, dangerForeground, info                                          string
	workspace, grid, adminBackground, adminSurface, adminSubtle, adminStrong                                             string
	authBackground, authPanel, authCard, authAccent, authMuted                                                           string
}

func tintAppearanceSkinMode(value AppearanceSkinModeTokens, palette appearanceSkinPalette) AppearanceSkinModeTokens {
	value.Canvas, value.Surface, value.SurfaceSubtle, value.SurfaceRaised, value.Overlay = palette.canvas, palette.surface, palette.subtle, palette.raised, palette.overlay
	value.Text, value.TextMuted, value.Border = palette.text, palette.muted, palette.border
	value.Control, value.ControlHover, value.ControlActive, value.ControlBorder, value.ControlFocus = palette.surface, palette.subtle, palette.raised, palette.border, palette.primary
	value.ControlDisabledBackground, value.ControlDisabledForeground = palette.subtle, palette.muted
	value.SwitchChecked, value.SwitchCheckedHover, value.SwitchCheckedHandle = palette.switchChecked, palette.switchCheckedHover, palette.switchCheckedHandle
	value.SwitchUnchecked, value.SwitchUncheckedHover, value.SwitchUncheckedHandle = palette.switchUnchecked, palette.switchUncheckedHover, palette.switchUncheckedHandle
	value.Primary, value.PrimaryHover, value.PrimaryActive, value.PrimaryForeground = palette.primary, palette.primaryHover, palette.primaryActive, palette.primaryForeground
	value.Selected, value.SelectedHover, value.SelectedActive, value.SelectedForeground = palette.selected, palette.selectedHover, palette.selectedActive, palette.selectedForeground
	value.Icon, value.IconMuted, value.IconActive = palette.text, palette.muted, palette.primary
	value.Success, value.Warning, value.Danger = palette.success, palette.warning, palette.danger
	value.DangerHover, value.DangerActive, value.DangerForeground = palette.dangerHover, palette.dangerActive, palette.dangerForeground
	value.Info, value.Workspace, value.WorkspaceGrid = palette.info, palette.workspace, palette.grid
	value.AdminBackground, value.AdminSurface, value.AdminSubtle, value.AdminStrong = palette.adminBackground, palette.adminSurface, palette.adminSubtle, palette.adminStrong
	value.AuthBackground, value.AuthPanel, value.AuthCard, value.AuthAccent, value.AuthMuted = palette.authBackground, palette.authPanel, palette.authCard, palette.authAccent, palette.authMuted
	return value
}

func appearanceSkinComponentPreset(buttonRadius, inputRadius, cardRadius, overlayRadius, menuRadius, checkboxRadius int) AppearanceSkinComponentTokens {
	return AppearanceSkinComponentTokens{
		ButtonRadius: buttonRadius, InputRadius: inputRadius, CardRadius: cardRadius, OverlayRadius: overlayRadius, MenuRadius: menuRadius, CheckboxRadius: checkboxRadius,
		ControlHeight: 36, ControlHeightSmall: 30, ControlHeightLarge: 42, BorderWidth: 1, FocusRingWidth: 2, IconSize: 16, ButtonFontWeight: 500,
		HoverLift: 1, MotionFast: 120, MotionNormal: 180, ShadowStyle: "soft",
	}
}

func cloneAppearanceSkin(source AppearanceSkinTheme, id, name, description string) AppearanceSkinTheme {
	source.ID, source.Name, source.Description, source.Locked = id, name, description, false
	return source
}

func normalizeAppearanceSkinThemes(themes []AppearanceSkinTheme) []AppearanceSkinTheme {
	result := make([]AppearanceSkinTheme, len(themes))
	copy(result, themes)
	builtins := defaultAppearanceSkinThemes()
	for index := range result {
		result[index].ID = strings.ToLower(strings.TrimSpace(result[index].ID))
		result[index].Name = strings.TrimSpace(result[index].Name)
		result[index].Description = strings.TrimSpace(result[index].Description)
		result[index].Locked = result[index].ID == defaultAppearanceSkinID
		var fallback AppearanceSkinTokens
		for _, builtin := range builtins {
			if builtin.ID == result[index].ID {
				fallback = builtin.Tokens
				break
			}
		}
		backfillAppearanceSkinModeColors(&result[index].Tokens.Light, fallback.Light)
		backfillAppearanceSkinModeColors(&result[index].Tokens.Dark, fallback.Dark)
		normalizeAppearanceSkinModeColors(&result[index].Tokens.Light)
		normalizeAppearanceSkinModeColors(&result[index].Tokens.Dark)
		result[index].Tokens.Components.ShadowStyle = strings.ToLower(strings.TrimSpace(result[index].Tokens.Components.ShadowStyle))
	}
	return result
}

func backfillAppearanceSkinModeColors(mode *AppearanceSkinModeTokens, fallback AppearanceSkinModeTokens) {
	for _, field := range []struct {
		value    *string
		fallback string
		derived  string
	}{
		{&mode.SwitchChecked, fallback.SwitchChecked, mode.Primary},
		{&mode.SwitchCheckedHover, fallback.SwitchCheckedHover, mode.PrimaryHover},
		{&mode.SwitchCheckedHandle, fallback.SwitchCheckedHandle, mode.PrimaryForeground},
		{&mode.SwitchUnchecked, fallback.SwitchUnchecked, mode.ControlBorder},
		{&mode.SwitchUncheckedHover, fallback.SwitchUncheckedHover, mode.ControlActive},
		{&mode.SwitchUncheckedHandle, fallback.SwitchUncheckedHandle, mode.SelectedForeground},
		{&mode.DangerHover, fallback.DangerHover, mode.Danger},
		{&mode.DangerActive, fallback.DangerActive, mode.Danger},
		{&mode.DangerForeground, fallback.DangerForeground, mode.PrimaryForeground},
	} {
		if strings.TrimSpace(*field.value) != "" {
			continue
		}
		if field.fallback != "" {
			*field.value = field.fallback
		} else {
			*field.value = field.derived
		}
	}
}

func normalizeAppearanceSkinModeColors(mode *AppearanceSkinModeTokens) {
	value := reflect.ValueOf(mode).Elem()
	for index := 0; index < value.NumField(); index++ {
		field := value.Field(index)
		field.SetString(strings.ToLower(strings.TrimSpace(field.String())))
	}
}

func validateAppearanceSkinThemes(themes []AppearanceSkinTheme, selectedID string) error {
	if len(themes) == 0 || len(themes) > maxAppearanceSkinThemes {
		return BadAuthRequest(fmt.Sprintf("皮肤主题数量必须为 1 到 %d 套", maxAppearanceSkinThemes))
	}
	seen := make(map[string]struct{}, len(themes))
	foundSelected := false
	foundClassic := false
	classic := defaultClassicAppearanceSkin()
	for _, skin := range themes {
		if !appearanceSkinIDPattern.MatchString(skin.ID) {
			return BadAuthRequest("皮肤主题 ID 无效")
		}
		if _, exists := seen[skin.ID]; exists {
			return BadAuthRequest("皮肤主题 ID 不能重复")
		}
		seen[skin.ID] = struct{}{}
		if skin.ID == selectedID {
			foundSelected = true
		}
		if skin.ID == defaultAppearanceSkinID {
			foundClassic = true
			if skin.Name != classic.Name || skin.Description != classic.Description || !reflect.DeepEqual(skin.Tokens, classic.Tokens) {
				return BadAuthRequest("经典黑白为系统默认主题，不能修改或删除")
			}
		}
		if err := validateAppearanceSkinText(skin.Name, "皮肤主题名称", 40, true); err != nil {
			return err
		}
		if err := validateAppearanceSkinText(skin.Description, "皮肤主题说明", 100, false); err != nil {
			return err
		}
		if err := validateAppearanceSkinMode(skin.Tokens.Light); err != nil {
			return err
		}
		if err := validateAppearanceSkinMode(skin.Tokens.Dark); err != nil {
			return err
		}
		if err := validateAppearanceSkinComponents(skin.Tokens.Components); err != nil {
			return err
		}
	}
	if !foundClassic {
		return BadAuthRequest("经典黑白为系统默认主题，不能修改或删除")
	}
	if !foundSelected {
		return BadAuthRequest("当前启用的皮肤主题不存在")
	}
	return nil
}

func validateAppearanceSkinMode(mode AppearanceSkinModeTokens) error {
	value := reflect.ValueOf(mode)
	for index := 0; index < value.NumField(); index++ {
		if !appearanceColorPattern.MatchString(value.Field(index).String()) {
			return BadAuthRequest("皮肤颜色必须使用 6 或 8 位十六进制颜色")
		}
	}
	return nil
}

func validateAppearanceSkinComponents(value AppearanceSkinComponentTokens) error {
	for _, candidate := range []struct {
		value, min, max int
		label           string
	}{
		{value.ButtonRadius, 0, 32, "按钮圆角"}, {value.InputRadius, 0, 32, "输入框圆角"}, {value.CardRadius, 0, 40, "卡片圆角"}, {value.OverlayRadius, 0, 40, "弹层圆角"}, {value.MenuRadius, 0, 32, "菜单圆角"}, {value.CheckboxRadius, 0, 12, "勾选框圆角"},
		{value.ControlHeight, 30, 48, "控件高度"}, {value.ControlHeightSmall, 24, 40, "小控件高度"}, {value.ControlHeightLarge, 36, 56, "大控件高度"}, {value.BorderWidth, 1, 3, "描边宽度"}, {value.FocusRingWidth, 1, 4, "焦点环宽度"},
		{value.IconSize, 12, 24, "图标尺寸"}, {value.ButtonFontWeight, 400, 700, "按钮字重"}, {value.HoverLift, 0, 4, "悬停抬升"}, {value.MotionFast, 0, 400, "快速动效时长"}, {value.MotionNormal, 0, 800, "常规动效时长"},
	} {
		if candidate.value < candidate.min || candidate.value > candidate.max {
			return BadAuthRequest(fmt.Sprintf("%s必须在 %d 到 %d 之间", candidate.label, candidate.min, candidate.max))
		}
	}
	if value.ControlHeightSmall > value.ControlHeight || value.ControlHeight > value.ControlHeightLarge {
		return BadAuthRequest("控件高度须满足小号不大于标准、标准不大于大号")
	}
	if value.MotionFast > value.MotionNormal {
		return BadAuthRequest("快速动效时长不能大于常规动效时长")
	}
	if value.ShadowStyle != "none" && value.ShadowStyle != "soft" && value.ShadowStyle != "strong" {
		return BadAuthRequest("阴影风格无效")
	}
	return nil
}

func validateAppearanceSkinText(value, label string, maxRunes int, required bool) error {
	if required && value == "" {
		return BadAuthRequest(label + "不能为空")
	}
	if utf8.RuneCountInString(value) > maxRunes {
		return BadAuthRequest(fmt.Sprintf("%s不能超过 %d 个字符", label, maxRunes))
	}
	for _, char := range value {
		if unicode.IsControl(char) {
			return BadAuthRequest(label + "不能包含控制字符")
		}
	}
	return nil
}

func activeAppearanceSkin(themes []AppearanceSkinTheme, id string) AppearanceSkinTheme {
	for _, skin := range themes {
		if skin.ID == id {
			return skin
		}
	}
	return defaultClassicAppearanceSkin()
}
