package app

import (
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"strings"

	"gorm.io/gorm"

	"yingce/backend/internal/model"
	"yingce/backend/internal/protocol"
)

const taskSourceImagePrefix = "task-source:"

func taskSourceImageURL(taskID string) string {
	return "/api/tasks/" + taskID + "/source-image"
}

type TaskSourceImageResult struct {
	URL        string
	LocalPath  string
	MIMEType   string
	ResourceID string
}

// TaskSourceImage only resolves a generated image belonging to the current user.
// The upstream URL stays encrypted in the recovery checkpoint, never in task JSON.
func (s *Service) TaskSourceImage(userID, taskID string) (*TaskSourceImageResult, error) {
	task, err := s.repo.TaskForUser(userID, strings.TrimSpace(taskID))
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, NotFound("任务不存在")
	}
	if err != nil {
		return nil, err
	}
	return s.taskSourceImage(task)
}

func (s *Service) taskSourceImage(task *model.Task) (*TaskSourceImageResult, error) {
	if task == nil || task.Type != "canvas_image" {
		return nil, BadAuthRequest("任务没有可用的生成图片")
	}
	if id, _ := taskOutputResource(task.ResultJSON, task.Type); id != "" {
		return &TaskSourceImageResult{URL: resourceFileURL(id), ResourceID: id}, nil
	}
	if task.MediaRecoveryJSON == "" {
		return nil, BadAuthRequest("生成图片尚未返回")
	}
	checkpoint, err := s.decodeMediaCheckpoint(task)
	if err != nil {
		return nil, err
	}
	if checkpoint.Mode != "image" || len(checkpoint.Items) == 0 {
		return nil, BadAuthRequest("任务没有可用的生成图片")
	}
	item := checkpoint.Items[0]
	if item.ResourceID != "" {
		return &TaskSourceImageResult{URL: resourceFileURL(item.ResourceID), ResourceID: item.ResourceID}, nil
	}
	if item.Reference.URL != "" {
		if _, err := ValidateOutboundURL(item.Reference.URL); err != nil {
			return nil, fmt.Errorf("生成图片地址不可访问：%w", err)
		}
		return &TaskSourceImageResult{URL: item.Reference.URL}, nil
	}
	path := s.mediaTempPath(item.TempName)
	if path == "" {
		return nil, BadAuthRequest("生成图片暂存文件不可用")
	}
	info, err := os.Lstat(path)
	if err != nil || !info.Mode().IsRegular() {
		return nil, BadAuthRequest("生成图片暂存文件不可用")
	}
	return &TaskSourceImageResult{LocalPath: path, MIMEType: item.MIMEType}, nil
}

func (s *Service) hydrateTaskSourceImage(userID string, media *providerMedia, policy providerMediaHydrationPolicy) error {
	taskID := strings.TrimPrefix(media.StorageKey, taskSourceImagePrefix)
	source, err := s.TaskSourceImage(userID, taskID)
	if err != nil {
		return err
	}
	if source.ResourceID != "" {
		media.StorageKey = "resource:" + source.ResourceID
		media.URL = ""
		return s.hydrateProviderMedia(userID, media, policy)
	}
	if source.URL != "" {
		if policy.preferURL || policy.requireURL {
			media.URL, media.DataURL = source.URL, ""
			return nil
		}
		data, mimeType, err := getExternalBinaryWithLimit(source.URL)
		if err != nil {
			return err
		}
		media.DataURL, media.URL = dataURL(mimeType, data), ""
		return nil
	}
	if policy.requireURL {
		return errors.New("当前模型要求公网参考图地址，但生成图片只有暂存文件")
	}
	file, err := os.Open(source.LocalPath)
	if err != nil {
		return err
	}
	defer file.Close()
	data, err := io.ReadAll(io.LimitReader(file, maxProviderResponseBytes+1))
	if err != nil {
		return err
	}
	if len(data) == 0 || int64(len(data)) > maxProviderResponseBytes {
		return errors.New("生成图片暂存文件为空或超过大小限制")
	}
	media.DataURL, media.URL = dataURL(source.MIMEType, data), ""
	return nil
}

func getExternalBinaryWithLimit(rawURL string) ([]byte, string, error) {
	data, mimeType, err := getExternalBinary(context.Background(), rawURL)
	if err != nil {
		return nil, "", err
	}
	if !strings.HasPrefix(mimeType, "image/") {
		return nil, "", errors.New("上游参考图不是图片")
	}
	return data, mimeType, nil
}

// Handwritten image providers return URLs in the same result shape as inline images.
// Checkpoint remote URLs before delivery so a slow OSS upload does not hide the preview.
func recoverImageTaskResult(ctx context.Context, config providerConfig, result map[string]interface{}) (map[string]interface{}, error) {
	if result == nil {
		return result, nil
	}
	rawImages, ok := result["images"].([]map[string]string)
	if !ok || len(rawImages) == 0 {
		return result, nil
	}
	references := make([]protocol.MediaReference, 0, len(rawImages))
	hasRemoteURL := false
	for _, image := range rawImages {
		source := strings.TrimSpace(image["dataUrl"])
		switch {
		case strings.HasPrefix(source, "https://"), strings.HasPrefix(source, "http://"):
			references = append(references, protocol.MediaReference{URL: source})
			hasRemoteURL = true
		case strings.HasPrefix(source, "data:"):
			references = append(references, protocol.MediaReference{DataURL: source})
		default:
			return result, nil
		}
	}
	if !hasRemoteURL {
		return result, nil
	}
	if recovered, handled, err := recoverProtocolMedia(ctx, config, "image", references); handled {
		return recovered, err
	}
	return result, nil
}
