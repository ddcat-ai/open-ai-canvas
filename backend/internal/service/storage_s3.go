package service

import (
	"bytes"
	"context"
	"errors"
	"fmt"
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

func validateStorageEndpoint(raw string) (*url.URL, error) {
	parsed, err := ValidateOutboundURL(raw)
	if err != nil {
		return nil, err
	}
	if parsed.User != nil || parsed.RawQuery != "" || parsed.Fragment != "" || strings.Trim(parsed.Path, "/") != "" {
		return nil, BadAuthRequest("对象存储 Endpoint 必须是服务根 URL，不能包含认证信息、路径、查询参数或片段")
	}
	if parsed.Scheme == "http" && !allowedPrivateUpstreamHost(parsed.Hostname()) {
		return nil, BadAuthRequest("对象存储 HTTP Endpoint 仅允许访问 CANVAS_ALLOWED_PRIVATE_UPSTREAM_HOSTS 精确放行的主机")
	}
	return parsed, nil
}

func standardAWSS3Endpoint(endpoint string) bool {
	parsed, err := url.Parse(endpoint)
	if err != nil {
		return false
	}
	host := strings.ToLower(parsed.Hostname())
	return host == "s3.amazonaws.com" || strings.HasPrefix(host, "s3.") && (strings.HasSuffix(host, ".amazonaws.com") || strings.HasSuffix(host, ".amazonaws.com.cn")) || strings.HasPrefix(host, "s3-") && strings.HasSuffix(host, ".amazonaws.com")
}

func publicHTTPSStorageEndpoint(endpoint string) bool {
	parsed, err := url.Parse(strings.TrimSpace(endpoint))
	if err != nil || parsed.Scheme != "https" || parsed.Hostname() == "" {
		return false
	}
	return validateOutboundHost(parsed.Hostname()) == nil && !allowedPrivateUpstreamHost(parsed.Hostname())
}

func newS3Client(setting ossSettingValue, timeout time.Duration) (*awss3.S3, error) {
	setting = normalizeOSSSetting(setting)
	endpoint, err := validateStorageEndpoint(setting.Endpoint)
	if err != nil {
		return nil, err
	}
	if setting.Region == "" || setting.Bucket == "" || setting.AccessKeyID == "" || setting.AccessKeySecret == "" {
		return nil, errors.New("S3 Region、Bucket 或访问密钥不完整")
	}
	httpClient := OutboundHTTPClient(timeout)
	config := aws.NewConfig().
		WithRegion(setting.Region).
		WithEndpoint(endpoint.String()).
		WithCredentials(credentials.NewStaticCredentials(setting.AccessKeyID, setting.AccessKeySecret, setting.SessionToken)).
		WithHTTPClient(httpClient).
		WithS3ForcePathStyle(setting.PathStyle || !standardAWSS3Endpoint(endpoint.String())).
		WithDisableSSL(endpoint.Scheme == "http")
	sess, err := session.NewSession(config)
	if err != nil {
		return nil, err
	}
	return awss3.New(sess), nil
}

func putS3Object(setting ossSettingValue, objectKey string, mimeType string, size int64, body io.Reader) (string, error) {
	client, err := newS3Client(setting, 2*time.Minute)
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

func getS3ObjectRange(setting ossSettingValue, objectKey string, rangeHeader string) (*ossObjectStream, error) {
	client, err := newS3Client(setting, 2*time.Minute)
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
			return &ossObjectStream{body: io.NopCloser(bytes.NewReader(nil)), statusCode: http.StatusRequestedRangeNotSatisfiable, acceptRanges: "bytes"}, nil
		}
		return nil, fmt.Errorf("S3 读取失败：%w", err)
	}
	status := http.StatusOK
	if rangeHeader != "" && aws.StringValue(output.ContentRange) != "" {
		status = http.StatusPartialContent
	}
	return &ossObjectStream{body: output.Body, statusCode: status, contentLength: aws.Int64Value(output.ContentLength), contentRange: aws.StringValue(output.ContentRange), acceptRanges: firstNonEmpty(aws.StringValue(output.AcceptRanges), "bytes")}, nil
}

func signedS3ObjectURL(setting ossSettingValue, objectKey string, expiresAt time.Time) (string, error) {
	client, err := newS3Client(setting, 2*time.Minute)
	if err != nil {
		return "", err
	}
	duration := time.Until(expiresAt)
	if duration <= 0 {
		return "", errors.New("S3 签名有效期必须晚于当前时间")
	}
	req, _ := client.GetObjectRequest(&awss3.GetObjectInput{Bucket: aws.String(setting.Bucket), Key: aws.String(strings.TrimLeft(objectKey, "/"))})
	value, err := req.Presign(duration)
	if err != nil {
		return "", fmt.Errorf("S3 下载地址签名失败：%w", err)
	}
	return value, nil
}

func deleteS3Object(setting ossSettingValue, objectKey string) error {
	client, err := newS3Client(setting, 2*time.Minute)
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
