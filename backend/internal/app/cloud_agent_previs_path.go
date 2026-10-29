package app

import (
	"fmt"
	"math"
	"strings"
)

// 路径动画：途经点（Y 为离地高度，地面 0 米）+ 速率 + 每段速度倍率 + 停留 + 运动规律 + 折线 / 平滑曲线，展开成 transform 关键帧。
// 规则与 web/src/lib/canvas/previs/previs-motion-path.ts 完全一致，两边改动需同步；
// cloud_agent_previs_path_test.go 与 web/test/previs-motion-path.test.ts 用同一组数值互相校对。
// 演员位置 Y 锁 0，路径高度写进关键帧 lift（人偶悬空移动）；摄影机与道具直接写位置高度。

const (
	cloudAgentPrevisPathMaxPoints   = 64
	cloudAgentPrevisPathMaxSamples  = 200
	cloudAgentPrevisPathSampleRate  = 10
	cloudAgentPrevisMaxSketchPaths  = 32
	cloudAgentPrevisSketchLabelMax  = 16
	cloudAgentPrevisPathMaxDuration = 60
)

var cloudAgentPrevisPathEasings = []string{"linear", "ease_in", "ease_out", "smooth"}

type cloudAgentPrevisPathSpec struct {
	Points          [][]float64
	Speed           string
	MetersPerSecond float64
	Duration        float64
	StartDelay      float64
	Orient          bool
	Easing          string
	Curve           bool
	Speeds          []float64
	Holds           []float64
}

func cloudAgentPrevisClamp(value, low, high float64) float64 {
	return math.Min(high, math.Max(low, value))
}

func cloudAgentPrevisPathEase(easing string, value float64) float64 {
	w := cloudAgentPrevisClamp(value, 0, 1)
	switch easing {
	case "ease_in":
		return w * w
	case "ease_out":
		return 1 - (1-w)*(1-w)
	case "smooth":
		return w * w * (3 - 2*w)
	}
	return w
}

func (spec cloudAgentPrevisPathSpec) speed() float64 {
	if spec.MetersPerSecond > 0 && !math.IsInf(spec.MetersPerSecond, 0) {
		return cloudAgentPrevisClamp(spec.MetersPerSecond, 0.05, 100)
	}
	if value, ok := cloudAgentPrevisPathSpeeds[spec.Speed]; ok {
		return value
	}
	return cloudAgentPrevisPathSpeeds["walk"]
}

type cloudAgentPrevisPathGeometry struct {
	vertices       [][]float64
	waypointVertex []int
	edgeSegment    []int
}

// cloudAgentPrevisPathGeometryOf：折线直接用途经点；平滑曲线用均匀 Catmull-Rom，每段细分 clamp(floor(200/段数), 1, 8)。
func cloudAgentPrevisPathGeometryOf(points [][]float64, curve bool) cloudAgentPrevisPathGeometry {
	count := len(points)
	copyPoint := func(point []float64) []float64 { return []float64{point[0], point[1], point[2]} }
	if !curve || count < 3 {
		geometry := cloudAgentPrevisPathGeometry{}
		for index, point := range points {
			geometry.vertices = append(geometry.vertices, copyPoint(point))
			geometry.waypointVertex = append(geometry.waypointVertex, index)
			if index > 0 {
				geometry.edgeSegment = append(geometry.edgeSegment, index-1)
			}
		}
		return geometry
	}
	subdivisions := int(cloudAgentPrevisClamp(math.Floor(float64(cloudAgentPrevisPathMaxSamples)/float64(count-1)), 1, 8))
	geometry := cloudAgentPrevisPathGeometry{}
	for segment := 0; segment < count-1; segment++ {
		p0, p1, p2, p3 := points[max(0, segment-1)], points[segment], points[segment+1], points[min(count-1, segment+2)]
		geometry.waypointVertex = append(geometry.waypointVertex, len(geometry.vertices))
		for step := 0; step < subdivisions; step++ {
			t := float64(step) / float64(subdivisions)
			t2, t3 := t*t, t*t*t
			if step == 0 {
				geometry.vertices = append(geometry.vertices, copyPoint(p1))
			} else {
				axis := func(i int) float64 {
					return 0.5 * (2*p1[i] + (-p0[i]+p2[i])*t + (2*p0[i]-5*p1[i]+4*p2[i]-p3[i])*t2 + (-p0[i]+3*p1[i]-3*p2[i]+p3[i])*t3)
				}
				geometry.vertices = append(geometry.vertices, []float64{axis(0), axis(1), axis(2)})
			}
			geometry.edgeSegment = append(geometry.edgeSegment, segment)
		}
	}
	geometry.waypointVertex = append(geometry.waypointVertex, len(geometry.vertices))
	geometry.vertices = append(geometry.vertices, copyPoint(points[count-1]))
	return geometry
}

