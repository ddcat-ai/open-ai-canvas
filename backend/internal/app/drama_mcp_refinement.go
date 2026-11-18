package app

import (
	"context"
	"errors"
	"fmt"
	"io"
	"math"
	"os"
	"os/exec"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"gorm.io/gorm"
	"yingce/backend/internal/model"
	"yingce/backend/internal/production"
	"yingce/backend/internal/repository"
)

type DramaSegmentDetailResult struct {
	Segment       DramaSegmentView                   `json:"segment"`
	Shots         []model.DramaShot                  `json:"shots"`
	PromptHistory []model.DramaSegmentPromptRevision `json:"promptHistory"`
	VideoVersions []DramaTakeView                    `json:"videoVersions"`
	LastVideoJob  *DramaJobDetail                    `json:"lastVideoJob,omitempty"`
}

// DramaSegmentDetail 限定 MCP 响应为单段，段请求预演与全集详情共用同一计算路径。
func (s *Service) DramaSegmentDetail(userID, projectID, episodeID string, index int) (DramaSegmentDetailResult, error) {
	if index < 0 {
		return DramaSegmentDetailResult{}, BadAuthRequest("剧情段序号无效")
	}
	detail, err := s.DramaEpisodeDetail(userID, projectID, episodeID)
	if err != nil {
		return DramaSegmentDetailResult{}, err
	}
	for _, segment := range detail.Segments {
		if segment.Index != index {
			continue
		}
		shots := make([]model.DramaShot, 0, len(segment.ShotIDs))
		for _, shot := range detail.Shots {
			if shot.SegmentIndex == index {
				shots = append(shots, shot)
			}
		}
		history, err := s.repo.DramaSegmentPromptRevisions(projectID, segment.ID, 50)
		if err != nil {
			return DramaSegmentDetailResult{}, err
		}
		listed, err := s.DramaTakes(userID, projectID, segment.ID, "video")
		if err != nil {
			return DramaSegmentDetailResult{}, err
		}
		result := DramaSegmentDetailResult{Segment: segment, Shots: shots, PromptHistory: history, VideoVersions: listed["takes"].([]DramaTakeView)}
		if segment.VideoJob != nil {
			job, err := s.DramaJobDetail(userID, projectID, segment.VideoJob.ID)
			if err != nil {
				return DramaSegmentDetailResult{}, err
			}
			result.LastVideoJob = &job
		}
		return result, nil
	}
	return DramaSegmentDetailResult{}, NotFound("剧情段不存在")
}

type EditDramaSegmentPromptRequest struct {
	Prompt           string `json:"prompt"`
	ExpectedRevision *int64 `json:"expectedRevision,omitempty"`
}

type EditDramaSegmentPromptResult struct {
	SegmentIndex int    `json:"segmentIndex"`
	Revision     int64  `json:"revision"`
	Custom       bool   `json:"custom"`
	PromptStatus string `json:"promptStatus"`
	VideoStatus  string `json:"videoStatus"`
}

