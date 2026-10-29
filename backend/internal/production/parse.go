package production

import (
	"encoding/json"
	"errors"
	"strconv"
	"strings"
)

type BibleCharacter struct {
	Name        string   `json:"name"`
	Aliases     []string `json:"aliases"`
	Role        string   `json:"role"`
	Gender      string   `json:"gender"`
	Age         string   `json:"age"`
	Description string   `json:"description"`
	Appearance  string   `json:"appearance"`
	Voice       string   `json:"voice"`
}

// BibleProp 是反复出现、需要保持外观一致的关键道具（法器、信物、兵器等）。
type BibleProp struct {
	Name        string `json:"name"`
	Description string `json:"description"`
	Appearance  string `json:"appearance"`
}
type BibleScene struct {
	Name        string `json:"name"`
	Description string `json:"description"`
	Appearance  string `json:"appearance"`
}

type Bible struct {
	Logline     string           `json:"logline"`
	Tone        string           `json:"tone"`
	VisualRules string           `json:"visualRules"`
	Characters  []BibleCharacter `json:"characters"`
	Props       []BibleProp      `json:"props"`
	Scenes      []BibleScene     `json:"scenes"`
}

type PlannedEpisode struct {
	Title       string `json:"title"`
	Chapters    []int  `json:"chapters"`
	Synopsis    string `json:"synopsis"`
	Hook        string `json:"hook"`
	Cliffhanger string `json:"cliffhanger"`
}

type ScriptShot struct {
	Scene           string   `json:"scene"`
	Characters      []string `json:"characters"`
	Props           []string `json:"props"`
	Speaker         string   `json:"speaker"`
	Dialogue        string   `json:"dialogue"`
	Action          string   `json:"action"`
	ShotSize        string   `json:"shotSize"`
	Camera          string   `json:"camera"`
	DurationSeconds float64  `json:"durationSeconds"`
	ImagePrompt     string   `json:"imagePrompt"`
	VideoPrompt     string   `json:"videoPrompt"`
	SourceQuote     string   `json:"sourceQuote"`
	Transition      string   `json:"transition"`
}

// MaxScriptShots 是单集镜头数上限；长集（如 10 分钟）按 3 秒一镜也在范围内。
const MaxScriptShots = 240

var ErrNoJSON = errors.New("模型没有返回可解析的 JSON")

// ExtractJSONObject 容忍模型在 JSON 前后附带代码块或说明文字。
func ExtractJSONObject(raw string) (string, error) {
	text := strings.TrimSpace(raw)
	text = strings.TrimPrefix(text, "```json")
	text = strings.TrimPrefix(text, "```")
	text = strings.TrimSuffix(text, "```")
	start := strings.Index(text, "{")
	end := strings.LastIndex(text, "}")
	if start < 0 || end <= start {
		return "", ErrNoJSON
	}
	candidate := text[start : end+1]
	if !json.Valid([]byte(candidate)) {
		return "", ErrNoJSON
	}
	return candidate, nil
}

func ParseBible(raw string) (Bible, error) {
	var bible Bible
	text, err := ExtractJSONObject(raw)
	if err != nil {
		return bible, err
	}
	if err := json.Unmarshal([]byte(text), &bible); err != nil {
		return bible, err
	}
	seen := map[string]bool{}
	characters := bible.Characters[:0]
	for _, character := range bible.Characters {
		character.Name = strings.TrimSpace(character.Name)
		key := NormalizeName(character.Name)
		if key == "" || seen[key] {
			continue
		}
		seen[key] = true
		characters = append(characters, character)
		if len(characters) >= 24 {
			break
		}
	}
	bible.Characters = characters
	sceneSeen := map[string]bool{}
	scenes := bible.Scenes[:0]
	for _, scene := range bible.Scenes {
		scene.Name = strings.TrimSpace(scene.Name)
		key := NormalizeName(scene.Name)
		if key == "" || sceneSeen[key] {
			continue
		}
		sceneSeen[key] = true
		scenes = append(scenes, scene)
		if len(scenes) >= 16 {
			break
		}
	}
	bible.Scenes = scenes
	propSeen := map[string]bool{}
	props := bible.Props[:0]
	for _, prop := range bible.Props {
		prop.Name = strings.TrimSpace(prop.Name)
		key := NormalizeName(prop.Name)
		if key == "" || propSeen[key] {
			continue
		}
		propSeen[key] = true
		props = append(props, prop)
		if len(props) >= 20 {
			break
		}
	}
	bible.Props = props
	if len(bible.Characters) == 0 {
		return bible, errors.New("作品圣经没有识别到角色")
	}
	return bible, nil
}

