package app

import (
	"fmt"
	"math"
	"sort"
	"strings"
)

// camera_move：世界引擎摄影机运镜段（推拉、摇移、升降、环绕、希区柯克变焦、甩镜、跟拍、手持……）。
// 手法 ID、参数键与范围与 web/src/lib/canvas/previs/previs-camera-techniques.ts 一一对应，两边改动需同步；
// web/test/previs-camera-moves.test.ts 会逐行比对下面的手法表，所以每个手法保持一行。
// 运镜段按开始时间依次叠加，在浏览器按镜头时间求值（跟拍按演员当时的位置与飞行高度移动），后端只校验并保存语义段。

type cloudAgentPrevisCameraParam struct {
	Key     string
	Min     float64
	Max     float64
	Options []string
}

type cloudAgentPrevisCameraTechnique struct {
	ID       string
	Name     string
	Subject  string // none / optional / required
	Layer    bool
	Duration float64 // 默认时长（秒）；0 表示到镜头结束
	Params   []cloudAgentPrevisCameraParam
}

const cloudAgentPrevisMaxCameraMoves = 24

var cloudAgentPrevisCameraFollowSides = []string{"behind", "front", "left", "right", "above", "shoulder", "pov"}

// 跟拍景别：按焦段与画幅换算距离、注视高度与机位高度，只对 behind/front/left/right 生效；与前端 PREVIS_CAMERA_FOLLOW_SHOT_SIZES 同序。
var cloudAgentPrevisCameraFollowShotSizes = []string{"extreme_close_up", "close_up", "medium", "full", "wide", "extreme_wide"}

