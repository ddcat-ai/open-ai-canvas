package production

import (
	"fmt"
	"math"
	"strings"
)

// 分镜规则：剧情段时长（一次视频调用的长度）、镜头节奏、对白密度与转场。剧本提示词、镜头时长、
// 剧情段切分、费用预估与成片渲染都读同一份规则，用户在设置里看到的就是实际执行的约束。
const (
	// 镜头节奏五档，从快到慢；rapid 是新作品与未设置时的默认。
	PacingRapid    = "rapid"
	PacingFast     = "fast"
	PacingStandard = "standard"
	PacingRelaxed  = "relaxed"
	PacingSlow     = "slow"

	// DefaultTransitionMs 是转场时长的默认值，也是可设的下限。
	DefaultTransitionMs = 150

	DialogueDense    = "dense"
	DialogueStandard = "standard"
	DialogueSparse   = "sparse"
	// DialogueCustom 由用户设定语速、每句间隔、单句字数与气口，流水线团队按统一口径控制全剧节奏。
	DialogueCustom = "custom"

	// DefaultCharsPerSecond 是三档预设共用的语速（每秒字数）。自定义对白的可设范围见下面几项。
	DefaultCharsPerSecond = 4.5
	MinCharsPerSecond     = 2.0
	MaxCharsPerSecond     = 8.0
	MinLineSeconds        = 1.5
	MaxLineSeconds        = 20.0
	MinLineRuneLimit      = 4
	MaxLineRuneLimit      = 40
	MinLinePauseMs        = 100
	MaxLinePauseMs        = 2000

	TransitionAuto  = "auto"
	TransitionCut   = "cut"
	TransitionBlack = "fadeblack"
	TransitionWhite = "fadewhite"

	// 表演强度与运镜动感是 1–10 档，只改变剧本与段视频提示词的写法，不改镜头时长；0 表示未设置，按默认档。
	MinDirectionLevel       = 1
	MaxDirectionLevel       = 10
	DefaultPerformanceLevel = 7
	DefaultCameraLevel      = 3

	// SegmentAuto 按剧情节拍（场景切换）切段，单段不超过视频模型单次上限。
	SegmentAuto = "auto"
	// SegmentFixed 每段固定 SegmentSeconds 秒，只按时长装箱。
	SegmentFixed = "fixed"
	// SegmentRange 每段在 SegmentMinSeconds–SegmentMaxSeconds 之间，优先在场景切换处断开。
	SegmentRange = "range"

	// MaxStoryboardShotSeconds 是单镜手动可设的上限；实际还受剧情段时长约束。
	MaxStoryboardShotSeconds = 60
	// MinSegmentSeconds / MaxSegmentSeconds 是剧情段可设的时长范围；实际还要受视频模型单次上限收紧。
	MinSegmentSeconds = 4
	MaxSegmentSeconds = 60
)

type StoryboardSettings struct {
	// SegmentMode 决定剧情段（一次视频调用）怎么切：auto / fixed / range。
	SegmentMode       string `json:"segmentMode"`
	SegmentSeconds    int    `json:"segmentSeconds"`
	SegmentMinSeconds int    `json:"segmentMinSeconds"`
	SegmentMaxSeconds int    `json:"segmentMaxSeconds"`
	Pacing            string `json:"pacing"`
	Dialogue          string `json:"dialogue"`
	// 自定义对白参数只在 Dialogue 为 custom 时生效，切回预设档也保留，来回切换不丢值：
	// SpeechRate 语速（每秒字数）、LineSeconds 平均每隔多少秒一句、LineMaxRunes 单句字数上限、LinePauseMs 台词后的气口。
	SpeechRate   float64 `json:"speechRate,omitempty"`
	LineSeconds  float64 `json:"lineSeconds,omitempty"`
	LineMaxRunes int     `json:"lineMaxRunes,omitempty"`
	LinePauseMs  int     `json:"linePauseMs,omitempty"`
	Transition   string  `json:"transition"`
	TransitionMs int     `json:"transitionMs"`
	// Performance 是表演强度 1–10（1 内敛、5 自然、10 夸张外放）。
	Performance int `json:"performance"`
	// CameraMotion 是运镜动感 1–10（1 静态、5 有动机的运镜、10 强烈冲击）。
	CameraMotion int `json:"cameraMotion"`
}

