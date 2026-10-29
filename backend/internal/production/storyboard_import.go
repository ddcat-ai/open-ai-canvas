package production

import (
	"encoding/json"
	"regexp"
	"strconv"
	"strings"
)

// ParseStoryboardSource 直接解析用户写好的分镜，不经过文本模型，台词与镜头一字不改。
// 支持两种格式：与剧本输出同结构的 JSON（{"shots":[...]} 或镜头数组），
// 以及带表头的 Markdown 表格 / 从表格软件复制的制表符分隔文本。无法识别时返回 false，交给模型转录。
func ParseStoryboardSource(text string) ([]ScriptShot, bool) {
	text = strings.TrimSpace(text)
	if text == "" {
		return nil, false
	}
	if shots, ok := parseStoryboardJSON(text); ok {
		return shots, true
	}
	return parseStoryboardTable(text)
}

func parseStoryboardJSON(text string) ([]ScriptShot, bool) {
	if strings.HasPrefix(text, "[") {
		text = `{"shots":` + text + `}`
	}
	candidate, err := ExtractJSONObject(text)
	if err != nil {
		return nil, false
	}
	var payload struct {
		Shots []ScriptShot `json:"shots"`
	}
	if json.Unmarshal([]byte(candidate), &payload) != nil || len(payload.Shots) == 0 {
		return nil, false
	}
	shots, err := normalizeScriptShots(payload.Shots)
	return shots, err == nil
}

type storyboardColumn int

const (
	columnIgnore storyboardColumn = iota
	columnScene
	columnCharacters
	columnProps
	columnSpeaker
	columnDialogue
	columnNarration
	columnAction
	columnImage
	columnShotSize
	columnCamera
	columnDuration
	columnTransition
)

// storyboardHeader 按表头关键字识别列；先判断台词类，避免“角色台词”被当成出场角色。
func storyboardHeader(cell string) storyboardColumn {
	value := strings.ToLower(strings.ReplaceAll(strings.TrimSpace(cell), " ", ""))
	has := func(keys ...string) bool {
		for _, key := range keys {
			if strings.Contains(value, key) {
				return true
			}
		}
		return false
	}
	switch {
	case value == "":
		return columnIgnore
	case has("台词", "对白", "对话", "dialogue", "line"):
		return columnDialogue
	case has("旁白", "画外音", "narration"):
		return columnNarration
	case has("说话人", "讲话人", "speaker"):
		return columnSpeaker
	case has("景别", "shotsize"):
		return columnShotSize
	case has("运镜", "镜头运动", "机位", "camera"):
		return columnCamera
	case has("时长", "秒", "duration", "time"):
		return columnDuration
	case has("转场", "transition"):
		return columnTransition
	case has("场景", "地点", "scene", "location"):
		return columnScene
	case has("道具", "prop"):
		return columnProps
	case has("角色", "人物", "出场", "character"):
		return columnCharacters
	case has("画面", "构图", "image", "visual"):
		return columnImage
	case has("动作", "内容", "描述", "剧情", "action", "description"):
		return columnAction
	}
	return columnIgnore
}

var (
	markdownRule   = regexp.MustCompile(`^:?-{2,}:?$`)
	durationNumber = regexp.MustCompile(`\d+(?:\.\d+)?`)
	speakerPrefix  = regexp.MustCompile(`^\s*([^：:“”"「」（）()\s，。！？,.!?]{1,10})\s*(?:（[^）]*）|\([^)]*\))?\s*[：:]\s*(.+)$`)
	htmlBreak      = regexp.MustCompile(`(?i)<br\s*/?>`)
	leadingCue     = regexp.MustCompile(`^\s*(?:（[^）]*）|\([^)]*\))`)
)

func splitStoryboardCells(line string, pipe bool) []string {
	if pipe {
		line = strings.TrimSpace(line)
		line = strings.TrimPrefix(line, "|")
		line = strings.TrimSuffix(line, "|")
		cells := strings.Split(line, "|")
		for i := range cells {
			cells[i] = strings.TrimSpace(cells[i])
		}
		return cells
	}
	cells := strings.Split(line, "\t")
	for i := range cells {
		cells[i] = strings.TrimSpace(cells[i])
	}
	return cells
}

