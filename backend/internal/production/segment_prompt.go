package production

import (
	"fmt"
	"strings"
)

// SegmentShot 是剧情段提示词需要的单镜信息。
type SegmentShot struct {
	Scene       string
	ShotSize    string
	Camera      string
	ImagePrompt string
	Action      string
	VideoPrompt string
	Speaker     string
	Dialogue    string
	DurationMs  int64
	Transition  string
}

// SegmentReference 是段内出场的角色、道具或场景；Label 与提交时参考图的顺序一致（参考图1、参考图2…）。
type SegmentReference struct {
	Label  string
	Kind   string
	Name   string
	Detail string
	Voice  string
}

// SegmentPromptInput 是组装一整段多镜头视频提示词的全部输入。
type SegmentPromptInput struct {
	Index       int
	Count       int
	Title       string
	AspectRatio string
	Style       string
	VisualRules string
	Language    string
	Shots       []SegmentShot
	References  []SegmentReference
	// FirstFrame 表示请求会附带上一段视频的最后一帧作为本段首帧。
	FirstFrame bool
	// Independent 表示各段并行独立生成：不带上一段画面，段尾也不需要为下一段做硬定格。
	Independent bool
	// PauseMs 是台词后的气口，已计入镜头时长；为 0 时按默认值。
	PauseMs int64
}

// pauseText 是写进提示词的气口时长，例如“0.5”。
func (in SegmentPromptInput) pauseText() string {
	pause := in.PauseMs
	if pause <= 0 {
		pause = DialoguePadMs
	}
	return strings.TrimSuffix(strings.TrimRight(fmt.Sprintf("%.2f", float64(pause)/1000), "0"), ".")
}

var shotLens = map[string]string{"特写": "85mm", "近景": "50mm", "中景": "35mm", "全景": "24mm", "远景": "16mm"}

var cameraMove = map[string]string{
	"固定": "固定机位",
	"推":  "缓慢推近",
	"拉":  "缓慢拉远",
	"摇":  "水平横摇",
	"跟":  "跟随主体移动",
	"环绕": "小幅弧线环绕",
	"升降": "垂直升降",
	"手持": "手持轻微晃动",
}

var chineseOrdinals = []string{"一", "二", "三", "四", "五", "六", "七", "八", "九", "十", "十一", "十二"}

func chineseOrdinal(index int) string {
	if index >= 0 && index < len(chineseOrdinals) {
		return chineseOrdinals[index]
	}
	return fmt.Sprint(index + 1)
}

// segmentClock 输出“05.50”样式的段内时间码。
func segmentClock(ms int64) string {
	return fmt.Sprintf("%05.2f", float64(ms)/1000)
}

func secondsText(ms int64) string {
	seconds := float64(ms) / 1000
	if seconds == float64(int64(seconds)) {
		return fmt.Sprint(int64(seconds))
	}
	return fmt.Sprintf("%.1f", seconds)
}

