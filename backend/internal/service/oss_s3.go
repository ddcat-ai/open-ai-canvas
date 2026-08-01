package service

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"sort"
	"strconv"
	"strings"
	"time"
)

const (
	ossProviderAliyun = "aliyun"
	ossProviderS3     = "s3"
	awsSignAlgorithm  = "AWS4-HMAC-SHA256"
	awsServiceS3      = "s3"
)

func isSupportedOSSProvider(provider string) bool {
	switch strings.TrimSpace(provider) {
	case ossProviderAliyun, ossProviderS3:
		return true
	default:
		return false
	}
}

func s3Region(setting ossSettingValue) string {
	region := strings.TrimSpace(setting.Region)
	if region == "" {
		return "auto"
	}
	return region
}

func s3UsePathStyle(setting ossSettingValue) bool {
	if setting.Provider != ossProviderS3 {
		return false
	}
	host := strings.ToLower(strings.TrimSpace(setting.Endpoint))
	if strings.Contains(host, "r2.cloudflarestorage.com") || strings.Contains(host, "localhost") || strings.Contains(host, "127.0.0.1") {
		return true
	}
	// Custom S3-compatible endpoints are safer with path-style addressing.
	return !strings.Contains(host, "amazonaws.com")
}

func s3BucketURL(setting ossSettingValue, objectKey string) (*url.URL, error) {
	endpoint := strings.TrimRight(strings.TrimSpace(setting.Endpoint), "/")
	if endpoint == "" {
		return nil, errors.New("S3 Endpoint 为空")
	}
	if !strings.Contains(endpoint, "://") {
		endpoint = "https://" + endpoint
	}
	parsed, err := url.Parse(endpoint)
	if err != nil {
		return nil, err
	}
	if parsed.Host == "" {
		return nil, errors.New("S3 Endpoint 格式不正确")
	}
	objectKey = strings.TrimLeft(strings.TrimSpace(objectKey), "/")
	if s3UsePathStyle(setting) {
		parsed.Path = strings.TrimRight(parsed.Path, "/") + "/" + setting.Bucket
		if objectKey != "" {
			parsed.Path += "/" + escapeObjectKey(objectKey)
		}
		return parsed, nil
	}
	if !strings.HasPrefix(parsed.Host, setting.Bucket+".") {
		parsed.Host = setting.Bucket + "." + parsed.Host
	}
	if objectKey != "" {
		parsed.Path = strings.TrimRight(parsed.Path, "/") + "/" + escapeObjectKey(objectKey)
	}
	return parsed, nil
}

func s3CanonicalURI(setting ossSettingValue, objectKey string) string {
	objectKey = strings.TrimLeft(strings.TrimSpace(objectKey), "/")
	if s3UsePathStyle(setting) {
		if objectKey == "" {
			return "/" + setting.Bucket
		}
		return "/" + setting.Bucket + "/" + escapeObjectKey(objectKey)
	}
	if objectKey == "" {
		return "/"
	}
	return "/" + escapeObjectKey(objectKey)
}

func putS3Object(setting ossSettingValue, objectKey string, mimeType string, size int64, body io.Reader) (string, error) {
	if mimeType == "" {
		mimeType = "application/octet-stream"
	}
	req, err := newS3Request(http.MethodPut, setting, objectKey, mimeType, body, nil)
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
		return "", fmt.Errorf("S3 上传失败：%s %s", resp.Status, strings.TrimSpace(string(detail)))
	}
	return strings.Trim(resp.Header.Get("ETag"), `"`), nil
}

func getS3ObjectRange(setting ossSettingValue, objectKey string, rangeHeader string) (*ossObjectStream, error) {
	headers := map[string]string{}
	if rangeHeader != "" {
		headers["Range"] = rangeHeader
	}
	req, err := newS3Request(http.MethodGet, setting, objectKey, "", nil, headers)
	if err != nil {
		return nil, err
	}
	resp, err := OutboundHTTPClient(2 * time.Minute).Do(req)
	if err != nil {
		return nil, err
	}
	if (resp.StatusCode < 200 || resp.StatusCode >= 300) && resp.StatusCode != http.StatusRequestedRangeNotSatisfiable {
		defer resp.Body.Close()
		detail, _ := io.ReadAll(io.LimitReader(resp.Body, 512))
		return nil, fmt.Errorf("S3 读取失败：%s %s", resp.Status, strings.TrimSpace(string(detail)))
	}
	return &ossObjectStream{body: resp.Body, statusCode: resp.StatusCode, contentLength: resp.ContentLength, contentRange: resp.Header.Get("Content-Range"), acceptRanges: firstNonEmpty(resp.Header.Get("Accept-Ranges"), "bytes")}, nil
}

