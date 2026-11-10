// Package production 承载短剧自动制作的纯逻辑：提示词编译、模型输出解析、
// 时长对齐和角色归并。它不访问数据库、不调用模型，便于独立测试；
// 调度与持久化由 internal/app 的组合根完成。
package production

import (
	"fmt"
	"strings"
	"unicode/utf8"
)

// Chapter 是小说原文的一章，只作为改编来源。
type Chapter struct {
	ID    string
	Index int
	Title string
	Text  string
}

// Settings 是作品级制作意图；模型与审阅模式由服务端解析为具体执行参数。
type Settings struct {
	AspectRatio    string `json:"aspectRatio"`
	EpisodeSeconds int    `json:"episodeSeconds"`
	StylePrompt    string `json:"stylePrompt"`
	StyleName      string `json:"styleName"`
	Language       string `json:"language"`
	// Assets 是角色/场景参考图方案与约束提示词，开工前选定，之后可在设置里修改。
	Assets AssetSettings `json:"assets"`
	// Storyboard 是分镜规则：镜头时长、节奏与转场。
	Storyboard StoryboardSettings `json:"storyboard"`
}

// MaxEpisodeSeconds 是单集时长上限（20 分钟）；更长的内容应拆成多集。
const MaxEpisodeSeconds = 1200

// AspectRatios 是作品可选的画幅，第一个是未填写时的默认值。
var AspectRatios = []string{"9:16", "16:9", "1:1", "3:4", "4:3"}

// ValidAspectRatio 判断是否是作品可选的画幅；入口处校验，不把未知值悄悄改成默认画幅。
func ValidAspectRatio(ratio string) bool {
	for _, value := range AspectRatios {
		if value == ratio {
			return true
		}
	}
	return false
}

func (s Settings) Normalized() Settings {
	s.Assets = s.Assets.Normalized()
	s.Storyboard = s.Storyboard.Normalized()
	if s.AspectRatio == "" {
		s.AspectRatio = AspectRatios[0]
	}
	if s.EpisodeSeconds <= 0 {
		s.EpisodeSeconds = 90
	}
	if s.EpisodeSeconds < 30 {
		s.EpisodeSeconds = 30
	}
	if s.EpisodeSeconds > MaxEpisodeSeconds {
		s.EpisodeSeconds = MaxEpisodeSeconds
	}
	if s.Language == "" {
		s.Language = "中文普通话"
	}
	// 风格基线会拼进每一次生图提示词，过长会挤占镜头本身的描述。
	s.StylePrompt = truncateRunes(strings.TrimSpace(s.StylePrompt), 1200)
	s.StyleName = truncateRunes(strings.TrimSpace(s.StyleName), 60)
	s.Language = truncateRunes(strings.TrimSpace(s.Language), 30)
	return s
}

const jsonOnly = "只输出一个 JSON 对象，不要 Markdown 代码块，不要解释。"

// BibleSystemPrompt 约束全书设定建档的输出结构。
func BibleSystemPrompt() string {
	return "你是资深短剧总编剧与美术指导。你阅读网络小说，为改编竖屏短剧建立“作品圣经”。" + jsonOnly
}

// structuredSkillBlock 把写作技能交给输出 JSON 的步骤：技能决定取舍、粒度与写法，输出结构仍以本步骤的 JSON 为准，
// 否则后续解析会失败。
func structuredSkillBlock(step string, skill *WritingSkill) string {
	if skill == nil || strings.TrimSpace(skill.Content) == "" {
		return ""
	}
	return fmt.Sprintf("【写作技能：%s】\n下面是%s必须遵循的方法与标准（来自技能文件 %s）。按技能决定取舍、粒度与写法；输出仍然只能是下面要求的 JSON，字段名与结构不变，技能与 JSON 结构冲突时以 JSON 结构为准，技能里要求的其他输出格式不要输出。\n<skill>\n%s\n</skill>\n\n", skill.Name, step, skill.Path, truncateRunes(strings.TrimSpace(skill.Content), MaxWritingSkillRunes))
}

