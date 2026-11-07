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
	// Looks 是角色在不同时期、身份或场合明显不同的其他造型（Appearance 是第一次登场时的造型）。
	Looks BibleLooks `json:"looks"`
}

// BibleLook 是角色的一套造型：FromChapter / ToChapter 是默认适用的原著章节序号（从 1 起，0 表示不限）。
type BibleLook struct {
	Name        string  `json:"name"`
	Appearance  string  `json:"appearance"`
	FromChapter FlexInt `json:"fromChapter"`
	ToChapter   FlexInt `json:"toChapter"`
}

// MaxCharacterLooks 是每个角色最多的造型数（不含角色本身的基础造型）。
const MaxCharacterLooks = 6

// BibleLooks 容忍模型把造型写成非数组或夹杂错误条目：读不懂的部分直接忽略，不让整份作品圣经解析失败。
type BibleLooks []BibleLook

func (l *BibleLooks) UnmarshalJSON(data []byte) error {
	var items []json.RawMessage
	if json.Unmarshal(data, &items) != nil {
		*l = nil
		return nil
	}
	looks := make(BibleLooks, 0, len(items))
	for _, item := range items {
		var look BibleLook
		if json.Unmarshal(item, &look) == nil {
			looks = append(looks, look)
		}
	}
	*l = looks
	return nil
}

// FlexInt 接受数字或数字字符串（模型常把章节序号写成 "21"），其他写法按 0 处理。
type FlexInt int

func (n *FlexInt) UnmarshalJSON(data []byte) error {
	var number float64
	if json.Unmarshal(data, &number) == nil {
		*n = FlexInt(number)
		return nil
	}
	var text string
	if json.Unmarshal(data, &text) == nil {
		if value, err := strconv.Atoi(strings.TrimSpace(text)); err == nil {
			*n = FlexInt(value)
			return nil
		}
	}
	*n = 0
	return nil
}

// LookChoices 是镜头里出镜角色选用的造型：键为角色名（或别名），值为造型名。
// 模型也可能写成 [{"name":"角色","look":"造型"}]，两种写法都接受；读不懂时为空，按本集默认造型。
type LookChoices map[string]string

func (l *LookChoices) UnmarshalJSON(data []byte) error {
	choices := LookChoices{}
	var object map[string]any
	if json.Unmarshal(data, &object) == nil {
		for key, value := range object {
			if text, ok := value.(string); ok && strings.TrimSpace(key) != "" && strings.TrimSpace(text) != "" {
				choices[strings.TrimSpace(key)] = strings.TrimSpace(text)
			}
		}
		*l = choices
		return nil
	}
	var items []struct {
		Name      string `json:"name"`
		Character string `json:"character"`
		Look      string `json:"look"`
	}
	if json.Unmarshal(data, &items) == nil {
		for _, item := range items {
			name := strings.TrimSpace(firstNonEmpty(item.Character, item.Name))
			if name != "" && strings.TrimSpace(item.Look) != "" {
				choices[name] = strings.TrimSpace(item.Look)
			}
		}
	}
	*l = choices
	return nil
}

// IsBaseLookName 判断造型名是否指角色本身的基础造型（模型常写“基础造型”“默认”）。
func IsBaseLookName(name string) bool {
	switch NormalizeName(name) {
	case "", "基础", "基础造型", "默认", "默认造型", "初始造型", "初始", "原始造型", "基础形象", "默认形象", "本体", "无":
		return true
	}
	return false
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
	// Looks 是本镜出镜角色选用的造型（角色名 → 造型名）；没写的角色用本集默认造型。
	Looks LookChoices `json:"looks"`
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
		var recovered bool
		text, recovered = repairBibleJSON(raw)
		if !recovered {
			return bible, err
		}
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
		character.Looks = normalizeBibleLooks(character)
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

// normalizeBibleLooks 排除基础造型的重复副本；性别、年龄前缀不算换装差异。
func normalizeBibleLooks(character BibleCharacter) BibleLooks {
	result := BibleLooks{}
	seen := map[string]bool{}
	appearances := map[string]bool{}
	for _, prefix := range []string{"", character.Gender, character.Age, character.Gender + character.Age} {
		if strings.TrimSpace(character.Appearance) != "" {
			appearances[NormalizeName(prefix+character.Appearance)] = true
		}
	}
	for _, look := range character.Looks {
		look.Name, look.Appearance = strings.TrimSpace(look.Name), strings.TrimSpace(look.Appearance)
		key := NormalizeName(look.Name)
		appearanceKey := NormalizeName(look.Appearance)
		if look.Name == "" || look.Appearance == "" || IsBaseLookName(look.Name) || seen[key] || appearances[appearanceKey] {
			continue
		}
		seen[key] = true
		appearances[appearanceKey] = true
		look.FromChapter, look.ToChapter = max(look.FromChapter, 0), max(look.ToChapter, 0)
		if look.FromChapter > 0 && look.ToChapter > 0 && look.FromChapter > look.ToChapter {
			look.FromChapter, look.ToChapter = look.ToChapter, look.FromChapter
		}
		result = append(result, look)
		if len(result) >= MaxCharacterLooks {
			break
		}
	}
	return result
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

// ScriptCast 是剧本里新出现、设定表还没有的角色、道具、场景或造型，用于即时建档时补全外观与声线。
// Kind 为 look 时 Name 是角色名、Look 是新造型名、Appearance 是这套造型的外观。
type ScriptCast struct {
	Kind       string `json:"kind"`
	Name       string `json:"name"`
	Look       string `json:"look"`
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
		item.Kind, item.Name, item.Look = strings.TrimSpace(item.Kind), strings.TrimSpace(item.Name), strings.TrimSpace(item.Look)
		if item.Name == "" || (item.Kind != "character" && item.Kind != "prop" && item.Kind != "scene" && item.Kind != "look") {
			continue
		}
		item.Appearance, item.Voice = strings.TrimSpace(item.Appearance), strings.TrimSpace(item.Voice)
		// 新造型必须有造型名与外观，否则建出来的参考图没有依据。
		if item.Kind == "look" && (item.Look == "" || IsBaseLookName(item.Look) || item.Appearance == "") {
			continue
		}
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
