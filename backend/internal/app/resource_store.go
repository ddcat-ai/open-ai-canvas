// 资源写入：上传、URL 导入、生成结果落盘与失败重试。
//
// 写入先落对象存储再登记 Resource 行；对象存储失败时明确报错，不静默降级到本地盘。

package app

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"log"
	"mime/multipart"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/gabriel-vasile/mimetype"
	"gorm.io/gorm"
	"infinite-canvas/backend/internal/assets"
	"infinite-canvas/backend/internal/model"
)

func (s *Service) UploadResource(userID string, header *multipart.FileHeader, kind string, width int, height int, durationMs int64, uploadIdentity ...string) (*model.Resource, error) {
	return s.uploadResource(userID, header, kind, width, height, durationMs, false, uploadIdentity...)
}

// uploadLocalResource keeps small system-owned assets on the server even when
// the uploader or platform has enabled object storage. The resource still uses
// the normal database record and persistent data directory lifecycle.
func (s *Service) uploadLocalResource(userID string, header *multipart.FileHeader, kind string, width int, height int, durationMs int64, uploadIdentity ...string) (*model.Resource, error) {
	return s.uploadResource(userID, header, kind, width, height, durationMs, true, uploadIdentity...)
}

func (s *Service) uploadResource(userID string, header *multipart.FileHeader, kind string, width int, height int, durationMs int64, forceLocal bool, uploadIdentity ...string) (*model.Resource, error) {
	if header == nil {
		return nil, BadAuthRequest("请选择要上传的文件")
	}
	uploadKey := normalizedResourceUploadKey(uploadIdentity)
	existing, err := s.resourceForUploadKey(userID, uploadKey)
	if err != nil {
		return nil, err
	}
	if existing != nil && existing.Status == model.ResourceStatusPending {
		return nil, resourceUploadInProgress()
	}
	file, err := header.Open()
	if err != nil {
		return nil, err
	}
	defer file.Close()

	mimeType, err := detectUploadedMimeType(file)
	if err != nil {
		return nil, err
	}
	if !(forceLocal && kind == "live2d") {
		kind = uploadedResourceKind(mimeType)
	}
	if existing != nil {
		return s.retryStoredResource(userID, existing, kind, mimeType, header.Size, file)
	}
	day, err := s.reserveUserUploadQuota(userID, header.Size)
	if err != nil {
		return nil, err
	}
	resource, stored, err := s.storeResource(userID, kind, header.Filename, mimeType, header.Size, width, height, durationMs, file, uploadKey, forceLocal)
	if err != nil {
		s.releaseUserUploadQuota(userID, day, header.Size)
	} else if stored {
		s.commitUserUploadQuota(userID, header.Size)
	} else {
		s.releaseUserUploadQuota(userID, day, header.Size)
	}
	return resource, err
}

// UploadResourceFile 接收已完整落盘的本地文件（分片上传合并后调用）。
// 它与 UploadResource 共享资源幂等、媒体探测、配额和持久化语义。
func (s *Service) UploadResourceFile(userID string, fileName string, size int64, kind string, width int, height int, durationMs int64, file io.ReadSeeker, uploadIdentity ...string) (*model.Resource, error) {
	return s.uploadResourceFile(userID, "", fileName, size, kind, width, height, durationMs, file, uploadIdentity...)
}

func (s *Service) UploadReservedResourceFile(userID, reservationID, fileName string, size int64, kind string, width, height int, durationMs int64, file io.ReadSeeker, uploadIdentity ...string) (*model.Resource, error) {
	if reservationID == "" {
		return nil, BadAuthRequest("上传会话不存在")
	}
	defer func() {
		if err := s.ReleaseChunkUploadSession(userID, reservationID); err != nil {
			log.Printf("release upload session failed: %v", err)
		}
	}()
	return s.uploadResourceFile(userID, reservationID, fileName, size, kind, width, height, durationMs, file, uploadIdentity...)
}

