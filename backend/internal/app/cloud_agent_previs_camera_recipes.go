package app

import (
	"fmt"
	"math"
	"sort"
	"strings"
)

// 大师手法配方：一组按比例写时间的运镜段。camera_move 给 recipe 时一次展开写入整套，
// 让「过肩跟随→绕到正面→收成面部大特写」这类多节拍运镜不依赖模型逐段手写。
//
// 与 web/src/lib/canvas/previs/previs-camera-techniques.ts 的 PREVIS_CAMERA_RECIPES 是同一张表；
// 两边对同一输入的展开结果写在 testdata/previs_camera_recipes.json，前后端测试都按它校验。
// 换方位的跟拍段：前一段要持续到后一段 blend 结束，否则交接期间机位停在原地、人物继续走远（review 会指出）。
// 本文件不要出现以「{ID: "」开头的行：前端对齐测试会把那种行当作运镜手法解析。

const cloudAgentPrevisCameraRecipeMinDuration = 1.0

// at / span 是配方总时长的比例；Max 是这段时长上限（秒）；AlignEnd 让这段贴着配方结尾；
// BlendSpan 是跟拍切入用时占总时长的比例，展开成 params.blend 秒数（上限 10 秒）。
type cloudAgentPrevisCameraRecipeSegment struct {
	Technique string
	At        float64
	Span      float64
	Max       float64
	AlignEnd  bool
	Easing    string
	BlendSpan float64
	Params    map[string]any
}

type cloudAgentPrevisCameraRecipe struct {
	Recipe   string
	Label    string
	Source   string
	Hint     string
	Subject  string // none / optional / required
	Segments []cloudAgentPrevisCameraRecipeSegment
}

