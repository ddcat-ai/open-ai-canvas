package app

import (
	"bytes"
	"strings"

	"yingce/backend/internal/model"
)

type ImportOfficialAssetResourceRequest struct {
	URL       string `json:"url"`
	UploadKey string `json:"uploadKey"`
}

// ImportOfficialAssetResourceURL 为官方素材写权限提供受限的资源落盘入口。
// 资源归属始终取当前管理员，不接受调用方指定用户，也不接受 HTML 等普通文件。
func (s *Service) ImportOfficialAssetResourceURL(actor *model.User, req ImportOfficialAssetResourceRequest) (*model.Resource, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return nil, err
	}
	if strings.TrimSpace(actor.ID) == "" {
		return nil, Unauthorized("管理员账号无效")
	}
	req.URL = strings.TrimSpace(req.URL)
	req.UploadKey = strings.TrimSpace(req.UploadKey)
	if req.URL == "" || len(req.URL) > 8192 {
		return nil, BadAuthRequest("请提供有效的素材 URL")
	}
	if len(req.UploadKey) < 8 || len(req.UploadKey) > 160 {
		return nil, BadAuthRequest("uploadKey 必须为 8–160 字节，同一素材重试时保持不变")
	}
	uploadKey := normalizedResourceUploadKey([]string{"official-asset:" + req.UploadKey})
	existing, err := s.resourceForUploadKey(actor.ID, uploadKey)
	if err != nil {
		return nil, err
	}
	if existing != nil && existing.Status == model.ResourceStatusPending {
		return nil, resourceUploadInProgress()
	}
	policy, err := s.RuntimePolicy()
	if err != nil {
		return nil, err
	}
	// 共用出站策略会校验目标与每次重定向；下载上限沿用平台上传策略。
	payload, err := downloadRemoteResource(req.URL, megabytes(policy.Resource.ResourceUploadMB))
	if err != nil {
		return nil, err
	}
	mimeType, err := detectUploadedMimeType(bytes.NewReader(payload.data))
	if err != nil {
		return nil, err
	}
	switch uploadedResourceKind(mimeType) {
	case "image", "video", "audio":
	default:
		return nil, BadAuthRequest("网络素材只支持图片、视频和音频，请提供媒体文件直链")
	}
	// 在落盘前检查真实内容类型，再复用上传配额、资源幂等与对象存储失败语义。
	return s.storeFetchedResource(actor.ID, existing, uploadKey, payload.fileName, payload.data, 0, 0, 0)
}