func signedS3ObjectURL(setting ossSettingValue, objectKey string, expiresAt time.Time) (string, error) {
	if strings.TrimSpace(setting.AccessKeyID) == "" || strings.TrimSpace(setting.AccessKeySecret) == "" {
		return "", errors.New("S3 访问密钥不可用")
	}
	objectKey = strings.TrimLeft(strings.TrimSpace(objectKey), "/")
	if objectKey == "" {
		return "", errors.New("S3 对象路径为空")
	}
	now := time.Now().UTC()
	if expiresAt.Before(now) {
		return "", errors.New("S3 签名过期时间无效")
	}
	expires := int(expiresAt.Sub(now).Seconds())
	if expires < 1 {
		expires = 1
	}
	if expires > 7*24*3600 {
		expires = 7 * 24 * 3600
	}
	baseURL, err := s3BucketURL(setting, objectKey)
	if err != nil {
		return "", err
	}
	amzDate := now.Format("20060102T150405Z")
	dateStamp := now.Format("20060102")
	region := s3Region(setting)
	credentialScope := dateStamp + "/" + region + "/" + awsServiceS3 + "/aws4_request"
	credential := setting.AccessKeyID + "/" + credentialScope
	query := url.Values{}
	query.Set("X-Amz-Algorithm", awsSignAlgorithm)
	query.Set("X-Amz-Credential", credential)
	query.Set("X-Amz-Date", amzDate)
	query.Set("X-Amz-Expires", strconv.Itoa(expires))
	query.Set("X-Amz-SignedHeaders", "host")
	canonicalQuery := canonicalQueryString(query)
	canonicalHeaders := "host:" + strings.ToLower(baseURL.Host) + "\n"
	payloadHash := "UNSIGNED-PAYLOAD"
	canonicalRequest := strings.Join([]string{
		http.MethodGet,
		s3CanonicalURI(setting, objectKey),
		canonicalQuery,
		canonicalHeaders,
		"host",
		payloadHash,
	}, "\n")
	stringToSign := strings.Join([]string{
		awsSignAlgorithm,
		amzDate,
		credentialScope,
		sha256Hex([]byte(canonicalRequest)),
	}, "\n")
	signature := hex.EncodeToString(signAWS4(setting.AccessKeySecret, dateStamp, region, awsServiceS3, stringToSign))
	query.Set("X-Amz-Signature", signature)
	baseURL.RawQuery = query.Encode()
	return baseURL.String(), nil
}

func newS3Request(method string, setting ossSettingValue, objectKey string, contentType string, body io.Reader, extraHeaders map[string]string) (*http.Request, error) {
	baseURL, err := s3BucketURL(setting, objectKey)
	if err != nil {
		return nil, err
	}
	req, err := http.NewRequest(method, baseURL.String(), body)
	if err != nil {
		return nil, err
	}
	now := time.Now().UTC()
	amzDate := now.Format("20060102T150405Z")
	dateStamp := now.Format("20060102")
	region := s3Region(setting)
	payloadHash := "UNSIGNED-PAYLOAD"
	req.Header.Set("Host", baseURL.Host)
	req.Header.Set("X-Amz-Date", amzDate)
	req.Header.Set("X-Amz-Content-Sha256", payloadHash)
	if contentType != "" {
		req.Header.Set("Content-Type", contentType)
	}
	for key, value := range extraHeaders {
		req.Header.Set(key, value)
	}

	signedHeaderNames, canonicalHeaders := canonicalHeadersFromRequest(req)
	canonicalRequest := strings.Join([]string{
		method,
		s3CanonicalURI(setting, objectKey),
		"", // no query for direct authenticated requests
		canonicalHeaders,
		strings.Join(signedHeaderNames, ";"),
		payloadHash,
	}, "\n")
	credentialScope := dateStamp + "/" + region + "/" + awsServiceS3 + "/aws4_request"
	stringToSign := strings.Join([]string{
		awsSignAlgorithm,
		amzDate,
		credentialScope,
		sha256Hex([]byte(canonicalRequest)),
	}, "\n")
	signature := hex.EncodeToString(signAWS4(setting.AccessKeySecret, dateStamp, region, awsServiceS3, stringToSign))
	req.Header.Set("Authorization", fmt.Sprintf("%s Credential=%s/%s, SignedHeaders=%s, Signature=%s",
		awsSignAlgorithm,
		setting.AccessKeyID,
		credentialScope,
		strings.Join(signedHeaderNames, ";"),
		signature,
	))
	return req, nil
}

func canonicalHeadersFromRequest(req *http.Request) ([]string, string) {
	headers := map[string]string{}
	for key, values := range req.Header {
		lower := strings.ToLower(key)
		if lower == "authorization" {
			continue
		}
		headers[lower] = strings.TrimSpace(strings.Join(values, ","))
	}
	if host := strings.TrimSpace(req.Host); host != "" {
		headers["host"] = strings.ToLower(host)
	} else if req.URL != nil {
		headers["host"] = strings.ToLower(req.URL.Host)
	}
	names := make([]string, 0, len(headers))
	for name := range headers {
		names = append(names, name)
	}
	sort.Strings(names)
	var builder strings.Builder
	for _, name := range names {
		builder.WriteString(name)
		builder.WriteByte(':')
		builder.WriteString(headers[name])
		builder.WriteByte('\n')
	}
	return names, builder.String()
}

func canonicalQueryString(values url.Values) string {
	if len(values) == 0 {
		return ""
	}
	keys := make([]string, 0, len(values))
	for key := range values {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	parts := make([]string, 0, len(keys))
	for _, key := range keys {
		items := append([]string{}, values[key]...)
		sort.Strings(items)
		encodedKey := s3QueryEscape(key)
		for _, item := range items {
			parts = append(parts, encodedKey+"="+s3QueryEscape(item))
		}
	}
	return strings.Join(parts, "&")
}

func s3QueryEscape(value string) string {
	return strings.ReplaceAll(url.QueryEscape(value), "+", "%20")
}

func sha256Hex(data []byte) string {
	sum := sha256.Sum256(data)
	return hex.EncodeToString(sum[:])
}

func signAWS4(secret, dateStamp, region, service, stringToSign string) []byte {
	kDate := hmacSHA256([]byte("AWS4"+secret), dateStamp)
	kRegion := hmacSHA256(kDate, region)
	kService := hmacSHA256(kRegion, service)
	kSigning := hmacSHA256(kService, "aws4_request")
	return hmacSHA256(kSigning, stringToSign)
}

func hmacSHA256(key []byte, data string) []byte {
	mac := hmac.New(sha256.New, key)
	_, _ = mac.Write([]byte(data))
	return mac.Sum(nil)
}