// BiblePrompt 基于抽样后的全书文本建立角色、场景与整体风格；skill 不为空时按技能的方法提取。
func BiblePrompt(title string, settings Settings, chapters []Chapter, maxChars int, skill *WritingSkill) string {
	settings = settings.Normalized()
	var b strings.Builder
	fmt.Fprintf(&b, "作品：%s\n画幅：%s\n视觉风格：%s\n对白语言：%s\n章节总数：%d\n\n", title, settings.AspectRatio, firstNonEmpty(settings.StylePrompt, "写实电影感"), settings.Language, len(chapters))
	b.WriteString(structuredSkillBlock("提取角色、道具与场景", skill))
	b.WriteString("请输出：\n")
	b.WriteString(`{"logline":"一句话卖点","tone":"整体基调","visualRules":"统一的画面规则（色调/光线/服化道年代）",` +
		`"characters":[{"name":"标准名","aliases":["别名/称呼"],"role":"主角/反派/配角","gender":"男/女","age":"年龄段",` +
		`"description":"性格与身份","appearance":"第一次登场时可直接用于生图的外貌、发型、服装描述（中文，40-80字）","voice":"音色、语速与说话方式",` +
		`"looks":[]}],` +
		`"props":[{"name":"道具名","description":"用途与归属","appearance":"可直接用于生图的外形、材质、颜色描述"}],` +
		`"scenes":[{"name":"场景名","description":"用途","appearance":"可直接用于生图的环境描述"}]}` + "\n")
	b.WriteString("要求：角色按重要性排序，最多 24 个，只保留会在镜头中出现的人物；同一人物的不同称呼必须合并到 aliases；道具最多 20 个，只保留反复出现或推动剧情的关键物件；场景最多 16 个，只保留反复出现的地点。\n")
	fmt.Fprintf(&b, "造型：同一角色在不同时期、身份或场合的服装与妆造明显不同时（如修仙者从散修到外门弟子、内门弟子、长老；都市人物的学生时代、刚工作、成为总裁），appearance 写第一次登场的造型，其余造型按时间顺序写进 looks，每个角色最多 %d 套；同一人物的五官、脸型与体态在各套造型里保持一致，只写服装、发型与妆容的变化。fromChapter / toChapter 用原文抽样里方括号中的章节序号，不确定的一端写 0；造型没有明显变化的角色 looks 给空数组。\n\n", MaxCharacterLooks)
	b.WriteString("角色本体的 appearance 已是基础造型，禁止为了填充 looks 再建一套默认、初始、首次登场或与基础外观相同的造型；没有原文明示的换装依据时 looks 必须为 []。\n\n")
	b.WriteString("只有确有额外换装时，looks 中才加入这样的对象：{\"name\":\"夜行装\",\"appearance\":\"这套造型的外貌、发型、服装与妆容\",\"fromChapter\":0,\"toChapter\":0}。章节序号必须是数字。characters、props、scenes 的每个条目都必须是独立的完整对象；所有条目结束后再闭合数组。每个字段名与字符串值必须分别用双引号包围，字段之间用逗号分隔。输出前检查整份 JSON 的括号和引号成对。\n\n")
	b.WriteString("【小说原文抽样】\n")
	b.WriteString(SampleNovel(chapters, maxChars))
	return b.String()
}