type cloudAgentPrevisPathPlan struct {
	geometry   cloudAgentPrevisPathGeometry
	edgeTimes  []float64
	holds      []float64
	start      float64
	length     float64
	travel     float64
	end        float64
	compressed bool
	stationary bool
}

func cloudAgentPrevisPlanPath(spec cloudAgentPrevisPathSpec, shotDuration float64) (cloudAgentPrevisPathPlan, error) {
	points := spec.Points
	if len(points) < 2 || len(points) > cloudAgentPrevisPathMaxPoints {
		return cloudAgentPrevisPathPlan{}, BadAuthRequest(fmt.Sprintf("路径需要 2 到 %d 个途经点", cloudAgentPrevisPathMaxPoints))
	}
	for index, point := range points {
		if err := cloudAgentPrevisValidateVec3(point, fmt.Sprintf("pathPoints[%d]", index)); err != nil {
			return cloudAgentPrevisPathPlan{}, err
		}
	}
	geometry := cloudAgentPrevisPathGeometryOf(points, spec.Curve)
	speed := spec.speed()
	segmentSpeed := func(segment int) float64 {
		if segment < len(spec.Speeds) && !math.IsNaN(spec.Speeds[segment]) && !math.IsInf(spec.Speeds[segment], 0) {
			return cloudAgentPrevisClamp(spec.Speeds[segment], 0.1, 10)
		}
		return 1
	}
	edgeTimes := make([]float64, len(geometry.edgeSegment))
	length, travel := 0.0, 0.0
	for index := range geometry.edgeSegment {
		a, b := geometry.vertices[index], geometry.vertices[index+1]
		edge := math.Sqrt((b[0]-a[0])*(b[0]-a[0]) + (b[1]-a[1])*(b[1]-a[1]) + (b[2]-a[2])*(b[2]-a[2]))
		length += edge
		edgeTimes[index] = edge / (speed * segmentSpeed(geometry.edgeSegment[index]))
		travel += edgeTimes[index]
	}
	if length < 0.01 {
		return cloudAgentPrevisPathPlan{}, BadAuthRequest("路径起终点过近，无法形成移动")
	}
	if spec.Duration > 0 {
		factor := cloudAgentPrevisClamp(spec.Duration, 0.1, cloudAgentPrevisPathMaxDuration) / travel
		for index := range edgeTimes {
			edgeTimes[index] *= factor
		}
		travel *= factor
	}
	holds := make([]float64, len(points))
	holdTotal := 0.0
	for index := range points {
		if index < len(points)-1 && index < len(spec.Holds) && !math.IsNaN(spec.Holds[index]) {
			holds[index] = cloudAgentPrevisClamp(spec.Holds[index], 0, 60)
			holdTotal += holds[index]
		}
	}
	total := shotDuration
	if !(total > 0) {
		total = 5
	}
	start := cloudAgentPrevisClamp(spec.StartDelay, 0, total)
	available := total - start
	plan := cloudAgentPrevisPathPlan{geometry: geometry, edgeTimes: edgeTimes, holds: holds, start: start, length: length, travel: travel, end: start}
	if available <= 0.05 {
		plan.stationary = true
		return plan, nil
	}
	if travel+holdTotal > available {
		factor := available / (travel + holdTotal)
		for index := range edgeTimes {
			edgeTimes[index] *= factor
		}
		for index := range holds {
			holds[index] *= factor
		}
		travel *= factor
		holdTotal *= factor
		plan.compressed = true
	}
	plan.travel = travel
	plan.end = start + travel + holdTotal
	return plan, nil
}