// SegmentLimits 是切分一集剧情段时实际执行的约束（毫秒），已按视频模型单次可生成的时长范围收紧。
type SegmentLimits struct {
	Mode string
	// MinMs 不低于视频模型单次最短时长；智能模式下只有这一项下限。
	MinMs int64
	// MaxMs 为 0 只出现在智能模式且模型未声明单次上限时，表示不限时长。
	MaxMs int64
}

// TargetSeconds 是一段的典型时长，供剧本提示词与费用预估使用。
func (l SegmentLimits) TargetSeconds() int {
	switch l.Mode {
	case SegmentRange:
		return int((l.MinMs + l.MaxMs) / 2000)
	}
	return int(l.MaxMs / 1000)
}

func clampInt(value, low, high int) int {
	return max(low, min(high, value))
}

func (s StoryboardSettings) Normalized() StoryboardSettings {
	switch s.SegmentMode {
	case SegmentFixed, SegmentRange, SegmentAuto:
	default:
		s.SegmentMode = SegmentFixed
	}
	// 三种模式的数值都保留，切换模式时不丢用户填过的值。
	if s.SegmentSeconds <= 0 {
		s.SegmentSeconds = 10
	}
	if s.SegmentMinSeconds <= 0 {
		s.SegmentMinSeconds = 8
	}
	if s.SegmentMaxSeconds <= 0 {
		s.SegmentMaxSeconds = 15
	}
	s.SegmentSeconds = clampInt(s.SegmentSeconds, MinSegmentSeconds, MaxSegmentSeconds)
	s.SegmentMinSeconds = clampInt(s.SegmentMinSeconds, MinSegmentSeconds, MaxSegmentSeconds)
	s.SegmentMaxSeconds = clampInt(s.SegmentMaxSeconds, MinSegmentSeconds, MaxSegmentSeconds)
	if s.SegmentMinSeconds > s.SegmentMaxSeconds {
		s.SegmentMinSeconds, s.SegmentMaxSeconds = s.SegmentMaxSeconds, s.SegmentMinSeconds
	}
	switch s.Pacing {
	case PacingRapid, PacingFast, PacingStandard, PacingRelaxed, PacingSlow:
	default:
		s.Pacing = PacingRapid
	}
	switch s.Dialogue {
	case DialogueDense, DialogueStandard, DialogueSparse, DialogueCustom:
	default:
		s.Dialogue = DialogueDense
	}
	// 自定义参数填了就夹到可设范围；自定义档缺项时按标准档补齐，预设档下未填的保持未填。
	custom, base := s.Dialogue == DialogueCustom, dialogueRules[DialogueStandard]
	s.SpeechRate = normalizedDialogueFloat(s.SpeechRate, base.charsPerSecond, MinCharsPerSecond, MaxCharsPerSecond, custom)
	s.LineSeconds = normalizedDialogueFloat(s.LineSeconds, base.lineSeconds, MinLineSeconds, MaxLineSeconds, custom)
	s.LineMaxRunes = normalizedDialogueInt(s.LineMaxRunes, base.maxRunes, MinLineRuneLimit, MaxLineRuneLimit, custom)
	s.LinePauseMs = normalizedDialogueInt(s.LinePauseMs, int(base.pauseMs), MinLinePauseMs, MaxLinePauseMs, custom)
	switch s.Transition {
	case TransitionCut, TransitionBlack, TransitionWhite:
	default:
		s.Transition = TransitionAuto
	}
	if s.TransitionMs <= 0 {
		s.TransitionMs = DefaultTransitionMs
	}
	s.TransitionMs = clampInt(s.TransitionMs, DefaultTransitionMs, 1500)
	s.Performance = normalizedDirectionLevel(s.Performance, DefaultPerformanceLevel)
	s.CameraMotion = normalizedDirectionLevel(s.CameraMotion, DefaultCameraLevel)
	return s
}

func normalizedDirectionLevel(level, fallback int) int {
	if level <= 0 {
		return fallback
	}
	return clampInt(level, MinDirectionLevel, MaxDirectionLevel)
}

