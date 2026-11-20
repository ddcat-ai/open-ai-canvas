package app

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"sort"
	"strings"

	"yingce/backend/internal/jianying"
	"yingce/backend/internal/model"

	"gorm.io/gorm"
)

// 预检只读元数据和每份媒体的首字节，不生成 ZIP 或保存用户本机目录。
type DramaJianyingSegmentPreview struct {
	Index             int    `json:"index"`
	Title             string `json:"title"`
	Included          bool   `json:"included"`
	Stale             bool   `json:"stale"`
	Reason            string `json:"reason,omitempty"`
	DurationMs        int64  `json:"durationMs"`
	DurationEstimated bool   `json:"durationEstimated"`
}

type DramaJianyingDraftPreview struct {
	DraftRoot         string                        `json:"draftRoot"`
	Revision          string                        `json:"revision"`
	TotalSegments     int                           `json:"totalSegments"`
	AvailableSegments int                           `json:"availableSegments"`
	MissingSegments   int                           `json:"missingSegments"`
	StaleSegments     int                           `json:"staleSegments"`
	DurationMs        int64                         `json:"durationMs"`
	MediaBytes        int64                         `json:"mediaBytes"`
	CaptionCount      int                           `json:"captionCount"`
	Segments          []DramaJianyingSegmentPreview `json:"segments"`
	Warnings          []string                      `json:"warnings"`
}

type dramaJianyingMedia struct {
	Resource *model.Resource
	Clip     jianying.Clip
}

type dramaJianyingPlan struct {
	Preview         *DramaJianyingDraftPreview
	Project         *model.Project
	Episode         *model.DramaEpisode
	Width, Height   int
	Media           []dramaJianyingMedia
	Captions        []jianying.Caption
	CoverResourceID string
}

func (s *Service) PreviewDramaJianyingDraft(userID, projectID, episodeID string, req DramaJianyingDraftRequest) (*DramaJianyingDraftPreview, error) {
	plan, err := s.planDramaJianyingDraft(userID, projectID, episodeID, req)
	if err != nil {
		return nil, err
	}
	return plan.Preview, nil
}