// EditDramaSegmentPrompt 保存完整提示词；模型稿与人工历史保留，不发起生成。
func (s *Service) EditDramaSegmentPrompt(userID, projectID, episodeID string, index int, req EditDramaSegmentPromptRequest) (EditDramaSegmentPromptResult, error) {
	if index < 0 {
		return EditDramaSegmentPromptResult{}, BadAuthRequest("剧情段序号无效")
	}
	prompt := production.NormalizeReferenceTokens(strings.TrimSpace(req.Prompt))
	if prompt == "" || utf8.RuneCountInString(prompt) > 12000 {
		return EditDramaSegmentPromptResult{}, BadAuthRequest("段提示词须为 1–12000 字")
	}
	project, _, err := s.dramaForUser(userID, projectID)
	if err != nil {
		return EditDramaSegmentPromptResult{}, err
	}
	episode, err := s.repo.DramaEpisode(project.ID, episodeID)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return EditDramaSegmentPromptResult{}, NotFound("这一集不存在")
		}
		return EditDramaSegmentPromptResult{}, err
	}
	segments, err := s.repo.DramaSegments(episode.ID)
	if err != nil {
		return EditDramaSegmentPromptResult{}, err
	}
	var target *model.DramaSegment
	for i := range segments {
		if segments[i].SegmentIndex == index {
			target = &segments[i]
			break
		}
	}
	if target == nil {
		return EditDramaSegmentPromptResult{}, NotFound("剧情段不存在")
	}
	revision, err := s.repo.SaveDramaSegmentOverrideIfRevision(model.DramaSegment{ProjectID: project.ID, EpisodeID: episode.ID, SegmentIndex: index, VideoPromptOverride: prompt}, req.ExpectedRevision)
	if errors.Is(err, repository.ErrCreationConflict) {
		return EditDramaSegmentPromptResult{}, dramaSegmentChangedError()
	}
	if err != nil {
		return EditDramaSegmentPromptResult{}, err
	}
	updated, err := s.repo.DramaSegment(project.ID, target.ID)
	if err != nil {
		return EditDramaSegmentPromptResult{}, err
	}
	return EditDramaSegmentPromptResult{SegmentIndex: index, Revision: revision, Custom: true, PromptStatus: firstNonEmpty(updated.PromptStatus, "queued"), VideoStatus: updated.VideoStatus}, nil
}

type DramaSegmentVideoVersion struct {
	DramaTakeView
	Width      int    `json:"width"`
	Height     int    `json:"height"`
	DurationMs int64  `json:"durationMs"`
	MimeType   string `json:"mimeType"`
}

type DramaSegmentVersionsResult struct {
	SegmentIndex      int                        `json:"segmentIndex"`
	Revision          int64                      `json:"revision"`
	CurrentResourceID string                     `json:"currentResourceId"`
	Versions          []DramaSegmentVideoVersion `json:"versions"`
}

func (s *Service) DramaSegmentVideoVersions(userID, projectID, episodeID string, index int) (DramaSegmentVersionsResult, error) {
	detail, err := s.DramaSegmentDetail(userID, projectID, episodeID, index)
	if err != nil {
		return DramaSegmentVersionsResult{}, err
	}
	listed, err := s.DramaTakes(userID, projectID, detail.Segment.ID, "video")
	if err != nil {
		return DramaSegmentVersionsResult{}, err
	}
	result := DramaSegmentVersionsResult{SegmentIndex: index, Revision: detail.Segment.Revision, CurrentResourceID: detail.Segment.VideoResourceID, Versions: []DramaSegmentVideoVersion{}}
	for _, take := range listed["takes"].([]DramaTakeView) {
		version := DramaSegmentVideoVersion{DramaTakeView: take}
		resource, err := s.repo.ResourceForUser(userID, take.ResourceID)
		if err == nil {
			version.Width, version.Height, version.MimeType = resource.Width, resource.Height, resource.MimeType
			if resource.DurationMs > 0 {
				version.DurationMs = resource.DurationMs
			}
		}
		result.Versions = append(result.Versions, version)
	}
	return result, nil
}

type DramaSegmentFrame struct {
	SegmentIndex int     `json:"segmentIndex"`
	TakeID       string  `json:"takeId,omitempty"`
	ResourceID   string  `json:"resourceId"`
	AtSeconds    float64 `json:"atSeconds"`
	Width        int     `json:"width"`
	Height       int     `json:"height"`
	DurationMs   int64   `json:"durationMs"`
	HasAudio     bool    `json:"hasAudio"`
	JPEG         []byte  `json:"-"`
}