// ParsePlan 只接受本批章节内的序号，并补齐模型漏掉的章节，保证原文全部被覆盖。
func ParsePlan(raw string, batch []Chapter) ([]PlannedEpisode, error) {
	text, err := ExtractJSONObject(raw)
	if err != nil {
		return nil, err
	}
	var payload struct {
		Episodes []struct {
			Title       string `json:"title"`
			Chapters    []any  `json:"chapters"`
			Synopsis    string `json:"synopsis"`
			Hook        string `json:"hook"`
			Cliffhanger string `json:"cliffhanger"`
		} `json:"episodes"`
	}
	if err := json.Unmarshal([]byte(text), &payload); err != nil {
		return nil, err
	}
	allowed := map[int]bool{}
	for _, chapter := range batch {
		allowed[chapter.Index] = true
	}
	covered := map[int]bool{}
	episodes := make([]PlannedEpisode, 0, len(payload.Episodes))
	for _, item := range payload.Episodes {
		episode := PlannedEpisode{Title: strings.TrimSpace(item.Title), Synopsis: strings.TrimSpace(item.Synopsis), Hook: strings.TrimSpace(item.Hook), Cliffhanger: strings.TrimSpace(item.Cliffhanger)}
		for _, value := range item.Chapters {
			index, ok := anyInt(value)
			if ok && allowed[index] && !containsInt(episode.Chapters, index) {
				episode.Chapters = append(episode.Chapters, index)
				covered[index] = true
			}
		}
		if len(episode.Chapters) == 0 || episode.Synopsis == "" {
			continue
		}
		if episode.Title == "" {
			episode.Title = truncateRunes(episode.Synopsis, 10)
		}
		episodes = append(episodes, episode)
	}
	for _, chapter := range batch {
		if covered[chapter.Index] {
			continue
		}
		episodes = append(episodes, PlannedEpisode{Title: chapter.Title, Chapters: []int{chapter.Index}, Synopsis: truncateRunes(strings.TrimSpace(chapter.Text), 120)})
	}
	if len(episodes) == 0 {
		return nil, errors.New("分集规划为空")
	}
	return episodes, nil
}

func ParseScript(raw string) ([]ScriptShot, error) {
	text, err := ExtractJSONObject(raw)
	if err != nil {
		return nil, err
	}
	var payload struct {
		Shots []ScriptShot `json:"shots"`
	}
	if err := json.Unmarshal([]byte(text), &payload); err != nil {
		return nil, err
	}
	return normalizeScriptShots(payload.Shots)
}

// normalizeScriptShots 清理镜头字段。只有台词的镜头必须保留，否则台词会被静默丢掉。
func normalizeScriptShots(items []ScriptShot) ([]ScriptShot, error) {
	shots := make([]ScriptShot, 0, len(items))
	for _, shot := range items {
		shot.ImagePrompt = strings.TrimSpace(shot.ImagePrompt)
		shot.Action = strings.TrimSpace(shot.Action)
		shot.Dialogue = strings.TrimSpace(shot.Dialogue)
		shot.Speaker = strings.TrimSpace(shot.Speaker)
		if shot.ImagePrompt == "" && shot.Action == "" && shot.Dialogue == "" {
			continue
		}
		if shot.Action == "" && shot.ImagePrompt == "" {
			shot.Action = firstNonEmpty(shot.Speaker, "人物") + "说话"
		}
		if shot.ImagePrompt == "" {
			shot.ImagePrompt = shot.Action
		}
		if shot.Dialogue == "" {
			shot.Speaker = ""
		}
		shots = append(shots, shot)
		if len(shots) >= MaxScriptShots {
			break
		}
	}
	if len(shots) == 0 {
		return nil, errors.New("分镜脚本没有可用镜头")
	}
	return shots, nil
}

// ScriptCast 是剧本里新出现、设定表还没有的角色、道具或场景，用于即时建档时补全外观与声线。
type ScriptCast struct {
	Kind       string `json:"kind"`
	Name       string `json:"name"`
	Appearance string `json:"appearance"`
	Voice      string `json:"voice"`
}

// ScriptEpisode 是逐集追加的集在剧本阶段补写的梗概、钩子与悬念。
type ScriptEpisode struct {
	Synopsis    string `json:"synopsis"`
	Hook        string `json:"hook"`
	Cliffhanger string `json:"cliffhanger"`
}

// ParseScriptEpisode 读取剧本返回的本集梗概；没有时返回零值。
func ParseScriptEpisode(raw string) ScriptEpisode {
	text, err := ExtractJSONObject(raw)
	if err != nil {
		return ScriptEpisode{}
	}
	var payload struct {
		Episode ScriptEpisode `json:"episode"`
	}
	_ = json.Unmarshal([]byte(text), &payload)
	return ScriptEpisode{Synopsis: strings.TrimSpace(payload.Episode.Synopsis), Hook: strings.TrimSpace(payload.Episode.Hook), Cliffhanger: strings.TrimSpace(payload.Episode.Cliffhanger)}
}

// ParseScriptCast 读取剧本返回的新设定；字段缺失或格式不对时返回空，不影响镜头解析。
func ParseScriptCast(raw string) []ScriptCast {
	text, err := ExtractJSONObject(raw)
	if err != nil {
		return nil
	}
	var payload struct {
		Cast []ScriptCast `json:"cast"`
	}
	if json.Unmarshal([]byte(text), &payload) != nil {
		return nil
	}
	result := make([]ScriptCast, 0, len(payload.Cast))
	for _, item := range payload.Cast {
		item.Kind, item.Name = strings.TrimSpace(item.Kind), strings.TrimSpace(item.Name)
		if item.Name == "" || (item.Kind != "character" && item.Kind != "prop" && item.Kind != "scene") {
			continue
		}
		item.Appearance, item.Voice = strings.TrimSpace(item.Appearance), strings.TrimSpace(item.Voice)
		result = append(result, item)
	}
	return result
}

func anyInt(value any) (int, bool) {
	switch v := value.(type) {
	case float64:
		return int(v), true
	case string:
		n, err := strconv.Atoi(strings.TrimSpace(v))
		return n, err == nil
	}
	return 0, false
}

func containsInt(values []int, target int) bool {
	for _, value := range values {
		if value == target {
			return true
		}
	}
	return false
}
