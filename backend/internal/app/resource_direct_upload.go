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

	// 分片直传：超过阈值的文件改走 S3 multipart，由浏览器并发上传多段。
	// 动机：Cloudflare 隧道下单条 TCP 连接的吞吐被拥塞窗口卡死（实测单流 166KB/s），
	// 而并发两条能到 0.42MB/s（约 2.5 倍）。多分片并发是当前架构下唯一不依赖
	// 公网 IP / 证书 / 换存储就能拿到的提速路径。
	directMultipartThreshold = 6 << 20 // 6MB 以下分片反而多几次往返，收益不抵开销
	directMultipartPartSize  = 5 << 20 // S3 规定除最后一段外每段不得小于 5MB，取最小值换最多并发度
	directMultipartMaxParts  = 10000   // S3 协议硬上限
)

// DirectUploadPart 一段的分片签名地址。Size 由后端算好，前端据此切 Blob，
// 避免前端自己算偏移导致最后一段长度不一致（multipart 完成时会校验总大小）。
type DirectUploadPart struct {
	PartNumber int    `json:"partNumber"`
	URL        string `json:"url"`
	Size       int64  `json:"size"`
}

// DirectUploadMultipart 分片直传会话。UploadID 由 S3 分配，complete/abort 时需回传。
type DirectUploadMultipart struct {
	UploadID string             `json:"uploadId"`
	PartSize int64              `json:"partSize"`
	Parts    []DirectUploadPart `json:"parts"`
}

type DirectUploadSession struct {
	Resource  *model.Resource   `json:"resource"`
	UploadURL string            `json:"uploadUrl"`
	Method    string            `json:"method"`
	Headers   map[string]string `json:"headers"`
	ExpiresAt time.Time         `json:"expiresAt"`
	// 非空表示走分片直传：此时 UploadURL 为空，浏览器按 Parts 并发 PUT。
	Multipart *DirectUploadMultipart `json:"multipart,omitempty"`
}

// buildDirectUploadMultipart 创建 multipart upload 并为每一段签一个 UploadPart 预签名地址。
// 任一环节失败都必须 Abort 掉已创建的 upload，否则对象存储会残留分片计费。
func buildDirectUploadMultipart(client *awss3.S3, setting storage.Settings, objectKey string, mimeType string, size int64, ttl time.Duration) (*DirectUploadMultipart, error) {
	partSize := int64(directMultipartPartSize)
	for size/partSize >= directMultipartMaxParts {
		partSize <<= 1
	}
	createInput := &awss3.CreateMultipartUploadInput{
		Bucket: aws.String(setting.Bucket),
		Key:    aws.String(objectKey),
	}
	// 对象的 Content-Type 只能在 CreateMultipartUpload 指定，分片 PUT 带不上。
	if mimeType != "" {
		createInput.ContentType = aws.String(mimeType)
	}
	create, err := client.CreateMultipartUpload(createInput)
	if err != nil {
		return nil, fmt.Errorf("创建分片上传失败：%w", err)
	}
	uploadID := aws.StringValue(create.UploadId)
	if uploadID == "" {
		return nil, errors.New("对象存储未返回分片上传标识")
	}
	count := int((size + partSize - 1) / partSize)
	parts := make([]DirectUploadPart, 0, count)
	for i := 0; i < count; i++ {
		partLen := partSize
		if remain := size - int64(i)*partSize; remain < partSize {
			partLen = remain
		}
		partReq, _ := client.UploadPartRequest(&awss3.UploadPartInput{
			Bucket:     aws.String(setting.Bucket),
			Key:        aws.String(objectKey),
			UploadId:   aws.String(uploadID),
			PartNumber: aws.Int64(int64(i + 1)),
		})
		signedURL, signErr := partReq.Presign(ttl)
		if signErr != nil {
			_, _ = client.AbortMultipartUpload(&awss3.AbortMultipartUploadInput{
				Bucket:   aws.String(setting.Bucket),
				Key:      aws.String(objectKey),
				UploadId: aws.String(uploadID),
			})
			return nil, fmt.Errorf("分片签名失败：%w", signErr)
		}
		parts = append(parts, DirectUploadPart{PartNumber: i + 1, URL: signedURL, Size: partLen})
	}
	return &DirectUploadMultipart{UploadID: uploadID, PartSize: partSize, Parts: parts}, nil
}