// SampleNovel 把长篇小说压缩到预算内：前段完整保留（人物多在开篇登场），
// 其余章节按均匀间隔截取开头，保证后期新角色和地点也能被看到。
func SampleNovel(chapters []Chapter, maxChars int) string {
	if maxChars <= 0 {
		maxChars = 40000
	}
	headBudget := maxChars * 3 / 4
	var b strings.Builder
	used := 0
	next := 0
	for ; next < len(chapters) && used < headBudget; next++ {
		chunk := chapterHeading(chapters[next], "") + chapters[next].Text + "\n\n"
		if remaining := headBudget - used; utf8.RuneCountInString(chunk) > remaining {
			chunk = truncateRunes(chunk, remaining) + "\n\n"
		}
		b.WriteString(chunk)
		used += utf8.RuneCountInString(chunk)
	}
	rest := chapters[next:]
	if len(rest) == 0 {
		return b.String()
	}
	tailBudget := maxChars - used
	samples := 12
	if len(rest) < samples {
		samples = len(rest)
	}
	per := tailBudget / samples
	if per < 200 {
		return b.String()
	}
	for i := 0; i < samples; i++ {
		chapter := rest[i*len(rest)/samples]
		b.WriteString(chapterHeading(chapter, "（节选）") + truncateRunes(chapter.Text, per) + "\n\n")
	}
	return b.String()
}

// chapterHeading 是抽样里的章节标题，方括号里是原著章节序号，供模型标注造型适用的章节范围。
func chapterHeading(chapter Chapter, suffix string) string {
	if chapter.Index > 0 {
		return fmt.Sprintf("## [%d] %s%s\n", chapter.Index, chapter.Title, suffix)
	}
	return "## " + chapter.Title + suffix + "\n"
}

// LateAssetSystemPrompt 约束后续集补全新设定时的输出结构，字段与作品圣经一致。
func LateAssetSystemPrompt() string {
	return "你是资深短剧总编剧与美术指导。你根据本集原文和分镜，只为名单中尚未写清外貌的新角色、道具与场景补全设定。" + jsonOnly
}

// LateAsset 是后续集里需要补全外貌的已建档名字。
type LateAsset struct {
	Kind string
	Name string
}

// LateAssetPrompt 复用作品圣经的字段定义，只根据本集原文与分镜为指定名单提取外貌、简介与声线。
// 原文没有依据时 appearance 必须留空，避免只凭名字和画风编造形象。
func LateAssetPrompt(title string, settings Settings, assets []LateAsset, chapters []Chapter, shotSummary string, skill *WritingSkill) string {
	settings = settings.Normalized()
	var b strings.Builder
	fmt.Fprintf(&b, "作品：%s\n画幅：%s\n视觉风格：%s\n对白语言：%s\n\n", title, settings.AspectRatio, firstNonEmpty(settings.StylePrompt, "写实电影感"), settings.Language)
	b.WriteString(structuredSkillBlock("提取角色、道具与场景", skill))
	b.WriteString("请只为下面列出的、设定表里尚未写清外貌的新角色/道具/场景补全设定。只根据【本集原文】和【本集分镜】里已有的信息提取；原文没写清外貌或环境时，对应 appearance 必须留空，不要凭名字或身份编造。不要输出名单以外的条目，不要修改已有设定。\n")
	b.WriteString("输出与作品圣经相同字段：\n")
	b.WriteString(`{"characters":[{"name":"标准名","aliases":["别名/称呼"],"role":"主角/反派/配角","gender":"男/女","age":"年龄段","description":"性格与身份","appearance":"可直接用于生图的外貌、发型、服装描述（中文，40-80字；原文未写明则留空）","voice":"音色、语速与说话方式（原文未写明则留空）","looks":[]}],"props":[{"name":"道具名","description":"用途与归属","appearance":"可直接用于生图的外形、材质、颜色描述（原文未写明则留空）"}],"scenes":[{"name":"场景名","description":"用途","appearance":"可直接用于生图的环境描述（原文未写明则留空）"}]}` + "\n")
	b.WriteString("角色本体的 appearance 已是基础造型；只有原文明示换装且外观与基础造型不同，才在 looks 里追加。fromChapter / toChapter 用原文里方括号中的章节序号，不确定的一端写 0。每个字段名与字符串值必须分别用双引号包围。\n\n")
	b.WriteString("【待补全设定】\n")
	if len(assets) == 0 {
		b.WriteString("无\n")
	} else {
		for _, asset := range assets {
			kind := "角色"
			switch asset.Kind {
			case "prop":
				kind = "道具"
			case "scene":
				kind = "场景"
			}
			fmt.Fprintf(&b, "- %s：%s\n", kind, asset.Name)
		}
	}
	b.WriteString("\n【本集原文】\n")
	if len(chapters) == 0 {
		b.WriteString("无\n")
	} else {
		for _, chapter := range chapters {
			b.WriteString(chapterHeading(chapter, "") + truncateRunes(chapter.Text, ScriptSourceChapterRunes) + "\n\n")
		}
	}
	if strings.TrimSpace(shotSummary) != "" {
		b.WriteString("【本集分镜】\n")
		b.WriteString(strings.TrimSpace(shotSummary) + "\n")
	}
	return b.String()
}

