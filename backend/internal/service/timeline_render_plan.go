package service

import (
	"fmt"
	"sort"
	"strings"
)

// 时间线渲染：把前端 TimelineProject 快照（tracks/clips 平铺，见
// web/src/types/timeline.ts TimelineProject v2）展开为可执行的 ffmpeg 步骤。
// 与前端 timeline-to-ffmpeg.ts 保持同一数据流：trim（按 sourceStartMs 裁切）
// → 空隙补黑场静音 → concat。字幕不烧录（依赖 libass），单独产出 SRT。
//
// 输入布局统一为「每个片段两个输入：视频源 + 音频源」，空隙展开为独立
// 黑场片段，因此第 i 个片段的视频输入为 2i、音频输入为 2i+1。

type renderClip struct {
	ID               string  `json:"id"`
	Kind             string  `json:"kind"`
	TrackID          string  `json:"trackId"`
	StartMs          int64   `json:"startMs"`
	DurationMs       int64   `json:"durationMs"`
	SourceStartMs    int64   `json:"sourceStartMs"`
	SourceDurationMs int64   `json:"sourceDurationMs"`
	Volume           float64 `json:"volume"`
	Text             string  `json:"text"`
	DirectMedia      *struct {
		ID         string `json:"id"`
		Kind       string `json:"kind"`
		StorageKey string `json:"storageKey"`
	} `json:"directMedia"`
}

type renderTrack struct {
	ID      string `json:"id"`
	Kind    string `json:"kind"`
	Visible *bool  `json:"visible"`
	Muted   bool   `json:"muted"`
}

type renderProject struct {
	Version    int           `json:"version"`
	Tracks     []renderTrack `json:"tracks"`
	Clips      []renderClip  `json:"clips"`
	DurationMs int64         `json:"durationMs"`
}

type renderSource struct {
	ResourceID string
	Clip       renderClip
	Path       string
	Ext        string
	// HasAudio 由 ffprobe 探测得到；无音轨的媒体改为静音源，避免 map 失败。
	HasAudio bool
}

// renderSegment 是渲染序列中的一段；Kind 为 video/image 表示媒体片段，
// gap 表示补黑场静音的空隙段（无 Source）。
type renderSegment struct {
	Kind       string
	DurationMs int64
	GapMs      int64
	Clip       renderClip
	Source     *renderSource
}

type renderPlan struct {
	Segments    []renderSegment
	SubtitleSRT string
	HasMedia    bool
}

// buildRenderPlan 挑选可见视频/图片轨片段按 startMs 排序，并把片段之间的
// 空隙展开为黑场段，使渲染序列在时间轴上连续。
func buildRenderPlan(project renderProject) renderPlan {
	visible := map[string]bool{}
	for _, track := range project.Tracks {
		visible[track.ID] = track.Visible == nil || *track.Visible
	}
	clips := make([]renderClip, 0, len(project.Clips))
	for _, clip := range project.Clips {
		if !visible[clip.TrackID] {
			continue
		}
		if clip.Kind != "video" && clip.Kind != "image" {
			continue
		}
		if clip.DurationMs <= 0 {
			continue
		}
		clips = append(clips, clip)
	}
	sort.SliceStable(clips, func(i, j int) bool {
		if clips[i].StartMs == clips[j].StartMs {
			return clips[i].ID < clips[j].ID
		}
		return clips[i].StartMs < clips[j].StartMs
	})

	plan := renderPlan{SubtitleSRT: buildRenderSubtitleSRT(project)}
	cursor := int64(0)
	for _, clip := range clips {
		if gap := clip.StartMs - cursor; gap > 0 {
			plan.Segments = append(plan.Segments, renderSegment{Kind: "gap", DurationMs: gap, GapMs: gap})
		}
		plan.Segments = append(plan.Segments, renderSegment{Kind: clip.Kind, DurationMs: clip.DurationMs, Clip: clip})
		cursor = clip.StartMs + clip.DurationMs
	}
	for _, seg := range plan.Segments {
		if _, ok := mediaResourceID(seg.Clip); ok {
			plan.HasMedia = true
			break
		}
	}
	return plan
}

// mediaResourceID 从片段的 directMedia.storageKey（resource:<id>）还原资源 ID。
func mediaResourceID(clip renderClip) (string, bool) {
	if clip.DirectMedia == nil {
		return "", false
	}
	key := strings.TrimSpace(clip.DirectMedia.StorageKey)
	if !strings.HasPrefix(key, "resource:") {
		return "", false
	}
	id := strings.TrimSpace(strings.TrimPrefix(key, "resource:"))
	return id, id != ""
}

func buildRenderSubtitleSRT(project renderProject) string {
	subtitle := make([]renderClip, 0, len(project.Clips))
	for _, clip := range project.Clips {
		if clip.Kind != "subtitle" || strings.TrimSpace(clip.Text) == "" || clip.DurationMs <= 0 {
			continue
		}
		subtitle = append(subtitle, clip)
	}
	sort.SliceStable(subtitle, func(i, j int) bool {
		if subtitle[i].StartMs == subtitle[j].StartMs {
			return subtitle[i].ID < subtitle[j].ID
		}
		return subtitle[i].StartMs < subtitle[j].StartMs
	})
	if len(subtitle) == 0 {
		return ""
	}
	var out strings.Builder
	for i, clip := range subtitle {
		fmt.Fprintf(&out, "%d\n%s --> %s\n%s\n\n",
			i+1,
			formatSRTTimestamp(clip.StartMs),
			formatSRTTimestamp(clip.StartMs+clip.DurationMs),
			strings.TrimSpace(clip.Text))
	}
	return out.String()
}

