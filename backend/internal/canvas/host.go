package canvas

import (
	"infinite-canvas/backend/internal/assets"
	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/repository"
)

// Host 由组合根注入，避免 canvas → service 回环。
type Host interface {
	EncryptSecret(value string) (string, error)
	DecryptSecret(value string) (string, error)
	OpenResourceRange(userID string, resource *model.Resource, rangeHeader string) (*assets.ResourceStream, error)
	PrepareResourceDelivery(userID string, resource *model.Resource, options assets.ResourceDeliveryOptions) (*assets.ResourceDelivery, error)
	WithStorageLock(fn func() error) error
	StructuredQuota(userID, kind string, creating bool, deltaBytes int64) error
	StructuredReplacementQuota(userID, kind string, count int, bytes int64) error
	DeleteUserAssetWithResources(userID, assetID string) error
	RecordActivity(userID, event string, count int)
}

type nopHost struct{}

func (nopHost) EncryptSecret(value string) (string, error) { return value, nil }
func (nopHost) DecryptSecret(value string) (string, error) { return value, nil }
func (nopHost) OpenResourceRange(string, *model.Resource, string) (*assets.ResourceStream, error) {
	return nil, nil
}
func (nopHost) PrepareResourceDelivery(string, *model.Resource, assets.ResourceDeliveryOptions) (*assets.ResourceDelivery, error) {
	return nil, nil
}
func (nopHost) WithStorageLock(fn func() error) error {
	if fn == nil {
		return nil
	}
	return fn()
}
func (nopHost) StructuredQuota(string, string, bool, int64) error           { return nil }
func (nopHost) StructuredReplacementQuota(string, string, int, int64) error { return nil }
func (nopHost) DeleteUserAssetWithResources(string, string) error           { return nil }
func (nopHost) RecordActivity(string, string, int)                          {}

type Service struct {
	repo *repository.Repository
	host Host
}

func New(repo *repository.Repository, host Host) *Service {
	if host == nil {
		host = nopHost{}
	}
	return &Service{repo: repo, host: host}
}
