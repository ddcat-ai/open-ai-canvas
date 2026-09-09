package service

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha1"
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

	"infinite-canvas/backend/internal/model"

	"github.com/aws/aws-sdk-go/aws/credentials"
	awsv4 "github.com/aws/aws-sdk-go/aws/signer/v4"
	qiniuAuth "github.com/qiniu/go-sdk/v7/auth"
	qiniuClient "github.com/qiniu/go-sdk/v7/client"
	qiniuStorage "github.com/qiniu/go-sdk/v7/storage"
	cos "github.com/tencentyun/cos-go-sdk-v5"
	"gorm.io/gorm"
)

const providerResourceURLTTL = 4 * time.Hour
const directResourceURLTTL = 5 * time.Minute
const immutableResourceCacheControl = "private, max-age=31536000, immutable"

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
	Download    bool
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
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, NotFound("资源不存在")
		}
		return nil, err
	}
	if resource != nil {
		resource.PublicURL = ""
	}
	return resource, nil
}

// DirectResourceURL 先校验资源归属，再按实际存储位置签发短时下载地址。
func (s *Service) DirectResourceURL(userID string, id string) (string, error) {
	resource, err := s.repo.ResourceForUser(userID, id)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return "", NotFound("资源不存在")
		}
		return "", err
	}
	return s.directResourceURL(resource, time.Now().Add(directResourceURLTTL))
}

// BrowserResourceURL distinguishes local resources from objects that can be
// mounted through a provider URL. Local resources stay on the authenticated
// file route and do not require CANVAS_PUBLIC_BASE_URL.
func (s *Service) BrowserResourceURL(userID string, id string) (string, bool, error) {
	value, proxy, _, err := s.BrowserResourceURLWithCachePolicy(userID, id)
	return value, proxy, err
}

// BrowserResourceURLWithCachePolicy returns the provider URL and whether it is
// safe for the browser to retain it beyond the normal short-lived signing TTL.
// Only an explicitly configured public S3 domain is stable here; signed CDN,
// origin, and application-proxy URLs must keep their normal refresh policy.
func (s *Service) BrowserResourceURLWithCachePolicy(userID string, id string) (string, bool, bool, error) {
	resource, err := s.repo.ResourceForUser(userID, id)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return "", false, false, NotFound("资源不存在")
		}
		return "", false, false, err
	}
	return s.browserResourceURLWithOptions(resource, false)
}

// BrowserResourceDownloadURL authorizes a resource and signs a provider URL
// whose response is an attachment. Local resources remain on the authenticated
// file route because they have no provider URL to sign.
func (s *Service) BrowserResourceDownloadURL(userID string, id string) (string, bool, error) {
	value, proxy, _, err := s.BrowserResourceDownloadURLWithCachePolicy(userID, id)
	return value, proxy, err
}

func (s *Service) BrowserResourceDownloadURLWithCachePolicy(userID string, id string) (string, bool, bool, error) {
	resource, err := s.repo.ResourceForUser(userID, id)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return "", false, false, NotFound("资源不存在")
		}
		return "", false, false, err
	}
	return s.browserResourceURLWithOptions(resource, true)
}

func (s *Service) browserResourceURLWithOptions(resource *model.Resource, download bool) (string, bool, bool, error) {
	if resource == nil {
		return "", false, false, errors.New("资源不存在")
	}
	if resource.Status != model.ResourceStatusReady {
		return "", false, false, BadAuthRequest("资源尚未上传完成")
	}
	resource.Provider = normalizedResourceProvider(resource.Provider)
	if resource.Provider == "local" {
		return "", true, false, nil
	}
	setting, err := s.directResourceOSSSetting(resource)
	if err != nil {
		return "", false, false, err
	}
	if !download && !cdnViewerAuthConfigured(setting) && setting.Provider != qiniuKodoProvider && setting.CDNBaseURL == "" && !publicHTTPSStorageEndpoint(setting.Endpoint) {
		return "", true, false, nil
	}
	var value string
	if download {
		value, err = signedOSSObjectURLForDownload(setting, resource.ObjectKey, time.Now().Add(directResourceURLTTL), true, ResourceDownloadFileName(resource))
	} else {
		value, err = signedOSSObjectURL(setting, resource.ObjectKey, time.Now().Add(directResourceURLTTL))
	}
	stable := setting.Provider == s3Provider && strings.TrimSpace(setting.CDNBaseURL) != "" && !cdnViewerAuthConfigured(setting)
	return value, false, stable, err
}

