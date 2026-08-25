package service

import (
	"encoding/json"
	"errors"
	"fmt"
	"regexp"
	"strings"
	"unicode/utf8"
)

type agentStoryboardInput struct {
	References     []string                  `json:"references"`
	CanvasSnapshot map[string]any            `json:"canvasSnapshot"`
	Requirements   string                    `json:"requirements"`
	CanvasAssets   []storyboardAsset         `json:"canvasAssets"`
	ProjectStyle   storyboardProjectStyle    `json:"projectStyle"`
	Characters     []storyboardCharacterCard `json:"characters"`
	Config         providerConfig            `json:"config"`
	ShotDuration   int                       `json:"shotDurationSeconds"`
	ShotCount      int                       `json:"shotCount"`
}

type storyboardProjectStyle struct {
	PresetID    string `json:"presetId"`
	Title       string `json:"title"`
	Prompt      string `json:"prompt"`
	ProfileJSON string `json:"profileJson,omitempty"`
}

type storyboardCharacterCard struct {
	AssetID    string         `json:"assetId"`
	VersionID  string         `json:"versionId"`
	Name       string         `json:"name"`
	Definition map[string]any `json:"definition"`
}

type storyboardAsset struct {
	ID                 string   `json:"id"`
	Title              string   `json:"title"`
	Type               string   `json:"type"`
	Category           string   `json:"category,omitempty"`
	Tags               []string `json:"tags"`
	Prompt             string   `json:"prompt"`
	CharacterAssetID   string   `json:"characterAssetId,omitempty"`
	CharacterVersionID string   `json:"characterVersionId,omitempty"`
}

type storyboardAssetRef struct {
	NodeID   string `json:"nodeId"`
	Role     string `json:"role"`
	Priority int    `json:"priority"`
}

type agentStoryboardPlan struct {
	Title      string                 `json:"title"`
	Logline    string                 `json:"logline"`
	StyleGuide string                 `json:"styleGuide"`
	Characters []string               `json:"characters"`
	Locations  []string               `json:"locations"`
	Shots      []agentStoryboardShot  `json:"shots"`
	Raw        map[string]interface{} `json:"-"`
}

type agentStoryboardShot struct {
	Title         string               `json:"title"`
	Description   string               `json:"description"`
	Duration      int                  `json:"durationSeconds"`
	Dialogue      string               `json:"dialogue"`
	ShotSize      string               `json:"shotSize"`
	Emotion       string               `json:"emotion"`
	Lighting      string               `json:"lightingAndAtmosphere"`
	AudioEffects  string               `json:"audioEffects"`
	VisualPrompt  string               `json:"visualPrompt"`
	VideoPrompt   string               `json:"videoPrompt"`
	Camera        string               `json:"camera"`
	Motion        string               `json:"motion"`
	TimeBeats     string               `json:"timeBeats"`
	Negative      string               `json:"negativePrompt"`
	AssetRefs     []storyboardAssetRef `json:"assetRefs"`
	CharacterIDs  []string             `json:"characterIds"`
	Intent        string               `json:"narrativeIntent"`
	ViewerPOV     string               `json:"viewerPOV"`
	Performance   string               `json:"performanceBlocking"`
	MustHave      []string             `json:"mustHave"`
	Optional      []string             `json:"optionalDetails"`
	ContinuityOut string               `json:"continuityOut"`
}

