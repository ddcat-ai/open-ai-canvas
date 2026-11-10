package app

// 短剧导出：单集剪映草稿与多集资产包。两者都在写响应头前完成归属与资源校验，
// 再把资源字节按 zip.Store 直接流进 ZIP（媒体本身已压缩），不在内存里缓存整包。

import (
	"archive/zip"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"image"
	"image/jpeg"
	_ "image/png"
	"io"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"yingce/backend/internal/jianying"
	"yingce/backend/internal/model"

	"gorm.io/gorm"
)

const (
	// DramaAssetPackageFormat 写在资产清单里，导入时据此识别资产包。
	DramaAssetPackageFormat  = "yingce.drama-asset-package"
	dramaAssetPackageVersion = 1
	dramaAssetManifestFile   = "资产清单.json"
	dramaArchiveMaxBytes     = int64(8) << 30
	dramaCoverMaxBytes       = int64(20) << 20
)

var dramaExportLocation = time.FixedZone("Asia/Shanghai", 8*60*60)

// DramaArchive 是校验完成、待写出的 ZIP 内容清单。
type DramaArchive struct {
	FileName string
	entries  []dramaArchiveEntry
	size     int64
	modified time.Time
}

type dramaArchiveEntry struct {
	path         string
	resourceID   string
	expectedSize int64
	data         []byte
}

func newDramaArchive(fileName string) *DramaArchive {
	return &DramaArchive{FileName: fileName, modified: time.Now()}
}

func (a *DramaArchive) addResource(path string, resource *model.Resource) error {
	a.size += resource.Size
	if a.size > dramaArchiveMaxBytes {
		return BadAuthRequest("本次导出超过 8GB，请减少剧集或取消包含媒体文件后重试")
	}
	a.entries = append(a.entries, dramaArchiveEntry{path: path, resourceID: resource.ID})
	return nil
}

func (a *DramaArchive) addData(path string, data []byte) {
	a.size += int64(len(data))
	a.entries = append(a.entries, dramaArchiveEntry{path: path, data: data})
}

// WriteDramaArchive 按清单顺序写出 ZIP；资源在写出时再按当前用户读取，读取失败即中断下载。
func (s *Service) WriteDramaArchive(ctx context.Context, userID string, archive *DramaArchive, out io.Writer) error {
	writer := zip.NewWriter(out)
	for _, entry := range archive.entries {
		if err := ctx.Err(); err != nil {
			return err
		}
		header := &zip.FileHeader{Name: entry.path, Method: zip.Store, Modified: archive.modified}
		target, err := writer.CreateHeader(header)
		if err != nil {
			return err
		}
		if entry.resourceID == "" {
			if _, err := target.Write(entry.data); err != nil {
				return err
			}
		} else {
			_, body, err := s.OpenResource(userID, entry.resourceID)
			if err != nil {
				return err
			}
			var reader io.Reader = body
			if entry.expectedSize > 0 {
				reader = io.LimitReader(body, entry.expectedSize+1)
			}
			written, copyErr := io.Copy(target, reader)
			closeErr := body.Close()
			if copyErr != nil {
				return copyErr
			}
			if closeErr != nil {
				return closeErr
			}
			if entry.expectedSize > 0 && written != entry.expectedSize {
				return errors.New("导出资源大小发生变化，下载已中断，请重新检查素材")
			}
		}
		if err := writer.Flush(); err != nil {
			return err
		}
	}
	return writer.Close()
}

// dramaExportResource 返回可导出的就绪资源；资源缺失、未就绪或类型不符时返回 nil，由调用方记为跳过。
func (s *Service) dramaExportResource(userID string, id string, kind string) *model.Resource {
	if strings.TrimSpace(id) == "" {
		return nil
	}
	resource, err := s.repo.ResourceForUser(userID, id)
	if err != nil || resource.Status != model.ResourceStatusReady {
		return nil
	}
	if resource.Kind != kind && !strings.HasPrefix(resource.MimeType, kind+"/") {
		return nil
	}
	return resource
}

