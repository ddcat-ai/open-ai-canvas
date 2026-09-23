package app

import (
	"bytes"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"image"
	_ "image/gif"
	_ "image/jpeg"
	_ "image/png"
	"infinite-canvas/backend/internal/kernel"
	"io"
	"log"
	"mime"
	"mime/multipart"
	"net/http"
	"net/url"
	"os"
	"path"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"infinite-canvas/backend/internal/assets"
	"infinite-canvas/backend/internal/model"

	"gorm.io/gorm"
)

const providerResourceURLTTL = 4 * time.Hour

var errInvalidGeneratedDataURL = errors.New("生成内容 data URL 无效")

type ResourceStream = assets.ResourceStream
type ResourceDelivery = assets.ResourceDelivery

func (s *Service) Resources(userID string, limit int) ([]model.Resource, error) {
	resources, err := s.repo.Resources(userID, limit)
	for index := range resources {
		resources[index].PublicURL = ""
	}
	return resources, err
}

func (s *Service) Resource(userID string, id string) (*model.Resource, error) {
	resource, err := s.repo.ResourceForUser(userID, id)
	if resource != nil {
		resource.PublicURL = ""
	}
	return resource, err
}

func (s *Service) verifyPublicResourceSignature(resourceID string, expires string, signature string) error {
	if strings.TrimSpace(signature) == "" || !decimalDigits(expires) {
		return Forbidden("匿名下载链接无效")
	}
	expiresAt, err := strconv.ParseInt(expires, 10, 64)
	if err != nil || time.Now().UTC().Unix() > expiresAt {
		return Forbidden("匿名下载链接已过期")
	}
	expected, err := s.signPublicResource(resourceID, expires)
	if err != nil {
		return err
	}
	if !hmac.Equal([]byte(expected), []byte(signature)) {
		return Forbidden("匿名下载链接无效")
	}
	return nil
}

func (s *Service) signPublicResource(resourceID string, expires string) (string, error) {
	key, err := s.settingsEncryptionKey()
	if err != nil {
		return "", err
	}
	mac := hmac.New(sha256.New, key)
	_, _ = mac.Write([]byte(resourceID + "\n" + expires))
	return base64.RawURLEncoding.EncodeToString(mac.Sum(nil)), nil
}

func (s *Service) publicResourceBaseURL() (*url.URL, error) {
	_, setting, err := s.readOSSSetting()
	if err != nil {
		return nil, err
	}
	raw := firstNonEmpty(setting.PublicBaseURL, os.Getenv("CANVAS_PUBLIC_BASE_URL"))
	if raw == "" {
		return nil, BadAuthRequest("服务器本地存储尚未配置服务器访问地址，请设置 CANVAS_PUBLIC_BASE_URL 或在存储设置中配置公网访问地址（或改用 OSS 存储）")
	}
	return validatePublicResourceBaseURL(raw)
}