func parseAgentStoryboardPlan(raw string) (agentStoryboardPlan, error) {
	jsonText, err := extractJSONText(raw)
	if err != nil {
		return agentStoryboardPlan{}, err
	}
	if err := validateStoryboardJSONFields(jsonText); err != nil {
		return agentStoryboardPlan{}, err
	}
	var plan agentStoryboardPlan
	if err := json.Unmarshal([]byte(jsonText), &plan); err != nil {
		return agentStoryboardPlan{}, fmt.Errorf("分镜 JSON 解析失败：%w", err)
	}
	plan.Title = defaultString(strings.TrimSpace(plan.Title), "影视分镜")
	plan.Logline = defaultString(strings.TrimSpace(plan.Logline), "根据剧情生成的分镜方案")
	plan.StyleGuide = defaultString(strings.TrimSpace(plan.StyleGuide), "严格沿用当前项目画风，保持角色、空间、道具、色彩和视觉媒介一致。")
	if len(plan.Shots) == 0 {
		return agentStoryboardPlan{}, errors.New("分镜模型没有返回 shots")
	}
	if len(plan.Shots) > 12 {
		return agentStoryboardPlan{}, fmt.Errorf("分镜数量最多 12 个，实际返回 %d 个", len(plan.Shots))
	}
	for i := range plan.Shots {
		if strings.TrimSpace(plan.Shots[i].Title) == "" {
			plan.Shots[i].Title = fmt.Sprintf("镜头 %d", i+1)
		}
		plan.Shots[i].CharacterIDs = nonNilStrings(plan.Shots[i].CharacterIDs)
		if plan.Shots[i].AssetRefs == nil {
			plan.Shots[i].AssetRefs = []storyboardAssetRef{}
		}
		plan.Shots[i].Optional = nonNilStrings(plan.Shots[i].Optional)
		plan.Shots[i].Intent = defaultString(strings.TrimSpace(plan.Shots[i].Intent), strings.TrimSpace(plan.Shots[i].Description))
		plan.Shots[i].ViewerPOV = defaultString(strings.TrimSpace(plan.Shots[i].ViewerPOV), "客观观察当前主要角色与事件")
		plan.Shots[i].Performance = defaultString(strings.TrimSpace(plan.Shots[i].Performance), strings.TrimSpace(plan.Shots[i].Description))
		plan.Shots[i].ContinuityOut = defaultString(strings.TrimSpace(plan.Shots[i].ContinuityOut), "保持本镜头结尾的人物位置、动作状态、道具和光线方向进入下一镜")
		if len(plan.Shots[i].MustHave) == 0 {
			plan.Shots[i].MustHave = []string{"主要角色身份与当前版本稳定", "主要动作完成并有清晰落点", "结尾状态可供下一镜继承"}
		}
		if strings.TrimSpace(plan.Shots[i].VideoPrompt) == "" {
			plan.Shots[i].VideoPrompt = defaultString(plan.Shots[i].VisualPrompt, plan.Shots[i].Description)
		}
		if strings.TrimSpace(plan.Shots[i].VisualPrompt) == "" {
			return agentStoryboardPlan{}, fmt.Errorf("镜头 %d 缺少 visualPrompt", i+1)
		}
		if strings.TrimSpace(plan.Shots[i].Camera) == "" || strings.TrimSpace(plan.Shots[i].Motion) == "" || strings.TrimSpace(plan.Shots[i].TimeBeats) == "" {
			return agentStoryboardPlan{}, fmt.Errorf("镜头 %d 缺少 camera、motion 或 timeBeats", i+1)
		}
		if plan.Shots[i].Duration <= 0 || plan.Shots[i].Duration > 60 {
			return agentStoryboardPlan{}, fmt.Errorf("镜头 %d 的 durationSeconds 必须在 1 到 60 之间", i+1)
		}
	}
	return plan, nil
}

func validateStoryboardJSONFields(jsonText string) error {
	var root map[string]json.RawMessage
	if err := json.Unmarshal([]byte(jsonText), &root); err != nil {
		return fmt.Errorf("分镜 JSON 解析失败：%w", err)
	}
	for _, field := range []string{"title", "logline", "styleGuide", "characters", "locations", "shots"} {
		if _, ok := root[field]; !ok {
			return fmt.Errorf("分镜 JSON 缺少受保护字段 %s", field)
		}
	}
	var shots []map[string]json.RawMessage
	if err := json.Unmarshal(root["shots"], &shots); err != nil {
		return errors.New("分镜 JSON 的 shots 必须是数组")
	}
	required := []string{"title", "description", "durationSeconds", "dialogue", "characterIds", "narrativeIntent", "viewerPOV", "performanceBlocking", "shotSize", "emotion", "lightingAndAtmosphere", "audioEffects", "visualPrompt", "videoPrompt", "camera", "motion", "timeBeats", "mustHave", "optionalDetails", "continuityOut", "negativePrompt", "assetRefs"}
	for index, shot := range shots {
		for _, field := range required {
			if _, ok := shot[field]; !ok {
				return fmt.Errorf("镜头 %d 缺少受保护字段 %s", index+1, field)
			}
		}
	}
	return nil
}