var cloudAgentPrevisCameraTechniques = []cloudAgentPrevisCameraTechnique{
	{ID: "push_in", Name: "推镜头", Subject: "none", Params: []cloudAgentPrevisCameraParam{{Key: "distance", Min: 0.1, Max: 200}}},
	{ID: "pull_out", Name: "拉镜头", Subject: "none", Params: []cloudAgentPrevisCameraParam{{Key: "distance", Min: 0.1, Max: 200}}},
	{ID: "dolly_zoom_out", Name: "希区柯克变焦：后退同时推焦，主体不变背景压近", Subject: "optional", Params: []cloudAgentPrevisCameraParam{{Key: "distance", Min: 0.1, Max: 200}, {Key: "aim", Min: 0, Max: 20}}},
	{ID: "dolly_zoom_in", Name: "反向希区柯克：推近同时拉焦，背景拉开", Subject: "optional", Params: []cloudAgentPrevisCameraParam{{Key: "distance", Min: 0.1, Max: 200}, {Key: "aim", Min: 0, Max: 20}}},
	{ID: "zoom_in", Name: "变焦推（机位不动）", Subject: "none", Params: []cloudAgentPrevisCameraParam{{Key: "focalLength", Min: 8, Max: 300}}},
	{ID: "zoom_out", Name: "变焦拉（机位不动）", Subject: "none", Params: []cloudAgentPrevisCameraParam{{Key: "focalLength", Min: 8, Max: 300}}},
	{ID: "pan_left", Name: "左摇", Subject: "none", Params: []cloudAgentPrevisCameraParam{{Key: "angle", Min: 1, Max: 360}}},
	{ID: "pan_right", Name: "右摇", Subject: "none", Params: []cloudAgentPrevisCameraParam{{Key: "angle", Min: 1, Max: 360}}},
	{ID: "tilt_up", Name: "上摇", Subject: "none", Params: []cloudAgentPrevisCameraParam{{Key: "angle", Min: 1, Max: 80}}},
	{ID: "tilt_down", Name: "下摇", Subject: "none", Params: []cloudAgentPrevisCameraParam{{Key: "angle", Min: 1, Max: 80}}},
	{ID: "whip_pan_left", Name: "左甩镜", Subject: "none", Duration: 0.5, Params: []cloudAgentPrevisCameraParam{{Key: "angle", Min: 15, Max: 270}}},
	{ID: "whip_pan_right", Name: "右甩镜", Subject: "none", Duration: 0.5, Params: []cloudAgentPrevisCameraParam{{Key: "angle", Min: 15, Max: 270}}},
	{ID: "truck_left", Name: "左移", Subject: "none", Params: []cloudAgentPrevisCameraParam{{Key: "distance", Min: 0.1, Max: 200}}},
	{ID: "truck_right", Name: "右移", Subject: "none", Params: []cloudAgentPrevisCameraParam{{Key: "distance", Min: 0.1, Max: 200}}},
	{ID: "roll", Name: "旋转荷兰角（正数向右倾）", Subject: "none", Params: []cloudAgentPrevisCameraParam{{Key: "angle", Min: -180, Max: 180}}},
	{ID: "pedestal_up", Name: "平行升", Subject: "none", Params: []cloudAgentPrevisCameraParam{{Key: "distance", Min: 0.1, Max: 100}}},
	{ID: "pedestal_down", Name: "平行降", Subject: "none", Params: []cloudAgentPrevisCameraParam{{Key: "distance", Min: 0.1, Max: 100}}},
	{ID: "crane_up", Name: "摇臂升（镜头盯住焦点，distance=同时后退，即航拍拉升）", Subject: "none", Params: []cloudAgentPrevisCameraParam{{Key: "height", Min: 0.2, Max: 100}, {Key: "distance", Min: 0, Max: 200}}},
	{ID: "crane_down", Name: "摇臂降（distance=同时前推）", Subject: "none", Params: []cloudAgentPrevisCameraParam{{Key: "height", Min: 0.2, Max: 100}, {Key: "distance", Min: 0, Max: 200}}},
	{ID: "orbit_left", Name: "左环绕", Subject: "optional", Params: []cloudAgentPrevisCameraParam{{Key: "angle", Min: 5, Max: 720}, {Key: "rise", Min: -50, Max: 50}, {Key: "aim", Min: 0, Max: 20}}},
	{ID: "orbit_right", Name: "右环绕", Subject: "optional", Params: []cloudAgentPrevisCameraParam{{Key: "angle", Min: 5, Max: 720}, {Key: "rise", Min: -50, Max: 50}, {Key: "aim", Min: 0, Max: 20}}},
	{ID: "follow", Name: "跟拍（随演员移动，飞行/御剑时一起升空；shotSize 按景别取距离，换 side/shotSize 时用 blend 秒绕主体过渡）", Subject: "required", Params: []cloudAgentPrevisCameraParam{{Key: "side", Options: cloudAgentPrevisCameraFollowSides}, {Key: "shotSize", Options: cloudAgentPrevisCameraFollowShotSizes}, {Key: "distance", Min: 0, Max: 60}, {Key: "height", Min: -5, Max: 100}, {Key: "lag", Min: 0, Max: 2}, {Key: "blend", Min: 0, Max: 10}, {Key: "aim", Min: 0, Max: 20}}},
	{ID: "look_at", Name: "跟摇（机位不动盯住主体）", Subject: "required", Params: []cloudAgentPrevisCameraParam{{Key: "aim", Min: 0, Max: 20}}},
	{ID: "handheld", Name: "手持晃动（叠加层）", Subject: "none", Layer: true, Params: []cloudAgentPrevisCameraParam{{Key: "intensity", Min: 0.1, Max: 3}}},
	{ID: "shake", Name: "冲击震动（叠加层）", Subject: "none", Layer: true, Duration: 0.6, Params: []cloudAgentPrevisCameraParam{{Key: "intensity", Min: 0.1, Max: 3}}},
}

func cloudAgentPrevisFindCameraTechnique(id string) (cloudAgentPrevisCameraTechnique, bool) {
	for _, technique := range cloudAgentPrevisCameraTechniques {
		if technique.ID == id {
			return technique, true
		}
	}
	return cloudAgentPrevisCameraTechnique{}, false
}