// cloudAgentPrevisBuildPathKeyframes 展开路径；关键帧 id 为 `<id>-path-<n>`，startDelay 前的等待帧为 `<id>-path-hold`。
func cloudAgentPrevisBuildPathKeyframes(id string, rotation, scale []float64, spec cloudAgentPrevisPathSpec, shotDuration float64, locked bool) ([]map[string]any, error) {
	plan, err := cloudAgentPrevisPlanPath(spec, shotDuration)
	if err != nil {
		return nil, err
	}
	vertices, waypointVertex := plan.geometry.vertices, plan.geometry.waypointVertex
	lastYaw := rotation[1]
	heading := func(from, to []float64) float64 {
		if !spec.Orient {
			return rotation[1]
		}
		dx, dz := to[0]-from[0], to[2]-from[2]
		if math.Hypot(dx, dz) > 1e-5 {
			lastYaw = math.Atan2(dx, dz)
		}
		return lastYaw
	}
	vertexYaw := func(index int) float64 {
		return heading(vertices[max(0, index-1)], vertices[min(len(vertices)-1, index+1)])
	}
	round3 := func(value float64) float64 { return math.Round(value*1000) / 1000 }
	round4 := func(value float64) float64 { return math.Round(value*10000) / 10000 }
	frames := make([]map[string]any, 0)
	counter := 0
	lastTime := math.Inf(-1)
	push := func(time float64, point []float64, yaw float64, suffix string) {
		rounded := round3(time)
		if len(frames) > 0 && rounded <= lastTime+1e-4 {
			return
		}
		if suffix == "" {
			counter++
			suffix = fmt.Sprintf("%d", counter)
		}
		height := round4(point[1])
		if locked {
			height = round4(math.Max(0, point[1]))
		}
		y := height
		if locked {
			y = 0
		}
		frame := map[string]any{
			"id": fmt.Sprintf("%s-path-%s", id, suffix), "time": rounded, "easing": "linear",
			"transform": map[string]any{"position": []any{round4(point[0]), y, round4(point[2])}, "rotation": []any{rotation[0], yaw, rotation[2]}, "scale": cloudAgentPrevisVec3(scale)},
		}
		if locked && height > 1e-4 {
			frame["lift"] = height
		}
		frames = append(frames, frame)
		lastTime = rounded
	}
	if plan.stationary {
		push(plan.start, vertices[0], vertexYaw(0), "hold")
		return frames, nil
	}
	if plan.start > 0 {
		push(0, vertices[0], vertexYaw(0), "hold")
	}
	current := plan.start
	push(current, vertices[0], vertexYaw(0), "")
	if plan.holds[0] > 0 {
		current += plan.holds[0]
		push(current, vertices[0], vertexYaw(0), "")
	}
	type leg struct{ from, to, waypoint int }
	legs := make([]leg, 0)
	legStart := 0
	for waypoint := 1; waypoint < len(waypointVertex); waypoint++ {
		if waypoint == len(waypointVertex)-1 || plan.holds[waypoint] > 0 {
			legs = append(legs, leg{waypointVertex[legStart], waypointVertex[waypoint], waypoint})
			legStart = waypoint
		}
	}
	easing := spec.Easing
	if easing == "" {
		easing = "linear"
	}
	rate := float64(cloudAgentPrevisPathSampleRate)
	if plan.travel*rate > cloudAgentPrevisPathMaxSamples {
		rate = cloudAgentPrevisPathMaxSamples / plan.travel
	}
	for _, item := range legs {
		cumulative := []float64{0}
		for edge := item.from; edge < item.to; edge++ {
			cumulative = append(cumulative, cumulative[len(cumulative)-1]+plan.edgeTimes[edge])
		}
		legTime := cumulative[len(cumulative)-1]
		if easing == "linear" {
			for vertex := item.from + 1; vertex <= item.to; vertex++ {
				push(current+cumulative[vertex-item.from], vertices[vertex], vertexYaw(vertex), "")
			}
		} else {
			samples := max(2, int(math.Ceil(legTime*rate)))
			edge := 0
			for step := 1; step <= samples; step++ {
				w := float64(step) / float64(samples)
				target := cloudAgentPrevisPathEase(easing, w) * legTime
				for edge < item.to-item.from-1 && cumulative[edge+1] < target {
					edge++
				}
				span := cumulative[edge+1] - cumulative[edge]
				k := 1.0
				if span > 1e-9 {
					k = cloudAgentPrevisClamp((target-cumulative[edge])/span, 0, 1)
				}
				a, b := vertices[item.from+edge], vertices[item.from+edge+1]
				point := []float64{a[0] + (b[0]-a[0])*k, a[1] + (b[1]-a[1])*k, a[2] + (b[2]-a[2])*k}
				var yaw float64
				if step == samples {
					yaw = vertexYaw(item.from + edge + 1)
				} else {
					yaw = heading(a, b)
				}
				push(current+w*legTime, point, yaw, "")
			}
		}
		current += legTime
		if hold := plan.holds[item.waypoint]; hold > 0 {
			current += hold
			push(current, vertices[item.to], vertexYaw(item.to), "")
		}
	}
	return frames, nil
}

