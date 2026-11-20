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

// 官方地域形如 cn-beijing、ap-southeast-1；Region 会拼进主机名和签名作用域，不接受其他字符。
var volcengineTOSRegionPattern = regexp.MustCompile(`^[a-z0-9]+(?:-[a-z0-9]+)+$`)

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
	if !volcengineTOSRegionPattern.MatchString(region) {
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

// ValidateVolcengineTOSLocation 只接受官方域名，并拒绝 Region、Bucket 与域名不一致的配置。
// 自定义域名不放行：否则选「火山引擎 TOS」就能接入任意 S3 兼容服务，绕过管理员的个人 S3 开关和
// S3 必须先测通的约束；这类服务应选择 S3 兼容存储。只认官方域名也让历史资源总能从域名读出地域。
func ValidateVolcengineTOSLocation(setting Settings) error {
	setting = NormalizeSettings(setting)
	if setting.Region != "" && !volcengineTOSRegionPattern.MatchString(setting.Region) {
		return kernel.BadAuthRequest("火山引擎 TOS Region 格式不正确，例如 cn-beijing")
	}
	parsed, err := url.Parse(setting.Endpoint)
	if err != nil || parsed.Hostname() == "" {
		return kernel.BadAuthRequest("火山引擎 TOS Endpoint 格式不正确")
	}
	host, official := parseVolcengineTOSHost(parsed.Hostname())
	if !official {
		return kernel.BadAuthRequest("火山引擎 TOS 仅支持官方 Endpoint（tos-s3-<地域>.volces.com），其他服务请选择 S3 兼容存储")
	}
	if host.bucket != "" {
		return kernel.BadAuthRequest("火山引擎 TOS Endpoint 中的 Bucket 与配置不一致")
	}
	if setting.Region == "" {
		return kernel.BadAuthRequest("请填写火山引擎 TOS Region")
	}
	if host.region != setting.Region {
		return kernel.BadAuthRequest("火山引擎 TOS Region 与 Endpoint 地域不一致")
	}
	return nil
}

// VolcengineTOSRegionFromEndpoint 从官方域名读出地域。资源只记录 Endpoint 和 Bucket；平台配置换了地域后，
// 历史资源必须按自己域名里的地域签名，否则读取、预签名和删除都会失败。
func VolcengineTOSRegionFromEndpoint(endpoint string) (string, bool) {
	if !strings.Contains(endpoint, "://") {
		endpoint = "https://" + endpoint
	}
	parsed, err := url.Parse(endpoint)
	if err != nil {
		return "", false
	}
	host, ok := parseVolcengineTOSHost(parsed.Hostname())
	if !ok || !volcengineTOSRegionPattern.MatchString(host.region) {
		return "", false
	}
	return host.region, true
}

// volcengineTOSInternalEndpoint 判断是否为火山引擎内网域名（ivolces.com），浏览器无法直连。
func volcengineTOSInternalEndpoint(endpoint string) bool {
	parsed, err := url.Parse(endpoint)
	if err != nil {
		return false
	}
	host, ok := parseVolcengineTOSHost(parsed.Hostname())
	return ok && host.domain == "ivolces.com"
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