func (technique cloudAgentPrevisCameraTechnique) param(key string) (cloudAgentPrevisCameraParam, bool) {
	for _, param := range technique.Params {
		if param.Key == key {
			return param, true
		}
	}
	return cloudAgentPrevisCameraParam{}, false
}

// shortName 去掉中文名里的说明（「（…）」「：…」），审批摘要只留手法名。
func (technique cloudAgentPrevisCameraTechnique) shortName() string {
	if index := strings.IndexAny(technique.Name, "（："); index > 0 {
		return technique.Name[:index]
	}
	return technique.Name
}

func (technique cloudAgentPrevisCameraTechnique) paramKeys() string {
	keys := make([]string, 0, len(technique.Params))
	for _, param := range technique.Params {
		keys = append(keys, param.Key)
	}
	if len(keys) == 0 {
		return "无"
	}
	return strings.Join(keys, "、")
}

// cloudAgentPrevisNormalizeCameraParams 只接受手法声明的键：数值必须有限且在范围内，side 必须是方位枚举。
func cloudAgentPrevisNormalizeCameraParams(technique cloudAgentPrevisCameraTechnique, params map[string]any) (map[string]any, error) {
	if len(params) == 0 {
		return nil, nil
	}
	keys := make([]string, 0, len(params))
	for key := range params {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	result := make(map[string]any, len(params))
	for _, key := range keys {
		spec, ok := technique.param(key)
		if !ok {
			return nil, BadAuthRequest(fmt.Sprintf("运镜 %s 不支持参数 %s；可用：%s", technique.ID, key, technique.paramKeys()))
		}
		if len(spec.Options) > 0 {
			text, _ := params[key].(string)
			if err := cloudAgentPrevisValidateEnum(text, "运镜参数 "+key, spec.Options...); err != nil {
				return nil, BadAuthRequest(fmt.Sprintf("运镜参数 %s 只能是 %s", key, strings.Join(spec.Options, "/")))
			}
			result[key] = text
			continue
		}
		value := numberValue(params[key], math.NaN())
		if math.IsNaN(value) || math.IsInf(value, 0) || value < spec.Min || value > spec.Max {
			return nil, BadAuthRequest(fmt.Sprintf("运镜参数 %s 必须是 %g 到 %g 之间的数字", key, spec.Min, spec.Max))
		}
		result[key] = value
	}
	return result, nil
}

// cloudAgentPrevisApplyCameraMove 处理 camera_move / camera_move_remove，返回审批摘要。
func cloudAgentPrevisApplyCameraMove(scene map[string]any, camera map[string]any, operation cloudAgentPrevisPatchOperation) (string, error) {
	cameraID := stringValue(camera["id"])
	cameraName := truncateRunes(stringValue(camera["name"]), 40)
	moves := creationMaps(camera["moves"])
	if operation.Type == "camera_move_remove" {
		if operation.KeyframeID == nil || strings.TrimSpace(*operation.KeyframeID) == "" {
			delete(camera, "moves")
			return fmt.Sprintf("清空摄影机《%s》的运镜（%d 段）", cameraName, len(moves)), nil
		}
		kept := make([]map[string]any, 0, len(moves))
		for _, move := range moves {
			if stringValue(move["id"]) != *operation.KeyframeID {
				kept = append(kept, move)
			}
		}
		if len(kept) == len(moves) {
			return "", BadAuthRequest("目标运镜不存在；运镜 id 见 previs_scene_read 的 cameras[].moves")
		}
		if len(kept) == 0 {
			delete(camera, "moves")
		} else {
			camera["moves"] = kept
		}
		return fmt.Sprintf("删除摄影机《%s》的一段运镜", cameraName), nil
	}

	if strings.TrimSpace(operation.Recipe) != "" {
		return cloudAgentPrevisApplyCameraRecipe(scene, camera, operation)
	}
	technique, ok := cloudAgentPrevisFindCameraTechnique(strings.TrimSpace(operation.Technique))
	if !ok {
		return "", BadAuthRequest(fmt.Sprintf("运镜手法 %q 不受支持；先读 previs_scene_read 的 catalog.cameraMoves", operation.Technique))
	}
	shotDuration := cloudAgentPrevisShotDuration(scene)
	start := 0.0
	if operation.Time != nil {
		start = *operation.Time
	}
	if err := cloudAgentPrevisFiniteInRange(start, "time", 0, shotDuration); err != nil {
		return "", err
	}
	remaining := shotDuration - start
	if remaining < 0.1-1e-9 {
		return "", BadAuthRequest(fmt.Sprintf("运镜开始时间 %.1fs 离镜头结束不足 0.1 秒；提前开始或先用 shot_update 加长镜头", start))
	}
	duration := remaining
	if technique.Duration > 0 && technique.Duration < remaining {
		duration = technique.Duration
	}
	if operation.Duration != nil {
		duration = *operation.Duration
	}
	if err := cloudAgentPrevisFiniteInRange(duration, "duration", 0.1, 60); err != nil {
		return "", err
	}
	if start+duration > shotDuration+1e-6 {
		return "", BadAuthRequest(fmt.Sprintf("运镜 %.1f–%.1fs 超出镜头时长 %.1fs；缩短 duration 或先用 shot_update 加长镜头", start, start+duration, shotDuration))
	}
	if operation.Easing != "" {
		if err := cloudAgentPrevisValidateEnum(operation.Easing, "运镜 easing", cloudAgentPrevisPathEasings...); err != nil {
			return "", BadAuthRequest("运镜 easing 只能是 linear（匀速）/ease_in（加速）/ease_out（减速）/smooth（缓入缓出）")
		}
	}
	subjectID := ""
	if operation.SubjectID != nil {
		subjectID = strings.TrimSpace(*operation.SubjectID)
	}
	switch {
	case technique.Subject == "required" && subjectID == "":
		return "", BadAuthRequest(fmt.Sprintf("%s 需要 subjectId：被跟随的演员或物体 ID", technique.ID))
	case technique.Subject == "none" && subjectID != "":
		return "", BadAuthRequest(fmt.Sprintf("%s 不需要 subjectId；跟拍用 follow，围绕主体用 orbit_left/orbit_right，要对准某人先用 camera_update 把 target 设到该人物或叠加 look_at", technique.ID))
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
	params, err := cloudAgentPrevisNormalizeCameraParams(technique, operation.Params)
	if err != nil {
		return "", err
	}

	moveID := ""
	if operation.KeyframeID != nil && strings.TrimSpace(*operation.KeyframeID) != "" {
		if err := validateCloudAgentID(*operation.KeyframeID, "keyframeId", 120); err != nil {
			return "", err
		}
		moveID = *operation.KeyframeID
	}
	replace := -1
	if moveID != "" {
		for index, move := range moves {
			if stringValue(move["id"]) == moveID {
				replace = index
				break
			}
		}
	}
	if replace < 0 && len(moves) >= cloudAgentPrevisMaxCameraMoves {
		return "", BadAuthRequest(fmt.Sprintf("每台摄影机最多 %d 段运镜；先用 camera_move_remove 删除或清空", cloudAgentPrevisMaxCameraMoves))
	}
	if moveID == "" {
		used := make(map[string]bool, len(moves))
		for _, move := range moves {
			used[stringValue(move["id"])] = true
		}
		for index := len(moves) + 1; ; index++ {
			candidate := fmt.Sprintf("%s-move-%d", cameraID, index)
			if !used[candidate] {
				moveID = candidate
				break
			}
		}
	}
	move := map[string]any{"id": moveID, "technique": technique.ID, "start": math.Round(start*1000) / 1000, "duration": math.Round(duration*1000) / 1000}
	if operation.Easing != "" {
		move["easing"] = operation.Easing
	}
	if subjectID != "" {
		move["subjectId"] = subjectID
	}
	if len(params) > 0 {
		move["params"] = params
	}
	if replace >= 0 {
		moves[replace] = move
	} else {
		moves = append(moves, move)
	}
	sort.SliceStable(moves, func(i, j int) bool { return numberValue(moves[i]["start"], 0) < numberValue(moves[j]["start"], 0) })
	camera["moves"] = moves

	summary := fmt.Sprintf("摄影机《%s》%.1f–%.1fs %s %s", cameraName, start, start+duration, technique.ID, technique.shortName())
	if subjectName != "" {
		summary += "，主体《" + subjectName + "》"
	}
	if len(params) > 0 {
		keys := make([]string, 0, len(params))
		for key := range params {
			keys = append(keys, key)
		}
		sort.Strings(keys)
		parts := make([]string, 0, len(keys))
		for _, key := range keys {
			parts = append(parts, fmt.Sprintf("%s=%v", key, params[key]))
		}
		summary += "（" + strings.Join(parts, ", ") + "）"
	}
	return summary, nil
}

// cloudAgentPrevisValidateCameraMoves 是整场景校验的一部分：浏览器写入的运镜同样要过白名单。
// 主体对象被删除时不报错（前端求值会跳过），避免一次无关的补丁因为旧运镜被整体拒绝。
func cloudAgentPrevisValidateCameraMoves(cameraID string, camera map[string]any) error {
	raw, ok := camera["moves"]
	if !ok || raw == nil {
		return nil
	}
	moves := creationMaps(raw)
	if len(moves) > cloudAgentPrevisMaxCameraMoves {
		return BadAuthRequest(fmt.Sprintf("摄影机 %s 的运镜超过 %d 段", cameraID, cloudAgentPrevisMaxCameraMoves))
	}
	seen := make(map[string]bool, len(moves))
	for _, move := range moves {
		id := stringValue(move["id"])
		if err := validateCloudAgentID(id, "运镜 ID", 120); err != nil {
			return err
		}
		if seen[id] {
			return BadAuthRequest("摄影机 " + cameraID + " 的运镜 ID 重复")
		}
		seen[id] = true
		technique, ok := cloudAgentPrevisFindCameraTechnique(stringValue(move["technique"]))
		if !ok {
			return BadAuthRequest(fmt.Sprintf("摄影机 %s 的运镜 %s 使用了当前服务不支持的手法 %q；这不是本次操作对象的问题，请把错误原样告知用户（可能需要更新后端）", cameraID, id, stringValue(move["technique"])))
		}
		if err := cloudAgentPrevisFiniteInRange(numberValue(move["start"], math.NaN()), "运镜开始", 0, 60); err != nil {
			return err
		}
		if err := cloudAgentPrevisFiniteInRange(numberValue(move["duration"], math.NaN()), "运镜时长", 0.05, 60); err != nil {
			return err
		}
		if easing := stringValue(move["easing"]); easing != "" {
			if err := cloudAgentPrevisValidateEnum(easing, "运镜 easing", cloudAgentPrevisPathEasings...); err != nil {
				return err
			}
		}
		if subjectID := stringValue(move["subjectId"]); subjectID != "" {
			if err := validateCloudAgentID(subjectID, "运镜 subjectId", 80); err != nil {
				return err
			}
		}
		if params, exists := move["params"]; exists && params != nil {
			values, isMap := params.(map[string]any)
			if !isMap {
				return BadAuthRequest("摄影机 " + cameraID + " 的运镜 params 必须是对象")
			}
			if _, err := cloudAgentPrevisNormalizeCameraParams(technique, values); err != nil {
				return err
			}
		}
	}
	return nil
}

// cloudAgentPrevisProjectCameraMoves 读场景时返回运镜段，Agent 才能在已有运镜上继续或按 id 删除。
func cloudAgentPrevisProjectCameraMoves(camera map[string]any) []map[string]any {
	result := make([]map[string]any, 0)
	for _, move := range creationMaps(camera["moves"]) {
		item := map[string]any{"id": stringValue(move["id"]), "technique": stringValue(move["technique"]), "start": numberValue(move["start"], 0), "duration": numberValue(move["duration"], 0)}
		if easing := stringValue(move["easing"]); easing != "" {
			item["easing"] = easing
		}
		if subjectID := stringValue(move["subjectId"]); subjectID != "" {
			item["subjectId"] = subjectID
		}
		if params, ok := move["params"].(map[string]any); ok && len(params) > 0 {
			projected := make(map[string]any, len(params))
			for key, value := range params {
				if text, isText := value.(string); isText {
					projected[key] = truncateRunes(text, 20)
				} else if number, isNumber := cloudAgentSafeNumber(value); isNumber {
					projected[key] = number
				}
			}
			item["params"] = projected
		}
		result = append(result, item)
	}
	return result
}

// cloudAgentPrevisCameraMovesGuide 生成 catalog.cameraMoves：手法 ID、中文名与可用参数。* 表示必须给 subjectId，° 表示可选 subjectId。
func cloudAgentPrevisCameraMovesGuide() string {
	parts := make([]string, 0, len(cloudAgentPrevisCameraTechniques))
	for _, technique := range cloudAgentPrevisCameraTechniques {
		mark := ""
		switch technique.Subject {
		case "required":
			mark = "*"
		case "optional":
			mark = "°"
		}
		keys := make([]string, 0, len(technique.Params))
		for _, param := range technique.Params {
			if len(param.Options) > 0 {
				keys = append(keys, param.Key+"="+strings.Join(param.Options, "/"))
			} else {
				keys = append(keys, fmt.Sprintf("%s %g~%g", param.Key, param.Min, param.Max))
			}
		}
		parts = append(parts, fmt.Sprintf("%s%s %s[%s]", technique.ID, mark, technique.Name, strings.Join(keys, ", ")))
	}
	return strings.Join(parts, "；")
}

// cloudAgentPrevisCameraRules 写进 catalog.rules：运镜叠加语义与常见误用。
const cloudAgentPrevisCameraRules = "运镜用 camera_move：id=摄影机 ID，technique 见 cameraMoves，或 recipe 见 cameraRecipes（一次写入整套多段运镜，二选一），time 起始秒，duration 用时（省略到镜头结束），easing 运动规律（linear 匀速/ease_in 加速/ease_out 减速/smooth 缓入缓出，默认 smooth），subjectId=跟拍、环绕、注视的演员或物体，params 见各手法（省略时取默认值，默认值只保证能看，不保证好看；按镜头设计写明距离、角度、景别）。多段按开始时间叠加：后一段从前一段结束的机位继续，同时生效的段会组合（环绕+升高=螺旋）；handheld/shake 是叠加层，可与任何运镜重叠。跟拍会随 actor_travel 的飞行、御剑高度一起升空；follow 的 side：behind 后方、front 倒退前跟、left/right 人物侧面、above 俯拍、shoulder 过肩、pov 主观；shotSize 按景别与焦段算距离和注视高度（extreme_close_up 面部大特写、close_up 肩部以上…），给了 distance 时以 distance 为准；后一段 follow 换方位或景别时给 blend（秒）让机位绕着人物过渡，不给时约 0.6 秒内甩过去。镜头设计与节拍见 manual=shots。重做运镜先 camera_move_remove（不给 keyframeId 即清空），只改一段用 keyframeId 传运镜 id 覆盖。不要再用 camera_keyframe_upsert 手算推拉摇移。"