func nonNilStrings(values []string) []string {
	if values == nil {
		return []string{}
	}
	return values
}

func validateStoryboardContext(projectStyle storyboardProjectStyle, characters []storyboardCharacterCard) error {
	if strings.TrimSpace(projectStyle.PresetID) == "" || strings.TrimSpace(projectStyle.Title) == "" || strings.TrimSpace(projectStyle.Prompt) == "" {
		return errors.New("请先设置项目画风，再生成分镜")
	}
	if strings.TrimSpace(projectStyle.ProfileJSON) != "" {
		if _, err := validateStyleProfileJSON(projectStyle.ProfileJSON); err != nil {
			return err
		}
	}
	for _, character := range characters {
		if strings.TrimSpace(character.AssetID) == "" || strings.TrimSpace(character.VersionID) == "" || strings.TrimSpace(character.Name) == "" {
			return errors.New("角色卡缺少当前资产版本，请刷新角色资产后再生成分镜")
		}
	}
	return nil
}

func validateStoryboardShotDuration(plan agentStoryboardPlan, target int) error {
	if target == 0 {
		return nil
	}
	if target != 5 && target != 10 && target != 15 && target != 30 {
		return fmt.Errorf("不支持的单镜头时长：%d 秒", target)
	}
	for index, shot := range plan.Shots {
		if shot.Duration != target {
			return fmt.Errorf("镜头 %d 的时长必须是 %d 秒", index+1, target)
		}
	}
	return nil
}

func validateStoryboardPlan(plan agentStoryboardPlan, shotDuration int, shotCount int, characters []storyboardCharacterCard, assets []storyboardAsset) error {
	if utf8.RuneCountInString(strings.TrimSpace(plan.StyleGuide)) > 120 {
		return errors.New("styleGuide 最多 120 个中文字符")
	}
	if err := validateStoryboardShotDuration(plan, shotDuration); err != nil {
		return err
	}
	if err := validateStoryboardShotCount(plan, shotCount); err != nil {
		return err
	}
	if err := validateStoryboardCharacterIDs(plan, characters); err != nil {
		return err
	}
	if err := validateStoryboardAssetRefs(plan, assets); err != nil {
		return err
	}
	return nil
}

func validateStoryboardAssetRefs(plan agentStoryboardPlan, assets []storyboardAsset) error {
	allowed := make(map[string]storyboardAsset, len(assets))
	for _, asset := range assets {
		allowed[asset.ID] = asset
	}
	validRoles := map[string]bool{
		"character": true, "environment": true, "wardrobe": true, "prop": true,
		"weapon": true, "style": true, "motion": true, "audio": true,
	}
	for shotIndex, shot := range plan.Shots {
		if len(shot.AssetRefs) > 6 {
			return fmt.Errorf("镜头 %d 最多关联 6 个画布资产", shotIndex+1)
		}
		seen := make(map[string]bool, len(shot.AssetRefs))
		for _, ref := range shot.AssetRefs {
			asset, ok := allowed[ref.NodeID]
			if !ok {
				return fmt.Errorf("镜头 %d 引用了不在当前画布资产目录中的 nodeId：%s", shotIndex+1, ref.NodeID)
			}
			if seen[ref.NodeID] {
				return fmt.Errorf("镜头 %d 重复引用画布资产：%s", shotIndex+1, ref.NodeID)
			}
			seen[ref.NodeID] = true
			if !validRoles[ref.Role] {
				return fmt.Errorf("镜头 %d 的资产 %s 使用了不支持的角色类型：%s", shotIndex+1, asset.Title, ref.Role)
			}
			if ref.Priority < 0 || ref.Priority > 100 {
				return fmt.Errorf("镜头 %d 的资产 %s 优先级必须在 0 到 100 之间", shotIndex+1, asset.Title)
			}
		}
	}
	return nil
}

func validateStoryboardShotCount(plan agentStoryboardPlan, target int) error {
	if target == 0 {
		return nil
	}
	if target < 1 || target > 10 {
		return fmt.Errorf("分镜数量必须在 1 到 10 之间")
	}
	if len(plan.Shots) != target {
		return fmt.Errorf("分镜数量必须是 %d，实际生成 %d", target, len(plan.Shots))
	}
	return nil
}

