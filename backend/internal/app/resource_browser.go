package app

import (
	"bytes"
	"errors"
	"mime"
	"strings"
	"time"

	"gorm.io/gorm"
	"yingce/backend/internal/model"
	"yingce/backend/internal/storage"
)

type BrowserResourceUploadInput struct {
	FileName       string `json:"fileName"`
	MimeType       string `json:"mimeType"`
	Size           int64  `json:"size"`
	Width          int    `json:"width"`
	Height         int    `json:"height"`
	DurationMs     int64  `json:"durationMs"`
	IdempotencyKey string `json:"idempotencyKey"`
}

type BrowserResourceUpload struct {
	*storage.ObjectUpload
	ID        string    `json:"id"`
	ExpiresAt time.Time `json:"expiresAt"`
}

type BrowserResourceUploadResult struct {
	Upload         *BrowserResourceUpload `json:"upload,omitempty"`
	Resource       *model.Resource        `json:"resource,omitempty"`
	FallbackReason string                 `json:"fallbackReason,omitempty"`
}

func (s *Service) BeginBrowserResourceUpload(userID string, input BrowserResourceUploadInput) (*BrowserResourceUploadResult, error) {
	s.storageMu.Lock()
	defer s.storageMu.Unlock()
	if strings.TrimSpace(userID) == "" {
		return nil, Unauthorized("请先登录")
	}
	if strings.TrimSpace(input.FileName) == "" || len(input.FileName) > 255 || input.Size <= 0 || input.Width < 0 || input.Height < 0 || input.DurationMs < 0 {
		return nil, BadAuthRequest("上传文件信息无效")
	}
	mimeType, _, err := mime.ParseMediaType(input.MimeType)
	if err != nil {
		return nil, BadAuthRequest("上传文件类型无效")
	}
	setting, settingID, enabled, err := s.activeResourceOSSSetting(userID)
	if err != nil {
		return nil, err
	}
	result := &BrowserResourceUploadResult{}
	if !enabled {
		result.FallbackReason = "local_storage"
		return result, nil
	}
	if setting.Provider != s3Provider {
		result.FallbackReason = "provider_direct_upload_unsupported"
		return result, nil
	}
	if setting.S3Preset != "aws" && setting.S3Preset != "r2" && !storage.StandardAWSS3Endpoint(setting.Endpoint) {
		result.FallbackReason = "conditional_upload_unsupported"
		return result, nil
	}
	if !storage.PublicHTTPSStorageEndpoint(setting.Endpoint) {
		result.FallbackReason = "storage_endpoint_not_browser_accessible"
		return result, nil
	}
	uploadKey := normalizedResourceUploadKey([]string{input.IdempotencyKey})
	resource, err := s.resourceForUploadKey(userID, uploadKey)
	if err != nil {
		return nil, err
	}
	if resource != nil {
		if err := validateResourceUploadIdentity(resource, uploadedResourceKind(mimeType), mimeType, input.Size); err != nil {
			return nil, err
		}
		if resource.Status == model.ResourceStatusReady {
			result.Resource = resource
			return result, nil
		}
		if resource.Status == model.ResourceStatusFailed {
			result.FallbackReason = "previous_upload_failed"
			return result, nil
		}
		if resource.Status != model.ResourceStatusPending {
			return nil, resourceUploadInProgress()
		}
	} else {
		now := time.Now()
		kind := uploadedResourceKind(mimeType)
		resource = &model.Resource{ID: newID(), UserID: userID, Kind: kind, Status: model.ResourceStatusPending,
			Provider: setting.Provider, Endpoint: setting.Endpoint, Bucket: setting.Bucket, StorageSettingID: settingID,
			ObjectKey: ossObjectKey(setting, userID, kind, input.FileName, mimeType, now), MimeType: mimeType, Size: input.Size,
			Width: input.Width, Height: input.Height, DurationMs: input.DurationMs, UploadKey: uploadKey, CreatedAt: now, UpdatedAt: now}
		if err := s.ReserveChunkUploadSession(userID, resource.ID, input.Size, now.Add(15*time.Minute), 32); err != nil {
			return nil, err
		}
		if err := s.repo.CreateResource(resource); err != nil {
			_ = s.ReleaseChunkUploadSession(userID, resource.ID)
			return nil, err
		}
	}
	reservation, err := s.repo.UploadSession(userID, resource.ID)
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, BadAuthRequest("上传会话不存在或已过期，请重新导入")
	}
	if err != nil {
		return nil, err
	}
	setting, err = s.ossSettingForResource(userID, resource)
	if err != nil {
		return nil, err
	}
	upload, err := storage.SignedS3ObjectUpload(s.storageSettingWithRuntimePolicy(setting), resource.ObjectKey, resource.MimeType, resource.Size, reservation.ExpiresAt)
	if err != nil {
		return nil, WrapAppError(503, "浏览器上传地址签发失败", err)
	}
	result.Upload = &BrowserResourceUpload{ObjectUpload: upload, ID: resource.ID, ExpiresAt: reservation.ExpiresAt}
	return result, nil
}

