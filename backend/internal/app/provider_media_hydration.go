// 生成输入媒体的准备：把画布上的资源引用转换成供应商可读取的形式（签名 URL 或 data URL）。
//
// 供应商能读取公网地址时优先给签名 URL；不能时才内联为 data URL，避免请求体过大。

package app

import (
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"infinite-canvas/backend/internal/model"
)

func (s *Service) hydrateGenerationMedia(userID string, input *canvasGenerationInput, policy providerMediaHydrationPolicy) error {
	groups := [][]providerMedia{input.ReferenceImages, input.ReferenceVideos, input.ReferenceAudios}
	for groupIndex, group := range groups {
		mediaPolicy := policy
		// 仅 Agent 图片走内存字节；视频、音频及普通生成任务保留原来的协议策略。
		if groupIndex == 0 && input.Mode == "text" && input.AgentRequests != nil && input.AgentRequests.Canonical != nil {
			mediaPolicy = providerMediaHydrationPolicy{imageOnly: true}
			if input.Config.CapabilityConfig != nil && input.Config.CapabilityConfig.Text != nil {
				limits := input.Config.CapabilityConfig.Text.References
				if len(group) > limits.MaxImages {
					return errors.New("参考图片数量超过当前模型限制")
				}
				mediaPolicy.maxBytes = limits.MaxImageBytes
			}
		}
		for index := range group {
			if err := s.hydrateProviderMedia(userID, &group[index], mediaPolicy); err != nil {
				return err
			}
		}
	}
	if input.Mask != nil {
		return s.hydrateProviderMedia(userID, input.Mask, policy)
	}
	return nil
}

func (s *Service) hydrateProviderMedia(userID string, media *providerMedia, policy providerMediaHydrationPolicy) error {
	if !strings.HasPrefix(media.StorageKey, "resource:") {
		if policy.requireURL && strings.HasPrefix(strings.TrimSpace(media.DataURL), "data:") {
			return errors.New("当前 JSON 视频协议的参考素材不能使用内嵌数据，请先上传到对象存储或提供公网素材地址")
		}
		return nil
	}
	resourceID := strings.TrimPrefix(media.StorageKey, "resource:")
	resource, err := s.repo.ResourceForUser(userID, resourceID)
	if err != nil {
		return fmt.Errorf("读取任务参考资源失败：%w", err)
	}
	if resource.Status != "ready" {
		return errors.New("任务参考资源尚未上传完成")
	}
	if policy.imageOnly && !strings.HasPrefix(strings.ToLower(resource.MimeType), "image/") {
		return errors.New("看图资源不是图片")
	}
	if policy.maxBytes > 0 && resource.Size > policy.maxBytes {
		return errors.New("参考图片文件超过当前模型大小限制")
	}
	useObjectURL := policy.requireURL || (policy.preferURL && resourceUsesObjectStorage(resource))
	if useObjectURL {
		signedURL, err := s.providerResourceURL(resource, time.Time{})
		if err != nil {
			return fmt.Errorf("生成参考素材地址失败：%w", err)
		}
		media.URL = signedURL
		media.DataURL = ""
		media.MimeType = firstNonEmpty(media.MimeType, resource.MimeType)
		media.Bytes = resource.Size
		media.Width = resource.Width
		media.Height = resource.Height
		media.DurationMs = resource.DurationMs
		return nil
	}
	// Agent 看图以归属校验后的资源文件为准，不能让附带的内嵌内容替换真实图片。
	if !policy.imageOnly && strings.HasPrefix(strings.TrimSpace(media.DataURL), "data:") {
		return nil
	}
	resource, body, err := s.OpenResource(userID, resourceID)
	if err != nil {
		return fmt.Errorf("读取任务参考资源失败：%w", err)
	}
	defer body.Close()
	runtimePolicy, err := s.RuntimePolicy()
	if err != nil {
		return err
	}
	resourceLimit := megabytes(runtimePolicy.Resource.ResourceUploadMB)
	if policy.maxBytes > 0 {
		resourceLimit = min(resourceLimit, policy.maxBytes)
	}
	data, err := io.ReadAll(io.LimitReader(body, resourceLimit+1))
	if err != nil {
		return err
	}
	if int64(len(data)) > resourceLimit {
		return fmt.Errorf("任务参考资源超过读取上限 %d 字节", resourceLimit)
	}
	if policy.imageOnly && len(data) == 0 {
		return errors.New("看图资源内容为空")
	}
	mimeType := normalizedMediaMimeType(firstNonEmpty(media.MimeType, resource.MimeType), data)
	media.DataURL = dataURL(mimeType, data)
	media.MimeType = mimeType
	media.Bytes = int64(len(data))
	media.Width = resource.Width
	media.Height = resource.Height
	media.DurationMs = resource.DurationMs
	return nil
}

func resourceUsesObjectStorage(resource *model.Resource) bool {
	if resource == nil {
		return false
	}
	provider := strings.ToLower(strings.TrimSpace(resource.Provider))
	return provider != "" && provider != "local"
}

func normalizedMediaMimeType(declared string, data []byte) string {
	declared = strings.TrimSpace(strings.Split(declared, ";")[0])
	if declared != "" && declared != "application/octet-stream" {
		return declared
	}
	detected := strings.TrimSpace(strings.Split(http.DetectContentType(data), ";")[0])
	return defaultString(detected, "application/octet-stream")
}
