package storage

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"infinite-canvas/backend/internal/kernel"
	"infinite-canvas/backend/internal/outbound"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/aws/aws-sdk-go/aws"
	"github.com/aws/aws-sdk-go/aws/awserr"
	"github.com/aws/aws-sdk-go/aws/credentials"
	"github.com/aws/aws-sdk-go/aws/session"
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
		return nil, errors.New("S3 Region、Bucket 或访问密钥不完整")
	}
	httpClient := outbound.OutboundHTTPClient(timeout)
	config := aws.NewConfig().
		WithRegion(setting.Region).
		WithEndpoint(endpoint.String()).
		WithCredentials(credentials.NewStaticCredentials(setting.AccessKeyID, setting.AccessKeySecret, setting.SessionToken)).
		WithHTTPClient(httpClient).
		WithS3ForcePathStyle(setting.PathStyle || !StandardAWSS3Endpoint(endpoint.String())).
		WithDisableSSL(endpoint.Scheme == "http")
	sess, err := session.NewSession(config)
	if err != nil {
		return nil, err
	}
	return awss3.New(sess), nil
}

func PutS3Object(setting Settings, objectKey string, mimeType string, size int64, body io.Reader) (string, error) {
	client, err := NewS3Client(setting, 2*time.Minute)
	if err != nil {
		return "", err
	}
	var seekable io.ReadSeeker
	if reader, ok := body.(io.ReadSeeker); ok {
		seekable = reader
	} else {
		limit := size + 1
		if limit <= 0 {
			limit = 64 << 20
		}
		data, readErr := io.ReadAll(io.LimitReader(body, limit))
		if readErr != nil {
			return "", readErr
		}
		if size >= 0 && int64(len(data)) != size {
			return "", errors.New("S3 上传内容长度与资源记录不一致")
		}
		seekable = bytes.NewReader(data)
	}
	input := &awss3.PutObjectInput{Bucket: aws.String(setting.Bucket), Key: aws.String(strings.TrimLeft(objectKey, "/")), Body: seekable}
	if mimeType != "" {
		input.ContentType = aws.String(mimeType)
	}
	if size >= 0 {
		input.ContentLength = aws.Int64(size)
	}
	output, err := client.PutObjectWithContext(context.Background(), input)
	if err != nil {
		return "", fmt.Errorf("S3 上传失败：%w", err)
	}
	return strings.Trim(aws.StringValue(output.ETag), `"`), nil
}

func GetS3ObjectRange(setting Settings, objectKey string, rangeHeader string) (*ObjectStream, error) {
	client, err := NewS3Client(setting, 2*time.Minute)
	if err != nil {
		return nil, err
	}
	input := &awss3.GetObjectInput{Bucket: aws.String(setting.Bucket), Key: aws.String(strings.TrimLeft(objectKey, "/"))}
	if rangeHeader != "" {
		input.Range = aws.String(rangeHeader)
	}
	output, err := client.GetObjectWithContext(context.Background(), input)
	if err != nil {
		if requestFailure, ok := err.(awserr.RequestFailure); ok && requestFailure.StatusCode() == http.StatusRequestedRangeNotSatisfiable {
			return &ObjectStream{Body: io.NopCloser(bytes.NewReader(nil)), StatusCode: http.StatusRequestedRangeNotSatisfiable, AcceptRanges: "bytes"}, nil
		}
		return nil, fmt.Errorf("S3 读取失败：%w", err)
	}
	status := http.StatusOK
	if rangeHeader != "" && aws.StringValue(output.ContentRange) != "" {
		status = http.StatusPartialContent
	}
	return &ObjectStream{Body: output.Body, StatusCode: status, ContentLength: aws.Int64Value(output.ContentLength), ContentRange: aws.StringValue(output.ContentRange), AcceptRanges: kernel.FirstNonEmpty(aws.StringValue(output.AcceptRanges), "bytes")}, nil
}

func SignedS3ObjectURL(setting Settings, objectKey string, expiresAt time.Time) (string, error) {
	return signedS3ObjectURL(setting, objectKey, expiresAt, "")
}

func SignedS3ObjectDownloadURL(setting Settings, objectKey string, expiresAt time.Time, disposition string) (string, error) {
	return signedS3ObjectURL(setting, objectKey, expiresAt, disposition)
}

func signedS3ObjectURL(setting Settings, objectKey string, expiresAt time.Time, disposition string) (string, error) {
	client, err := NewS3Client(setting, 2*time.Minute)
	if err != nil {
		return "", err
	}
	duration := time.Until(expiresAt)
	if duration <= 0 {
		return "", errors.New("S3 签名有效期必须晚于当前时间")
	}
	input := &awss3.GetObjectInput{Bucket: aws.String(setting.Bucket), Key: aws.String(strings.TrimLeft(objectKey, "/"))}
	if disposition != "" {
		input.ResponseContentDisposition = aws.String(disposition)
	}
	req, _ := client.GetObjectRequest(input)
	value, err := req.Presign(duration)
	if err != nil {
		return "", fmt.Errorf("S3 下载地址签名失败：%w", err)
	}
	return value, nil
}

func DeleteS3Object(setting Settings, objectKey string) error {
	client, err := NewS3Client(setting, 2*time.Minute)
	if err != nil {
		return err
	}
	_, err = client.DeleteObjectWithContext(context.Background(), &awss3.DeleteObjectInput{Bucket: aws.String(setting.Bucket), Key: aws.String(strings.TrimLeft(objectKey, "/"))})
	if requestFailure, ok := err.(awserr.RequestFailure); ok && requestFailure.StatusCode() == http.StatusNotFound {
		return nil
	}
	if err != nil {
		return fmt.Errorf("删除 S3 对象失败：%w", err)
	}
	return nil
}