func (s *Service) planDramaJianyingDraft(userID, projectID, episodeID string, req DramaJianyingDraftRequest) (*dramaJianyingPlan, error) {
	root, err := jianying.NormalizeRoot(req.DraftRoot)
	if err != nil {
		return nil, BadAuthRequest(err.Error())
	}
	project, productionRow, err := s.dramaForUser(userID, projectID)
	if err != nil {
		return nil, err
	}
	episode, err := s.repo.DramaEpisode(project.ID, strings.TrimSpace(episodeID))
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, NotFound("剧集不存在")
	}
	if err != nil {
		return nil, err
	}
	segments, err := s.repo.DramaSegments(episode.ID)
	if err != nil {
		return nil, err
	}
	shots, err := s.repo.DramaShots(episode.ID)
	if err != nil {
		return nil, err
	}
	sort.SliceStable(shots, func(i, j int) bool { return shots[i].Position < shots[j].Position })
	byShots := dramaShotsBySegment(shots)
	bySegment := make(map[int]model.DramaSegment, len(segments))
	for _, segment := range segments {
		bySegment[segment.SegmentIndex] = segment
	}
	indexes := make(map[int]bool, len(byShots)+len(segments))
	for index := range byShots {
		indexes[index] = true
	}
	for index := range bySegment {
		indexes[index] = true
	}
	ordered := make([]int, 0, len(indexes))
	for index := range indexes {
		ordered = append(ordered, index)
	}
	sort.Ints(ordered)
	width, height := dramaRenderSize(parseDramaSettings(productionRow.SettingsJSON).AspectRatio)
	preview := &DramaJianyingDraftPreview{DraftRoot: root, TotalSegments: len(ordered), Segments: []DramaJianyingSegmentPreview{}, Warnings: []string{}}
	plan := &dramaJianyingPlan{Preview: preview, Project: project, Episode: episode, Width: width, Height: height}
	// 只对实际交付相关字段作指纹：不受任务日志或轮询时间变化干扰，也不缓存任何路径令牌。
	fingerprints := []any{}
	for _, index := range ordered {
		segment, exists := bySegment[index]
		segmentShots := byShots[index]
		item := DramaJianyingSegmentPreview{Index: index, Title: dramaSegmentTitle(segmentShots, index), Stale: segment.VideoStatus == model.DramaMediaStale}
		var resource *model.Resource
		switch {
		case len(segmentShots) == 0:
			item.Reason = "镜头信息缺失"
		case !exists || segment.VideoResourceID == "" || (segment.VideoStatus != model.DramaMediaReady && segment.VideoStatus != model.DramaMediaStale):
			item.Reason = "视频尚未就绪"
		default:
			resource, err = s.repo.ResourceForUser(userID, segment.VideoResourceID)
			if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
				return nil, err
			}
			if err != nil || resource == nil || resource.Status != model.ResourceStatusReady || (resource.Kind != "video" && !strings.HasPrefix(resource.MimeType, "video/")) || resource.Size <= 0 {
				item.Reason = "视频资源不可用"
			} else {
				item.DurationMs = resource.DurationMs
				if item.DurationMs <= 0 {
					item.DurationMs = int64(segment.VideoSeconds) * 1000
					item.DurationEstimated = true
				}
				if item.DurationMs <= 0 || item.DurationMs > 24*60*60*1000 {
					item.Reason = "视频时长未知或无效"
				}
				if item.Reason == "" && !s.dramaDraftResourceReadable(userID, resource) {
					item.Reason = "视频文件暂不可读取，请检查存储或稍后重试"
				}
			}
		}
		if item.Reason != "" {
			preview.MissingSegments++
			preview.Segments = append(preview.Segments, item)
			fingerprints = append(fingerprints, item)
			continue
		}
		if resource.Size > dramaArchiveMaxBytes-preview.MediaBytes {
			return nil, BadAuthRequest("本集导出超过 8GB，请先在素材库分批下载视频")
		}
		item.Included = true
		preview.AvailableSegments++
		if item.Stale {
			preview.StaleSegments++
		}
		fileName := fmt.Sprintf("%02d-%s%s", index+1, jianying.SafeName(item.Title, "剧情段", 40), dramaResourceExtension(resource, ".mp4"))
		clip := jianying.Clip{FileName: fileName, Name: fileName, DurationUs: item.DurationMs * 1000, Width: resource.Width, Height: resource.Height}
		plan.Media = append(plan.Media, dramaJianyingMedia{Resource: resource, Clip: clip})
		if req.Captions {
			plan.Captions = append(plan.Captions, dramaSegmentCaptions(segmentShots, preview.DurationMs*1000, clip.DurationUs)...)
		}
		preview.DurationMs += item.DurationMs
		preview.MediaBytes += resource.Size
		if plan.CoverResourceID == "" {
			plan.CoverResourceID = segment.TailFrameResourceID
		}
		preview.Segments = append(preview.Segments, item)
		fingerprints = append(fingerprints, struct {
			Item                DramaJianyingSegmentPreview
			ID, ETag, ObjectKey string
			Size                int64
			Clip                jianying.Clip
		}{item, resource.ID, resource.ETag, resource.ObjectKey, resource.Size, clip})
	}
	preview.CaptionCount = len(plan.Captions)
	if preview.MissingSegments > 0 {
		preview.Warnings = append(preview.Warnings, fmt.Sprintf("%d 个剧情段将被跳过；剩余视频按原顺序相接，导出不完整", preview.MissingSegments))
	}
	if preview.StaleSegments > 0 {
		preview.Warnings = append(preview.Warnings, fmt.Sprintf("%d 个剧情段使用修改前的视频，不代表当前分镜已重新生成", preview.StaleSegments))
	}
	for _, item := range preview.Segments {
		if item.Included && item.DurationEstimated {
			preview.Warnings = append(preview.Warnings, "部分视频未记录实测时长，草稿采用生成记录时长，请在剪映核对片段末尾")
			break
		}
	}
	if preview.CaptionCount > 0 {
		preview.Warnings = append(preview.Warnings, "台词字幕按分镜时长估算，不是语音识别；导入后请核对字幕时间")
	}
	payload, err := json.Marshal([]any{userID, project.ID, project.Name, episode.ID, episode.Number, root, width, height, req.Captions, fingerprints, plan.Captions})
	if err != nil {
		return nil, err
	}
	digest := sha256.Sum256(payload)
	preview.Revision = hex.EncodeToString(digest[:])
	return plan, nil
}

func (s *Service) dramaDraftResourceReadable(userID string, resource *model.Resource) bool {
	stream, err := s.OpenResourceRange(userID, resource.ID, "bytes=0-0")
	if err != nil {
		return false
	}
	defer stream.Body.Close()
	if file, ok := stream.Body.(*os.File); ok {
		info, err := file.Stat()
		if err != nil || !info.Mode().IsRegular() || info.Size() != resource.Size {
			return false
		}
	}
	_, err = io.CopyN(io.Discard, stream.Body, 1)
	return err == nil
}