func validatePublicResourceBaseURL(raw string) (*url.URL, error) {
	parsed, err := ValidateOutboundURL(raw)
	if err != nil {
		return nil, err
	}
	if parsed.RawQuery != "" || parsed.Fragment != "" {
		return nil, BadAuthRequest("服务器访问地址不能包含查询参数或片段")
	}
	if strings.HasSuffix(strings.TrimRight(parsed.Path, "/"), "/api") {
		return nil, BadAuthRequest("服务器访问地址请填写根地址，不要包含 /api")
	}
	return parsed, nil
}

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
	if existing != nil && existing.Status == model.ResourceStatusReady {
		return existing, nil
	}
	if existing != nil && existing.Status == model.ResourceStatusPending {
		return nil, resourceUploadInProgress()
	}
	file, err := header.Open()
	if err != nil {
		return nil, err
	}
	defer file.Close()

	mimeType := strings.TrimSpace(header.Header.Get("Content-Type"))
	mimeType = detectUploadedMimeType(file, header.Filename, mimeType)
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
// 它与 UploadResource 共享资源幂等、媒体探测、配额和持久化语义，唯一差异是分片会话已在 handler 校验单文件上限，
// 因而此处不再重复该上限检查；uploadIdentity 用于跨请求重试时复用同一逻辑资源，避免重复对象。
func (s *Service) UploadResourceFile(userID string, fileName string, size int64, kind string, width int, height int, durationMs int64, file io.ReadSeeker, uploadIdentity ...string) (*model.Resource, error) {
	if file == nil || size <= 0 {
		return nil, BadAuthRequest("请选择要上传的文件")
	}
	uploadKey := normalizedResourceUploadKey(uploadIdentity)
	existing, err := s.resourceForUploadKey(userID, uploadKey)
	if err != nil {
		return nil, err
	}
	if existing != nil && existing.Status == model.ResourceStatusReady {
		return existing, nil
	}
	if existing != nil && existing.Status == model.ResourceStatusPending {
		return nil, resourceUploadInProgress()
	}
	mimeType := detectUploadedMimeType(file, fileName, "")
	if existing != nil {
		return s.retryStoredResource(userID, existing, kind, mimeType, size, file)
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

func detectUploadedMimeType(file io.ReadSeeker, fileName string, declared string) string {
	declared = strings.TrimSpace(strings.Split(declared, ";")[0])
	if declared != "" && declared != "application/octet-stream" {
		return declared
	}
	buffer := make([]byte, 512)
	read, _ := file.Read(buffer)
	_, _ = file.Seek(0, io.SeekStart)
	if detected := http.DetectContentType(buffer[:read]); detected != "" && detected != "application/octet-stream" {
		return strings.TrimSpace(strings.Split(detected, ";")[0])
	}
	if fromExtension := mime.TypeByExtension(filepath.Ext(fileName)); fromExtension != "" {
		return strings.TrimSpace(strings.Split(fromExtension, ";")[0])
	}
	return "application/octet-stream"
}

func (s *Service) ImportResourceURL(userID string, rawURL string, kind string, width int, height int, durationMs int64, uploadIdentity ...string) (*model.Resource, error) {
	uploadKey := normalizedResourceUploadKey(uploadIdentity)
	existing, err := s.resourceForUploadKey(userID, uploadKey)
	if err != nil {
		return nil, err
	}
	if existing != nil && existing.Status == model.ResourceStatusReady {
		return existing, nil
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
	kind = normalizeResourceKind(kind, payload.mimeType)
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
	stream, err := getOriginOSSObjectRange(setting, resource.ObjectKey, normalizeSingleByteRange(rangeHeader))
	if err != nil {
		return nil, err
	}
	return &ResourceStream{Resource: resource, Body: stream.Body, StatusCode: stream.StatusCode, ContentLength: stream.ContentLength, ContentRange: stream.ContentRange, AcceptRanges: stream.AcceptRanges}, nil
}

func (s *Service) storeResource(userID string, kind string, fileName string, mimeType string, size int64, width int, height int, durationMs int64, body io.Reader, uploadKey *string, forceLocal bool) (*model.Resource, bool, error) {
	return s.storeResourceWithWriter(userID, kind, fileName, mimeType, size, width, height, durationMs, body, uploadKey, forceLocal, s.storeResourceObject)
}

func (s *Service) storeResourceWithWriter(userID string, kind string, fileName string, mimeType string, size int64, width int, height int, durationMs int64, body io.Reader, uploadKey *string, forceLocal bool, writeObject func(*model.Resource, string, io.Reader) (string, error)) (*model.Resource, bool, error) {
	if existing, err := s.resourceForUploadKey(userID, uploadKey); err != nil {
		return nil, false, err
	} else if existing != nil {
		if existing.Status == model.ResourceStatusReady {
			return existing, false, nil
		}
		return nil, false, resourceUploadInProgress()
	}
	now := time.Now()
	// Live2D is reserved for the administrator's validated local import path.
	if !(forceLocal && kind == "live2d") {
		kind = normalizeResourceKind(kind, mimeType)
	}
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
	if err := s.repo.SaveResource(&resource); err != nil {
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

// A cloud write is successful only after the configured origin accepts it.
// storeResourceObject writes to the configured origin and degrades to local storage
// when the external origin is unavailable. The resource binding is rewritten before
// the caller persists the ready state, so later reads follow the actual object location.
func (s *Service) storeResourceObject(resource *model.Resource, fileName string, body io.Reader) (string, error) {
	if resource == nil {
		return "", errors.New("资源不存在")
	}
	if resource.Provider == "local" {
		return "", writeLocalResourceObject(filepath.Join(s.dataDir, "resources", filepath.FromSlash(resource.ObjectKey)), body)
	}
	setting, settingErr := s.ossSettingForResource(resource.UserID, resource)
	var etag string
	var putErr error
	if settingErr == nil {
		etag, putErr = putOSSObject(setting, resource.ObjectKey, resource.MimeType, resource.Size, body)
	}
	if putErr == nil && settingErr == nil {
		return etag, nil
	}
	fallbackErr := putErr
	if fallbackErr == nil {
		fallbackErr = settingErr
	}
	if seeker, ok := body.(io.Seeker); ok {
		if _, seekErr := seeker.Seek(0, io.SeekStart); seekErr != nil {
			return "", errors.Join(fallbackErr, fmt.Errorf("降级本地存储时重置读取位置失败：%w", seekErr))
		}
	}
	localKey := localObjectKey(resource.UserID, resource.Kind, fileName, resource.MimeType, time.Now())
	resource.Provider = "local"
	resource.ObjectKey = localKey
	resource.Endpoint = ""
	resource.Bucket = ""
	resource.StorageSettingID = ""
	resource.ETag = ""
	if localErr := writeLocalResourceObject(filepath.Join(s.dataDir, "resources", filepath.FromSlash(localKey)), body); localErr != nil {
		return "", errors.Join(fallbackErr, fmt.Errorf("降级本地存储失败：%w", localErr))
	}
	log.Printf("object storage upload degraded to local storage: resource=%s error=%v", resource.ID, fallbackErr)
	return "", nil
}

func (s *Service) retryStoredResource(userID string, resource *model.Resource, kind string, mimeType string, size int64, body io.Reader) (*model.Resource, error) {
	if resource == nil {
		return nil, errors.New("资源不存在")
	}
	if resource.Status == model.ResourceStatusReady {
		return resource, nil
	}
	if resource.Status != model.ResourceStatusFailed {
		return nil, resourceUploadInProgress()
	}
	kind = normalizeResourceKind(kind, mimeType)
	if resource.Size != size || resource.Kind != kind || (resource.MimeType != "" && mimeType != "" && resource.MimeType != mimeType) {
		return nil, NewAppError(http.StatusConflict, "上传幂等标识已用于其他文件")
	}
	claimed, err := s.repo.ClaimFailedResourceUpload(userID, resource.ID)
	if err != nil {
		return nil, err
	}
	if !claimed {
		latest, latestErr := s.repo.ResourceForUser(userID, resource.ID)
		if latestErr == nil && latest.Status == model.ResourceStatusReady {
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
	if err := s.repo.SaveResource(resource); err != nil {
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

func localObjectKey(userID string, kind string, fileName string, mimeType string, now time.Time) string {
	ext := resourceFileExtension(fileName, mimeType, kind)
	return path.Join("users", safeObjectSegment(userID), kind, now.Format("2006/01/02"), newID()+ext)
}

func (s *Service) persistGeneratedMediaResult(userID string, result map[string]interface{}) (map[string]interface{}, error) {
	return s.persistGeneratedMediaResultMode(userID, result, false, true)
}

func (s *Service) persistLegacyGeneratedMediaResult(userID string, result map[string]interface{}) (map[string]interface{}, error) {
	return s.persistGeneratedMediaResultMode(userID, result, true, false)
}

func (s *Service) persistGeneratedMediaResultMode(userID string, result map[string]interface{}, skipInvalidDataURL bool, enforceQuota bool) (map[string]interface{}, error) {
	if result == nil {
		return map[string]interface{}{}, nil
	}
	encoded, err := json.Marshal(result)
	if err != nil {
		return nil, err
	}
	var normalized map[string]interface{}
	if err := json.Unmarshal(encoded, &normalized); err != nil {
		return nil, err
	}
	value, err := s.persistGeneratedMediaValueMode(userID, normalized, skipInvalidDataURL, enforceQuota)
	if err != nil {
		return nil, err
	}
	return value.(map[string]interface{}), nil
}

func (s *Service) persistGeneratedMediaValue(userID string, value interface{}) (interface{}, error) {
	return s.persistGeneratedMediaValueMode(userID, value, false, true)
}

func (s *Service) persistGeneratedMediaValueMode(userID string, value interface{}, skipInvalidDataURL bool, enforceQuota bool) (interface{}, error) {
	switch item := value.(type) {
	case []interface{}:
		for index, child := range item {
			stored, err := s.persistGeneratedMediaValueMode(userID, child, skipInvalidDataURL, enforceQuota)
			if err != nil {
				return nil, err
			}
			item[index] = stored
		}
		return item, nil
	case map[string]interface{}:
		if raw := inlineMediaValue(item); raw != "" {
			mimeType, data, err := s.decodeDataURL(raw)
			if err != nil && !skipInvalidDataURL {
				return nil, err
			}
			if err == nil {
				kind := normalizeResourceKind("", mimeType)
				width, height := intValue(item["width"]), intValue(item["height"])
				if kind == "image" && (width <= 0 || height <= 0) {
					width, height = imageDimensions(data)
				}
				quotaDay := ""
				if enforceQuota {
					quotaDay, err = s.reserveGeneratedResourceQuota(userID, int64(len(data)))
					if err != nil {
						return nil, err
					}
				}
				resource, _, err := s.storeResource(userID, kind, "generated."+extensionFromMimeType(mimeType), mimeType, int64(len(data)), width, height, int64(intValue(item["durationMs"])), bytes.NewReader(data), nil, false)
				if err != nil {
					if enforceQuota {
						s.releaseUserUploadQuota(userID, quotaDay, int64(len(data)))
					}
					return nil, fmt.Errorf("生成内容写入资源存储失败：%w", err)
				}
				if enforceQuota {
					s.commitUserUploadQuota(userID, int64(len(data)))
				}
				resourceURL := resourceFileURL(resource.ID)
				for _, key := range []string{"dataUrl", "content", "url", "coverUrl"} {
					if text, ok := item[key].(string); ok && (text == raw || strings.HasPrefix(text, "blob:")) {
						item[key] = resourceURL
					}
				}
				if _, ok := item["dataUrl"]; ok {
					item["dataUrl"] = resourceURL
				}
				item["url"] = resourceURL
				item["storageKey"] = "resource:" + resource.ID
				item["resourceId"] = resource.ID
				item["bytes"] = resource.Size
				item["mimeType"] = resource.MimeType
				item["width"] = resource.Width
				item["height"] = resource.Height
			}
		}
		for key, child := range item {
			stored, err := s.persistGeneratedMediaValueMode(userID, child, skipInvalidDataURL, enforceQuota)
			if err != nil {
				return nil, err
			}
			item[key] = stored
		}
		return item, nil
	default:
		return value, nil
	}
}

func inlineMediaValue(item map[string]interface{}) string {
	for _, key := range []string{"dataUrl", "content", "url", "coverUrl"} {
		if text, ok := item[key].(string); ok && (strings.HasPrefix(text, "data:image/") || strings.HasPrefix(text, "data:video/") || strings.HasPrefix(text, "data:audio/")) {
			return text
		}
	}
	return ""
}

func (s *Service) decodeDataURL(value string) (string, []byte, error) {
	header, encoded, ok := strings.Cut(value, ",")
	if !ok || !strings.HasPrefix(header, "data:") || !strings.HasSuffix(strings.ToLower(header), ";base64") {
		return "", nil, fmt.Errorf("%w：格式无效", errInvalidGeneratedDataURL)
	}
	mimeType := strings.TrimSuffix(strings.TrimPrefix(header, "data:"), ";base64")
	data, err := base64.StdEncoding.DecodeString(encoded)
	if err != nil {
		return "", nil, fmt.Errorf("%w：base64 解码失败：%v", errInvalidGeneratedDataURL, err)
	}
	policy, err := s.RuntimePolicy()
	if err != nil {
		return "", nil, err
	}
	if int64(len(data)) > megabytes(policy.Resource.GeneratedFileMB) {
		return "", nil, fmt.Errorf("单个生成资源超过 %dMB", policy.Resource.GeneratedFileMB)
	}
	return mimeType, data, nil
}

func intValue(value interface{}) int {
	switch number := value.(type) {
	case float64:
		return int(number)
	case int:
		return number
	case int64:
		return int(number)
	default:
		return 0
	}
}

type remoteResourcePayload struct {
	url      string
	endpoint string
	fileName string
	mimeType string
	data     []byte
}

func downloadRemoteResource(rawURL string, maxBytes int64) (remoteResourcePayload, error) {
	parsed, err := validateRemoteResourceURL(rawURL)
	if err != nil {
		return remoteResourcePayload{}, err
	}
	client := OutboundHTTPClient(90 * time.Second)
	req, err := http.NewRequest(http.MethodGet, parsed.String(), nil)
	if err != nil {
		return remoteResourcePayload{}, err
	}
	resp, err := client.Do(req)
	if err != nil {
		return remoteResourcePayload{}, err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return remoteResourcePayload{}, fmt.Errorf("远程资源下载失败：%s", resp.Status)
	}
	data, err := io.ReadAll(io.LimitReader(resp.Body, maxBytes))
	if err != nil {
		return remoteResourcePayload{}, err
	}
	if int64(len(data)) >= maxBytes {
		return remoteResourcePayload{}, BadAuthRequest(fmt.Sprintf("远程资源必须小于 %s", formatStorageLimit(maxBytes)))
	}
	mimeType := strings.TrimSpace(resp.Header.Get("Content-Type"))
	if idx := strings.Index(mimeType, ";"); idx >= 0 {
		mimeType = strings.TrimSpace(mimeType[:idx])
	}
	if mimeType == "" || mimeType == "application/octet-stream" {
		mimeType = http.DetectContentType(data)
	}
	fileName := path.Base(parsed.Path)
	if fileName == "" || fileName == "." || !strings.Contains(fileName, ".") {
		fileName = "resource." + extensionFromMimeType(mimeType)
	}
	return remoteResourcePayload{url: parsed.String(), endpoint: parsed.Host, fileName: fileName, mimeType: mimeType, data: data}, nil
}

func openRemoteResource(rawURL string) (io.ReadCloser, error) {
	parsed, err := validateRemoteResourceURL(rawURL)
	if err != nil {
		return nil, err
	}
	client := OutboundHTTPClient(90 * time.Second)
	resp, err := client.Get(parsed.String())
	if err != nil {
		return nil, err
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		defer resp.Body.Close()
		return nil, fmt.Errorf("远程资源读取失败：%s", resp.Status)
	}
	return resp.Body, nil
}

func validateRemoteResourceURL(rawURL string) (*url.URL, error) {
	return ValidateOutboundURL(rawURL)
}

func extensionFromMimeType(mimeType string) string {
	if strings.Contains(mimeType, "png") {
		return "png"
	}
	if strings.Contains(mimeType, "jpeg") {
		return "jpg"
	}
	if strings.Contains(mimeType, "webp") {
		return "webp"
	}
	if strings.Contains(mimeType, "gif") {
		return "gif"
	}
	if strings.Contains(mimeType, "mp4") {
		return "mp4"
	}
	if strings.Contains(mimeType, "webm") {
		return "webm"
	}
	if strings.Contains(mimeType, "mpeg") {
		return "mp3"
	}
	if strings.Contains(mimeType, "wav") {
		return "wav"
	}
	return "bin"
}

func resourceFileExtension(fileName string, mimeType string, kind string) string {
	if ext := strings.ToLower(filepath.Ext(strings.TrimSpace(fileName))); ext != "" && ext != "." {
		return ext
	}
	cleanMimeType := strings.TrimSpace(strings.Split(mimeType, ";")[0])
	if extensions, err := mime.ExtensionsByType(cleanMimeType); err == nil && len(extensions) > 0 {
		return strings.ToLower(extensions[0])
	}
	switch kind {
	case "image":
		return ".png"
	case "video":
		return ".mp4"
	case "audio":
		return ".mp3"
	default:
		return ".bin"
	}
}

func imageDimensions(data []byte) (int, int) {
	config, _, err := image.DecodeConfig(bytes.NewReader(data))
	if err != nil {
		return 0, 0
	}
	return config.Width, config.Height
}

func (s *Service) activeOSSSetting() (ossSettingValue, error) {
	_, setting, err := s.readOSSSetting()
	if err != nil {
		return ossSettingValue{}, err
	}
	return validateActiveOSSSetting(setting, "管理员尚未启用 OSS", "平台 OSS 配置不完整，请联系管理员")
}

func (s *Service) activeResourceOSSSetting(userID string) (ossSettingValue, string, bool, error) {
	userSetting, value, err := s.readUserOSSSetting(userID)
	if err != nil {
		return ossSettingValue{}, "", false, err
	}
	_, systemValue, err := s.readOSSSetting()
	if err != nil {
		return ossSettingValue{}, "", false, err
	}
	userAllowed := value.Provider != s3Provider || systemValue.AllowUserS3
	if userSetting != nil && value.Enabled && userAllowed {
		value, err = validateActiveOSSSetting(value, "用户 OSS 尚未启用", "你的 OSS 配置不完整")
		return value, firstNonEmpty(value.StorageLocationID, userSetting.ID), true, err
	}
	if !systemValue.Enabled {
		return ossSettingValue{}, "", false, nil
	}
	systemValue, err = validateActiveOSSSetting(systemValue, "管理员尚未启用 OSS", "平台 OSS 配置不完整，请联系管理员")
	return systemValue, systemValue.StorageLocationID, true, err
}

func (s *Service) ossSettingForResource(userID string, resource *model.Resource) (ossSettingValue, error) {
	var setting ossSettingValue
	var err error
	if resource.StorageSettingID != "" {
		_, setting, err = s.storageLocationValue(resource.StorageSettingID)
		if errors.Is(err, gorm.ErrRecordNotFound) {
			_, setting, err = s.readUserOSSSettingByID(userID, resource.StorageSettingID)
		}
		if err == nil {
			_, current, currentErr := s.readUserOSSSetting(userID)
			if currentErr != nil {
				return ossSettingValue{}, currentErr
			}
			// 密钥固定在资源绑定的历史版本；只有存储位置完全一致时，才允许沿用当前 CDN。
			if resourceStorageMatches(current, resource) {
				setting.CDNBaseURL = current.CDNBaseURL
				// CDN 的鉴权方式和回退策略属于分发配置，而不是资源创建时的
				// 凭据。存储位置未变时沿用当前策略，避免历史资源因管理员
				// 刚补齐 CDN 鉴权配置而继续回源。
				setting.Delivery = current.Delivery
			}
		}
	} else {
		// 早期资源没有 StorageSettingID，但资源本身仍记录了 provider/endpoint/bucket。
		// 先从用户 OSS 历史版本中按存储位置反查，不能把当前七牛配置猜给历史阿里云对象。
		setting, err = s.userOSSSettingForResource(userID, resource)
		if errors.Is(err, gorm.ErrRecordNotFound) {
			_, setting, err = s.readOSSSetting()
		}
	}
	if err != nil {
		return ossSettingValue{}, err
	}
	resourceProvider := strings.ToLower(strings.TrimSpace(resource.Provider))
	resourceMatchesSetting := resourceStorageMatches(setting, resource)
	setting, err = ossSettingForProvider(setting, firstNonEmpty(resource.Provider, setting.Provider))
	if err != nil {
		return ossSettingValue{}, err
	}
	setting.Endpoint = firstNonEmpty(resource.Endpoint, setting.Endpoint)
	setting.Bucket = firstNonEmpty(resource.Bucket, setting.Bucket)
	// CDN 是具体存储位置的出口，不得在 provider/endpoint/bucket 不匹配时继续沿用，
	// 否则切换到七牛后会把历史阿里云 objectKey 拼成七牛域名。
	if !resourceMatchesSetting || (resourceProvider != "" && resourceProvider != setting.Provider) {
		setting.CDNBaseURL = ""
	}
	if setting.AccessKeyID == "" || setting.AccessKeySecret == "" {
		return ossSettingValue{}, errors.New("对象存储访问密钥不可用")
	}
	return setting, nil
}

func (s *Service) userOSSSettingForResource(userID string, resource *model.Resource) (ossSettingValue, error) {
	settings, err := s.repo.UserOSSSettingsForUser(userID)
	if err != nil {
		return ossSettingValue{}, err
	}
	for index := range settings {
		value, valueErr := s.userOSSSettingValue(&settings[index])
		if valueErr != nil {
			return ossSettingValue{}, valueErr
		}
		if resourceStorageMatches(value, resource) {
			return value, nil
		}
	}
	return ossSettingValue{}, gorm.ErrRecordNotFound
}

func resourceStorageMatches(setting ossSettingValue, resource *model.Resource) bool {
	if resource == nil {
		return false
	}
	setting = normalizeOSSSetting(setting)
	return setting.Provider == strings.ToLower(strings.TrimSpace(resource.Provider)) &&
		setting.Endpoint == strings.TrimRight(strings.TrimSpace(resource.Endpoint), "/") &&
		setting.Bucket == strings.TrimSpace(resource.Bucket)
}

func ossSettingForProvider(setting ossSettingValue, provider string) (ossSettingValue, error) {
	setting = normalizeOSSSetting(setting)
	provider = strings.ToLower(strings.TrimSpace(provider))
	if provider == "" || provider == setting.Provider {
		return setting, nil
	}
	credentials, ok := setting.ArchivedCredentials[provider]
	if !ok || credentials.AccessKeyID == "" || credentials.AccessKeySecret == "" {
		return ossSettingValue{}, errors.New("历史对象存储访问密钥不可用")
	}
	setting.Provider = provider
	setting.AccessKeyID = credentials.AccessKeyID
	setting.AccessKeySecret = credentials.AccessKeySecret
	return setting, nil
}

func validateActiveOSSSetting(setting ossSettingValue, disabledMessage string, incompleteMessage string) (ossSettingValue, error) {
	setting = normalizeOSSSetting(setting)
	if !setting.Enabled {
		return ossSettingValue{}, BadAuthRequest(disabledMessage)
	}
	if setting.Provider != aliyunOSSProvider && setting.Provider != tencentCOSProvider && setting.Provider != qiniuKodoProvider && setting.Provider != s3Provider {
		return ossSettingValue{}, BadAuthRequest("仅支持阿里云 OSS、腾讯云 COS、七牛云 Kodo 和通用 S3")
	}
	if setting.Bucket == "" || setting.Endpoint == "" || setting.AccessKeyID == "" || setting.AccessKeySecret == "" {
		return ossSettingValue{}, BadAuthRequest(incompleteMessage)
	}
	return setting, nil
}

func normalizeResourceKind(kind string, mimeType string) string {
	kind = strings.ToLower(strings.TrimSpace(kind))
	switch kind {
	case "image", "video", "audio", "file":
		return kind
	}
	if strings.HasPrefix(mimeType, "image/") {
		return "image"
	}
	if strings.HasPrefix(mimeType, "video/") {
		return "video"
	}
	if strings.HasPrefix(mimeType, "audio/") {
		return "audio"
	}
	return "file"
}

func ossObjectKey(setting ossSettingValue, userID string, kind string, fileName string, mimeType string, now time.Time) string {
	ext := resourceFileExtension(fileName, mimeType, kind)
	name := newID()
	parts := []string{setting.PathPrefix, "users", safeObjectSegment(userID), kind, now.Format("2006/01/02"), name + ext}
	return strings.Trim(strings.Join(nonEmptySegments(parts), "/"), "/")
}

func normalizeSingleByteRange(value string) string {
	value = strings.TrimSpace(value)
	if len(value) > 128 || !strings.HasPrefix(value, "bytes=") || strings.Contains(value, ",") {
		return ""
	}
	start, end, ok := strings.Cut(strings.TrimPrefix(value, "bytes="), "-")
	if !ok || (start == "" && end == "") || !decimalDigits(start) || !decimalDigits(end) {
		return ""
	}
	return "bytes=" + start + "-" + end
}

func decimalDigits(value string) bool {
	for _, char := range value {
		if char < '0' || char > '9' {
			return false
		}
	}
	return true
}

func safeObjectSegment(value string) string {
	value = strings.TrimSpace(value)
	value = strings.Map(func(r rune) rune {
		if (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9') || r == '-' || r == '_' {
			return r
		}
		return '-'
	}, value)
	return strings.Trim(value, "-")
}

func firstNonEmpty(values ...string) string {
	return kernel.FirstNonEmpty(values...)
}

func nonEmptySegments(values []string) []string {
	result := make([]string, 0, len(values))
	for _, value := range values {
		value = strings.Trim(strings.TrimSpace(path.Clean("/"+value)), "/")
		if value != "" && value != "." {
			result = append(result, value)
		}
	}
	return result
}
