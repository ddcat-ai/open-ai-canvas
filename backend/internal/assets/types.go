package assets

import (
	"io"

	"yingce/backend/internal/model"
)

type ResourceStream struct {
	Resource      *model.Resource
	Body          io.ReadCloser
	StatusCode    int
	ContentLength int64
	ContentRange  string
	AcceptRanges  string
}

type ResourceDelivery struct {
	Resource *model.Resource
	Stream   *ResourceStream
	Access   *ResourceAccess
	// ColdFallback 在分发地址指向 CDN/Origin 时提供「读本地冷备」的能力。
	// HTTP 层只有在请求方显式声明需要兜底（X-Canvas-Cold-Fallback: 1）
	// 且探测到 CDN 不可用时才会调用，正常 302 路径不受影响。
	ColdFallback func(rangeHeader string) (*ResourceStream, error)
}
