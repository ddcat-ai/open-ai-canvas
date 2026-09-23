package storage

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"time"
)

// DeliverySettings is independent from origin credentials. Public CDN access must be an explicit choice.
type DeliverySettings struct {
	CDNAuthMode       string `json:"cdnAuthMode"`
	RequireCDN        bool   `json:"requireCDN"`
	AllowPrivateProxy bool   `json:"allowPrivateProxy"`
}

func CDNEnabled(setting Settings) bool {
	if setting.CDNBaseURL == "" {
		return false
	}
	return setting.Delivery.CDNAuthMode == "public" || setting.Delivery.CDNAuthMode == "qiniu"
}

func SignCDNURL(setting Settings, objectKey string, expires time.Time) (string, error) {
	switch setting.Delivery.CDNAuthMode {
	case "public":
		return OssCDNObjectURL(setting.CDNBaseURL, objectKey)
	case "qiniu":
		if setting.Provider == qiniuKodoProvider {
			return SignedQiniuObjectURL(setting, objectKey, expires)
		}
	}
	return "", errors.New("CDN 用户访问鉴权方式未配置或不支持")
}

func PublicOrigin(setting Settings) bool {
	if setting.Provider == qiniuKodoProvider {
		return true
	} // The SDK signs the public Kodo S3 origin, not its upload endpoint.
	return PublicHTTPSStorageEndpoint(setting.Endpoint)
}

func DeliveryRevision(setting Settings) string {
	// Only a digest leaves the server; changes to credentials/configuration invalidate descriptors.
	data, _ := json.Marshal(setting)
	sum := sha256.Sum256(data)
	return hex.EncodeToString(sum[:8])
}