func (s *Service) uploadResourceFile(userID, reservationID, fileName string, size int64, kind string, width int, height int, durationMs int64, file io.ReadSeeker, uploadIdentity ...string) (*model.Resource, error) {
	if file == nil || size <= 0 {
		return nil, BadAuthRequest("请选择要上传的文件")
	}
	uploadKey := normalizedResourceUploadKey(uploadIdentity)
	existing, err := s.resourceForUploadKey(userID, uploadKey)
	if err != nil {
		return nil, err
	}
	if existing != nil && existing.Status == model.ResourceStatusPending {
		return nil, resourceUploadInProgress()
	}
	mimeType, err := detectUploadedMimeType(file)
	if err != nil {
		return nil, err
	}
	kind = uploadedResourceKind(mimeType)
	if existing != nil {
		if reservationID != "" {
			if err := s.ReleaseChunkUploadSession(userID, reservationID); err != nil {
				return nil, err
			}
		}
		return s.retryStoredResource(userID, existing, kind, mimeType, size, file)
	}
	if reservationID != "" {
		resource, _, err := s.storeResource(userID, kind, fileName, mimeType, size, width, height, durationMs, file, uploadKey, false, reservationID)
		return resource, err
	}
	day, err := s.reserveChunkedUploadQuota(userID, size)
	if err != nil {
		return nil, err
	}
	resource, stored, err := s.storeResource(userID, kind, fileName, mimeType, size, width, height, durationMs, file, uploadKey, false)
	if err != nil {
		s.releaseUserUploadQuota(userID, day, size)
	} else if stored {
		s.commitUserUploadQuota(userID, size)
	} else {
		s.releaseUserUploadQuota(userID, day, size)
	}
	return resource, err
}

func detectUploadedMimeType(file io.ReadSeeker) (string, error) {
	if _, err := file.Seek(0, io.SeekStart); err != nil {
		return "", err
	}
	detected, err := mimetype.DetectReader(file)
	_, seekErr := file.Seek(0, io.SeekStart)
	if err != nil || seekErr != nil {
		return "", errors.Join(err, seekErr)
	}
	return strings.TrimSpace(strings.Split(detected.String(), ";")[0]), nil
}

func uploadedResourceKind(mimeType string) string {
	if !assets.InlineMediaType(mimeType) {
		return "file"
	}
	return normalizeResourceKind("", mimeType)
}

func (s *Service) ImportResourceURL(userID string, rawURL string, kind string, width int, height int, durationMs int64, uploadIdentity ...string) (*model.Resource, error) {
	uploadKey := normalizedResourceUploadKey(uploadIdentity)
	existing, err := s.resourceForUploadKey(userID, uploadKey)
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
	payload, err := downloadRemoteResource(rawURL, megabytes(policy.Resource.ResourceUploadMB))
	if err != nil {
		return nil, err
	}
	payload.mimeType, err = detectUploadedMimeType(bytes.NewReader(payload.data))
	if err != nil {
		return nil, err
	}
	kind = uploadedResourceKind(payload.mimeType)
	if kind == "image" && (width <= 0 || height <= 0) {
		if decodedWidth, decodedHeight := imageDimensions(payload.data); decodedWidth > 0 && decodedHeight > 0 {
			width = decodedWidth
			height = decodedHeight
		}
	}
	size := int64(len(payload.data))
	if existing != nil {
		return s.retryStoredResource(userID, existing, kind, payload.mimeType, size, bytes.NewReader(payload.data))
	}
	day, err := s.reserveUserUploadQuota(userID, size)
	if err != nil {
		return nil, err
	}
	resource, stored, err := s.storeResource(userID, kind, payload.fileName, payload.mimeType, size, width, height, durationMs, bytes.NewReader(payload.data), uploadKey, false)
	if err != nil {
		s.releaseUserUploadQuota(userID, day, size)
	} else if stored {
		s.commitUserUploadQuota(userID, size)
	} else {
		s.releaseUserUploadQuota(userID, day, size)
	}
	return resource, err
}