// cloudAgentPrevisSketchPath 按 id 或标签（不区分大小写）找用户画的参考轨迹。
func cloudAgentPrevisSketchPath(scene map[string]any, ref string) ([][]float64, error) {
	wanted := strings.TrimSpace(ref)
	labels := make([]string, 0)
	for _, path := range creationMaps(scene["paths"]) {
		label := stringValue(path["label"])
		labels = append(labels, label)
		if stringValue(path["id"]) != wanted && !strings.EqualFold(label, wanted) {
			continue
		}
		points := make([][]float64, 0)
		for _, raw := range creationAnyList(path["points"]) {
			if point, ok := cloudAgentPrevisNumberVec3(raw); ok {
				points = append(points, point)
			}
		}
		return points, nil
	}
	if len(labels) == 0 {
		return nil, BadAuthRequest("场景里还没有参考轨迹；请用户在世界引擎里不选对象、用画笔或折线画一条，或改用 pathPoints 给出坐标")
	}
	return nil, BadAuthRequest(fmt.Sprintf("参考轨迹 %q 不存在，现有：%s", wanted, strings.Join(labels, "、")))
}

func creationAnyList(value any) []any {
	switch items := value.(type) {
	case []any:
		return items
	case [][]float64:
		result := make([]any, 0, len(items))
		for _, item := range items {
			result = append(result, item)
		}
		return result
	}
	return nil
}

