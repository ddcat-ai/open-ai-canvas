package production

import (
	"strings"
	"testing"
)

func TestExtractJSONObjectToleratesFences(t *testing.T) {
	raw := "好的，结果如下：\n```json\n{\"a\":1}\n```"
	got, err := ExtractJSONObject(raw)
	if err != nil || got != `{"a":1}` {
		t.Fatalf("got %q err %v", got, err)
	}
	if _, err := ExtractJSONObject("没有 JSON"); err == nil {
		t.Fatal("expected error")
	}
}

func TestReferenceTokensNormalizeAndFlagUnknownNumbers(t *testing.T) {
	text := CleanWrittenPrompt("林逸（@参考图1）站在石碑（参考图 3）旁，王镇山（参考图5）冷笑。")
	if text != "林逸（参考图1）站在石碑（参考图3）旁，王镇山（参考图5）冷笑。" {
		t.Fatalf("tokens must be normalized: %q", text)
	}
	if unknown := UnknownReferenceTokens(text, 4); len(unknown) != 1 || unknown[0] != "参考图5" {
		t.Fatalf("only out-of-range references are unknown: %v", unknown)
	}
}

func TestParsePlanCoversEveryChapterInBatch(t *testing.T) {
	batch := []Chapter{{Index: 1, Title: "一", Text: "甲"}, {Index: 2, Title: "二", Text: "乙"}, {Index: 3, Title: "三", Text: "丙"}}
	raw := `{"episodes":[{"title":"开端","chapters":[1,"2",9],"synopsis":"开端剧情"}]}`
	episodes, err := ParsePlan(raw, batch)
	if err != nil {
		t.Fatal(err)
	}
	if len(episodes) != 2 {
		t.Fatalf("want 2 episodes (one planned + one gap fill), got %d", len(episodes))
	}
	if got := episodes[0].Chapters; len(got) != 2 || got[0] != 1 || got[1] != 2 {
		t.Fatalf("chapter 9 is outside the batch and must be dropped: %v", got)
	}
	if episodes[1].Chapters[0] != 3 {
		t.Fatalf("uncovered chapter must become its own episode: %+v", episodes[1])
	}
}

func TestParseBibleDeduplicatesNames(t *testing.T) {
	raw := `{"characters":[{"name":"萧炎"},{"name":" 萧炎 "},{"name":"药老"}],"scenes":[{"name":"萧家"},{"name":"萧家"}]}`
	bible, err := ParseBible(raw)
	if err != nil {
		t.Fatal(err)
	}
	if len(bible.Characters) != 2 || len(bible.Scenes) != 1 {
		t.Fatalf("unexpected bible: %+v", bible)
	}
}

func TestParseScriptDropsEmptyShotsAndClearsSpeaker(t *testing.T) {
	raw := `{"shots":[{"action":"他抬头","speaker":"萧炎","dialogue":""},{"speaker":"x"}]}`
	shots, err := ParseScript(raw)
	if err != nil {
		t.Fatal(err)
	}
	if len(shots) != 1 || shots[0].Speaker != "" || shots[0].ImagePrompt != "他抬头" {
		t.Fatalf("unexpected shots: %+v", shots)
	}
}

func TestShotDurationFollowsDialogue(t *testing.T) {
	if got := ShotDurationMs(3, "台词"); got != 3000 {
		t.Fatalf("script hint wins over a short line, got %d", got)
	}
	if got := ShotDurationMs(0, ""); got != DefaultShotMs {
		t.Fatalf("default duration, got %d", got)
	}
	if got := ShotDurationMs(40, ""); got != 6000 {
		t.Fatalf("script hints are clamped to the pacing max, got %d", got)
	}
	// 台词比上限更长时以说完为准，不截断台词；仍受单镜绝对上限约束。
	if got := ShotDurationMs(0, strings.Repeat("话", 90)); got != 20500 {
		t.Fatalf("long dialogue must not be cut, got %d", got)
	}
	if got := ShotDurationMs(0, strings.Repeat("话", 400)); got != MaxStoryboardShotSeconds*1000 {
		t.Fatalf("absolute shot cap, got %d", got)
	}
}
func TestImportedShotKeepsWrittenDuration(t *testing.T) {
	rules := StoryboardSettings{}
	if got := rules.ImportedShotMs(8, ""); got != 8000 {
		t.Fatalf("a storyboard's 8s shot must stay 8s instead of the 6s pacing cap, got %d", got)
	}
	if got := rules.ImportedShotMs(1, strings.Repeat("话", 18)); got != 4500 {
		t.Fatalf("written duration still grows to fit the verbatim line, got %d", got)
	}
	if got := rules.ImportedShotMs(0, ""); got != DefaultShotMs {
		t.Fatalf("a missing duration falls back to the pacing estimate, got %d", got)
	}
	if got := rules.ImportedShotMs(90, ""); got != MaxStoryboardShotSeconds*1000 {
		t.Fatalf("same 60s cap as manual edits, got %d", got)
	}
}