func (s *Service) CompleteBrowserResourceUpload(userID, id string) (*model.Resource, error) {
	if strings.TrimSpace(userID) == "" {
		return nil, Unauthorized("请先登录")
	}
	resource, err := s.repo.ResourceForUser(userID, id)
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, NotFound("上传资源不存在或不可访问")
	}
	if err != nil {
		return nil, err
	}
	if resource.Status == model.ResourceStatusReady {
		return resource, nil
	}
	if resource.Status != model.ResourceStatusPending || resource.Provider != s3Provider {
		return nil, BadAuthRequest("资源不处于浏览器上传状态")
	}
	reservation, err := s.repo.UploadSession(userID, id)
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, BadAuthRequest("上传会话不存在或已过期，请重新导入")
	}
	if err != nil {
		return nil, err
	}
	if reservation.Size != resource.Size {
		return nil, BadAuthRequest("上传会话大小与资源不一致")
	}
	setting, err := s.ossSettingForResource(userID, resource)
	if err != nil {
		return nil, err
	}
	size, etag, prefix, err := storage.InspectS3Upload(s.storageSettingWithRuntimePolicy(setting), resource.ObjectKey)
	if err != nil {
		return nil, WrapAppError(503, "无法核验浏览器上传的对象，请重试", err)
	}
	if size != resource.Size || len(prefix) == 0 {
		return nil, BadAuthRequest("上传对象大小与声明不一致")
	}
	mimeType, err := detectUploadedMimeType(bytes.NewReader(prefix))
	if err != nil {
		return nil, err
	}
	kind := uploadedResourceKind(mimeType)
	if resource.Kind != "file" && kind != resource.Kind {
		return nil, BadAuthRequest("上传对象格式与声明不一致")
	}
	// 对象存储的网络核验不占全局锁；发布前重读，取消或其他实例完成可先胜出。
	s.storageMu.Lock()
	defer s.storageMu.Unlock()
	latest, err := s.repo.ResourceForUser(userID, id)
	if err != nil {
		return nil, err
	}
	if latest.Status == model.ResourceStatusReady {
		return latest, nil
	}
	if latest.Status != model.ResourceStatusPending {
		return nil, BadAuthRequest("上传已取消或不再等待确认")
	}
	resource.Kind, resource.MimeType, resource.ETag = kind, mimeType, etag
	resource.BrowserDirect = true
	resource.Status, resource.UpdatedAt = model.ResourceStatusReady, time.Now()
	if err := s.saveResourceWithinStorageLimit(resource, id); err != nil {
		if latest, readErr := s.repo.ResourceForUser(userID, id); readErr == nil && latest.Status == model.ResourceStatusReady {
			return latest, nil
		}
		return nil, err
	}
	s.recordActivity(userID, "resource", 1)
	return resource, nil
}

func (s *Service) CancelBrowserResourceUpload(userID, id string) error {
	if strings.TrimSpace(userID) == "" {
		return Unauthorized("请先登录")
	}
	s.storageMu.Lock()
	defer s.storageMu.Unlock()
	resource, err := s.repo.ResourceForUser(userID, id)
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return NotFound("上传资源不存在或不可访问")
	}
	if err != nil {
		return err
	}
	if resource.Status == model.ResourceStatusReady {
		return BadAuthRequest("已完成的资源不能取消上传")
	}
	if _, err := s.repo.UploadSession(userID, id); err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return BadAuthRequest("上传会话不存在或已过期")
		}
		return err
	}
	claimed, err := s.repo.ClaimBrowserUploadCancellation(userID, id)
	if err != nil {
		return err
	}
	if !claimed {
		return resourceUploadInProgress()
	}
	if err := s.deleteStoredResourceObject(userID, resource); err != nil {
		return errors.Join(err, s.repo.FinishBrowserUploadCancellation(userID, id, false))
	}
	if err := s.repo.FinishBrowserUploadCancellation(userID, id, true); err != nil {
		return err
	}
	return s.ReleaseChunkUploadSession(userID, id)
}