func validateStoryboardComplexity(plan agentStoryboardPlan) error {
	issues := make([]string, 0)
	for index, shot := range plan.Shots {
		shotNumber := index + 1
		if len(shot.CharacterIDs) > 2 {
			issues = append(issues, fmt.Sprintf("镜头 %d 有 %d 名主要角色，最多 2 名", shotNumber, len(shot.CharacterIDs)))
		}
		if len(shot.MustHave) > 3 {
			issues = append(issues, fmt.Sprintf("镜头 %d 有 %d 个必须完成项，最多 3 个", shotNumber, len(shot.MustHave)))
		}
		if beats := storyboardBeatCount(shot.TimeBeats); beats > 3 {
			issues = append(issues, fmt.Sprintf("镜头 %d 有 %d 个时间节拍，最多 3 个", shotNumber, beats))
		}
		if movements := storyboardCameraMovementCount(shot.Motion); movements > 1 {
			issues = append(issues, fmt.Sprintf("镜头 %d 包含 %d 种主运镜，最多 1 种", shotNumber, movements))
		}
		dialogueLimit := max(24, shot.Duration*5)
		if dialogueLength := utf8.RuneCountInString(strings.TrimSpace(shot.Dialogue)); dialogueLength > dialogueLimit {
			issues = append(issues, fmt.Sprintf("镜头 %d 台词 %d 字，%d 秒镜头最多约 %d 字", shotNumber, dialogueLength, shot.Duration, dialogueLimit))
		}
	}
	if len(issues) == 0 {
		return nil
	}
	return fmt.Errorf("镜头复杂度超限：%s", strings.Join(issues, "；"))
}

func normalizeAutomaticStoryboardDurations(plan *agentStoryboardPlan, target int) {
	if plan == nil || target != 0 {
		return
	}
	for index := range plan.Shots {
		shot := &plan.Shots[index]
		dialogueLength := utf8.RuneCountInString(strings.TrimSpace(shot.Dialogue))
		requiredDuration := (dialogueLength + 4) / 5
		shot.Duration = min(60, max(1, shot.Duration, requiredDuration))
	}
}

func validateStoryboardCharacterIDs(plan agentStoryboardPlan, characters []storyboardCharacterCard) error {
	allowed := make(map[string]bool, len(characters))
	for _, character := range characters {
		allowed[character.AssetID] = true
	}
	for index, shot := range plan.Shots {
		for _, assetID := range shot.CharacterIDs {
			if !allowed[assetID] {
				return fmt.Errorf("镜头 %d 引用了不存在或非当前版本的角色 assetId：%s", index+1, assetID)
			}
		}
	}
	return nil
}

func storyboardRowCharacters(shot agentStoryboardShot, characters []storyboardCharacterCard) []map[string]any {
	byID := make(map[string]storyboardCharacterCard, len(characters))
	for _, character := range characters {
		byID[character.AssetID] = character
	}
	result := make([]map[string]any, 0, len(shot.CharacterIDs))
	for _, assetID := range shot.CharacterIDs {
		character, ok := byID[assetID]
		if !ok {
			continue
		}
		result = append(result, map[string]any{
			"characterName":      character.Name,
			"characterAssetId":   character.AssetID,
			"characterVersionId": character.VersionID,
		})
	}
	return result
}

func storyboardBeatCount(value string) int {
	parts := strings.FieldsFunc(value, func(r rune) bool { return r == '；' || r == ';' || r == '\n' })
	count := 0
	for _, part := range parts {
		if strings.TrimSpace(part) != "" {
			count++
		}
	}
	timecodeCount := len(storyboardTimecodePattern.FindAllString(value, -1))
	return max(count, timecodeCount)
}

var storyboardTimecodePattern = regexp.MustCompile(`\d+(?:\.\d+)?\s*[-~—至到]\s*\d+(?:\.\d+)?\s*秒`)

