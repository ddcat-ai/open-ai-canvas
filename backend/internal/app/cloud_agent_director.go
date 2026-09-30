package app

import (
	"fmt"
	"strings"

	"infinite-canvas/backend/internal/repository"
)

// Director Agent tools deliberately expose a projection rather than the raw
// DirectorScene payload. The browser owns model URLs and storage references;
// the Agent only needs semantic shot/layout data to plan a preview.
func cloudAgentDirectorSceneRead(repo *repository.Repository, userID, canvasID string, call cloudAgentCall) (any, error) {
	var args struct {
		SceneID   string   `json:"sceneId"`
		ShotID    string   `json:"shotId"`
		ObjectIDs []string `json:"objectIds"`
	}
	if err := decodeCloudAgentJSONObject(call.Function.Arguments, &args); err != nil {
		return nil, cloudAgentJSONArgumentError(err)
	}
	if err := validateCloudAgentID(args.SceneID, "导演场景 ID", 80); err != nil {
		return nil, err
	}
	if err := validateCloudAgentID(args.ShotID, "导演镜头 ID", 80); err != nil {
		return nil, err
	}
	if len(args.ObjectIDs) > 16 {
		return nil, BadAuthRequest("导演对象读取最多包含16个对象 ID")
	}
	for _, id := range args.ObjectIDs {
		if err := validateCloudAgentID(id, "导演对象 ID", 80); err != nil {
			return nil, err
		}
	}

	canvas, err := repo.CanvasProjectForUser(userID, canvasID)
	if err != nil {
		return nil, err
	}
	doc, err := creationDocument(canvas.PayloadJSON)
	if err != nil {
		return nil, err
	}
	rawScenes := creationMaps(doc["directorScenes"])
	if args.SceneID == "" {
		items := make([]map[string]any, 0, len(rawScenes))
		for _, scene := range rawScenes {
			items = append(items, map[string]any{
				"id":           stringValue(scene["id"]),
				"title":        truncateRunes(stringValue(scene["title"]), 160),
				"activeShotId": stringValue(scene["activeShotId"]),
				"shotCount":    len(creationMaps(scene["shots"])),
				"objectCount":  len(creationMaps(scene["objects"])),
			})
		}
		return map[string]any{
			"canvasId": canvasID,
			"scenes":   items,
			"count":    len(items),
			"guidance": "先用返回的 sceneId 读取一个场景，再使用 shotId 进行布局或预演。",
		}, nil
	}

	scene, ok := findDirectorScene(rawScenes, args.SceneID)
	if !ok {
		return nil, BadAuthRequest("导演场景不存在或不属于当前画布")
	}
	if args.ShotID != "" {
		if _, ok := findDirectorShot(scene, args.ShotID); !ok {
			return nil, BadAuthRequest("导演镜头不存在或不属于指定场景")
		}
	}
	objectIDs := make(map[string]bool, len(args.ObjectIDs))
	for _, id := range args.ObjectIDs {
		objectIDs[id] = true
	}
	return map[string]any{
		"canvasId":     canvasID,
		"scene":        projectDirectorScene(scene, args.ShotID, objectIDs),
		"snapshotHash": creationHash(scene),
		"revision":     canvas.Revision,
		"guidance":     "这是安全摘要，不是可直接回写的完整 JSON；需要预演时使用 director_preview。",
	}, nil
}

func cloudAgentDirectorPreview(repo *repository.Repository, userID, canvasID string, call cloudAgentCall) (any, error) {
	var args struct {
		SceneID  string   `json:"sceneId"`
		ShotID   string   `json:"shotId"`
		Duration *float64 `json:"duration"`
		FPS      *int     `json:"fps"`
		Output   string   `json:"output"`
	}
	if err := decodeCloudAgentJSONObject(call.Function.Arguments, &args); err != nil {
		return nil, cloudAgentJSONArgumentError(err)
	}
	if err := validateCloudAgentID(args.SceneID, "导演场景 ID", 80); err != nil {
		return nil, err
	}
	if err := validateCloudAgentID(args.ShotID, "导演镜头 ID", 80); err != nil {
		return nil, err
	}
	if args.Output != "" && args.Output != "clay_video" {
		return nil, BadAuthRequest("导演预演 output 目前只支持 clay_video")
	}
	if args.Duration != nil && (*args.Duration < 0.1 || *args.Duration > 60) {
		return nil, BadAuthRequest("导演预演 duration 必须在0.1到60秒之间")
	}
	if args.FPS != nil && (*args.FPS < 1 || *args.FPS > 60) {
		return nil, BadAuthRequest("导演预演 fps 必须在1到60之间")
	}
	canvas, err := repo.CanvasProjectForUser(userID, canvasID)
	if err != nil {
		return nil, err
	}
	doc, err := creationDocument(canvas.PayloadJSON)
	if err != nil {
		return nil, err
	}
	scene, ok := findDirectorScene(creationMaps(doc["directorScenes"]), args.SceneID)
	if !ok {
		return nil, BadAuthRequest("导演场景不存在或不属于当前画布")
	}
	shot, ok := findDirectorShot(scene, args.ShotID)
	if !ok {
		return nil, BadAuthRequest("导演镜头不存在或不属于指定场景")
	}
	duration := numberValue(shot["duration"], 5)
	if args.Duration != nil {
		duration = *args.Duration
	}
	fps := int(numberValue(shot["fps"], 24))
	if args.FPS != nil {
		fps = *args.FPS
	}
	requestID := strings.TrimSpace(call.ID)
	if requestID == "" {
		requestID = fmt.Sprintf("director-preview-%s-%s", args.SceneID, args.ShotID)
	}
	return map[string]any{
		"previewRequestId": requestID,
		"canvasId":         canvasID,
		"sceneId":          args.SceneID,
		"sceneTitle":       truncateRunes(stringValue(scene["title"]), 160),
		"shotId":           args.ShotID,
		"shotName":         truncateRunes(stringValue(shot["name"]), 160),
		"duration":         duration,
		"fps":              fps,
		"output":           "clay_video",
		"snapshotHash":     creationHash(scene),
		"execution":        "browser_director_viewport",
		"text":             "已请求导演台在浏览器视口录制白模预演；录制完成后会回写为画布视频节点。",
	}, nil
}