func parseStoryboardTable(text string) ([]ScriptShot, bool) {
	lines := strings.Split(strings.ReplaceAll(text, "\r\n", "\n"), "\n")
	pipe := strings.Count(text, "|") >= 4
	if !pipe && !strings.Contains(text, "\t") {
		return nil, false
	}
	var columns []storyboardColumn
	shots := []ScriptShot{}
	for _, line := range lines {
		if strings.TrimSpace(line) == "" {
			continue
		}
		if pipe && !strings.Contains(line, "|") {
			continue
		}
		if !pipe && !strings.Contains(line, "\t") {
			continue
		}
		cells := splitStoryboardCells(line, pipe)
		if columns == nil {
			mapped := make([]storyboardColumn, len(cells))
			found := map[storyboardColumn]bool{}
			for i, cell := range cells {
				mapped[i] = storyboardHeader(cell)
				found[mapped[i]] = true
			}
			if found[columnDialogue] || found[columnAction] || found[columnImage] {
				if !found[columnAction] {
					// 只有“画面”一列时它就是镜头内容。
					for i := range mapped {
						if mapped[i] == columnImage {
							mapped[i] = columnAction
							break
						}
					}
				}
				columns = mapped
			}
			continue
		}
		if isMarkdownRule(cells) {
			continue
		}
		shots = append(shots, storyboardRow(columns, cells)...)
		if len(shots) >= MaxScriptShots {
			break
		}
	}
	if columns == nil || len(shots) == 0 {
		return nil, false
	}
	normalized, err := normalizeScriptShots(shots)
	return normalized, err == nil
}

func isMarkdownRule(cells []string) bool {
	for _, cell := range cells {
		if cell != "" && !markdownRule.MatchString(cell) {
			return false
		}
	}
	return true
}

// storyboardRow 把一行表格转成镜头；一格里有多句台词（<br> 分隔）时拆成连续镜头，每镜一句。
func storyboardRow(columns []storyboardColumn, cells []string) []ScriptShot {
	var shot ScriptShot
	dialogue, narration := "", ""
	for i, cell := range cells {
		if i >= len(columns) || cell == "" {
			continue
		}
		switch columns[i] {
		case columnScene:
			shot.Scene = cell
		case columnCharacters:
			shot.Characters = splitNames(cell)
		case columnProps:
			shot.Props = splitNames(cell)
		case columnSpeaker:
			shot.Speaker = cell
		case columnDialogue:
			dialogue = cell
		case columnNarration:
			narration = cell
		case columnAction:
			shot.Action = joinField(shot.Action, htmlBreak.ReplaceAllString(cell, "；"))
		case columnImage:
			shot.ImagePrompt = joinField(shot.ImagePrompt, htmlBreak.ReplaceAllString(cell, "；"))
		case columnShotSize:
			shot.ShotSize = cell
		case columnCamera:
			shot.Camera = cell
		case columnDuration:
			if value, err := strconv.ParseFloat(durationNumber.FindString(cell), 64); err == nil {
				shot.DurationSeconds = value
			}
		case columnTransition:
			shot.Transition = cell
		}
	}
	lines := []string{}
	for _, part := range htmlBreak.Split(dialogue, -1) {
		if part = strings.TrimSpace(part); part != "" && part != "-" && part != "无" && part != "—" {
			lines = append(lines, part)
		}
	}
	if len(lines) == 0 && narration != "" && narration != "-" && narration != "无" {
		shot.Speaker, shot.Dialogue = "旁白", trimQuotes(narration)
		return []ScriptShot{shot}
	}
	if len(lines) == 0 {
		return []ScriptShot{shot}
	}
	result := make([]ScriptShot, 0, len(lines))
	for index, line := range lines {
		item := shot
		item.Characters = append([]string(nil), shot.Characters...)
		item.Props = append([]string(nil), shot.Props...)
		if match := speakerPrefix.FindStringSubmatch(line); match != nil && !isStoryboardMetaKey(match[1]) {
			item.Speaker, line = match[1], match[2]
		} else if item.Speaker == "" && len(item.Characters) == 1 {
			item.Speaker = item.Characters[0]
		}
		// “（冷笑）等我做什么”里的括号是表演提示，不是要说出口的台词，移到动作里。
		if cue := leadingCue.FindString(line); cue != "" {
			item.Action = joinField(item.Action, (item.Speaker + cue))
			line = strings.TrimSpace(line[len(cue):])
		}
		item.Dialogue = trimQuotes(line)
		if len(lines) > 1 {
			item.DurationSeconds = shot.DurationSeconds / float64(len(lines))
			if index > 0 {
				item.Transition = ""
			}
		}
		result = append(result, item)
	}
	return result
}

func joinField(current, value string) string {
	if current == "" {
		return value
	}
	return current + "；" + value
}

func splitNames(value string) []string {
	names := []string{}
	for _, name := range strings.FieldsFunc(value, func(r rune) bool { return strings.ContainsRune("、,，/／;；", r) }) {
		if name = strings.TrimSpace(name); name != "" {
			names = append(names, name)
		}
	}
	return names
}

func trimQuotes(value string) string {
	value = strings.TrimSpace(value)
	for _, pair := range [][2]string{{"“", "”"}, {"「", "」"}, {"『", "』"}, {`"`, `"`}} {
		if strings.HasPrefix(value, pair[0]) && strings.HasSuffix(value, pair[1]) && len(value) > len(pair[0])+len(pair[1]) {
			return strings.TrimSpace(value[len(pair[0]) : len(value)-len(pair[1])])
		}
	}
	return value
}