func storyboardCameraMovementCount(value string) int {
	movements := []string{"推进", "推近", "拉远", "摇摄", "横移", "侧移", "跟拍", "跟随", "升降", "上升", "下降", "环绕", "俯冲", "变焦", "甩镜", "穿越"}
	count := 0
	for _, movement := range movements {
		if strings.Contains(value, movement) {
			count++
		}
	}
	return count
}

func extractJSONText(raw string) (string, error) {
	// Text models may prepend an explanation or append a Markdown fence despite
	// the JSON-only contract. Scan complete JSON values instead of pairing the
	// first opening brace with the final closing brace, which can merge prose and
	// make an otherwise valid character breakdown fail validation.
	for start := 0; start < len(raw); start++ {
		if raw[start] != '{' && raw[start] != '[' {
			continue
		}
		end := jsonValueEnd(raw, start)
		if end < start {
			continue
		}
		candidate := raw[start : end+1]
		var decoded interface{}
		if json.Unmarshal([]byte(candidate), &decoded) == nil {
			return candidate, nil
		}
	}
	return "", errors.New("模型返回的不是 JSON")
}

func jsonValueEnd(source string, start int) int {
	stack := make([]byte, 0, 8)
	inString := false
	escaped := false
	for index := start; index < len(source); index++ {
		value := source[index]
		if inString {
			if escaped {
				escaped = false
			} else if value == '\\' {
				escaped = true
			} else if value == '"' {
				inString = false
			}
			continue
		}
		switch value {
		case '"':
			inString = true
		case '{', '[':
			stack = append(stack, value)
		case '}', ']':
			if len(stack) == 0 {
				return -1
			}
			opener := stack[len(stack)-1]
			if (value == '}' && opener != '{') || (value == ']' && opener != '[') {
				return -1
			}
			stack = stack[:len(stack)-1]
			if len(stack) == 0 {
				return index
			}
		}
	}
	return -1
}
func extractStoryboardAssets(snapshot map[string]any) []storyboardAsset {
	rawNodes, _ := snapshot["nodes"].([]interface{})
	assets := make([]storyboardAsset, 0, len(rawNodes))
	for _, raw := range rawNodes {
		node, _ := raw.(map[string]interface{})
		if node == nil {
			continue
		}
		metadata, _ := node["metadata"].(map[string]interface{})
		if metadata == nil {
			metadata = map[string]interface{}{}
		}
		nodeType := stringValue(node["type"])
		workflowKind := stringValue(metadata["workflowKind"])
		isCharacterCard := workflowKind == "character" && stringValue(metadata["characterAssetId"]) != "" && stringValue(metadata["characterVersionId"]) != ""
		isMedia := nodeType == "image" || nodeType == "video" || nodeType == "audio"
		if (!isMedia && !isCharacterCard) || workflowKind == "shot" || workflowKind == "action_board" || workflowKind == "final" {
			continue
		}
		id := stringValue(node["id"])
		if id == "" {
			continue
		}
		tags := stringSlice(metadata["assetTags"])
		prompt := stringValue(metadata["prompt"])
		content := stringValue(metadata["content"])
		if len(tags) == 0 && prompt == "" && content == "" && !isCharacterCard {
			continue
		}
		assets = append(assets, storyboardAsset{
			ID:                 id,
			Title:              defaultString(stringValue(node["title"]), "未命名资产"),
			Type:               defaultString(nodeType, "reference"),
			Category:           stringValue(metadata["assetCategory"]),
			Tags:               tags,
			Prompt:             prompt,
			CharacterAssetID:   stringValue(metadata["characterAssetId"]),
			CharacterVersionID: stringValue(metadata["characterVersionId"]),
		})
		if len(assets) >= 60 {
			break
		}
	}
	return assets
}

func resolveStoryboardAssets(assets []storyboardAsset, refs []storyboardAssetRef) []storyboardAsset {
	byID := make(map[string]storyboardAsset, len(assets))
	for _, asset := range assets {
		byID[asset.ID] = asset
	}
	resolved := make([]storyboardAsset, 0, len(refs))
	for _, ref := range refs {
		if asset, ok := byID[ref.NodeID]; ok {
			resolved = append(resolved, asset)
		}
	}
	return resolved
}

