package app

import (
	"fmt"
	"math"
	"strings"
)

// actor_travel：演员在 [time, time+duration] 内从 A 点以某种方式移动到 B 点。
// 规则与 web/src/lib/canvas/previs/previs-travel.ts 一致：位置写成贴地的起终两帧（闪现用 step），
// 飞行 / 御剑 / 悬浮 / 跳跃的离地高度与姿态由 travels 段在前端求值。A/B 可以是用户右键标记的点（fromMarker/toMarker）。
var cloudAgentPrevisTravelStyles = []string{"walk", "run", "dash", "jump", "fly", "sword_fly", "float", "teleport"}

var cloudAgentPrevisTravelDefaultHeight = map[string]float64{"jump": 0.7, "fly": 3, "sword_fly": 2.5, "float": 1}

func cloudAgentPrevisMarkerPosition(scene map[string]any, label string) ([]float64, error) {
	wanted := strings.TrimSpace(label)
	for _, marker := range creationMaps(scene["markers"]) {
		if strings.EqualFold(stringValue(marker["label"]), wanted) || stringValue(marker["id"]) == wanted {
			if position, ok := cloudAgentPrevisNumberVec3(marker["position"]); ok {
				return position, nil
			}
		}
	}
	labels := make([]string, 0)
	for _, marker := range creationMaps(scene["markers"]) {
		labels = append(labels, stringValue(marker["label"]))
	}
	if len(labels) == 0 {
		return nil, BadAuthRequest("场景里还没有标记点；请用户在世界引擎视口右键地面「标记为点 A」，或改用 pathPoints 给出坐标")
	}
	return nil, BadAuthRequest(fmt.Sprintf("标记点 %q 不存在，现有：%s", wanted, strings.Join(labels, "、")))
}

// cloudAgentPrevisActorPositionAt 求演员在 time 的位置：按关键帧线性插值（step 段保持前值），没有关键帧用静态位置。
func cloudAgentPrevisActorPositionAt(object map[string]any, time float64) []float64 {
	base, ok := cloudAgentPrevisNumberVec3(cloudAgentPrevisMapTransform(object)["position"])
	if !ok {
		base = []float64{0, 0, 0}
	}
	keyframes := creationMaps(object["keyframes"])
	if len(keyframes) == 0 {
		return base
	}
	sorted := append([]map[string]any(nil), keyframes...)
	for i := range sorted {
		for j := i + 1; j < len(sorted); j++ {
			if numberValue(sorted[j]["time"], 0) < numberValue(sorted[i]["time"], 0) {
				sorted[i], sorted[j] = sorted[j], sorted[i]
			}
		}
	}
	at := func(item map[string]any) []float64 {
		position, ok := cloudAgentPrevisNumberVec3(cloudAgentPrevisMapTransform(item)["position"])
		if !ok {
			return base
		}
		return position
	}
	if time <= numberValue(sorted[0]["time"], 0) {
		return at(sorted[0])
	}
	for index := 1; index < len(sorted); index++ {
		previous, next := sorted[index-1], sorted[index]
		t0, t1 := numberValue(previous["time"], 0), numberValue(next["time"], 0)
		if time > t1 {
			continue
		}
		if stringValue(previous["easing"]) == "step" || t1-t0 < 1e-6 {
			return at(previous)
		}
		k := (time - t0) / (t1 - t0)
		a, b := at(previous), at(next)
		return []float64{a[0] + (b[0]-a[0])*k, a[1] + (b[1]-a[1])*k, a[2] + (b[2]-a[2])*k}
	}
	return at(sorted[len(sorted)-1])
}

