package storage

import (
	"net"
	"net/url"
	"regexp"
	"strings"

	"yingce/backend/internal/kernel"
)

// 火山引擎 TOS 通过官方 S3 兼容域名 tos-s3-<region>.volces.com 读写，复用 AWS SigV4 的
// 上传、Range 读取、预签名和删除实现，不引入单独的 TOS SDK。TOS 的 S3 兼容域名按
// virtual-hosted 方式访问 Bucket，因此不跟随通用 S3 对非 AWS Endpoint 的 path-style 默认值。
//
// 控制台概览优先展示原生域名 tos-<region>.volces.com 与 Bucket 域名；保存时把它们换算成同地域
// 的 S3 兼容域名，避免原生域名被当作 S3 Endpoint 导致签名失败。地域与域名见
// https://docs.volcengine.com/docs/6349/107356 。
var volcengineTOSHostPattern = regexp.MustCompile(`^(?:([a-z0-9][a-z0-9-]*)\.)?tos-(?:s3-)?([a-z0-9-]+)\.(volces\.com|ivolces\.com)$`)

type volcengineTOSHost struct {
	bucket string
	region string
	domain string
}

func parseVolcengineTOSHost(hostname string) (volcengineTOSHost, bool) {
	match := volcengineTOSHostPattern.FindStringSubmatch(strings.TrimSuffix(strings.ToLower(hostname), "."))
	if match == nil {
		return volcengineTOSHost{}, false
	}
	return volcengineTOSHost{bucket: match[1], region: match[2], domain: match[3]}, true
}

// VolcengineTOSS3Endpoint 返回指定地域的外网 S3 兼容 Endpoint。
func VolcengineTOSS3Endpoint(region string) string {
	region = strings.ToLower(strings.TrimSpace(region))
	if region == "" {
		return ""
	}
	return "https://tos-s3-" + region + ".volces.com"
}

// normalizeVolcengineTOSLocation 只改写可以确定的官方域名：Region 生成 Endpoint，原生或
// Bucket 域名换成 S3 兼容服务根地址，Region 为空时从官方域名取得。Bucket 与域名不一致或
// 自定义域名保持原值，交由 ValidateVolcengineTOSLocation 和通用 Endpoint 校验拒绝。
func normalizeVolcengineTOSLocation(value Settings) Settings {
	value.Region = strings.ToLower(value.Region)
	if value.Endpoint == "" {
		value.Endpoint = VolcengineTOSS3Endpoint(value.Region)
		return value
	}
	if !strings.Contains(value.Endpoint, "://") {
		value.Endpoint = "https://" + value.Endpoint
	}
	parsed, err := url.Parse(value.Endpoint)
	if err != nil {
		return value
	}
	host, ok := parseVolcengineTOSHost(parsed.Hostname())
	if !ok || (host.bucket != "" && host.bucket != strings.ToLower(value.Bucket)) {
		return value
	}
	if value.Region == "" {
		value.Region = host.region
	}
	hostname := "tos-s3-" + host.region + "." + host.domain
	if port := parsed.Port(); port != "" {
		hostname = net.JoinHostPort(hostname, port)
	}
	parsed.Host = hostname
	value.Endpoint = strings.TrimRight(parsed.String(), "/")
	return value
}

// ValidateVolcengineTOSLocation 拒绝 Region、Bucket 与官方域名不一致的火山引擎 TOS 配置。
// 非官方域名（如 PrivateLink 自定义解析）只要求填写 Region，其余由 ValidateStorageEndpoint 校验。
func ValidateVolcengineTOSLocation(setting Settings) error {
	setting = NormalizeSettings(setting)
	parsed, err := url.Parse(setting.Endpoint)
	if err != nil || parsed.Hostname() == "" {
		return kernel.BadAuthRequest("火山引擎 TOS Endpoint 格式不正确")
	}
	host, official := parseVolcengineTOSHost(parsed.Hostname())
	if official && host.bucket != "" {
		return kernel.BadAuthRequest("火山引擎 TOS Endpoint 中的 Bucket 与配置不一致")
	}
	if setting.Region == "" {
		return kernel.BadAuthRequest("请填写火山引擎 TOS Region")
	}
	if official && host.region != setting.Region {
		return kernel.BadAuthRequest("火山引擎 TOS Region 与 Endpoint 地域不一致")
	}
	return nil
}

func usesS3Protocol(provider string) bool {
	return provider == s3Provider || provider == volcengineTOSProvider
}

func s3ServiceName(setting Settings) string {
	if setting.Provider == volcengineTOSProvider {
		return "火山引擎 TOS"
	}
	return "S3"
}