func normalizeStoryboardAssets(input []storyboardAsset) []storyboardAsset {
	allowedTypes := map[string]bool{"image": true, "video": true, "audio": true, "character": true}
	seenIDs := make(map[string]bool, len(input))
	assets := make([]storyboardAsset, 0, min(len(input), 60))
	for _, asset := range input {
		id := strings.TrimSpace(asset.ID)
		assetType := strings.ToLower(strings.TrimSpace(asset.Type))
		if id == "" || utf8.RuneCountInString(id) > 160 || seenIDs[id] || !allowedTypes[assetType] {
			continue
		}
		seenIDs[id] = true
		tags := make([]string, 0, min(len(asset.Tags), 12))
		seenTags := make(map[string]bool, len(asset.Tags))
		for _, value := range asset.Tags {
			tag := clipStoryboardAssetText(value, 64)
			if tag == "" || seenTags[tag] {
				continue
			}
			seenTags[tag] = true
			tags = append(tags, tag)
			if len(tags) == 12 {
				break
			}
		}
		assets = append(assets, storyboardAsset{
			ID:                 id,
			Title:              defaultString(clipStoryboardAssetText(asset.Title, 120), "未命名资产"),
			Type:               assetType,
			Category:           clipStoryboardAssetText(asset.Category, 40),
			Tags:               tags,
			Prompt:             clipStoryboardAssetText(asset.Prompt, 600),
			CharacterAssetID:   clipStoryboardAssetText(asset.CharacterAssetID, 160),
			CharacterVersionID: clipStoryboardAssetText(asset.CharacterVersionID, 160),
		})
		if len(assets) == 60 {
			break
		}
	}
	return assets
}

func clipStoryboardAssetText(value string, limit int) string {
	runes := []rune(strings.TrimSpace(value))
	if len(runes) <= limit {
		return string(runes)
	}
	return string(runes[:limit])
}

func listContent(title string, items []string) string {
	if len(items) == 0 {
		return title + "\n\n- 暂无明确内容。"
	}
	lines := []string{title, ""}
	for _, item := range items {
		if strings.TrimSpace(item) != "" {
			lines = append(lines, "- "+item)
		}
	}
	return strings.Join(lines, "\n")
}

func storyboardAssetsContent(assets []storyboardAsset) string {
	if len(assets) == 0 {
		return "当前画布暂无可用图片资产。建议先给角色、环境、道具图片添加资产标签。"
	}
	lines := make([]string, 0, len(assets))
	for _, asset := range assets {
		line := asset.Title + "\nID: " + asset.ID
		if len(asset.Tags) > 0 {
			line += "\n标签: " + strings.Join(asset.Tags, "、")
		}
		if asset.Prompt != "" {
			line += "\n原提示词: " + asset.Prompt
		}
		lines = append(lines, line)
	}
	return strings.Join(lines, "\n\n")
}

func shotDescription(shot agentStoryboardShot) string {
	parts := []string{shot.Description}
	if strings.TrimSpace(shot.VisualPrompt) != "" {
		parts = append(parts, "画面提示词："+shot.VisualPrompt)
	}
	if strings.TrimSpace(shot.Camera) != "" {
		parts = append(parts, "镜头："+shot.Camera)
	}
	if strings.TrimSpace(shot.Motion) != "" {
		parts = append(parts, "运动："+shot.Motion)
	}
	if strings.TrimSpace(shot.TimeBeats) != "" {
		parts = append(parts, "时间节拍："+shot.TimeBeats)
	}
	filtered := make([]string, 0, len(parts))
	for _, part := range parts {
		if strings.TrimSpace(part) != "" {
			filtered = append(filtered, part)
		}
	}
	return strings.Join(filtered, "\n\n")
}

func storyboardImagePromptValues(projectStyle string, styleGuide string, shot agentStoryboardShot) map[string]string {
	negative := defaultString(strings.TrimSpace(shot.Negative), "禁止换脸、服装变化、手部畸形、乱码、风格突变和塑料材质")
	return map[string]string{
		"项目视觉":   storyboardProjectVisualSummary(projectStyle, styleGuide),
		"首帧构图":   compactPromptText(shot.VisualPrompt+"；光影："+shot.Lighting, 360),
		"表演起始状态": compactPromptText(shot.Performance, 180),
		"负面要求":   compactPromptText(negative, 140),
	}
}