// DramaSegmentPreviewFrame 在受限临时文件中解码一帧；来源只接受本段的当前视频或历史版本。
func (s *Service) DramaSegmentPreviewFrame(ctx context.Context, userID, projectID, episodeID string, index int, takeID string, atSeconds float64) (DramaSegmentFrame, error) {
	if math.IsNaN(atSeconds) || math.IsInf(atSeconds, 0) || atSeconds < 0 || atSeconds > 3600 {
		return DramaSegmentFrame{}, BadAuthRequest("预览时间无效")
	}
	detail, err := s.DramaSegmentDetail(userID, projectID, episodeID, index)
	if err != nil {
		return DramaSegmentFrame{}, err
	}
	resourceID := detail.Segment.VideoResourceID
	if takeID != "" {
		take, err := s.repo.DramaTake(projectID, takeID)
		if err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return DramaSegmentFrame{}, NotFound("该视频版本不存在")
			}
			return DramaSegmentFrame{}, err
		}
		if take.OwnerID != detail.Segment.ID || take.Kind != "video" {
			return DramaSegmentFrame{}, BadAuthRequest("该版本不属于本段视频")
		}
		resourceID = take.ResourceID
	}
	if resourceID == "" {
		return DramaSegmentFrame{}, NotFound("本段没有可预览的视频")
	}
	if _, err := exec.LookPath("ffmpeg"); err != nil {
		return DramaSegmentFrame{}, NewAppError(503, "视频预览依赖 ffmpeg")
	}
	if _, err := exec.LookPath("ffprobe"); err != nil {
		return DramaSegmentFrame{}, NewAppError(503, "视频预览依赖 ffprobe")
	}
	resource, body, err := s.OpenResource(userID, resourceID)
	if err != nil {
		return DramaSegmentFrame{}, err
	}
	defer body.Close()
	if resource.Status != model.ResourceStatusReady || !strings.HasPrefix(resource.MimeType, "video/") {
		return DramaSegmentFrame{}, BadAuthRequest("视频资源尚未就绪")
	}
	const maxVideoBytes int64 = 512 << 20
	if resource.Size > maxVideoBytes {
		return DramaSegmentFrame{}, BadAuthRequest("视频超过预览大小上限")
	}
	stopOnCancel := context.AfterFunc(ctx, func() { _ = body.Close() })
	defer stopOnCancel()
	watchdog := time.AfterFunc(2*time.Minute, func() { _ = body.Close() })
	defer watchdog.Stop()
	file, err := os.CreateTemp("", "yingce-segment-preview-*.video")
	if err != nil {
		return DramaSegmentFrame{}, err
	}
	defer os.Remove(file.Name())
	defer file.Close()
	n, err := io.Copy(file, io.LimitReader(body, maxVideoBytes+1))
	if err != nil {
		return DramaSegmentFrame{}, err
	}
	if n > maxVideoBytes {
		return DramaSegmentFrame{}, BadAuthRequest("视频超过预览大小上限")
	}
	if err := file.Close(); err != nil {
		return DramaSegmentFrame{}, err
	}
	info, err := probeMediaFile(ctx, file.Name())
	if err != nil {
		return DramaSegmentFrame{}, err
	}
	if info.DurationMs > 0 && atSeconds*1000 >= float64(info.DurationMs) {
		return DramaSegmentFrame{}, BadAuthRequest("预览时间超出视频时长")
	}
	probe, err := exec.CommandContext(ctx, "ffprobe", "-v", "error", "-select_streams", "a:0", "-show_entries", "stream=codec_name", "-of", "default=nw=1:nk=1", file.Name()).Output()
	if err != nil {
		return DramaSegmentFrame{}, err
	}
	frameCtx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	jpeg, err := exec.CommandContext(frameCtx, "ffmpeg", "-hide_banner", "-loglevel", "error", "-ss", strconv.FormatFloat(atSeconds, 'f', 3, 64), "-i", file.Name(), "-frames:v", "1", "-vf", "scale='min(1280,iw)':-2", "-f", "image2pipe", "-vcodec", "mjpeg", "-q:v", "3", "pipe:1").Output()
	if err != nil {
		return DramaSegmentFrame{}, fmt.Errorf("预览帧提取失败: %w", err)
	}
	if len(jpeg) == 0 {
		return DramaSegmentFrame{}, errors.New("预览帧提取失败：没有解码出画面")
	}
	return DramaSegmentFrame{SegmentIndex: index, TakeID: takeID, ResourceID: resourceID, AtSeconds: atSeconds, Width: info.Width, Height: info.Height, DurationMs: info.DurationMs, HasAudio: strings.TrimSpace(string(probe)) != "", JPEG: jpeg}, nil
}