func dramaResourceExtension(resource *model.Resource, fallback string) string {
	switch strings.ToLower(strings.TrimSpace(strings.Split(resource.MimeType, ";")[0])) {
	case "video/mp4":
		return ".mp4"
	case "video/quicktime":
		return ".mov"
	case "video/webm":
		return ".webm"
	case "image/png":
		return ".png"
	case "image/jpeg":
		return ".jpg"
	case "image/webp":
		return ".webp"
	case "audio/mpeg":
		return ".mp3"
	case "audio/wav", "audio/x-wav", "audio/wave":
		return ".wav"
	case "audio/mp4", "audio/x-m4a":
		return ".m4a"
	}
	ext := strings.ToLower(filepath.Ext(resource.ObjectKey))
	if len(ext) >= 2 && len(ext) <= 6 && !strings.ContainsAny(ext, `/\ `) {
		return ext
	}
	return fallback
}

func dramaShotsBySegment(shots []model.DramaShot) map[int][]model.DramaShot {
	grouped := map[int][]model.DramaShot{}
	for _, shot := range shots {
		grouped[shot.SegmentIndex] = append(grouped[shot.SegmentIndex], shot)
	}
	return grouped
}

func dramaSegmentTitle(shots []model.DramaShot, index int) string {
	for _, shot := range shots {
		if title := strings.TrimSpace(shot.SegmentTitle); title != "" {
			return title
		}
	}
	return fmt.Sprintf("第%d段", index+1)
}

func dramaEffectiveSegmentPrompt(segment model.DramaSegment) (string, bool) {
	if override := strings.TrimSpace(segment.VideoPromptOverride); override != "" {
		return override, true
	}
	return strings.TrimSpace(segment.VideoPrompt), false
}

// ===== 剪映草稿 =====

// DramaJianyingDraftRequest 中 DraftRoot 是用户本机的剪映草稿目录，素材绝对路径据此写入草稿。
type DramaJianyingDraftRequest struct {
	DraftRoot       string `json:"draftRoot"`
	Captions        bool   `json:"captions"`
	Revision        string `json:"revision,omitempty"`
	AllowIncomplete bool   `json:"allowIncomplete,omitempty"`
	AllowStale      bool   `json:"allowStale,omitempty"`
}

// PrepareDramaJianyingDraft 重新核对预检清单后才装配 ZIP 清单，不预读整份视频。
func (s *Service) PrepareDramaJianyingDraft(userID, projectID, episodeID string, req DramaJianyingDraftRequest) (*DramaArchive, error) {
	plan, err := s.planDramaJianyingDraft(userID, projectID, episodeID, req)
	if err != nil {
		return nil, err
	}
	preview := plan.Preview
	if req.Revision == "" || req.Revision != preview.Revision {
		return nil, NewAppError(409, "导出清单已变化或尚未检查，请重新检查后再下载")
	}
	if preview.AvailableSegments == 0 {
		return nil, BadAuthRequest("本集没有可导出的剧情段视频，请先生成或修复素材")
	}
	if preview.MissingSegments > 0 && !req.AllowIncomplete {
		return nil, BadAuthRequest("存在缺失剧情段，请确认只导出可用片段")
	}
	if preview.StaleSegments > 0 && !req.AllowStale {
		return nil, BadAuthRequest("存在过期视频，请确认导出当前旧版本")
	}
	now := time.Now()
	// 后缀始终保留，长作品名和连续导出不会覆盖同一个草稿文件夹。
	name := fmt.Sprintf("%s-第%02d集-%s-%s", jianying.SafeName(plan.Project.Name, "影策短剧", 40), plan.Episode.Number, now.In(dramaExportLocation).Format("20060102-150405"), newID()[:8])
	draft := jianying.Draft{Name: name, Root: preview.DraftRoot, Width: plan.Width, Height: plan.Height, FPS: 30, Now: now, Captions: plan.Captions}
	archive := newDramaArchive(name + ".zip")
	for _, media := range plan.Media {
		if err := archive.addResource(name+"/"+jianying.MaterialsDir+"/"+media.Clip.FileName, media.Resource); err != nil {
			return nil, err
		}
		archive.entries[len(archive.entries)-1].expectedSize = media.Resource.Size
		draft.Clips = append(draft.Clips, media.Clip)
	}
	if cover := s.dramaDraftCover(userID, plan.CoverResourceID); cover != nil {
		draft.HasCover = true
		archive.addData(name+"/"+jianying.CoverFile, cover)
	}
	content, meta, err := jianying.Build(draft)
	if err != nil {
		return nil, err
	}
	archive.addData(name+"/draft_content.json", content)
	archive.addData(name+"/draft_info.json", content)
	archive.addData(name+"/draft_meta_info.json", meta)
	if len(draft.Captions) > 0 {
		archive.addData(name+"/台词字幕.srt", []byte(jianying.SRT(draft.Captions)))
	}
	var notes []string
	for _, segment := range preview.Segments {
		if !segment.Included {
			notes = append(notes, fmt.Sprintf("第 %d 段：%s", segment.Index+1, segment.Reason))
		}
	}
	readme := dramaJianyingReadme(draft, notes)
	if len(preview.Warnings) > 0 {
		readme += "\n本次导出提示：\n- " + strings.Join(preview.Warnings, "\n- ") + "\n"
	}
	archive.addData(name+"/导入说明.txt", []byte(readme))
	return archive, nil
}