func buildStoryboardImagePrompt(projectStyle string, styleGuide string, shot agentStoryboardShot) string {
	definition, _ := promptDefinition(promptOperationStoryboardFirstFrame)
	prompt, _ := renderPromptTemplate(definition, definition.DefaultContent, storyboardImagePromptValues(projectStyle, styleGuide, shot))
	return prompt
}

func storyboardVideoPromptValues(projectStyle string, styleGuide string, shot agentStoryboardShot) map[string]string {
	camera := defaultString(strings.TrimSpace(shot.Camera), strings.TrimSpace(shot.ShotSize)+"，平视机位，中等焦段，主体与环境保持空间层次")
	motion := defaultString(strings.TrimSpace(shot.Motion), "固定机位，主体在画面内完成动作")
	timeBeats := defaultString(strings.TrimSpace(shot.TimeBeats), fmt.Sprintf("0-%d秒：%s", shot.Duration, strings.TrimSpace(shot.Description)))
	negative := defaultString(strings.TrimSpace(shot.Negative), "禁止换脸、服装变化、手部畸形、乱码、闪烁、风格突变和动作僵硬")
	values := map[string]string{
		"项目视觉":  storyboardProjectVisualSummary(projectStyle, styleGuide),
		"镜头意图":  compactPromptText(shot.Intent+"；观众视点："+shot.ViewerPOV+"；情绪："+shot.Emotion, 150),
		"首帧构图":  compactPromptText(shot.VisualPrompt+"；光影："+shot.Lighting, 280),
		"表演与调度": compactPromptText(shot.Performance, 180),
		"摄影机":   compactPromptText(strings.TrimSpace(shot.ShotSize)+"；"+camera+"；主运镜："+motion, 220),
		"时间节拍":  compactPromptText(timeBeats, 240),
		"运动与结尾": compactPromptText(shot.VideoPrompt+"；连续性结尾："+shot.ContinuityOut, 240),
		"声音":    compactPromptText(strings.TrimSpace(shot.Dialogue)+"；音效："+strings.TrimSpace(shot.AudioEffects), 160),
		"负面要求":  compactPromptText(negative, 160),
	}
	if len(shot.MustHave) > 0 {
		priority := "必须完成：" + strings.Join(shot.MustHave, "；")
		if len(shot.Optional) > 0 {
			priority += "。可以简化：" + strings.Join(shot.Optional, "；")
		}
		values["执行优先级"] = compactPromptText(priority, 140)
	}
	return values
}

func buildStoryboardVideoPrompt(projectStyle string, styleGuide string, shot agentStoryboardShot) string {
	definition, _ := promptDefinition(promptOperationStoryboardVideo)
	prompt, _ := renderPromptTemplate(definition, definition.DefaultContent, storyboardVideoPromptValues(projectStyle, styleGuide, shot))
	return prompt
}

func storyboardProjectVisualSummary(projectStyle string, styleGuide string) string {
	identity := ""
	for _, line := range strings.Split(projectStyle, "\n") {
		if strings.TrimSpace(line) != "" {
			identity = strings.TrimSpace(line)
			break
		}
	}
	parts := make([]string, 0, 2)
	if identity != "" {
		parts = append(parts, identity)
	}
	if strings.TrimSpace(styleGuide) != "" {
		parts = append(parts, strings.TrimSpace(styleGuide))
	}
	return compactPromptText(strings.Join(parts, "；"), 180)
}

func compactPromptText(value string, limit int) string {
	text := strings.TrimSpace(value)
	if utf8.RuneCountInString(text) <= limit {
		return text
	}
	runes := []rune(text)
	return strings.TrimSpace(string(runes[:limit])) + "。"
}

func shotComposerContent(prompt string, assets []storyboardAsset) string {
	if len(assets) == 0 {
		return prompt
	}
	lines := []string{"参考素材："}
	for _, asset := range assets {
		label := asset.Title
		if len(asset.Tags) > 0 {
			label += "（" + strings.Join(asset.Tags, "、") + "）"
		}
		lines = append(lines, "- "+label+"：@[node:"+asset.ID+"]")
	}
	lines = append(lines, "", "分镜视频提示词：", prompt)
	return strings.Join(lines, "\n")
}
