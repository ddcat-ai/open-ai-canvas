package storage

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"
	"yingce/backend/internal/kernel"
	"yingce/backend/internal/outbound"

	"github.com/aws/aws-sdk-go/aws"
	"github.com/aws/aws-sdk-go/aws/awserr"
	"github.com/aws/aws-sdk-go/aws/credentials"
	"github.com/aws/aws-sdk-go/aws/request"
	"github.com/aws/aws-sdk-go/aws/session"
	awsv4 "github.com/aws/aws-sdk-go/aws/signer/v4"
	awss3 "github.com/aws/aws-sdk-go/service/s3"
)

func ValidateStorageEndpoint(raw string) (*url.URL, error) {
	parsed, err := outbound.ValidateOutboundURL(raw)
	if err != nil {
		return nil, err
	}
	if parsed.User != nil || parsed.RawQuery != "" || parsed.Fragment != "" || strings.Trim(parsed.Path, "/") != "" {
		return nil, kernel.BadAuthRequest("对象存储 Endpoint 必须是服务根 URL，不能包含认证信息、路径、查询参数或片段")
	}
	if parsed.Scheme == "http" && !outbound.AllowedPrivateUpstreamHost(parsed.Hostname()) {
		return nil, kernel.BadAuthRequest("对象存储 HTTP Endpoint 仅允许访问 CANVAS_ALLOWED_PRIVATE_UPSTREAM_HOSTS 精确放行的主机")
	}
	return parsed, nil
}

func StandardAWSS3Endpoint(endpoint string) bool {
	parsed, err := url.Parse(endpoint)
	if err != nil {
		return false
	}
	host := strings.ToLower(parsed.Hostname())
	return host == "s3.amazonaws.com" || strings.HasPrefix(host, "s3.") && (strings.HasSuffix(host, ".amazonaws.com") || strings.HasSuffix(host, ".amazonaws.com.cn")) || strings.HasPrefix(host, "s3-") && strings.HasSuffix(host, ".amazonaws.com")
}

func PublicHTTPSStorageEndpoint(endpoint string) bool {
	parsed, err := url.Parse(strings.TrimSpace(endpoint))
	if err != nil || parsed.Scheme != "https" || parsed.Hostname() == "" {
		return false
	}
	return outbound.ValidateOutboundHost(parsed.Hostname()) == nil && !outbound.AllowedPrivateUpstreamHost(parsed.Hostname())
}

func NewS3Client(setting Settings, timeout time.Duration) (*awss3.S3, error) {
	setting = NormalizeSettings(setting)
	endpoint, err := ValidateStorageEndpoint(setting.Endpoint)
	if err != nil {
		return nil, err
	}
	if setting.Region == "" || setting.Bucket == "" || setting.AccessKeyID == "" || setting.AccessKeySecret == "" {
		return nil, fmt.Errorf("%s Region、Bucket 或访问密钥不完整", s3ServiceName(setting))
	}
	forcePathStyle := setting.Provider == rainyunOSSProvider || setting.PathStyle || !StandardAWSS3Endpoint(endpoint.String())
	sessionToken := setting.SessionToken
	if setting.Provider == volcengineTOSProvider {
		// TOS 的 S3 兼容域名按 virtual-hosted 访问 Bucket；平台只保存长期 AK/SK。
		forcePathStyle = false
		sessionToken = ""
	}
	httpClient := outbound.OutboundHTTPClient(timeout)
	if setting.Provider == rainyunOSSProvider {
		httpClient = outbound.StorageHTTPClient(timeout)
		// 预签名绑定当前目标，不跟随重定向。
		httpClient.CheckRedirect = func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }
	}
	config := aws.NewConfig().
		WithRegion(setting.Region).
		WithEndpoint(endpoint.String()).
		WithCredentials(credentials.NewStaticCredentials(setting.AccessKeyID, setting.AccessKeySecret, sessionToken)).
		WithHTTPClient(httpClient).
		WithS3ForcePathStyle(forcePathStyle).
		WithDisableSSL(endpoint.Scheme == "http")
	sess, err := session.NewSession(config)
	if err != nil {
		return nil, err
	}
	return awss3.New(sess), nil
}

