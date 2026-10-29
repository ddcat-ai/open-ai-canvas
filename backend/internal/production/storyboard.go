package production

import (
	"fmt"
	"math"
	"strings"
)

// 分镜规则：剧情段时长（一次视频调用的长度）、镜头节奏、对白密度与转场。剧本提示词、镜头时长、
// 剧情段切分、费用预估与成片渲染都读同一份规则，用户在设置里看到的就是实际执行的约束。
const (
	PacingFast     = "fast"
	PacingStandard = "standard"
	PacingSlow     = "slow"

	DialogueDense    = "dense"
	DialogueStandard = "standard"
	DialogueSparse   = "sparse"

	TransitionAuto  = "auto"
	TransitionCut   = "cut"
	TransitionBlack = "fadeblack"
	TransitionWhite = "fadewhite"

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
	Transition        string `json:"transition"`
	TransitionMs      int    `json:"transitionMs"`
}

// SegmentLimits 是切分一集剧情段时实际执行的约束（毫秒），已按视频模型单次上限收紧。
type SegmentLimits struct {
	Mode  string
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
	case SegmentFixed, SegmentRange:
	default:
		s.SegmentMode = SegmentAuto
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
	case PacingFast, PacingSlow:
	default:
		s.Pacing = PacingStandard
	}
	switch s.Dialogue {
	case DialogueDense, DialogueSparse:
	default:
		s.Dialogue = DialogueStandard
	}
	switch s.Transition {
	case TransitionCut, TransitionBlack, TransitionWhite:
	default:
		s.Transition = TransitionAuto
	}
	if s.TransitionMs <= 0 {
		s.TransitionMs = 400
	}
	s.TransitionMs = clampInt(s.TransitionMs, 150, 1500)
	return s
}

// SegmentLimits 把剧情段规则与视频模型单次上限合成实际约束：任何模式都不会超过模型上限。
func (s StoryboardSettings) SegmentLimits(modelMaxSeconds int) SegmentLimits {
	s = s.Normalized()
	capped := func(seconds int) int64 {
		if modelMaxSeconds > 0 && seconds > modelMaxSeconds {
			seconds = modelMaxSeconds
		}
		return int64(seconds) * 1000
	}
	switch s.SegmentMode {
	case SegmentFixed:
		n := capped(s.SegmentSeconds)
		return SegmentLimits{Mode: SegmentFixed, MinMs: n, MaxMs: n}
	case SegmentRange:
		high := capped(s.SegmentMaxSeconds)
		return SegmentLimits{Mode: SegmentRange, MinMs: min(capped(s.SegmentMinSeconds), high), MaxMs: high}
	}
	return SegmentLimits{Mode: SegmentAuto, MaxMs: int64(max(modelMaxSeconds, 0)) * 1000}
}

// BoundsMs 返回镜头时长的下限与上限（毫秒）。
func (s StoryboardSettings) BoundsMs() (int64, int64) {
	switch s.Normalized().Pacing {
	case PacingFast:
		return MinShotMs, 4000
	case PacingSlow:
		return 3000, 10000
	}
	return 2000, 6000
}

// AverageShotSeconds 是估算镜头数量和费用用的平均镜头长度。
func (s StoryboardSettings) AverageShotSeconds() float64 {
	switch s.Normalized().Pacing {
	case PacingFast:
		return 2.5
	case PacingSlow:
		return 5.5
	}
	return 3.5
}

// LineEverySeconds 是对白密度：平均每隔多少秒至少一句台词或旁白。
func (s StoryboardSettings) LineEverySeconds() float64 {
	switch s.Normalized().Dialogue {
	case DialogueDense:
		return 3
	case DialogueSparse:
		return 7
	}
	return 4.5
}

// MaxLineRunes 是一句台词的字数上限。一个镜头只承载一句台词，镜头时长至少要能说完它，
// 所以“每 N 秒一句”只有在单句足够短时才成立：密集 12 字约 3 秒说完。
func (s StoryboardSettings) MaxLineRunes() int {
	switch s.Normalized().Dialogue {
	case DialogueDense:
		return 12
	case DialogueSparse:
		return 20
	}
	return 16
}

// DialoguePauseMs 是台词说完后保留的气口，计入镜头时长；对白密集时缩短，让下一句尽快接上。
func (s StoryboardSettings) DialoguePauseMs() int64 {
	if s.Normalized().Dialogue == DialogueDense {
		return 300
	}
	return DialoguePadMs
}

// ShotTarget 按单集时长与平均镜头长度估算镜头数，供剧本提示词与预估使用。
func (s StoryboardSettings) ShotTarget(episodeSeconds int) int {
	return clampInt(int(math.Round(float64(episodeSeconds)/s.AverageShotSeconds())), 4, MaxScriptShots)
}

