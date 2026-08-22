package service

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha1"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"image"
	_ "image/gif"
	_ "image/jpeg"
	_ "image/png"
	"io"
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

	"infinite-canvas/backend/internal/model"

	"github.com/aws/aws-sdk-go/aws/credentials"
	awsv4 "github.com/aws/aws-sdk-go/aws/signer/v4"
	qiniuAuth "github.com/qiniu/go-sdk/v7/auth"
	qiniuStorage "github.com/qiniu/go-sdk/v7/storage"
	cos "github.com/tencentyun/cos-go-sdk-v5"
	"gorm.io/gorm"
)

const providerResourceURLTTL = 4 * time.Hour
const directResourceURLTTL = 5 * time.Minute

var errInvalidGeneratedDataURL = errors.New("生成内容 data URL 无效")

type ResourceStream struct {
	Resource      *model.Resource
	Body          io.ReadCloser
	StatusCode    int
	ContentLength int64
	ContentRange  string
	AcceptRanges  string
}

type ResourceDeliveryOptions struct {
	ForceDirect bool
	ForceProxy  bool
}

type ResourceDelivery struct {
	Resource    *model.Resource
	Stream      *ResourceStream
	RedirectURL string
}

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

// DirectResourceURL 先校验资源归属，再按实际存储位置签发短时下载地址。
func (s *Service) DirectResourceURL(userID string, id string) (string, error) {
	resource, err := s.repo.ResourceForUser(userID, id)
	if err != nil {
		return "", err
	}
	return s.directResourceURL(resource, time.Now().Add(directResourceURLTTL))
}

func (s *Service) directResourceURL(resource *model.Resource, expiresAt time.Time) (string, error) {
	if resource == nil {
		return "", errors.New("资源不存在")
	}
	if resource.Status != model.ResourceStatusReady {
		return "", BadAuthRequest("资源尚未上传完成")
	}
	if resource.Provider == "local" {
		return s.signedPublicResourceURL(resource.ID, expiresAt)
	}
	setting, err := s.ossSettingForResource(resource.UserID, resource)
	if err != nil {
		return "", err
	}
	setting.Provider = firstNonEmpty(resource.Provider, setting.Provider)
	setting.Endpoint = firstNonEmpty(resource.Endpoint, setting.Endpoint)
	setting.Bucket = firstNonEmpty(resource.Bucket, setting.Bucket)
	return signedOSSObjectURL(setting, resource.ObjectKey, expiresAt)
}

// PrepareResourceDelivery 统一决定浏览器资源出口：配置 CDN 时默认直连 CDN，显式代理仅用于需要同源 Blob 的内部读取。
func (s *Service) PrepareResourceDelivery(userID string, id string, options ResourceDeliveryOptions) (*ResourceDelivery, error) {
	resource, err := s.repo.ResourceForUser(userID, id)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, NotFound("资源不存在")
		}
		return nil, err
	}
	return s.prepareResourceDelivery(userID, resource, options)
}

func (s *Service) prepareResourceDelivery(userID string, resource *model.Resource, options ResourceDeliveryOptions) (*ResourceDelivery, error) {
	if resource == nil {
		return nil, errors.New("资源不存在")
	}
	if resource.Status != model.ResourceStatusReady {
		return nil, BadAuthRequest("资源尚未上传完成")
	}
	if resource.Provider != "local" && !options.ForceProxy {
		setting, err := s.ossSettingForResource(userID, resource)
		if err != nil {
			return nil, err
		}
		if setting.Provider == qiniuKodoProvider && setting.CDNBaseURL != "" {
			// 七牛私有空间即使配置了绑定域名，也不能匿名访问；必须使用
			// Kodo 私有下载签名，否则浏览器会收到 NotSupportAnonymous。
			redirectURL, err := signedOSSObjectURL(setting, resource.ObjectKey, time.Now().Add(directResourceURLTTL))
			if err != nil {
				return nil, err
			}
			return &ResourceDelivery{Resource: resource, RedirectURL: redirectURL}, nil
		}
		if setting.CDNBaseURL != "" {
			redirectURL, err := ossCDNObjectURL(setting.CDNBaseURL, resource.ObjectKey)
			if err != nil {
				return nil, err
			}
			return &ResourceDelivery{Resource: resource, RedirectURL: redirectURL}, nil
		}
		if options.ForceDirect {
			redirectURL, err := signedOSSObjectURL(setting, resource.ObjectKey, time.Now().Add(directResourceURLTTL))
			if err != nil {
				return nil, err
			}
			return &ResourceDelivery{Resource: resource, RedirectURL: redirectURL}, nil
		}
	}
	return &ResourceDelivery{Resource: resource}, nil
}