func PutS3Object(setting Settings, objectKey string, mimeType string, size int64, body io.Reader) (string, error) {
	return putS3Object(context.Background(), setting, objectKey, mimeType, size, body)
}

func putS3Object(ctx context.Context, setting Settings, objectKey string, mimeType string, size int64, body io.Reader) (string, error) {
	setting = NormalizeSettings(setting)
	client, err := NewS3Client(setting, transferTimeout(setting))
	if err != nil {
		return "", err
	}
	if setting.Provider == rainyunOSSProvider && size <= 0 {
		return "", errors.New("雨云 OSS 上传大小必须大于 0")
	}
	var seekable io.ReadSeeker
	if reader, ok := body.(io.ReadSeeker); ok {
		seekable = reader
	} else if setting.Provider == rainyunOSSProvider {
		file, err := os.CreateTemp("", "canvas-rainyun-upload-*")
		if err != nil {
			return "", err
		}
		defer func() { _ = file.Close(); _ = os.Remove(file.Name()) }()
		written, err := io.Copy(file, io.LimitReader(body, size+1))
		if err != nil {
			return "", err
		}
		if written != size {
			return "", errors.New("雨云 OSS 上传内容大小不匹配")
		}
		if _, err := file.Seek(0, io.SeekStart); err != nil {
			return "", err
		}
		seekable = file
	} else {
		limit := maxBufferedUploadSize(setting) + 1
		if size >= 0 && size < limit {
			limit = size + 1
		}
		data, readErr := io.ReadAll(io.LimitReader(body, limit))
		if readErr != nil {
			return "", readErr
		}
		if size >= 0 && int64(len(data)) != size {
			return "", fmt.Errorf("%s 上传内容长度与资源记录不一致", s3ServiceName(setting))
		}
		seekable = bytes.NewReader(data)
	}
	input := &awss3.PutObjectInput{Bucket: aws.String(setting.Bucket), Key: aws.String(strings.TrimLeft(objectKey, "/")), Body: seekable}
	if setting.Provider == rainyunOSSProvider {
		start, err := seekable.Seek(0, io.SeekCurrent)
		if err != nil {
			return "", err
		}
		end, err := seekable.Seek(0, io.SeekEnd)
		if err != nil {
			return "", err
		}
		if _, err := seekable.Seek(start, io.SeekStart); err != nil {
			return "", err
		}
		if end-start != size {
			return "", errors.New("雨云 OSS 上传内容大小不匹配")
		}
		input.Body = nil
	}
	if mimeType != "" {
		input.ContentType = aws.String(mimeType)
	}
	if size >= 0 {
		input.ContentLength = aws.Int64(size)
	}
	if setting.Provider == rainyunOSSProvider {
		request, _ := client.PutObjectRequest(input)
		resp, err := rainyunRequest(ctx, request, seekable, size)
		if err != nil {
			return "", err
		}
		defer resp.Body.Close()
		if resp.StatusCode < 200 || resp.StatusCode >= 300 {
			detail, _ := io.ReadAll(io.LimitReader(resp.Body, errorBodyLimit(setting)))
			failure := newHTTPStatusError(setting.Provider, resp, detail)
			// 保留重试分类所需的状态和错误码，不向持久化错误透传上游正文。
			failure.Code = sanitizeCode(failure.Code)
			failure.Status = fmt.Sprintf("HTTP %d", resp.StatusCode)
			failure.Detail = failure.Code
			return "", fmt.Errorf("雨云 %w", failure)
		}
		etag := strings.Trim(resp.Header.Get("ETag"), `"`)
		if etag == "" {
			return "", errors.New("雨云 OSS 上传成功但未返回 ETag")
		}
		return etag, nil
	}
	output, err := client.PutObjectWithContext(ctx, input)
	if err != nil {
		return "", fmt.Errorf("%s 上传失败：%w", s3ServiceName(setting), err)
	}
	return strings.Trim(aws.StringValue(output.ETag), `"`), nil
}

