package storage

import (
	"context"
	"errors"
	"net"
	"net/http"
	"net/url"
	"strings"
	"time"

	"yingce/backend/internal/outbound"

	"github.com/aws/aws-sdk-go/aws"
	"github.com/aws/aws-sdk-go/aws/credentials"
	"github.com/aws/aws-sdk-go/aws/session"
	awss3 "github.com/aws/aws-sdk-go/service/s3"
)

// HeadRainyunBucketContext 仅检查当前平台雨云桶是否接受 HEAD，不上传、列举或读取对象。
// 独立于连接测试和普通 S3 构造器，确保预解析 DNS 也受同一短预算约束。
func HeadRainyunBucketContext(ctx context.Context, setting Settings) (int, error) {
	return headRainyunBucketContext(ctx, setting, outbound.StorageHTTPClient(1500*time.Millisecond))
}

func headRainyunBucketContext(ctx context.Context, setting Settings, client *http.Client) (int, error) {
	ctx, cancel := context.WithTimeout(ctx, 1500*time.Millisecond)
	defer cancel()
	setting = NormalizeSettings(setting)
	if !setting.Enabled || setting.Provider != rainyunOSSProvider || setting.Bucket == "" || setting.AccessKeyID == "" || setting.AccessKeySecret == "" {
		return 0, errors.New("雨云源站 HEAD 配置不完整")
	}
	endpoint, err := rainyunMonitorEndpoint(ctx, setting.Endpoint)
	if err != nil {
		return 0, err
	}
	config := aws.NewConfig().
		WithRegion(setting.Region).
		WithEndpoint(endpoint.String()).
		WithCredentials(credentials.NewStaticCredentials(setting.AccessKeyID, setting.AccessKeySecret, setting.SessionToken)).
		WithS3ForcePathStyle(true).
		WithDisableSSL(endpoint.Scheme == "http").
		WithMaxRetries(0)
	sess, err := session.NewSession(config)
	if err != nil {
		return 0, errors.New("雨云源站 HEAD 签名配置无效")
	}
	request, _ := awss3.New(sess).HeadBucketRequest(&awss3.HeadBucketInput{Bucket: aws.String(setting.Bucket)})
	request.SetContext(ctx)
	value, headers, err := request.PresignRequest(time.Minute)
	if err != nil {
		return 0, errors.New("雨云源站 HEAD 签名失败")
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodHead, value, nil)
	if err != nil {
		return 0, errors.New("雨云源站 HEAD 请求无效")
	}
	for name, values := range headers {
		req.Header[name] = append([]string(nil), values...)
	}
	outbound.ApplyDefaultOutboundHeaders(req)
	probe := *client
	probe.Timeout = 1500 * time.Millisecond
	// 禁止把签名 URL 或访问凭据带往重定向目的地。
	probe.CheckRedirect = func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }
	resp, err := probe.Do(req)
	if err != nil {
		return 0, errors.New("雨云源站 HEAD 未成功或已超时")
	}
	defer resp.Body.Close()
	return resp.StatusCode, nil
}

func rainyunMonitorEndpoint(ctx context.Context, raw string) (*url.URL, error) {
	parsed, err := url.Parse(strings.TrimSpace(raw))
	if err != nil || parsed.Hostname() == "" || parsed.User != nil || parsed.RawQuery != "" || parsed.Fragment != "" || strings.Trim(parsed.Path, "/") != "" || parsed.Scheme != "https" && parsed.Scheme != "http" {
		return nil, errors.New("雨云源站 Endpoint 格式无效")
	}
	trusted := outbound.AllowedPrivateUpstreamHost(parsed.Hostname())
	if parsed.Scheme == "http" && !trusted {
		return nil, errors.New("雨云源站 HTTP 需要精确放行可信主机")
	}
	addresses, err := net.DefaultResolver.LookupIP(ctx, "ip", parsed.Hostname())
	if err != nil || len(addresses) == 0 {
		return nil, errors.New("雨云源站域名解析失败或已超时")
	}
	for _, ip := range addresses {
		if !trusted && (ip == nil || ip.IsLoopback() || ip.IsPrivate() || ip.IsLinkLocalMulticast() || ip.IsLinkLocalUnicast() || ip.IsUnspecified() || ip.IsMulticast()) {
			return nil, errors.New("雨云源站不允许访问本机、私网或链路本地地址")
		}
	}
	return parsed, nil
}
