package app

import (
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"

	"yingce/backend/internal/model"
	"yingce/backend/internal/storage"

	"github.com/aws/aws-sdk-go/aws"
	awss3 "github.com/aws/aws-sdk-go/service/s3"
)

// 直传（presigned PUT）链路：浏览器先要签名 URL，再直传对象存储，最后回执确认。
// 全程文件字节不经过应用服务器，绕开反向代理的体积/超时限制。

const (
	directUploadURLTTL      = 30 * time.Minute
	directUploadMaxFileSize = 512 << 20
)

type DirectUploadSession struct {
	Resource  *model.Resource   `json:"resource"`
	UploadURL string            `json:"uploadUrl"`
	Method    string            `json:"method"`
	Headers   map[string]string `json:"headers"`
	ExpiresAt time.Time         `json:"expiresAt"`
}

// CreateDirectUploadSession 校验配额与幂等，落一条 pending 资源并返回预签名 PUT URL。
func (s *Service) CreateDirectUploadSession(userID string, kind string, fileName string, mimeType string, size int64, width int, height int, durationMs int64, uploadIdentity ...string) (*DirectUploadSession, error) {
	if size <= 0 {
		return nil, BadAuthRequest("文件大小无效")
	}
	if size > directUploadMaxFileSize {
		return nil, BadAuthRequest(fmt.Sprintf("文件超过直传大小上限 %dMB", directUploadMaxFileSize>>20))
	}
	uploadKey := normalizedResourceUploadKey(uploadIdentity)
	existing, err := s.resourceForUploadKey(userID, uploadKey)
	if err != nil {
		return nil, err
	}
	if existing != nil && existing.Status == model.ResourceStatusReady {
		return nil, BadAuthRequest(fmt.Sprintf("该上传身份对应的资源已存在且就绪（%s）", existing.ID))
	}
	if existing != nil && existing.Status == model.ResourceStatusPending {
		return nil, resourceUploadInProgress()
	}

	kind = normalizeResourceKind(kind, mimeType)
	setting, storageSettingID, useOSS, err := s.activeResourceOSSSetting(userID)
	if err != nil {
		return nil, err
	}
	if !useOSS {
		return nil, BadAuthRequest("当前未配置对象存储，无法使用直传")
	}
	if setting.Provider != "s3" {
		return nil, BadAuthRequest("直传目前仅支持 S3 兼容存储（含 Cloudflare R2）")
	}

	day, err := s.reserveUserUploadQuota(userID, size)
	if err != nil {
		return nil, err
	}

	now := time.Now()
	objectKey := ossObjectKey(setting, userID, kind, fileName, mimeType, now)
	resource := model.Resource{
		ID: newID(), UserID: userID, Kind: kind, Status: model.ResourceStatusPending,
		Provider: setting.Provider, Endpoint: setting.Endpoint, Bucket: setting.Bucket,
		StorageSettingID: storageSettingID, ObjectKey: objectKey,
		MimeType: mimeType, Size: size, Width: width, Height: height, DurationMs: durationMs,
		UploadKey: uploadKey, CreatedAt: now, UpdatedAt: now,
	}
	if err := s.repo.CreateResource(&resource); err != nil {
		s.releaseUserUploadQuota(userID, day, size)
		if existing, lookupErr := s.resourceForUploadKey(userID, uploadKey); lookupErr == nil && existing != nil {
			if existing.Status == model.ResourceStatusReady {
				return nil, BadAuthRequest(fmt.Sprintf("该上传身份对应的资源已存在且就绪（%s）", existing.ID))
			}
			return nil, resourceUploadInProgress()
		}
		return nil, err
	}

	client, err := storage.NewS3Client(setting, 2*time.Minute)
	if err != nil {
		s.failDirectUploadResource(&resource, err)
		s.releaseUserUploadQuota(userID, day, size)
		return nil, err
	}
	putReq, _ := client.PutObjectRequest(&awss3.PutObjectInput{
		Bucket:      aws.String(setting.Bucket),
		Key:         aws.String(objectKey),
		ContentType: aws.String(mimeType),
	})
	signedURL, err := putReq.Presign(directUploadURLTTL)
	if err != nil {
		s.failDirectUploadResource(&resource, err)
		s.releaseUserUploadQuota(userID, day, size)
		return nil, fmt.Errorf("生成直传地址失败：%w", err)
	}

	headers := map[string]string{}
	if mimeType != "" {
		headers["Content-Type"] = mimeType
	}
	return &DirectUploadSession{
		Resource:  &resource,
		UploadURL: signedURL,
		Method:    http.MethodPut,
		Headers:   headers,
		ExpiresAt: now.Add(directUploadURLTTL),
	}, nil
}

