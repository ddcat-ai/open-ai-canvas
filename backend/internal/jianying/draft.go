// Package jianying 生成剪映（JianYing / CapCut）专业版可直接打开的草稿文件夹内容。
//
// 草稿结构参考 pyJianYingDraft 的模板：剪映 5.x 以及新版（6.0 起会加密自己保存的草稿）都能打开
// 外部生成的明文草稿。素材必须是绝对路径，所以调用方要提供用户本机的剪映草稿目录；
// 草稿文件夹解压到该目录后才能找到素材，否则剪映会提示素材丢失并允许重新链接。
package jianying

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"regexp"
	"strings"
	"time"
	"unicode/utf8"
)

// MaterialsDir 是草稿文件夹内存放视频素材的子目录。
const MaterialsDir = "materials"

// CoverFile 是草稿封面文件名，剪映列表页读取它显示缩略图。
const CoverFile = "draft_cover.jpg"

// Clip 是主视频轨上按顺序首尾相接的一段视频。
type Clip struct {
	// FileName 是 materials 目录内的文件名。
	FileName   string
	Name       string
	DurationUs int64
	Width      int
	Height     int
}

// Caption 是字幕轨上的一条文字。
type Caption struct {
	Text       string
	StartUs    int64
	DurationUs int64
}

// Draft 描述一份草稿。Root 是剪映草稿目录（用户本机绝对路径），Name 同时是草稿文件夹名。
type Draft struct {
	Name     string
	Root     string
	Width    int
	Height   int
	FPS      int
	Clips    []Clip
	Captions []Caption
	HasCover bool
	Now      time.Time
}

var windowsRoot = regexp.MustCompile(`^[A-Za-z]:[\\/]`)