func (s *Service) directResourceURL(resource *model.Resource, expiresAt time.Time) (string, error) {
	if resource == nil {
		return "", errors.New("资源不存在")
	}
	if resource.Status != model.ResourceStatusReady {
		return "", BadAuthRequest("资源尚未上传完成")
	}
	if resource.Provider == "local" {
		return s.signedPublicResourceURL(resource, expiresAt)
	}
	setting, err := s.directResourceOSSSetting(resource)
	if err != nil {
		return "", err
	}
	if setting.Provider == s3Provider && setting.CDNBaseURL == "" && !publicHTTPSStorageEndpoint(setting.Endpoint) {
		return s.signedHTTPSPublicResourceURL(resource, expiresAt)
	}
	return signedOSSObjectURL(setting, resource.ObjectKey, expiresAt)
}

func (s *Service) directResourceOSSSetting(resource *model.Resource) (ossSettingValue, error) {
	setting, err := s.ossSettingForResource(resource.UserID, resource)
	if err != nil {
		return ossSettingValue{}, err
	}
	setting.Provider = firstNonEmpty(resource.Provider, setting.Provider)
	setting.Endpoint = firstNonEmpty(resource.Endpoint, setting.Endpoint)
	setting.Bucket = firstNonEmpty(resource.Bucket, setting.Bucket)
	return setting, nil
}

// PrepareResourceDelivery 统一决定浏览器资源出口：完整配置 Viewer 鉴权时走
// CDN 短时签名，否则使用对象存储源站签名或同源代理。
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
		// S3 兼容 Endpoint 可能是私网服务；私网或 HTTP Endpoint 继续使用同源代理。
		// 公开 HTTPS Endpoint（例如雨云 OSS）可安全签发短时预签名地址，避免
		// 图片查看和下载绕回应用服务器传输对象内容。
		if setting.Provider == s3Provider && setting.CDNBaseURL == "" && !options.ForceDirect && !publicHTTPSStorageEndpoint(setting.Endpoint) {
			return &ResourceDelivery{Resource: resource}, nil
		}
		if cdnViewerAuthConfigured(setting) {
			// 腾讯 CDN Viewer 鉴权不接受额外的查询参数；下载还需要
			// response-content-disposition，因此下载请求使用源站预签名。
			if options.Download || resource.Kind == "file" {
				redirectURL, err := signedOSSObjectURLForDownload(setting, resource.ObjectKey, time.Now().Add(directResourceURLTTL), true, ResourceDownloadFileName(resource))
				if err != nil {
					return nil, err
				}
				return &ResourceDelivery{Resource: resource, RedirectURL: redirectURL}, nil
			}
			redirectURL, err := signedCDNViewerURL(setting, resource.ObjectKey, time.Now().Add(directResourceURLTTL))
			if err != nil {
				return nil, err
			}
			return &ResourceDelivery{Resource: resource, RedirectURL: redirectURL}, nil
		}
		// Never emit a bare CDN URL for private objects. S3's explicit public
		// domain is the opt-in exception: it must point at public-read storage or
		// a proxy/CDN that enforces its own access control.
		if options.ForceDirect || setting.Provider == qiniuKodoProvider || setting.CDNBaseURL != "" || publicHTTPSStorageEndpoint(setting.Endpoint) {
			if setting.Provider == s3Provider && setting.CDNBaseURL == "" && !publicHTTPSStorageEndpoint(setting.Endpoint) {
				redirectURL, err := s.signedHTTPSPublicResourceURL(resource, time.Now().Add(directResourceURLTTL))
				if err != nil {
					return nil, err
				}
				return &ResourceDelivery{Resource: resource, RedirectURL: redirectURL}, nil
			}
			redirectURL, err := signedOSSObjectURLForDownload(setting, resource.ObjectKey, time.Now().Add(directResourceURLTTL), options.Download || resource.Kind == "file", ResourceDownloadFileName(resource))
			if err != nil {
				return nil, err
			}
			return &ResourceDelivery{Resource: resource, RedirectURL: redirectURL}, nil
		}
	}
	return &ResourceDelivery{Resource: resource}, nil
}

