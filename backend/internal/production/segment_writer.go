package production

import (
	"fmt"
	"regexp"
	"strconv"
	"strings"
)

// SegmentWriterSystemPrompt 让文本模型把一个剧情段写成可直接投喂多镜头视频模型的完整视频提示词。
func SegmentWriterSystemPrompt() string {
	return "你是 AI 短剧的分镜导演，专门为多镜头视频生成模型撰写整段视频提示词。" +
		"你写的提示词会被原样发送给视频模型，所以必须具体到站位、朝向、手部与道具归属、光源、声线和每个时间片的动作，" +
		"禁止空泛形容。只输出提示词正文，不要任何解释、标题前缀或代码块。"
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
	if skill != nil {
		fmt.Fprintf(&b, "【写作技能：%s】\n下面是你必须遵循的视频提示词写作方法（来自技能文件 %s）。技能规定了结构、栏目或写法时，按技能输出，下方【输出格式】只作补充；【硬性规则】始终适用。\n<skill>\n%s\n</skill>\n\n", skill.Name, skill.Path, truncateRunes(strings.TrimSpace(skill.Content), MaxWritingSkillRunes))
	}
	b.WriteString(`【输出格式】严格按以下结构与顺序书写，栏目名原样保留：
`)
	if in.Index > 0 && in.Independent {
		fmt.Fprintf(&b, "本段与其他段并行独立生成（不附带第%d段画面）：开场站位、朝向、服装道具状态与上一段结尾保持一致，但不写“定格”“接续”之类依赖上一段画面的描述\n", in.Index)
	} else if in.Index > 0 {
		fmt.Fprintf(&b, "严格从第%d段视频末尾绝对硬定格的实际站位、朝向、受力和时空状态继续，不重新摆位\n", in.Index)
	}
	fmt.Fprintf(&b, `第%d段视频《段名·点题副标题》——一句话概括本段的戏剧转折
%s秒｜%s｜%s｜%s对白｜无字幕｜%d个主镜头

【视觉与首帧】
%s；渲染质感与画风；本段前段、中段、末尾的视觉变化；明确禁止项（无额外滤镜噪点、无游戏 UI、无字幕水印、无全屏闪白等）。

【场景布局、人物站位与机位轴线】
空间锁定（场景名并标注参考图编号）；主戏剧轴线方向与画面左右关系；人物相对位置在本段内如何变化；机位景别与运动的限制和禁止项（不越轴、不穿模、不做与剧情无关的大环绕）。

【角色、手部、衣物和道具归属】
每个出场角色一段：姓名（参考图编号）、年龄身份、服装发型与细节、本段内的外观或状态变化；道具（参考图编号）明确归属到谁的哪只手。

【道具与物理时空规则】
关键道具、特效与物理现象的具体表现，写清发生的时间码。没有特殊道具时写本段的物理与动作约束。

【光源与声音】
光源随时间的变化；“声线规格”逐个写每个说话角色的音色、语速、情绪；环境音与关键音效并标注时间码。

然后每个镜头一块，镜头之间空一行：
【起—止秒｜镜头一：四字镜头名·点题】
焦段 + 景别，机位位置与朝向描述。
起—止：按 2–3 秒切成时间片，逐片写清动作、表情、镜头运动。
角色名 + 语气：“台词”
有台词时写“留%s秒气口”，台词紧接动作开口，不要再额外留白；每个镜头写动作音/环境音，必要时写光影。
`, in.Index+1, secondsText(total), firstNonEmpty(in.AspectRatio, "9:16"), firstNonEmpty(in.Style, "写实电影感"), firstNonEmpty(in.Language, "中文"), len(in.Shots), firstFrameRule(in), in.pauseText())
	// 并行出片时下一段不取本段尾帧，段尾定格只会在成片里留下一秒静止画面。
	if in.Index < in.Count-1 && !in.Independent {
		fmt.Fprintf(&b, "最后一个镜头以“末1.0秒全场绝对硬定格！……作为第%d段的无缝接续基准”收尾，写清定格时每个元素的状态。\n", in.Index+2)
	}
	b.WriteString(`
【硬性规则】
1. 时间码精确到 0.01 秒，从 00.00 连续覆盖到本段结束，每个镜头的起止与素材稿完全一致，不得增删镜头。
2. 台词逐字使用素材稿中的台词，不得改写、增加或删减；没有台词的镜头写“绝对无台词”。
3. 只使用素材稿中的角色、道具与场景，每个角色、道具与场景首次出现时都写“名称（参考图N）”，编号严格使用素材稿给出的编号，写法固定为“参考图N”（不要写成“@参考图N”“图N”“Image N”或其他编号），素材稿没有编号的不要编造编号；外貌以参考图为准，不要编造与设定冲突的外貌。
4. 对白由视频模型直接生成声音，台词要写清说话人、语气与声线；不要另写配音或字幕要求。
5. 每个镜头的动作必须是镜头能拍到的可见动作，内心活动改写为表情和肢体反应。
6. 直接输出提示词正文，格式说明里的括号与描述性文字不要输出。

`)
	if strings.TrimSpace(previousEnding) != "" {
		b.WriteString("【上一段结尾】\n" + strings.TrimSpace(previousEnding) + "\n\n")
	}
	b.WriteString("【本段素材稿】\n" + draft + "\n")
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
