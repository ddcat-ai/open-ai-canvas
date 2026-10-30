package production

import (
	"fmt"
	"regexp"
	"strconv"
	"strings"
)

// SegmentWriterSystemPrompt 让文本模型把一个剧情段写成可直接投喂多镜头视频模型的完整视频提示词。
func SegmentWriterSystemPrompt() string {
	return "你是 AI 短剧的分镜导演兼表演指导，专门为多镜头视频生成模型撰写整段视频提示词。" +
		"你写的提示词会被原样发送给视频模型，所以必须具体到站位、朝向、表情与表演、台词的语气、手部与道具归属、运镜和每个时间片的动作，" +
		"禁止空泛形容。人物要像在演戏而不是摆拍，台词要像在说话而不是朗读。只输出提示词正文，不要任何解释、标题前缀或代码块。"
}

// WritingSkill 是用户选定的视频提示词写作技能：技能文件全文作为写作方法交给文本模型。
type WritingSkill struct {
	Name    string
	Path    string
	Content string
}

// MaxWritingSkillRunes 是写进撰写提示词的技能正文上限，超出部分截断。
const MaxWritingSkillRunes = 16000

// SegmentWriterPrompt 给出写作格式与本段素材。draft 是按镜头表机械整理的素材稿，时间码与台词以它为准。
// skill 不为空时按技能的方法与结构撰写，硬性规则仍然适用。
func SegmentWriterPrompt(in SegmentPromptInput, draft string, previousEnding string, skill *WritingSkill) string {
	var total int64
	for _, shot := range in.Shots {
		total += shot.DurationMs
	}
	var b strings.Builder
	fmt.Fprintf(&b, "请为第 %d 段（全集共 %d 段）撰写完整视频提示词。本段 %s 秒，%d 个镜头。\n\n", in.Index+1, in.Count, secondsText(total), len(in.Shots))
	if in.MaxChars > 0 {
		fmt.Fprintf(&b, "【篇幅】全文不超过 %d 个字符（含标点、空格与换行）。这是视频模型的硬上限，超出会被拒绝；宁可写短，不要写满。\n\n", in.MaxChars)
	}
	if skill != nil {
		fmt.Fprintf(&b, "【写作技能：%s】\n下面是你必须遵循的视频提示词写作方法（来自技能文件 %s）。技能规定了结构、栏目或写法时，按技能输出，下方【输出格式】只作补充；【篇幅】与【硬性规则】始终适用。\n<skill>\n%s\n</skill>\n\n", skill.Name, skill.Path, truncateRunes(strings.TrimSpace(skill.Content), MaxWritingSkillRunes))
	}
	fmt.Fprintf(&b, "【表演与运镜】\n%s\n%s\n禁止：面无表情、表情僵硬、眼神呆滞、只动嘴不动脸、朗读腔或播音腔、人物像摆拍一样站着不动。\n\n", PerformanceRule(in.Performance), CameraMotionRule(in.CameraMotion))
	b.WriteString(`【输出格式】严格按以下结构与顺序书写，栏目名原样保留：
`)
	if in.Index > 0 && in.Independent {
		fmt.Fprintf(&b, "本段与其他段并行独立生成（不附带第%d段画面）：开场站位、朝向、服装道具状态与上一段结尾保持一致，但不写“定格”“接续”之类依赖上一段画面的描述\n", in.Index)
	} else if in.Index > 0 {
		fmt.Fprintf(&b, "严格从第%d段视频末尾的实际站位、朝向、动作和情绪状态继续，不重新摆位\n", in.Index)
	}
	fmt.Fprintf(&b, `第%d段视频《段名·点题副标题》——一句话概括本段的戏剧转折
%s秒｜%s｜%s｜%s对白｜无字幕｜%d个主镜头

【视觉与首帧】
%s；渲染质感与画风用一两句概括，不要重复上面的风格全文；本段前段、中段、末尾的情绪与视觉变化；明确禁止项一句带过（无额外滤镜噪点、无游戏 UI、无字幕水印、无全屏闪白等）。

【场景布局、人物站位与机位轴线】
空间锁定（场景名并标注参考图编号）；主戏剧轴线方向与画面左右关系；人物在本段内从哪走到哪；不越轴、不穿模。

【角色、手部、衣物和道具归属】
每个出场角色一行：姓名（参考图编号）+ 一句识别特征 + 本段的情绪状态与变化；外貌服装以参考图为准，不要复述完整外貌。道具（参考图编号）写清在谁的哪只手。

【道具与物理时空规则】
只写本段关键道具、特效与物理现象及发生的时间码；没有就写一句本段的动作约束。

【光源与声音】
光源一句；“声线规格”逐个写说话角色的音色，以及本段情绪下的说话方式（音量、语速、气息）；环境音与关键音效标注时间码。

然后每个镜头一块，镜头之间空一行：
【起—止秒｜镜头一：四字镜头名·点题】
焦段 + 景别，运镜方式（方向、速度与动机）。
起—止：按 2–3 秒切成时间片，逐片写清动作、面部表情变化（眼神、眉、嘴角、呼吸）、肢体反应与镜头运动。
角色名（此刻的情绪 + 说话方式，例如压低声音咬着字、声音发颤、冷笑着拖长尾音）：“台词”
台词前写说话人开口前的表情反应，说完写听者的反应；台词后“留%s秒气口”已计入时长，开口前的情绪停顿也要落在本镜头时长内，台词不能溢出镜头。每个镜头写动作音或环境音。
`, in.Index+1, secondsText(total), firstNonEmpty(in.AspectRatio, "9:16"), firstNonEmpty(in.Style, "写实电影感"), firstNonEmpty(in.Language, "中文"), len(in.Shots), firstFrameRule(in), in.pauseText())
	// 尾帧续接时末尾只收势不凝固：整段凝固会在成片的每个段落衔接处留下静止画面。并行出片时下一段不取本段尾帧，不需要收势。
	if in.Index < in.Count-1 && !in.Independent {
		fmt.Fprintf(&b, "最后一个镜头的末0.5秒动作收住、镜头停稳，写清此刻每个人物的位置、朝向和情绪状态，作为第%d段的接续起点；人物保留呼吸、眨眼等细微动态，不要写“全场凝固”“完全静止”“硬定格”。\n", in.Index+2)
	}
	b.WriteString(`
【硬性规则】
1. 时间码精确到 0.01 秒，从 00.00 连续覆盖到本段结束，每个镜头的起止与素材稿完全一致，不得增删镜头。
2. 台词逐字使用素材稿中的台词，不得改写、增加或删减；没有台词的镜头写“绝对无台词”。
3. 只使用素材稿中的角色、道具与场景，每个角色、道具与场景首次出现时都写“名称（参考图N）”，编号严格使用素材稿给出的编号，写法固定为“参考图N”（不要写成“@参考图N”“图N”“Image N”或其他编号），素材稿没有编号的不要编造编号；外貌以参考图为准，不要编造与设定冲突的外貌。
4. 对白由视频模型直接生成声音与口型：每句台词标明说话人此刻的情绪与说话方式（音量、语速、重音、停顿、气息），并写出说话时的面部表情；要像人物在戏里说话，不要朗读腔；不要另写配音或字幕要求。
5. 每个镜头的动作必须是镜头能拍到的可见动作，内心活动改写为表情、眼神和肢体反应；每个时间片都要有人在动（表情、视线、手、重心或走位），不要出现人物静止不动的时间片。
6. 直接输出提示词正文，格式说明里的括号与描述性文字不要输出。
`)
	if in.MaxChars > 0 {
		fmt.Fprintf(&b, "7. 全文不超过 %d 个字符。写不下时依次删减：重复的画风与禁止项、与镜头块重复的站位和服装描述、堆叠的修饰词；镜头块、时间码、台词、参考图编号与表演描写不能删。\n", in.MaxChars)
	}
	b.WriteString("\n")
	if strings.TrimSpace(previousEnding) != "" {
		b.WriteString("【上一段结尾】\n" + strings.TrimSpace(previousEnding) + "\n\n")
	}
	b.WriteString("【本段素材稿】\n" + draft + "\n")
	return b.String()
}