func (s *Service) signedPublicResourceURL(resource *model.Resource, expiresAt time.Time) (string, error) {
	if resource == nil {
		return "", errors.New("资源不存在")
	}
	baseURL, err := s.publicResourceBaseURL()
	if err != nil {
		return "", err
	}
	expires := strconv.FormatInt(expiresAt.UTC().Unix(), 10)
	signature, err := s.signPublicResource(resource.ID, expires)
	if err != nil {
		return "", err
	}
	ext := resourceFileExtension(resource.ObjectKey, resource.MimeType, resource.Kind)
	filename := resource.ID
	if ext != "" {
		if !strings.HasPrefix(ext, ".") {
			ext = "." + ext
		}
		filename += ext
	}
	baseURL.Path = strings.TrimRight(baseURL.Path, "/") + "/api/public/resources/" + url.PathEscape(resource.ID) + "/file/" + url.PathEscape(filename)
	query := baseURL.Query()
	query.Set("expires", expires)
	query.Set("signature", signature)
	baseURL.RawQuery = query.Encode()
	return baseURL.String(), nil
}

func (s *Service) signedHTTPSPublicResourceURL(resource *model.Resource, expiresAt time.Time) (string, error) {
	baseURL, err := s.publicResourceBaseURL()
	if err != nil {
		return "", err
	}
	if baseURL.Scheme != "https" {
		return "", BadAuthRequest("私网或 HTTP S3 用于上游资源时，服务器公开访问地址必须使用 HTTPS")
	}
	return s.signedPublicResourceURL(resource, expiresAt)
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

// UploadResourceFile stores a fully assembled local file from the chunked upload path.
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
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, NotFound("资源不存在")
		}
		return nil, err
	}
	return s.openResourceRange(userID, resource, rangeHeader)
}