func findDirectorScene(scenes []map[string]any, id string) (map[string]any, bool) {
	for _, scene := range scenes {
		if stringValue(scene["id"]) == id {
			return scene, true
		}
	}
	return nil, false
}

func findDirectorShot(scene map[string]any, id string) (map[string]any, bool) {
	for _, shot := range creationMaps(scene["shots"]) {
		if stringValue(shot["id"]) == id {
			return shot, true
		}
	}
	return nil, false
}

func projectDirectorScene(scene map[string]any, shotID string, objectIDs map[string]bool) map[string]any {
	shots := make([]map[string]any, 0)
	for _, shot := range creationMaps(scene["shots"]) {
		if shotID != "" && stringValue(shot["id"]) != shotID {
			continue
		}
		shots = append(shots, map[string]any{
			"id":         stringValue(shot["id"]),
			"name":       truncateRunes(stringValue(shot["name"]), 160),
			"cameraId":   stringValue(shot["cameraId"]),
			"duration":   numberValue(shot["duration"], 5),
			"fps":        int(numberValue(shot["fps"], 24)),
			"shotSize":   stringValue(shot["shotSize"]),
			"cameraMove": stringValue(shot["cameraMove"]),
		})
	}
	objects := make([]map[string]any, 0)
	for _, object := range creationMaps(scene["objects"]) {
		id := stringValue(object["id"])
		if len(objectIDs) > 0 && !objectIDs[id] {
			continue
		}
		objects = append(objects, map[string]any{
			"id":        id,
			"name":      truncateRunes(stringValue(object["name"]), 160),
			"kind":      stringValue(object["kind"]),
			"primitive": stringValue(object["primitive"]),
			"color":     stringValue(object["color"]),
			"pose":      stringValue(object["pose"]),
			"visible":   boolValue(object["visible"], true),
			"transform": projectDirectorTransform(object["transform"]),
		})
	}
	cameras := make([]map[string]any, 0)
	for _, camera := range creationMaps(scene["cameras"]) {
		cameras = append(cameras, map[string]any{
			"id":          stringValue(camera["id"]),
			"name":        truncateRunes(stringValue(camera["name"]), 160),
			"focalLength": numberValue(camera["focalLength"], 50),
			"transform":   projectDirectorTransform(camera["transform"]),
			"target":      projectDirectorVec3(camera["target"]),
		})
	}
	return map[string]any{
		"id":           stringValue(scene["id"]),
		"title":        truncateRunes(stringValue(scene["title"]), 160),
		"activeShotId": stringValue(scene["activeShotId"]),
		"shots":        shots,
		"objects":      objects,
		"cameras":      cameras,
		"lightCount":   len(creationMaps(scene["lights"])),
	}
}

func projectDirectorTransform(value any) map[string]any {
	transform, _ := value.(map[string]any)
	return map[string]any{
		"position": projectDirectorVec3(transform["position"]),
		"rotation": projectDirectorVec3(transform["rotation"]),
		"scale":    projectDirectorVec3(transform["scale"]),
	}
}

func projectDirectorVec3(value any) []any {
	items, ok := value.([]any)
	if !ok || len(items) != 3 {
		return []any{0, 0, 0}
	}
	result := make([]any, 3)
	for index, item := range items {
		result[index], _ = cloudAgentSafeNumber(item)
		if result[index] == nil {
			result[index] = 0
		}
	}
	return result
}

func numberValue(value any, fallback float64) float64 {
	if number, ok := cloudAgentSafeNumber(value); ok {
		switch typed := number.(type) {
		case float64:
			return typed
		case int:
			return float64(typed)
		case int64:
			return float64(typed)
		}
	}
	return fallback
}

func boolValue(value any, fallback bool) bool {
	if result, ok := value.(bool); ok {
		return result
	}
	return fallback
}