// dramaSegmentCaptions 按镜头时长在段内的占比分配台词时间，并按段视频实际时长等比缩放；
// 边界用整数换算，相邻字幕不会重叠。只是估算，精确对齐建议在剪映里用「识别字幕」。
func dramaSegmentCaptions(shots []model.DramaShot, startUs int64, durationUs int64) []jianying.Caption {
	var total int64
	for _, shot := range shots {
		total += max(shot.DurationMs, 0)
	}
	equal := total <= 0
	if equal {
		total = int64(len(shots))
	}
	var captions []jianying.Caption
	var elapsed int64
	for _, shot := range shots {
		weight := max(shot.DurationMs, 0)
		if equal {
			weight = 1
		}
		begin := startUs + durationUs*elapsed/total
		elapsed += weight
		end := startUs + durationUs*elapsed/total
		if text := strings.TrimSpace(shot.Dialogue); text != "" && end > begin {
			captions = append(captions, jianying.Caption{Text: text, StartUs: begin, DurationUs: end - begin})
		}
	}
	return captions
}

// dramaDraftCover 把首段尾帧转成 JPEG 封面；任何一步失败都不影响导出，剪映会自己生成封面。
func (s *Service) dramaDraftCover(userID string, resourceID string) []byte {
	resource := s.dramaExportResource(userID, resourceID, "image")
	if resource == nil || resource.Size > dramaCoverMaxBytes {
		return nil
	}
	_, body, err := s.OpenResource(userID, resource.ID)
	if err != nil {
		return nil
	}
	defer body.Close()
	decoded, _, err := image.Decode(io.LimitReader(body, dramaCoverMaxBytes))
	if err != nil {
		return nil
	}
	var buffer bytes.Buffer
	if err := jpeg.Encode(&buffer, decoded, &jpeg.Options{Quality: 85}); err != nil {
		return nil
	}
	return buffer.Bytes()
}