var cloudAgentPrevisCameraRecipes = []cloudAgentPrevisCameraRecipe{
	{Recipe: "ots_to_closeup", Label: "过肩跟随转正面特写", Source: "斯坦尼康长镜头（《摔角王》式背后跟随）", Hint: "贴着人物肩后跟着走，再绕到正面收成近景，最后收到面部大特写", Subject: "required", Segments: []cloudAgentPrevisCameraRecipeSegment{
		{Technique: "follow", At: 0, Span: 0.75, Params: map[string]any{"side": "shoulder"}},
		{Technique: "follow", At: 0.4, Span: 0.6, BlendSpan: 0.35, Params: map[string]any{"side": "front", "shotSize": "close_up", "lag": 0.1}},
		{Technique: "follow", At: 0.78, Span: 0.22, BlendSpan: 0.18, Params: map[string]any{"side": "front", "shotSize": "extreme_close_up", "lag": 0.1}},
		{Technique: "handheld", At: 0, Span: 1, Params: map[string]any{"intensity": 0.35}},
	}},
	{Recipe: "walk_and_talk", Label: "倒退跟拍收紧", Source: "《白宫风云》walk and talk", Hint: "在人物前方倒退跟拍中景，说到关键处收紧到近景", Subject: "required", Segments: []cloudAgentPrevisCameraRecipeSegment{
		{Technique: "follow", At: 0, Span: 1, Params: map[string]any{"side": "front", "shotSize": "medium", "lag": 0.2}},
		{Technique: "follow", At: 0.6, Span: 0.4, BlendSpan: 0.3, Params: map[string]any{"side": "front", "shotSize": "close_up", "lag": 0.2}},
		{Technique: "handheld", At: 0, Span: 1, Params: map[string]any{"intensity": 0.3}},
	}},
	{Recipe: "hero_reveal", Label: "背影绕前亮相", Source: "史诗片英雄亮相", Hint: "从背后全景跟随，缓慢绕到正面并降低机位，收成仰拍近景", Subject: "required", Segments: []cloudAgentPrevisCameraRecipeSegment{
		{Technique: "follow", At: 0, Span: 0.85, Params: map[string]any{"side": "behind", "shotSize": "full", "lag": 0.15}},
		{Technique: "follow", At: 0.3, Span: 0.7, BlendSpan: 0.55, Params: map[string]any{"side": "front", "shotSize": "close_up", "height": 0.9, "lag": 0.15}},
	}},
	{Recipe: "vertigo", Label: "眩晕变焦", Source: "希区柯克《迷魂记》", Hint: "后退同时推焦，主体不变、背景压近", Subject: "optional", Segments: []cloudAgentPrevisCameraRecipeSegment{
		{Technique: "dolly_zoom_out", At: 0, Span: 1},
	}},
	{Recipe: "emotional_push", Label: "情绪推镜", Source: "斯皮尔伯格", Hint: "缓慢推近人物，强调顿悟与情绪", Subject: "none", Segments: []cloudAgentPrevisCameraRecipeSegment{
		{Technique: "push_in", At: 0, Span: 1},
	}},
	{Recipe: "hero_orbit", Label: "英雄环绕", Source: "迈克尔·贝", Hint: "绕主体转半圈，配低机位更有气势", Subject: "optional", Segments: []cloudAgentPrevisCameraRecipeSegment{
		{Technique: "orbit_right", At: 0, Span: 1, Params: map[string]any{"angle": 180.0}},
	}},
	{Recipe: "aerial_reveal", Label: "航拍拉升", Source: "诺兰", Hint: "升高并后退，揭示整个世界", Subject: "none", Segments: []cloudAgentPrevisCameraRecipeSegment{
		{Technique: "crane_up", At: 0, Span: 1, Params: map[string]any{"height": 12.0, "distance": 16.0}},
	}},
	{Recipe: "intimate_handheld", Label: "贴身手持", Source: "王家卫", Hint: "近距离跟着人物，叠加手持晃动", Subject: "required", Segments: []cloudAgentPrevisCameraRecipeSegment{
		{Technique: "follow", At: 0, Span: 1, Params: map[string]any{"side": "behind", "distance": 2.2, "lag": 0.12}},
		{Technique: "handheld", At: 0, Span: 1, Params: map[string]any{"intensity": 1.6}},
	}},
	{Recipe: "symmetric_follow", Label: "一点透视跟拍", Source: "库布里克《闪灵》", Hint: "人物正后方居中跟随", Subject: "required", Segments: []cloudAgentPrevisCameraRecipeSegment{
		{Technique: "follow", At: 0, Span: 1, Params: map[string]any{"side": "behind", "distance": 5.0, "lag": 0.3}},
	}},
	{Recipe: "side_track", Label: "侧面平移跟拍", Source: "黑泽明", Hint: "与人物平行移动，看清动作全貌", Subject: "required", Segments: []cloudAgentPrevisCameraRecipeSegment{
		{Technique: "follow", At: 0, Span: 1, Params: map[string]any{"side": "left", "distance": 6.0, "lag": 0.2}},
	}},
	{Recipe: "whip_transition", Label: "横移甩镜", Source: "韦斯·安德森", Hint: "平稳横移，结尾快速甩镜转场", Subject: "none", Segments: []cloudAgentPrevisCameraRecipeSegment{
		{Technique: "truck_right", At: 0, Span: 1, Params: map[string]any{"distance": 2.5}},
		{Technique: "whip_pan_right", At: 0, Span: 0.5, Max: 0.5, AlignEnd: true},
	}},
	{Recipe: "sword_chase", Label: "御剑跟拍", Source: "仙侠动作", Hint: "跟在人物后方一起升空，后半段绕到侧面", Subject: "required", Segments: []cloudAgentPrevisCameraRecipeSegment{
		{Technique: "follow", At: 0, Span: 1, Params: map[string]any{"side": "behind", "distance": 6.0, "lag": 0.35}},
		{Technique: "orbit_left", At: 0.5, Span: 0.5, Params: map[string]any{"angle": 120.0}},
	}},
	{Recipe: "spiral_rise", Label: "螺旋升镜", Source: "长镜头", Hint: "绕主体一圈同时升高", Subject: "optional", Segments: []cloudAgentPrevisCameraRecipeSegment{
		{Technique: "orbit_left", At: 0, Span: 1, Params: map[string]any{"angle": 360.0, "rise": 4.0}},
	}},
	{Recipe: "crash_zoom", Label: "急推变焦", Source: "港式动作片", Hint: "开始处 0.4 秒猛推焦段", Subject: "none", Segments: []cloudAgentPrevisCameraRecipeSegment{
		{Technique: "zoom_in", At: 0, Span: 1, Max: 0.4, Easing: "linear"},
	}},
	{Recipe: "impact_shake", Label: "冲击震屏", Source: "动作片", Hint: "开始处 0.6 秒震动", Subject: "none", Segments: []cloudAgentPrevisCameraRecipeSegment{
		{Technique: "shake", At: 0, Span: 1, Max: 0.6, Params: map[string]any{"intensity": 1.2}},
	}},
}

type cloudAgentPrevisCameraRecipeMove struct {
	Technique string
	Start     float64
	Duration  float64
	Easing    string
	SubjectID string
	Params    map[string]any
}

func cloudAgentPrevisFindCameraRecipe(id string) (cloudAgentPrevisCameraRecipe, bool) {
	for _, recipe := range cloudAgentPrevisCameraRecipes {
		if recipe.Recipe == id {
			return recipe, true
		}
	}
	return cloudAgentPrevisCameraRecipe{}, false
}