// normalizedDialogueFloat 夹到范围并保留一位小数；未填时自定义档用 fallback，否则保持 0。
func normalizedDialogueFloat(value, fallback, low, high float64, fill bool) float64 {
	if !(value > 0) {
		if !fill {
			return 0
		}
		value = fallback
	}
	return math.Round(max(low, min(high, value))*10) / 10
}

func normalizedDialogueInt(value, fallback, low, high int, fill bool) int {
	if value <= 0 {
		if !fill {
			return 0
		}
		value = fallback
	}
	return clampInt(value, low, high)
}

// SegmentLimits 把剧情段规则与视频模型单次可生成的时长合成实际约束：任何模式都不超过模型上限，
// 下限取设置下限与模型下限中较大的一个（智能模式没有设置下限，只用模型下限）。
// 设置的上限低于模型下限时把上限抬到模型下限：更短的段生成时也会补到模型下限。
func (s StoryboardSettings) SegmentLimits(model DurationOptions) SegmentLimits {
	s = s.Normalized()
	modelMin, modelMax := model.Bounds()
	capped := func(seconds int) int64 {
		if modelMax > 0 && seconds > modelMax {
			seconds = modelMax
		}
		return int64(max(seconds, modelMin)) * 1000
	}
	switch s.SegmentMode {
	case SegmentFixed:
		n := capped(s.SegmentSeconds)
		return SegmentLimits{Mode: SegmentFixed, MinMs: n, MaxMs: n}
	case SegmentRange:
		high := capped(s.SegmentMaxSeconds)
		return SegmentLimits{Mode: SegmentRange, MinMs: min(capped(s.SegmentMinSeconds), high), MaxMs: high}
	}
	limits := SegmentLimits{Mode: SegmentAuto, MinMs: int64(modelMin) * 1000, MaxMs: int64(modelMax) * 1000}
	if limits.MaxMs > 0 {
		limits.MinMs = min(limits.MinMs, limits.MaxMs)
	}
	return limits
}

// pacingRule 是一档镜头节奏的单镜时长上下限、估算用平均镜头长度与写进剧本提示词的说明。
type pacingRule struct {
	minMs, maxMs int64
	average      float64
	label        string
}

var pacingRules = map[string]pacingRule{
	PacingRapid:    {MinShotMs, 3000, 2.0, "极快节奏：1.5–3 秒短镜连切，冲突与反转处密集切换，几乎不用长镜头"},
	PacingFast:     {MinShotMs, 4000, 2.5, "快节奏：多用 2–4 秒短镜，冲突处密集切换"},
	PacingStandard: {2000, 6000, 3.5, "标准节奏：2–5 秒为主，关键台词可放到 6 秒"},
	PacingRelaxed:  {2500, 8000, 4.5, "舒缓节奏：3–6 秒为主，情绪戏可放到 8 秒"},
	PacingSlow:     {3000, 10000, 5.5, "慢节奏：4–8 秒为主，可用长镜头与空镜营造情绪"},
}

// BoundsMs 返回镜头时长的下限与上限（毫秒）。
func (s StoryboardSettings) BoundsMs() (int64, int64) {
	rule := pacingRules[s.Normalized().Pacing]
	return rule.minMs, rule.maxMs
}

// AverageShotSeconds 是估算镜头数量和费用用的平均镜头长度。
func (s StoryboardSettings) AverageShotSeconds() float64 {
	return pacingRules[s.Normalized().Pacing].average
}

// dialogueRule 是一档对白密度：语速、平均每句间隔、单句字数上限与台词后的气口。
// 一个镜头只放一句台词，镜头时长至少要能说完它，所以预设档让最长的一句恰好在间隔内说完：
// 密集 12 字按每秒 4.5 字约 2.7 秒，加 0.3 秒气口正好 3 秒。对白密集时气口缩短，让下一句尽快接上。
type dialogueRule struct {
	charsPerSecond float64
	lineSeconds    float64
	maxRunes       int
	pauseMs        int64
}

var dialogueRules = map[string]dialogueRule{
	DialogueDense:    {DefaultCharsPerSecond, 3, 12, 300},
	DialogueStandard: {DefaultCharsPerSecond, 4.5, 16, DialoguePadMs},
	DialogueSparse:   {DefaultCharsPerSecond, 7, 20, DialoguePadMs},
}