func dramaJianyingReadme(draft jianying.Draft, skipped []string) string {
	var builder strings.Builder
	builder.WriteString("影策短剧 · 剪映草稿\n\n")
	builder.WriteString("使用方法：\n")
	builder.WriteString("1. 关闭剪映专业版。\n")
	fmt.Fprintf(&builder, "2. 把压缩包解压到剪映草稿目录，确保文件夹「%s」直接位于：\n   %s\n", draft.Name, draft.Root)
	fmt.Fprintf(&builder, "   解压后的完整路径应为：%s\n", draft.FolderPath())
	builder.WriteString("3. 打开剪映，尝试在首页草稿列表里找到同名草稿；不要把解压后的第二层文件夹误放到草稿目录。\n\n")
	builder.WriteString("不同剪映/CapCut 版本的草稿格式可能变化，本包未保证所有版本兼容。若无法识别，可把 materials 视频按文件名顺序导入专业剪辑器，字幕文件可单独导入；原始视频不会丢失。\n")
	builder.WriteString("注意：素材按上面的完整路径写入草稿；解压到别处或改了文件夹名，剪映会提示素材丢失，可在剪映里重新链接 materials 目录下的视频。\n")
	if len(draft.Captions) > 0 {
		builder.WriteString("台词字幕按分镜时长估算，与配音可能有偏差；需要精确对齐时可删除字幕轨，用剪映「识别字幕」重新生成。台词字幕.srt 可单独导入。\n")
	}
	if len(skipped) > 0 {
		builder.WriteString("\n以下剧情段没有导出：\n")
		for _, item := range skipped {
			builder.WriteString("- " + item + "\n")
		}
	}
	return builder.String()
}

// ===== 资产包 =====

// DramaAssetPackageRequest 选择要打包的剧集；Media 打包设定图、声音样本、段视频与成片，Prompts 打包提示词。
type DramaAssetPackageRequest struct {
	EpisodeIDs []string
	Media      bool
	Prompts    bool
}

type dramaAssetManifest struct {
	Format     string              `json:"format"`
	Version    int                 `json:"version"`
	ExportedAt string              `json:"exportedAt"`
	Drama      dramaAssetDrama     `json:"drama"`
	Includes   dramaAssetIncludes  `json:"includes"`
	Cast       []dramaAssetCast    `json:"cast"`
	Episodes   []dramaAssetEpisode `json:"episodes"`
}

type dramaAssetDrama struct {
	Name        string `json:"name"`
	AspectRatio string `json:"aspectRatio"`
}

type dramaAssetIncludes struct {
	Media   bool `json:"media"`
	Prompts bool `json:"prompts"`
}

type dramaAssetCast struct {
	Kind              string   `json:"kind"`
	Name              string   `json:"name"`
	Aliases           []string `json:"aliases,omitempty"`
	Role              string   `json:"role,omitempty"`
	Description       string   `json:"description,omitempty"`
	Appearance        string   `json:"appearance,omitempty"`
	VoiceInstructions string   `json:"voiceInstructions,omitempty"`
	// LookName 非空表示这是 Name 角色的一套造型。
	LookName    string `json:"lookName,omitempty"`
	Image       string `json:"image,omitempty"`
	VoiceSample string `json:"voiceSample,omitempty"`
	ImagePrompt string `json:"imagePrompt,omitempty"`
}

type dramaAssetEpisode struct {
	Number   int                 `json:"number"`
	Title    string              `json:"title"`
	Synopsis string              `json:"synopsis,omitempty"`
	Final    string              `json:"final,omitempty"`
	Segments []dramaAssetSegment `json:"segments"`
	Shots    []dramaAssetShot    `json:"shots"`
}

type dramaAssetSegment struct {
	Index        int    `json:"index"`
	Title        string `json:"title"`
	Seconds      int    `json:"seconds,omitempty"`
	Video        string `json:"video,omitempty"`
	VideoPrompt  string `json:"videoPrompt,omitempty"`
	CustomPrompt bool   `json:"customPrompt,omitempty"`
}

type dramaAssetShot struct {
	Position     int    `json:"position"`
	SegmentIndex int    `json:"segmentIndex"`
	Scene        string `json:"scene,omitempty"`
	Speaker      string `json:"speaker,omitempty"`
	Dialogue     string `json:"dialogue,omitempty"`
	Action       string `json:"action,omitempty"`
	ShotSize     string `json:"shotSize,omitempty"`
	Camera       string `json:"camera,omitempty"`
	DurationMs   int64  `json:"durationMs,omitempty"`
	ImagePrompt  string `json:"imagePrompt,omitempty"`
	VideoPrompt  string `json:"videoPrompt,omitempty"`
}

