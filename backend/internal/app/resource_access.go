package app

import (
	"errors"
	"net/url"
	"strconv"
	"time"

	"gorm.io/gorm"
	"infinite-canvas/backend/internal/assets"
	"infinite-canvas/backend/internal/model"
)

type ResourceAccessOptions = assets.AccessOptions
type ResourceAccessRequest = assets.AccessRequest
type ResourceAccess = assets.ResourceAccess

type ResourceAccessFailure struct {
	Code    int    `json:"code"`
	Reason  string `json:"reason"`
	Message string `json:"msg"`
}
type ResourceAccessResult struct {
	ResourceID string                 `json:"resourceId"`
	Access     *ResourceAccess        `json:"access,omitempty"`
	Error      *ResourceAccessFailure `json:"error,omitempty"`
}

func (s *Service) ResourceAccessBatch(userID string, requests []ResourceAccessRequest) ([]ResourceAccessResult, error) {
	if userID == "" {
		return nil, Unauthorized("请先登录")
	}
	if len(requests) == 0 || len(requests) > 100 {
		return nil, BadAuthRequest("每批资源访问请求须为 1–100 项")
	}
	results := make([]ResourceAccessResult, 0, len(requests))
	for _, request := range requests {
		item := ResourceAccessResult{ResourceID: request.ResourceID}
		// The caller has already been authenticated and each item is resolved through
		// ResourceForUser below. Provider input is therefore safe to expose here and
		// keeps browser-side model adapters on the same access contract as every
		// other resource consumer.
		options, err := assets.NormalizeAccessOptions(request.AccessOptions, true)
		if err == nil {
			var resource *model.Resource
			resource, err = s.repo.ResourceForUser(userID, request.ResourceID)
			if errors.Is(err, gorm.ErrRecordNotFound) {
				err = NotFound("资源不存在或不可访问")
			}
			if err == nil {
				item.Access, err = s.resolveResourceAccess(resource, options)
			}
		}
		if err != nil {
			item.Error = &ResourceAccessFailure{Code: 500, Reason: "resource_access_failed", Message: "资源访问失败"}
			var appErr *AppError
			if errors.As(err, &appErr) {
				item.Error = &ResourceAccessFailure{Code: appErr.Code, Reason: string(appErr.Reason), Message: appErr.Message}
			}
		}
		results = append(results, item)
	}
	return results, nil
}

func (s *Service) resolveResourceAccess(resource *model.Resource, options ResourceAccessOptions) (*ResourceAccess, error) {
	if resource == nil {
		return nil, NotFound("资源不存在")
	}
	var setting ossSettingValue
	if resource.Provider != "local" {
		var err error
		setting, err = s.ossSettingForResource(resource.UserID, resource)
		if err != nil {
			return nil, WrapAppError(503, "无法解析资源实际存储位置", err)
		}
	}
	return assets.ResolveAccess(resource, setting, options, time.Now().UTC(), func(variant assets.ResourceVariant, expires time.Time) (string, error) {
		return s.signedResourceAccessURL(resource, variant, expires, options.Purpose == assets.PurposeProvider)
	})
}

func (s *Service) PrepareResourceDelivery(userID, id string, options ResourceAccessOptions, rangeHeader string) (*ResourceDelivery, error) {
	options, err := assets.NormalizeAccessOptions(options, false)
	if err != nil {
		return nil, err
	}
	resource, err := s.repo.ResourceForUser(userID, id)
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, NotFound("资源不存在或不可访问")
	}
	if err != nil {
		return nil, err
	}
	return s.prepareResourceDelivery(userID, resource, options, rangeHeader)
}

func (s *Service) prepareResourceDelivery(userID string, resource *model.Resource, options ResourceAccessOptions, rangeHeader string) (*ResourceDelivery, error) {
	if resource == nil || resource.UserID != userID {
		return nil, Forbidden("资源不可访问")
	}
	access, err := s.resolveResourceAccess(resource, options)
	if err != nil {
		return nil, err
	}
	delivery := &ResourceDelivery{Resource: resource, Access: access}
	if options.DescribeOnly || access.Delivery == assets.DeliveryCDN || access.Delivery == assets.DeliveryOrigin {
		return delivery, nil
	}
	if access.ActualVariant == assets.VariantPlayback {
		delivery.Stream, err = s.OpenResourcePlaybackRange(userID, resource.ID)
	} else {
		delivery.Stream, err = s.openResourceRange(userID, resource, rangeHeader)
	}
	if err != nil {
		return nil, err
	}
	delivery.Resource = delivery.Stream.Resource
	return delivery, nil
}

func (s *Service) signedResourceAccessURL(resource *model.Resource, variant assets.ResourceVariant, expires time.Time, public bool) (string, error) {
	expiry := strconv.FormatInt(expires.Unix(), 10)
	signature, err := s.signPublicResource(resource.ID+"\n"+string(variant), expiry)
	if err != nil {
		return "", err
	}
	u := &url.URL{Path: "/api/public/resources/" + url.PathEscape(resource.ID) + "/file"}
	q := u.Query()
	q.Set("expires", expiry)
	q.Set("signature", signature)
	q.Set("variant", string(variant))
	u.RawQuery = q.Encode()
	if !public {
		return u.String(), nil
	}
	base, err := s.publicResourceBaseURL()
	if err != nil {
		return "", err
	}
	if base.Scheme != "https" {
		return "", BadAuthRequest("模型读取平台资源需要配置 HTTPS 公网访问地址")
	}
	return base.ResolveReference(u).String(), nil
}

func (s *Service) PreparePublicResourceDelivery(id, expires, signature string, options ResourceAccessOptions, rangeHeader string) (*ResourceDelivery, error) {
	options, err := assets.NormalizeAccessOptions(options, false)
	if err != nil {
		return nil, err
	}
	if err := s.verifyPublicResourceSignature(id+"\n"+string(options.Variant), expires, signature); err != nil {
		return nil, err
	}
	resource, err := s.repo.Resource(id)
	if err != nil {
		return nil, Forbidden("匿名下载链接无效")
	}
	seconds, _ := strconv.ParseInt(expires, 10, 64)
	options.ExpiresAt = time.Unix(seconds, 0)
	return s.prepareResourceDelivery(resource.UserID, resource, options, rangeHeader)
}
