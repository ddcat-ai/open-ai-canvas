package app

import (
	"encoding/json"
	"fmt"
	"math"
	"strconv"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"

	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/repository"
)

const (
	cloudAgentPrevisMaxOperations = 32
	cloudAgentPrevisMaxScenes     = 32
	cloudAgentPrevisMaxShots      = 64
	cloudAgentPrevisMaxObjects    = 128
	cloudAgentPrevisMaxCameras    = 32
	cloudAgentPrevisMaxLights     = 64
	cloudAgentPrevisDocumentLimit = 1 << 20
	cloudAgentPrevisTextLimit     = 160
)

type cloudAgentPrevisSceneCreateArgs struct {
	CanvasSnapshotHash string `json:"canvasSnapshotHash"`
	SceneID            string `json:"sceneId"`
	Title              string `json:"title"`
	TemplateID         string `json:"templateId"`
}

type cloudAgentPrevisApplyPatchArgs struct {
	SnapshotHash string                           `json:"snapshotHash"`
	SceneID      string                           `json:"sceneId"`
	Operations   []cloudAgentPrevisPatchOperation `json:"operations"`
}

// cloudAgentPrevisPatchOperation is deliberately a closed semantic contract.
// It has no generic path, metadata, URL, storage key or raw scene field.
type cloudAgentPrevisPatchOperation struct {
	Type      string  `json:"type"`
	ID        string  `json:"id"`
	Name      *string `json:"name"`
	Title     *string `json:"title"`
	Kind      string  `json:"kind"`
	Primitive string  `json:"primitive"`
	Archetype string  `json:"archetype"` // adult/child/elderly/man/woman/monster
	Color     *string `json:"color"`
	ParentID  *string `json:"parentId"`
	Visible   *bool   `json:"visible"`
	Pose      string  `json:"pose"`

	CharacterAssetID   *string `json:"characterAssetId"`
	CharacterVersionID *string `json:"characterVersionId"`
	ReferenceNodeID    *string `json:"referenceNodeId"`
	CharacterName      *string `json:"characterName"`

	Position *[]float64 `json:"position"`
	Rotation *[]float64 `json:"rotation"`
	Scale    *[]float64 `json:"scale"`
	Target   *[]float64 `json:"target"`

	KeyframeID   *string     `json:"keyframeId"`
	Time         *float64    `json:"time"`
	Easing       string      `json:"easing"`
	PathPoints   [][]float64 `json:"pathPoints"`
	PathSpeed    string      `json:"pathSpeed"`
	StartDelay   *float64    `json:"startDelay"`
	OrientToPath *bool       `json:"orientToPath"`

	CameraID    *string  `json:"cameraId"`
	Duration    *float64 `json:"duration"`
	FPS         *int     `json:"fps"`
	ShotSize    string   `json:"shotSize"`
	CameraMove  string   `json:"cameraMove"`
	Prompt      *string  `json:"prompt"`
	FocalLength *float64 `json:"focalLength"`

	LightType  *string  `json:"lightType"`
	Intensity  *float64 `json:"intensity"`
	Angle      *float64 `json:"angle"`
	Penumbra   *float64 `json:"penumbra"`
	CastShadow *bool    `json:"castShadow"`

	Background           *string  `json:"background"`
	EnvironmentIntensity *float64 `json:"environmentIntensity"`
	GridVisible          *bool    `json:"gridVisible"`
	ActiveShotID         *string  `json:"activeShotId"`
}

type cloudAgentPrevisMutationPlan struct {
	Canvas             *model.CanvasProject
	Document           map[string]any
	BeforeJSON         string
	BeforeSnapshotHash string
	AfterSnapshotHash  string
	ResultSnapshotHash string
	Operation          string
	Preview            cloudAgentApprovalPreview
	SceneID            string
}

func cloudAgentPrevisSceneCreateSchema() map[string]any {
	return map[string]any{
		"type": "object",
		"properties": map[string]any{
			"canvasSnapshotHash": map[string]any{"type": "string", "description": "previs_scene_read 场景目录返回的 canvasSnapshotHash；创建前画布必须未变化"},
			"sceneId":            map[string]any{"type": "string", "maxLength": 80, "description": "新的稳定场景 ID"},
			"title":              map[string]any{"type": "string", "maxLength": cloudAgentPrevisTextLimit, "description": "场景标题"},
			"templateId":         map[string]any{"type": "string", "enum": []string{"empty", "monologue", "dialogue", "blocking", "product", "action_chase", "interior", "crowd"}, "description": "模板：empty/monologue/dialogue/blocking/product/action_chase/interior/crowd"},
		},
		"required":             []string{"canvasSnapshotHash", "sceneId", "title", "templateId"},
		"additionalProperties": false,
	}
}

func cloudAgentPrevisPatchOperationSchema() map[string]any {
	vec3 := map[string]any{"type": "array", "minItems": 3, "maxItems": 3, "items": map[string]any{"type": "number"}}
	properties := map[string]any{
		"type":               map[string]any{"type": "string", "enum": []string{"scene_update", "shot_add", "shot_update", "shot_remove", "object_add", "object_update", "object_remove", "object_keyframe_upsert", "object_keyframe_remove", "object_motion_path_set", "object_motion_path_clear", "camera_add", "camera_update", "camera_remove", "camera_keyframe_upsert", "camera_keyframe_remove", "light_add", "light_update", "light_remove"}},
		"id":                 map[string]any{"type": "string", "maxLength": 80, "description": "目标或新建资源 ID"},
		"name":               map[string]any{"type": "string", "maxLength": cloudAgentPrevisTextLimit},
		"title":              map[string]any{"type": "string", "maxLength": cloudAgentPrevisTextLimit},
		"kind":               map[string]any{"type": "string", "enum": []string{"primitive", "actor"}},
		"primitive":          map[string]any{"type": "string", "enum": []string{"box", "sphere", "cylinder", "plane", "character"}},
		"archetype":          map[string]any{"type": "string", "enum": []string{"adult", "child", "elderly", "man", "woman", "monster"}, "description": "演员体型原型"},
		"characterAssetId":   map[string]any{"type": "string", "maxLength": 120},
		"characterVersionId": map[string]any{"type": "string", "maxLength": 120},
		"referenceNodeId":    map[string]any{"type": "string", "maxLength": 120},
		"characterName":      map[string]any{"type": "string", "maxLength": cloudAgentPrevisTextLimit},
		"pose":               map[string]any{"type": "string", "enum": []string{"stand", "sit", "walk", "run", "wave", "think", "fight", "kick", "throw", "push", "reach", "arms_crossed", "phone", "bow", "kneel_single", "kneel_double", "lean", "squat", "hands_hips", "neutral", "t_pose"}, "description": "演员姿态"},
		"color":              map[string]any{"type": "string", "maxLength": 9, "pattern": `^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$`, "description": "十六进制颜色"},
		"parentId":           map[string]any{"type": "string", "maxLength": 80},
		"visible":            map[string]any{"type": "boolean"},

		"position":             vec3,
		"rotation":             vec3,
		"scale":                vec3,
		"target":               vec3,
		"keyframeId":           map[string]any{"type": "string", "maxLength": 120},
		"time":                 map[string]any{"type": "number", "minimum": 0, "maximum": 60},
		"easing":               map[string]any{"type": "string", "enum": []string{"step", "linear", "smooth"}},
		"pathPoints":           map[string]any{"type": "array", "minItems": 2, "maxItems": 64, "items": vec3},
		"pathSpeed":            map[string]any{"type": "string", "enum": []string{"slow", "walk", "run"}},
		"startDelay":           map[string]any{"type": "number", "minimum": 0, "maximum": 60},
		"orientToPath":         map[string]any{"type": "boolean"},
		"cameraId":             map[string]any{"type": "string", "maxLength": 80},
		"duration":             map[string]any{"type": "number", "minimum": 0.1, "maximum": 60},
		"fps":                  map[string]any{"type": "integer", "minimum": 1, "maximum": 60},
		"shotSize":             map[string]any{"type": "string", "enum": []string{"extreme_wide", "wide", "full", "medium", "close_up", "extreme_close_up"}},
		"cameraMove":           map[string]any{"type": "string", "enum": []string{"static", "push_in", "pull_out", "pan_left", "pan_right", "tilt_up", "tilt_down", "orbit_left", "orbit_right", "handheld"}},
		"prompt":               map[string]any{"type": "string", "maxLength": 2000},
		"focalLength":          map[string]any{"type": "number", "minimum": 1, "maximum": 300},
		"lightType":            map[string]any{"type": "string", "enum": []string{"directional", "point", "spot", "ambient"}},
		"intensity":            map[string]any{"type": "number", "minimum": 0, "maximum": 100},
		"angle":                map[string]any{"type": "number", "minimum": 0, "maximum": 6.29},
		"penumbra":             map[string]any{"type": "number", "minimum": 0, "maximum": 1},
		"castShadow":           map[string]any{"type": "boolean"},
		"background":           map[string]any{"type": "string", "maxLength": 32},
		"environmentIntensity": map[string]any{"type": "number", "minimum": 0, "maximum": 100},
		"gridVisible":          map[string]any{"type": "boolean"},
		"activeShotId":         map[string]any{"type": "string", "maxLength": 80},
	}
	return map[string]any{"type": "object", "properties": properties, "required": []string{"type", "id"}, "additionalProperties": false}
}

func cloudAgentPrevisApplyPatchSchema() map[string]any {
	return map[string]any{
		"type": "object",
		"properties": map[string]any{
			"snapshotHash": map[string]any{"type": "string", "description": "previs_scene_read 聚焦读取返回的场景 snapshotHash；只代表该场景"},
			"sceneId":      map[string]any{"type": "string", "maxLength": 80, "description": "要修改的场景 ID"},
			"operations":   map[string]any{"type": "array", "minItems": 1, "maxItems": cloudAgentPrevisMaxOperations, "items": cloudAgentPrevisPatchOperationSchema(), "description": "受限语义操作；不能替换整个场景或写任意 JSON"},
		},
		"required":             []string{"snapshotHash", "sceneId", "operations"},
		"additionalProperties": false,
	}
}

func cloudAgentPrevisValidateText(value, label string, maxRunes int, required bool) error {
	if required && strings.TrimSpace(value) == "" {
		return BadAuthRequest(label + "不能为空")
	}
	if !utf8.ValidString(value) || strings.TrimSpace(value) != value {
		return BadAuthRequest(label + "不能包含首尾空白或无效字符")
	}
	if utf8.RuneCountInString(value) > maxRunes {
		return fmt.Errorf("%s不能超过 %d 个字符", label, maxRunes)
	}
	for _, r := range value {
		if unicode.IsControl(r) {
			return BadAuthRequest(label + "不能包含控制字符")
		}
	}
	return nil
}