var dramaCastKindFolder = map[string]string{"character": "角色", "scene": "场景", "prop": "道具"}

// PrepareDramaAssetPackage 打包全剧设定与所选剧集（必须已拆出分镜）。资产清单.json 记录全部结构，
// 导入时按设定类型与名称、集号与段号匹配。
func (s *Service) PrepareDramaAssetPackage(userID, projectID string, req DramaAssetPackageRequest) (*DramaArchive, error) {
	if !req.Media && !req.Prompts {
		return nil, BadAuthRequest("请至少选择打包媒体文件或提示词")
	}
	if len(req.EpisodeIDs) > 500 {
		return nil, BadAuthRequest("单次最多打包 500 集")
	}
	project, productionRow, err := s.dramaForUser(userID, projectID)
	if err != nil {
		return nil, err
	}
	settings := parseDramaSettings(productionRow.SettingsJSON)
	now := time.Now()
	root := jianying.SafeName(project.Name, "影策短剧", 60) + "-资产包"
	archive := newDramaArchive(root + "-" + now.In(dramaExportLocation).Format("0102-1504") + ".zip")
	manifest := dramaAssetManifest{
		Format: DramaAssetPackageFormat, Version: dramaAssetPackageVersion, ExportedAt: now.In(dramaExportLocation).Format(time.RFC3339),
		Drama:    dramaAssetDrama{Name: project.Name, AspectRatio: settings.AspectRatio},
		Includes: dramaAssetIncludes{Media: req.Media, Prompts: req.Prompts},
		Cast:     []dramaAssetCast{}, Episodes: []dramaAssetEpisode{},
	}
	casts, err := s.repo.DramaCasts(project.ID)
	if err != nil {
		return nil, err
	}
	if err := s.packDramaCasts(userID, project.ID, root, casts, req, archive, &manifest); err != nil {
		return nil, err
	}
	seen := map[string]bool{}
	var episodes []model.DramaEpisode
	for _, rawID := range req.EpisodeIDs {
		id := strings.TrimSpace(rawID)
		if id == "" || seen[id] {
			continue
		}
		seen[id] = true
		episode, err := s.repo.DramaEpisode(project.ID, id)
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, NotFound("所选剧集不存在")
		}
		if err != nil {
			return nil, err
		}
		episodes = append(episodes, *episode)
	}
	sort.Slice(episodes, func(i, j int) bool { return episodes[i].Number < episodes[j].Number })
	for _, episode := range episodes {
		if err := s.packDramaEpisode(userID, root, episode, req, archive, &manifest); err != nil {
			return nil, err
		}
	}
	encoded, err := json.MarshalIndent(manifest, "", "  ")
	if err != nil {
		return nil, err
	}
	// 清单放在最前，导入时无需读到包尾。
	archive.entries = append([]dramaArchiveEntry{{path: root + "/" + dramaAssetManifestFile, data: encoded}}, archive.entries...)
	archive.size += int64(len(encoded))
	return archive, nil
}

