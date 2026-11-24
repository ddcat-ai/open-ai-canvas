package app

import (
	"fmt"
	"math"
	"sort"
	"strings"
)

// 镜头检查：按场景数据（不是画面）列出会让成片显得单薄的地方，例如长镜头只有一个运动节拍、
// 运镜全靠默认参数、跟拍换方位没有过渡或交接留了空档、人物在走但没有镜头跟。结果随 previs_apply_patch 的写入结果
// 和 previs_scene_read 的场景精读一起返回，Agent 据此自查；它只是事实提示，不拒绝写入。

const cloudAgentPrevisReviewMaxShots = 8

const cloudAgentPrevisReviewGuide = "review 是按场景数据做的镜头检查，不代表看过画面。用户要电影感、高级运镜或某位导演的手法时，按 manual=shots 补齐节拍后再交付；用户明确要固定机位或简单镜头时可以忽略，并在回复里说明取舍。"

func cloudAgentPrevisIsActorMap(object map[string]any) bool {
	return stringValue(object["kind"]) == "actor" || stringValue(object["primitive"]) == "character"
}

// cloudAgentPrevisObjectMoves 判断对象在镜头里是否有位移：A→B 位移段、路径，或位置不同的关键帧。
func cloudAgentPrevisObjectMoves(object map[string]any) bool {
	if len(creationMaps(object["travels"])) > 0 || object["motionPath"] != nil {
		return true
	}
	var first []float64
	for _, frame := range creationMaps(object["keyframes"]) {
		// 只读：不能用 cloudAgentPrevisMapTransform，它会给缺字段的关键帧补默认 transform。
		transform, _ := frame["transform"].(map[string]any)
		position, ok := cloudAgentPrevisNumberVec3(transform["position"])
		if !ok {
			continue
		}
		if first == nil {
			first = position
			continue
		}
		if math.Hypot(position[0]-first[0], position[2]-first[2]) > 0.2 {
			return true
		}
	}
	return false
}