// dialogue 返回生效的对白参数：预设档取固定值，自定义档取用户设定。
func (s StoryboardSettings) dialogue() dialogueRule {
	s = s.Normalized()
	if s.Dialogue != DialogueCustom {
		return dialogueRules[s.Dialogue]
	}
	return dialogueRule{s.SpeechRate, s.LineSeconds, s.LineMaxRunes, int64(s.LinePauseMs)}
}

// CharsPerSecond 是计算台词时长的语速（每秒字数）。
func (s StoryboardSettings) CharsPerSecond() float64 { return s.dialogue().charsPerSecond }

// LineEverySeconds 是对白密度：平均每隔多少秒至少一句台词或旁白。
func (s StoryboardSettings) LineEverySeconds() float64 { return s.dialogue().lineSeconds }

// MaxLineRunes 是一句台词的字数上限，更长的台词在原文标点处拆到连续镜头。
func (s StoryboardSettings) MaxLineRunes() int { return s.dialogue().maxRunes }

// DialoguePauseMs 是台词说完后保留的气口，计入镜头时长。
func (s StoryboardSettings) DialoguePauseMs() int64 { return s.dialogue().pauseMs }

// ShotTarget 按单集时长与平均镜头长度估算镜头数，供剧本提示词与预估使用。
func (s StoryboardSettings) ShotTarget(episodeSeconds int) int {
	return clampInt(int(math.Round(float64(episodeSeconds)/s.AverageShotSeconds())), 4, MaxScriptShots)
}

// LineTarget 是一集至少应有的台词与旁白条数。
func (s StoryboardSettings) LineTarget(episodeSeconds int) int {
	return max(1, int(math.Round(float64(episodeSeconds)/s.LineEverySeconds())))
}

// ShotMs 计算模型写的镜头时长：剧本建议按节奏夹到上下限内，台词只会把镜头拉长、不会截断。
func (s StoryboardSettings) ShotMs(hintSeconds float64, dialogue string) int64 {
	low, high := s.BoundsMs()
	target := int64(math.Round(hintSeconds * 1000))
	if target <= 0 {
		target = DefaultShotMs
	}
	return s.fitDialogue(max(low, min(high, target)), dialogue)
}

// ImportedShotMs 计算用户分镜里的镜头时长：写了秒数就按写的执行（与手动改时长同为 1–60 秒），
// 不按镜头节奏夹紧；没写时按节奏规则估算。台词同样只会把镜头拉长，保证逐字台词说得完。
func (s StoryboardSettings) ImportedShotMs(seconds float64, dialogue string) int64 {
	if seconds <= 0 {
		return s.ShotMs(0, dialogue)
	}
	target := max(1000, min(int64(MaxStoryboardShotSeconds)*1000, int64(math.Round(seconds*1000))))
	return s.fitDialogue(target, dialogue)
}

// SpokenMs 是说完一句台词所需的时长（含气口）；没有台词为 0。
func (s StoryboardSettings) SpokenMs(dialogue string) int64 {
	if dialogue = strings.TrimSpace(dialogue); dialogue == "" {
		return 0
	}
	rule := s.dialogue()
	return int64(float64(len([]rune(dialogue)))/rule.charsPerSecond*1000) + rule.pauseMs
}

func (s StoryboardSettings) fitDialogue(target int64, dialogue string) int64 {
	if spoken := s.SpokenMs(dialogue); spoken > target {
		target = min(spoken, int64(MaxStoryboardShotSeconds)*1000)
	}
	return target
}

// EffectiveTransition 返回进入该镜头的转场：作品统一指定时以作品为准，否则用剧本给出的转场。
func (s StoryboardSettings) EffectiveTransition(shotTransition string, first bool) string {
	if first {
		return TransitionCut
	}
	s = s.Normalized()
	if s.Transition != TransitionAuto {
		return s.Transition
	}
	return NormalizeTransition(shotTransition)
}

func NormalizeTransition(value string) string {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case TransitionBlack, "black", "黑场", "黑场过渡", "fade", "淡入淡出":
		return TransitionBlack
	case TransitionWhite, "white", "flash", "闪白":
		return TransitionWhite
	}
	return TransitionCut
}