// cloudAgentPrevisPathSource 解析 pathId：先找参考轨迹（scene.paths 的标签或 ID），再找已有路径的对象或摄影机（ID 或名称）。
// 复用对象或摄影机的路径时连同速率、运动规律、曲线、段速与停留一起带过来，节奏与原路径一致。
func cloudAgentPrevisPathSource(scene map[string]any, ref string) (cloudAgentPrevisPathSpec, bool, error) {
	wanted := strings.TrimSpace(ref)
	for _, path := range creationMaps(scene["paths"]) {
		if stringValue(path["id"]) == wanted || strings.EqualFold(stringValue(path["label"]), wanted) {
			points, err := cloudAgentPrevisSketchPath(scene, wanted)
			// 参考轨迹按画下的折线走：画笔笔画本身已足够密，再套曲线会让高度超出用户画的值。
			return cloudAgentPrevisPathSpec{Points: points}, false, err
		}
	}
	for _, collection := range []string{"cameras", "objects"} {
		for _, item := range creationMaps(scene[collection]) {
			if stringValue(item["id"]) != wanted && stringValue(item["name"]) != wanted {
				continue
			}
			motionPath, ok := item["motionPath"].(map[string]any)
			if !ok {
				return cloudAgentPrevisPathSpec{}, true, BadAuthRequest(fmt.Sprintf("《%s》没有路径动画，不能作为 pathId", truncateRunes(stringValue(item["name"]), 40)))
			}
			spec := cloudAgentPrevisPathSpec{
				Speed: stringValue(motionPath["speed"]), MetersPerSecond: numberValue(motionPath["metersPerSecond"], 0), Duration: numberValue(motionPath["duration"], 0),
				StartDelay: numberValue(motionPath["startDelay"], 0), Easing: stringValue(motionPath["easing"]), Curve: boolValue(motionPath["curve"], false),
			}
			for _, raw := range creationAnyList(motionPath["points"]) {
				if point, ok := cloudAgentPrevisNumberVec3(raw); ok {
					spec.Points = append(spec.Points, point)
				}
			}
			for _, raw := range creationAnyList(motionPath["speeds"]) {
				spec.Speeds = append(spec.Speeds, numberValue(raw, 1))
			}
			for _, raw := range creationAnyList(motionPath["holds"]) {
				spec.Holds = append(spec.Holds, numberValue(raw, 0))
			}
			return spec, true, nil
		}
	}
	_, err := cloudAgentPrevisSketchPath(scene, wanted)
	if err == nil {
		err = BadAuthRequest(fmt.Sprintf("pathId %q 既不是参考轨迹，也不是带路径的对象或摄影机", wanted))
	}
	return cloudAgentPrevisPathSpec{}, false, err
}