func PlanSystemPrompt() string {
	return "你是竖屏短剧分集编剧。你把小说章节改编为节奏紧凑的分集大纲：每集开场 3 秒有钩子，结尾停在悬念。" + jsonOnly
}

// PlanPrompt 规划一批章节对应的分集；章节与集是多对多关系。
func PlanPrompt(title string, settings Settings, bibleSummary string, batch []Chapter, nextEpisode int, previousCliffhanger string) string {
	settings = settings.Normalized()
	var b strings.Builder
	fmt.Fprintf(&b, "作品：%s\n单集时长：约 %d 秒\n下一集编号：%d\n", title, settings.EpisodeSeconds, nextEpisode)
	if previousCliffhanger != "" {
		fmt.Fprintf(&b, "上一集结尾悬念：%s\n", previousCliffhanger)
	}
	b.WriteString("\n【作品圣经摘要】\n" + bibleSummary + "\n\n")
	b.WriteString("请把下面的章节改编为若干集，输出：\n")
	b.WriteString(`{"episodes":[{"title":"集标题（6-12字）","chapters":[章节序号],"synopsis":"本集剧情（80-150字）","hook":"开场钩子","cliffhanger":"结尾悬念"}]}` + "\n")
	b.WriteString("规则：信息密度高的一章可拆成两集；过渡性章节与相邻章节合并；chapters 使用下方方括号里的章节序号；只覆盖本批章节，不要编造后续剧情。\n\n")
	for _, chapter := range batch {
		fmt.Fprintf(&b, "[%d] %s\n%s\n\n", chapter.Index, chapter.Title, truncateRunes(chapter.Text, 6000))
	}
	return b.String()
}

// 单集素材类型：novel 需要改编；script / storyboard 是用户写好的内容，只拆镜或转录。
const (
	SourceNovel      = "novel"
	SourceScript     = "script"
	SourceStoryboard = "storyboard"
)

// NormalizeSourceFormat 把未知或空的素材类型归为小说原文。
func NormalizeSourceFormat(value string) string {
	switch strings.TrimSpace(value) {
	case SourceScript:
		return SourceScript
	case SourceStoryboard:
		return SourceStoryboard
	}
	return SourceNovel
}

// ScriptSourceChapterRunes 是剧本提示词里每章原文的上限；逐集追加的原文不允许超过它，避免被静默截断而丢台词。
const ScriptSourceChapterRunes = 12000

func ScriptSystemPrompt() string {
	return "你是竖屏短剧导演兼分镜师。你把单集素材拆成可直接写成视频提示词的镜头表，只写镜头能拍到的动作。" +
		"台词是作者的原创内容：原文里的每一句台词都必须逐字保留并按原顺序出现，不得改写、润色、缩写、合并或删除，也不得编造原文没有的台词。" + jsonOnly
}

// sourceFormatRules 说明素材类型对拆镜方式的约束。
func sourceFormatRules(format string) string {
	switch NormalizeSourceFormat(format) {
	case SourceScript:
		return "【素材类型】用户已写好的剧本。按剧本顺序逐场逐句拆镜：每一句台词、旁白、画外音都必须出现且一字不改；舞台说明与动作描写转成镜头的 action 和画面。不要增加剧本没有的情节和台词，不要为了钩子或悬念调整顺序。\n"
	case SourceStoryboard:
		return "【素材类型】用户已做好的分镜。原文的每个镜头对应输出一个镜头，顺序和数量保持一致，不合并、不删除、不新增；台词、说话人、动作、景别、运镜、时长、转场按原文转录，原文没写的字段再按画面补全。\n"
	}
	return "【素材类型】小说原文。引号内的对白逐字照搬为台词；叙述和心理描写改成可拍到的动作与表情，确需旁白时用“旁白”逐字摘取原文叙述句，不要自己写旁白。\n"
}