func TestStoryboardRules(t *testing.T) {
	fast := StoryboardSettings{Pacing: PacingFast, Dialogue: DialogueDense, SegmentMode: SegmentFixed, SegmentSeconds: 10}
	if got := fast.ShotMs(9, ""); got != 4000 {
		t.Fatalf("fast pacing caps shots at 4s, got %d", got)
	}
	if got := fast.ShotTarget(300); got != 120 {
		t.Fatalf("5 minutes of 2.5s shots is 120 shots, got %d", got)
	}
	if got := fast.LineTarget(300); got != 100 {
		t.Fatalf("dense dialogue is a line every 3 seconds, got %d", got)
	}
	if got := fast.SegmentLimits(15); got != (SegmentLimits{Mode: SegmentFixed, MinMs: 10000, MaxMs: 10000}) {
		t.Fatalf("fixed segment keeps its length under the model max: %+v", got)
	}
	if got := (StoryboardSettings{SegmentMode: SegmentFixed, SegmentSeconds: 30}).SegmentLimits(15); got.MaxMs != 15000 {
		t.Fatalf("fixed segment is capped by the model max: %+v", got)
	}
	if got := (StoryboardSettings{}).SegmentLimits(15); got != (SegmentLimits{Mode: SegmentAuto, MaxMs: 15000}) {
		t.Fatalf("auto segment uses the model max: %+v", got)
	}
	if got := (StoryboardSettings{SegmentMode: SegmentRange, SegmentMinSeconds: 20, SegmentMaxSeconds: 8}).SegmentLimits(15); got != (SegmentLimits{Mode: SegmentRange, MinMs: 8000, MaxMs: 15000}) {
		t.Fatalf("range is ordered and capped by the model max: %+v", got)
	}
	rules := fast.PromptRules(300, fast.SegmentLimits(15))
	for _, want := range []string{"每 10 秒一个剧情段", "3–6 个镜头", "每 3 秒有一句", "参考全集 100 句", "逐字取自原文"} {
		if !strings.Contains(rules, want) {
			t.Fatalf("prompt rules missing %q:\n%s", want, rules)
		}
	}
	forced := StoryboardSettings{Transition: TransitionBlack}
	if forced.EffectiveTransition("cut", false) != TransitionBlack || forced.EffectiveTransition("", true) != TransitionCut {
		t.Fatalf("forced transition applies to every cut but never before the first shot")
	}
	if (StoryboardSettings{}).EffectiveTransition("闪白", false) != TransitionWhite {
		t.Fatalf("auto mode keeps the script transition")
	}
	if !strings.Contains(ScriptPrompt(ScriptContext{Segment: fast.SegmentLimits(15), Settings: Settings{EpisodeSeconds: 300, Storyboard: fast}}), "输出约 120 个镜头") {
		t.Fatalf("script prompt must use the storyboard shot target")
	}
}

func TestSnapVideoSeconds(t *testing.T) {
	if got := SnapVideoSeconds(4700, DurationOptions{Values: []int{10, 5}}); got != 5 {
		t.Fatalf("want 5, got %d", got)
	}
	if got := SnapVideoSeconds(5100, DurationOptions{Values: []int{5, 10}}); got != 10 {
		t.Fatalf("want 10, got %d", got)
	}
	if got := SnapVideoSeconds(3200, DurationOptions{Min: 2, Max: 12, Step: 1}); got != 4 {
		t.Fatalf("want 4, got %d", got)
	}
	if got := SnapVideoSeconds(20000, DurationOptions{Values: []int{5, 10}}); got != 10 {
		t.Fatalf("longest available, got %d", got)
	}
}

func TestCastIndexMatchesAliases(t *testing.T) {
	index := NewCastIndex()
	index.Add("c1", "萧炎", "炎儿", "萧少爷")
	if id, ok := index.Lookup("炎儿"); !ok || id != "c1" {
		t.Fatal("alias lookup failed")
	}
	if _, ok := index.Lookup("药老"); ok {
		t.Fatal("unexpected match")
	}
}

