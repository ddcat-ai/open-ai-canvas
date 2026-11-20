package app

import (
	"encoding/json"
	"strings"
	"testing"
)

func renderClipFixture(id string, kind string, trackID string, startMs int64, durationMs int64, storageKey string) renderClip {
	clip := renderClip{ID: id, Kind: kind, TrackID: trackID, StartMs: startMs, DurationMs: durationMs, Volume: 1}
	if storageKey != "" {
		clip.DirectMedia = &struct {
			ID         string `json:"id"`
			Kind       string `json:"kind"`
			StorageKey string `json:"storageKey"`
		}{ID: "media-" + id, Kind: kind, StorageKey: storageKey}
	}
	return clip
}

func TestBuildRenderPlanExpandsGapAndSorts(t *testing.T) {
	project := renderProject{
		Version: 2,
		Tracks:  []renderTrack{{ID: "track-video-1", Kind: "video"}},
		Clips: []renderClip{
			renderClipFixture("clip-b", "video", "track-video-1", 3000, 2000, "resource:res-b"),
			renderClipFixture("clip-a", "video", "track-video-1", 0, 2000, "resource:res-a"),
			renderClipFixture("clip-sub", "subtitle", "track-subtitle-1", 0, 1000, ""),
		},
	}
	plan := buildRenderPlan(project)
	if !plan.HasMedia {
		t.Fatal("HasMedia = false, want true")
	}
	// 前 0–3000ms 被 clip-a(0-2000) 覆盖后仍有 1000ms 空隙，应展开为黑场段。
	if len(plan.Segments) != 3 {
		t.Fatalf("segments = %d, want 3 (clip-a, gap, clip-b)", len(plan.Segments))
	}
	if plan.Segments[0].Kind != "video" || plan.Segments[0].Clip.ID != "clip-a" {
		t.Fatalf("seg0 = %s/%s, want video/clip-a", plan.Segments[0].Kind, plan.Segments[0].Clip.ID)
	}
	if plan.Segments[1].Kind != "gap" || plan.Segments[1].DurationMs != 1000 {
		t.Fatalf("seg1 = %s/%dms, want gap/1000ms", plan.Segments[1].Kind, plan.Segments[1].DurationMs)
	}
	if plan.Segments[2].Clip.ID != "clip-b" {
		t.Fatalf("seg2 = %s, want clip-b (sorted by startMs)", plan.Segments[2].Clip.ID)
	}
}

func TestBuildRenderPlanSkipsHiddenTrack(t *testing.T) {
	hidden := false
	project := renderProject{
		Version: 2,
		Tracks:  []renderTrack{{ID: "track-hidden", Kind: "video", Visible: &hidden}},
		Clips:   []renderClip{renderClipFixture("clip-hidden", "video", "track-hidden", 0, 1000, "resource:res-x")},
	}
	plan := buildRenderPlan(project)
	if len(plan.Segments) != 0 {
		t.Fatalf("segments = %d, want 0 (hidden track skipped)", len(plan.Segments))
	}
	if plan.HasMedia {
		t.Fatal("HasMedia = true, want false for hidden-only timeline")
	}
}

func TestBuildRenderSubtitleSRT(t *testing.T) {
	project := renderProject{
		Version: 2,
		Clips: []renderClip{
			{ID: "sub-b", Kind: "subtitle", StartMs: 2000, DurationMs: 1000, Text: "第二条"},
			{ID: "sub-a", Kind: "subtitle", StartMs: 0, DurationMs: 1000, Text: "第一条"},
			{ID: "sub-blank", Kind: "subtitle", StartMs: 5000, DurationMs: 1000, Text: "   "},
		},
	}
	srt := buildRenderSubtitleSRT(project)
	want := "1\n00:00:00,000 --> 00:00:01,000\n第一条\n\n2\n00:00:02,000 --> 00:00:03,000\n第二条\n\n"
	if srt != want {
		t.Fatalf("srt mismatch:\n got %q\nwant %q", srt, want)
	}
	if buildRenderSubtitleSRT(renderProject{Version: 2}) != "" {
		t.Fatal("srt for empty timeline: want empty string")
	}
}