// LineTarget 是一集至少应有的台词与旁白条数。
func (s StoryboardSettings) LineTarget(episodeSeconds int) int {
	return max(1, int(math.Round(float64(episodeSeconds)/s.LineEverySeconds())))
}

// ShotMs 计算镜头时长：剧本建议按节奏夹到上下限内，台词只会把镜头拉长、不会截断。
func (s StoryboardSettings) ShotMs(hintSeconds float64, dialogue string) int64 {
	low, high := s.BoundsMs()
	target := int64(math.Round(hintSeconds * 1000))
	if target <= 0 {
		target = DefaultShotMs
	}
	target = max(low, min(high, target))
	if dialogue = strings.TrimSpace(dialogue); dialogue != "" {
		spoken := int64(float64(len([]rune(dialogue)))/charsPerSecond*1000) + s.DialoguePauseMs()
		if spoken > target {
			target = min(spoken, int64(MaxStoryboardShotSeconds)*1000)
		}
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

var pacingLabels = map[string]string{PacingFast: "快节奏：多用 2–4 秒短镜，冲突处密集切换", PacingStandard: "标准节奏：2–5 秒为主，关键台词可放到 6 秒", PacingSlow: "舒缓节奏：4–8 秒为主，可用长镜头与空镜营造情绪"}

var dialogueLabels = map[string]string{DialogueDense: "对白密集", DialogueStandard: "对白标准", DialogueSparse: "对白克制"}

// PromptRules 把分镜规则写成剧本提示词里的硬约束。segment 是已按视频模型上限收紧的剧情段约束。
func (s StoryboardSettings) PromptRules(episodeSeconds int, segment SegmentLimits) string {
	s = s.Normalized()
	var b strings.Builder
	fmt.Fprintf(&b, "镜头时长：%s；不要平均分配时长，快慢交替。\n", pacingLabels[s.Pacing])
	const unit = "一段一次生成视频，段内多个镜头连续切换"
	switch {
	case segment.Mode == SegmentFixed:
		fmt.Fprintf(&b, "剧情段：成片每 %d 秒一个剧情段（%s），所以每 %d 秒内应有 3–6 个镜头和完整的小冲突，不要用一个长镜头撑满一段。\n", segment.MaxMs/1000, unit, segment.MaxMs/1000)
	case segment.Mode == SegmentRange:
		fmt.Fprintf(&b, "剧情段：每个剧情段 %d–%d 秒（%s），在场景切换或冲突转折处收住；每段应有 3–6 个镜头和完整的小冲突，同一场景连续超过 %d 秒要在情绪转折处留出可断开的位置。\n", segment.MinMs/1000, segment.MaxMs/1000, unit, segment.MaxMs/1000)
	case segment.MaxMs > 0:
		fmt.Fprintf(&b, "剧情段：按剧情节拍切段（%s），在场景切换或冲突转折处断开，单段不超过 %d 秒；每段应有 3–6 个镜头和完整的小冲突，不要用一个长镜头撑满一段。\n", unit, segment.MaxMs/1000)
	}
	// 密度只是节奏参考：台词必须来自原文，原文对白不足时宁可少，不能为凑数编造或改写。
	fmt.Fprintf(&b, "对白密度（%s）：短剧靠台词推动，尽量每 %.0f 秒有一句台词或旁白（参考全集 %d 句）；台词与旁白只能逐字取自原文，原文对白不足时宁可少也不要编造，用动作与反应镜头承接；无台词镜头要有明确的动作或反应。\n", dialogueLabels[s.Dialogue], s.LineEverySeconds(), s.LineTarget(episodeSeconds))
	// 每个镜头只放一句台词，镜头时长 = 说完台词 + 气口；长句只能按标点拆到连续镜头，不能改字。
	fmt.Fprintf(&b, "单镜台词不超过 %d 字，更长的台词在原文标点处拆到连续镜头，不改动字词；对手戏用正反打来回切。有台词的镜头时长按每秒 %.1f 个字说完再留 %.1f 秒气口计算。\n", s.MaxLineRunes(), charsPerSecond, float64(s.DialoguePauseMs())/1000)
	switch s.Transition {
	case TransitionAuto:
		b.WriteString("转场：transition 表示进入本镜头的方式，默认 cut（硬切）；只在时间跳跃、场景大幅切换或段落收束时用 fadeblack（黑场过渡），回忆或高光闪现用 fadewhite（闪白）；每集黑场不超过 3 次。\n")
	default:
		b.WriteString("转场：由后期统一处理，transition 一律填 cut。\n")
	}
	return b.String()
}