func TestSampleNovelRespectsBudget(t *testing.T) {
	chapters := make([]Chapter, 100)
	for i := range chapters {
		chapters[i] = Chapter{Index: i + 1, Title: "章", Text: strings.Repeat("字", 2000)}
	}
	sample := SampleNovel(chapters, 10000)
	if n := len([]rune(sample)); n > 11000 {
		t.Fatalf("sample too long: %d", n)
	}
	if !strings.Contains(sample, "节选") {
		t.Fatal("later chapters should be sampled")
	}
}

func TestSegmentShotsGroupsScenesIntoReviewableBlocks(t *testing.T) {
	scenes := []string{"大厅", "大厅", "大厅", "大厅", "后山", "后山", "后山", "后山", "后山", "后山", "后山", "后山", "后山", "后山", "后山", "后山", "门口"}
	durations := make([]int64, len(scenes))
	for i := range durations {
		durations[i] = 2000
	}
	segments := SegmentShotsForVideo(scenes, durations, SegmentLimits{Mode: SegmentAuto})
	covered := 0
	for i, segment := range segments {
		size := segment.End - segment.Start
		if size > MaxSegmentShots {
			t.Fatalf("segment %d too large: %d", i, size)
		}
		if segment.Start != covered {
			t.Fatalf("segments must be contiguous: %+v", segments)
		}
		covered = segment.End
	}
	if covered != len(scenes) {
		t.Fatalf("segments must cover all shots: %d/%d", covered, len(scenes))
	}
	if segments[0].Title != "大厅" || segments[0].End != 4 {
		t.Fatalf("first scene should be its own segment: %+v", segments[0])
	}
	// 尾部只有 1 镜的“门口”必须并入前一段，而不是单独成段。
	last := segments[len(segments)-1]
	if last.End-last.Start < MinSegmentShots {
		t.Fatalf("tiny tail segment should be merged: %+v", segments)
	}
}

func TestSegmentVideoPrompt(t *testing.T) {
	prompt := SegmentVideoPrompt(SegmentPromptInput{
		Index: 2, Count: 4, Title: "神丹入腹", AspectRatio: "9:16", Style: "国漫3D", Language: "中文", FirstFrame: true,
		References: []SegmentReference{{Label: "参考图1", Kind: "character", Name: "陆沉", Detail: "18岁少年，粗麻道袍", Voice: "低沉青年音"}, {Label: "参考图2", Kind: "scene", Name: "演武台", Detail: "汉白玉浮空台"}},
		Shots: []SegmentShot{
			{ShotSize: "特写", Camera: "推", ImagePrompt: "陆沉趴在泥里", Action: "陆沉吞下神丹", Speaker: "二狗", Dialogue: "张嘴！", DurationMs: 5500},
			{ShotSize: "中景", Camera: "固定", Action: "金色气浪炸开", DurationMs: 6000, Transition: TransitionBlack},
		},
	})
	for _, want := range []string{
		"严格从第2段视频末尾硬定格", "第3段视频《神丹入腹》", "11.5秒｜9:16｜国漫3D｜中文对白｜无字幕｜2个镜头",
		"首帧即第2段视频最后一帧（随请求附带）", "陆沉（参考图1）：18岁少年", "演武台（参考图2）：汉白玉浮空台", "陆沉：低沉青年音",
		"【00.00—05.50秒｜镜头一：特写·推】", "85mm特写，缓慢推近。", "二狗：“张嘴！”",
		"【05.50—11.50秒｜镜头二：中景】", "本镜从黑场淡入。", "无台词。", "作为第4段的无缝接续基准",
	} {
		if !strings.Contains(prompt, want) {
			t.Fatalf("segment prompt missing %q:\n%s", want, prompt)
		}
	}
	pending := SegmentVideoPrompt(SegmentPromptInput{Index: 1, Count: 4, Shots: []SegmentShot{{DurationMs: 3000, ImagePrompt: "雨夜"}}})
	if strings.Contains(pending, "最后一帧（随请求附带）") || !strings.Contains(pending, "上一段视频尚未生成") {
		t.Fatalf("without a tail frame the prompt must not claim one is attached:\n%s", pending)
	}
	last := SegmentVideoPrompt(SegmentPromptInput{Index: 3, Count: 4, Shots: []SegmentShot{{DurationMs: 3000}}})
	if strings.Contains(last, "接续基准") {
		t.Fatal("the last segment must not freeze for a next segment")
	}
}