// CreateDirectUploadSession 校验配额与幂等，落一条 pending 资源并返回预签名 PUT URL。
// allowMultipart 由客户端声明：只有确认自己能处理分片会话的前端才走 multipart。
// 这样后端与前端可以任意顺序升级，也能单边回滚（旧前端仍拿到单流预签名地址）。
func (s *Service) CreateDirectUploadSession(userID string, kind string, fileName string, mimeType string, size int64, width int, height int, durationMs int64, allowMultipart bool, uploadIdentity ...string) (*DirectUploadSession, error) {
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

	// 大文件优先走分片并发：浏览器对每一段独立建连，绕开单连接流控。
	// 分片创建失败时静默回落单流预签名 —— 慢一点也要保证上传能成功。
	if allowMultipart && size >= directMultipartThreshold {
		if multipart, mpErr := buildDirectUploadMultipart(client, setting, objectKey, mimeType, size, directUploadURLTTL); mpErr == nil {
			return &DirectUploadSession{
				Resource:  &resource,
				Method:    http.MethodPut,
				Headers:   map[string]string{},
				ExpiresAt: now.Add(directUploadURLTTL),
				Multipart: multipart,
			}, nil
		}
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
// uploadID 非空表示分片直传，需要先 CompleteMultipartUpload 把分片合成对象。
func (s *Service) CompleteDirectUpload(userID string, resourceID string, uploadID string) (*model.Resource, error) {
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
	if uploadID != "" {
		if err := completeMultipartUpload(client, setting, resource.ObjectKey, uploadID); err != nil {
			return nil, err
		}
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

// completeMultipartUpload 用 ListParts 自行取回各段 ETag 再合成，不要求浏览器回传。
// 这一点很关键：MinIO 的 CORS 默认不暴露 ETag 响应头，浏览器读不到也就无法回传；
// 由服务端 ListParts 兜住，前端只要保证每段 PUT 成功即可。
func completeMultipartUpload(client *awss3.S3, setting storage.Settings, objectKey string, uploadID string) error {
	listed, err := client.ListParts(&awss3.ListPartsInput{
		Bucket:   aws.String(setting.Bucket),
		Key:      aws.String(objectKey),
		UploadId: aws.String(uploadID),
	})
	if err != nil {
		return BadAuthRequest("分片信息读取失败，请重新上传")
	}
	if len(listed.Parts) == 0 {
		return BadAuthRequest("尚未检测到任何已上传分片，请先完成直传再确认")
	}
	// S3 要求按 PartNumber 升序提交，缺段会被判为 InvalidPart。
	completed := make([]*awss3.CompletedPart, 0, len(listed.Parts))
	for _, part := range listed.Parts {
		completed = append(completed, &awss3.CompletedPart{ETag: part.ETag, PartNumber: part.PartNumber})
	}
	_, err = client.CompleteMultipartUpload(&awss3.CompleteMultipartUploadInput{
		Bucket:          aws.String(setting.Bucket),
		Key:             aws.String(objectKey),
		UploadId:        aws.String(uploadID),
		MultipartUpload: &awss3.CompletedMultipartUpload{Parts: completed},
	})
	if err != nil {
		return BadAuthRequest(fmt.Sprintf("分片合成失败：%v", err))
	}
	return nil
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
func (s *Service) AbortDirectUpload(userID string, resourceID string, uploadID ...string) error {
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
		// 分片残留会在对象存储里持续计费，必须显式 Abort；失败不影响整体取消流程。
		if len(uploadID) > 0 && uploadID[0] != "" {
			if client, clientErr := storage.NewS3Client(setting, time.Minute); clientErr == nil {
				_, _ = client.AbortMultipartUpload(&awss3.AbortMultipartUploadInput{
					Bucket:   aws.String(setting.Bucket),
					Key:      aws.String(resource.ObjectKey),
					UploadId: aws.String(uploadID[0]),
				})
			}
		}
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