// SegmentCondenseSystemPrompt 让文本模型把超长的段视频提示词精简到视频模型的上限内，不改变内容结构。
func SegmentCondenseSystemPrompt() string {
	return "你是 AI 短剧的视频提示词编辑。你只做精简：在不改变镜头结构、台词与表演的前提下删去重复和冗余描述，" +
		"让提示词符合视频模型的字数上限。只输出精简后的提示词正文，不要任何解释、标题前缀或代码块。"
}

// SegmentCondensePrompt 要求把 text 精简到 maxChars 个字符以内。用于撰写结果超出视频模型提示词上限时的自动精简，
// 不做截断：截断会丢掉末尾镜头和台词。
func SegmentCondensePrompt(text string, maxChars int) string {
	actual := len([]rune(text))
	target := max(maxChars*9/10, 1)
	var b strings.Builder
	fmt.Fprintf(&b, "下面这段视频提示词共 %d 个字符，超过了视频模型的上限 %d 个字符（含标点、空格与换行）。请精简到 %d 个字符左右，绝对不能超过 %d 个字符。\n\n", actual, maxChars, target, maxChars)
	b.WriteString(`【必须原样保留】
1. 第一行的承接说明、段标题行与参数行（秒数｜画幅｜…）。
2. 所有栏目名与镜头块，以及每个镜头块标题里的起止时间码；不得增删、合并镜头。
3. 每一句台词逐字保留，说话人、情绪与说话方式保留。
4. 每个“参考图N”编号，写法不变。
5. 人物的表情、眼神、肢体反应与运镜描写（可以压缩措辞，不能删掉）。

【优先删减】
1. 重复出现的画风、质感与禁止项，只保留一处。
2. 栏目里与镜头块重复的站位、服装、外貌和光线描述。
3. 堆叠的形容词与同义反复；可合并的相邻时间片描述。

不要新增内容，不要改写剧情。

<prompt>
`)
	b.WriteString(strings.TrimSpace(text))
	b.WriteString("\n</prompt>\n")
	return b.String()
}

