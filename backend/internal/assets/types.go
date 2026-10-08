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
}