type ScriptContext struct {
	Title         string
	Settings      Settings
	VisualRules   string
	EpisodeNumber int
	EpisodeTitle  string
	Synopsis      string
	Hook          string
	Cliffhanger   string
	CastSummary   string
	PropSummary   string
	// Segment 是剧情段切分约束，由分镜规则与视频模型单次上限共同决定。
	Segment        SegmentLimits
	SceneSummary   string
	SourceChapters []Chapter
	// SourceFormat 是本集素材类型，决定是改编、按剧本拆镜还是转录分镜。
	SourceFormat string
	// Skill 是分镜拆分的写作技能，为空按内置规则。
	Skill *WritingSkill
}

func ScriptPrompt(ctx ScriptContext) string {
	settings := ctx.Settings.Normalized()
	format := NormalizeSourceFormat(ctx.SourceFormat)
	shotTarget := settings.Storyboard.ShotTarget(settings.EpisodeSeconds)
	maxLine := settings.Storyboard.MaxLineRunes()
	var b strings.Builder
	fmt.Fprintf(&b, "作品：%s\n第 %d 集《%s》\n画幅：%s · 单集约 %d 秒 · 对白语言：%s\n视觉风格：%s\n画面规则：%s\n\n", ctx.Title, ctx.EpisodeNumber, ctx.EpisodeTitle, settings.AspectRatio, settings.EpisodeSeconds, settings.Language, firstNonEmpty(settings.StylePrompt, "写实电影感"), firstNonEmpty(ctx.VisualRules, "保持全剧统一"))
	fmt.Fprintf(&b, "本集大纲：%s\n开场钩子：%s\n结尾悬念：%s\n\n", firstNonEmpty(ctx.Synopsis, "以原文为准"), firstNonEmpty(ctx.Hook, "以原文为准"), firstNonEmpty(ctx.Cliffhanger, "以原文为准"))
	b.WriteString(structuredSkillBlock("拆分镜头", ctx.Skill))
	b.WriteString(sourceFormatRules(format))
	b.WriteString("【角色表】（name 必须从这里选；新出现的人物用其原文称呼）\n" + firstNonEmpty(ctx.CastSummary, "无") + "\n")
	b.WriteString("【道具表】（props 从这里选；新出现的关键道具用原文称呼）\n" + firstNonEmpty(ctx.PropSummary, "无") + "\n")
	b.WriteString("【场景表】\n" + firstNonEmpty(ctx.SceneSummary, "无") + "\n\n")
	switch format {
	case SourceStoryboard:
		b.WriteString("镜头数与原分镜一致，输出：\n")
	case SourceScript:
		fmt.Fprintf(&b, "镜头数以完整容纳剧本全部台词为准（参考约 %d 个），输出：\n", shotTarget)
	default:
		fmt.Fprintf(&b, "输出约 %d 个镜头：\n", shotTarget)
	}
	b.WriteString(`{"shots":[{"scene":"场景名","characters":["出镜角色名"],"looks":{"出镜角色名":"本镜造型名（角色表列了造型的角色才写）"},"props":["画面中出现的关键道具名"],"speaker":"说话人（旁白写“旁白”，无台词留空）",` +
		`"dialogue":"本镜台词，逐字摘自原文（无则空）","action":"画面里发生的动作","shotSize":"特写/近景/中景/全景/远景",` +
		`"camera":"固定/推/拉/摇/跟/环绕","durationSeconds":4,"transition":"cut/fadeblack/fadewhite","imagePrompt":"本镜起幅画面：人物站位与朝向、动作、表情、构图、光线、环境",` +
		`"videoPrompt":"本镜头时长内的动作与镜头运动描述，按时间顺序写清起止","sourceQuote":"对应原文的一小句"}],` +
		`"cast":[{"kind":"character/prop/scene/look","name":"上面三张表里没有、本集新出现的角色/道具/场景（kind=look 时写角色名）","look":"kind=look 时写新造型名","appearance":"可直接用于生图的外貌服装或外形环境描述（原文未写明的按身份合理补全）","voice":"角色的音色与说话方式（道具、场景、造型留空）"}]}` + "\n")
	b.WriteString("造型规则：角色表里列了造型的角色，每个镜头在 looks 里写明本镜用哪套造型（值是该角色的造型名或“基础造型”）；没写的用标着“本集默认”的造型，没有默认就用基础造型。剧情里换装、回忆、伪装或时间跳跃时按原文换造型；角色本集换上了表里没有的新造型时，在 cast 里用 kind=look 列出（name 写角色名，look 写造型名，appearance 写这套造型完整的外貌、发型、服装与妆容）。\n")
	b.WriteString("基础造型直接使用角色本体；只有原文明示换装且外观与基础造型不同，才允许在 cast 里新增 kind=look，禁止重复创建默认或首次登场造型。\n")
	b.WriteString(settings.Storyboard.PromptRules(settings.EpisodeSeconds, ctx.Segment))
	fmt.Fprintf(&b, "台词规则：每个镜头最多一句台词；一句台词超过 %d 字时，在原文标点处拆到同一说话人的连续镜头里，拆开后按顺序拼起来必须与原文一字不差；对话用正反打拆成多个镜头。\n", maxLine)
	if format == SourceNovel {
		b.WriteString("结构：第一个镜头就是钩子，最后一个镜头停在悬念，只调整镜头取舍与顺序，不改台词。\n")
	} else {
		b.WriteString("结构：保持原文的剧情顺序，不为钩子或悬念改动内容。\n")
	}
	b.WriteString("imagePrompt 中用角色名、道具名指代，不要重复外貌描述；cast 只列表里没有的新设定，没有则给空数组。\n")
	if strings.TrimSpace(ctx.Synopsis) == "" {
		b.WriteString(`本集还没有梗概：在 JSON 顶层另给 "episode":{"synopsis":"本集剧情梗概（80-150字）","hook":"开场钩子","cliffhanger":"结尾悬念"}，按原文概括。` + "\n")
	}
	b.WriteString("\n")
	b.WriteString("【对应原文】\n")
	for _, chapter := range ctx.SourceChapters {
		b.WriteString("## " + chapter.Title + "\n" + truncateRunes(chapter.Text, ScriptSourceChapterRunes) + "\n\n")
	}
	return b.String()
}

// CastImagePrompt 按作品的参考图方案渲染角色或场景参考图提示词，作为后续镜头的身份锚点。
func CastImagePrompt(assets AssetSettings, kind, name, appearance, stylePrompt, visualRules string) string {
	assets = assets.Normalized()
	style := firstNonEmpty(stylePrompt, "写实电影感")
	if kind == "prop" {
		return renderAssetTemplate(propPrompt, map[string]string{"道具名称": name, "道具设定": appearance, "项目画风": style, "画面规则": visualRules})
	}
	if kind == "scene" {
		return renderAssetTemplate(assets.ScenePrompt, map[string]string{"场景名称": name, "场景设定": appearance, "项目画风": style, "画面规则": visualRules})
	}
	return renderAssetTemplate(assets.CharacterPrompt, map[string]string{"角色名称": name, "角色设定": appearance, "项目画风": style, "画面规则": visualRules})
}

func truncateRunes(value string, limit int) string {
	if limit <= 0 {
		return ""
	}
	if utf8.RuneCountInString(value) <= limit {
		return value
	}
	runes := []rune(value)
	return string(runes[:limit])
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return strings.TrimSpace(value)
		}
	}
	return ""
}
