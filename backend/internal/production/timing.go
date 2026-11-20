package production

import (
	"math"
	"sort"
	"strings"
	"unicode"
)

const (
	MinShotMs     int64 = 1500
	DialoguePadMs int64 = 500
	DefaultShotMs int64 = 3000
)

// ShotDurationMs 按默认分镜规则计算镜头长度；作品内请使用 Settings.Storyboard.ShotMs。
func ShotDurationMs(hintSeconds float64, dialogue string) int64 {
	return StoryboardSettings{}.ShotMs(hintSeconds, dialogue)
}

// DurationOptions 描述视频模型可接受的秒数。
type DurationOptions struct {
	Values []int
	Min    int
	Max    int
	Step   int
}

// Bounds 返回模型单次可生成的最短与最长秒数；声明了档位时按档位取，0 表示未声明。
func (o DurationOptions) Bounds() (int, int) {
	if len(o.Values) == 0 {
		return max(o.Min, 0), max(o.Max, 0)
	}
	low, high := o.Values[0], o.Values[0]
	for _, value := range o.Values[1:] {
		low, high = min(low, value), max(high, value)
	}
	return max(low, 0), max(high, 0)
}

// SnapVideoSeconds 选择不短于镜头时长的最小可用秒数；渲染时再裁到镜头时长。
func SnapVideoSeconds(shotMs int64, options DurationOptions) int {
	need := int(math.Ceil(float64(shotMs) / 1000))
	if need < 1 {
		need = 1
	}
	candidates := append([]int(nil), options.Values...)
	if len(candidates) == 0 && options.Max > 0 {
		step := options.Step
		if step <= 0 {
			step = 1
		}
		start := options.Min
		if start <= 0 {
			start = step
		}
		for value := start; value <= options.Max && len(candidates) < 64; value += step {
			candidates = append(candidates, value)
		}
	}
	if len(candidates) == 0 {
		if need <= 5 {
			return 5
		}
		return 10
	}
	sort.Ints(candidates)
	for _, value := range candidates {
		if value >= need {
			return value
		}
	}
	return candidates[len(candidates)-1]
}

// NormalizeName 用于角色、场景名与别名的归并比较。
func NormalizeName(value string) string {
	var b strings.Builder
	for _, r := range strings.ToLower(strings.TrimSpace(value)) {
		if unicode.IsSpace(r) || unicode.IsPunct(r) {
			continue
		}
		b.WriteRune(r)
	}
	return b.String()
}

// CastIndex 按标准名与别名查找全剧设定，防止同一人物因称呼不同被重复建档。
type CastIndex struct {
	byName map[string]string
}

func NewCastIndex() *CastIndex { return &CastIndex{byName: map[string]string{}} }

func (c *CastIndex) Add(id string, names ...string) {
	for _, name := range names {
		if key := NormalizeName(name); key != "" {
			if _, exists := c.byName[key]; !exists {
				c.byName[key] = id
			}
		}
	}
}

func (c *CastIndex) Lookup(name string) (string, bool) {
	key := NormalizeName(name)
	if key == "" {
		return "", false
	}
	id, ok := c.byName[key]
	return id, ok
}

// IsNarrator 判断说话人是否为旁白。
func IsNarrator(speaker string) bool {
	key := NormalizeName(speaker)
	return key == "旁白" || key == "narrator" || key == "画外音"
}

const (
	MinSegmentShots = 3
	MaxSegmentShots = 9
)

// Segment 是一集中连续的一段剧情，一段一次调用视频模型。
type Segment struct {
	Start int
	End   int // 不含
	Title string
}

// SegmentShotsForVideo 按分镜规则把镜头切成剧情段，每段一次生成视频：
//   - 段总时长不超过 limits.MaxMs（已按视频模型单次上限收紧）；单个镜头已超过上限时独占一段。
//   - 智能与范围模式在场景切换处断开，范围模式要求当前段先达到 limits.MinMs；固定模式只按时长装箱。
//   - 时长不足下限或镜头过少的段，在不超上限时并入前一段。
//   - 最后一段不足下限又并不进前一段时，从前一段末尾挪镜头过来，两段都不低于下限、不超上限才挪；
//     挪不动就保留原样，提交时按模型档位向上取整补足时长。
func SegmentShotsForVideo(scenes []string, durations []int64, limits SegmentLimits) []Segment {
	if len(scenes) == 0 || len(durations) != len(scenes) {
		return nil
	}
	span := func(start, end int) int64 {
		var total int64
		for i := start; i < end; i++ {
			total += durations[i]
		}
		return total
	}
	sceneBreaks := limits.Mode != SegmentFixed
	var runs []Segment
	start := 0
	var total int64
	for k := range scenes {
		if k > start {
			over := limits.MaxMs > 0 && total+durations[k] > limits.MaxMs
			full := k-start >= MaxSegmentShots
			sceneChange := sceneBreaks && NormalizeName(scenes[k]) != NormalizeName(scenes[k-1]) && total >= limits.MinMs
			if over || full || sceneChange {
				runs = append(runs, Segment{Start: start, End: k})
				start, total = k, 0
			}
		}
		total += durations[k]
	}
	runs = append(runs, Segment{Start: start, End: len(scenes)})
	merged := make([]Segment, 0, len(runs))
	for _, run := range runs {
		if last := len(merged) - 1; last >= 0 {
			prev := merged[last]
			short := run.End-run.Start < MinSegmentShots || prev.End-prev.Start < MinSegmentShots || span(run.Start, run.End) < limits.MinMs
			fits := (limits.MaxMs <= 0 || span(prev.Start, run.End) <= limits.MaxMs) && run.End-prev.Start <= MaxSegmentShots
			if short && fits {
				merged[last].End = run.End
				continue
			}
		}
		merged = append(merged, run)
	}
	rebalanceTrailingSegment(merged, span, limits)
	for i := range merged {
		merged[i].Title = segmentTitle(scenes[merged[i].Start:merged[i].End])
	}
	return merged
}

// rebalanceTrailingSegment 让最后一段尽量达到下限：从前一段末尾挪最少的镜头过来。
// 挪完后前一段仍不低于下限、至少留一个镜头，最后一段不超上限和镜头上限才生效；否则不改动。
func rebalanceTrailingSegment(segments []Segment, span func(start, end int) int64, limits SegmentLimits) {
	last := len(segments) - 1
	if last < 1 || limits.MinMs <= 0 || span(segments[last].Start, segments[last].End) >= limits.MinMs {
		return
	}
	prev, tail := segments[last-1], segments[last]
	for start := tail.Start - 1; start > prev.Start; start-- {
		moved := span(start, tail.End)
		if (limits.MaxMs > 0 && moved > limits.MaxMs) || tail.End-start > MaxSegmentShots {
			return
		}
		if span(prev.Start, start) < limits.MinMs {
			return
		}
		if moved >= limits.MinMs {
			segments[last-1].End, segments[last].Start = start, start
			return
		}
	}
}

// segmentTitle 用段内依次出现的场景命名，最多 3 个。
func segmentTitle(scenes []string) string {
	var names []string
	seen := map[string]bool{}
	for _, scene := range scenes {
		name, key := strings.TrimSpace(scene), NormalizeName(scene)
		if name == "" || seen[key] {
			continue
		}
		seen[key] = true
		if len(names) < 3 {
			names = append(names, name)
		}
	}
	if len(names) == 0 {
		return "剧情段"
	}
	return strings.Join(names, " / ")
}