func cloudAgentPrevisCameraRecipeIDs() string {
	ids := make([]string, 0, len(cloudAgentPrevisCameraRecipes))
	for _, recipe := range cloudAgentPrevisCameraRecipes {
		ids = append(ids, recipe.Recipe)
	}
	return strings.Join(ids, "/")
}

func cloudAgentPrevisRoundTime(value float64) float64 {
	return math.Round(value*1000) / 1000
}

// cloudAgentPrevisExpandCameraRecipe 与前端 expandPrevisCameraRecipe 逐项一致：按开始时间与总时长展开，不截断、不校验。
func cloudAgentPrevisExpandCameraRecipe(recipe cloudAgentPrevisCameraRecipe, start, duration float64, subjectID string) []cloudAgentPrevisCameraRecipeMove {
	moves := make([]cloudAgentPrevisCameraRecipeMove, 0, len(recipe.Segments))
	for _, segment := range recipe.Segments {
		length := segment.Span * duration
		if segment.Max > 0 && length > segment.Max {
			length = segment.Max
		}
		at := start + segment.At*duration
		if segment.AlignEnd {
			at = start + duration - length
		}
		var params map[string]any
		if len(segment.Params) > 0 || segment.BlendSpan > 0 {
			params = make(map[string]any, len(segment.Params)+1)
			for key, value := range segment.Params {
				params[key] = value
			}
			if segment.BlendSpan > 0 {
				params["blend"] = math.Min(10, cloudAgentPrevisRoundTime(segment.BlendSpan*duration))
			}
		}
		move := cloudAgentPrevisCameraRecipeMove{Technique: segment.Technique, Start: at, Duration: length, Easing: segment.Easing, Params: params}
		if technique, ok := cloudAgentPrevisFindCameraTechnique(segment.Technique); ok && technique.Subject != "none" {
			move.SubjectID = subjectID
		}
		moves = append(moves, move)
	}
	return moves
}

// cloudAgentPrevisApplyCameraRecipe 处理 camera_move + recipe：校验总时间与主体后逐段走 camera_move 的同一套校验写入。
func cloudAgentPrevisApplyCameraRecipe(scene map[string]any, camera map[string]any, operation cloudAgentPrevisPatchOperation) (string, error) {
	id := strings.TrimSpace(operation.Recipe)
	recipe, ok := cloudAgentPrevisFindCameraRecipe(id)
	if !ok {
		return "", BadAuthRequest(fmt.Sprintf("大师手法 %q 不存在；可用：%s（说明见 catalog.cameraRecipes）", id, cloudAgentPrevisCameraRecipeIDs()))
	}
	if strings.TrimSpace(operation.Technique) != "" {
		return "", BadAuthRequest("camera_move 的 recipe 与 technique 二选一：recipe 写整套大师手法，technique 写单段运镜")
	}
	if len(operation.Params) > 0 || operation.Easing != "" || (operation.KeyframeID != nil && strings.TrimSpace(*operation.KeyframeID) != "") {
		return "", BadAuthRequest("recipe 的每段参数是固定配方，不接受 params、easing 或 keyframeId；要调整某一段，写入后用 camera_move 的 keyframeId 覆盖那一段，或改用 technique 逐段写")
	}
	shotDuration := cloudAgentPrevisShotDuration(scene)
	start := 0.0
	if operation.Time != nil {
		start = *operation.Time
	}
	if err := cloudAgentPrevisFiniteInRange(start, "time", 0, shotDuration); err != nil {
		return "", err
	}
	duration := shotDuration - start
	if operation.Duration != nil {
		duration = *operation.Duration
	}
	if math.IsNaN(duration) || math.IsInf(duration, 0) || duration < cloudAgentPrevisCameraRecipeMinDuration-1e-9 {
		return "", BadAuthRequest(fmt.Sprintf("大师手法至少需要 %.0f 秒；提前开始或先用 shot_update 加长镜头", cloudAgentPrevisCameraRecipeMinDuration))
	}
	if start+duration > shotDuration+1e-6 {
		return "", BadAuthRequest(fmt.Sprintf("大师手法 %.1f–%.1fs 超出镜头时长 %.1fs；缩短 duration 或先用 shot_update 加长镜头", start, start+duration, shotDuration))
	}
	subjectID := ""
	if operation.SubjectID != nil {
		subjectID = strings.TrimSpace(*operation.SubjectID)
	}
	switch {
	case recipe.Subject == "required" && subjectID == "":
		return "", BadAuthRequest(fmt.Sprintf("大师手法 %s 需要 subjectId：被跟随的演员 ID", recipe.Recipe))
	case recipe.Subject == "none" && subjectID != "":
		return "", BadAuthRequest(fmt.Sprintf("大师手法 %s 不需要 subjectId", recipe.Recipe))
	}
	subjectName := ""
	if subjectID != "" {
		if err := validateCloudAgentID(subjectID, "subjectId", 80); err != nil {
			return "", err
		}
		subject := cloudAgentPrevisFindByID(creationMaps(scene["objects"]), subjectID)
		if subject == nil {
			return "", BadAuthRequest("subjectId 指向的对象不存在；用 previs_scene_read 返回的 objects[].id")
		}
		subjectName = truncateRunes(stringValue(subject["name"]), 40)
	}
	if existing := len(creationMaps(camera["moves"])); existing+len(recipe.Segments) > cloudAgentPrevisMaxCameraMoves {
		return "", BadAuthRequest(fmt.Sprintf("大师手法 %s 要写入 %d 段，摄影机已有 %d 段，超过 %d 段上限；先用 camera_move_remove 删除或清空", recipe.Recipe, len(recipe.Segments), existing, cloudAgentPrevisMaxCameraMoves))
	}
	parts := make([]string, 0, len(recipe.Segments))
	for _, move := range cloudAgentPrevisExpandCameraRecipe(recipe, start, duration, subjectID) {
		time, length := move.Start, move.Duration
		segment := cloudAgentPrevisPatchOperation{Type: "camera_move", ID: operation.ID, Technique: move.Technique, Time: &time, Duration: &length, Easing: move.Easing, Params: move.Params}
		if move.SubjectID != "" {
			subject := move.SubjectID
			segment.SubjectID = &subject
		}
		if _, err := cloudAgentPrevisApplyCameraMove(scene, camera, segment); err != nil {
			return "", BadAuthRequest(fmt.Sprintf("大师手法 %s 展开 %s 失败：%v", recipe.Recipe, move.Technique, err))
		}
		parts = append(parts, fmt.Sprintf("%s %.1f–%.1fs", move.Technique, move.Start, move.Start+move.Duration))
	}
	summary := fmt.Sprintf("摄影机《%s》%.1f–%.1fs 大师手法「%s」", truncateRunes(stringValue(camera["name"]), 40), start, start+duration, recipe.Label)
	if subjectName != "" {
		summary += "，主体《" + subjectName + "》"
	}
	return summary + fmt.Sprintf("，展开 %d 段：%s", len(parts), strings.Join(parts, "、")), nil
}