func TestSegmentPromptKeepsDialogueAndNativeVoice(t *testing.T) {
	prompt := SegmentVideoPrompt(SegmentPromptInput{Index: 0, Count: 2, Language: "中文", Shots: []SegmentShot{{Speaker: "林逸", Dialogue: "我来守护你。", DurationMs: 5000}}, References: []SegmentReference{{Kind: "character", Name: "林逸", Voice: "少年低沉", Label: "参考图1"}}})
	for _, text := range []string{"我来守护你。", "少年低沉", "口型与台词同步", "末1.0秒"} {
		if !strings.Contains(prompt, text) {
			t.Fatalf("missing %s: %s", text, prompt)
		}
	}
}

func TestSegmentShotsForVideoRespectsModelLimit(t *testing.T) {
	scenes := []string{"大殿", "大殿", "大殿", "大殿", "后山", "后山"}
	durations := []int64{5000, 5000, 5000, 5000, 4000, 4000}
	segments := SegmentShotsForVideo(scenes, durations, SegmentLimits{Mode: SegmentAuto, MaxMs: 15000})
	// 大殿第 4 镜超出 15 秒被切出，只有 1 镜，可与后山合并（5+8=13 秒 ≤ 15 秒）。
	want := []Segment{{Start: 0, End: 3, Title: "大殿"}, {Start: 3, End: 6, Title: "大殿 / 后山"}}
	if len(segments) != len(want) {
		t.Fatalf("segments = %+v", segments)
	}
	for i := range want {
		if segments[i] != want[i] {
			t.Fatalf("segment %d = %+v, want %+v", i, segments[i], want[i])
		}
	}
	long := SegmentShotsForVideo([]string{"a", "a"}, []int64{20000, 3000}, SegmentLimits{Mode: SegmentAuto, MaxMs: 15000})
	if len(long) != 2 || long[0].End != 1 {
		t.Fatalf("a shot longer than the limit must stand alone: %+v", long)
	}
	// 固定 10 秒：跨场景也按时长装箱，不在场景切换处断开。
	fixed := SegmentShotsForVideo(scenes, durations, SegmentLimits{Mode: SegmentFixed, MinMs: 10000, MaxMs: 10000})
	if len(fixed) != 3 || fixed[0].End != 2 || fixed[1].End != 4 || fixed[2].End != 6 || fixed[2].Title != "后山" {
		t.Fatalf("fixed segments pack by duration: %+v", fixed)
	}
	// 范围 12–20 秒：大殿 20 秒成段；后山 8 秒不足下限，但并入会超过上限，只能单独成段。
	ranged := SegmentShotsForVideo(scenes, durations, SegmentLimits{Mode: SegmentRange, MinMs: 12000, MaxMs: 20000})
	if len(ranged) != 2 || ranged[0].End != 4 || ranged[1].Title != "后山" {
		t.Fatalf("range segments break at scene changes once the minimum is met: %+v", ranged)
	}
	// 范围 12–20 秒、场景很碎：未达到下限时不在场景切换处断开。
	choppy := SegmentShotsForVideo([]string{"a", "b", "c", "d", "e", "f"}, []int64{4000, 4000, 4000, 4000, 4000, 4000}, SegmentLimits{Mode: SegmentRange, MinMs: 12000, MaxMs: 20000})
	if len(choppy) != 2 || choppy[0].End != 3 || choppy[0].Title != "a / b / c" {
		t.Fatalf("range segments wait for the minimum before a scene break: %+v", choppy)
	}
}

func TestSegmentWriterUsesSkill(t *testing.T) {
	in := SegmentPromptInput{Index: 0, Count: 2, Shots: []SegmentShot{{DurationMs: 5000, Dialogue: "醒了"}}}
	plain := SegmentWriterPrompt(in, "素材", "", nil)
	if strings.Contains(plain, "【写作技能") {
		t.Fatal("no skill selected must not mention a skill")
	}
	withSkill := SegmentWriterPrompt(in, "素材", "", &WritingSkill{Name: "老李分镜", Path: "SKILL.md", Content: "每段先写承接，再写五镜"})
	for _, want := range []string{"【写作技能：老李分镜】", "SKILL.md", "每段先写承接，再写五镜", "【硬性规则】始终适用"} {
		if !strings.Contains(withSkill, want) {
			t.Fatalf("skill prompt missing %q", want)
		}
	}
}