// SegmentVideoPrompt 把一个剧情段组装成可整段生成的多镜头视频提示词：
// 段头（承接、时长、画幅、风格）、视觉与首帧、场景与站位、角色参考、声音，以及按段内时间码切分的每个镜头。
// 尾帧续接时段末镜头留 1 秒硬定格作为下一段的接续基准；并行出片（Independent）不留。
func SegmentVideoPrompt(in SegmentPromptInput) string {
	var b strings.Builder
	style := firstNonEmpty(in.Style, "写实电影感")
	language := firstNonEmpty(in.Language, "中文")
	var total int64
	for _, shot := range in.Shots {
		total += shot.DurationMs
	}
	refLabel := map[string]string{}
	for _, ref := range in.References {
		refLabel[ref.Name] = ref.Label
	}
	withRef := func(name string) string {
		if label := refLabel[name]; label != "" {
			return name + "（" + label + "）"
		}
		return name
	}

	if in.Index > 0 && in.Independent {
		fmt.Fprintf(&b, "本段独立生成，开场站位、朝向与光线和第%d段结尾保持一致\n", in.Index)
	} else if in.Index > 0 {
		fmt.Fprintf(&b, "严格从第%d段视频末尾硬定格的站位、朝向、动作和光线状态继续，不重新摆位\n", in.Index)
	}
	fmt.Fprintf(&b, "第%d段视频《%s》\n", in.Index+1, firstNonEmpty(in.Title, "剧情段"))
	fmt.Fprintf(&b, "%s秒｜%s｜%s｜%s对白｜无字幕｜%d个镜头\n", secondsText(total), firstNonEmpty(in.AspectRatio, "9:16"), style, language, len(in.Shots))

	b.WriteString("\n【视觉与首帧】\n")
	if len(in.Shots) > 0 {
		first := in.Shots[0]
		switch {
		case in.FirstFrame:
			fmt.Fprintf(&b, "首帧即第%d段视频最后一帧（随请求附带）。本段起幅：", in.Index)
		case in.Index > 0 && in.Independent:
			b.WriteString("首帧（本段独立生成，按文字描述）：")
		case in.Index > 0:
			b.WriteString("首帧（上一段视频尚未生成，按文字描述）：")
		default:
			b.WriteString("首帧：")
		}
		b.WriteString(strings.TrimSpace(firstNonEmpty(first.ImagePrompt, first.Action)) + "。\n")
	}
	b.WriteString(style + "。")
	if rules := strings.TrimSpace(in.VisualRules); rules != "" {
		b.WriteString(rules + "。")
	}
	b.WriteString("画面不出现字幕、水印和界面元素。\n")

	b.WriteString("\n【场景布局、人物站位与机位轴线】\n")
	scenes := []string{}
	for _, ref := range in.References {
		if ref.Kind == "scene" {
			line := withRef(ref.Name)
			if detail := strings.TrimSpace(ref.Detail); detail != "" {
				line += "：" + detail
			}
			scenes = append(scenes, line)
		}
	}
	if len(scenes) == 0 {
		seen := map[string]bool{}
		for _, shot := range in.Shots {
			if name := strings.TrimSpace(shot.Scene); name != "" && !seen[name] {
				seen[name] = true
				scenes = append(scenes, name)
			}
		}
	}
	if len(scenes) > 0 {
		b.WriteString("空间锁定：" + strings.Join(scenes, "；") + "。\n")
	}
	b.WriteString("人物站位与朝向在本段内保持一致，切镜不越轴，不穿模。\n")

	characters, props := []SegmentReference{}, []SegmentReference{}
	for _, ref := range in.References {
		switch ref.Kind {
		case "character":
			characters = append(characters, ref)
		case "prop":
			props = append(props, ref)
		}
	}
	if len(characters) > 0 {
		b.WriteString("\n【角色与参考图】\n")
		for _, ref := range characters {
			line := withRef(ref.Name)
			if detail := strings.TrimSpace(ref.Detail); detail != "" {
				line += "：" + detail
			}
			b.WriteString(line + "。外貌、服装与发型严格以参考图为准。\n")
		}
	}

	if len(props) > 0 {
		b.WriteString("\n【道具与参考图】\n")
		for _, ref := range props {
			line := withRef(ref.Name)
			if detail := strings.TrimSpace(ref.Detail); detail != "" {
				line += "：" + detail
			}
			b.WriteString(line + "。外形与材质以参考图为准。\n")
		}
	}

	voices := []string{}
	for _, ref := range characters {
		if voice := strings.TrimSpace(ref.Voice); voice != "" {
			voices = append(voices, ref.Name+"："+voice)
		}
	}
	b.WriteString("\n【光源与声音】\n")
	b.WriteString("光线方向与色温在本段内保持连续。")
	b.WriteString("对白使用" + language + "，口型与台词同步，环境音随画面动作。\n")
	for _, voice := range voices {
		b.WriteString(voice + "\n")
	}

	var cursor int64
	for index, shot := range in.Shots {
		start, end := cursor, cursor+shot.DurationMs
		cursor = end
		heading := firstNonEmpty(shot.ShotSize, "镜头")
		if move := cameraMove[shot.Camera]; move != "" && shot.Camera != "固定" {
			heading += "·" + shot.Camera
		}
		fmt.Fprintf(&b, "\n【%s—%s秒｜镜头%s：%s】\n", segmentClock(start), segmentClock(end), chineseOrdinal(index), heading)
		framing := strings.TrimSpace(shotLens[shot.ShotSize] + shot.ShotSize)
		if move := cameraMove[shot.Camera]; move != "" {
			framing = strings.TrimSpace(framing + "，" + move)
		}
		if framing != "" {
			b.WriteString(strings.TrimPrefix(framing, "，") + "。\n")
		}
		if index > 0 && shot.Transition == TransitionBlack {
			b.WriteString("本镜从黑场淡入。\n")
		} else if index > 0 && shot.Transition == TransitionWhite {
			b.WriteString("本镜以短暂闪白切入。\n")
		}
		if index > 0 && strings.TrimSpace(shot.ImagePrompt) != "" {
			b.WriteString("起幅：" + strings.TrimSpace(shot.ImagePrompt) + "\n")
		}
		if action := strings.TrimSpace(shot.Action); action != "" {
			b.WriteString(action + "\n")
		}
		if motion := strings.TrimSpace(shot.VideoPrompt); motion != "" && motion != strings.TrimSpace(shot.Action) {
			b.WriteString(motion + "\n")
		}
		if dialogue := strings.TrimSpace(shot.Dialogue); dialogue != "" {
			speaker := strings.TrimSpace(shot.Speaker)
			if speaker == "" || IsNarrator(speaker) {
				speaker = "旁白（画外音）"
			}
			fmt.Fprintf(&b, "%s：“%s”\n", speaker, dialogue)
			if shot.DurationMs >= 2000 {
				fmt.Fprintf(&b, "台词说完留%s秒气口。\n", in.pauseText())
			}
		} else {
			b.WriteString("无台词。\n")
		}
		if index == len(in.Shots)-1 && in.Index < in.Count-1 && !in.Independent {
			fmt.Fprintf(&b, "末1.0秒全场硬定格，人物站位、表情与光线完全凝固，作为第%d段的无缝接续基准。\n", in.Index+2)
		}
	}
	return strings.TrimRight(b.String(), "\n")
}
