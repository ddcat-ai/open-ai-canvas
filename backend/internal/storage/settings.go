package storage

import (
	"strings"
	"time"
)

const (
	aliyunOSSProvider    = "aliyun"
	tencentCOSProvider   = "tencent"
	qiniuKodoProvider    = "qiniu"
	s3Provider           = "s3"
	defaultOSSPathPrefix = "open-ai-canvas"
	resourceAccessURLTTL = 5 * time.Minute
)

type Settings struct {
	Delivery          DeliverySettings `json:"delivery"`
	Enabled           bool             `json:"enabled"`
	Provider          string           `json:"provider"`
	Region            string           `json:"region"`
	Endpoint          string           `json:"endpoint"`
	CDNBaseURL        string           `json:"cdnBaseUrl"`
	Bucket            string           `json:"bucket"`
	AccessKeyID       string           `json:"accessKeyId"`
	AccessKeySecret   string           `json:"accessKeySecret"`
	PublicBaseURL     string           `json:"publicBaseUrl"`
	PathPrefix        string           `json:"pathPrefix"`
	S3Preset          string           `json:"s3Preset"`
	PathStyle         bool             `json:"pathStyle"`
	SessionToken      string           `json:"sessionToken"`
	StorageLocationID string           `json:"storageLocationId"`
	AllowUserS3       bool             `json:"allowUserS3"`
	// 平台切换云厂商后仍需读取历史资源，因此仅归档非当前厂商的访问密钥。
	ArchivedCredentials map[string]Credentials `json:"archivedCredentials,omitempty"`
}

type Credentials struct {
	AccessKeyID     string `json:"accessKeyId"`
	AccessKeySecret string `json:"accessKeySecret"`
}

func CloneCredentials(source map[string]Credentials) map[string]Credentials {
	if len(source) == 0 {
		return nil
	}
	cloned := make(map[string]Credentials, len(source))
	for provider, credentials := range source {
		cloned[strings.ToLower(strings.TrimSpace(provider))] = Credentials{
			AccessKeyID:     strings.TrimSpace(credentials.AccessKeyID),
			AccessKeySecret: strings.TrimSpace(credentials.AccessKeySecret),
		}
	}
	return cloned
}

func NormalizeSettings(value Settings) Settings {
	value.Provider = strings.ToLower(strings.TrimSpace(value.Provider))
	if value.Provider == "" {
		value.Provider = aliyunOSSProvider
	}
	value.Region = strings.TrimSpace(value.Region)
	value.Endpoint = strings.TrimRight(strings.TrimSpace(value.Endpoint), "/")
	if value.Provider == tencentCOSProvider && value.Endpoint == "" && value.Region != "" {
		value.Endpoint = "https://cos." + value.Region + ".myqcloud.com"
	}
	value.CDNBaseURL = strings.TrimRight(strings.TrimSpace(value.CDNBaseURL), "/")
	value.Delivery.CDNAuthMode = strings.ToLower(strings.TrimSpace(value.Delivery.CDNAuthMode))
	value.Bucket = strings.TrimSpace(value.Bucket)
	value.AccessKeyID = strings.TrimSpace(value.AccessKeyID)
	value.AccessKeySecret = strings.TrimSpace(value.AccessKeySecret)
	value.PublicBaseURL = strings.TrimRight(strings.TrimSpace(value.PublicBaseURL), "/")
	value.PathPrefix = strings.Trim(strings.TrimSpace(value.PathPrefix), "/")
	if value.PathPrefix == "" {
		value.PathPrefix = defaultOSSPathPrefix
	}
	value.S3Preset = strings.ToLower(strings.TrimSpace(value.S3Preset))
	if value.S3Preset == "" {
		value.S3Preset = "custom"
	}
	value.SessionToken = strings.TrimSpace(value.SessionToken)
	value.StorageLocationID = strings.TrimSpace(value.StorageLocationID)
	value.ArchivedCredentials = CloneCredentials(value.ArchivedCredentials)
	return value
}