func (s *Service) packDramaCasts(userID, projectID, root string, casts []model.DramaCast, req DramaAssetPackageRequest, archive *DramaArchive, manifest *dramaAssetManifest) error {
	names := make(map[string]string, len(casts))
	for _, cast := range casts {
		names[cast.ID] = cast.Name
	}
	counters := map[string]int{}
	var prompts strings.Builder
	prompts.WriteString("# " + manifest.Drama.Name + " · 设定提示词\n")
	for _, cast := range casts {
		folder := dramaCastKindFolder[cast.Kind]
		if folder == "" {
			continue
		}
		item := dramaAssetCast{
			Kind: cast.Kind, Name: cast.Name, Aliases: decodeStringList(cast.AliasesJSON), Role: cast.Role,
			Description: cast.Description, Appearance: cast.Appearance, VoiceInstructions: cast.VoiceInstructions,
		}
		label := cast.Name
		if cast.ParentID != "" {
			item.Name = firstNonEmpty(names[cast.ParentID], cast.Name)
			item.LookName = firstNonEmpty(cast.LookName, cast.Name)
			label = item.Name + "-" + item.LookName
		}
		counters[cast.Kind]++
		base := fmt.Sprintf("%s/设定/%s/%02d-%s", root, folder, counters[cast.Kind], jianying.SafeName(label, "设定", 60))
		if req.Media {
			if resource := s.dramaExportResource(userID, cast.ImageResourceID, "image"); resource != nil {
				item.Image = base + dramaResourceExtension(resource, ".png")
				if err := archive.addResource(item.Image, resource); err != nil {
					return err
				}
			}
			if resource := s.dramaExportResource(userID, cast.VoiceSampleResourceID, "audio"); resource != nil {
				item.VoiceSample = base + "-声音样本" + dramaResourceExtension(resource, ".mp3")
				if err := archive.addResource(item.VoiceSample, resource); err != nil {
					return err
				}
			}
		}
		if req.Prompts {
			item.ImagePrompt = s.dramaCastImagePrompt(projectID, cast)
			fmt.Fprintf(&prompts, "\n## %s · %s\n", folder, label)
			for _, line := range [][2]string{{"身份", cast.Role}, {"简介", cast.Description}, {"外观", cast.Appearance}, {"声线", cast.VoiceInstructions}, {"参考图提示词", item.ImagePrompt}} {
				if text := strings.TrimSpace(line[1]); text != "" {
					fmt.Fprintf(&prompts, "\n**%s**：%s\n", line[0], text)
				}
			}
		}
		manifest.Cast = append(manifest.Cast, item)
	}
	if req.Prompts && len(manifest.Cast) > 0 {
		archive.addData(root+"/设定/设定提示词.md", []byte(prompts.String()))
	}
	return nil
}

// dramaCastImagePrompt 取当前参考图那一版的生成提示词；上传或画布采用的图没有生图提示词时返回空。
func (s *Service) dramaCastImagePrompt(projectID string, cast model.DramaCast) string {
	if cast.ImageResourceID == "" {
		return ""
	}
	takes, err := s.repo.DramaTakes(projectID, cast.ID, "cast", 50)
	if err != nil {
		return ""
	}
	for _, take := range takes {
		if take.ResourceID == cast.ImageResourceID {
			prompt := strings.TrimSpace(take.Prompt)
			if prompt == dramaTakeUploadPrompt || prompt == dramaTakeCanvasPrompt {
				return ""
			}
			return prompt
		}
	}
	return ""
}

