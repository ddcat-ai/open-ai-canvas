package storage

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha1"
	"encoding/base64"
	"errors"
	"fmt"
	"github.com/aws/aws-sdk-go/aws/credentials"
	awsv4 "github.com/aws/aws-sdk-go/aws/signer/v4"
	qiniuAuth "github.com/qiniu/go-sdk/v7/auth"
	qiniuStorage "github.com/qiniu/go-sdk/v7/storage"
	cos "github.com/tencentyun/cos-go-sdk-v5"
	"infinite-canvas/backend/internal/kernel"
	"infinite-canvas/backend/internal/outbound"
	"io"
	"net"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
)

func PutOSSObject(setting Settings, objectKey string, mimeType string, size int64, body io.Reader) (string, error) {
	setting = NormalizeSettings(setting)
	if setting.Provider == tencentCOSProvider {
		return PutCOSObject(setting, objectKey, mimeType, size, body)
	}
	if setting.Provider == qiniuKodoProvider {
		return PutQiniuObject(setting, objectKey, mimeType, size, body)
	}
	if setting.Provider == s3Provider {
		return PutS3Object(setting, objectKey, mimeType, size, body)
	}
	return PutAliyunOSSObject(setting, objectKey, mimeType, size, body)
}

// 阿里云 OSS 继续沿用原有 V1 签名和请求路径，避免已有部署行为发生变化。
func PutAliyunOSSObject(setting Settings, objectKey string, mimeType string, size int64, body io.Reader) (string, error) {
	if mimeType == "" {
		mimeType = "application/octet-stream"
	}
	req, err := NewOSSRequest(http.MethodPut, setting, objectKey, mimeType, body)
	if err != nil {
		return "", err
	}
	if size > 0 {
		req.ContentLength = size
	}
	resp, err := outbound.OutboundHTTPClient(2 * time.Minute).Do(req)
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

type ObjectStream struct {
	Body          io.ReadCloser
	StatusCode    int
	ContentLength int64
	ContentRange  string
	AcceptRanges  string
}

func GetOSSObjectRange(setting Settings, objectKey string, rangeHeader string) (*ObjectStream, error) {
	setting = NormalizeSettings(setting)
	// This compatibility entry point is also used by older callers that only
	// know CDNBaseURL. The application delivery policy uses GetOriginObjectRange
	// for an explicit private-proxy fallback, so a missing CDN auth mode never
	// turns that fallback into an accidental CDN request.
	if setting.CDNBaseURL != "" && (setting.Delivery.CDNAuthMode == "" || CDNEnabled(setting)) {
		return getCDNObjectRange(setting, objectKey, rangeHeader)
	}
	return GetOriginObjectRange(setting, objectKey, rangeHeader)
}

func GetOriginObjectRange(setting Settings, objectKey string, rangeHeader string) (*ObjectStream, error) {
	setting = NormalizeSettings(setting)
	if setting.Provider == s3Provider {
		return GetS3ObjectRange(setting, objectKey, rangeHeader)
	}
	if setting.Provider == tencentCOSProvider {
		return GetCOSObjectRange(setting, objectKey, rangeHeader)
	}
	if setting.Provider == qiniuKodoProvider {
		return GetQiniuObjectRange(setting, objectKey, rangeHeader)
	}
	return GetAliyunOSSObjectRange(setting, objectKey, rangeHeader)
}

func getCDNObjectRange(setting Settings, objectKey string, rangeHeader string) (*ObjectStream, error) {
	var (
		urlValue string
		err      error
	)
	if setting.Delivery.CDNAuthMode == "" {
		urlValue, err = OssCDNObjectURL(setting.CDNBaseURL, objectKey)
	} else {
		urlValue, err = SignCDNURL(setting, objectKey, time.Now().Add(resourceAccessURLTTL))
	}
	if err != nil {
		return nil, err
	}
	req, err := http.NewRequest(http.MethodGet, urlValue, nil)
	if err != nil {
		return nil, err
	}
	if rangeHeader != "" {
		req.Header.Set("Range", rangeHeader)
	}
	outbound.ApplyDefaultOutboundHeaders(req)
	resp, err := outbound.OutboundHTTPClient(2 * time.Minute).Do(req)
	if err != nil {
		return nil, fmt.Errorf("CDN 读取失败：%w", err)
	}
	if (resp.StatusCode < 200 || resp.StatusCode >= 300) && resp.StatusCode != http.StatusRequestedRangeNotSatisfiable {
		defer resp.Body.Close()
		detail, _ := io.ReadAll(io.LimitReader(resp.Body, 512))
		return nil, fmt.Errorf("CDN 读取失败：%s %s", resp.Status, strings.TrimSpace(string(detail)))
	}
	return &ObjectStream{Body: resp.Body, StatusCode: resp.StatusCode, ContentLength: resp.ContentLength, ContentRange: resp.Header.Get("Content-Range"), AcceptRanges: kernel.FirstNonEmpty(resp.Header.Get("Accept-Ranges"), "bytes")}, nil
}

func GetAliyunOSSObjectRange(setting Settings, objectKey string, rangeHeader string) (*ObjectStream, error) {
	req, err := NewOSSRequest(http.MethodGet, setting, objectKey, "", nil)
	if err != nil {
		return nil, err
	}
	if rangeHeader != "" {
		req.Header.Set("Range", rangeHeader)
	}
	resp, err := outbound.OutboundHTTPClient(2 * time.Minute).Do(req)
	if err != nil {
		return nil, err
	}
	if (resp.StatusCode < 200 || resp.StatusCode >= 300) && resp.StatusCode != http.StatusRequestedRangeNotSatisfiable {
		defer resp.Body.Close()
		detail, _ := io.ReadAll(io.LimitReader(resp.Body, 512))
		return nil, fmt.Errorf("OSS 读取失败：%s %s", resp.Status, strings.TrimSpace(string(detail)))
	}
	return &ObjectStream{Body: resp.Body, StatusCode: resp.StatusCode, ContentLength: resp.ContentLength, ContentRange: resp.Header.Get("Content-Range"), AcceptRanges: kernel.FirstNonEmpty(resp.Header.Get("Accept-Ranges"), "bytes")}, nil
}

func SignedOSSObjectURL(setting Settings, objectKey string, expiresAt time.Time) (string, error) {
	setting = NormalizeSettings(setting)
	// Keep the low-level helper compatible with historical callers that passed
	// only CDNBaseURL. The application policy remains strict and calls
	// SignedOriginObjectURL when CDN authentication is not explicitly enabled.
	if setting.CDNBaseURL != "" && (setting.Delivery.CDNAuthMode == "" || CDNEnabled(setting)) {
		if setting.Delivery.CDNAuthMode == "" {
			return OssCDNObjectURL(setting.CDNBaseURL, objectKey)
		}
		return SignCDNURL(setting, objectKey, expiresAt)
	}
	return SignedOriginObjectURL(setting, objectKey, expiresAt)
}

func SignedOriginObjectURL(setting Settings, objectKey string, expiresAt time.Time) (string, error) {
	setting = NormalizeSettings(setting)
	if setting.Provider == s3Provider {
		return SignedS3ObjectURL(setting, objectKey, expiresAt)
	}
	if setting.Provider == qiniuKodoProvider {
		return SignedQiniuS3ObjectURL(setting, objectKey, expiresAt)
	}
	if setting.Provider == tencentCOSProvider {
		return SignedCOSObjectURL(setting, objectKey, expiresAt)
	}
	return SignedAliyunOSSObjectURL(setting, objectKey, expiresAt)
}

func SignedAliyunOSSObjectURL(setting Settings, objectKey string, expiresAt time.Time) (string, error) {
	baseURL, err := OssBucketBaseURL(setting)
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
	baseURL.Path = strings.TrimRight(baseURL.Path, "/") + "/" + strings.TrimLeft(objectKey, "/")
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

func PutCOSObject(setting Settings, objectKey string, mimeType string, size int64, body io.Reader) (string, error) {
	client, err := NewCOSClient(setting, 2*time.Minute)
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

func PutQiniuObject(setting Settings, objectKey string, mimeType string, size int64, body io.Reader) (string, error) {
	if setting.AccessKeyID == "" || setting.AccessKeySecret == "" {
		return "", errors.New("七牛云 Kodo 访问密钥不可用")
	}
	if setting.Bucket == "" || objectKey == "" {
		return "", errors.New("七牛云 Kodo Bucket 或对象路径为空")
	}
	config := qiniuStorage.NewConfig()
	config.Region = QiniuRegion(setting.Region)
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

func GetCOSObjectRange(setting Settings, objectKey string, rangeHeader string) (*ObjectStream, error) {
	client, err := NewCOSClient(setting, 2*time.Minute)
	if err != nil {
		return nil, err
	}
	options := &cos.ObjectGetOptions{Range: rangeHeader}
	resp, err := client.Object.Get(context.Background(), objectKey, options)
	if err != nil {
		if resp != nil && resp.StatusCode == http.StatusRequestedRangeNotSatisfiable {
			return &ObjectStream{Body: io.NopCloser(bytes.NewReader(nil)), StatusCode: resp.StatusCode, ContentRange: resp.Header.Get("Content-Range"), AcceptRanges: kernel.FirstNonEmpty(resp.Header.Get("Accept-Ranges"), "bytes")}, nil
		}
		return nil, fmt.Errorf("COS 读取失败：%w", err)
	}
	return &ObjectStream{Body: resp.Body, StatusCode: resp.StatusCode, ContentLength: resp.ContentLength, ContentRange: resp.Header.Get("Content-Range"), AcceptRanges: kernel.FirstNonEmpty(resp.Header.Get("Accept-Ranges"), "bytes")}, nil
}

func GetQiniuObjectRange(setting Settings, objectKey string, rangeHeader string) (*ObjectStream, error) {
	signedURL, err := SignedQiniuS3ObjectURL(setting, objectKey, time.Now().Add(resourceAccessURLTTL))
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
	outbound.ApplyDefaultOutboundHeaders(req)
	resp, err := outbound.OutboundHTTPClient(2 * time.Minute).Do(req)
	if err != nil {
		return nil, fmt.Errorf("七牛云 Kodo 读取失败：%w", err)
	}
	if (resp.StatusCode < 200 || resp.StatusCode >= 300) && resp.StatusCode != http.StatusRequestedRangeNotSatisfiable {
		defer resp.Body.Close()
		detail, _ := io.ReadAll(io.LimitReader(resp.Body, 512))
		return nil, fmt.Errorf("七牛云 Kodo 读取失败：%s %s", resp.Status, strings.TrimSpace(string(detail)))
	}
	return &ObjectStream{Body: resp.Body, StatusCode: resp.StatusCode, ContentLength: resp.ContentLength, ContentRange: resp.Header.Get("Content-Range"), AcceptRanges: kernel.FirstNonEmpty(resp.Header.Get("Accept-Ranges"), "bytes")}, nil
}

func SignedCOSObjectURL(setting Settings, objectKey string, expiresAt time.Time) (string, error) {
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
	client, err := NewCOSClient(setting, 2*time.Minute)
	if err != nil {
		return "", err
	}
	signedURL, err := client.Object.GetPresignedURL(context.Background(), http.MethodGet, objectKey, setting.AccessKeyID, setting.AccessKeySecret, expires, nil)
	if err != nil {
		return "", err
	}
	return signedURL.String(), nil
}

func SignedQiniuObjectURL(setting Settings, objectKey string, expiresAt time.Time) (string, error) {
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
		return SignedQiniuS3ObjectURL(setting, objectKey, expiresAt)
	}
	mac := qiniuAuth.New(setting.AccessKeyID, setting.AccessKeySecret)
	return qiniuStorage.MakePrivateURLv2(mac, strings.TrimRight(setting.CDNBaseURL, "/"), objectKey, deadline), nil
}

// SignedQiniuS3ObjectURL 用七牛兼容 S3 的 AWS Signature V4 访问私有空间。
// 没有绑定域名时，浏览器不直接访问该地址，而是由后端代理读取并返回文件。
func SignedQiniuS3ObjectURL(setting Settings, objectKey string, expiresAt time.Time) (string, error) {
	region := QiniuS3Region(setting)
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

func QiniuS3Region(setting Settings) string {
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

func QiniuRegion(region string) *qiniuStorage.Region {
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

func NewCOSClient(setting Settings, timeout time.Duration) (*cos.Client, error) {
	bucketURL, err := CosBucketBaseURL(setting)
	if err != nil {
		return nil, err
	}
	httpClient := outbound.OutboundHTTPClient(timeout)
	httpClient.Transport = &cos.AuthorizationTransport{SecretID: setting.AccessKeyID, SecretKey: setting.AccessKeySecret, Transport: httpClient.Transport}
	return cos.NewClient(&cos.BaseURL{BucketURL: bucketURL}, httpClient), nil
}

func CosBucketBaseURL(setting Settings) (*url.URL, error) {
	setting = NormalizeSettings(setting)
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

func OssCDNBaseURL(raw string) (*url.URL, error) {
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

func OssCDNObjectURL(raw string, objectKey string) (string, error) {
	baseURL, err := OssCDNBaseURL(raw)
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

func NewOSSRequest(method string, setting Settings, objectKey string, contentType string, body io.Reader) (*http.Request, error) {
	baseURL, err := OssBucketBaseURL(setting)
	if err != nil {
		return nil, err
	}
	baseURL.Path = strings.TrimRight(baseURL.Path, "/") + "/" + strings.TrimLeft(objectKey, "/")
	// 请求体必须用 no-op close 包装：服务端提前返回（如 OSS 签名 403）时
	// http.Transport 会关闭未发完的 Request.Body，若直接传入 *os.File 等
	// 调用方持有的文件，后续“降级本地存储”的 Seek 重读将因 file already
	// closed 失败。NopCloser 让 Transport 的关闭成为空操作，底层文件保持可用。
	// GET/HEAD/DELETE 等无请求体的调用传入 nil body；NopCloser(nil) 会产生非 nil 的
	// Body 包装 nil reader，Go 1.26 发送前 body 探测会直接 nil 解引用崩溃。
	var reqBody io.Reader
	if body != nil {
		reqBody = io.NopCloser(body)
	}
	req, err := http.NewRequest(method, baseURL.String(), reqBody)
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

func OssBucketBaseURL(setting Settings) (*url.URL, error) {
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
	host := parsed.Hostname()
	// Local test/dev endpoints and explicit IP endpoints are commonly path-style
	// services. Do not turn 127.0.0.1 into test-bucket.127.0.0.1, which both
	// breaks the endpoint and makes the upload fallback impossible to exercise.
	if host != "localhost" && net.ParseIP(host) == nil && !strings.HasPrefix(strings.ToLower(host), "localhost:") && !strings.HasPrefix(parsed.Host, setting.Bucket+".") {
		parsed.Host = setting.Bucket + "." + parsed.Host
	}
	return parsed, nil
}

func EscapeObjectKey(key string) string {
	parts := strings.Split(key, "/")
	for i, part := range parts {
		parts[i] = url.PathEscape(part)
	}
	return strings.Join(parts, "/")
}

func DeleteAliyunOSSObject(setting Settings, objectKey string) error {
	req, err := NewOSSRequest(http.MethodDelete, setting, objectKey, "", nil)
	if err != nil {
		return err
	}
	resp, err := outbound.OutboundHTTPClient(2 * time.Minute).Do(req)
	if err != nil {
		return fmt.Errorf("删除阿里云 OSS 对象失败：%w", err)
	}
	defer resp.Body.Close()
	if (resp.StatusCode < 200 || resp.StatusCode >= 300) && resp.StatusCode != http.StatusNotFound {
		detail, _ := io.ReadAll(io.LimitReader(resp.Body, 512))
		return fmt.Errorf("删除阿里云 OSS 对象失败：%s %s", resp.Status, strings.TrimSpace(string(detail)))
	}
	return nil
}

func DeleteTencentCOSObject(setting Settings, objectKey string) error {
	client, err := NewCOSClient(setting, 2*time.Minute)
	if err != nil {
		return err
	}
	resp, err := client.Object.Delete(context.Background(), objectKey)
	if resp != nil && resp.Body != nil {
		defer resp.Body.Close()
	}
	if err != nil {
		if resp != nil && resp.StatusCode == http.StatusNotFound {
			return nil
		}
		return fmt.Errorf("删除腾讯云 COS 对象失败：%w", err)
	}
	return nil
}

func DeleteQiniuObject(setting Settings, objectKey string) error {
	if setting.AccessKeyID == "" || setting.AccessKeySecret == "" {
		return errors.New("七牛云 Kodo 访问密钥不可用")
	}
	if setting.Bucket == "" || strings.TrimSpace(objectKey) == "" {
		return errors.New("七牛云 Kodo Bucket 或对象路径为空")
	}
	mac := qiniuAuth.New(setting.AccessKeyID, setting.AccessKeySecret)
	manager := qiniuStorage.NewBucketManager(mac, &qiniuStorage.Config{Region: QiniuRegion(setting.Region), UseHTTPS: true})
	if err := manager.Delete(setting.Bucket, strings.TrimLeft(objectKey, "/")); err != nil {
		if strings.Contains(strings.ToLower(err.Error()), "no such") || strings.Contains(strings.ToLower(err.Error()), "not found") {
			return nil
		}
		return fmt.Errorf("删除七牛云 Kodo 对象失败：%w", err)
	}
	return nil
}