func TestBuildRenderFFmpegArgsLayout(t *testing.T) {
	plan := buildRenderPlan(renderProject{
		Version: 2,
		Tracks:  []renderTrack{{ID: "track-video-1", Kind: "video"}},
		Clips: []renderClip{
			renderClipFixture("clip-a", "video", "track-video-1", 0, 2000, "resource:res-a"),
			renderClipFixture("clip-b", "video", "track-video-1", 5000, 1000, "resource:res-b"),
		},
	})
	plan.Segments[0].Source = &renderSource{ResourceID: "res-a", Path: "src-0.mp4", HasAudio: true}
	plan.Segments[1].Source = &renderSource{ResourceID: "res-a", Path: "src-0.mp4", HasAudio: true}
	plan.Segments[2].Source = &renderSource{ResourceID: "res-b", Path: "src-1.mp4", HasAudio: true}

	args := buildRenderFFmpegArgs(plan, "render-output.mp4")
	joined := strings.Join(args, " ")
	if len(args) == 0 {
		t.Fatal("args empty, want ffmpeg arguments")
	}
	for _, want := range []string{
		"-filter_complex",
		"concat=n=3:v=1:a=1",
		"[vout]", "[aout]",
		"libx264", "aac",
		"color=c=black:s=1920x1080:r=30",
		"anullsrc=r=44100:cl=stereo",
		"render-output.mp4",
	} {
		if !strings.Contains(joined, want) {
			t.Fatalf("args missing %q: %s", want, joined)
		}
	}
	// 每段两个输入：视频 + 音频；末尾输入索引应为 5（3 段 × 2）。
	if !strings.Contains(joined, "[5:a]") {
		t.Fatalf("args missing final audio input label [5:a]: %s", joined)
	}
	if buildRenderFFmpegArgs(renderPlan{}, "out.mp4") != nil {
		t.Fatal("args for empty plan: want nil")
	}
}

func TestBuildRenderFFmpegArgsSilentFallbackUniqueLabels(t *testing.T) {
	plan := renderPlan{Segments: []renderSegment{
		{Kind: "video", DurationMs: 1000, Source: &renderSource{Path: "src-0.mp4", HasAudio: false}},
		{Kind: "video", DurationMs: 1000, Source: &renderSource{Path: "src-1.mp4", HasAudio: false}},
	}}
	args := buildRenderFFmpegArgs(plan, "out.mp4")
	joined := strings.Join(args, " ")
	// 两段均无音轨：静音源标签必须按片段唯一，否则 filter_complex 报错。
	if !strings.Contains(joined, "[silent0]") || !strings.Contains(joined, "[silent1]") {
		t.Fatalf("silent labels not unique: %s", joined)
	}
}

func TestMediaResourceID(t *testing.T) {
	clip := renderClipFixture("a", "video", "track-1", 0, 1000, "resource:res-42")
	if id, ok := mediaResourceID(clip); !ok || id != "res-42" {
		t.Fatalf("mediaResourceID = %q/%v, want res-42/true", id, ok)
	}
	if _, ok := mediaResourceID(renderClip{}); ok {
		t.Fatal("mediaResourceID for clip without directMedia: want false")
	}
	if _, ok := mediaResourceID(renderClipFixture("a", "video", "track-1", 0, 1000, "https://example.com/a.mp4")); ok {
		t.Fatal("mediaResourceID for http storage key: want false")
	}
}

func TestRenderSegmentFitRule(t *testing.T) {
	source := func(width, height int) *renderSource { return &renderSource{Width: width, Height: height} }
	cases := []struct {
		name   string
		mode   string
		source *renderSource
		want   string
	}{
		{"768x1344 into 9:16 is within 3% and crops", renderFitAuto, source(768, 1344), renderFitCrop},
		{"exact aspect crops (no-op)", renderFitAuto, source(720, 1280), renderFitCrop},
		{"landscape into portrait pads", renderFitAuto, source(1920, 1080), renderFitPad},
		{"3:4 into 9:16 pads", renderFitAuto, source(1080, 1440), renderFitPad},
		{"just over 3% pads", renderFitAuto, source(1000, 1720), renderFitPad},
		{"unknown size pads", renderFitAuto, source(0, 0), renderFitPad},
		{"gap segment pads", renderFitAuto, nil, renderFitPad},
		{"forced pad wins over matching aspect", renderFitPad, source(768, 1344), renderFitPad},
		{"forced crop wins over mismatched aspect", renderFitCrop, source(1920, 1080), renderFitCrop},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := renderSegmentFit(tc.mode, tc.source, 1080, 1920); got != tc.want {
				t.Fatalf("fit = %s, want %s", got, tc.want)
			}
		})
	}
	for input, want := range map[string]string{"": renderFitAuto, "AUTO": renderFitAuto, " pad ": renderFitPad, "crop": renderFitCrop, "stretch": renderFitAuto} {
		if got := normalizeRenderFit(input); got != want {
			t.Fatalf("normalizeRenderFit(%q) = %s, want %s", input, got, want)
		}
	}
}

