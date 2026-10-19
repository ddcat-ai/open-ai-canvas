package app

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"time"

	"yingce/backend/internal/assets"
	"yingce/backend/internal/model"
	"yingce/backend/internal/storage"
)

func thumbnailUploadID(resourceID string, input BrowserResourceUploadInput) string {
	sum := sha256.Sum256([]byte(fmt.Sprintf("thumbnail:%s:%d:%s:%d:%d", resourceID, input.Size, input.MimeType, input.Width, input.Height)))
	return hex.EncodeToString(sum[:])
}

func (s *Service) browserThumbnailResource(userID, id string, input BrowserResourceUploadInput) (*model.Resource, error) {
	if userID == "" {
		return nil, Unauthorized("请先登录")
	}
	resource, err := s.repo.ResourceForUser(userID, id)
	if err != nil {
		return nil, NotFound("原图不存在或不可访问")
	}
	if resource.Status != model.ResourceStatusReady || resource.TransferPending || resource.Kind != "image" {
		return nil, BadAuthRequest("原图尚未保存，暂不保存缩略图")
	}
	if input.Size <= 0 || input.Size > maxBrowserThumbnailBytes || (input.MimeType != "image/png" && input.MimeType != "image/jpeg") || input.Width <= 0 || input.Height <= 0 || input.Width > 512 || input.Height > 512 {
		return nil, BadAuthRequest("缩略图须为 512 × 512 以内的 PNG/JPEG，且不超过 1MB")
	}
	return resource, nil
}

func (s *Service) BeginBrowserThumbnailUpload(userID, id string, input BrowserResourceUploadInput) (*BrowserResourceUploadResult, error) {
	resource, err := s.browserThumbnailResource(userID, id, input)
	if err != nil {
		return nil, err
	}
	result := &BrowserResourceUploadResult{}
	if resource.ThumbnailStatus == "ready" {
		result.Resource = resource
		return result, nil
	}
	if resource.Provider != s3Provider {
		result.FallbackReason = "provider_direct_upload_unsupported"
		return result, nil
	}
	setting, err := s.ossSettingForResource(userID, resource)
	if err != nil {
		return nil, err
	}
	if !storage.PublicHTTPSStorageEndpoint(setting.Endpoint) {
		result.FallbackReason = "storage_endpoint_not_browser_accessible"
		return result, nil
	}
	uploadID := thumbnailUploadID(id, input)
	reservation, err := s.repo.UploadSession(userID, uploadID)
	if err != nil {
		if err := s.ReserveChunkUploadSession(userID, uploadID, input.Size, time.Now().Add(2*time.Minute), 32); err != nil {
			return nil, err
		}
		reservation, err = s.repo.UploadSession(userID, uploadID)
		if err != nil {
			return nil, err
		}
	}
	if updated, err := s.repo.BeginResourceThumbnailUpload(userID, id); err != nil {
		return nil, err
	} else if !updated {
		return nil, NotFound("原图已清理，无法上传缩略图")
	}
	upload, err := storage.SignedS3ObjectUpload(s.storageSettingWithRuntimePolicy(setting), assets.ThumbnailObjectKey(resource.ObjectKey), input.MimeType, input.Size, reservation.ExpiresAt)
	if err != nil {
		return nil, err
	}
	result.Upload = &BrowserResourceUpload{ObjectUpload: upload, ID: uploadID, ExpiresAt: reservation.ExpiresAt}
	return result, nil
}

func (s *Service) CompleteBrowserThumbnailUpload(userID, id string, input BrowserResourceUploadInput) (*model.Resource, error) {
	resource, err := s.browserThumbnailResource(userID, id, input)
	if err != nil {
		return nil, err
	}
	if resource.ThumbnailStatus == "ready" {
		return resource, nil
	}
	uploadID := thumbnailUploadID(id, input)
	if _, err := s.repo.UploadSession(userID, uploadID); err != nil {
		return nil, BadAuthRequest("缩略图上传会话已过期")
	}
	setting, err := s.ossSettingForResource(userID, resource)
	if err != nil {
		return nil, err
	}
	size, _, prefix, err := storage.InspectS3Upload(s.storageSettingWithRuntimePolicy(setting), assets.ThumbnailObjectKey(resource.ObjectKey))
	if err != nil {
		return nil, WrapAppError(503, "缩略图直传核验失败", err)
	}
	mimeType, err := detectUploadedMimeType(bytes.NewReader(prefix))
	if err != nil {
		return nil, err
	}
	width, height, err := browserImageDimensions(prefix)
	if err != nil {
		return nil, err
	}
	if size != input.Size || mimeType != input.MimeType || width != input.Width || height != input.Height {
		return nil, BadAuthRequest("缩略图内容与声明不一致")
	}
	policy, err := s.RuntimePolicy()
	if err != nil {
		return nil, err
	}
	return s.repo.PublishBrowserThumbnail(userID, id, uploadID, mimeType, size, width, height, gigabytes(policy.Resource.StoredFileGB), megabytes(policy.Resource.DailyUploadMB))
}