func (s *Service) packDramaEpisode(userID, root string, episode model.DramaEpisode, req DramaAssetPackageRequest, archive *DramaArchive, manifest *dramaAssetManifest) error {
	shots, err := s.repo.DramaShots(episode.ID)
	if err != nil {
		return err
	}
	if len(shots) == 0 {
		return BadAuthRequest(fmt.Sprintf("第 %d 集还没有拆解分镜，不能打包", episode.Number))
	}
	segments, err := s.repo.DramaSegments(episode.ID)
	if err != nil {
		return err
	}
	folder := fmt.Sprintf("%s/第%02d集-%s", root, episode.Number, jianying.SafeName(episode.Title, "未命名", 40))
	item := dramaAssetEpisode{Number: episode.Number, Title: episode.Title, Synopsis: episode.Synopsis, Segments: []dramaAssetSegment{}, Shots: []dramaAssetShot{}}
	shotsBySegment := dramaShotsBySegment(shots)
	segmentByIndex := make(map[int]model.DramaSegment, len(segments))
	for _, segment := range segments {
		segmentByIndex[segment.SegmentIndex] = segment
	}
	indexes := make([]int, 0, len(shotsBySegment))
	for _, shot := range shots {
		if len(indexes) == 0 || indexes[len(indexes)-1] != shot.SegmentIndex {
			indexes = append(indexes, shot.SegmentIndex)
		}
	}
	var prompts strings.Builder
	fmt.Fprintf(&prompts, "# 第 %d 集 · %s\n", episode.Number, episode.Title)
	if synopsis := strings.TrimSpace(episode.Synopsis); synopsis != "" {
		prompts.WriteString("\n" + synopsis + "\n")
	}
	shotNumber := 0
	for _, index := range dedupeInts(indexes) {
		segmentShots := shotsBySegment[index]
		segment := segmentByIndex[index]
		title := dramaSegmentTitle(segmentShots, index)
		entry := dramaAssetSegment{Index: index, Title: title, Seconds: segment.VideoSeconds}
		if req.Media && segment.VideoResourceID != "" && (segment.VideoStatus == model.DramaMediaReady || segment.VideoStatus == model.DramaMediaStale) {
			if resource := s.dramaExportResource(userID, segment.VideoResourceID, "video"); resource != nil {
				entry.Video = fmt.Sprintf("%s/剧情段/%02d-%s%s", folder, index+1, jianying.SafeName(title, "剧情段", 40), dramaResourceExtension(resource, ".mp4"))
				if err := archive.addResource(entry.Video, resource); err != nil {
					return err
				}
			}
		}
		if req.Prompts {
			entry.VideoPrompt, entry.CustomPrompt = dramaEffectiveSegmentPrompt(segment)
			fmt.Fprintf(&prompts, "\n## 第 %d 段 · %s\n\n", index+1, title)
			if entry.VideoPrompt != "" {
				prompts.WriteString(entry.VideoPrompt + "\n")
			} else {
				prompts.WriteString("（视频提示词尚未撰写）\n")
			}
			prompts.WriteString("\n### 镜头\n")
		}
		for _, shot := range segmentShots {
			shotItem := dramaAssetShot{
				Position: shot.Position, SegmentIndex: shot.SegmentIndex, Scene: shot.Scene, Speaker: shot.Speaker, Dialogue: shot.Dialogue,
				Action: shot.Action, ShotSize: shot.ShotSize, Camera: shot.Camera, DurationMs: shot.DurationMs,
			}
			shotNumber++
			if req.Prompts {
				shotItem.ImagePrompt, shotItem.VideoPrompt = shot.ImagePrompt, shot.VideoPrompt
				fmt.Fprintf(&prompts, "\n%d. %s\n", shotNumber, strings.Join(nonEmptyStrings(shot.ShotSize, shot.Camera, shot.Scene), " · "))
				for _, line := range [][2]string{{"画面", shot.ImagePrompt}, {"运动", shot.VideoPrompt}, {"动作", shot.Action}, {"台词", strings.TrimSpace(strings.Join(nonEmptyStrings(shot.Speaker, shot.Dialogue), "："))}} {
					if text := strings.TrimSpace(line[1]); text != "" {
						fmt.Fprintf(&prompts, "   - %s：%s\n", line[0], strings.ReplaceAll(text, "\n", " "))
					}
				}
			}
			item.Shots = append(item.Shots, shotItem)
		}
		item.Segments = append(item.Segments, entry)
	}
	if req.Media && episode.FinalResourceID != "" {
		if resource := s.dramaExportResource(userID, episode.FinalResourceID, "video"); resource != nil {
			item.Final = folder + "/成片" + dramaResourceExtension(resource, ".mp4")
			if err := archive.addResource(item.Final, resource); err != nil {
				return err
			}
		}
	}
	if req.Prompts {
		archive.addData(folder+"/提示词.md", []byte(prompts.String()))
	}
	manifest.Episodes = append(manifest.Episodes, item)
	return nil
}

func dedupeInts(values []int) []int {
	seen := map[int]bool{}
	result := make([]int, 0, len(values))
	for _, value := range values {
		if !seen[value] {
			seen[value] = true
			result = append(result, value)
		}
	}
	return result
}

func nonEmptyStrings(values ...string) []string {
	result := make([]string, 0, len(values))
	for _, value := range values {
		if text := strings.TrimSpace(value); text != "" {
			result = append(result, text)
		}
	}
	return result
}