func normalizedResourceUploadKey(values []string) *string {
	if len(values) == 0 || strings.TrimSpace(values[0]) == "" {
		return nil
	}
	digest := sha256.Sum256([]byte(strings.TrimSpace(values[0])))
	value := hex.EncodeToString(digest[:])
	return &value
}

func (s *Service) resourceForUploadKey(userID string, uploadKey *string) (*model.Resource, error) {
	if uploadKey == nil {
		return nil, nil
	}
	resource, err := s.repo.ResourceByUploadKey(userID, *uploadKey)
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	return resource, err
}

func resourceUploadInProgress() *AppError {
	err := NewAppError(http.StatusConflict, "相同素材正在上传，请稍后重试")
	err.Retryable = true
	return err
}

func (s *Service) OpenResource(userID string, id string) (*model.Resource, io.ReadCloser, error) {
	stream, err := s.OpenResourceRange(userID, id, "")
	if err != nil {
		return nil, nil, err
	}
	return stream.Resource, stream.Body, nil
}

func (s *Service) OpenResourceRange(userID string, id string, rangeHeader string) (*ResourceStream, error) {
	resource, err := s.repo.ResourceForUser(userID, id)
	if err != nil {
		return nil, err
	}
	return s.openResourceRange(userID, resource, rangeHeader)
}

func (s *Service) openResourceRange(userID string, resource *model.Resource, rangeHeader string) (*ResourceStream, error) {
	if resource.Status != model.ResourceStatusReady {
		return nil, BadAuthRequest("资源尚未上传完成")
	}
	if resource.Provider == "local" {
		body, err := os.Open(filepath.Join(s.dataDir, "resources", filepath.FromSlash(resource.ObjectKey)))
		if err != nil {
			return nil, err
		}
		return &ResourceStream{Resource: resource, Body: body, StatusCode: http.StatusOK, ContentLength: resource.Size, AcceptRanges: "bytes"}, nil
	}
	setting, err := s.ossSettingForResource(userID, resource)
	if err != nil {
		return nil, err
	}
	if setting.AccessKeyID == "" || setting.AccessKeySecret == "" {
		return nil, errors.New("对象存储访问密钥不可用")
	}
	setting.Provider = firstNonEmpty(resource.Provider, setting.Provider)
	setting.Endpoint = firstNonEmpty(resource.Endpoint, setting.Endpoint)
	setting.Bucket = firstNonEmpty(resource.Bucket, setting.Bucket)
	setting = s.storageSettingWithRuntimePolicy(setting)
	stream, err := getOriginOSSObjectRange(setting, resource.ObjectKey, normalizeSingleByteRange(rangeHeader))
	if err != nil {
		return nil, err
	}
	return &ResourceStream{Resource: resource, Body: stream.Body, StatusCode: stream.StatusCode, ContentLength: stream.ContentLength, ContentRange: stream.ContentRange, AcceptRanges: stream.AcceptRanges}, nil
}

func (s *Service) storeResource(userID string, kind string, fileName string, mimeType string, size int64, width int, height int, durationMs int64, body io.Reader, uploadKey *string, forceLocal bool, reservationIDs ...string) (*model.Resource, bool, error) {
	return s.storeResourceWithWriter(userID, kind, fileName, mimeType, size, width, height, durationMs, body, uploadKey, forceLocal, s.storeResourceObject, reservationIDs...)
}

