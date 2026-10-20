package app

import (
	"fmt"
	"strings"
)

func cloudAgentStoryboardImageSource(doc map[string]any, targetID string) (map[string]any, map[string]any, error) {
	var source, selected map[string]any
	for _, node := range creationMaps(doc["nodes"]) {
		if stringValue(node["type"]) != "script" {
			continue
		}
		metadata, _ := node["metadata"].(map[string]any)
		storyboard, _ := metadata["storyboard"].(map[string]any)
		for _, row := range creationMaps(storyboard["rows"]) {
			if stringValue(row["imageNodeId"]) != targetID {
				continue
			}
			if selected != nil {
				return nil, nil, creationConflict("同一图片节点关联了多个镜头，请先修复关联")
			}
			source, selected = node, row
		}
	}
	for _, edge := range creationMaps(doc["connections"]) {
		if stringValue(edge["toNodeId"]) != targetID || stringValue(edge["relation"]) != "storyboard-output" {
			continue
		}
		if source == nil || stringValue(edge["fromNodeId"]) != stringValue(source["id"]) || stringValue(edge["fromHandleId"]) != "row:"+stringValue(selected["id"]) || stringValue(edge["storyboardRowId"]) != stringValue(selected["id"]) {
			return nil, nil, creationConflict("分镜行与图片输出连线不一致，请重新准备镜头图片")
		}
	}
	return source, selected, nil
}

func cloudAgentStoryboardImagePrompt(row map[string]any, prompt string, bindings []map[string]any, refs map[string]any) string {
	lines := []string{"【分镜原始画面要求】", fmt.Sprintf("镜头编号：%v；只生成该镜头的一张关键帧，禁止拼贴多个时刻，旁白、声音及时间节拍不作为画内文字。", row["shotNumber"])}
	for _, field := range []struct{ key, label string }{
		{"plotDescription", "画面剧情"}, {"imageGenerationPrompt", "原始图片提示词"}, {"shotSize", "景别构图"}, {"camera", "镜头与机位（运动仅作构图依据）"},
		{"performanceBlocking", "人物站位与表演调度"}, {"emotion", "表演情绪"}, {"lightingAndAtmosphere", "光影环境"},
		{"narrativeIntent", "叙事意图"}, {"viewerPOV", "观看视点"}, {"motion", "动作瞬间依据"}, {"continuityOut", "连续性依据"}, {"negativePrompt", "禁止内容"},
	} {
		if value := strings.TrimSpace(stringValue(row[field.key])); value != "" {
			lines = append(lines, field.label+"："+value)
		}
	}
	characters := []string{}
	for _, character := range creationMaps(row["characters"]) {
		if name := stringValue(character["characterName"]); name != "" {
			if description := stringValue(character["characterDescription"]); description != "" {
				name += "（" + description + "）"
			}
			characters = append(characters, name)
		}
	}
	if len(characters) > 0 {
		lines = append(lines, "登场角色："+strings.Join(characters, "、"))
	}
	for _, field := range []struct{ key, label string }{{"mustHave", "必备画面元素"}, {"optionalDetails", "可选细节"}} {
		if items := toStringSlice(row[field.key]); len(items) > 0 {
			lines = append(lines, field.label+"："+strings.Join(items, "；"))
		}
	}
	context := strings.Join(lines, "\n")
	if !strings.Contains(prompt, context) {
		prompt += "\n\n" + context
	}
	roles := map[string]string{"character": "角色身份、外貌与服装；不照搬三视图排版", "environment": "场景空间、建筑与环境；不照搬空镜中的人物", "wardrobe": "服装材质与细节", "prop": "道具造型与材质", "weapon": "兵器造型与材质", "style": "画风、材质与色彩"}
	byID := map[string]string{}
	for _, binding := range bindings {
		byID[stringValue(binding["nodeId"])] = roles[stringValue(binding["role"])]
	}
	roleLines := []string{"【参考图职责】"}
	for index, ref := range creationMaps(refs["referenceImages"]) {
		if role := byID[stringValue(ref["id"])]; role != "" {
			roleLines = append(roleLines, fmt.Sprintf("@图片%d（%s）：只负责%s；人物数量、站位、镜头和光影以本镜头要求为准。", index+1, strings.ReplaceAll(stringValue(ref["name"]), "@", "＠"), role))
		}
	}
	if len(roleLines) > 1 {
		roleText := strings.Join(roleLines, "\n")
		if !strings.Contains(prompt, roleText) {
			prompt += "\n\n" + roleText
		}
	}
	return strings.TrimSpace(prompt)
}

func validateCloudAgentStoryboardImageInputs(doc map[string]any, args cloudAgentMediaArgs) error {
	if args.Mode != "image" {
		return nil
	}
	_, row, err := cloudAgentStoryboardImageSource(doc, args.NodeID)
	if err != nil || row == nil {
		return err
	}
	if args.SourceNodeID != "" || len(args.ReferenceTransientIDs) > 0 {
		return BadAuthRequest("分镜图片请使用已准备的镜头与参考素材，不额外拼接文字来源或临时参考")
	}
	expected := []string{}
	seen := map[string]bool{}
	add := func(id string) {
		if !seen[id] {
			seen[id] = true
			expected = append(expected, id)
		}
	}
	for _, binding := range creationMaps(row["assetBindings"]) {
		if cloudAgentStoryboardImageRoleValid(stringValue(binding["role"])) {
			add(stringValue(binding["nodeId"]))
		}
	}
	for _, edge := range creationMaps(doc["connections"]) {
		if stringValue(edge["toNodeId"]) == args.NodeID && stringValue(edge["relation"]) != "storyboard-output" {
			add(stringValue(edge["fromNodeId"]))
		}
	}
	if len(args.ReferenceNodeIDs) != len(expected) {
		return creationConflict("生成参考与分镜绑定不一致，请重新准备镜头图片；不能遗漏角色、场景或道具")
	}
	for index, id := range expected {
		if args.ReferenceNodeIDs[index] != id {
			return creationConflict("生成参考或顺序与分镜绑定不一致，请沿用准备结果的参考顺序，避免图片职责错位")
		}
	}
	return nil
}