// CompleteDirectUpload 校验对象已真实写入（HEAD 拿 ETag 与大小），把资源置为 ready。
func (s *Service) CompleteDirectUpload(userID string, resourceID string) (*model.Resource, error) {
	resource, err := s.repo.ResourceForUser(userID, resourceID)
	if err != nil {
		return nil, err
	}
	if resource.Status == model.ResourceStatusReady {
		return resource, nil
	}
	if resource.Status != model.ResourceStatusPending {
		return nil, BadAuthRequest("资源不处于待上传状态")
	}

	setting, err := s.ossSettingForResource(userID, resource)
	if err != nil {
		return nil, err
	}
	client, err := storage.NewS3Client(setting, time.Minute)
	if err != nil {
		return nil, err
	}
	head, err := client.HeadObject(&awss3.HeadObjectInput{
		Bucket: aws.String(resource.Bucket),
		Key:    aws.String(resource.ObjectKey),
	})
	if err != nil {
		return nil, BadAuthRequest("尚未检测到已上传的对象，请先完成直传再确认")
	}
	headSize := int64(0)
	if head.ContentLength != nil {
		headSize = *head.ContentLength
	}
	if resource.Size > 0 && headSize > 0 && headSize != resource.Size {
		return nil, BadAuthRequest(fmt.Sprintf("对象大小不一致：期望 %d 字节，实际 %d 字节", resource.Size, headSize))
	}
	resource.ETag = strings.Trim(strings.TrimSpace(aws.StringValue(head.ETag)), `"`)
	resource.Status = model.ResourceStatusReady
	resource.UpdatedAt = time.Now()
	if err := s.repo.SaveResource(resource); err != nil {
		return nil, err
	}
	s.commitUserUploadQuota(userID, resource.Size)
	s.recordActivity(userID, "resource", 1)
	s.maybeStartPlaybackTranscode(resource)
	// 缩略图异步生成：列表/画布一次要加载几十张图，缩略图能把首屏字节量降一个数量级。
	s.maybeStartThumbnail(resource)
	// 本地冷备异步同步：CDN 404/403 时由应用服务器兜底返回字节。
	s.maybeStartColdBackup(resource)
	return resource, nil
}

// maybeStartThumbnail 在资源就绪后异步生成缩略图，不阻塞上传确认响应。
func (s *Service) maybeStartThumbnail(resource *model.Resource) {
	if resource == nil || resource.Kind != "image" || resource.Provider == "local" {
		return
	}
	if resource.ThumbnailStatus == model.ThumbnailStatusReady || resource.ThumbnailStatus == model.ThumbnailStatusProcessing {
		return
	}
	snapshot := *resource
	go func() {
		defer func() { _ = recover() }()
		s.generateResourceThumbnail(&snapshot)
	}()
}

// AbortDirectUpload 清理未完成的直传：标记 failed、释放配额并尽力删除远端对象。
func (s *Service) AbortDirectUpload(userID string, resourceID string) error {
	resource, err := s.repo.ResourceForUser(userID, resourceID)
	if err != nil {
		return err
	}
	if resource.Status != model.ResourceStatusPending {
		return nil
	}
	s.failDirectUploadResource(resource, errors.New("用户取消直传"))
	s.releaseUserUploadQuota(userID, resource.CreatedAt.UTC().Format("2006-01-02"), resource.Size)
	if setting, err := s.ossSettingForResource(userID, resource); err == nil {
		_ = storage.DeleteS3Object(setting, resource.ObjectKey)
	}
	return nil
}

func (s *Service) failDirectUploadResource(resource *model.Resource, cause error) {
	resource.Status = model.ResourceStatusFailed
	resource.Error = cause.Error()
	resource.UpdatedAt = time.Now()
	_ = s.repo.SaveResource(resource)
}