var dialogueLabels = map[string]string{DialogueDense: "对白密集", DialogueStandard: "对白标准", DialogueSparse: "对白克制", DialogueCustom: "自定义"}

// formatDecimal 把秒数、语速写成最多两位小数且去掉末尾 0 的文本，例如 4.5、3、0.25。
func formatDecimal(value float64) string {
	return strings.TrimSuffix(strings.TrimRight(fmt.Sprintf("%.2f", value), "0"), ".")
}

// directionBand 把 1–10 档归到五个描述段：1–2、3–4、5–6、7–8、9–10。
func directionBand(level int) int {
	return (normalizedDirectionLevel(level, 5) - 1) / 2
}

// 表演强度五段描述，与前端滑杆刻度同一口径。
var performanceBands = [5]string{
	"极度内敛：几乎不动声色，情绪只在眼神停留、呼吸变化和极细微的表情里（眉心微蹙、喉结滚动、指尖收紧），台词轻声平稳，但每句都有潜台词，不念稿。",
	"克制：表情变化小而准确，情绪靠眼神、停顿和呼吸传达；台词音量起伏小，关键句压低声音或放慢加力；听者有细微但可见的反应。",
	"自然真实：表情随台词和处境实时变化，眼神有焦点、会躲闪或逼视；台词像真人对话，有轻重缓急、重音和停顿，带呼吸感；一人说话时，其他在场人物有可见的反应。",
	"情绪饱满（竖屏短剧的张力）：冲突与反转处表情和肢体幅度明显（瞪眼、咬牙、冷笑、红了眼眶、攥拳、拍桌），情绪逐句升级；台词音量和语速随情绪起伏，关键句加重或爆发，崩溃处可以哽咽、发颤；每次冲突都给听者一个明显的反应。",
	"夸张外放（爆款爽剧）：情绪大开大合，表情与肢体动作放大到一眼可读（怒目圆睁、仰头冷笑、崩溃痛哭、甩手指人），反派的嚣张和主角的反击都推到极致；台词抑扬顿挫强烈，爆发处高声怒吼、哽咽、破音；关键台词后给听者反应特写。",
}

// 运镜动感五段描述，与前端滑杆刻度同一口径。
var cameraBands = [5]string{
	"静态克制：以固定机位为主，只做极缓慢的推近，靠构图、景别和演员表演推动情绪，不用甩镜与手持。",
	"稳定：固定机位与缓慢推拉为主，对话用正反打与过肩镜头，情绪高点才推近到特写，不用甩镜和剧烈手持。",
	"运镜要有动机：推拉摇移的方向和速度服务于情绪，对话用正反打与过肩镜头，情绪升级时推近到特写，揭示信息时摇开或拉远；不要整段都是静止机位。",
	"动感：冲突与反转处用快速推近、跟拍和低机位仰拍，气场与揭示时刻用环绕或升降；多数镜头都有机位运动或人物调度，不越轴、不穿模。",
	"强烈冲击：频繁的快速推拉、甩镜、手持跟拍、低机位仰拍与环绕，配合速度变化制造冲击；每个镜头都要有明确的机位运动，节奏紧凑，但不越轴、不穿模。",
}

var cameraScriptHints = [5]string{
	"camera 以“固定”为主，少量“推”",
	"camera 以固定与推、拉为主",
	"camera 按情绪选择，不要连续多个“固定”",
	"camera 少用“固定”，冲突与反转镜头优先推、跟、环绕",
	"camera 几乎不用“固定”，多用推、跟、环绕与手持",
}

// PerformanceRule 是写进提示词的表演要求：给出档位与刻度两端，让模型按档位把握幅度。
func PerformanceRule(level int) string {
	level = normalizedDirectionLevel(level, DefaultPerformanceLevel)
	return fmt.Sprintf("表演强度 %d/10（1 内敛到几乎不动声色，5 自然真实，10 夸张外放）。%s", level, performanceBands[directionBand(level)])
}

// CameraMotionRule 是写进提示词的运镜要求。
func CameraMotionRule(level int) string {
	level = normalizedDirectionLevel(level, DefaultCameraLevel)
	return fmt.Sprintf("运镜动感 %d/10（1 几乎静止，5 有动机的运镜，10 强烈冲击）。%s", level, cameraBands[directionBand(level)])
}