func cloudAgentPrevisApplyActorTravel(scene map[string]any, object map[string]any, operation cloudAgentPrevisPatchOperation) (string, error) {
	if stringValue(object["kind"]) != "actor" && stringValue(object["primitive"]) != "character" {
		return "", BadAuthRequest("actor_travel 只适用于演员")
	}
	style := operation.TravelStyle
	if style == "" {
		style = "walk"
	}
	if err := cloudAgentPrevisValidateEnum(style, "travelStyle", cloudAgentPrevisTravelStyles...); err != nil {
		return "", err
	}
	shotDuration := cloudAgentPrevisShotDuration(scene)
	start := 0.0
	if operation.Time != nil {
		start = *operation.Time
	}
	duration := 3.0
	if operation.Duration != nil {
		duration = *operation.Duration
	}
	if err := cloudAgentPrevisFiniteInRange(start, "time", 0, shotDuration); err != nil {
		return "", err
	}
	if err := cloudAgentPrevisFiniteInRange(duration, "duration", 0.1, 60); err != nil {
		return "", err
	}
	if start+duration > shotDuration+1e-6 {
		return "", BadAuthRequest(fmt.Sprintf("移动 %.1f–%.1fs 超出镜头时长 %.1fs；缩短 duration 或先用 shot_update 加长镜头", start, start+duration, shotDuration))
	}
	var from, to []float64
	if len(operation.PathPoints) > 0 {
		for index, point := range operation.PathPoints {
			if err := cloudAgentPrevisValidateVec3(point, fmt.Sprintf("pathPoints[%d]", index)); err != nil {
				return "", err
			}
		}
		to = operation.PathPoints[len(operation.PathPoints)-1]
		if len(operation.PathPoints) > 1 {
			from = operation.PathPoints[0]
		}
	}
	var err error
	if operation.FromMarker != nil && *operation.FromMarker != "" {
		if from, err = cloudAgentPrevisMarkerPosition(scene, *operation.FromMarker); err != nil {
			return "", err
		}
	}
	if operation.ToMarker != nil && *operation.ToMarker != "" {
		if to, err = cloudAgentPrevisMarkerPosition(scene, *operation.ToMarker); err != nil {
			return "", err
		}
	}
	if to == nil {
		return "", BadAuthRequest("actor_travel 需要终点：toMarker（标记点标签）或 pathPoints")
	}
	if from == nil {
		from = cloudAgentPrevisActorPositionAt(object, start)
	}
	a := []float64{from[0], 0, from[2]}
	b := []float64{to[0], 0, to[2]}
	transform := cloudAgentPrevisMapTransform(object)
	rotation, ok := cloudAgentPrevisNumberVec3(transform["rotation"])
	if !ok {
		rotation = []float64{0, 0, 0}
	}
	scale, ok := cloudAgentPrevisNumberVec3(transform["scale"])
	if !ok {
		scale = []float64{1, 1, 1}
	}
	yaw := rotation[1]
	if math.Hypot(b[0]-a[0], b[2]-a[2]) > 1e-3 {
		yaw = math.Atan2(b[0]-a[0], b[2]-a[2])
	}
	easing := "linear"
	if style == "teleport" {
		easing = "step"
	} else if style == "fly" || style == "sword_fly" || style == "float" {
		easing = "smooth"
	}
	end := start + duration
	id := stringValue(object["id"])
	suffix := fmt.Sprintf("%d", int(math.Round(start*1000)))
	frame := func(name string, time float64, point []float64, frameEasing string) map[string]any {
		return map[string]any{"id": fmt.Sprintf("%s-travel-%s-%s", id, suffix, name), "time": math.Round(time*1000) / 1000, "easing": frameEasing, "transform": map[string]any{"position": cloudAgentPrevisVec3(point), "rotation": []any{rotation[0], yaw, rotation[2]}, "scale": cloudAgentPrevisVec3(scale)}}
	}
	keyframes := make([]map[string]any, 0)
	for _, keyframe := range creationMaps(object["keyframes"]) {
		time := numberValue(keyframe["time"], 0)
		if time < start-1e-3 || time > end+1e-3 {
			keyframes = append(keyframes, keyframe)
		}
	}
	keyframes = append(keyframes, frame("a", start, a, easing), frame("b", end, b, "linear"))
	for i := range keyframes {
		for j := i + 1; j < len(keyframes); j++ {
			if numberValue(keyframes[j]["time"], 0) < numberValue(keyframes[i]["time"], 0) {
				keyframes[i], keyframes[j] = keyframes[j], keyframes[i]
			}
		}
	}
	travel := map[string]any{"id": fmt.Sprintf("%s-travel-%s", id, suffix), "start": start, "duration": duration, "style": style}
	if height, ok := cloudAgentPrevisTravelDefaultHeight[style]; ok {
		if operation.Height != nil {
			height = *operation.Height
		}
		if err := cloudAgentPrevisFiniteInRange(height, "height", 0, 50); err != nil {
			return "", err
		}
		travel["height"] = height
	}
	travels := make([]map[string]any, 0)
	for _, existing := range creationMaps(object["travels"]) {
		s, d := numberValue(existing["start"], 0), numberValue(existing["duration"], 0)
		if s+d <= start+1e-3 || s >= end-1e-3 {
			travels = append(travels, existing)
		}
	}
	travels = append(travels, travel)
	object["keyframes"] = keyframes
	object["travels"] = travels
	delete(object, "motionPath")
	summary := fmt.Sprintf("《%s》%.1f–%.1fs %s：(%.1f, %.1f) → (%.1f, %.1f)", stringValue(object["name"]), start, end, style, a[0], a[2], b[0], b[2])
	// 速度远超方式的合理上限时在审批摘要里提示（例如 3 秒跑 120 米），让 Agent 与用户在执行前看到。
	distance := math.Hypot(b[0]-a[0], b[2]-a[2])
	limits := map[string]float64{"walk": 2.5, "run": 10, "dash": 14, "jump": 8, "float": 4}
	if limit, ok := limits[style]; ok && distance/duration > limit {
		summary += fmt.Sprintf("；注意：距离 %.0f 米、约 %.0f 米/秒，远超%s的合理速度，建议加长时长或改用飞行 / 闪现", distance, distance/duration, style)
	}
	return summary, nil
}