// cloudAgentPrevisSetMotionPath 处理 object_motion_path_set：目标可以是对象或摄影机；
// 点来自 pathPoints（Y=离地高度）或 pathId（参考轨迹、或另一个对象 / 摄影机的路径）；easing 是运动规律，duration 是移动用时。
// 高度：height 给了就把整条路径放到这个离地高度；否则参考轨迹与 pathPoints 保留各点高度，
// 把别人的路径（例如摄影机的运镜轨迹）交给演员时默认贴地行走。
func cloudAgentPrevisSetMotionPath(scene map[string]any, item map[string]any, operation cloudAgentPrevisPatchOperation, duration float64, locked bool) (string, error) {
	spec := cloudAgentPrevisPathSpec{Points: operation.PathPoints}
	copied := false
	if operation.PathID != nil && strings.TrimSpace(*operation.PathID) != "" {
		if len(operation.PathPoints) > 0 {
			return "", BadAuthRequest("pathPoints 与 pathId 只能给一个")
		}
		source, fromOwner, err := cloudAgentPrevisPathSource(scene, *operation.PathID)
		if err != nil {
			return "", err
		}
		spec, copied = source, fromOwner
	}
	if operation.Height != nil {
		if err := cloudAgentPrevisFiniteInRange(*operation.Height, "height", 0, 50); err != nil {
			return "", err
		}
	}
	points := make([][]float64, 0, len(spec.Points))
	for _, point := range spec.Points {
		if len(point) != 3 {
			return "", BadAuthRequest("路径点必须包含 3 个数字")
		}
		next := []float64{point[0], point[1], point[2]}
		switch {
		case operation.Height != nil:
			next[1] = *operation.Height
		case copied && locked:
			next[1] = 0
		}
		points = append(points, next)
	}
	spec.Points = points
	if operation.PathSpeed != "" || spec.Speed == "" {
		spec.Speed = operation.PathSpeed
		if spec.Speed == "" {
			spec.Speed = "walk"
		}
		if operation.PathSpeed != "" {
			spec.MetersPerSecond = 0
		}
	}
	if err := cloudAgentPrevisValidateEnum(spec.Speed, "pathSpeed", "slow", "walk", "run"); err != nil {
		return "", err
	}
	if operation.Easing != "" {
		spec.Easing = operation.Easing
	}
	if spec.Easing == "" {
		spec.Easing = "linear"
	}
	if err := cloudAgentPrevisValidateEnum(spec.Easing, "路径运动规律 easing", cloudAgentPrevisPathEasings...); err != nil {
		return "", BadAuthRequest("路径 easing 只能是 linear（匀速）/ease_in（加速）/ease_out（减速）/smooth（缓入缓出）")
	}
	if operation.StartDelay != nil {
		spec.StartDelay = *operation.StartDelay
	} else if !copied {
		spec.StartDelay = 0
	}
	if err := cloudAgentPrevisFiniteInRange(spec.StartDelay, "startDelay", 0, duration); err != nil {
		return "", err
	}
	if operation.Duration != nil {
		if err := cloudAgentPrevisFiniteInRange(*operation.Duration, "duration", 0.1, cloudAgentPrevisPathMaxDuration); err != nil {
			return "", err
		}
		spec.Duration = *operation.Duration
	}
	spec.Orient = locked
	if operation.OrientToPath != nil {
		spec.Orient = *operation.OrientToPath
	}
	if locked {
		for index, point := range points {
			if point[1] < 0 {
				return "", BadAuthRequest(fmt.Sprintf("pathPoints[%d] 的高度不能低于地面 0 米", index))
			}
		}
	}
	transform := cloudAgentPrevisMapTransform(item)
	rotation, ok := cloudAgentPrevisNumberVec3(transform["rotation"])
	if !ok {
		rotation = []float64{0, 0, 0}
	}
	scale, ok := cloudAgentPrevisNumberVec3(transform["scale"])
	if !ok {
		scale = []float64{1, 1, 1}
	}
	keyframes, err := cloudAgentPrevisBuildPathKeyframes(stringValue(item["id"]), rotation, scale, spec, duration, locked)
	if err != nil {
		return "", err
	}
	stored := make([]any, 0, len(points))
	top := 0.0
	for _, point := range points {
		stored = append(stored, cloudAgentPrevisVec3(point))
		top = math.Max(top, point[1])
	}
	motionPath := map[string]any{"points": stored, "speed": spec.Speed, "startDelay": spec.StartDelay, "orientToPath": spec.Orient}
	if spec.Easing != "linear" {
		motionPath["easing"] = spec.Easing
	}
	if spec.Duration > 0 {
		motionPath["duration"] = spec.Duration
	}
	if spec.MetersPerSecond > 0 {
		motionPath["metersPerSecond"] = spec.MetersPerSecond
	}
	if spec.Curve && len(points) > 2 {
		motionPath["curve"] = true
	}
	if len(spec.Speeds) == len(points)-1 {
		motionPath["speeds"] = cloudAgentPrevisFloatList(spec.Speeds)
	}
	if len(spec.Holds) == len(points) {
		motionPath["holds"] = cloudAgentPrevisFloatList(spec.Holds)
	}
	item["motionPath"] = motionPath
	// 与 UI 画走位一致：整条路径接管 transform 轨道，避免走完后跳回旧手工帧。
	item["keyframes"] = keyframes
	plan, _ := cloudAgentPrevisPlanPath(spec, duration)
	summary := fmt.Sprintf("《%s》沿 %d 个途经点的路径移动 %.1f–%.1fs，约 %.1f 米，%s", truncateRunes(stringValue(item["name"]), 40), len(points), plan.start, plan.end, plan.length, spec.Easing)
	if top > 0.05 {
		summary += fmt.Sprintf("，最高离地 %.1f 米", top)
	}
	if copied {
		summary += "，路线复用自 " + truncateRunes(strings.TrimSpace(*operation.PathID), 40)
	}
	if plan.compressed {
		summary += "；镜头时长不够，已整体加速压缩"
	}
	return summary, nil
}

func cloudAgentPrevisFloatList(values []float64) []any {
	result := make([]any, 0, len(values))
	for _, value := range values {
		result = append(result, value)
	}
	return result
}