// NormalizeRoot 校验并规范化剪映草稿目录：必须是 macOS/Linux 或 Windows 的绝对路径，去掉末尾分隔符。
func NormalizeRoot(raw string) (string, error) {
	root := strings.TrimSpace(raw)
	if root == "" {
		return "", errors.New("请填写剪映草稿目录")
	}
	if utf8.RuneCountInString(root) > 400 || strings.ContainsAny(root, "\x00\r\n\t\"") {
		return "", errors.New("剪映草稿目录包含无效字符")
	}
	if !strings.HasPrefix(root, "/") && !windowsRoot.MatchString(root) {
		return "", errors.New("剪映草稿目录必须是绝对路径，例如 /Users/你的用户名/Movies/JianyingPro/User Data/Projects/com.lveditor.draft")
	}
	trimmed := strings.TrimRight(root, `/\`)
	if trimmed == "" || (windowsRoot.MatchString(root) && len(trimmed) <= 2) {
		return "", errors.New("剪映草稿目录不能是磁盘根目录")
	}
	return trimmed, nil
}

var unsafeName = regexp.MustCompile(`[\\/:*?"<>|\x00-\x1f]+`)

// SafeName 生成可用作文件夹或文件名的片段。
func SafeName(raw string, fallback string, limit int) string {
	name := strings.TrimSpace(unsafeName.ReplaceAllString(raw, "-"))
	name = strings.Trim(name, ". ")
	if name == "" {
		name = fallback
	}
	runes := []rune(name)
	if len(runes) > limit {
		name = strings.TrimSpace(string(runes[:limit]))
	}
	return name
}

func (d Draft) separator() string {
	if windowsRoot.MatchString(d.Root) {
		return `\`
	}
	return "/"
}

// FolderPath 是草稿文件夹在用户本机的绝对路径。
func (d Draft) FolderPath() string {
	return d.Root + d.separator() + d.Name
}

// MaterialPath 是素材在用户本机的绝对路径。
func (d Draft) MaterialPath(fileName string) string {
	sep := d.separator()
	return d.FolderPath() + sep + MaterialsDir + sep + fileName
}

// DurationUs 是主视频轨总时长。
func (d Draft) DurationUs() int64 {
	var total int64
	for _, clip := range d.Clips {
		total += clip.DurationUs
	}
	return total
}

func newUUID() string {
	var raw [16]byte
	_, _ = rand.Read(raw[:])
	raw[6] = (raw[6] & 0x0f) | 0x40
	raw[8] = (raw[8] & 0x3f) | 0x80
	encoded := strings.ToUpper(hex.EncodeToString(raw[:]))
	return encoded[0:8] + "-" + encoded[8:12] + "-" + encoded[12:16] + "-" + encoded[16:20] + "-" + encoded[20:]
}

func timerange(start, duration int64) map[string]any {
	return map[string]any{"start": start, "duration": duration}
}

func speedMaterial() map[string]any {
	return map[string]any{"curve_speed": nil, "id": newUUID(), "mode": 0, "speed": 1.0, "type": "speed"}
}

func baseSegment(materialID string, start, duration int64, renderIndex int, refs []string, clip map[string]any) map[string]any {
	return map[string]any{
		"enable_adjust": true, "enable_color_correct_adjust": false, "enable_color_curves": true, "enable_color_match_adjust": false,
		"enable_color_wheels": true, "enable_lut": true, "enable_smart_color_adjust": false, "last_nonzero_volume": 1.0, "reverse": false,
		"track_attribute": 0, "track_render_index": 0, "visible": true, "id": newUUID(), "material_id": materialID,
		"target_timerange": timerange(start, duration), "common_keyframes": []any{}, "keyframe_refs": []any{},
		"speed": 1.0, "volume": 1.0, "extra_material_refs": refs, "is_tone_modify": false,
		"clip": clip, "uniform_scale": map[string]any{"on": true, "value": 1.0}, "render_index": renderIndex,
	}
}

func clipSettings(transformY float64) map[string]any {
	return map[string]any{
		"alpha": 1.0, "flip": map[string]any{"horizontal": false, "vertical": false}, "rotation": 0.0,
		"scale": map[string]any{"x": 1.0, "y": 1.0}, "transform": map[string]any{"x": 0.0, "y": transformY},
	}
}

func track(kind string, name string, segments []any) map[string]any {
	return map[string]any{"attribute": 0, "flag": 0, "id": newUUID(), "is_default_name": name == "", "name": name, "segments": segments, "type": kind}
}

// subtitleMaterial 复刻剪映导入字幕的默认样式：白字黑描边、居中、自动换行，位于画面下方。
func subtitleMaterial(id string, text string) (map[string]any, error) {
	content, err := json.Marshal(map[string]any{
		"styles": []any{map[string]any{
			"fill":  map[string]any{"alpha": 1.0, "content": map[string]any{"render_type": "solid", "solid": map[string]any{"alpha": 1.0, "color": []float64{1, 1, 1}}}},
			"range": []int{0, utf8.RuneCountInString(text)}, "size": 6.0, "bold": false, "italic": false, "underline": false,
			"strokes": []any{map[string]any{"content": map[string]any{"solid": map[string]any{"alpha": 1.0, "color": []float64{0, 0, 0}}}, "width": 0.08}},
		}},
		"text": text,
	})
	if err != nil {
		return nil, err
	}
	return map[string]any{
		"id": id, "content": string(content), "typesetting": 0, "alignment": 1, "letter_spacing": 0.0, "line_spacing": 0.02,
		"line_feed": 1, "line_max_width": 0.82, "force_apply_line_max_width": false, "check_flag": 15, "type": "subtitle", "global_alpha": 1.0,
	}, nil
}

func emptyMaterials() map[string]any {
	materials := map[string]any{}
	for _, key := range []string{
		"ai_translates", "audio_balances", "audio_effects", "audio_fades", "audio_track_indexes", "audios", "beats", "canvases", "chromas",
		"color_curves", "digital_humans", "drafts", "effects", "flowers", "green_screens", "handwrites", "hsl", "images", "log_color_wheels",
		"loudnesses", "manual_deformations", "masks", "material_animations", "material_colors", "multi_language_refs", "placeholders",
		"plugin_effects", "primary_color_wheels", "realtime_denoises", "shapes", "smart_crops", "smart_relights", "sound_channel_mappings",
		"speeds", "stickers", "tail_leaders", "text_templates", "texts", "time_marks", "transitions", "video_effects", "video_trackings",
		"videos", "vocal_beautifys", "vocal_separations",
	} {
		materials[key] = []any{}
	}
	return materials
}

// Build 返回 draft_content.json（Windows 读取）/ draft_info.json（macOS 读取，内容相同）与 draft_meta_info.json。
func Build(d Draft) ([]byte, []byte, error) {
	if d.Name == "" || d.Root == "" || len(d.Clips) == 0 || d.Width <= 0 || d.Height <= 0 {
		return nil, nil, errors.New("草稿缺少名称、目录、尺寸或视频片段")
	}
	fps := d.FPS
	if fps <= 0 {
		fps = 30
	}
	now := d.Now
	if now.IsZero() {
		now = time.Now()
	}
	materials := emptyMaterials()
	videos := []any{}
	speeds := []any{}
	videoSegments := []any{}
	var cursor int64
	for _, clip := range d.Clips {
		if clip.DurationUs <= 0 || clip.FileName == "" {
			return nil, nil, fmt.Errorf("视频片段 %q 缺少时长或文件名", clip.Name)
		}
		width, height := clip.Width, clip.Height
		if width <= 0 || height <= 0 {
			width, height = d.Width, d.Height
		}
		materialID := newUUID()
		videos = append(videos, map[string]any{
			"audio_fade": nil, "category_id": "", "category_name": "local", "check_flag": 63487,
			"crop":       map[string]any{"upper_left_x": 0.0, "upper_left_y": 0.0, "upper_right_x": 1.0, "upper_right_y": 0.0, "lower_left_x": 0.0, "lower_left_y": 1.0, "lower_right_x": 1.0, "lower_right_y": 1.0},
			"crop_ratio": "free", "crop_scale": 1.0, "duration": clip.DurationUs, "height": height, "width": width,
			"id": materialID, "local_material_id": "", "material_id": materialID, "material_name": firstNonEmpty(clip.Name, clip.FileName),
			"media_path": "", "path": d.MaterialPath(clip.FileName), "type": "video",
		})
		speed := speedMaterial()
		speeds = append(speeds, speed)
		segment := baseSegment(materialID, cursor, clip.DurationUs, 0, []string{speed["id"].(string)}, clipSettings(0))
		segment["source_timerange"] = timerange(0, clip.DurationUs)
		segment["hdr_settings"] = map[string]any{"intensity": 1.0, "mode": 1, "nits": 1000}
		videoSegments = append(videoSegments, segment)
		cursor += clip.DurationUs
	}
	tracks := []any{track("video", "", videoSegments)}
	texts := []any{}
	if len(d.Captions) > 0 {
		textSegments := []any{}
		for _, caption := range d.Captions {
			text := strings.TrimSpace(caption.Text)
			if text == "" || caption.DurationUs <= 0 || caption.StartUs < 0 {
				continue
			}
			materialID := newUUID()
			material, err := subtitleMaterial(materialID, text)
			if err != nil {
				return nil, nil, err
			}
			texts = append(texts, material)
			speed := speedMaterial()
			speeds = append(speeds, speed)
			segment := baseSegment(materialID, caption.StartUs, caption.DurationUs, 1, []string{speed["id"].(string)}, clipSettings(-0.8))
			segment["source_timerange"] = nil
			textSegments = append(textSegments, segment)
		}
		if len(textSegments) > 0 {
			tracks = append(tracks, track("text", "台词字幕", textSegments))
		}
	}
	materials["videos"] = videos
	materials["speeds"] = speeds
	materials["texts"] = texts
	platform := map[string]any{"app_id": 3704, "app_source": "lv", "app_version": "5.9.0", "os": "windows"}
	content := map[string]any{
		"canvas_config": map[string]any{"height": d.Height, "ratio": "original", "width": d.Width},
		"color_space":   0,
		"config": map[string]any{
			"adjust_max_index": 1, "attachment_info": []any{}, "combination_max_index": 1, "export_range": nil, "extract_audio_last_index": 1,
			"lyrics_recognition_id": "", "lyrics_sync": true, "lyrics_taskinfo": []any{}, "maintrack_adsorb": true, "material_save_mode": 0,
			"multi_language_current": "none", "multi_language_list": []any{}, "multi_language_main": "none", "multi_language_mode": "none",
			"original_sound_last_index": 1, "record_audio_last_index": 1, "sticker_max_index": 1, "subtitle_keywords_config": nil,
			"subtitle_recognition_id": "", "subtitle_sync": true, "subtitle_taskinfo": []any{}, "system_font_list": []any{}, "video_mute": false,
			"zoom_info_params": nil,
		},
		"cover": nil, "create_time": now.Unix(), "duration": cursor, "extra_info": nil, "fps": float64(fps),
		"free_render_index_mode_on": false, "group_container": nil, "id": newUUID(), "keyframe_graph_list": []any{},
		"keyframes":              map[string]any{"adjusts": []any{}, "audios": []any{}, "effects": []any{}, "filters": []any{}, "handwrites": []any{}, "stickers": []any{}, "texts": []any{}, "videos": []any{}},
		"last_modified_platform": platform, "platform": platform, "materials": materials, "mutable_config": nil, "name": d.Name,
		"new_version": "110.0.0", "relationships": []any{}, "render_index_track_mode_on": false, "retouch_cover": nil, "source": "default",
		"static_cover_image_path": "", "time_marks": nil, "tracks": tracks, "update_time": now.Unix(), "version": 360000,
	}
	contentJSON, err := json.MarshalIndent(content, "", "  ")
	if err != nil {
		return nil, nil, err
	}
	cover := ""
	if d.HasCover {
		cover = d.FolderPath() + d.separator() + CoverFile
	}
	meta := map[string]any{
		"cloud_package_completed_time": "", "draft_cloud_capcut_purchase_info": "", "draft_cloud_last_action_download": false,
		"draft_cloud_materials": []any{}, "draft_cloud_purchase_info": "", "draft_cloud_template_id": "", "draft_cloud_tutorial_info": "",
		"draft_cloud_videocut_purchase_info": "", "draft_cover": cover, "draft_deeplink_url": "",
		"draft_enterprise_info": map[string]any{"draft_enterprise_extra": "", "draft_enterprise_id": "", "draft_enterprise_name": "", "enterprise_material": []any{}},
		"draft_fold_path":       d.FolderPath(), "draft_id": newUUID(), "draft_is_ai_packaging_used": false, "draft_is_ai_shorts": false,
		"draft_is_ai_translate": false, "draft_is_article_video_draft": false, "draft_is_from_deeplink": "false", "draft_is_invisible": false,
		"draft_materials": []any{
			map[string]any{"type": 0, "value": []any{}}, map[string]any{"type": 1, "value": []any{}}, map[string]any{"type": 2, "value": []any{}},
			map[string]any{"type": 3, "value": []any{}}, map[string]any{"type": 6, "value": []any{}}, map[string]any{"type": 7, "value": []any{}},
			map[string]any{"type": 8, "value": []any{}},
		},
		"draft_materials_copied_info": []any{}, "draft_name": d.Name, "draft_new_version": "", "draft_removable_storage_device": "",
		"draft_root_path": d.Root, "draft_segment_extra_info": []any{}, "draft_type": "", "tm_draft_cloud_completed": "",
		"tm_draft_cloud_modified": 0, "tm_draft_create": now.UnixMicro(), "tm_draft_modified": now.UnixMicro(), "tm_draft_removed": 0,
		"tm_duration": cursor,
	}
	metaJSON, err := json.MarshalIndent(meta, "", "  ")
	if err != nil {
		return nil, nil, err
	}
	return contentJSON, metaJSON, nil
}

// SRT 把字幕写成标准 SRT，便于在剪映里另行「导入字幕」或给其他剪辑软件使用。
func SRT(captions []Caption) string {
	var builder strings.Builder
	index := 0
	for _, caption := range captions {
		text := strings.TrimSpace(caption.Text)
		if text == "" || caption.DurationUs <= 0 {
			continue
		}
		index++
		fmt.Fprintf(&builder, "%d\n%s --> %s\n%s\n\n", index, srtTime(caption.StartUs), srtTime(caption.StartUs+caption.DurationUs), text)
	}
	return builder.String()
}

func srtTime(us int64) string {
	ms := us / 1000
	return fmt.Sprintf("%02d:%02d:%02d,%03d", ms/3_600_000, ms/60_000%60, ms/1000%60, ms%1000)
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return value
		}
	}
	return ""
}