func TestBuildRenderFFmpegArgsChoosesCropOrPadPerSegment(t *testing.T) {
	plan := buildRenderPlan(renderProject{
		Version: 2, Width: 1080, Height: 1920,
		Tracks: []renderTrack{{ID: "track-video-1", Kind: "video"}},
		Clips: []renderClip{
			renderClipFixture("clip-a", "video", "track-video-1", 0, 1000, "resource:res-a"),
			renderClipFixture("clip-b", "video", "track-video-1", 1000, 1000, "resource:res-b"),
		},
	})
	plan.Segments[0].Source = &renderSource{ResourceID: "res-a", Path: "src-0.mp4", HasAudio: true, Width: 768, Height: 1344}
	plan.Segments[1].Source = &renderSource{ResourceID: "res-b", Path: "src-1.mp4", HasAudio: true, Width: 1920, Height: 1080}
	filter := ""
	args := buildRenderFFmpegArgs(plan, "out.mp4")
	for i, arg := range args {
		if arg == "-filter_complex" {
			filter = args[i+1]
		}
	}
	crop := "[0:v]fps=30,scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,setsar=1"
	pad := "[2:v]fps=30,scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2,setsar=1"
	if !strings.Contains(filter, crop) || !strings.Contains(filter, pad) {
		t.Fatalf("filter graph does not crop the near-aspect clip and pad the other:\n%s", filter)
	}

	plan.Fit = renderFitPad
	forced := strings.Join(buildRenderFFmpegArgs(plan, "out.mp4"), " ")
	if strings.Contains(forced, "crop=") || strings.Count(forced, "force_original_aspect_ratio=decrease") != 2 {
		t.Fatalf("fit=pad must pad every segment: %s", forced)
	}

	records := renderSourceRecords(renderPlan{Width: 1080, Height: 1920, Segments: plan.Segments})
	if len(records) != 2 || records[0].Fit != renderFitCrop || records[1].Fit != renderFitPad || records[0].ClipID != "clip-a" || records[0].Width != 768 {
		t.Fatalf("source records = %+v", records)
	}
}

func renderArgValue(t *testing.T, args []string, flag string, prefix string) []string {
	t.Helper()
	values := []string{}
	for i := 0; i+1 < len(args); i++ {
		if args[i] == flag && strings.HasPrefix(args[i+1], prefix) {
			values = append(values, strings.TrimPrefix(args[i+1], prefix))
		}
	}
	return values
}

func TestBuildRenderFFmpegArgsWritesAIGCMetadata(t *testing.T) {
	plan := renderPlan{PropagateID: "tsk-render-1", Segments: []renderSegment{
		{Kind: "video", DurationMs: 1000, Clip: renderClip{ID: "clip-a"}, Source: &renderSource{ResourceID: "res-a", Path: "src-0.mp4", HasAudio: true}},
		{Kind: "video", DurationMs: 1000, Clip: renderClip{ID: "clip-b"}, Source: &renderSource{ResourceID: "res-b", Path: "src-1.mp4", HasAudio: true,
			AIGC: `{"Label":2,"ContentProducer":"upstream-co","ProduceID":"p-1","ReservedCode1":"sig"}`}},
	}}
	args := buildRenderFFmpegArgs(plan, "out.mp4")
	if values := renderArgValue(t, args, "-map_metadata", ""); len(values) != 1 || values[0] != "-1" {
		t.Fatalf("-map_metadata = %v, want [-1]", values)
	}
	if values := renderArgValue(t, args, "-movflags", ""); len(values) != 1 || values[0] != "+faststart+use_metadata_tags" {
		t.Fatalf("-movflags = %v, want a single +faststart+use_metadata_tags", values)
	}
	if values := renderArgValue(t, args, "-metadata", "comment="); len(values) != 1 || values[0] == "" {
		t.Fatalf("comment metadata = %v", values)
	}
	values := renderArgValue(t, args, "-metadata", "AIGC=")
	if len(values) != 1 {
		t.Fatalf("AIGC metadata = %v, want exactly one", values)
	}
	var label map[string]string
	if err := json.Unmarshal([]byte(values[0]), &label); err != nil {
		t.Fatalf("AIGC metadata is not valid JSON: %v (%s)", err, values[0])
	}
	want := map[string]string{"Label": "2", "ContentProducer": "upstream-co", "ProduceID": "p-1", "ReservedCode1": "", "ContentPropagator": AIGCPlatformPropagator, "PropagateID": "tsk-render-1", "ReservedCode2": ""}
	if len(label) != len(want) {
		t.Fatalf("AIGC fields = %v, want %v", label, want)
	}
	for key, value := range want {
		if got, ok := label[key]; !ok || got != value {
			t.Fatalf("AIGC[%s] = %q (present=%v), want %q", key, got, ok, value)
		}
	}
	// 输出选项必须位于目标文件之前。
	if args[len(args)-1] != "out.mp4" {
		t.Fatalf("target is not the last argument: %v", args[len(args)-3:])
	}

	// 来源没有标识：平台合成的成片按 AI 生成合成内容标记，生产方留空。
	plain := renderAIGCLabel(renderPlan{PropagateID: "tsk-2", Segments: []renderSegment{{Kind: "video", Source: &renderSource{AIGC: "not-json"}}}})
	if plain.Label != "1" || plain.ContentProducer != "" || plain.PropagateID != "tsk-2" || plain.ContentPropagator != AIGCPlatformPropagator {
		t.Fatalf("label without source provenance = %+v", plain)
	}
}