func cloudAgentPrevisValidateNumberList(value any, label string, length int, low, high float64) error {
	if value == nil {
		return nil
	}
	items, ok := value.([]any)
	if !ok || len(items) != length {
		return BadAuthRequest(fmt.Sprintf("%s 必须是 %d 个数字", label, length))
	}
	for _, item := range items {
		if err := cloudAgentPrevisFiniteInRange(numberValue(item, math.NaN()), label, low, high); err != nil {
			return err
		}
	}
	return nil
}

// cloudAgentPrevisValidateMotionPath 校验对象与摄影机的路径（含浏览器写入的速率、运动规律、停留）。
func cloudAgentPrevisValidateMotionPath(motionPath map[string]any) error {
	points, pointsOK := motionPath["points"].([]any)
	if !pointsOK || len(points) < 2 || len(points) > cloudAgentPrevisPathMaxPoints {
		return BadAuthRequest("世界引擎 motionPath 点数无效")
	}
	for index, point := range points {
		value, ok := cloudAgentPrevisNumberVec3(point)
		if !ok {
			return BadAuthRequest(fmt.Sprintf("世界引擎 motionPath 点 %d 无效", index))
		}
		if err := cloudAgentPrevisValidateVec3(value, "motionPath point"); err != nil {
			return err
		}
	}
	if err := cloudAgentPrevisValidateEnum(stringValue(motionPath["speed"]), "motionPath speed", "slow", "walk", "run"); err != nil {
		return err
	}
	if err := cloudAgentPrevisFiniteInRange(numberValue(motionPath["startDelay"], math.NaN()), "motionPath startDelay", 0, 60); err != nil {
		return err
	}
	if easing := stringValue(motionPath["easing"]); easing != "" {
		if err := cloudAgentPrevisValidateEnum(easing, "motionPath easing", cloudAgentPrevisPathEasings...); err != nil {
			return err
		}
	}
	if value, ok := motionPath["duration"]; ok && value != nil {
		if err := cloudAgentPrevisFiniteInRange(numberValue(value, math.NaN()), "motionPath duration", 0.1, cloudAgentPrevisPathMaxDuration); err != nil {
			return err
		}
	}
	if value, ok := motionPath["metersPerSecond"]; ok && value != nil {
		if err := cloudAgentPrevisFiniteInRange(numberValue(value, math.NaN()), "motionPath metersPerSecond", 0.05, 100); err != nil {
			return err
		}
	}
	if value, ok := motionPath["curve"]; ok && value != nil {
		if _, isBool := value.(bool); !isBool {
			return BadAuthRequest("motionPath curve 必须是布尔值")
		}
	}
	if err := cloudAgentPrevisValidateNumberList(motionPath["speeds"], "motionPath speeds", len(points)-1, 0.1, 10); err != nil {
		return err
	}
	return cloudAgentPrevisValidateNumberList(motionPath["holds"], "motionPath holds", len(points), 0, 60)
}

// cloudAgentPrevisValidateSketchPaths 校验用户画的参考轨迹。
func cloudAgentPrevisValidateSketchPaths(scene map[string]any) error {
	raw, ok := scene["paths"]
	if !ok || raw == nil {
		return nil
	}
	paths := creationMaps(raw)
	if len(paths) > cloudAgentPrevisMaxSketchPaths {
		return BadAuthRequest(fmt.Sprintf("参考轨迹最多 %d 条", cloudAgentPrevisMaxSketchPaths))
	}
	seen := map[string]bool{}
	for _, path := range paths {
		id := stringValue(path["id"])
		if err := validateCloudAgentID(id, "参考轨迹 ID", 80); err != nil {
			return err
		}
		if seen[id] {
			return BadAuthRequest("参考轨迹 ID 重复")
		}
		seen[id] = true
		if err := cloudAgentPrevisValidateText(stringValue(path["label"]), "参考轨迹标签", cloudAgentPrevisSketchLabelMax, true); err != nil {
			return err
		}
		points := creationAnyList(path["points"])
		if len(points) < 2 || len(points) > cloudAgentPrevisPathMaxPoints {
			return BadAuthRequest("参考轨迹点数无效")
		}
		for _, point := range points {
			value, ok := cloudAgentPrevisNumberVec3(point)
			if !ok {
				return BadAuthRequest("参考轨迹点坐标无效")
			}
			if err := cloudAgentPrevisValidateVec3(value, "参考轨迹点"); err != nil {
				return err
			}
		}
	}
	return nil
}