func (s *Service) OpenPublicResourceRange(id string, expires string, signature string, rangeHeader string) (*ResourceStream, error) {
	resource, err := s.repo.Resource(id)
	if err != nil {
		return nil, Forbidden("匿名下载链接无效")
	}
	if resource.Provider != "local" && resource.Provider != s3Provider {
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

func (s *Service) storeResource(userID string, kind string, fileName string, mimeType string, size int64, width int, height int, durationMs int64, body io.Reader, uploadKey *string, forceLocal bool) (*model.Resource, bool, error) {
	if existing, err := s.resourceForUploadKey(userID, uploadKey); err != nil {
		return nil, false, err
	} else if existing != nil {
		if existing.Status == model.ResourceStatusReady {
			return existing, false, nil
		}
		return nil, false, resourceUploadInProgress()
	}
	now := time.Now()
	kind = normalizeResourceKind(kind, mimeType)
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
	etag, err = s.storeResourceObject(&resource, fileName, body)
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

// storeResourceObject writes the physical resource object. When the selected
// object storage is unavailable, retry from the beginning and degrade to the
// local provider so a transient external storage failure does not make an
// otherwise valid upload unusable.
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
	if settingErr == nil && putErr == nil {
		return etag, nil
	}
	fallbackErr := putErr
	if fallbackErr == nil {
		fallbackErr = settingErr
	}
	seeker, ok := body.(io.Seeker)
	if !ok {
		return "", errors.Join(fallbackErr, errors.New("降级本地存储时上传内容不可重置"))
	}
	if _, seekErr := seeker.Seek(0, io.SeekStart); seekErr != nil {
		return "", errors.Join(fallbackErr, fmt.Errorf("降级本地存储时重置读取位置失败：%w", seekErr))
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
	name := newID()
	return path.Join("objects", name[:2], name+ext)
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

// ResourceDownloadFileName is deliberately derived from server-owned fields.
// Resource currently does not persist the original upload name, so this keeps
// attachment headers deterministic without trusting object keys or user input.
func ResourceDownloadFileName(resource *model.Resource) string {
	if resource == nil {
		return "resource.bin"
	}
	ext := resourceFileExtension(resource.ObjectKey, resource.MimeType, resource.Kind)
	if ext == "" {
		ext = ".bin"
	}
	return safeDownloadFileName(resource.ID) + ext
}

func safeDownloadFileName(value string) string {
	value = strings.TrimSpace(value)
	var builder strings.Builder
	for _, char := range value {
		if (char >= 'a' && char <= 'z') || (char >= 'A' && char <= 'Z') || (char >= '0' && char <= '9') || char == '-' || char == '_' || char == '.' {
			builder.WriteRune(char)
		}
		if builder.Len() >= 96 {
			break
		}
	}
	if builder.Len() == 0 {
		return "resource"
	}
	return builder.String()
}

func ContentDispositionAttachment(fileName string) string {
	return mime.FormatMediaType("attachment", map[string]string{"filename": safeDownloadFileName(fileName)})
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

// effectiveResourceStorageMode mirrors activeResourceOSSSetting without validating
// credentials, so clients can fail closed even while an enabled configuration
// needs repair.
func (s *Service) effectiveResourceStorageMode(userID string) (string, error) {
	userSetting, userValue, err := s.readUserOSSSetting(userID)
	if err != nil {
		return "", err
	}
	_, systemValue, err := s.readOSSSetting()
	if err != nil {
		return "", err
	}
	userAllowed := userValue.Provider != s3Provider || systemValue.AllowUserS3
	if userSetting != nil && userValue.Enabled && userAllowed {
		return "oss", nil
	}
	if systemValue.Enabled {
		return "oss", nil
	}
	return "local", nil
}

func (s *Service) ossSettingForResource(userID string, resource *model.Resource) (ossSettingValue, error) {
	var setting ossSettingValue
	var err error
	if resource.StorageSettingID != "" {
		var location *model.StorageLocation
		location, setting, err = s.storageLocationValue(resource.StorageSettingID)
		if errors.Is(err, gorm.ErrRecordNotFound) {
			_, setting, err = s.readUserOSSSettingByID(userID, resource.StorageSettingID)
		}
		if err == nil && location != nil {
			// CDN/public-domain fields are delivery policy, not storage identity.
			// Apply the current policy to existing bound locations so resources
			// created before a domain was configured start using it immediately.
			var current ossSettingValue
			if location.Scope == "platform" {
				_, current, err = s.readOSSSetting()
			} else if location.Scope == "user" && location.OwnerID == userID {
				_, current, err = s.readUserOSSSetting(userID)
			}
			if err == nil && storageLocationDigest(current) == storageLocationDigest(setting) && current.Provider == setting.Provider {
				setting.CDNBaseURL = current.CDNBaseURL
				setting.CDNAuthType = current.CDNAuthType
				setting.CDNAuthKey = current.CDNAuthKey
			}
		}
	} else {
		// 早期资源没有 StorageSettingID，但资源本身仍记录了 provider/endpoint/bucket。
		// 先从用户 OSS 历史版本中按存储位置反查，不能把当前七牛配置猜给历史阿里云对象。
		setting, err = s.userOSSSettingForResource(userID, resource)
		if errors.Is(err, gorm.ErrRecordNotFound) {
			setting, err = s.platformOSSSettingForResource(resource)
		}
		if errors.Is(err, gorm.ErrRecordNotFound) {
			_, setting, err = s.readOSSSetting()
		}
	}
	if err != nil {
		return ossSettingValue{}, err
	}
	setting, err = ossSettingForProvider(setting, firstNonEmpty(resource.Provider, setting.Provider))
	if err != nil {
		return ossSettingValue{}, err
	}
	setting.Endpoint = firstNonEmpty(resource.Endpoint, setting.Endpoint)
	setting.Bucket = firstNonEmpty(resource.Bucket, setting.Bucket)
	if setting.AccessKeyID == "" || setting.AccessKeySecret == "" {
		return ossSettingValue{}, errors.New("对象存储访问密钥不可用")
	}
	return setting, nil
}

func (s *Service) platformOSSSettingForResource(resource *model.Resource) (ossSettingValue, error) {
	if resource == nil {
		return ossSettingValue{}, gorm.ErrRecordNotFound
	}
	locations, err := s.repo.StorageLocationsForScope("platform", "")
	if err != nil {
		return ossSettingValue{}, err
	}
	type candidate struct {
		location    model.StorageLocation
		setting     ossSettingValue
		prefixMatch bool
	}
	candidates := make([]candidate, 0, len(locations))
	hasPrefixMatch := false
	objectKey := strings.TrimLeft(strings.TrimSpace(resource.ObjectKey), "/")
	for index := range locations {
		_, value, valueErr := s.storageLocationValue(locations[index].ID)
		if valueErr != nil {
			return ossSettingValue{}, valueErr
		}
		if resourceStorageMatches(value, resource) {
			prefix := strings.Trim(value.PathPrefix, "/")
			prefixMatch := prefix != "" && (objectKey == prefix || strings.HasPrefix(objectKey, prefix+"/"))
			hasPrefixMatch = hasPrefixMatch || prefixMatch
			candidates = append(candidates, candidate{location: locations[index], setting: value, prefixMatch: prefixMatch})
		}
	}
	var oldestMatch ossSettingValue
	var oldestInactiveMatch ossSettingValue
	for index := range candidates {
		if hasPrefixMatch && !candidates[index].prefixMatch {
			continue
		}
		oldestMatch = candidates[index].setting
		if !candidates[index].location.Active {
			oldestInactiveMatch = candidates[index].setting
		}
		// Legacy resources do not have StorageSettingID. When credentials were
		// rotated for the same location, use the newest version known to predate
		// the resource. Equal timestamps are ambiguous, so the final fallback is
		// the oldest matching version rather than potentially exposing a new key.
		if !resource.CreatedAt.IsZero() && candidates[index].location.CreatedAt.Before(resource.CreatedAt) {
			return candidates[index].setting, nil
		}
	}
	// 时间戳并列时（例如粗粒度系统时钟下轮换与资源创建落在同一时刻），(created_at, id)
	// 排序无法分辨先后，"最旧版本"退化为随机。Active 互斥指向当前凭据，因此并列兜底
	// 优先取非 Active 的历史版本，确保不会把轮换后的新密钥暴露给可能早于轮换的资源。
	if oldestInactiveMatch.Provider != "" {
		return oldestInactiveMatch, nil
	}
	if oldestMatch.Provider != "" {
		return oldestMatch, nil
	}
	return ossSettingValue{}, gorm.ErrRecordNotFound
}

func (s *Service) userOSSSettingForResource(userID string, resource *model.Resource) (ossSettingValue, error) {
	settings, err := s.repo.UserOSSSettingsForUser(userID)
	if err != nil {
		return ossSettingValue{}, err
	}
	type candidate struct {
		setting     ossSettingValue
		createdAt   time.Time
		prefixMatch bool
	}
	candidates := make([]candidate, 0, len(settings))
	hasPrefixMatch := false
	objectKey := strings.TrimLeft(strings.TrimSpace(resource.ObjectKey), "/")
	for index := range settings {
		value, valueErr := s.userOSSSettingValue(&settings[index])
		if valueErr != nil {
			return ossSettingValue{}, valueErr
		}
		if resourceStorageMatches(value, resource) {
			prefix := strings.Trim(value.PathPrefix, "/")
			prefixMatch := prefix != "" && (objectKey == prefix || strings.HasPrefix(objectKey, prefix+"/"))
			hasPrefixMatch = hasPrefixMatch || prefixMatch
			candidates = append(candidates, candidate{setting: value, createdAt: settings[index].CreatedAt, prefixMatch: prefixMatch})
		}
	}
	var oldestMatch ossSettingValue
	for index := range candidates {
		if hasPrefixMatch && !candidates[index].prefixMatch {
			continue
		}
		oldestMatch = candidates[index].setting
		// Legacy user resources do not have StorageSettingID. Prefer the newest
		// matching setting that predates the resource; equal timestamps are
		// ambiguous, so the final fallback remains the oldest matching version.
		if resource != nil && !resource.CreatedAt.IsZero() && candidates[index].createdAt.Before(resource.CreatedAt) {
			return candidates[index].setting, nil
		}
	}
	if oldestMatch.Provider != "" {
		return oldestMatch, nil
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
	// Keep provider object keys opaque: user identity, resource kind, upload
	// date, and original file names are not part of the public URL. The first
	// two ID characters provide inexpensive object-store sharding.
	parts := []string{setting.PathPrefix, "objects", name[:2], name + ext}
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
	if setting.Provider == s3Provider {
		return putS3Object(setting, objectKey, mimeType, size, body)
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
	req.Header.Set("Cache-Control", immutableResourceCacheControl)
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
	if setting.Provider == s3Provider {
		return getS3ObjectRange(setting, objectKey, rangeHeader)
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

func signedOSSObjectURL(setting ossSettingValue, objectKey string, expiresAt time.Time, options ...string) (string, error) {
	downloadFileName := ""
	if len(options) > 0 {
		downloadFileName = options[0]
	}
	setting = normalizeOSSSetting(setting)
	if cdnViewerAuthConfigured(setting) {
		return signedCDNViewerURL(setting, objectKey, expiresAt)
	}
	if setting.Provider == s3Provider && setting.CDNBaseURL != "" {
		return publicS3ObjectURL(setting, objectKey)
	}
	return signedOSSOriginObjectURL(setting, objectKey, expiresAt, downloadFileName)
}

// publicS3ObjectURL is intentionally unsigned: the configured domain must
// point to a public-read bucket or a CDN/reverse proxy that performs its own
// access control. Private S3 objects continue to use origin signatures or the
// authenticated application proxy when no public domain is configured.
func publicS3ObjectURL(setting ossSettingValue, objectKey string) (string, error) {
	base, err := ossCDNBaseURL(setting.CDNBaseURL)
	if err != nil {
		return "", err
	}
	objectKey = strings.TrimLeft(strings.TrimSpace(objectKey), "/")
	if objectKey == "" {
		return "", errors.New("S3 公网对象路径为空")
	}
	base.Path = "/" + objectKey
	return base.String(), nil
}

func signedOSSOriginObjectURL(setting ossSettingValue, objectKey string, expiresAt time.Time, downloadFileName string) (string, error) {
	setting = normalizeOSSSetting(setting)
	if setting.Provider == s3Provider {
		return signedS3ObjectURLWithName(setting, objectKey, expiresAt, downloadFileName != "", downloadFileName)
	}
	if setting.Provider == qiniuKodoProvider {
		return signedQiniuObjectURL(setting, objectKey, expiresAt, downloadFileName)
	}
	if setting.Provider == tencentCOSProvider {
		return signedCOSObjectURL(setting, objectKey, expiresAt, downloadFileName)
	}
	return signedAliyunOSSObjectURL(setting, objectKey, expiresAt, downloadFileName)
}

func signedOSSObjectURLForDownload(setting ossSettingValue, objectKey string, expiresAt time.Time, download bool, fileName ...string) (string, error) {
	if download {
		setting = normalizeOSSSetting(setting)
		// A configured S3 public domain is explicitly an opt-in public-read (or
		// CDN/reverse-proxy) delivery path. Keep downloads on that domain too;
		// otherwise the download-only signing branch would silently fall back to
		// the origin and make the configured browser delivery URL appear unused.
		if setting.Provider == s3Provider && setting.CDNBaseURL != "" {
			return publicS3ObjectURL(setting, objectKey)
		}
		name := ""
		if len(fileName) > 0 {
			name = fileName[0]
		}
		return signedOSSOriginObjectURL(setting, objectKey, expiresAt, name)
	}
	return signedOSSObjectURL(setting, objectKey, expiresAt)
}

func signedAliyunOSSObjectURL(setting ossSettingValue, objectKey string, expiresAt time.Time, fileName ...string) (string, error) {
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
	// url.URL.Path is the decoded form; String() performs the single required
	// escaping pass. Pre-escaping here would turn spaces into %2520 on wire.
	baseURL.Path = strings.TrimRight(baseURL.Path, "/") + "/" + objectKey
	expires := strconv.FormatInt(expiresAt.UTC().Unix(), 10)
	canonicalResource := "/" + setting.Bucket + "/" + objectKey
	if len(fileName) > 0 && fileName[0] != "" {
		// response-content-disposition is an OSS sub-resource and must be part
		// of the canonical string; the query value is URL-escaped only in the
		// final URL, matching the OSS V1 signing rules.
		canonicalResource += "?response-content-disposition=" + ContentDispositionAttachment(fileName[0])
	}
	stringToSign := strings.Join([]string{http.MethodGet, "", "", expires, canonicalResource}, "\n")
	mac := hmac.New(sha1.New, []byte(setting.AccessKeySecret))
	_, _ = mac.Write([]byte(stringToSign))
	query := baseURL.Query()
	query.Set("OSSAccessKeyId", setting.AccessKeyID)
	query.Set("Expires", expires)
	if len(fileName) > 0 && fileName[0] != "" {
		query.Set("response-content-disposition", ContentDispositionAttachment(fileName[0]))
	}
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
	options := &cos.ObjectPutOptions{ObjectPutHeaderOptions: &cos.ObjectPutHeaderOptions{ContentType: mimeType, ContentLength: size, CacheControl: immutableResourceCacheControl}}
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
	uploader := qiniuStorage.NewFormUploaderEx(config, &qiniuClient.Client{Client: OutboundHTTPClient(2 * time.Minute)})
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

func signedCOSObjectURL(setting ossSettingValue, objectKey string, expiresAt time.Time, fileName ...string) (string, error) {
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
	var options *cos.ObjectGetOptions
	if len(fileName) > 0 && fileName[0] != "" {
		options = &cos.ObjectGetOptions{ResponseContentDisposition: ContentDispositionAttachment(fileName[0])}
	}
	signedURL, err := client.Object.GetPresignedURL(context.Background(), http.MethodGet, objectKey, setting.AccessKeyID, setting.AccessKeySecret, expires, options)
	if err != nil {
		return "", err
	}
	return signedURL.String(), nil
}

// signedQiniuObjectURL 用七牛兼容 S3 的 AWS Signature V4 访问私有空间。
// 七牛空间的绑定域名自带 CDN 加速，直连官方 S3 端点签名即可；
// 需要 Blob 且跨域失败时由前端回退后端代理。
func signedQiniuObjectURL(setting ossSettingValue, objectKey string, expiresAt time.Time, fileName ...string) (string, error) {
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
	if setting.CDNBaseURL != "" {
		if _, err := ossCDNBaseURL(setting.CDNBaseURL); err != nil {
			return "", err
		}
		query := url.Values{}
		if len(fileName) > 0 && fileName[0] != "" {
			query.Set("attname", safeDownloadFileName(fileName[0]))
		}
		mac := qiniuAuth.New(setting.AccessKeyID, setting.AccessKeySecret)
		return qiniuStorage.MakePrivateURLv2WithQuery(mac, strings.TrimRight(setting.CDNBaseURL, "/"), objectKey, query, deadline), nil
	}
	return signedQiniuS3ObjectURL(setting, objectKey, expiresAt, fileName...)
}

// signedQiniuS3ObjectURL 用七牛兼容 S3 的 AWS Signature V4 访问私有空间。
// 没有绑定域名时也可返回短时签名地址；需要 Blob 且跨域失败时由前端回退后端代理。
func signedQiniuS3ObjectURL(setting ossSettingValue, objectKey string, expiresAt time.Time, fileName ...string) (string, error) {
	region := qiniuS3Region(setting)
	if region == "" {
		return "", errors.New("七牛云 Kodo S3 Region 不可用")
	}
	baseURL := &url.URL{Scheme: "https", Host: setting.Bucket + ".s3." + region + ".qiniucs.com"}
	// 保留对象键的原始路径，让 url.URL 和 AWS signer 只做一次 RFC 3986 转义。
	baseURL.Path = "/" + objectKey
	if len(fileName) > 0 && fileName[0] != "" {
		query := baseURL.Query()
		query.Set("response-content-disposition", ContentDispositionAttachment(fileName[0]))
		baseURL.RawQuery = query.Encode()
	}
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

func newOSSRequest(method string, setting ossSettingValue, objectKey string, contentType string, body io.Reader) (*http.Request, error) {
	baseURL, err := ossBucketBaseURL(setting)
	if err != nil {
		return nil, err
	}
	baseURL.Path = strings.TrimRight(baseURL.Path, "/") + "/" + strings.TrimLeft(objectKey, "/")
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
	if setting.Bucket != "" && !strings.HasPrefix(parsed.Host, setting.Bucket+".") {
		parsed.Host = setting.Bucket + "." + parsed.Host
	}
	return parsed, nil
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
