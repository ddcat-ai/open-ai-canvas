package storage

import (
	"context"
	"errors"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/aws/aws-sdk-go/aws"
	awss3 "github.com/aws/aws-sdk-go/service/s3"
)

type ObjectUpload struct {
	URL     string            `json:"url"`
	Method  string            `json:"method"`
	Headers map[string]string `json:"headers"`
}

func SignedS3ObjectUpload(setting Settings, objectKey, mimeType string, size int64, expiresAt time.Time) (*ObjectUpload, error) {
	if size <= 0 || !expiresAt.After(time.Now()) {
		return nil, errors.New("上传大小或签名有效期无效")
	}
	client, err := NewS3Client(setting, transferTimeout(setting))
	if err != nil {
		return nil, err
	}
	request, _ := client.PutObjectRequest(&awss3.PutObjectInput{
		Bucket: aws.String(setting.Bucket), Key: aws.String(strings.TrimLeft(objectKey, "/")),
		ContentType: aws.String(mimeType), ContentLength: aws.Int64(size),
	})
	request.HTTPRequest.Header.Set("If-None-Match", "*")
	value, headers, err := request.PresignRequest(time.Until(expiresAt))
	if err != nil {
		return nil, err
	}
	result := &ObjectUpload{URL: value, Method: http.MethodPut, Headers: map[string]string{}}
	for key, values := range headers {
		// 浏览器根据 Blob 自动设置这两个受限请求头。
		if strings.EqualFold(key, "Host") || strings.EqualFold(key, "Content-Length") {
			continue
		}
		result.Headers[http.CanonicalHeaderKey(key)] = strings.Join(values, ",")
	}
	return result, nil
}

// InspectS3Upload only reads metadata and a bounded prefix, never relays the whole upload.
func InspectS3Upload(setting Settings, objectKey string) (int64, string, []byte, error) {
	client, err := NewS3Client(setting, transferTimeout(setting))
	if err != nil {
		return 0, "", nil, err
	}
	object, err := client.GetObjectWithContext(context.Background(), &awss3.GetObjectInput{
		Bucket: aws.String(setting.Bucket), Key: aws.String(objectKey), Range: aws.String("bytes=0-8191"),
	})
	if err != nil {
		return 0, "", nil, err
	}
	defer object.Body.Close()
	size := aws.Int64Value(object.ContentLength)
	if contentRange := aws.StringValue(object.ContentRange); contentRange != "" {
		_, total, found := strings.Cut(contentRange, "/")
		var parseErr error
		size, parseErr = strconv.ParseInt(total, 10, 64)
		if !found || parseErr != nil || size <= 0 || !strings.HasPrefix(contentRange, "bytes 0-") {
			return 0, "", nil, errors.New("对象存储未返回有效的完整文件大小")
		}
	}
	data, err := io.ReadAll(io.LimitReader(object.Body, 8192))
	return size, strings.Trim(aws.StringValue(object.ETag), `"`), data, err
}
