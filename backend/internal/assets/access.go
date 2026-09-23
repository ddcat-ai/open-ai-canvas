package assets

import (
	"net/http"
	"time"

	"infinite-canvas/backend/internal/kernel"
	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/storage"
)

type AccessPurpose string
type ResourceVariant string
type DeliveryMode string

const (
	PurposeDisplay  AccessPurpose   = "display"
	PurposeCopy     AccessPurpose   = "copy"
	PurposeDownload AccessPurpose   = "download"
	PurposeProcess  AccessPurpose   = "browser-process"
	PurposeProvider AccessPurpose   = "provider-input"
	VariantOriginal ResourceVariant = "original"
	VariantPlayback ResourceVariant = "playback"
	DeliveryCDN     DeliveryMode    = "cdn"
	DeliveryOrigin  DeliveryMode    = "origin"
	DeliveryLocal   DeliveryMode    = "platform-local"
	DeliveryProxy   DeliveryMode    = "platform-proxy"
)

// AccessOptions contains use intent, never a client-controlled authorization or transport override.
type AccessOptions struct {
	Purpose      AccessPurpose   `json:"purpose"`
	Variant      ResourceVariant `json:"variant"`
	DownloadName string          `json:"downloadName,omitempty"`
	ExpiresAt    time.Time       `json:"-"`
	DescribeOnly bool            `json:"-"`
}

type AccessRequest struct {
	ResourceID string `json:"resourceId"`
	AccessOptions
}

type ResourceAccess struct {
	ResourceID       string          `json:"resourceId"`
	RequestedVariant ResourceVariant `json:"requestedVariant"`
	ActualVariant    ResourceVariant `json:"actualVariant"`
	URL              string          `json:"url"`
	Delivery         DeliveryMode    `json:"delivery"`
	IssuedAt         time.Time       `json:"issuedAt"`
	ExpiresAt        *time.Time      `json:"expiresAt"`
	RefreshAt        time.Time       `json:"refreshAt"`
	Revision         string          `json:"revision"`
	FallbackReason   string          `json:"fallbackReason,omitempty"`
}

func AccessError(status int, reason, message string) *kernel.AppError {
	err := kernel.NewAppError(status, message)
	err.Reason = kernel.ErrorReason(reason)
	return err
}

func NormalizeAccessOptions(options AccessOptions, allowProvider bool) (AccessOptions, error) {
	if options.Purpose == "" {
		options.Purpose = PurposeDisplay
	}
	if options.Variant == "" {
		options.Variant = VariantOriginal
	}
	switch options.Purpose {
	case PurposeDisplay, PurposeCopy, PurposeDownload, PurposeProcess:
	case PurposeProvider:
		if !allowProvider {
			return options, kernel.Forbidden("不允许请求模型输入凭据")
		}
	default:
		return options, kernel.BadAuthRequest("资源访问用途无效")
	}
	if options.Variant != VariantOriginal && options.Variant != VariantPlayback {
		return options, kernel.BadAuthRequest("资源变体无效")
	}
	if options.Purpose == PurposeCopy || options.Purpose == PurposeDownload || options.Purpose == PurposeProvider {
		options.Variant = VariantOriginal
	}
	if options.Purpose != PurposeDownload {
		options.DownloadName = ""
	}
	return options, nil
}

// ResolveAccess is the sole delivery policy. The caller must authorize resource ownership/scene first.
// Local URL signing is injected by the composition root; storage adapters never know application keys.
func ResolveAccess(resource *model.Resource, setting storage.Settings, options AccessOptions, now time.Time,
	platformURL func(ResourceVariant, time.Time) (string, error)) (*ResourceAccess, error) {
	options, err := NormalizeAccessOptions(options, true)
	if err != nil {
		return nil, err
	}
	if resource == nil {
		return nil, kernel.NotFound("资源不存在")
	}
	if resource.Status != model.ResourceStatusReady {
		return nil, AccessError(http.StatusConflict, "resource_not_ready", "资源尚未上传完成")
	}
	ttl := 5 * time.Minute
	if options.Purpose == PurposeProvider {
		ttl = 4 * time.Hour
	}
	expires := now.Add(ttl)
	if !options.ExpiresAt.IsZero() && options.ExpiresAt.Before(expires) {
		expires = options.ExpiresAt
	}
	if !expires.After(now) {
		return nil, kernel.Forbidden("资源授权已过期")
	}
	access := &ResourceAccess{ResourceID: resource.ID, RequestedVariant: options.Variant, ActualVariant: VariantOriginal,
		IssuedAt: now, ExpiresAt: &expires, RefreshAt: now.Add(expires.Sub(now) * 4 / 5), Revision: resource.ETag + ":" + resource.PlaybackStatus + ":" + storage.DeliveryRevision(setting)}
	if options.Variant == VariantPlayback {
		if resource.Provider == "local" && resource.PlaybackStatus == model.PlaybackStatusReady && resource.PlaybackObjectKey != "" {
			access.ActualVariant = VariantPlayback
		} else {
			access.FallbackReason = "playback_not_ready"
		}
	}
	if resource.Provider == "local" {
		access.Delivery = DeliveryLocal
	} else if options.Purpose == PurposeDownload {
		// Cross-origin `a[download]` is only advisory. A real browser download must
		// therefore be enforced by the object store response itself. Downloads use
		// a signed origin URL carrying Content-Disposition=attachment; media bytes
		// never pass through the application server or a Blob relay.
		if !storage.PublicOrigin(setting) {
			return nil, AccessError(503, "resource_origin_private", "对象存储源站不可由浏览器直连，无法在不占用服务器带宽的前提下下载")
		}
		access.URL, err = storage.SignedOriginObjectDownloadURL(setting, resource.ObjectKey, expires, options.DownloadName)
		access.Delivery = DeliveryOrigin
	} else if storage.CDNEnabled(setting) {
		access.URL, err = storage.SignCDNURL(setting, resource.ObjectKey, expires)
		access.Delivery = DeliveryCDN
		if setting.Delivery.CDNAuthMode == "public" {
			access.ExpiresAt = nil
		}
	} else if setting.Delivery.RequireCDN {
		return nil, AccessError(503, "resource_cdn_unconfigured", "CDN 访问鉴权未配置，请检查存储分发设置")
	} else if storage.PublicOrigin(setting) {
		access.URL, err = storage.SignedOriginObjectURL(setting, resource.ObjectKey, expires)
		access.Delivery = DeliveryOrigin
		if setting.CDNBaseURL != "" {
			access.FallbackReason = "cdn_auth_unconfigured"
		}
	} else if options.Purpose == PurposeProvider && setting.Delivery.AllowPrivateProxy {
		// Only the server-side provider-input path may opt into a private-origin
		// proxy. Browser display/copy/process/download traffic for OSS resources
		// must never relay media bytes through the application server.
		access.Delivery = DeliveryProxy
		access.FallbackReason = "private_origin"
	} else {
		return nil, AccessError(503, "resource_origin_private", "对象存储源站不可由浏览器直连，请配置公网 OSS 源站或 CDN")
	}
	if err != nil {
		failure := AccessError(503, "resource_signing_failed", "资源访问地址签发失败，请检查存储分发设置")
		failure.Cause = err
		return nil, failure
	}
	if access.Delivery == DeliveryLocal || access.Delivery == DeliveryProxy {
		access.URL, err = platformURL(access.ActualVariant, expires)
		if err != nil {
			return nil, err
		}
	}
	return access, nil
}