func (s *Service) signedPublicResourceURL(resourceID string, expiresAt time.Time) (string, error) {
	baseURL, err := s.publicResourceBaseURL()
	if err != nil {
		return "", err
	}
	expires := strconv.FormatInt(expiresAt.UTC().Unix(), 10)
	signature, err := s.signPublicResource(resourceID, expires)
	if err != nil {
		return "", err
	}
	baseURL.Path = strings.TrimRight(baseURL.Path, "/") + "/api/public/resources/" + url.PathEscape(resourceID) + "/file"
	query := baseURL.Query()
	query.Set("expires", expires)
	query.Set("signature", signature)
	baseURL.RawQuery = query.Encode()
	return baseURL.String(), nil
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

func (s *Service) UploadResource(userID string, header *multipart.FileHeader, kind string, width int, height int, durationMs int64) (*model.Resource, error) {
	if header == nil {
		return nil, BadAuthRequest("请选择要上传的文件")
	}
	day, err := s.reserveUserUploadQuota(userID, header.Size)
	if err != nil {
		return nil, err
	}
	file, err := header.Open()
	if err != nil {
		s.releaseUserUploadQuota(userID, day, header.Size)
		return nil, err
	}
	defer file.Close()

	mimeType := strings.TrimSpace(header.Header.Get("Content-Type"))
	mimeType = detectUploadedMimeType(file, header.Filename, mimeType)
	resource, err := s.storeResource(userID, kind, header.Filename, mimeType, header.Size, width, height, durationMs, file)
	if err != nil {
		s.releaseUserUploadQuota(userID, day, header.Size)
	} else {
		s.commitUserUploadQuota(userID, header.Size)
	}
	return resource, err
}

func detectUploadedMimeType(file multipart.File, fileName string, declared string) string {
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

func (s *Service) ImportResourceURL(userID string, rawURL string, kind string, width int, height int, durationMs int64) (*model.Resource, error) {
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
	day, err := s.reserveUserUploadQuota(userID, size)
	if err != nil {
		return nil, err
	}
	resource, err := s.storeResource(userID, kind, payload.fileName, payload.mimeType, size, width, height, durationMs, bytes.NewReader(payload.data))
	if err != nil {
		s.releaseUserUploadQuota(userID, day, size)
	} else {
		s.commitUserUploadQuota(userID, size)
	}
	return resource, err
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

func (s *Service) OpenPublicResourceRange(id string, expires string, signature string, rangeHeader string) (*ResourceStream, error) {
	resource, err := s.repo.Resource(id)
	if err != nil {
		return nil, Forbidden("匿名下载链接无效")
	}
	if resource.Provider != "local" {
		return nil, Forbidden("匿名下载链接无效")
	}
	if err := s.verifyPublicResourceSignature(resource.ID, expires, signature); err != nil {
		return nil, err
	}
	return s.openResourceRange(resource.UserID, resource, rangeHeader)
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
	stream, err := getOSSObjectRange(setting, resource.ObjectKey, normalizeSingleByteRange(rangeHeader))
	if err != nil {
		return nil, err
	}
	return &ResourceStream{Resource: resource, Body: stream.body, StatusCode: stream.statusCode, ContentLength: stream.contentLength, ContentRange: stream.contentRange, AcceptRanges: stream.acceptRanges}, nil
}

func (s *Service) storeResource(userID string, kind string, fileName string, mimeType string, size int64, width int, height int, durationMs int64, body io.Reader) (*model.Resource, error) {
	now := time.Now()
	kind = normalizeResourceKind(kind, mimeType)
	setting, storageSettingID, useOSS, err := s.activeResourceOSSSetting(userID)
	if err != nil {
		return nil, err
	}
	provider := "local"
	objectKey := localObjectKey(userID, kind, fileName, now)
	resource := model.Resource{ID: newID(), UserID: userID, Kind: kind, Status: model.ResourceStatusPending, Provider: provider, ObjectKey: objectKey, MimeType: mimeType, Size: size, Width: width, Height: height, DurationMs: durationMs, CreatedAt: now, UpdatedAt: now}
	if useOSS {
		provider = setting.Provider
		objectKey = ossObjectKey(setting, userID, kind, fileName, now)
		resource.Provider = provider
		resource.Endpoint = setting.Endpoint
		resource.Bucket = setting.Bucket
		resource.StorageSettingID = storageSettingID
		resource.ObjectKey = objectKey
	}
	if err := s.repo.CreateResource(&resource); err != nil {
		return nil, err
	}
	var etag string
	if provider == "local" {
		filePath := filepath.Join(s.dataDir, "resources", filepath.FromSlash(objectKey))
		if err = os.MkdirAll(filepath.Dir(filePath), 0o750); err == nil {
			var file *os.File
			file, err = os.OpenFile(filePath, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o640)
			if err == nil {
				_, err = io.Copy(file, body)
				closeErr := file.Close()
				if err == nil {
					err = closeErr
				}
			}
		}
	} else {
		etag, err = putOSSObject(setting, objectKey, mimeType, size, body)
	}
	resource.UpdatedAt = time.Now()
	if err != nil {
		resource.Status = model.ResourceStatusFailed
		resource.Error = err.Error()
		if saveErr := s.repo.SaveResource(&resource); saveErr != nil {
			return nil, errors.Join(err, fmt.Errorf("记录资源失败状态失败：%w", saveErr))
		}
		return nil, err
	}
	resource.Status = model.ResourceStatusReady
	resource.ETag = etag
	if err := s.repo.SaveResource(&resource); err != nil {
		cleanupErr := s.deleteStoredResourceObject(userID, &resource)
		if cleanupErr == nil {
			if deleteErr := s.repo.DeleteResource(userID, resource.ID); deleteErr != nil {
				return nil, errors.Join(err, fmt.Errorf("清理资源记录失败：%w", deleteErr))
			}
			return nil, fmt.Errorf("保存资源就绪状态失败：%w", err)
		}

		resource.Status = model.ResourceStatusFailed
		resource.Error = fmt.Sprintf("保存资源就绪状态失败，物理对象清理失败：%v", cleanupErr)
		statusErr := s.repo.SaveResource(&resource)
		if statusErr != nil {
			return nil, errors.Join(err, cleanupErr, fmt.Errorf("记录资源失败状态失败：%w", statusErr))
		}
		return nil, errors.Join(err, fmt.Errorf("清理已上传资源对象失败：%w", cleanupErr))
	}
	s.recordActivity(userID, "resource", 1)
	return &resource, nil
}

func localObjectKey(userID string, kind string, fileName string, now time.Time) string {
	ext := strings.ToLower(filepath.Ext(fileName))
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
				resource, err := s.storeResource(userID, kind, "generated."+extensionFromMimeType(mimeType), mimeType, int64(len(data)), width, height, int64(intValue(item["durationMs"])), bytes.NewReader(data))
				if err != nil {
					if enforceQuota {
						s.releaseUserUploadQuota(userID, quotaDay, int64(len(data)))
					}
					return nil, fmt.Errorf("生成内容写入资源存储失败：%w", err)
				}
				if enforceQuota {
					s.commitUserUploadQuota(userID, int64(len(data)))
				}
				resourceURL := "/api/resources/" + resource.ID + "/file"
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
	if userSetting != nil && value.Enabled {
		value, err = validateActiveOSSSetting(value, "用户 OSS 尚未启用", "你的 OSS 配置不完整")
		return value, userSetting.ID, true, err
	}
	_, systemValue, err := s.readOSSSetting()
	if err != nil {
		return ossSettingValue{}, "", false, err
	}
	if !systemValue.Enabled {
		return ossSettingValue{}, "", false, nil
	}
	systemValue, err = validateActiveOSSSetting(systemValue, "管理员尚未启用 OSS", "平台 OSS 配置不完整，请联系管理员")
	return systemValue, "", true, err
}

func (s *Service) ossSettingForResource(userID string, resource *model.Resource) (ossSettingValue, error) {
	var setting ossSettingValue
	var err error
	if resource.StorageSettingID != "" {
		_, setting, err = s.readUserOSSSettingByID(userID, resource.StorageSettingID)
		if err == nil {
			_, current, currentErr := s.readUserOSSSetting(userID)
			if currentErr != nil {
				return ossSettingValue{}, currentErr
			}
			// 密钥固定在资源绑定的历史版本；只有存储位置完全一致时，才允许沿用当前 CDN。
			if resourceStorageMatches(current, resource) {
				setting.CDNBaseURL = current.CDNBaseURL
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
	if setting.Provider != aliyunOSSProvider && setting.Provider != tencentCOSProvider && setting.Provider != qiniuKodoProvider {
		return ossSettingValue{}, BadAuthRequest("仅支持阿里云 OSS、腾讯云 COS 和七牛云 Kodo")
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

func ossObjectKey(setting ossSettingValue, userID string, kind string, fileName string, now time.Time) string {
	ext := strings.ToLower(filepath.Ext(fileName))
	name := newID()
	parts := []string{setting.PathPrefix, "users", safeObjectSegment(userID), kind, now.Format("2006/01/02"), name + ext}
	return strings.Trim(strings.Join(nonEmptySegments(parts), "/"), "/")
}

func putOSSObject(setting ossSettingValue, objectKey string, mimeType string, size int64, body io.Reader) (string, error) {
	setting = normalizeOSSSetting(setting)
	if setting.Provider == tencentCOSProvider {
		return putCOSObject(setting, objectKey, mimeType, size, body)
	}
	if setting.Provider == qiniuKodoProvider {
		return putQiniuObject(setting, objectKey, mimeType, size, body)
	}
	return putAliyunOSSObject(setting, objectKey, mimeType, size, body)
}

// 阿里云 OSS 继续沿用原有 V1 签名和请求路径，避免已有部署行为发生变化。
func putAliyunOSSObject(setting ossSettingValue, objectKey string, mimeType string, size int64, body io.Reader) (string, error) {
	if mimeType == "" {
		mimeType = "application/octet-stream"
	}
	req, err := newOSSRequest(http.MethodPut, setting, objectKey, mimeType, body)
	if err != nil {
		return "", err
	}
	if size > 0 {
		req.ContentLength = size
	}
	resp, err := OutboundHTTPClient(2 * time.Minute).Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		detail, _ := io.ReadAll(io.LimitReader(resp.Body, 512))
		return "", fmt.Errorf("OSS 上传失败：%s %s", resp.Status, strings.TrimSpace(string(detail)))
	}
	return strings.Trim(resp.Header.Get("ETag"), `"`), nil
}

type ossObjectStream struct {
	body          io.ReadCloser
	statusCode    int
	contentLength int64
	contentRange  string
	acceptRanges  string
}

func getOSSObjectRange(setting ossSettingValue, objectKey string, rangeHeader string) (*ossObjectStream, error) {
	setting = normalizeOSSSetting(setting)
	if setting.CDNBaseURL != "" {
		return getOSSObjectRangeViaCDN(setting, objectKey, rangeHeader)
	}
	if setting.Provider == tencentCOSProvider {
		return getCOSObjectRange(setting, objectKey, rangeHeader)
	}
	if setting.Provider == qiniuKodoProvider {
		return getQiniuObjectRange(setting, objectKey, rangeHeader)
	}
	return getAliyunOSSObjectRange(setting, objectKey, rangeHeader)
}

func getAliyunOSSObjectRange(setting ossSettingValue, objectKey string, rangeHeader string) (*ossObjectStream, error) {
	req, err := newOSSRequest(http.MethodGet, setting, objectKey, "", nil)
	if err != nil {
		return nil, err
	}
	if rangeHeader != "" {
		req.Header.Set("Range", rangeHeader)
	}
	resp, err := OutboundHTTPClient(2 * time.Minute).Do(req)
	if err != nil {
		return nil, err
	}
	if (resp.StatusCode < 200 || resp.StatusCode >= 300) && resp.StatusCode != http.StatusRequestedRangeNotSatisfiable {
		defer resp.Body.Close()
		detail, _ := io.ReadAll(io.LimitReader(resp.Body, 512))
		return nil, fmt.Errorf("OSS 读取失败：%s %s", resp.Status, strings.TrimSpace(string(detail)))
	}
	return &ossObjectStream{body: resp.Body, statusCode: resp.StatusCode, contentLength: resp.ContentLength, contentRange: resp.Header.Get("Content-Range"), acceptRanges: firstNonEmpty(resp.Header.Get("Accept-Ranges"), "bytes")}, nil
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

func signedOSSObjectURL(setting ossSettingValue, objectKey string, expiresAt time.Time) (string, error) {
	setting = normalizeOSSSetting(setting)
	if setting.Provider == qiniuKodoProvider {
		return signedQiniuObjectURL(setting, objectKey, expiresAt)
	}
	if setting.CDNBaseURL != "" {
		return ossCDNObjectURL(setting.CDNBaseURL, objectKey)
	}
	if setting.Provider == tencentCOSProvider {
		return signedCOSObjectURL(setting, objectKey, expiresAt)
	}
	return signedAliyunOSSObjectURL(setting, objectKey, expiresAt)
}

func signedAliyunOSSObjectURL(setting ossSettingValue, objectKey string, expiresAt time.Time) (string, error) {
	baseURL, err := ossBucketBaseURL(setting)
	if err != nil {
		return "", err
	}
	if strings.TrimSpace(setting.AccessKeyID) == "" || strings.TrimSpace(setting.AccessKeySecret) == "" {
		return "", errors.New("OSS 访问密钥不可用")
	}
	objectKey = strings.TrimLeft(strings.TrimSpace(objectKey), "/")
	if objectKey == "" {
		return "", errors.New("OSS 对象路径为空")
	}
	baseURL.Path = strings.TrimRight(baseURL.Path, "/") + "/" + escapeObjectKey(objectKey)
	expires := strconv.FormatInt(expiresAt.UTC().Unix(), 10)
	stringToSign := strings.Join([]string{http.MethodGet, "", "", expires, "/" + setting.Bucket + "/" + objectKey}, "\n")
	mac := hmac.New(sha1.New, []byte(setting.AccessKeySecret))
	_, _ = mac.Write([]byte(stringToSign))
	query := baseURL.Query()
	query.Set("OSSAccessKeyId", setting.AccessKeyID)
	query.Set("Expires", expires)
	query.Set("Signature", base64.StdEncoding.EncodeToString(mac.Sum(nil)))
	baseURL.RawQuery = query.Encode()
	return baseURL.String(), nil
}

func putCOSObject(setting ossSettingValue, objectKey string, mimeType string, size int64, body io.Reader) (string, error) {
	client, err := newCOSClient(setting, 2*time.Minute)
	if err != nil {
		return "", err
	}
	if mimeType == "" {
		mimeType = "application/octet-stream"
	}
	options := &cos.ObjectPutOptions{ObjectPutHeaderOptions: &cos.ObjectPutHeaderOptions{ContentType: mimeType, ContentLength: size}}
	resp, err := client.Object.Put(context.Background(), objectKey, body, options)
	if err != nil {
		return "", fmt.Errorf("COS 上传失败：%w", err)
	}
	return strings.Trim(resp.Header.Get("ETag"), `"`), nil
}

func putQiniuObject(setting ossSettingValue, objectKey string, mimeType string, size int64, body io.Reader) (string, error) {
	if setting.AccessKeyID == "" || setting.AccessKeySecret == "" {
		return "", errors.New("七牛云 Kodo 访问密钥不可用")
	}
	if setting.Bucket == "" || objectKey == "" {
		return "", errors.New("七牛云 Kodo Bucket 或对象路径为空")
	}
	config := qiniuStorage.NewConfig()
	config.Region = qiniuRegion(setting.Region)
	config.UpHost = strings.TrimRight(setting.Endpoint, "/")
	uploader := qiniuStorage.NewFormUploader(config)
	policy := qiniuStorage.PutPolicy{Scope: setting.Bucket + ":" + strings.TrimLeft(objectKey, "/"), Expires: 3600}
	token := policy.UploadToken(qiniuAuth.New(setting.AccessKeyID, setting.AccessKeySecret))
	ret := qiniuStorage.PutRet{}
	extra := &qiniuStorage.PutExtra{MimeType: mimeType}
	if size < 0 {
		size = 0
	}
	if err := uploader.Put(context.Background(), &ret, token, strings.TrimLeft(objectKey, "/"), body, size, extra); err != nil {
		return "", fmt.Errorf("七牛云 Kodo 上传失败：%w", err)
	}
	return ret.Hash, nil
}

func getCOSObjectRange(setting ossSettingValue, objectKey string, rangeHeader string) (*ossObjectStream, error) {
	client, err := newCOSClient(setting, 2*time.Minute)
	if err != nil {
		return nil, err
	}
	options := &cos.ObjectGetOptions{Range: rangeHeader}
	resp, err := client.Object.Get(context.Background(), objectKey, options)
	if err != nil {
		if resp != nil && resp.StatusCode == http.StatusRequestedRangeNotSatisfiable {
			return &ossObjectStream{body: io.NopCloser(bytes.NewReader(nil)), statusCode: resp.StatusCode, contentRange: resp.Header.Get("Content-Range"), acceptRanges: firstNonEmpty(resp.Header.Get("Accept-Ranges"), "bytes")}, nil
		}
		return nil, fmt.Errorf("COS 读取失败：%w", err)
	}
	return &ossObjectStream{body: resp.Body, statusCode: resp.StatusCode, contentLength: resp.ContentLength, contentRange: resp.Header.Get("Content-Range"), acceptRanges: firstNonEmpty(resp.Header.Get("Accept-Ranges"), "bytes")}, nil
}

func getQiniuObjectRange(setting ossSettingValue, objectKey string, rangeHeader string) (*ossObjectStream, error) {
	signedURL, err := signedQiniuObjectURL(setting, objectKey, time.Now().Add(directResourceURLTTL))
	if err != nil {
		return nil, err
	}
	req, err := http.NewRequest(http.MethodGet, signedURL, nil)
	if err != nil {
		return nil, err
	}
	if rangeHeader != "" {
		req.Header.Set("Range", rangeHeader)
	}
	ApplyDefaultOutboundHeaders(req)
	resp, err := OutboundHTTPClient(2 * time.Minute).Do(req)
	if err != nil {
		return nil, fmt.Errorf("七牛云 Kodo 读取失败：%w", err)
	}
	if (resp.StatusCode < 200 || resp.StatusCode >= 300) && resp.StatusCode != http.StatusRequestedRangeNotSatisfiable {
		defer resp.Body.Close()
		detail, _ := io.ReadAll(io.LimitReader(resp.Body, 512))
		return nil, fmt.Errorf("七牛云 Kodo 读取失败：%s %s", resp.Status, strings.TrimSpace(string(detail)))
	}
	return &ossObjectStream{body: resp.Body, statusCode: resp.StatusCode, contentLength: resp.ContentLength, contentRange: resp.Header.Get("Content-Range"), acceptRanges: firstNonEmpty(resp.Header.Get("Accept-Ranges"), "bytes")}, nil
}

func getOSSObjectRangeViaCDN(setting ossSettingValue, objectKey string, rangeHeader string) (*ossObjectStream, error) {
	signedURL, err := signedOSSObjectURL(setting, objectKey, time.Now().Add(directResourceURLTTL))
	if err != nil {
		return nil, err
	}
	req, err := http.NewRequest(http.MethodGet, signedURL, nil)
	if err != nil {
		return nil, err
	}
	if rangeHeader != "" {
		req.Header.Set("Range", rangeHeader)
	}
	ApplyDefaultOutboundHeaders(req)
	resp, err := OutboundHTTPClient(2 * time.Minute).Do(req)
	if err != nil {
		return nil, fmt.Errorf("对象存储 CDN 读取失败：%w", err)
	}
	if (resp.StatusCode < 200 || resp.StatusCode >= 300) && resp.StatusCode != http.StatusRequestedRangeNotSatisfiable {
		defer resp.Body.Close()
		detail, _ := io.ReadAll(io.LimitReader(resp.Body, 512))
		return nil, fmt.Errorf("对象存储 CDN 读取失败：%s %s", resp.Status, strings.TrimSpace(string(detail)))
	}
	return &ossObjectStream{body: resp.Body, statusCode: resp.StatusCode, contentLength: resp.ContentLength, contentRange: resp.Header.Get("Content-Range"), acceptRanges: firstNonEmpty(resp.Header.Get("Accept-Ranges"), "bytes")}, nil
}

func signedCOSObjectURL(setting ossSettingValue, objectKey string, expiresAt time.Time) (string, error) {
	if strings.TrimSpace(setting.AccessKeyID) == "" || strings.TrimSpace(setting.AccessKeySecret) == "" {
		return "", errors.New("COS 访问密钥不可用")
	}
	objectKey = strings.TrimLeft(strings.TrimSpace(objectKey), "/")
	if objectKey == "" {
		return "", errors.New("COS 对象路径为空")
	}
	expires := time.Until(expiresAt)
	if expires <= 0 {
		return "", errors.New("COS 签名有效期必须晚于当前时间")
	}
	client, err := newCOSClient(setting, 2*time.Minute)
	if err != nil {
		return "", err
	}
	signedURL, err := client.Object.GetPresignedURL(context.Background(), http.MethodGet, objectKey, setting.AccessKeyID, setting.AccessKeySecret, expires, nil)
	if err != nil {
		return "", err
	}
	return signedURL.String(), nil
}

func signedQiniuObjectURL(setting ossSettingValue, objectKey string, expiresAt time.Time) (string, error) {
	if setting.AccessKeyID == "" || setting.AccessKeySecret == "" {
		return "", errors.New("七牛云 Kodo 访问密钥不可用")
	}
	objectKey = strings.TrimLeft(strings.TrimSpace(objectKey), "/")
	if objectKey == "" {
		return "", errors.New("七牛云 Kodo 对象路径为空")
	}
	deadline := expiresAt.Unix()
	if deadline <= time.Now().Unix() {
		return "", errors.New("七牛云 Kodo 签名有效期必须晚于当前时间")
	}
	if setting.CDNBaseURL == "" {
		return signedQiniuS3ObjectURL(setting, objectKey, expiresAt)
	}
	mac := qiniuAuth.New(setting.AccessKeyID, setting.AccessKeySecret)
	return qiniuStorage.MakePrivateURLv2(mac, strings.TrimRight(setting.CDNBaseURL, "/"), objectKey, deadline), nil
}

// signedQiniuS3ObjectURL 用七牛兼容 S3 的 AWS Signature V4 访问私有空间。
// 没有绑定域名时，浏览器不直接访问该地址，而是由后端代理读取并返回文件。
func signedQiniuS3ObjectURL(setting ossSettingValue, objectKey string, expiresAt time.Time) (string, error) {
	region := qiniuS3Region(setting)
	if region == "" {
		return "", errors.New("七牛云 Kodo S3 Region 不可用")
	}
	baseURL := &url.URL{Scheme: "https", Host: setting.Bucket + ".s3." + region + ".qiniucs.com"}
	// 保留对象键的原始路径，让 url.URL 和 AWS signer 只做一次 RFC 3986 转义。
	baseURL.Path = "/" + objectKey
	req, err := http.NewRequest(http.MethodGet, baseURL.String(), nil)
	if err != nil {
		return "", err
	}
	credentialsValue := credentials.NewStaticCredentials(setting.AccessKeyID, setting.AccessKeySecret, "")
	signer := awsv4.NewSigner(credentialsValue)
	if _, err := signer.Presign(req, nil, "s3", region, time.Until(expiresAt), time.Now().UTC()); err != nil {
		return "", fmt.Errorf("七牛云 Kodo S3 签名失败：%w", err)
	}
	return req.URL.String(), nil
}

func qiniuS3Region(setting ossSettingValue) string {
	region := strings.ToLower(strings.TrimSpace(setting.Region))
	if region == "" {
		endpoint := strings.ToLower(setting.Endpoint)
		for _, candidate := range []string{"z0", "z1", "z2", "na0", "as0", "cn-east-1", "cn-north-1", "cn-south-1", "us-north-1", "ap-southeast-1", "cn-east-2"} {
			if strings.Contains(endpoint, candidate) {
				region = candidate
				break
			}
		}
	}
	switch region {
	case "", "z0", "cn-east-1":
		return "cn-east-1"
	case "z1", "cn-north-1":
		return "cn-north-1"
	case "z2", "cn-south-1":
		return "cn-south-1"
	case "na0", "us-north-1":
		return "us-north-1"
	case "as0", "ap-southeast-1":
		return "ap-southeast-1"
	case "cn-east-2", "zhejiang2":
		return "cn-east-2"
	default:
		return ""
	}
}

func qiniuRegion(region string) *qiniuStorage.Region {
	switch strings.ToLower(strings.TrimSpace(region)) {
	case "z1", "cn-north-1":
		return &qiniuStorage.ZoneHuabei
	case "z2", "cn-south-1":
		return &qiniuStorage.ZoneHuanan
	case "na0", "us-north-1":
		return &qiniuStorage.ZoneBeimei
	case "as0", "ap-southeast-1":
		return &qiniuStorage.ZoneXinjiapo
	case "cn-east-2", "zhejiang2":
		return &qiniuStorage.ZoneHuadongZheJiang2
	default:
		return &qiniuStorage.ZoneHuadong
	}
}

func newCOSClient(setting ossSettingValue, timeout time.Duration) (*cos.Client, error) {
	bucketURL, err := cosBucketBaseURL(setting)
	if err != nil {
		return nil, err
	}
	httpClient := OutboundHTTPClient(timeout)
	httpClient.Transport = &cos.AuthorizationTransport{SecretID: setting.AccessKeyID, SecretKey: setting.AccessKeySecret, Transport: httpClient.Transport}
	return cos.NewClient(&cos.BaseURL{BucketURL: bucketURL}, httpClient), nil
}

func cosBucketBaseURL(setting ossSettingValue) (*url.URL, error) {
	setting = normalizeOSSSetting(setting)
	endpoint := strings.TrimRight(setting.Endpoint, "/")
	if endpoint == "" {
		return nil, errors.New("COS Endpoint 为空")
	}
	if !strings.Contains(endpoint, "://") {
		endpoint = "https://" + endpoint
	}
	parsed, err := url.Parse(endpoint)
	if err != nil {
		return nil, err
	}
	if parsed.Host == "" || parsed.User != nil || parsed.RawQuery != "" || parsed.Fragment != "" || strings.Trim(parsed.Path, "/") != "" {
		return nil, errors.New("COS Endpoint 格式不正确")
	}
	if setting.Bucket == "" {
		return nil, errors.New("COS Bucket 为空")
	}
	host := strings.ToLower(parsed.Hostname())
	if strings.HasSuffix(host, ".myqcloud.com") || strings.HasSuffix(host, ".tencentcos.cn") {
		if strings.HasPrefix(host, "cos.") || strings.HasPrefix(host, "cos-internal.") || strings.HasPrefix(host, "cos-website.") {
			parsed.Host = setting.Bucket + "." + parsed.Host
		} else if !strings.HasPrefix(host, strings.ToLower(setting.Bucket)+".") {
			return nil, errors.New("COS Endpoint 中的 Bucket 与配置不一致")
		}
	}
	return parsed, nil
}

func ossCDNBaseURL(raw string) (*url.URL, error) {
	parsed, err := url.Parse(strings.TrimSpace(raw))
	if err != nil || parsed.Hostname() == "" {
		return nil, errors.New("对象存储 CDN 加速域名格式不正确")
	}
	if parsed.Scheme != "https" && parsed.Scheme != "http" {
		return nil, errors.New("对象存储 CDN 加速域名只支持 http/https")
	}
	if parsed.User != nil || parsed.RawQuery != "" || parsed.Fragment != "" || strings.Trim(parsed.Path, "/") != "" {
		return nil, errors.New("对象存储 CDN 加速域名不能包含认证信息、路径、查询参数或片段")
	}
	parsed.Path = ""
	return parsed, nil
}

func ossCDNObjectURL(raw string, objectKey string) (string, error) {
	baseURL, err := ossCDNBaseURL(raw)
	if err != nil {
		return "", err
	}
	objectKey = strings.TrimLeft(strings.TrimSpace(objectKey), "/")
	if objectKey == "" {
		return "", errors.New("对象存储对象路径为空")
	}
	// CDN 使用自己的访问鉴权与私有桶回源鉴权，不能携带 OSS/COS 的预签名参数。
	// url.URL.String 会负责转义 Path；这里保留未转义值，避免把 %20 再编码为 %2520。
	baseURL.Path = "/" + objectKey
	return baseURL.String(), nil
}

func newOSSRequest(method string, setting ossSettingValue, objectKey string, contentType string, body io.Reader) (*http.Request, error) {
	baseURL, err := ossBucketBaseURL(setting)
	if err != nil {
		return nil, err
	}
	baseURL.Path = strings.TrimRight(baseURL.Path, "/") + "/" + escapeObjectKey(objectKey)
	req, err := http.NewRequest(method, baseURL.String(), body)
	if err != nil {
		return nil, err
	}
	date := time.Now().UTC().Format(http.TimeFormat)
	req.Header.Set("Date", date)
	if contentType != "" {
		req.Header.Set("Content-Type", contentType)
	}
	stringToSign := strings.Join([]string{method, "", contentType, date, "/" + setting.Bucket + "/" + objectKey}, "\n")
	mac := hmac.New(sha1.New, []byte(setting.AccessKeySecret))
	_, _ = mac.Write([]byte(stringToSign))
	signature := base64.StdEncoding.EncodeToString(mac.Sum(nil))
	req.Header.Set("Authorization", "OSS "+setting.AccessKeyID+":"+signature)
	return req, nil
}

func ossBucketBaseURL(setting ossSettingValue) (*url.URL, error) {
	endpoint := strings.TrimRight(setting.Endpoint, "/")
	if endpoint == "" {
		return nil, errors.New("OSS Endpoint 为空")
	}
	if !strings.Contains(endpoint, "://") {
		endpoint = "https://" + endpoint
	}
	parsed, err := url.Parse(endpoint)
	if err != nil {
		return nil, err
	}
	if parsed.Host == "" {
		return nil, errors.New("OSS Endpoint 格式不正确")
	}
	if !strings.HasPrefix(parsed.Host, setting.Bucket+".") {
		parsed.Host = setting.Bucket + "." + parsed.Host
	}
	return parsed, nil
}

func escapeObjectKey(key string) string {
	parts := strings.Split(key, "/")
	for i, part := range parts {
		parts[i] = url.PathEscape(part)
	}
	return strings.Join(parts, "/")
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
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return strings.TrimSpace(value)
		}
	}
	return ""
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