const (
	renderWidth      = 1920
	renderHeight     = 1080
	renderFPS        = 30
	renderSampleRate = 44100
)

// buildRenderFFmpegArgs 依据渲染计划生成 ffmpeg 参数（工作目录内相对路径）。
// 每段固定两个输入：视频源与音频源，末尾 concat 为单路输出。
func buildRenderFFmpegArgs(plan renderPlan, target string) []string {
	if len(plan.Segments) == 0 {
		return nil
	}
	scale := fmt.Sprintf("scale=%d:%d:force_original_aspect_ratio=decrease,pad=%d:%d:(ow-iw)/2:(oh-ih)/2",
		renderWidth, renderHeight, renderWidth, renderHeight)
	args := []string{"-nostdin", "-y"}
	for _, seg := range plan.Segments {
		seconds := fmt.Sprintf("%.3f", float64(seg.DurationMs)/1000)
		switch seg.Kind {
		case "gap":
			args = append(args,
				"-f", "lavfi", "-t", seconds,
				"-i", fmt.Sprintf("color=c=black:s=%dx%d:r=%d", renderWidth, renderHeight, renderFPS),
				"-f", "lavfi", "-t", seconds,
				"-i", fmt.Sprintf("anullsrc=r=%d:cl=stereo", renderSampleRate),
			)
		case "image":
			if seg.Source == nil {
				args = append(args,
					"-f", "lavfi", "-t", seconds,
					"-i", fmt.Sprintf("color=c=black:s=%dx%d:r=%d", renderWidth, renderHeight, renderFPS),
					"-f", "lavfi", "-t", seconds,
					"-i", fmt.Sprintf("anullsrc=r=%d:cl=stereo", renderSampleRate),
				)
				continue
			}
			args = append(args,
				"-loop", "1", "-t", seconds, "-i", seg.Source.Path,
				"-f", "lavfi", "-t", seconds,
				"-i", fmt.Sprintf("anullsrc=r=%d:cl=stereo", renderSampleRate),
			)
		default:
			if seg.Source == nil {
				args = append(args,
					"-f", "lavfi", "-t", seconds,
					"-i", fmt.Sprintf("color=c=black:s=%dx%d:r=%d", renderWidth, renderHeight, renderFPS),
					"-f", "lavfi", "-t", seconds,
					"-i", fmt.Sprintf("anullsrc=r=%d:cl=stereo", renderSampleRate),
				)
				continue
			}
			if seg.Clip.SourceStartMs > 0 {
				args = append(args, "-ss", fmt.Sprintf("%.3f", float64(seg.Clip.SourceStartMs)/1000))
			}
			args = append(args, "-t", seconds, "-i", seg.Source.Path)
			// 音频输入复用同一媒体文件；无音轨时 ffmpeg 会因 map 失败，
			// 由调用方探测后回退为静音源（见 renderAudioFallback）。
			if seg.Clip.SourceStartMs > 0 {
				args = append(args, "-ss", fmt.Sprintf("%.3f", float64(seg.Clip.SourceStartMs)/1000))
			}
			args = append(args, "-t", seconds, "-i", seg.Source.Path)
		}
	}

	filters := make([]string, 0, len(plan.Segments)*2+1)
	labels := make([]string, 0, len(plan.Segments)*2)
	for i, seg := range plan.Segments {
		videoIn := 2 * i
		audioIn := 2*i + 1
		videoLabel := fmt.Sprintf("v%d", i)
		audioLabel := fmt.Sprintf("a%d", i)
		if seg.Source != nil && seg.Kind != "image" && !seg.Source.HasAudio {
			// 无音轨媒体：改用静音源，避免 map 失败。
			audioIn = videoIn
			filters = append(filters,
				fmt.Sprintf("[%d:v]fps=%d,%s,setsar=1[%s]", videoIn, renderFPS, scale, videoLabel))
			silentLabel := fmt.Sprintf("silent%d", i)
			filters = append(filters,
				fmt.Sprintf("anullsrc=r=%d:cl=stereo[%s]", renderSampleRate, silentLabel))
			filters = append(filters,
				fmt.Sprintf("[%s]atrim=0:%.3f,asetpts=N/SR/TB[%s]", silentLabel, float64(seg.DurationMs)/1000, audioLabel))
		} else {
			volume := 1.0
			if seg.Clip.Volume > 0 {
				volume = seg.Clip.Volume
			}
			filters = append(filters,
				fmt.Sprintf("[%d:v]fps=%d,%s,setsar=1[%s]", videoIn, renderFPS, scale, videoLabel))
			filters = append(filters,
				fmt.Sprintf("[%d:a]aformat=sample_fmts=fltp:sample_rates=%d:channel_layouts=stereo,volume=%.3f,apad[%s]",
					audioIn, renderSampleRate, volume, audioLabel))
		}
		labels = append(labels, videoLabel, audioLabel)
	}
	var concatInputs strings.Builder
	for _, label := range labels {
		fmt.Fprintf(&concatInputs, "[%s]", label)
	}
	filters = append(filters, fmt.Sprintf("%sconcat=n=%d:v=1:a=1[vout][aout]", concatInputs.String(), len(plan.Segments)))

	args = append(args,
		"-filter_complex", strings.Join(filters, ";"),
		"-map", "[vout]", "-map", "[aout]",
		"-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-pix_fmt", "yuv420p",
		"-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart",
		"-t", fmt.Sprintf("%.3f", planTotalSeconds(plan)),
		target,
	)
	return args
}

func planTotalSeconds(plan renderPlan) float64 {
	var total int64
	for _, seg := range plan.Segments {
		total += seg.DurationMs
	}
	return float64(total) / 1000
}