// cloudAgentPrevisCameraRecipesGuide 生成 catalog.cameraRecipes：配方 ID、名称、出处与逐段构成。* 表示必须给 subjectId，° 表示可选。
func cloudAgentPrevisCameraRecipesGuide() string {
	parts := make([]string, 0, len(cloudAgentPrevisCameraRecipes))
	for _, recipe := range cloudAgentPrevisCameraRecipes {
		mark := ""
		switch recipe.Subject {
		case "required":
			mark = "*"
		case "optional":
			mark = "°"
		}
		segments := make([]string, 0, len(recipe.Segments))
		for _, segment := range recipe.Segments {
			segments = append(segments, cloudAgentPrevisDescribeRecipeSegment(segment))
		}
		parts = append(parts, fmt.Sprintf("%s%s %s（%s，%s）= %s", recipe.Recipe, mark, recipe.Label, recipe.Source, recipe.Hint, strings.Join(segments, " + ")))
	}
	return "大师手法用 camera_move 的 recipe 一次写入整套：id=摄影机，recipe=下面的 ID，subjectId=主体，time 起始秒，duration 总时长（至少 1 秒，省略到镜头结束）；各段时间按总时长比例展开。" + strings.Join(parts, "；")
}

func cloudAgentPrevisDescribeRecipeSegment(segment cloudAgentPrevisCameraRecipeSegment) string {
	keys := make([]string, 0, len(segment.Params))
	for key := range segment.Params {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	options := make([]string, 0, len(keys)+2)
	for _, key := range keys {
		options = append(options, fmt.Sprintf("%s=%v", key, segment.Params[key]))
	}
	if segment.BlendSpan > 0 {
		options = append(options, fmt.Sprintf("blend=总时长×%g", segment.BlendSpan))
	}
	if segment.Easing != "" {
		options = append(options, "easing="+segment.Easing)
	}
	text := segment.Technique
	if len(options) > 0 {
		text += "(" + strings.Join(options, " ") + ")"
	}
	percent := func(value float64) float64 { return math.Round(value * 100) }
	switch {
	case segment.AlignEnd && segment.Max > 0:
		return text + fmt.Sprintf(" 结尾 %g%%（最长 %gs）", percent(segment.Span), segment.Max)
	case segment.Max > 0:
		return text + fmt.Sprintf(" %g%% 起最长 %gs", percent(segment.At), segment.Max)
	default:
		return text + fmt.Sprintf(" %g–%g%%", percent(segment.At), percent(segment.At+segment.Span))
	}
}