// PromptRules 把分镜规则写成剧本提示词里的硬约束。segment 是已按视频模型时长范围收紧的剧情段约束。
func (s StoryboardSettings) PromptRules(episodeSeconds int, segment SegmentLimits) string {
	s = s.Normalized()
	var b strings.Builder
	fmt.Fprintf(&b, "镜头时长：%s；不要平均分配时长，快慢交替。\n", pacingRules[s.Pacing].label)
	const unit = "一段一次生成视频，段内多个镜头连续切换"
	switch {
	case segment.Mode == SegmentFixed:
		fmt.Fprintf(&b, "剧情段：成片每 %d 秒一个剧情段（%s），所以每 %d 秒内应有 3–6 个镜头和完整的小冲突，不要用一个长镜头撑满一段。\n", segment.MaxMs/1000, unit, segment.MaxMs/1000)
	case segment.Mode == SegmentRange:
		fmt.Fprintf(&b, "剧情段：每个剧情段 %d–%d 秒（%s），在场景切换或冲突转折处收住；每段应有 3–6 个镜头和完整的小冲突，同一场景连续超过 %d 秒要在情绪转折处留出可断开的位置。\n", segment.MinMs/1000, segment.MaxMs/1000, unit, segment.MaxMs/1000)
	case segment.MaxMs > 0 && segment.MinMs > 0:
		fmt.Fprintf(&b, "剧情段：按剧情节拍切段（%s），在场景切换或冲突转折处断开，单段 %d–%d 秒（视频模型单次最短 %d 秒，过短的场景与相邻场景并成一段）；每段应有 3–6 个镜头和完整的小冲突，不要用一个长镜头撑满一段。\n", unit, segment.MinMs/1000, segment.MaxMs/1000, segment.MinMs/1000)
	case segment.MaxMs > 0:
		fmt.Fprintf(&b, "剧情段：按剧情节拍切段（%s），在场景切换或冲突转折处断开，单段不超过 %d 秒；每段应有 3–6 个镜头和完整的小冲突，不要用一个长镜头撑满一段。\n", unit, segment.MaxMs/1000)
	}
	// 密度只是节奏参考：台词必须来自原文，原文对白不足时宁可少，不能为凑数编造或改写。
	fmt.Fprintf(&b, "对白密度（%s）：短剧靠台词推动，尽量每 %s 秒有一句台词或旁白（参考全集 %d 句）；台词与旁白只能逐字取自原文，原文对白不足时宁可少也不要编造，用动作与反应镜头承接；无台词镜头要有明确的动作或反应。\n", dialogueLabels[s.Dialogue], formatDecimal(s.LineEverySeconds()), s.LineTarget(episodeSeconds))
	// 每个镜头只放一句台词，镜头时长 = 说完台词 + 气口；长句只能按标点拆到连续镜头，不能改字。
	fmt.Fprintf(&b, "单镜台词不超过 %d 字，更长的台词在原文标点处拆到连续镜头，不改动字词；对手戏用正反打来回切。有台词的镜头时长按每秒 %s 个字说完再留 %s 秒气口计算。\n", s.MaxLineRunes(), formatDecimal(s.CharsPerSecond()), formatDecimal(float64(s.DialoguePauseMs())/1000))
	fmt.Fprintf(&b, "表演：%saction 与 videoPrompt 写清本镜人物的表情、眼神与肢体反应，说话的人写出语气，不说话的人也要有反应。\n", PerformanceRule(s.Performance))
	fmt.Fprintf(&b, "运镜：%s%s。\n", CameraMotionRule(s.CameraMotion), cameraScriptHints[directionBand(s.CameraMotion)])
	switch s.Transition {
	case TransitionAuto:
		b.WriteString("转场：transition 表示进入本镜头的方式，默认 cut（硬切）；只在时间跳跃、场景大幅切换或段落收束时用 fadeblack（黑场过渡），回忆或高光闪现用 fadewhite（闪白）；每集黑场不超过 3 次。\n")
	default:
		b.WriteString("转场：由后期统一处理，transition 一律填 cut。\n")
	}
	return b.String()
}