func cloudAgentPrevisRound(value float64, digits float64) float64 {
	return math.Round(value*digits) / digits
}

func cloudAgentPrevisProjectPoints(points []any) ([]any, float64, float64) {
	result := make([]any, 0, len(points))
	length, top := 0.0, 0.0
	var previous []float64
	for _, raw := range points {
		point, ok := cloudAgentPrevisNumberVec3(raw)
		if !ok {
			continue
		}
		result = append(result, []any{cloudAgentPrevisRound(point[0], 100), cloudAgentPrevisRound(point[1], 100), cloudAgentPrevisRound(point[2], 100)})
		if previous != nil {
			length += math.Sqrt((point[0]-previous[0])*(point[0]-previous[0]) + (point[1]-previous[1])*(point[1]-previous[1]) + (point[2]-previous[2])*(point[2]-previous[2]))
		}
		top = math.Max(top, point[1])
		previous = point
	}
	return result, cloudAgentPrevisRound(length, 100), cloudAgentPrevisRound(top, 100)
}

// cloudAgentPrevisProjectSketchPaths 读场景时返回参考轨迹：标签、点（Y=离地高度）、长度与最高点，Agent 按标签用 pathId 引用。
func cloudAgentPrevisProjectSketchPaths(scene map[string]any) []map[string]any {
	result := make([]map[string]any, 0)
	for _, path := range creationMaps(scene["paths"]) {
		points, length, top := cloudAgentPrevisProjectPoints(creationAnyList(path["points"]))
		result = append(result, map[string]any{"id": stringValue(path["id"]), "label": stringValue(path["label"]), "points": points, "length": length, "maxHeight": top})
	}
	return result
}

// cloudAgentPrevisProjectMotionPath 投影对象或摄影机已有的路径动画，Agent 才能在原路径上微调。
func cloudAgentPrevisProjectMotionPath(item map[string]any) map[string]any {
	motionPath, ok := item["motionPath"].(map[string]any)
	if !ok {
		return nil
	}
	points, length, top := cloudAgentPrevisProjectPoints(creationAnyList(motionPath["points"]))
	result := map[string]any{"points": points, "length": length, "maxHeight": top, "startDelay": numberValue(motionPath["startDelay"], 0), "speed": stringValue(motionPath["speed"])}
	if easing := stringValue(motionPath["easing"]); easing != "" {
		result["easing"] = easing
	}
	if value, ok := motionPath["duration"]; ok {
		result["duration"] = numberValue(value, 0)
	}
	if boolValue(motionPath["curve"], false) {
		result["curve"] = true
	}
	frames := creationMaps(item["keyframes"])
	if len(frames) > 0 {
		result["end"] = numberValue(frames[len(frames)-1]["time"], 0)
	}
	return result
}

// cloudAgentPrevisPathRules 写进 catalog.rules：路径、高度、速率与运动规律。
const cloudAgentPrevisPathRules = "沿路线移动用 object_motion_path_set：id 可以是演员、道具或摄影机；pathPoints 的 Y 是离地高度（米，地面为 0），演员给高度即悬空飞行；pathId 代替 pathPoints，可传参考轨迹标签（scene.paths，如 路径1）或另一个对象 / 摄影机的 ID（复用它的路径与节奏；交给演员时默认贴地），height 把整条路径放到同一离地高度；duration=移动用时（秒，省略按 pathSpeed 步速），startDelay=开始秒，easing=运动规律 linear 匀速/ease_in 加速/ease_out 减速/smooth 缓入缓出。读场景时 objects[].motionPath / cameras[].motionPath 是已有路径，微调时改点后整条重写。"
