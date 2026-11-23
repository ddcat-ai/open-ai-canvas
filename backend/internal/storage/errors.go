package storage

import (
	"context"
	"encoding/xml"
	"errors"
	"fmt"
	"net"
	"net/http"
	"net/url"
	"regexp"
	"strings"

	"github.com/aws/aws-sdk-go/aws/awserr"
	qiniuClient "github.com/qiniu/go-sdk/v7/client"
	"github.com/tencentyun/cos-go-sdk-v5"
)

// HTTPStatusError 是自签请求（阿里云 OSS）的非 2xx 响应。Error() 保持原有文案，
// 同时保留状态码和存储错误码，供重试判断和日志使用。
type HTTPStatusError struct {
	Provider   string
	StatusCode int
	Code       string
	Status     string
	Detail     string
}

func (e *HTTPStatusError) Error() string {
	return fmt.Sprintf("OSS 上传失败：%s %s", e.Status, e.Detail)
}

func newHTTPStatusError(provider string, response *http.Response, detail []byte) *HTTPStatusError {
	var body struct {
		Code string `xml:"Code"`
	}
	_ = xml.Unmarshal(detail, &body)
	return &HTTPStatusError{Provider: provider, StatusCode: response.StatusCode, Code: strings.TrimSpace(body.Code), Status: response.Status, Detail: strings.TrimSpace(string(detail))}
}

// Failure 是对象存储写入失败的机器可读摘要。Code 只含存储服务返回的错误码或固定
// 分类名，不含 URL、对象路径或凭据，可以直接写入请求日志。
type Failure struct {
	Code       string
	StatusCode int
	// Transient 表示服务端暂时不可用、限流或网络超时，稍后重试可能成功。
	// 鉴权、签名、Bucket 不存在等配置问题为 false，需要管理员处理。
	Transient bool
}

var safeStorageCode = regexp.MustCompile(`^[A-Za-z0-9._-]{1,64}$`)

func transientStatus(status int) bool {
	return status == http.StatusRequestTimeout || status == http.StatusTooManyRequests || status >= 500
}

func transientCode(code string) bool {
	switch code {
	case "SlowDown", "SlowDownWrite", "SlowDownRead", "RequestTimeout", "RequestTimeTooSkewed", "InternalError", "ServiceUnavailable", "Throttling", "ThrottlingException", "RequestError", "RequestCanceled", "XMinioServerNotInitialized":
		return true
	}
	return false
}

func sanitizeCode(code string) string {
	code = strings.TrimSpace(code)
	if !safeStorageCode.MatchString(code) {
		return ""
	}
	return code
}

// ClassifyError 识别各家存储 SDK 的写入错误。aws-sdk-go v1 的 awserr 不实现
// Unwrap，所以网络层原因要通过 OrigErr 逐层取出。
func ClassifyError(err error) Failure {
	if err == nil {
		return Failure{}
	}
	if errors.Is(err, errObjectReadChanged) {
		return Failure{Code: "ObjectChanged", StatusCode: http.StatusPreconditionFailed}
	}
	if errors.Is(err, context.DeadlineExceeded) {
		return Failure{Code: "Timeout", Transient: true}
	}
	if errors.Is(err, context.Canceled) {
		return Failure{Code: "Canceled"}
	}
	var requestFailure awserr.RequestFailure
	if errors.As(err, &requestFailure) {
		code := sanitizeCode(requestFailure.Code())
		status := requestFailure.StatusCode()
		return Failure{Code: code, StatusCode: status, Transient: transientStatus(status) || transientCode(code) || networkCause(requestFailure.OrigErr())}
	}
	var awsErr awserr.Error
	if errors.As(err, &awsErr) {
		code := sanitizeCode(awsErr.Code())
		if networkCause(awsErr.OrigErr()) {
			if timeoutCause(awsErr.OrigErr()) {
				return Failure{Code: "Timeout", Transient: true}
			}
			return Failure{Code: firstCode(code, "NetworkError"), Transient: true}
		}
		return Failure{Code: code, Transient: transientCode(code)}
	}
	var statusErr *HTTPStatusError
	if errors.As(err, &statusErr) {
		code := sanitizeCode(statusErr.Code)
		return Failure{Code: code, StatusCode: statusErr.StatusCode, Transient: transientStatus(statusErr.StatusCode) || transientCode(code)}
	}
	var cosErr *cos.ErrorResponse
	if errors.As(err, &cosErr) {
		status := 0
		if cosErr.Response != nil {
			status = cosErr.Response.StatusCode
		}
		code := sanitizeCode(cosErr.Code)
		return Failure{Code: code, StatusCode: status, Transient: transientStatus(status) || transientCode(code)}
	}
	var qiniuErr *qiniuClient.ErrorInfo
	if errors.As(err, &qiniuErr) {
		return Failure{Code: sanitizeCode(qiniuErr.ErrorCode), StatusCode: qiniuErr.Code, Transient: transientStatus(qiniuErr.Code)}
	}
	if timeoutCause(err) {
		return Failure{Code: "Timeout", Transient: true}
	}
	if networkCause(err) {
		return Failure{Code: "NetworkError", Transient: true}
	}
	return Failure{}
}

// Label 生成日志用的短标签，例如 SlowDownWrite/503。
func (f Failure) Label() string {
	switch {
	case f.Code != "" && f.StatusCode > 0:
		return fmt.Sprintf("%s/%d", f.Code, f.StatusCode)
	case f.Code != "":
		return f.Code
	case f.StatusCode > 0:
		return fmt.Sprintf("HTTP %d", f.StatusCode)
	}
	return ""
}

func firstCode(values ...string) string {
	for _, value := range values {
		if value != "" {
			return value
		}
	}
	return ""
}

func timeoutCause(err error) bool {
	for err != nil {
		var networkErr net.Error
		if errors.As(err, &networkErr) && networkErr.Timeout() {
			return true
		}
		if errors.Is(err, context.DeadlineExceeded) {
			return true
		}
		err = origErr(err)
	}
	return false
}

func networkCause(err error) bool {
	for err != nil {
		var networkErr net.Error
		var urlErr *url.Error
		if errors.As(err, &networkErr) || errors.As(err, &urlErr) || errors.Is(err, context.DeadlineExceeded) {
			return true
		}
		message := strings.ToLower(err.Error())
		for _, marker := range []string{"connection reset", "connection refused", "broken pipe", "unexpected eof", "tls handshake timeout", "no such host"} {
			if strings.Contains(message, marker) {
				return true
			}
		}
		err = origErr(err)
	}
	return false
}

func origErr(err error) error {
	var awsErr awserr.Error
	if errors.As(err, &awsErr) {
		if next := awsErr.OrigErr(); next != nil && next != error(awsErr) {
			return next
		}
	}
	return nil
}