func (s *Service) storeResourceWithWriter(userID string, kind string, fileName string, mimeType string, size int64, width int, height int, durationMs int64, body io.Reader, uploadKey *string, forceLocal bool, writeObject func(*model.Resource, string, io.Reader) (string, error), reservationIDs ...string) (*model.Resource, bool, error) {
	reservationID := ""
	if len(reservationIDs) > 0 {
		reservationID = reservationIDs[0]
	}
	// Live2D is reserved for the administrator's validated local import path.
	if !(forceLocal && kind == "live2d") {
		kind = normalizeResourceKind(kind, mimeType)
	}
	if existing, err := s.resourceForUploadKey(userID, uploadKey); err != nil {
		return nil, false, err
	} else if existing != nil {
		if existing.Status == model.ResourceStatusReady {
			if err := validateResourceUploadIdentity(existing, kind, mimeType, size); err != nil {
				return nil, false, err
			}
			return existing, false, nil
		}
		return nil, false, resourceUploadInProgress()
	}
	now := time.Now()
	var setting ossSettingValue
	var storageSettingID string
	var useOSS bool
	var err error
	if !forceLocal {
		setting, storageSettingID, useOSS, err = s.activeResourceOSSSetting(userID)
		if err != nil {
			return nil, false, err
		}
	}
	provider := "local"
	objectKey := localObjectKey(userID, kind, fileName, mimeType, now)
	resource := model.Resource{ID: newID(), UserID: userID, Kind: kind, Status: model.ResourceStatusPending, Provider: provider, ObjectKey: objectKey, MimeType: mimeType, Size: size, Width: width, Height: height, DurationMs: durationMs, UploadKey: uploadKey, CreatedAt: now, UpdatedAt: now}
	if useOSS {
		provider = setting.Provider
		objectKey = ossObjectKey(setting, userID, kind, fileName, mimeType, now)
		resource.Provider = provider
		resource.Endpoint = setting.Endpoint
		resource.Bucket = setting.Bucket
		resource.StorageSettingID = storageSettingID
		resource.ObjectKey = objectKey
	}
	if err := s.repo.CreateResource(&resource); err != nil {
		if existing, lookupErr := s.resourceForUploadKey(userID, uploadKey); lookupErr == nil && existing != nil {
			if existing.Status == model.ResourceStatusReady {
				if err := validateResourceUploadIdentity(existing, kind, mimeType, size); err != nil {
					return nil, false, err
				}
				return existing, false, nil
			}
			return nil, false, resourceUploadInProgress()
		}
		return nil, false, err
	}
	var etag string
	etag, err = writeObject(&resource, fileName, body)
	resource.UpdatedAt = time.Now()
	if err != nil {
		resource.Status = model.ResourceStatusFailed
		resource.Error = err.Error()
		if saveErr := s.repo.SaveResource(&resource); saveErr != nil {
			return nil, true, errors.Join(err, fmt.Errorf("记录资源失败状态失败：%w", saveErr))
		}
		return nil, true, err
	}
	resource.Status = model.ResourceStatusReady
	resource.ETag = etag
	if err := s.saveResourceWithinStorageLimit(&resource, reservationID); err != nil {
		cleanupErr := s.deleteStoredResourceObject(userID, &resource)
		if cleanupErr == nil {
			if deleteErr := s.repo.DeleteResource(userID, resource.ID); deleteErr != nil {
				return nil, true, errors.Join(err, fmt.Errorf("清理资源记录失败：%w", deleteErr))
			}
			return nil, true, fmt.Errorf("保存资源就绪状态失败：%w", err)
		}

		resource.Status = model.ResourceStatusFailed
		resource.Error = fmt.Sprintf("保存资源就绪状态失败，物理对象清理失败：%v", cleanupErr)
		statusErr := s.repo.SaveResource(&resource)
		if statusErr != nil {
			return nil, true, errors.Join(err, cleanupErr, fmt.Errorf("记录资源失败状态失败：%w", statusErr))
		}
		return nil, true, errors.Join(err, fmt.Errorf("清理已上传资源对象失败：%w", cleanupErr))
	}
	s.recordActivity(userID, "resource", 1)
	s.maybeStartPlaybackTranscode(&resource)
	return &resource, true, nil
}

func writeLocalResourceObject(filePath string, body io.Reader) error {
	if err := os.MkdirAll(filepath.Dir(filePath), 0o750); err != nil {
		return err
	}
	file, err := os.OpenFile(filePath, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o640)
	if err != nil {
		return err
	}
	_, copyErr := io.Copy(file, body)
	closeErr := file.Close()
	if copyErr != nil {
		return copyErr
	}
	return closeErr
}

