// 生成输入媒体的准备：把画布上的资源引用转换成供应商可读取的形式（签名 URL 或 data URL）。
//
// 供应商能读取公网地址时优先给签名 URL；不能时才内联为 data URL，避免请求体过大。
// 看图（imageOnly）必然内联，超过模型的单张图片上限时先压缩，见 text_model_image_compression.go。

package app

import (
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"yingce/backend/internal/model"
)

func (s *Service) hydrateGenerationMedia(userID string, input *canvasGenerationInput, policy providerMediaHydrationPolicy) error {
	groups := [][]providerMedia{input.ReferenceImages, input.ReferenceVideos, input.ReferenceAudios}
	for groupIndex, group := range groups {
		mediaPolicy := policy
		// 识图规划与 Agent 看图都发送归属校验后的实际像素，避免供应商无法读取签名 URL。
		// 视频、音频及其他普通生成任务保留原来的协议策略。
		inlineVision := input.Mode == "text" && ((input.AgentRequests != nil && input.AgentRequests.Canonical != nil) || metadataString(input.Metadata, "edit") == "layer-planning")
		if groupIndex == 0 && inlineVision {
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
	if policy.imageOnly {
		// 模型声明的单张图片上限不再是准入理由：超限图会在下面被压回上限以内；
		// 只有"上限本身就把硬顶当目标"的模型才在读取前拒绝（见 textModelImageRejectable）。
		if textModelImageRejectable(policy.maxBytes) && resource.Size > textModelImageCompressionMaxInput {
			return errors.New(textModelImageOversizedMessage())
		}
	} else if policy.maxBytes > 0 && resource.Size > policy.maxBytes {
		return errors.New("参考图片文件超过当前模型大小限制")
	}
	// 看图必然内联真实像素，不走签名 URL：URL 交付会让上游自己取回原始字节，
	// 压缩与缓存全部失效，模型声明的单图上限也随之形同虚设。
	// 正常调用方（hydrateGenerationMedia）已经用 imageOnly 覆盖了 preferURL，
	// 这条守卫是给直接传组合策略的调用方兜底，并把"必须读字节"变成显式契约。
	if policy.imageOnly && policy.preferURL && resourceUsesObjectStorage(resource) {
		return errTextModelImageLimitNeedsPixels
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
	if !policy.imageOnly && policy.maxBytes > 0 {
		resourceLimit = min(resourceLimit, policy.maxBytes)
	}
	if policy.imageOnly {
		// 看图的模型上限在压缩之后才核：读取口径只受解码内存硬顶约束，
		// 否则超过模型上限的原图会在读完之前就被截断，压缩根本没机会执行。
		resourceLimit = min(resourceLimit, textModelImageCompressionMaxInput)
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
	width, height := resource.Width, resource.Height
	if policy.imageOnly {
		// 按渠道模型声明的单张图片上限决定：没超就不压缩，超了才压回上限以内。
		compressed := compressImageForTextModel(data, mimeType, policy.maxBytes)
		if compressed.Compressed {
			data, mimeType = compressed.Data, compressed.MIME
			width, height = compressed.Width, compressed.Height
		}
		// 压缩够不到模型上限（认不出的编码、或上限小到无法达到）时仍按原有口径拒绝。
		if policy.maxBytes > 0 && int64(len(data)) > policy.maxBytes {
			return errors.New("参考图片文件超过当前模型大小限制")
		}
	}
	media.DataURL = dataURL(mimeType, data)
	if policy.imageOnly {
		media.URL = ""
	}
	media.MimeType = mimeType
	media.Bytes = int64(len(data))
	media.Width = width
	media.Height = height
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