// referenceTokenPattern 匹配提示词里的参考图引用；“@参考图1”“参考图 1”都归一成“参考图1”。
var referenceTokenPattern = regexp.MustCompile(`@?参考图\s*([0-9]+)`)

// NormalizeReferenceTokens 把参考图引用统一写成“参考图N”：与系统追加的参考图说明逐字一致，视频模型才能把名称与图片对上。
func NormalizeReferenceTokens(text string) string {
	return referenceTokenPattern.ReplaceAllString(text, "参考图$1")
}

// UnknownReferenceTokens 返回编号超出本段参考图数量（1..count）的引用，按出现顺序去重。
func UnknownReferenceTokens(text string, count int) []string {
	unknown := []string{}
	seen := map[string]bool{}
	for _, match := range referenceTokenPattern.FindAllStringSubmatch(text, -1) {
		number, err := strconv.Atoi(match[1])
		label := "参考图" + match[1]
		if (err == nil && number >= 1 && number <= count) || seen[label] {
			continue
		}
		seen[label] = true
		unknown = append(unknown, label)
	}
	return unknown
}

// CleanWrittenPrompt 去掉模型偶尔包裹的代码块与前后空白，并统一参考图引用写法。
func CleanWrittenPrompt(text string) string {
	text = strings.TrimSpace(text)
	if strings.HasPrefix(text, "```") {
		if index := strings.Index(text, "\n"); index >= 0 {
			text = text[index+1:]
		}
		text = strings.TrimSuffix(strings.TrimSpace(text), "```")
	}
	// 模型偶尔把格式说明里的“第一行：”一并输出。
	text = strings.TrimPrefix(strings.TrimSpace(text), "第一行：")
	return NormalizeReferenceTokens(strings.TrimSpace(text))
}

// firstFrameRule 说明本段首帧从哪来：有上一段尾帧时首帧图就是那一帧，没有时由提示词描述首帧。
func firstFrameRule(in SegmentPromptInput) string {
	if in.FirstFrame {
		return fmt.Sprintf("请求会附带第%d段视频的最后一帧作为本段首帧图（不占参考图编号）。先写一句“首帧即第%d段视频最后一帧”，再依据上一段结尾写清这一帧里每个人物的位置、朝向、姿态与道具接触，后续动作从这一帧自然延续；然后写渲染质感与画风、本段前中后段的视觉变化、明确禁止项（无额外滤镜噪点、无游戏 UI、无字幕水印、无全屏闪白等）", in.Index, in.Index)
	}
	if in.Index > 0 && in.Independent {
		return "本段独立生成，没有首帧图：依据上一段结尾写清首帧画面里每个人物的位置、朝向、姿态与道具接触，人物外貌以参考图为准；然后写渲染质感与画风、本段前中后段的视觉变化、明确禁止项（无额外滤镜噪点、无游戏 UI、无字幕水印、无全屏闪白等）"
	}
	return "本段是开场，没有首帧图：写清首帧画面里每个人物的位置、朝向、姿态与道具接触，人物外貌以参考图为准；然后写渲染质感与画风、本段前中后段的视觉变化、明确禁止项（无额外滤镜噪点、无游戏 UI、无字幕水印、无全屏闪白等）"
}