func cloudAgentPrevisValidateMarkersAndTravels(scene map[string]any) error {
	markers := creationMaps(scene["markers"])
	if len(markers) > 64 {
		return BadAuthRequest("标记点最多 64 个")
	}
	for _, marker := range markers {
		if err := cloudAgentPrevisValidateText(stringValue(marker["label"]), "标记点标签", 8, true); err != nil {
			return err
		}
		position, ok := cloudAgentPrevisNumberVec3(marker["position"])
		if !ok {
			return BadAuthRequest("标记点坐标必须包含3个数字")
		}
		if err := cloudAgentPrevisValidateVec3(position, "标记点坐标"); err != nil {
			return err
		}
	}
	for _, object := range creationMaps(scene["objects"]) {
		for _, travel := range creationMaps(object["travels"]) {
			if err := cloudAgentPrevisValidateEnum(stringValue(travel["style"]), "位移方式", cloudAgentPrevisTravelStyles...); err != nil {
				return err
			}
			if err := cloudAgentPrevisFiniteInRange(numberValue(travel["start"], math.NaN()), "位移开始", 0, 60); err != nil {
				return err
			}
			if err := cloudAgentPrevisFiniteInRange(numberValue(travel["duration"], math.NaN()), "位移时长", 0.1, 60); err != nil {
				return err
			}
		}
	}
	return nil
}

// cloudAgentPrevisProjectMarkers 读场景时返回标记点，Agent 按标签引用（「从 A 到 B」）。
func cloudAgentPrevisProjectMarkers(scene map[string]any) []map[string]any {
	markers := make([]map[string]any, 0)
	for _, marker := range creationMaps(scene["markers"]) {
		markers = append(markers, map[string]any{"label": stringValue(marker["label"]), "position": projectPrevisVec3(marker["position"])})
	}
	return markers
}

func cloudAgentPrevisProjectTravels(object map[string]any) []map[string]any {
	travels := make([]map[string]any, 0)
	for _, travel := range creationMaps(object["travels"]) {
		item := map[string]any{"style": stringValue(travel["style"]), "start": numberValue(travel["start"], 0), "duration": numberValue(travel["duration"], 0)}
		if height, ok := travel["height"]; ok {
			item["height"] = numberValue(height, 0)
		}
		travels = append(travels, item)
	}
	return travels
}