func GetS3ObjectRange(setting Settings, objectKey string, rangeHeader string) (*ObjectStream, error) {
	setting = NormalizeSettings(setting)
	client, err := NewS3Client(setting, transferTimeout(setting))
	if err != nil {
		return nil, err
	}
	input := &awss3.GetObjectInput{Bucket: aws.String(setting.Bucket), Key: aws.String(strings.TrimLeft(objectKey, "/"))}
	if rangeHeader != "" {
		input.Range = aws.String(rangeHeader)
	}
	if setting.Provider == rainyunOSSProvider {
		request, _ := client.GetObjectRequest(input)
		resp, err := rainyunRequest(context.Background(), request, nil, 0)
		if err != nil {
			return nil, err
		}
		if resp.StatusCode == http.StatusRequestedRangeNotSatisfiable {
			resp.Body.Close()
			return &ObjectStream{Body: io.NopCloser(bytes.NewReader(nil)), StatusCode: resp.StatusCode, ContentRange: resp.Header.Get("Content-Range"), AcceptRanges: "bytes"}, nil
		}
		if resp.StatusCode < 200 || resp.StatusCode >= 300 {
			defer resp.Body.Close()
			return nil, fmt.Errorf("雨云 OSS 读取失败：HTTP %d", resp.StatusCode)
		}
		return &ObjectStream{Body: resp.Body, StatusCode: resp.StatusCode, ContentLength: resp.ContentLength, ContentRange: resp.Header.Get("Content-Range"), AcceptRanges: kernel.FirstNonEmpty(resp.Header.Get("Accept-Ranges"), "bytes")}, nil
	}
	output, err := client.GetObjectWithContext(context.Background(), input)
	if err != nil {
		if requestFailure, ok := err.(awserr.RequestFailure); ok && requestFailure.StatusCode() == http.StatusRequestedRangeNotSatisfiable {
			return &ObjectStream{Body: io.NopCloser(bytes.NewReader(nil)), StatusCode: http.StatusRequestedRangeNotSatisfiable, AcceptRanges: "bytes"}, nil
		}
		return nil, fmt.Errorf("%s 读取失败：%w", s3ServiceName(setting), err)
	}
	status := http.StatusOK
	if rangeHeader != "" && aws.StringValue(output.ContentRange) != "" {
		status = http.StatusPartialContent
	}
	return &ObjectStream{Body: output.Body, StatusCode: status, ContentLength: aws.Int64Value(output.ContentLength), ContentRange: aws.StringValue(output.ContentRange), AcceptRanges: kernel.FirstNonEmpty(aws.StringValue(output.AcceptRanges), "bytes")}, nil
}

func SignedS3ObjectURL(setting Settings, objectKey string, expiresAt time.Time) (string, error) {
	return signedS3ObjectURL(setting, objectKey, objectURLSigning{ExpiresAt: expiresAt})
}

func signedS3ObjectURL(setting Settings, objectKey string, signing objectURLSigning) (string, error) {
	setting = NormalizeSettings(setting)
	client, err := NewS3Client(setting, transferTimeout(setting))
	if err != nil {
		return "", err
	}
	if !signing.ExpiresAt.After(time.Now()) {
		return "", fmt.Errorf("%s 签名有效期必须晚于当前时间", s3ServiceName(setting))
	}
	input := &awss3.GetObjectInput{Bucket: aws.String(setting.Bucket), Key: aws.String(strings.TrimLeft(objectKey, "/"))}
	if signing.CacheControl != "" {
		input.ResponseCacheControl = aws.String(signing.CacheControl)
	}
	if signing.ContentDisposition != "" {
		input.ResponseContentDisposition = aws.String(signing.ContentDisposition)
	}
	req, _ := client.GetObjectRequest(input)
	signedAt := signingTime(signing.SignedAt)
	// SDK 默认以 time.Now 作为 X-Amz-Date；替换为对齐后的签名时间，保证同一窗口内地址稳定。
	// DisableURIPathEscaping 与 SDK 为 S3 注册的默认签名器保持一致。
	req.Handlers.Sign.Swap(awsv4.SignRequestHandler.Name, request.NamedHandler{Name: awsv4.SignRequestHandler.Name, Fn: func(r *request.Request) {
		awsv4.SignSDKRequestWithCurrentTime(r, func() time.Time { return signedAt }, func(s *awsv4.Signer) { s.DisableURIPathEscaping = true })
	}})
	value, err := req.Presign(signing.ExpiresAt.Sub(signedAt))
	if err != nil {
		return "", fmt.Errorf("%s 下载地址签名失败：%w", s3ServiceName(setting), err)
	}
	return value, nil
}