// storeResourceObject writes to the configured origin. When object storage is
// enabled, a failed origin write must fail the resource instead of silently
// changing its storage location to local disk.
func (s *Service) storeResourceObject(resource *model.Resource, fileName string, body io.Reader) (string, error) {
	if resource == nil {
		return "", errors.New("资源不存在")
	}
	if resource.Provider == "local" {
		return "", writeLocalResourceObject(filepath.Join(s.dataDir, "resources", filepath.FromSlash(resource.ObjectKey)), body)
	}
	setting, settingErr := s.ossSettingForResource(resource.UserID, resource)
	if settingErr != nil {
		return "", settingErr
	}
	etag, err := putOSSObject(s.storageSettingWithRuntimePolicy(setting), resource.ObjectKey, resource.MimeType, resource.Size, body)
	if err != nil {
		return "", err
	}
	return etag, nil
}

func (s *Service) retryStoredResource(userID string, resource *model.Resource, kind string, mimeType string, size int64, body io.Reader) (*model.Resource, error) {
	if resource == nil {
		return nil, errors.New("资源不存在")
	}
	if resource.Status != model.ResourceStatusFailed && resource.Status != model.ResourceStatusReady {
		return nil, resourceUploadInProgress()
	}
	kind = normalizeResourceKind(kind, mimeType)
	if err := validateResourceUploadIdentity(resource, kind, mimeType, size); err != nil {
		return nil, err
	}
	if resource.Status == model.ResourceStatusReady {
		return resource, nil
	}
	claimed, err := s.repo.ClaimFailedResourceUpload(userID, resource.ID)
	if err != nil {
		return nil, err
	}
	if !claimed {
		latest, latestErr := s.repo.ResourceForUser(userID, resource.ID)
		if latestErr == nil && latest.Status == model.ResourceStatusReady {
			if err := validateResourceUploadIdentity(latest, kind, mimeType, size); err != nil {
				return nil, err
			}
			return latest, nil
		}
		return nil, resourceUploadInProgress()
	}
	resource.Status = model.ResourceStatusPending
	resource.Error = ""
	resource.UpdatedAt = time.Now()
	day, err := s.reserveRetryUploadQuota(userID, size)
	if err != nil {
		resource.Status = model.ResourceStatusFailed
		resource.Error = err.Error()
		resource.UpdatedAt = time.Now()
		if saveErr := s.repo.SaveResource(resource); saveErr != nil {
			return nil, errors.Join(err, fmt.Errorf("恢复资源重试失败状态失败：%w", saveErr))
		}
		return nil, err
	}
	var etag string
	etag, err = s.storeResourceObject(resource, "", body)
	resource.UpdatedAt = time.Now()
	if err != nil {
		s.releaseRetryUploadQuota(userID, day, size)
		resource.Status = model.ResourceStatusFailed
		resource.Error = err.Error()
		if saveErr := s.repo.SaveResource(resource); saveErr != nil {
			return nil, errors.Join(err, fmt.Errorf("记录资源重试失败状态失败：%w", saveErr))
		}
		return nil, err
	}
	resource.Status = model.ResourceStatusReady
	resource.ETag = etag
	if err := s.saveResourceWithinStorageLimit(resource, ""); err != nil {
		s.releaseRetryUploadQuota(userID, day, size)
		resource.Status = model.ResourceStatusFailed
		resource.Error = "保存资源重试就绪状态失败"
		if saveErr := s.repo.SaveResource(resource); saveErr != nil {
			return nil, errors.Join(err, fmt.Errorf("记录资源重试失败状态失败：%w", saveErr))
		}
		return nil, fmt.Errorf("保存资源重试就绪状态失败：%w", err)
	}
	s.recordActivity(userID, "resource", 1)
	return resource, nil
}

func validateResourceUploadIdentity(resource *model.Resource, kind, mimeType string, size int64) error {
	if resource.Size != size || resource.Kind != kind || resource.MimeType != mimeType {
		return NewAppError(http.StatusConflict, "上传幂等标识已用于其他文件")
	}
	return nil
}