// cloudAgentPrevisValidatePose validates pose against the canonical enum.
func cloudAgentPrevisValidatePose(pose string) error {
	valid := map[string]bool{
		"stand": true, "sit": true, "walk": true, "run": true, "wave": true, "think": true,
		"fight": true, "kick": true, "throw": true, "push": true, "reach": true, "arms_crossed": true,
		"phone": true, "bow": true, "kneel_single": true, "kneel_double": true, "lean": true,
		"squat": true, "hands_hips": true, "neutral": true, "t_pose": true,
	}
	if !valid[pose] {
		return BadAuthRequest(fmt.Sprintf("pose 值 %q 不受支持；请使用 stand/sit/walk/run/wave/think/fight 等", pose))
	}
	return nil
}

func cloudAgentPrevisValidateEnum(value, label string, allowed ...string) error {
	for _, candidate := range allowed {
		if value == candidate {
			return nil
		}
	}
	return BadAuthRequest(label + "不受支持")
}

func cloudAgentPrevisIsHexColor(value string) bool {
	if len(value) != 4 && len(value) != 7 && len(value) != 9 || value[0] != '#' {
		return false
	}
	for _, r := range value[1:] {
		if !strings.ContainsRune("0123456789abcdefABCDEF", r) {
			return false
		}
	}
	return true
}

func cloudAgentPrevisNormalizeLegacyColor(value string) string {
	trimmed := strings.TrimSpace(value)
	if cloudAgentPrevisIsHexColor(trimmed) {
		return strings.ToLower(trimmed)
	}
	lower := strings.ToLower(trimmed)
	var raw string
	var rgba bool
	switch {
	case strings.HasPrefix(lower, "rgb(") && strings.HasSuffix(lower, ")"):
		raw = trimmed[4 : len(trimmed)-1]
	case strings.HasPrefix(lower, "rgba(") && strings.HasSuffix(lower, ")"):
		raw = trimmed[5 : len(trimmed)-1]
		rgba = true
	default:
		return value
	}
	parts := strings.Split(raw, ",")
	if len(parts) != 3 && len(parts) != 4 {
		return value
	}
	channels := make([]int, 3)
	for index := range channels {
		channel, err := strconv.Atoi(strings.TrimSpace(parts[index]))
		if err != nil || channel < 0 || channel > 255 {
			return value
		}
		channels[index] = channel
	}
	if !rgba && len(parts) == 4 {
		return value
	}
	result := fmt.Sprintf("#%02x%02x%02x", channels[0], channels[1], channels[2])
	if rgba && len(parts) == 4 {
		alpha, err := strconv.ParseFloat(strings.TrimSpace(parts[3]), 64)
		if err != nil {
			return value
		}
		if alpha <= 1 {
			alpha = math.Round(alpha * 255)
		}
		if alpha < 0 || alpha > 255 {
			return value
		}
		result += fmt.Sprintf("%02x", int(alpha))
	}
	return result
}

// Legacy scenes can contain CSS rgb/rgba colors from the browser-era editor.
// Normalize those values before strict validation so a harmless scene read or
// patch is not blocked by historical presentation data.
func cloudAgentPrevisNormalizeSceneColor(value, fallback string) string {
	normalized := cloudAgentPrevisNormalizeLegacyColor(value)
	if cloudAgentPrevisIsHexColor(normalized) {
		return normalized
	}
	if strings.TrimSpace(value) == "" {
		return fallback
	}
	return value
}

func cloudAgentPrevisValidateColor(value, label string) error {
	if err := cloudAgentPrevisValidateText(value, label, 32, true); err != nil {
		return err
	}
	if !cloudAgentPrevisIsHexColor(value) {
		return BadAuthRequest(label + "必须是十六进制颜色")
	}
	return nil
}

func cloudAgentPrevisFiniteInRange(value float64, label string, minimum, maximum float64) error {
	if math.IsNaN(value) || math.IsInf(value, 0) || value < minimum || value > maximum {
		return BadAuthRequest(label + "超出限制")
	}
	return nil
}

func cloudAgentPrevisValidateTemplateID(value string) error {
	valid := map[string]bool{"empty": true, "monologue": true, "dialogue": true, "blocking": true, "product": true, "action_chase": true, "interior": true, "crowd": true}
	if !valid[value] {
		return BadAuthRequest("templateId 不受支持；有效值：empty/monologue/dialogue/blocking/product/action_chase/interior/crowd")
	}
	return nil
}

func cloudAgentPrevisValidateVec3(value []float64, label string) error {
	if len(value) != 3 {
		return BadAuthRequest(label + "必须是包含3个数字的数组")
	}
	for _, number := range value {
		if math.IsNaN(number) || math.IsInf(number, 0) || math.Abs(number) > 100000 {
			return BadAuthRequest(label + "包含无效或超出范围的数字")
		}
	}
	return nil
}

func cloudAgentPrevisVec3(value []float64) []any {
	return []any{value[0], value[1], value[2]}
}

func cloudAgentPrevisNumberVec3(value any) ([]float64, bool) {
	result := make([]float64, 3)
	switch items := value.(type) {
	case []float64:
		if len(items) != 3 {
			return nil, false
		}
		copy(result, items)
	case []any:
		if len(items) != 3 {
			return nil, false
		}
		for index, item := range items {
			result[index] = numberValue(item, math.NaN())
		}
	default:
		return nil, false
	}
	for _, number := range result {
		if math.IsNaN(number) || math.IsInf(number, 0) {
			return nil, false
		}
	}
	return result, true
}

func cloudAgentPrevisOptionalVec3(value *[]float64, label string) error {
	if value == nil {
		return nil
	}
	return cloudAgentPrevisValidateVec3(*value, label)
}

func cloudAgentPrevisTextPointer(value *string, label string, maxRunes int) error {
	if value == nil {
		return nil
	}
	return cloudAgentPrevisValidateText(*value, label, maxRunes, false)
}

func cloudAgentPrevisCanvas(repo *repository.Repository, userID, canvasID string) (*model.CanvasProject, map[string]any, error) {
	canvas, err := repo.CanvasProjectForUser(userID, canvasID)
	if err != nil {
		return nil, nil, err
	}
	doc, err := creationDocument(canvas.PayloadJSON)
	if err != nil {
		return nil, nil, err
	}
	return canvas, doc, nil
}

func cloudAgentPrevisScenesSize(scenes []map[string]any) error {
	encoded, err := json.Marshal(scenes)
	if err != nil || len(encoded) > cloudAgentPrevisDocumentLimit {
		return BadAuthRequest("预演台场景数据超过限制")
	}
	return nil
}

func cloudAgentPrevisIDSet(items []map[string]any, label string) (map[string]map[string]any, error) {
	result := make(map[string]map[string]any, len(items))
	for _, item := range items {
		id := stringValue(item["id"])
		if err := validateCloudAgentID(id, label, 80); err != nil {
			return nil, err
		}
		if _, exists := result[id]; exists {
			return nil, BadAuthRequest(label + "重复")
		}
		result[id] = item
	}
	return result, nil
}

func cloudAgentPrevisFinite(value any) bool {
	number := numberValue(value, math.NaN())
	return !math.IsNaN(number) && !math.IsInf(number, 0)
}

func cloudAgentPrevisValidateTransform(value any, label string) error {
	transform, ok := value.(map[string]any)
	if !ok {
		return BadAuthRequest(label + "缺少 transform")
	}
	for _, key := range []string{"position", "rotation", "scale"} {
		items, ok := transform[key].([]any)
		if !ok || len(items) != 3 {
			return BadAuthRequest(label + "的 transform." + key + " 必须包含3个数字")
		}
		for _, item := range items {
			if !cloudAgentPrevisFinite(item) {
				return BadAuthRequest(label + "的 transform 包含无效数字")
			}
		}
	}
	return nil
}