// 雨云对预签名 S3 请求的兼容性比 Authorization Header 稳定，重试必须回到完整请求体起点。
func rainyunRequest(ctx context.Context, request *request.Request, body io.ReadSeeker, size int64) (*http.Response, error) {
	value, headers, err := request.PresignRequest(15 * time.Minute)
	if err != nil {
		return nil, errors.New("雨云 OSS 请求签名失败")
	}
	var start int64
	if body != nil {
		start, err = body.Seek(0, io.SeekCurrent)
		if err != nil {
			return nil, err
		}
	}
	for attempt := 0; attempt < 3; attempt++ {
		if attempt > 0 {
			if body != nil {
				if _, err := body.Seek(start, io.SeekStart); err != nil {
					return nil, err
				}
			}
			select {
			case <-time.After(time.Duration(attempt) * 500 * time.Millisecond):
			case <-ctx.Done():
				return nil, ctx.Err()
			}
		}
		var requestBody io.Reader
		if body != nil {
			requestBody = io.NopCloser(body)
		}
		req, err := http.NewRequestWithContext(ctx, request.Operation.HTTPMethod, value, requestBody)
		if err != nil {
			return nil, errors.New("雨云 OSS 请求无效")
		}
		for key, values := range headers {
			for _, header := range values {
				req.Header.Add(key, header)
			}
		}
		if size > 0 {
			req.ContentLength = size
		}
		outbound.ApplyDefaultOutboundHeaders(req)
		resp, err := request.Config.HTTPClient.Do(req)
		if err != nil {
			if ctx.Err() != nil {
				return nil, ctx.Err()
			}
			if errors.Is(err, context.Canceled) {
				return nil, context.Canceled
			}
			if timeoutCause(err) {
				return nil, fmt.Errorf("雨云 OSS 请求超时：%w", context.DeadlineExceeded)
			}
			if attempt < 2 && (errors.Is(err, io.EOF) || errors.Is(err, io.ErrUnexpectedEOF) || strings.Contains(strings.ToLower(err.Error()), "connection reset")) {
				continue
			}
			// HTTP 客户端错误可能包含完整预签名 URL，不能返回给调用方落库。
			return nil, awserr.New("RequestError", "雨云 OSS 网络请求失败", nil)
		}
		switch resp.StatusCode {
		case http.StatusTooManyRequests, http.StatusInternalServerError, http.StatusBadGateway, http.StatusServiceUnavailable, http.StatusGatewayTimeout:
			if attempt < 2 {
				resp.Body.Close()
				continue
			}
		}
		return resp, nil
	}
	return nil, errors.New("雨云 OSS 重试次数已耗尽")
}

func DeleteS3Object(setting Settings, objectKey string) error {
	setting = NormalizeSettings(setting)
	client, err := NewS3Client(setting, transferTimeout(setting))
	if err != nil {
		return err
	}
	input := &awss3.DeleteObjectInput{Bucket: aws.String(setting.Bucket), Key: aws.String(strings.TrimLeft(objectKey, "/"))}
	if setting.Provider == rainyunOSSProvider {
		request, _ := client.DeleteObjectRequest(input)
		resp, err := rainyunRequest(context.Background(), request, nil, 0)
		if err != nil {
			return err
		}
		defer resp.Body.Close()
		if (resp.StatusCode < 200 || resp.StatusCode >= 300) && resp.StatusCode != http.StatusNotFound {
			return fmt.Errorf("删除雨云 OSS 对象失败：HTTP %d", resp.StatusCode)
		}
		return nil
	}
	_, err = client.DeleteObjectWithContext(context.Background(), input)
	if requestFailure, ok := err.(awserr.RequestFailure); ok && requestFailure.StatusCode() == http.StatusNotFound {
		return nil
	}
	if err != nil {
		return fmt.Errorf("删除 %s 对象失败：%w", s3ServiceName(setting), err)
	}
	return nil
}
