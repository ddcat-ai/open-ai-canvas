package app

import (
	"bytes"
	"encoding/json"
	"errors"
	"image"
	"mime"
	"strings"
	"time"

	"gorm.io/gorm"
	"yingce/backend/internal/model"
	"yingce/backend/internal/storage"
)

type generatedBrowserUpload struct {
	BrowserResourceUploadInput
	UploadID string `json:"uploadId"`
}

func browserImageDimensions(prefix []byte) (int, int, error) {
	config, _, err := image.DecodeConfig(bytes.NewReader(prefix))
	if err != nil || config.Width <= 0 || config.Height <= 0 {
		return 0, 0, BadAuthRequest("无法核验上传图片的尺寸")
	}
	return config.Width, config.Height, nil
}

func (s *Service) BeginGeneratedResourceUpload(userID, id string, input BrowserResourceUploadInput) (*BrowserResourceUploadResult, error) {
	resource, err := s.ownedGeneratedResource(userID, id)
	if err != nil {
		return nil, err
	}
	if !resource.TransferPending {
		return &BrowserResourceUploadResult{Resource: resource}, nil
	}
	result := &BrowserResourceUploadResult{}
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
	policy, err := s.RuntimePolicy()
	if err != nil {
		return nil, err
	}
	mimeType, _, err := mime.ParseMediaType(input.MimeType)
	if err != nil || !strings.HasPrefix(mimeType, "image/") || input.Size <= 0 || input.Size > megabytes(policy.Resource.GeneratedFileMB) || input.Width <= 0 || input.Height <= 0 {
		return nil, BadAuthRequest("生成图片上传信息无效")
	}
	input.MimeType = mimeType
	uploadID := newID()
	until := time.Now().Add(2 * time.Minute)
	payload, _ := json.Marshal(generatedBrowserUpload{BrowserResourceUploadInput: input, UploadID: uploadID})
	claimed, err := s.repo.ClaimResourceTransfer(userID, id, "browser:"+uploadID, until, string(payload))
	if err != nil {
		return nil, err
	}
	if !claimed {
		result.FallbackReason = "resource_transfer_in_progress"
		return result, nil
	}
	if err := s.ReserveChunkUploadSession(userID, uploadID, input.Size, until, 32); err != nil {
		_ = s.repo.RetryResourceTransfer(id, "browser:"+uploadID, "浏览器上传配额未通过", time.Now())
		return nil, err
	}
	// Each lease has its own object key: a late browser PUT cannot replace a server fallback winner.
	objectKey := resource.ObjectKey + ".browser-" + uploadID
	object := *resource
	object.ObjectKey = objectKey
	if err := s.repo.TrackResourceTransferObject(&object, "browser:"+uploadID, until.Add(15*time.Minute)); err != nil {
		_ = s.RequestGeneratedResourceFallback(userID, id, uploadID)
		return nil, err
	}
	upload, err := storage.SignedS3ObjectUpload(s.storageSettingWithRuntimePolicy(setting), objectKey, mimeType, input.Size, until)
	if err != nil {
		_ = s.RequestGeneratedResourceFallback(userID, id, uploadID)
		return nil, WrapAppError(503, "生成图片直传地址签发失败", err)
	}
	result.Upload = &BrowserResourceUpload{ObjectUpload: upload, ID: uploadID, ExpiresAt: until}
	return result, nil
}

func (s *Service) ownedGeneratedResource(userID, id string) (*model.Resource, error) {
	if strings.TrimSpace(userID) == "" {
		return nil, Unauthorized("请先登录")
	}
	resource, err := s.repo.ResourceForUser(userID, id)
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, NotFound("生成资源不存在或不可访问")
	}
	if err != nil {
		return nil, err
	}
	if resource.SourceTaskID == "" || resource.Status != model.ResourceStatusReady {
		return nil, BadAuthRequest("资源不是可保存的生成作品")
	}
	return resource, nil
}

func (s *Service) CompleteGeneratedResourceUpload(userID, id, uploadID string) (*model.Resource, error) {
	resource, err := s.ownedGeneratedResource(userID, id)
	if err != nil {
		return nil, err
	}
	if !resource.TransferPending {
		return resource, nil
	}
	transfer, err := s.repo.ResourceTransfer(userID, id)
	if err != nil {
		return nil, err
	}
	owner := "browser:" + uploadID
	if uploadID == "" || transfer.LeaseOwner != owner || transfer.LeaseExpiresAt == nil || !transfer.LeaseExpiresAt.After(time.Now()) {
		return nil, BadAuthRequest("直传会话已过期")
	}
	var input generatedBrowserUpload
	if err := json.Unmarshal([]byte(transfer.UploadJSON), &input); err != nil {
		return nil, err
	}
	if input.UploadID != uploadID {
		return nil, BadAuthRequest("直传会话不匹配")
	}
	setting, err := s.ossSettingForResource(userID, resource)
	if err != nil {
		return nil, err
	}
	resource.ObjectKey += ".browser-" + uploadID
	size, etag, prefix, err := storage.InspectS3Upload(s.storageSettingWithRuntimePolicy(setting), resource.ObjectKey)
	if err != nil {
		return nil, WrapAppError(503, "生成图片直传核验失败", err)
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
		return nil, BadAuthRequest("上传对象与生成图片声明不一致")
	}
	resource.MimeType, resource.Size, resource.ETag, resource.Width, resource.Height = mimeType, size, etag, width, height
	resource.BrowserDirect, resource.UpdatedAt = true, time.Now()
	policy, err := s.RuntimePolicy()
	if err != nil {
		return nil, err
	}
	if err := s.repo.PublishResourceTransfer(resource, owner, uploadID, gigabytes(policy.Resource.StoredFileGB), megabytes(policy.Resource.DailyUploadMB)); err != nil {
		if current, readErr := s.repo.ResourceForUser(userID, id); readErr == nil && !current.TransferPending {
			return current, nil
		}
		return nil, err
	}
	return resource, nil
}

func (s *Service) RequestGeneratedResourceFallback(userID, id, uploadID string) error {
	resource, err := s.ownedGeneratedResource(userID, id)
	if err != nil {
		return err
	}
	if !resource.TransferPending {
		return nil
	}
	transfer, err := s.repo.ResourceTransfer(userID, id)
	if err != nil {
		return err
	}
	owner := "browser:" + uploadID
	if uploadID == "" {
		owner = ""
	}
	if transfer.LeaseOwner != owner {
		return nil
	}
	if uploadID != "" {
		if err := s.ReleaseChunkUploadSession(userID, uploadID); err != nil {
			return err
		}
	}
	return s.repo.RetryResourceTransfer(id, owner, "浏览器未完成直传，交由后台保存", time.Now())
}