func cloudAgentPrevisValidateScene(scene map[string]any) error {
	if err := validateCloudAgentID(stringValue(scene["id"]), "导演场景 ID", 80); err != nil {
		return err
	}
	if numberValue(scene["version"], 0) != 1 {
		return BadAuthRequest("预演台场景版本不受支持")
	}
	if err := cloudAgentPrevisValidateText(stringValue(scene["title"]), "场景标题", cloudAgentPrevisTextLimit, true); err != nil {
		return err
	}
	background := cloudAgentPrevisNormalizeSceneColor(stringValue(scene["background"]), "#111827")
	scene["background"] = background
	if err := cloudAgentPrevisValidateColor(stringValue(scene["background"]), "场景背景色"); err != nil {
		return err
	}
	if err := cloudAgentPrevisFiniteInRange(numberValue(scene["environmentIntensity"], math.NaN()), "环境光强度", 0, 100); err != nil {
		return err
	}
	objects := creationMaps(scene["objects"])
	cameras := creationMaps(scene["cameras"])
	lights := creationMaps(scene["lights"])
	shots := creationMaps(scene["shots"])
	if len(objects) > cloudAgentPrevisMaxObjects || len(cameras) > cloudAgentPrevisMaxCameras || len(lights) > cloudAgentPrevisMaxLights || len(shots) > cloudAgentPrevisMaxShots {
		return BadAuthRequest("预演台场景对象、摄影机、灯光或镜头数量超过限制")
	}
	objectByID, err := cloudAgentPrevisIDSet(objects, "导演对象 ID")
	if err != nil {
		return err
	}
	cameraByID, err := cloudAgentPrevisIDSet(cameras, "导演摄影机 ID")
	if err != nil {
		return err
	}
	_, err = cloudAgentPrevisIDSet(lights, "导演灯光 ID")
	if err != nil {
		return err
	}
	shotByID, err := cloudAgentPrevisIDSet(shots, "导演镜头 ID")
	if err != nil {
		return err
	}
	if len(shots) == 0 || stringValue(scene["activeShotId"]) == "" || shotByID[stringValue(scene["activeShotId"])] == nil {
		return BadAuthRequest("预演台场景必须包含有效的 activeShotId")
	}
	for id, object := range objectByID {
		if err := cloudAgentPrevisValidateText(stringValue(object["name"]), "导演对象名称", cloudAgentPrevisTextLimit, true); err != nil {
			return err
		}
		if err := cloudAgentPrevisValidateEnum(stringValue(object["kind"]), "导演对象类型", "primitive", "model", "actor", "billboard"); err != nil {
			return err
		}
		if primitive := stringValue(object["primitive"]); primitive != "" {
			if err := cloudAgentPrevisValidateEnum(primitive, "导演对象 primitive", "box", "sphere", "cylinder", "plane", "character"); err != nil {
				return err
			}
		}
		objectColor := cloudAgentPrevisNormalizeSceneColor(stringValue(object["color"]), "#8795a5")
		object["color"] = objectColor
		if err := cloudAgentPrevisValidateColor(stringValue(object["color"]), "导演对象颜色"); err != nil {
			return err
		}
		if err := cloudAgentPrevisValidateTransform(object["transform"], "导演对象 "+id); err != nil {
			return err
		}
		if binding, ok := object["characterBinding"].(map[string]any); ok {
			for _, key := range []string{"characterAssetId", "characterVersionId", "referenceNodeId"} {
				if err := validateCloudAgentID(stringValue(binding[key]), "角色绑定 "+key, 120); err != nil {
					return err
				}
			}
			if name := stringValue(binding["characterName"]); name != "" {
				if err := cloudAgentPrevisValidateText(name, "角色绑定 characterName", cloudAgentPrevisTextLimit, true); err != nil {
					return err
				}
			}
		}
		if keyframes, ok := object["keyframes"]; ok {
			for _, keyframe := range creationMaps(keyframes) {
				if err := validateCloudAgentID(stringValue(keyframe["id"]), "对象关键帧 ID", 120); err != nil {
					return err
				}
				if err := cloudAgentPrevisFiniteInRange(numberValue(keyframe["time"], math.NaN()), "对象关键帧 time", 0, 60); err != nil {
					return err
				}
				if err := cloudAgentPrevisValidateTransform(keyframe["transform"], "对象关键帧 "+stringValue(keyframe["id"])); err != nil {
					return err
				}
			}
		}
		if motionPath, ok := object["motionPath"].(map[string]any); ok {
			points, pointsOK := motionPath["points"].([]any)
			if !pointsOK || len(points) < 2 || len(points) > 64 {
				return BadAuthRequest("预演台 motionPath 点数无效")
			}
			for index, point := range points {
				value, ok := cloudAgentPrevisNumberVec3(point)
				if !ok {
					return BadAuthRequest(fmt.Sprintf("预演台 motionPath 点 %d 无效", index))
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
		}
		if parentID := stringValue(object["parentId"]); parentID != "" {
			if err := validateCloudAgentID(parentID, "导演对象 parentId", 80); err != nil {
				return err
			}
			if objectByID[parentID] == nil || parentID == id {
				return BadAuthRequest("预演台对象 parentId 无效")
			}
		}
	}
	for id, camera := range cameraByID {
		if err := cloudAgentPrevisValidateText(stringValue(camera["name"]), "导演摄影机名称", cloudAgentPrevisTextLimit, true); err != nil {
			return err
		}
		if err := cloudAgentPrevisFiniteInRange(numberValue(camera["focalLength"], math.NaN()), "摄影机焦段", 1, 300); err != nil {
			return err
		}
		target, targetOK := cloudAgentPrevisNumberVec3(camera["target"])
		if !targetOK {
			return BadAuthRequest("导演摄影机 " + id + " target 必须包含3个数字")
		}
		if err := cloudAgentPrevisValidateVec3(target, "导演摄影机 "+id+" target"); err != nil {
			return err
		}
		if err := cloudAgentPrevisValidateTransform(camera["transform"], "导演摄影机 "+id); err != nil {
			return err
		}
		if keyframes, ok := camera["keyframes"]; ok {
			for _, keyframe := range creationMaps(keyframes) {
				if err := validateCloudAgentID(stringValue(keyframe["id"]), "摄影机关键帧 ID", 120); err != nil {
					return err
				}
				if err := cloudAgentPrevisFiniteInRange(numberValue(keyframe["time"], math.NaN()), "摄影机关键帧 time", 0, 60); err != nil {
					return err
				}
				if err := cloudAgentPrevisValidateTransform(keyframe["transform"], "摄影机关键帧 "+stringValue(keyframe["id"])); err != nil {
					return err
				}
			}
		}
	}
	for id, shot := range shotByID {
		cameraID := stringValue(shot["cameraId"])
		if cameraByID[cameraID] == nil {
			return BadAuthRequest("导演镜头 " + id + " 引用了不存在的摄影机")
		}
		duration := numberValue(shot["duration"], math.NaN())
		fps := numberValue(shot["fps"], math.NaN())
		if err := cloudAgentPrevisFiniteInRange(duration, "导演镜头时长", 0.1, 60); err != nil {
			return err
		}
		if err := cloudAgentPrevisFiniteInRange(fps, "导演镜头帧率", 1, 60); err != nil {
			return err
		}
		if err := cloudAgentPrevisValidateText(stringValue(shot["name"]), "导演镜头名称", cloudAgentPrevisTextLimit, true); err != nil {
			return err
		}
		if err := cloudAgentPrevisValidateEnum(stringValue(shot["shotSize"]), "导演景别", "extreme_wide", "wide", "full", "medium", "close_up", "extreme_close_up"); err != nil {
			return err
		}
		if err := cloudAgentPrevisValidateEnum(stringValue(shot["cameraMove"]), "导演运镜", "static", "push_in", "pull_out", "pan_left", "pan_right", "tilt_up", "tilt_down", "orbit_left", "orbit_right", "handheld"); err != nil {
			return err
		}
		if err := cloudAgentPrevisValidateText(stringValue(shot["prompt"]), "导演镜头提示词", 2000, false); err != nil {
			return err
		}
	}
	for _, light := range creationMaps(scene["lights"]) {
		lightID := stringValue(light["id"])
		if err := cloudAgentPrevisValidateText(stringValue(light["name"]), "导演灯光名称", cloudAgentPrevisTextLimit, true); err != nil {
			return err
		}
		if err := cloudAgentPrevisValidateEnum(stringValue(light["type"]), "导演灯光类型", "directional", "point", "spot", "ambient"); err != nil {
			return err
		}
		lightColor := cloudAgentPrevisNormalizeSceneColor(stringValue(light["color"]), "#ffffff")
		light["color"] = lightColor
		if err := cloudAgentPrevisValidateColor(stringValue(light["color"]), "导演灯光颜色"); err != nil {
			return err
		}
		if err := cloudAgentPrevisFiniteInRange(numberValue(light["intensity"], math.NaN()), "导演灯光强度", 0, 100); err != nil {
			return err
		}
		if angle, ok := light["angle"]; ok {
			if err := cloudAgentPrevisFiniteInRange(numberValue(angle, math.NaN()), "导演灯光 "+lightID+" angle", 0, 6.29); err != nil {
				return err
			}
		}
		if penumbra, ok := light["penumbra"]; ok {
			if err := cloudAgentPrevisFiniteInRange(numberValue(penumbra, math.NaN()), "导演灯光 "+lightID+" penumbra", 0, 1); err != nil {
				return err
			}
		}
		if err := cloudAgentPrevisValidateTransform(light["transform"], "导演灯光 "+lightID); err != nil {
			return err
		}
	}
	// Parent links are a small directed graph. Walk every chain to reject cycles.
	for id := range objectByID {
		seen := map[string]bool{}
		for current := id; current != ""; {
			if seen[current] {
				return BadAuthRequest("预演台对象 parentId 不能形成环")
			}
			seen[current] = true
			current = stringValue(objectByID[current]["parentId"])
			if current != "" && objectByID[current] == nil {
				return BadAuthRequest("预演台对象 parentId 引用不存在对象")
			}
		}
	}
	return nil
}

func cloudAgentPrevisSceneCreateTemplate(args cloudAgentPrevisSceneCreateArgs) (map[string]any, error) {
	if err := validateCloudAgentID(args.SceneID, "导演场景 ID", 80); err != nil {
		return nil, err
	}
	if err := cloudAgentPrevisValidateText(args.Title, "场景标题", cloudAgentPrevisTextLimit, true); err != nil {
		return nil, err
	}
	if err := cloudAgentPrevisValidateTemplateID(args.TemplateID); err != nil {
		return nil, err
	}
	now := time.Now().UTC().Format(time.RFC3339Nano)
	cameraID := args.SceneID + "-camera-1"
	shotID := args.SceneID + "-shot-1"
	camera := map[string]any{
		"id": cameraID, "name": "主摄影机",
		"transform": map[string]any{"position": []any{4.8, 2.7, 6.8}, "rotation": []any{0, 0, 0}, "scale": []any{1, 1, 1}},
		"target":    []any{0, 1, 0}, "focalLength": 35, "fov": 50, "aperture": 2.8, "focusDistance": 5, "near": 0.05, "far": 500, "keyframes": []any{},
	}
	objects := []any{}
	lights := []any{
		map[string]any{"id": args.SceneID + "-light-key", "name": "主光", "type": "directional", "transform": map[string]any{"position": []any{4, 6, 4}, "rotation": []any{0, 0, 0}, "scale": []any{1, 1, 1}}, "color": "#ffffff", "intensity": 2.4, "angle": 0.7853981634, "penumbra": 0.35, "castShadow": true},
		map[string]any{"id": args.SceneID + "-light-fill", "name": "轮廓光", "type": "directional", "transform": map[string]any{"position": []any{-4, 3, -2}, "rotation": []any{0, 0, 0}, "scale": []any{1, 1, 1}}, "color": "#ffffff", "intensity": 1.1, "angle": 0.7853981634, "penumbra": 0.35, "castShadow": true},
		map[string]any{"id": args.SceneID + "-light-ambient", "name": "环境光", "type": "ambient", "transform": map[string]any{"position": []any{0, 0, 0}, "rotation": []any{0, 0, 0}, "scale": []any{1, 1, 1}}, "color": "#ffffff", "intensity": 0.65, "angle": 0.7853981634, "penumbra": 0.35, "castShadow": false},
	}
	if args.TemplateID == "action_chase" {
		// Two actors: pursuer behind, target ahead, side-angle camera for kinetic energy
		objects = append(objects,
			map[string]any{"id": args.SceneID + "-actor-1", "name": "追逐者", "kind": "actor", "primitive": "character", "transform": map[string]any{"position": []any{0, 0, -1.2}, "rotation": []any{0, 0, 0}, "scale": []any{1, 1, 1}}, "color": "#2f7de1", "visible": true, "castShadow": true, "receiveShadow": true, "pose": "run", "archetype": "man", "keyframes": []any{}, "boneTracks": []any{}, "boneOverrides": map[string]any{}, "motionClips": []any{}},
			map[string]any{"id": args.SceneID + "-actor-2", "name": "逃跑者", "kind": "actor", "primitive": "character", "transform": map[string]any{"position": []any{0, 0, 2.0}, "rotation": []any{0, 0, 0}, "scale": []any{1, 1, 1}}, "color": "#d84949", "visible": true, "castShadow": true, "receiveShadow": true, "pose": "run", "archetype": "adult", "keyframes": []any{}, "boneTracks": []any{}, "boneOverrides": map[string]any{}, "motionClips": []any{}},
		)
		camera["transform"] = map[string]any{"position": []any{3.8, 1.4, 0}, "rotation": []any{0, 0, 0}, "scale": []any{1, 1, 1}}
		camera["target"] = []any{0, 1, 0.5}
		camera["focalLength"] = 50
		camera["fov"] = 39.6
	}
	if args.TemplateID == "interior" {
		// Room sketch: floor plane, 3 wall planes, sofa-scale box, table-scale box
		objects = append(objects,
			map[string]any{"id": args.SceneID + "-wall-back", "name": "后墙", "kind": "primitive", "primitive": "plane", "transform": map[string]any{"position": []any{0, 2.0, -3.0}, "rotation": []any{0, 0, 0}, "scale": []any{6, 4, 1}}, "color": "#d8dde3", "visible": true, "castShadow": false, "receiveShadow": true, "keyframes": []any{}},
			map[string]any{"id": args.SceneID + "-wall-left", "name": "左墙", "kind": "primitive", "primitive": "plane", "transform": map[string]any{"position": []any{-3.0, 2.0, 0}, "rotation": []any{0, 1.5708, 0}, "scale": []any{6, 4, 1}}, "color": "#d8dde3", "visible": true, "castShadow": false, "receiveShadow": true, "keyframes": []any{}},
			map[string]any{"id": args.SceneID + "-sofa", "name": "沙发", "kind": "primitive", "primitive": "box", "transform": map[string]any{"position": []any{0, 0.45, -1.8}, "rotation": []any{0, 0, 0}, "scale": []any{2.2, 0.9, 0.9}}, "color": "#8795a5", "visible": true, "castShadow": true, "receiveShadow": true, "keyframes": []any{}},
			map[string]any{"id": args.SceneID + "-table", "name": "茶几", "kind": "primitive", "primitive": "box", "transform": map[string]any{"position": []any{0, 0.23, 0.2}, "rotation": []any{0, 0, 0}, "scale": []any{1.1, 0.46, 0.65}}, "color": "#6b7580", "visible": true, "castShadow": true, "receiveShadow": true, "keyframes": []any{}},
			map[string]any{"id": args.SceneID + "-actor-1", "name": "演员 1", "kind": "actor", "primitive": "character", "transform": map[string]any{"position": []any{-0.6, 0, 0.6}, "rotation": []any{0, -0.4, 0}, "scale": []any{1, 1, 1}}, "color": "#2f7de1", "visible": true, "castShadow": true, "receiveShadow": true, "pose": "sit", "archetype": "adult", "keyframes": []any{}, "boneTracks": []any{}, "boneOverrides": map[string]any{}, "motionClips": []any{}},
		)
		camera["transform"] = map[string]any{"position": []any{3.2, 1.65, 3.0}, "rotation": []any{0, 0, 0}, "scale": []any{1, 1, 1}}
		camera["target"] = []any{-0.2, 1.0, 0}
		camera["focalLength"] = 35
	}
	if args.TemplateID == "crowd" {
		// 3x3 crowd grid with distinct colors
		crowdColors := []string{"#2f7de1", "#d84949", "#dfae3f", "#34a276", "#8b5cf6", "#e879f9", "#2f7de1", "#d84949", "#dfae3f"}
		for row := 0; row < 3; row++ {
			for col := 0; col < 3; col++ {
				idx := row*3 + col
				id := fmt.Sprintf("%s-actor-%d", args.SceneID, idx+1)
				x := float64(col-1) * 1.2
				z := float64(row-1) * 1.2
				objects = append(objects, map[string]any{
					"id": id, "name": fmt.Sprintf("群众 %d", idx+1), "kind": "actor", "primitive": "character",
					"transform": map[string]any{"position": []any{x, 0, z}, "rotation": []any{0, 0, 0}, "scale": []any{1, 1, 1}},
					"color":     crowdColors[idx], "visible": true, "castShadow": true, "receiveShadow": true,
					"pose": "stand", "archetype": "adult", "keyframes": []any{}, "boneTracks": []any{}, "boneOverrides": map[string]any{}, "motionClips": []any{},
				})
			}
		}
		camera["transform"] = map[string]any{"position": []any{0.5, 4.5, 6.5}, "rotation": []any{0, 0, 0}, "scale": []any{1, 1, 1}}
		camera["target"] = []any{0, 0.8, 0}
		camera["focalLength"] = 28
		camera["fov"] = 65.0
	}
	if args.TemplateID == "monologue" || args.TemplateID == "dialogue" || args.TemplateID == "blocking" {
		objects = append(objects, map[string]any{"id": args.SceneID + "-actor-1", "name": "演员 1", "kind": "actor", "primitive": "character", "transform": map[string]any{"position": []any{0, 0, 0}, "rotation": []any{0, 0, 0}, "scale": []any{1, 1, 1}}, "color": "#f1f3f5", "visible": true, "castShadow": true, "receiveShadow": true, "pose": "stand", "keyframes": []any{}, "boneTracks": []any{}, "boneOverrides": map[string]any{}, "motionClips": []any{}})
	}
	if args.TemplateID == "dialogue" || args.TemplateID == "blocking" {
		objects = append(objects, map[string]any{"id": args.SceneID + "-actor-2", "name": "演员 2", "kind": "actor", "primitive": "character", "transform": map[string]any{"position": []any{1.8, 0, -0.8}, "rotation": []any{0, 0.2, 0}, "scale": []any{1, 1, 1}}, "color": "#2f7de1", "visible": true, "castShadow": true, "receiveShadow": true, "pose": "stand", "keyframes": []any{}, "boneTracks": []any{}, "boneOverrides": map[string]any{}, "motionClips": []any{}})
	}
	if args.TemplateID == "product" {
		objects = append(objects, map[string]any{"id": args.SceneID + "-product-1", "name": "产品", "kind": "primitive", "primitive": "box", "transform": map[string]any{"position": []any{0, 0.6, 0}, "rotation": []any{0, 0, 0}, "scale": []any{1.2, 1.2, 1.2}}, "color": "#8795a5", "visible": true, "castShadow": true, "receiveShadow": true, "keyframes": []any{}})
	}
	scene := map[string]any{
		"id": args.SceneID, "version": 1, "title": args.Title, "background": "#d8dde3", "environmentIntensity": 0.7, "gridVisible": true,
		"objects": objects, "cameras": []any{camera}, "lights": lights,
		"shots":        []any{map[string]any{"id": shotID, "name": "镜头 1", "cameraId": cameraID, "duration": 5, "fps": 24, "shotSize": "medium", "cameraMove": "static", "prompt": "", "cuts": []any{}}},
		"activeShotId": shotID, "createdAt": now, "updatedAt": now,
	}
	return scene, cloudAgentPrevisValidateScene(scene)
}

func prepareCloudAgentPrevisSceneCreate(repo *repository.Repository, userID, canvasID string, call cloudAgentCall) (*cloudAgentPrevisMutationPlan, error) {
	var args cloudAgentPrevisSceneCreateArgs
	if err := decodeCloudAgentJSONObject(call.Function.Arguments, &args); err != nil {
		return nil, cloudAgentJSONArgumentError(err)
	}
	if strings.TrimSpace(args.CanvasSnapshotHash) == "" {
		return nil, cloudAgentFieldError("canvasSnapshotHash", "required", "创建预演场景前必须先读取场景目录")
	}
	canvas, doc, err := cloudAgentPrevisCanvas(repo, userID, canvasID)
	if err != nil {
		return nil, err
	}
	beforeHash := cloudAgentCanvasHash(doc)
	if beforeHash != args.CanvasSnapshotHash {
		return nil, &cloudAgentFieldArgumentError{error: &cloudAgentArgumentError{creationConflict("画布已变化，本次未创建场景；请重新读取场景目录")}, Field: "canvasSnapshotHash", Issue: "stale_snapshot"}
	}
	scenes := creationMaps(doc["previsScenes"])
	if len(scenes) >= cloudAgentPrevisMaxScenes {
		return nil, BadAuthRequest("当前画布的预演场景数量已达到限制")
	}
	if _, exists := findPrevisScene(scenes, args.SceneID); exists {
		return nil, BadAuthRequest("预演场景 ID 已存在")
	}
	scene, err := cloudAgentPrevisSceneCreateTemplate(args)
	if err != nil {
		return nil, err
	}
	scenes = append(scenes, scene)
	if err := cloudAgentPrevisScenesSize(scenes); err != nil {
		return nil, err
	}
	doc["previsScenes"] = scenes
	return &cloudAgentPrevisMutationPlan{Canvas: canvas, Document: doc, BeforeJSON: canvas.PayloadJSON, BeforeSnapshotHash: beforeHash, AfterSnapshotHash: cloudAgentCanvasHash(doc), ResultSnapshotHash: creationHash(scene), Operation: "previs_scene_create", SceneID: args.SceneID, Preview: cloudAgentPrevisMutationApprovalPreview("previs_scene_create", args.SceneID, args.Title, []string{"创建受控白模场景", "模板：" + args.TemplateID})}, nil
}

func prepareCloudAgentPrevisApplyPatch(repo *repository.Repository, userID, canvasID string, call cloudAgentCall) (*cloudAgentPrevisMutationPlan, error) {
	var args cloudAgentPrevisApplyPatchArgs
	if err := decodeCloudAgentJSONObject(call.Function.Arguments, &args); err != nil {
		return nil, cloudAgentJSONArgumentError(err)
	}
	if strings.TrimSpace(args.SnapshotHash) == "" {
		return nil, cloudAgentFieldError("snapshotHash", "required", "应用预演补丁前必须先读取指定场景")
	}
	if len(args.Operations) < 1 || len(args.Operations) > cloudAgentPrevisMaxOperations {
		return nil, cloudAgentFieldError("operations", "item_count", fmt.Sprintf("预演补丁 operations 必须包含1到%d项操作", cloudAgentPrevisMaxOperations))
	}
	if err := validateCloudAgentID(args.SceneID, "导演场景 ID", 80); err != nil {
		return nil, err
	}
	canvas, doc, err := cloudAgentPrevisCanvas(repo, userID, canvasID)
	if err != nil {
		return nil, err
	}
	scenes := creationMaps(doc["previsScenes"])
	scene, ok := findPrevisScene(scenes, args.SceneID)
	if !ok {
		return nil, BadAuthRequest("导演场景不存在或不属于当前画布")
	}
	canvasSnapshotHash := cloudAgentCanvasHash(doc)
	sceneSnapshotHash := creationHash(scene)
	if sceneSnapshotHash != args.SnapshotHash {
		return nil, &cloudAgentFieldArgumentError{error: &cloudAgentArgumentError{creationConflict("预演场景已变化，本次未写入；请重新读取并重新申请审批")}, Field: "snapshotHash", Issue: "stale_snapshot"}
	}
	items := make([]cloudAgentApprovalPreviewItem, 0, len(args.Operations))
	for index, operation := range args.Operations {
		if err := cloudAgentPrevisValidateCharacterBindingInCanvas(doc, operation); err != nil {
			return nil, err
		}
		item, err := cloudAgentPrevisApplyPatchOperation(scene, operation, index)
		if err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	scene["updatedAt"] = time.Now().UTC().Format(time.RFC3339Nano)
	if err := cloudAgentPrevisValidateScene(scene); err != nil {
		return nil, err
	}
	if err := cloudAgentPrevisScenesSize(scenes); err != nil {
		return nil, err
	}
	doc["previsScenes"] = scenes
	return &cloudAgentPrevisMutationPlan{Canvas: canvas, Document: doc, BeforeJSON: canvas.PayloadJSON, BeforeSnapshotHash: canvasSnapshotHash, AfterSnapshotHash: cloudAgentCanvasHash(doc), ResultSnapshotHash: creationHash(scene), Operation: "previs_apply_patch", SceneID: args.SceneID, Preview: cloudAgentPrevisMutationApprovalPreview("previs_apply_patch", args.SceneID, stringValue(scene["title"]), itemsToDetails(items))}, nil
}

func itemsToDetails(items []cloudAgentApprovalPreviewItem) []string {
	result := make([]string, 0, len(items))
	for _, item := range items {
		if item.Summary != "" {
			result = append(result, item.Summary)
		}
	}
	return result
}

func cloudAgentPrevisMutationApprovalPreview(operation, sceneID, title string, details []string) cloudAgentApprovalPreview {
	if len(details) > 12 {
		details = details[:12]
	}
	return cloudAgentApprovalPreview{Kind: "previs_mutation", Title: "确认预演台修改", Description: fmt.Sprintf("Agent 准备修改预演场景《%s》。批准后才会写入当前画布。", truncateRunes(title, cloudAgentPrevisTextLimit)), Items: []cloudAgentApprovalPreviewItem{{Operation: operation, NodeID: sceneID, NodeTitle: truncateRunes(title, cloudAgentPrevisTextLimit), Details: details, Summary: fmt.Sprintf("修改预演场景《%s》", truncateRunes(title, cloudAgentPrevisTextLimit))}}}
}

func cloudAgentPrevisMapTransform(item map[string]any) map[string]any {
	if transform, ok := item["transform"].(map[string]any); ok {
		return transform
	}
	transform := map[string]any{"position": []any{0, 0, 0}, "rotation": []any{0, 0, 0}, "scale": []any{1, 1, 1}}
	item["transform"] = transform
	return transform
}

func cloudAgentPrevisApplyTransform(item map[string]any, operation cloudAgentPrevisPatchOperation) error {
	if err := cloudAgentPrevisOptionalVec3(operation.Position, "position"); err != nil {
		return err
	}
	if err := cloudAgentPrevisOptionalVec3(operation.Rotation, "rotation"); err != nil {
		return err
	}
	if err := cloudAgentPrevisOptionalVec3(operation.Scale, "scale"); err != nil {
		return err
	}
	transform := cloudAgentPrevisMapTransform(item)
	if operation.Position != nil {
		transform["position"] = cloudAgentPrevisVec3(*operation.Position)
	}
	if operation.Rotation != nil {
		transform["rotation"] = cloudAgentPrevisVec3(*operation.Rotation)
	}
	if operation.Scale != nil {
		transform["scale"] = cloudAgentPrevisVec3(*operation.Scale)
	}
	return nil
}

func cloudAgentPrevisApplyName(item map[string]any, value *string, label string) error {
	if value == nil {
		return nil
	}
	if err := cloudAgentPrevisValidateText(*value, label, cloudAgentPrevisTextLimit, true); err != nil {
		return err
	}
	item["name"] = *value
	return nil
}

func cloudAgentPrevisApplyCharacterBinding(item map[string]any, operation cloudAgentPrevisPatchOperation) error {
	provided := operation.CharacterAssetID != nil || operation.CharacterVersionID != nil || operation.ReferenceNodeID != nil || operation.CharacterName != nil
	if !provided {
		return nil
	}
	if operation.CharacterAssetID == nil || operation.CharacterVersionID == nil || operation.ReferenceNodeID == nil {
		return BadAuthRequest("角色绑定需要 characterAssetId、characterVersionId 和 referenceNodeId")
	}
	for value, label := range map[*string]string{
		operation.CharacterAssetID:   "characterAssetId",
		operation.CharacterVersionID: "characterVersionId",
		operation.ReferenceNodeID:    "referenceNodeId",
	} {
		if value == nil || strings.TrimSpace(*value) == "" {
			return BadAuthRequest(label + " 不能为空")
		}
		if err := validateCloudAgentID(*value, label, 120); err != nil {
			return err
		}
	}
	binding := map[string]any{
		"characterAssetId":   *operation.CharacterAssetID,
		"characterVersionId": *operation.CharacterVersionID,
		"referenceNodeId":    *operation.ReferenceNodeID,
	}
	if operation.CharacterName != nil {
		if err := cloudAgentPrevisValidateText(*operation.CharacterName, "characterName", cloudAgentPrevisTextLimit, true); err != nil {
			return err
		}
		binding["characterName"] = *operation.CharacterName
	}
	item["characterBinding"] = binding
	item["sourceNodeId"] = *operation.ReferenceNodeID
	return nil
}

func cloudAgentPrevisValidateCharacterBindingInCanvas(doc map[string]any, operation cloudAgentPrevisPatchOperation) error {
	if operation.CharacterAssetID == nil && operation.CharacterVersionID == nil && operation.ReferenceNodeID == nil && operation.CharacterName == nil {
		return nil
	}
	if operation.CharacterAssetID == nil || operation.CharacterVersionID == nil || operation.ReferenceNodeID == nil {
		return BadAuthRequest("角色绑定需要 characterAssetId、characterVersionId 和 referenceNodeId")
	}
	for _, node := range creationMaps(doc["nodes"]) {
		if stringValue(node["id"]) != *operation.ReferenceNodeID {
			continue
		}
		metadata, _ := node["metadata"].(map[string]any)
		if stringValue(metadata["workflowKind"]) != "character" || stringValue(metadata["characterAssetId"]) != *operation.CharacterAssetID || stringValue(metadata["characterVersionId"]) != *operation.CharacterVersionID {
			return BadAuthRequest("referenceNodeId 必须是匹配 characterAssetId 和 characterVersionId 的角色卡节点")
		}
		return nil
	}
	return BadAuthRequest("referenceNodeId 不属于当前画布")
}

func cloudAgentPrevisShotDuration(scene map[string]any) float64 {
	for _, shot := range creationMaps(scene["shots"]) {
		if stringValue(shot["id"]) == stringValue(scene["activeShotId"]) {
			return numberValue(shot["duration"], 5)
		}
	}
	return 5
}

func cloudAgentPrevisKeyframeTransform(item map[string]any, operation cloudAgentPrevisPatchOperation) (map[string]any, error) {
	transform := cloudAgentPrevisMapTransform(item)
	result := map[string]any{}
	for _, key := range []string{"position", "rotation", "scale"} {
		value, ok := cloudAgentPrevisNumberVec3(transform[key])
		if !ok {
			return nil, BadAuthRequest("关键帧目标对象 transform 无效")
		}
		result[key] = cloudAgentPrevisVec3(value)
	}
	for value, key := range map[*[]float64]string{operation.Position: "position", operation.Rotation: "rotation", operation.Scale: "scale"} {
		if value == nil {
			continue
		}
		if err := cloudAgentPrevisValidateVec3(*value, key); err != nil {
			return nil, err
		}
		result[key] = cloudAgentPrevisVec3(*value)
	}
	return result, nil
}

func cloudAgentPrevisValidateEasing(value string) error {
	if value == "" {
		return nil
	}
	return cloudAgentPrevisValidateEnum(value, "关键帧 easing", "step", "linear", "smooth")
}

func cloudAgentPrevisUpsertKeyframe(item map[string]any, operation cloudAgentPrevisPatchOperation, duration float64) error {
	if operation.Time == nil {
		return BadAuthRequest("关键帧操作需要 time")
	}
	if err := cloudAgentPrevisFiniteInRange(*operation.Time, "关键帧 time", 0, duration); err != nil {
		return err
	}
	if err := cloudAgentPrevisValidateEasing(operation.Easing); err != nil {
		return err
	}
	transform, err := cloudAgentPrevisKeyframeTransform(item, operation)
	if err != nil {
		return err
	}
	keyframes := creationMaps(item["keyframes"])
	keyframeID := ""
	if operation.KeyframeID != nil {
		if err := validateCloudAgentID(*operation.KeyframeID, "keyframeId", 120); err != nil {
			return err
		}
		keyframeID = *operation.KeyframeID
	}
	match := -1
	for index, keyframe := range keyframes {
		if (keyframeID != "" && stringValue(keyframe["id"]) == keyframeID) || math.Abs(numberValue(keyframe["time"], math.NaN())-*operation.Time) < 0.001 {
			match = index
			break
		}
	}
	if match < 0 {
		if keyframeID == "" {
			keyframeID = fmt.Sprintf("%s-kf-%d", stringValue(item["id"]), len(keyframes)+1)
		}
		keyframe := map[string]any{"id": keyframeID, "time": *operation.Time, "transform": transform}
		if operation.Easing != "" {
			keyframe["easing"] = operation.Easing
		}
		keyframes = append(keyframes, keyframe)
	} else {
		keyframes[match]["id"] = keyframeIDOrExisting(keyframeID, keyframes[match])
		keyframes[match]["time"] = *operation.Time
		keyframes[match]["transform"] = transform
		if operation.Easing == "" {
			delete(keyframes[match], "easing")
		} else {
			keyframes[match]["easing"] = operation.Easing
		}
	}
	for i := range keyframes {
		for j := i + 1; j < len(keyframes); j++ {
			if numberValue(keyframes[j]["time"], 0) < numberValue(keyframes[i]["time"], 0) {
				keyframes[i], keyframes[j] = keyframes[j], keyframes[i]
			}
		}
	}
	item["keyframes"] = keyframes
	return nil
}

func keyframeIDOrExisting(requested string, existing map[string]any) string {
	if requested != "" {
		return requested
	}
	return stringValue(existing["id"])
}

func cloudAgentPrevisRemoveKeyframe(item map[string]any, operation cloudAgentPrevisPatchOperation) error {
	if operation.KeyframeID == nil || strings.TrimSpace(*operation.KeyframeID) == "" {
		return BadAuthRequest("删除关键帧需要 keyframeId")
	}
	if err := validateCloudAgentID(*operation.KeyframeID, "keyframeId", 120); err != nil {
		return err
	}
	keyframes := creationMaps(item["keyframes"])
	filtered := make([]map[string]any, 0, len(keyframes))
	for _, keyframe := range keyframes {
		if stringValue(keyframe["id"]) != *operation.KeyframeID {
			filtered = append(filtered, keyframe)
		}
	}
	if len(filtered) == len(keyframes) {
		return BadAuthRequest("目标关键帧不存在")
	}
	item["keyframes"] = filtered
	return nil
}

func cloudAgentPrevisSetMotionPath(item map[string]any, operation cloudAgentPrevisPatchOperation, duration float64) error {
	if len(operation.PathPoints) < 2 || len(operation.PathPoints) > 64 {
		return BadAuthRequest("motion path 至少需要2个、最多64个点")
	}
	for index, point := range operation.PathPoints {
		if err := cloudAgentPrevisValidateVec3(point, fmt.Sprintf("pathPoints[%d]", index)); err != nil {
			return err
		}
	}
	speed := operation.PathSpeed
	if speed == "" {
		speed = "walk"
	}
	if err := cloudAgentPrevisValidateEnum(speed, "pathSpeed", "slow", "walk", "run"); err != nil {
		return err
	}
	startDelay := 0.0
	if operation.StartDelay != nil {
		startDelay = *operation.StartDelay
	}
	if err := cloudAgentPrevisFiniteInRange(startDelay, "startDelay", 0, duration); err != nil {
		return err
	}
	orient := false
	if operation.OrientToPath != nil {
		orient = *operation.OrientToPath
	}
	points := make([]any, 0, len(operation.PathPoints))
	for _, point := range operation.PathPoints {
		points = append(points, cloudAgentPrevisVec3(point))
	}
	item["motionPath"] = map[string]any{"points": points, "speed": speed, "startDelay": startDelay, "orientToPath": orient}
	return nil
}

func cloudAgentPrevisApplyObjectPatch(objects *[]map[string]any, operation cloudAgentPrevisPatchOperation, index int) (cloudAgentApprovalPreviewItem, error) {
	items := *objects
	byID, err := cloudAgentPrevisIDSet(items, "导演对象 ID")
	if err != nil {
		return cloudAgentApprovalPreviewItem{}, err
	}
	if err := validateCloudAgentID(operation.ID, fmt.Sprintf("operations[%d].id", index), 80); err != nil {
		return cloudAgentApprovalPreviewItem{}, err
	}
	existing := byID[operation.ID]
	summary := ""
	switch operation.Type {
	case "object_add":
		if existing != nil {
			return cloudAgentApprovalPreviewItem{}, BadAuthRequest("新增对象 ID 已存在")
		}
		if operation.Kind != "primitive" && operation.Kind != "actor" {
			return cloudAgentApprovalPreviewItem{}, BadAuthRequest("新增对象 kind 只支持 primitive 或 actor")
		}
		primitive := operation.Primitive
		if primitive == "" {
			primitive = "box"
		}
		if primitive != "box" && primitive != "sphere" && primitive != "cylinder" && primitive != "plane" && primitive != "character" {
			return cloudAgentApprovalPreviewItem{}, BadAuthRequest("新增对象 primitive 不受支持")
		}
		name := "新对象"
		if operation.Name != nil {
			name = *operation.Name
		}
		if err := cloudAgentPrevisValidateText(name, "对象名称", cloudAgentPrevisTextLimit, true); err != nil {
			return cloudAgentApprovalPreviewItem{}, err
		}
		position, rotation, scale := []float64{0, 0.5, 0}, []float64{0, 0, 0}, []float64{1, 1, 1}
		if operation.Position != nil {
			position = *operation.Position
		}
		if operation.Rotation != nil {
			rotation = *operation.Rotation
		}
		if operation.Scale != nil {
			scale = *operation.Scale
		}
		if err := cloudAgentPrevisValidateVec3(position, "position"); err != nil {
			return cloudAgentApprovalPreviewItem{}, err
		}
		if err := cloudAgentPrevisValidateVec3(rotation, "rotation"); err != nil {
			return cloudAgentApprovalPreviewItem{}, err
		}
		if err := cloudAgentPrevisValidateVec3(scale, "scale"); err != nil {
			return cloudAgentApprovalPreviewItem{}, err
		}
		if operation.Color != nil {
			if err := cloudAgentPrevisValidateColor(*operation.Color, "对象颜色"); err != nil {
				return cloudAgentApprovalPreviewItem{}, err
			}
		}
		if operation.Pose != "" {
			if err := cloudAgentPrevisValidatePose(operation.Pose); err != nil {
				return cloudAgentApprovalPreviewItem{}, err
			}
		}
		if operation.ParentID != nil && *operation.ParentID != "" {
			if err := validateCloudAgentID(*operation.ParentID, "对象 parentId", 80); err != nil {
				return cloudAgentApprovalPreviewItem{}, err
			}
		}
		defaultColor := "#8795a5"
		if operation.Kind == "actor" {
			// Assign a distinct colour based on current actor count so each new actor stands out
			actorCount := 0
			for _, obj := range items {
				if stringValue(obj["kind"]) == "actor" {
					actorCount++
				}
			}
			actorColors := []string{"#2f7de1", "#d84949", "#dfae3f", "#34a276", "#8b5cf6", "#e879f9"}
			defaultColor = actorColors[actorCount%len(actorColors)]
		}
		item := map[string]any{"id": operation.ID, "name": name, "kind": operation.Kind, "primitive": primitive, "transform": map[string]any{"position": cloudAgentPrevisVec3(position), "rotation": cloudAgentPrevisVec3(rotation), "scale": cloudAgentPrevisVec3(scale)}, "color": defaultColor, "visible": true, "castShadow": true, "receiveShadow": true, "keyframes": []any{}}
		if operation.Color != nil {
			item["color"] = *operation.Color
		}
		if operation.Visible != nil {
			item["visible"] = *operation.Visible
		}
		if operation.Pose != "" {
			item["pose"] = operation.Pose
		}
		if operation.Kind == "actor" && operation.Pose == "" {
			item["pose"] = "stand"
		}
		if operation.Kind == "actor" {
			item["archetype"] = "adult"
			item["boneTracks"] = []any{}
			item["boneOverrides"] = map[string]any{}
			item["motionClips"] = []any{}
		}
		if operation.Archetype != "" {
			validArchetypes := map[string]bool{"adult": true, "child": true, "elderly": true, "man": true, "woman": true, "monster": true}
			if !validArchetypes[operation.Archetype] {
				return cloudAgentApprovalPreviewItem{}, BadAuthRequest("archetype 值不受支持")
			}
			item["archetype"] = operation.Archetype
		}
		if operation.ParentID != nil && *operation.ParentID != "" {
			item["parentId"] = *operation.ParentID
		}
		if err := cloudAgentPrevisApplyCharacterBinding(item, operation); err != nil {
			return cloudAgentApprovalPreviewItem{}, err
		}
		items = append(items, item)
		summary = fmt.Sprintf("新增对象《%s》", name)
	case "object_update":
		if existing == nil {
			return cloudAgentApprovalPreviewItem{}, BadAuthRequest("要更新的对象不存在")
		}
		if err := cloudAgentPrevisApplyName(existing, operation.Name, "对象名称"); err != nil {
			return cloudAgentApprovalPreviewItem{}, err
		}
		if operation.Color != nil {
			if err := cloudAgentPrevisValidateColor(*operation.Color, "对象颜色"); err != nil {
				return cloudAgentApprovalPreviewItem{}, err
			}
			existing["color"] = *operation.Color
		}
		if operation.Visible != nil {
			existing["visible"] = *operation.Visible
		}
		if operation.Pose != "" {
			if err := cloudAgentPrevisValidatePose(operation.Pose); err != nil {
				return cloudAgentApprovalPreviewItem{}, err
			}
			existing["pose"] = operation.Pose
		}
		if operation.ParentID != nil {
			if *operation.ParentID == "" {
				delete(existing, "parentId")
			} else {
				if err := validateCloudAgentID(*operation.ParentID, "对象 parentId", 80); err != nil {
					return cloudAgentApprovalPreviewItem{}, err
				}
				existing["parentId"] = *operation.ParentID
			}
		}
		if err := cloudAgentPrevisApplyCharacterBinding(existing, operation); err != nil {
			return cloudAgentApprovalPreviewItem{}, err
		}
		if err := cloudAgentPrevisApplyTransform(existing, operation); err != nil {
			return cloudAgentApprovalPreviewItem{}, err
		}
		summary = fmt.Sprintf("修改对象《%s》", stringValue(existing["name"]))
	case "object_remove":
		if existing == nil {
			return cloudAgentApprovalPreviewItem{}, BadAuthRequest("要删除的对象不存在")
		}
		for _, candidate := range items {
			if stringValue(candidate["parentId"]) == operation.ID {
				return cloudAgentApprovalPreviewItem{}, BadAuthRequest("存在子对象时不能删除父对象")
			}
		}
		for i, candidate := range items {
			if stringValue(candidate["id"]) == operation.ID {
				items = append(items[:i], items[i+1:]...)
				break
			}
		}
		summary = fmt.Sprintf("删除对象《%s》", stringValue(existing["name"]))
	default:
		return cloudAgentApprovalPreviewItem{}, nil
	}
	*objects = items
	nodeTitle := stringValue(existing["name"])
	if nodeTitle == "" && operation.Type == "object_add" {
		nodeTitle = "新对象"
		if operation.Name != nil {
			nodeTitle = *operation.Name
		}
	}
	return cloudAgentApprovalPreviewItem{Operation: operation.Type, NodeID: operation.ID, NodeTitle: truncateRunes(nodeTitle, cloudAgentPrevisTextLimit), Summary: summary}, nil
}

func cloudAgentPrevisFindByID(items []map[string]any, id string) map[string]any {
	for _, item := range items {
		if stringValue(item["id"]) == id {
			return item
		}
	}
	return nil
}

func cloudAgentPrevisApplyPatchOperation(scene map[string]any, operation cloudAgentPrevisPatchOperation, index int) (cloudAgentApprovalPreviewItem, error) {
	if err := cloudAgentPrevisValidateText(operation.Type, fmt.Sprintf("operations[%d].type", index), 40, true); err != nil {
		return cloudAgentApprovalPreviewItem{}, err
	}
	if err := validateCloudAgentID(operation.ID, fmt.Sprintf("operations[%d].id", index), 80); err != nil {
		return cloudAgentApprovalPreviewItem{}, err
	}
	if operation.Type == "scene_update" && operation.ID != stringValue(scene["id"]) {
		return cloudAgentApprovalPreviewItem{}, BadAuthRequest("scene_update 的 id 必须是当前场景 ID")
	}
	objects, cameras, lights, shots := creationMaps(scene["objects"]), creationMaps(scene["cameras"]), creationMaps(scene["lights"]), creationMaps(scene["shots"])
	switch operation.Type {
	case "scene_update":
		if operation.Title != nil {
			if err := cloudAgentPrevisValidateText(*operation.Title, "场景标题", cloudAgentPrevisTextLimit, true); err != nil {
				return cloudAgentApprovalPreviewItem{}, err
			}
			scene["title"] = *operation.Title
		}
		if operation.Background != nil {
			if err := cloudAgentPrevisValidateColor(*operation.Background, "场景背景色"); err != nil {
				return cloudAgentApprovalPreviewItem{}, err
			}
			scene["background"] = *operation.Background
		}
		if operation.EnvironmentIntensity != nil {
			if err := cloudAgentPrevisFiniteInRange(*operation.EnvironmentIntensity, "environmentIntensity", 0, 100); err != nil {
				return cloudAgentApprovalPreviewItem{}, err
			}
			scene["environmentIntensity"] = *operation.EnvironmentIntensity
		}
		if operation.GridVisible != nil {
			scene["gridVisible"] = *operation.GridVisible
		}
		if operation.ActiveShotID != nil {
			if *operation.ActiveShotID == "" {
				return cloudAgentApprovalPreviewItem{}, BadAuthRequest("activeShotId 不能为空")
			}
			if err := validateCloudAgentID(*operation.ActiveShotID, "activeShotId", 80); err != nil {
				return cloudAgentApprovalPreviewItem{}, err
			}
			scene["activeShotId"] = *operation.ActiveShotID
		}
		return cloudAgentApprovalPreviewItem{Operation: operation.Type, NodeID: stringValue(scene["id"]), NodeTitle: stringValue(scene["title"]), Summary: "修改场景级设置"}, nil
	case "object_add", "object_update", "object_remove":
		item, err := cloudAgentPrevisApplyObjectPatch(&objects, operation, index)
		if err == nil {
			scene["objects"] = objects
		}
		return item, err
	case "object_keyframe_upsert", "object_keyframe_remove", "object_motion_path_set", "object_motion_path_clear":
		object := cloudAgentPrevisFindByID(objects, operation.ID)
		if object == nil {
			return cloudAgentApprovalPreviewItem{}, BadAuthRequest("目标对象不存在")
		}
		duration := cloudAgentPrevisShotDuration(scene)
		var err error
		switch operation.Type {
		case "object_keyframe_upsert":
			err = cloudAgentPrevisUpsertKeyframe(object, operation, duration)
		case "object_keyframe_remove":
			err = cloudAgentPrevisRemoveKeyframe(object, operation)
		case "object_motion_path_set":
			err = cloudAgentPrevisSetMotionPath(object, operation, duration)
		case "object_motion_path_clear":
			delete(object, "motionPath")
		}
		if err != nil {
			return cloudAgentApprovalPreviewItem{}, err
		}
		scene["objects"] = objects
		return cloudAgentApprovalPreviewItem{Operation: operation.Type, NodeID: operation.ID, NodeTitle: stringValue(object["name"]), Summary: fmt.Sprintf("修改对象《%s》的动画", stringValue(object["name"]))}, nil
	case "shot_add":
		if cloudAgentPrevisFindByID(shots, operation.ID) != nil {
			return cloudAgentApprovalPreviewItem{}, BadAuthRequest("新增镜头 ID 已存在")
		}
		cameraID := ""
		if operation.CameraID != nil {
			if err := validateCloudAgentID(*operation.CameraID, "摄影机 ID", 80); err != nil {
				return cloudAgentApprovalPreviewItem{}, err
			}
			cameraID = *operation.CameraID
		} else if len(cameras) > 0 {
			cameraID = stringValue(cameras[0]["id"])
		}
		if cloudAgentPrevisFindByID(cameras, cameraID) == nil {
			return cloudAgentApprovalPreviewItem{}, BadAuthRequest("新增镜头必须引用现有摄影机")
		}
		name := "新镜头"
		if operation.Name != nil {
			name = *operation.Name
		}
		if err := cloudAgentPrevisValidateText(name, "镜头名称", cloudAgentPrevisTextLimit, true); err != nil {
			return cloudAgentApprovalPreviewItem{}, err
		}
		duration, fps := 5.0, 24
		if operation.Duration != nil {
			duration = *operation.Duration
		}
		if operation.FPS != nil {
			fps = *operation.FPS
		}
		if err := cloudAgentPrevisFiniteInRange(duration, "镜头时长", 0.1, 60); err != nil {
			return cloudAgentApprovalPreviewItem{}, err
		}
		if fps < 1 || fps > 60 {
			return cloudAgentApprovalPreviewItem{}, BadAuthRequest("镜头帧率超出限制")
		}
		shotSize, cameraMove := operation.ShotSize, operation.CameraMove
		if shotSize == "" {
			shotSize = "medium"
		}
		if cameraMove == "" {
			cameraMove = "static"
		}
		if err := cloudAgentPrevisValidateEnum(shotSize, "镜头景别", "extreme_wide", "wide", "full", "medium", "close_up", "extreme_close_up"); err != nil {
			return cloudAgentApprovalPreviewItem{}, err
		}
		if err := cloudAgentPrevisValidateEnum(cameraMove, "镜头运镜", "static", "push_in", "pull_out", "pan_left", "pan_right", "tilt_up", "tilt_down", "orbit_left", "orbit_right", "handheld"); err != nil {
			return cloudAgentApprovalPreviewItem{}, err
		}
		shot := map[string]any{"id": operation.ID, "name": name, "cameraId": cameraID, "duration": duration, "fps": fps, "shotSize": shotSize, "cameraMove": cameraMove, "prompt": "", "cuts": []any{}}
		if operation.Prompt != nil {
			if err := cloudAgentPrevisValidateText(*operation.Prompt, "镜头提示词", 2000, false); err != nil {
				return cloudAgentApprovalPreviewItem{}, err
			}
			shot["prompt"] = *operation.Prompt
		}
		scene["shots"] = append(shots, shot)
		if stringValue(scene["activeShotId"]) == "" {
			scene["activeShotId"] = operation.ID
		}
		return cloudAgentApprovalPreviewItem{Operation: operation.Type, NodeID: operation.ID, NodeTitle: name, Summary: fmt.Sprintf("新增镜头《%s》", name)}, nil
	case "shot_update", "shot_remove":
		shot := cloudAgentPrevisFindByID(shots, operation.ID)
		if shot == nil {
			return cloudAgentApprovalPreviewItem{}, BadAuthRequest("目标镜头不存在")
		}
		if operation.Type == "shot_remove" {
			if len(shots) <= 1 {
				return cloudAgentApprovalPreviewItem{}, BadAuthRequest("预演场景至少保留一个镜头")
			}
			next := make([]map[string]any, 0, len(shots)-1)
			for _, item := range shots {
				if stringValue(item["id"]) != operation.ID {
					next = append(next, item)
				}
			}
			scene["shots"] = next
			if stringValue(scene["activeShotId"]) == operation.ID {
				scene["activeShotId"] = stringValue(next[0]["id"])
			}
			return cloudAgentApprovalPreviewItem{Operation: operation.Type, NodeID: operation.ID, NodeTitle: stringValue(shot["name"]), Summary: fmt.Sprintf("删除镜头《%s》", stringValue(shot["name"]))}, nil
		}
		if err := cloudAgentPrevisApplyName(shot, operation.Name, "镜头名称"); err != nil {
			return cloudAgentApprovalPreviewItem{}, err
		}
		if operation.CameraID != nil {
			if err := validateCloudAgentID(*operation.CameraID, "摄影机 ID", 80); err != nil {
				return cloudAgentApprovalPreviewItem{}, err
			}
			if cloudAgentPrevisFindByID(cameras, *operation.CameraID) == nil {
				return cloudAgentApprovalPreviewItem{}, BadAuthRequest("镜头引用的摄影机不存在")
			}
			shot["cameraId"] = *operation.CameraID
		}
		if operation.Duration != nil {
			if err := cloudAgentPrevisFiniteInRange(*operation.Duration, "镜头时长", 0.1, 60); err != nil {
				return cloudAgentApprovalPreviewItem{}, err
			}
			shot["duration"] = *operation.Duration
		}
		if operation.FPS != nil {
			if *operation.FPS < 1 || *operation.FPS > 60 {
				return cloudAgentApprovalPreviewItem{}, BadAuthRequest("镜头帧率超出限制")
			}
			shot["fps"] = *operation.FPS
		}
		if operation.ShotSize != "" {
			if err := cloudAgentPrevisValidateEnum(operation.ShotSize, "镜头景别", "extreme_wide", "wide", "full", "medium", "close_up", "extreme_close_up"); err != nil {
				return cloudAgentApprovalPreviewItem{}, err
			}
			shot["shotSize"] = operation.ShotSize
		}
		if operation.CameraMove != "" {
			if err := cloudAgentPrevisValidateEnum(operation.CameraMove, "镜头运镜", "static", "push_in", "pull_out", "pan_left", "pan_right", "tilt_up", "tilt_down", "orbit_left", "orbit_right", "handheld"); err != nil {
				return cloudAgentApprovalPreviewItem{}, err
			}
			shot["cameraMove"] = operation.CameraMove
		}
		if operation.Prompt != nil {
			if err := cloudAgentPrevisValidateText(*operation.Prompt, "镜头提示词", 2000, false); err != nil {
				return cloudAgentApprovalPreviewItem{}, err
			}
			shot["prompt"] = *operation.Prompt
		}
		return cloudAgentApprovalPreviewItem{Operation: operation.Type, NodeID: operation.ID, NodeTitle: stringValue(shot["name"]), Summary: fmt.Sprintf("修改镜头《%s》", stringValue(shot["name"]))}, nil
	case "camera_keyframe_upsert", "camera_keyframe_remove":
		camera := cloudAgentPrevisFindByID(cameras, operation.ID)
		if camera == nil {
			return cloudAgentApprovalPreviewItem{}, BadAuthRequest("目标摄影机不存在")
		}
		duration := cloudAgentPrevisShotDuration(scene)
		var err error
		if operation.Type == "camera_keyframe_upsert" {
			err = cloudAgentPrevisUpsertKeyframe(camera, operation, duration)
		} else {
			err = cloudAgentPrevisRemoveKeyframe(camera, operation)
		}
		if err != nil {
			return cloudAgentApprovalPreviewItem{}, err
		}
		return cloudAgentApprovalPreviewItem{Operation: operation.Type, NodeID: operation.ID, NodeTitle: stringValue(camera["name"]), Summary: fmt.Sprintf("修改摄影机《%s》的动画", stringValue(camera["name"]))}, nil
	case "camera_add":
		if cloudAgentPrevisFindByID(cameras, operation.ID) != nil {
			return cloudAgentApprovalPreviewItem{}, BadAuthRequest("新增摄影机 ID 已存在")
		}
		name := "摄影机"
		if operation.Name != nil {
			name = *operation.Name
		}
		if err := cloudAgentPrevisValidateText(name, "摄影机名称", cloudAgentPrevisTextLimit, true); err != nil {
			return cloudAgentApprovalPreviewItem{}, err
		}
		camPos := []float64{4.8, 2.7, 6.8}
		camRot := []float64{0, 0, 0}
		camScale := []float64{1, 1, 1}
		camTarget := []float64{0, 1, 0}
		if operation.Position != nil {
			camPos = *operation.Position
		}
		if operation.Rotation != nil {
			camRot = *operation.Rotation
		}
		if operation.Scale != nil {
			camScale = *operation.Scale
		}
		if operation.Target != nil {
			camTarget = *operation.Target
		}
		if err := cloudAgentPrevisValidateVec3(camPos, "摄影机 position"); err != nil {
			return cloudAgentApprovalPreviewItem{}, err
		}
		if err := cloudAgentPrevisValidateVec3(camTarget, "摄影机 target"); err != nil {
			return cloudAgentApprovalPreviewItem{}, err
		}
		focalLength := 35.0
		if operation.FocalLength != nil {
			focalLength = *operation.FocalLength
		}
		if err := cloudAgentPrevisFiniteInRange(focalLength, "摄影机焦段", 1, 300); err != nil {
			return cloudAgentApprovalPreviewItem{}, err
		}
		fov := 2 * math.Atan(36.0/(2*math.Max(1, focalLength))) * 180 / math.Pi
		newCamera := map[string]any{
			"id": operation.ID, "name": name,
			"transform": map[string]any{"position": cloudAgentPrevisVec3(camPos), "rotation": cloudAgentPrevisVec3(camRot), "scale": cloudAgentPrevisVec3(camScale)},
			"target":    cloudAgentPrevisVec3(camTarget), "focalLength": focalLength, "fov": fov,
			"aperture": 2.8, "focusDistance": 5.0, "near": 0.05, "far": 500.0, "keyframes": []any{},
		}
		scene["cameras"] = append(cameras, newCamera)
		return cloudAgentApprovalPreviewItem{Operation: operation.Type, NodeID: operation.ID, NodeTitle: name, Summary: fmt.Sprintf("新增摄影机《%s》", name)}, nil
	case "camera_update", "camera_remove":
		camera := cloudAgentPrevisFindByID(cameras, operation.ID)
		if camera == nil {
			return cloudAgentApprovalPreviewItem{}, BadAuthRequest("目标摄影机不存在")
		}
		if operation.Type == "camera_remove" {
			if len(cameras) <= 1 {
				return cloudAgentApprovalPreviewItem{}, BadAuthRequest("预演场景至少保留一台摄影机")
			}
			for _, shot := range shots {
				if stringValue(shot["cameraId"]) == operation.ID {
					return cloudAgentApprovalPreviewItem{}, BadAuthRequest("摄影机仍被镜头引用，不能删除")
				}
			}
			next := make([]map[string]any, 0, len(cameras)-1)
			for _, item := range cameras {
				if stringValue(item["id"]) != operation.ID {
					next = append(next, item)
				}
			}
			scene["cameras"] = next
			return cloudAgentApprovalPreviewItem{Operation: operation.Type, NodeID: operation.ID, NodeTitle: stringValue(camera["name"]), Summary: fmt.Sprintf("删除摄影机《%s》", stringValue(camera["name"]))}, nil
		}
		if err := cloudAgentPrevisApplyName(camera, operation.Name, "摄影机名称"); err != nil {
			return cloudAgentApprovalPreviewItem{}, err
		}
		if operation.FocalLength != nil {
			if err := cloudAgentPrevisFiniteInRange(*operation.FocalLength, "摄影机焦段", 1, 300); err != nil {
				return cloudAgentApprovalPreviewItem{}, err
			}
			camera["focalLength"] = *operation.FocalLength
		}
		if operation.Target != nil {
			if err := cloudAgentPrevisValidateVec3(*operation.Target, "target"); err != nil {
				return cloudAgentApprovalPreviewItem{}, err
			}
			camera["target"] = cloudAgentPrevisVec3(*operation.Target)
		}
		if err := cloudAgentPrevisApplyTransform(camera, operation); err != nil {
			return cloudAgentApprovalPreviewItem{}, err
		}
		return cloudAgentApprovalPreviewItem{Operation: operation.Type, NodeID: operation.ID, NodeTitle: stringValue(camera["name"]), Summary: fmt.Sprintf("修改摄影机《%s》", stringValue(camera["name"]))}, nil
	case "light_add", "light_update", "light_remove":
		if operation.Type == "light_add" {
			if cloudAgentPrevisFindByID(lights, operation.ID) != nil {
				return cloudAgentApprovalPreviewItem{}, BadAuthRequest("新增灯光 ID 已存在")
			}
			name := "新灯光"
			if operation.Name != nil {
				name = *operation.Name
			}
			if err := cloudAgentPrevisValidateText(name, "灯光名称", cloudAgentPrevisTextLimit, true); err != nil {
				return cloudAgentApprovalPreviewItem{}, err
			}
			lightType := "point"
			if operation.LightType != nil {
				lightType = *operation.LightType
			}
			if err := cloudAgentPrevisValidateEnum(lightType, "灯光类型", "directional", "point", "spot", "ambient"); err != nil {
				return cloudAgentApprovalPreviewItem{}, err
			}
			position, rotation, scale := []float64{0, 3, 0}, []float64{0, 0, 0}, []float64{1, 1, 1}
			if operation.Position != nil {
				position = *operation.Position
			}
			if operation.Rotation != nil {
				rotation = *operation.Rotation
			}
			if operation.Scale != nil {
				scale = *operation.Scale
			}
			if err := cloudAgentPrevisValidateVec3(position, "position"); err != nil {
				return cloudAgentApprovalPreviewItem{}, err
			}
			if err := cloudAgentPrevisValidateVec3(rotation, "rotation"); err != nil {
				return cloudAgentApprovalPreviewItem{}, err
			}
			if err := cloudAgentPrevisValidateVec3(scale, "scale"); err != nil {
				return cloudAgentApprovalPreviewItem{}, err
			}
			intensity := 1.0
			if operation.Intensity != nil {
				intensity = *operation.Intensity
			}
			if err := cloudAgentPrevisFiniteInRange(intensity, "灯光强度", 0, 100); err != nil {
				return cloudAgentApprovalPreviewItem{}, err
			}
			angle, penumbra := math.Pi/4, 0.35
			if operation.Angle != nil {
				angle = *operation.Angle
			}
			if operation.Penumbra != nil {
				penumbra = *operation.Penumbra
			}
			if err := cloudAgentPrevisFiniteInRange(angle, "灯光角度", 0, 6.29); err != nil {
				return cloudAgentApprovalPreviewItem{}, err
			}
			if err := cloudAgentPrevisFiniteInRange(penumbra, "灯光 penumbra", 0, 1); err != nil {
				return cloudAgentApprovalPreviewItem{}, err
			}
			color := "#ffffff"
			if operation.Color != nil {
				if err := cloudAgentPrevisValidateColor(*operation.Color, "灯光颜色"); err != nil {
					return cloudAgentApprovalPreviewItem{}, err
				}
				color = *operation.Color
			}
			castShadow := lightType != "ambient"
			if operation.CastShadow != nil {
				castShadow = *operation.CastShadow
			}
			light := map[string]any{"id": operation.ID, "name": name, "type": lightType, "transform": map[string]any{"position": cloudAgentPrevisVec3(position), "rotation": cloudAgentPrevisVec3(rotation), "scale": cloudAgentPrevisVec3(scale)}, "color": color, "intensity": intensity, "angle": angle, "penumbra": penumbra, "castShadow": castShadow}
			scene["lights"] = append(lights, light)
			return cloudAgentApprovalPreviewItem{Operation: operation.Type, NodeID: operation.ID, NodeTitle: name, Summary: fmt.Sprintf("新增灯光《%s》", name)}, nil
		}
		light := cloudAgentPrevisFindByID(lights, operation.ID)
		if light == nil {
			return cloudAgentApprovalPreviewItem{}, BadAuthRequest("目标灯光不存在")
		}
		if operation.Type == "light_remove" {
			next := make([]map[string]any, 0, len(lights)-1)
			for _, item := range lights {
				if stringValue(item["id"]) != operation.ID {
					next = append(next, item)
				}
			}
			scene["lights"] = next
			return cloudAgentApprovalPreviewItem{Operation: operation.Type, NodeID: operation.ID, NodeTitle: stringValue(light["name"]), Summary: fmt.Sprintf("删除灯光《%s》", stringValue(light["name"]))}, nil
		}
		if err := cloudAgentPrevisApplyName(light, operation.Name, "灯光名称"); err != nil {
			return cloudAgentApprovalPreviewItem{}, err
		}
		if operation.LightType != nil {
			if err := cloudAgentPrevisValidateEnum(*operation.LightType, "灯光类型", "directional", "point", "spot", "ambient"); err != nil {
				return cloudAgentApprovalPreviewItem{}, err
			}
			light["type"] = *operation.LightType
		}
		if operation.Intensity != nil {
			if err := cloudAgentPrevisFiniteInRange(*operation.Intensity, "灯光强度", 0, 100); err != nil {
				return cloudAgentApprovalPreviewItem{}, err
			}
			light["intensity"] = *operation.Intensity
		}
		if operation.Color != nil {
			if err := cloudAgentPrevisValidateColor(*operation.Color, "灯光颜色"); err != nil {
				return cloudAgentApprovalPreviewItem{}, err
			}
			light["color"] = *operation.Color
		}
		if operation.Angle != nil {
			if err := cloudAgentPrevisFiniteInRange(*operation.Angle, "灯光角度", 0, 6.29); err != nil {
				return cloudAgentApprovalPreviewItem{}, err
			}
			light["angle"] = *operation.Angle
		}
		if operation.Penumbra != nil {
			if err := cloudAgentPrevisFiniteInRange(*operation.Penumbra, "灯光 penumbra", 0, 1); err != nil {
				return cloudAgentApprovalPreviewItem{}, err
			}
			light["penumbra"] = *operation.Penumbra
		}
		if operation.CastShadow != nil {
			light["castShadow"] = *operation.CastShadow
		}
		if err := cloudAgentPrevisApplyTransform(light, operation); err != nil {
			return cloudAgentApprovalPreviewItem{}, err
		}
		return cloudAgentApprovalPreviewItem{Operation: operation.Type, NodeID: operation.ID, NodeTitle: stringValue(light["name"]), Summary: fmt.Sprintf("修改灯光《%s》", stringValue(light["name"]))}, nil
	default:
		return cloudAgentApprovalPreviewItem{}, BadAuthRequest("不支持的预演台语义操作")
	}
}

func applyCloudAgentPrevisMutation(repo *repository.Repository, userID, canvasID string, call cloudAgentCall, policy RuntimePolicySetting, recorder ...cloudAgentMutationRecorder) (any, error) {
	var plan *cloudAgentPrevisMutationPlan
	var err error
	switch call.Function.Name {
	case "previs_scene_create":
		plan, err = prepareCloudAgentPrevisSceneCreate(repo, userID, canvasID, call)
	case "previs_apply_patch":
		plan, err = prepareCloudAgentPrevisApplyPatch(repo, userID, canvasID, call)
	default:
		return nil, BadAuthRequest("不支持的预演台写工具")
	}
	if err != nil {
		return nil, err
	}
	if err = saveCloudAgentDocument(repo, plan.Canvas, plan.Document, policy); err != nil {
		return nil, err
	}
	if len(recorder) > 0 && recorder[0] != nil {
		preview := plan.Preview
		if err := recorder[0](repo, cloudAgentMutationInput{UserID: userID, CanvasID: canvasID, StepID: call.ID, Operation: plan.Operation, BeforeSnapshotHash: plan.BeforeSnapshotHash, AfterSnapshotHash: plan.AfterSnapshotHash, BeforeJSON: plan.BeforeJSON, Preview: &preview}); err != nil {
			return nil, err
		}
	}
	resultSnapshotHash := plan.ResultSnapshotHash
	if resultSnapshotHash == "" {
		resultSnapshotHash = plan.AfterSnapshotHash
	}
	return map[string]any{"canvasId": canvasID, "sceneId": plan.SceneID, "snapshotHash": resultSnapshotHash, "canvasSnapshotHash": plan.AfterSnapshotHash, "committed": true, "summary": plan.Preview.Description}, nil
}
