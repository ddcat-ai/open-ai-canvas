package production

import (
	"regexp"
	"strings"
	"unicode"
)

// 台词核对：从原文提取应当逐字保留的台词，再与镜头台词逐句比对，找出被删掉或改写的台词。
// 只比较文字与数字，忽略标点、空白和镜头间的拆分，所以按标点拆到多个镜头的长句仍算保留。

var storyboardMetaKeys = map[string]bool{
	"场景": true, "场": true, "场次": true, "时间": true, "地点": true, "人物": true, "角色": true, "出场": true, "出场人物": true,
	"景别": true, "运镜": true, "镜头": true, "镜号": true, "画面": true, "动作": true, "时长": true, "备注": true, "字幕": true,
	"音效": true, "音乐": true, "bgm": true, "转场": true, "道具": true, "服装": true, "环境": true, "光线": true, "内景": true,
	"外景": true, "标题": true, "梗概": true, "简介": true, "剧情": true, "钩子": true, "悬念": true, "主题": true, "机位": true,
	"构图": true, "特效": true, "提示词": true, "说明": true, "注": true, "集数": true, "本集": true, "第一幕": true, "幕": true,
}

func isStoryboardMetaKey(name string) bool {
	key := strings.ToLower(strings.TrimSpace(name))
	if storyboardMetaKeys[key] {
		return true
	}
	// “第3场”“第1集”“镜头5”这类编号标题不是说话人。
	return strings.HasPrefix(key, "第") || strings.HasPrefix(key, "镜头") || strings.HasPrefix(key, "场景")
}

var (
	parenthetical = regexp.MustCompile(`（[^）]*）|\([^)]*\)`)
	listMarker    = regexp.MustCompile(`^\s*(?:[-*•△▲]+|\d+[.、)）])\s*`)
)

// dialogueKey 只保留文字与数字，用于忽略标点和拆分差异的比较。
func dialogueKey(value string) string {
	var b strings.Builder
	for _, r := range strings.ToLower(value) {
		if unicode.IsLetter(r) || unicode.IsNumber(r) {
			b.WriteRune(r)
		}
	}
	return b.String()
}

var quotePairs = map[rune]rune{'“': '”', '「': '」', '『': '』', '"': '"'}

// quotedLines 返回引号内的话。不足 4 个字且不带句读的引号多是专有名词或强调（所谓的“天才”），不算台词。
func quotedLines(text string) []string {
	lines := []string{}
	runes := []rune(text)
	for i := 0; i < len(runes); i++ {
		closing, ok := quotePairs[runes[i]]
		if !ok {
			continue
		}
		end := -1
		for j := i + 1; j < len(runes) && j-i < 600; j++ {
			if runes[j] == closing {
				end = j
				break
			}
		}
		if end < 0 {
			continue
		}
		content := strings.TrimSpace(string(runes[i+1 : end]))
		i = end
		key := dialogueKey(content)
		if len([]rune(key)) < 2 {
			continue
		}
		if len([]rune(key)) < 4 && !strings.ContainsAny(content, "，。！？…!?,~～、；") {
			continue
		}
		lines = append(lines, content)
	}
	return lines
}

// speakerLines 识别剧本里“角色：台词”或“角色（冷笑）：台词”的行。
func speakerLines(text string) []string {
	lines := []string{}
	for _, raw := range strings.Split(text, "\n") {
		line := listMarker.ReplaceAllString(strings.TrimSpace(raw), "")
		match := speakerPrefix.FindStringSubmatch(line)
		if match == nil || isStoryboardMetaKey(match[1]) {
			continue
		}
		content := strings.TrimSpace(parenthetical.ReplaceAllString(match[2], ""))
		content = trimQuotes(content)
		if len([]rune(dialogueKey(content))) >= 2 {
			lines = append(lines, content)
		}
	}
	return lines
}

// SourceDialogueLines 从一集原文提取应逐字保留的台词，按出现顺序去重。
// 小说只认引号内的对白；剧本与分镜另外识别“角色：台词”行；能直接解析的分镜表以台词列为准。
func SourceDialogueLines(text string, format string) []string {
	format = NormalizeSourceFormat(format)
	candidates := []string{}
	if format == SourceStoryboard {
		if shots, ok := ParseStoryboardSource(text); ok {
			for _, shot := range shots {
				if shot.Dialogue != "" {
					candidates = append(candidates, shot.Dialogue)
				}
			}
			return uniqueDialogue(candidates)
		}
	}
	if format != SourceNovel {
		candidates = append(candidates, speakerLines(text)...)
	}
	candidates = append(candidates, quotedLines(text)...)
	return uniqueDialogue(candidates)
}

func uniqueDialogue(lines []string) []string {
	seen := map[string]bool{}
	result := []string{}
	for _, line := range lines {
		key := dialogueKey(line)
		if key == "" || seen[key] {
			continue
		}
		// 被更长的台词完整包含的片段（如剧本行内又带引号）不重复计数。
		contained := false
		for _, other := range result {
			if strings.Contains(dialogueKey(other), key) {
				contained = true
				break
			}
		}
		if contained {
			continue
		}
		seen[key] = true
		result = append(result, line)
	}
	return result
}

// MissingDialogue 返回没有在镜头台词里逐字出现的原文台词。镜头台词按顺序拼接后比较，长句拆镜不算缺失。
func MissingDialogue(sourceLines []string, shotDialogues []string) []string {
	var joined strings.Builder
	for _, line := range shotDialogues {
		joined.WriteString(dialogueKey(line))
	}
	all := joined.String()
	missing := []string{}
	for _, line := range sourceLines {
		if key := dialogueKey(line); key != "" && !strings.Contains(all, key) {
			missing = append(missing, line)
		}
	}
	return missing
}