func cloudAgentPrevisReviewShot(scene map[string]any, shot map[string]any) []string {
	duration := numberValue(shot["duration"], 5)
	camera := cloudAgentPrevisFindByID(creationMaps(scene["cameras"]), stringValue(shot["cameraId"]))
	if camera == nil {
		return []string{"镜头没有绑定有效摄影机"}
	}
	notes := make([]string, 0, 6)
	moves := creationMaps(camera["moves"])
	primary := make([]map[string]any, 0, len(moves))
	for _, move := range moves {
		if technique, ok := cloudAgentPrevisFindCameraTechnique(stringValue(move["technique"])); ok && !technique.Layer {
			primary = append(primary, move)
		}
	}
	sort.SliceStable(primary, func(i, j int) bool { return numberValue(primary[i]["start"], 0) < numberValue(primary[j]["start"], 0) })
	cameraPath := camera["motionPath"] != nil || len(creationMaps(camera["keyframes"])) >= 2

	switch {
	case len(moves) == 0 && !cameraPath && duration >= 3:
		notes = append(notes, fmt.Sprintf("%.1f 秒全程固定机位，没有任何运镜", duration))
	case len(primary) == 1 && !cameraPath && duration >= 4:
		move := primary[0]
		notes = append(notes, fmt.Sprintf("%.1f 秒只有 1 个运动节拍（%s %.1f–%.1fs），起幅到落幅只有一种运动", duration, stringValue(move["technique"]), numberValue(move["start"], 0), numberValue(move["start"], 0)+numberValue(move["duration"], 0)))
	}

	defaults := make([]string, 0, len(primary))
	for _, move := range primary {
		technique := stringValue(move["technique"])
		if technique == "look_at" {
			continue
		}
		if params, ok := move["params"].(map[string]any); !ok || len(params) == 0 {
			defaults = append(defaults, technique)
		}
	}
	if len(defaults) > 0 {
		notes = append(notes, fmt.Sprintf("%d 段运镜没写参数，全靠默认值（%s）", len(defaults), strings.Join(defaults, "、")))
	}

	// 跟拍换方位或景别：后一段没有 blend 时机位在 0.6 秒内甩过去，看起来像跳切。
	// 交接空档：前一段跟拍已经结束（机位停在原地），后一段还没过渡完，人物却在继续走，机位会落在人物身后很远。
	objects := creationMaps(scene["objects"])
	var previous map[string]any
	for _, move := range primary {
		if stringValue(move["technique"]) != "follow" {
			continue
		}
		start := numberValue(move["start"], 0)
		if previous != nil && stringValue(previous["subjectId"]) == stringValue(move["subjectId"]) && start > 0.05 {
			before, _ := previous["params"].(map[string]any)
			after, _ := move["params"].(map[string]any)
			changed := stringValue(before["side"]) != stringValue(after["side"]) || stringValue(before["shotSize"]) != stringValue(after["shotSize"])
			blend, blended := after["blend"]
			if changed && !blended {
				notes = append(notes, fmt.Sprintf("%.1fs 起的跟拍换了方位或景别但没设 blend，机位会在 0.6 秒内甩过去；绕到另一侧一般给 1.5–3 秒", start))
			}
			settle := start + math.Min(0.6, math.Max(0.15, numberValue(move["duration"], 0)/3))
			if blended {
				settle = start + numberValue(blend, 0)
			}
			ended := numberValue(previous["start"], 0) + numberValue(previous["duration"], 0)
			if subject := cloudAgentPrevisFindByID(objects, stringValue(move["subjectId"])); subject != nil && ended < settle-0.05 {
				a, b := cloudAgentPrevisActorPositionAt(subject, ended), cloudAgentPrevisActorPositionAt(subject, settle)
				if math.Hypot(b[0]-a[0], b[2]-a[2]) > 0.3 {
					notes = append(notes, fmt.Sprintf("前一段跟拍在 %.1fs 结束，%.1fs 起的跟拍要到 %.1fs 才过渡完，中间机位停在原地、人物继续走远；把前一段延长到 %.1fs 以后", ended, start, settle, settle))
				}
			}
		}
		previous = move
	}

	// 正反打时另一台摄影机跟着某人也算有镜头照顾到他，所以按整个场景统计。
	tracked := cloudAgentPrevisTrackedSubjects(scene)
	// 有镜头跟着某个移动的人物时，其他移动的人（追兵、路人）算作背景，不提示。
	untracked := make([]string, 0, 3)
	still := make([]string, 0, 3)
	followsMover := false
	for _, object := range objects {
		if !cloudAgentPrevisIsActorMap(object) || !boolValue(object["visible"], true) {
			continue
		}
		name := truncateRunes(stringValue(object["name"]), 24)
		moving := cloudAgentPrevisObjectMoves(object)
		if moving && tracked[stringValue(object["id"])] {
			followsMover = true
		}
		if moving && !tracked[stringValue(object["id"])] {
			untracked = append(untracked, "《"+name+"》")
		}
		if !moving && len(creationMaps(object["motions"])) == 0 && duration >= 3 {
			still = append(still, "《"+name+"》")
		}
	}
	if len(untracked) > 0 && !followsMover && !cameraPath {
		notes = append(notes, fmt.Sprintf("人物%s在移动，但镜头没有跟拍、跟摇或环绕它，可能走出画面", cloudAgentPrevisReviewNames(untracked)))
	}
	if len(still) > 0 {
		notes = append(notes, fmt.Sprintf("人物%s全程没有动作或走位", cloudAgentPrevisReviewNames(still)))
	}
	return notes
}

// cloudAgentPrevisTrackedSubjects 收集所有镜头摄影机运镜里的 subjectId（跟拍、跟摇、环绕、希区柯克变焦的主体）。
func cloudAgentPrevisTrackedSubjects(scene map[string]any) map[string]bool {
	cameras := creationMaps(scene["cameras"])
	tracked := map[string]bool{}
	for _, shot := range creationMaps(scene["shots"]) {
		camera := cloudAgentPrevisFindByID(cameras, stringValue(shot["cameraId"]))
		if camera == nil {
			continue
		}
		for _, move := range creationMaps(camera["moves"]) {
			if subjectID := stringValue(move["subjectId"]); subjectID != "" {
				tracked[subjectID] = true
			}
		}
	}
	return tracked
}

func cloudAgentPrevisReviewNames(names []string) string {
	if len(names) > 3 {
		return strings.Join(names[:3], "") + fmt.Sprintf("等 %d 人", len(names))
	}
	return strings.Join(names, "")
}

// cloudAgentPrevisShotReviews 返回有问题的镜头及其检查结果；全部通过时返回 nil。
func cloudAgentPrevisShotReviews(scene map[string]any) []map[string]any {
	var reviews []map[string]any
	for index, shot := range creationMaps(scene["shots"]) {
		if index >= cloudAgentPrevisReviewMaxShots {
			break
		}
		notes := cloudAgentPrevisReviewShot(scene, shot)
		if len(notes) == 0 {
			continue
		}
		reviews = append(reviews, map[string]any{
			"shotId":   stringValue(shot["id"]),
			"shotName": truncateRunes(stringValue(shot["name"]), 80),
			"duration": numberValue(shot["duration"], 5),
			"notes":    notes,
		})
	}
	return reviews
}
