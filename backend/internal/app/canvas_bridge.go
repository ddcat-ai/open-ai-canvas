package app

import (
	"encoding/json"
	"io"

	"infinite-canvas/backend/internal/assets"
	"infinite-canvas/backend/internal/canvas"
	"infinite-canvas/backend/internal/model"
)

type (
	CanvasShareRequest        = canvas.CanvasShareRequest
	CanvasShareStatus         = canvas.CanvasShareStatus
	PublicCanvasShare         = canvas.PublicCanvasShare
	AssetsSyncRequest         = canvas.AssetsSyncRequest
	CanvasProjectsSyncRequest = canvas.CanvasProjectsSyncRequest
	UserDataSummary           = canvas.UserDataSummary
	UserDataSnapshot          = canvas.UserDataSnapshot
	CanvasLibrarySummary      = canvas.CanvasLibrarySummary
	CanvasLibraryPage         = canvas.CanvasLibraryPage
)

type canvasHost struct {
	svc *Service
}

func (h canvasHost) EncryptSecret(value string) (string, error) {
	if h.svc == nil {
		return value, nil
	}
	return h.svc.encryptSettingSecret(value)
}

func (h canvasHost) DecryptSecret(value string) (string, error) {
	if h.svc == nil {
		return value, nil
	}
	return h.svc.decryptSettingSecret(value)
}

func (h canvasHost) OpenResourceRange(userID string, resource *model.Resource, rangeHeader string) (*assets.ResourceStream, error) {
	if h.svc == nil {
		return nil, nil
	}
	return h.svc.openResourceRange(userID, resource, rangeHeader)
}

func (h canvasHost) PrepareResourceDelivery(userID string, resource *model.Resource, options assets.ResourceDeliveryOptions) (*assets.ResourceDelivery, error) {
	if h.svc == nil {
		return nil, nil
	}
	return h.svc.prepareResourceDelivery(userID, resource, options)
}

func (h canvasHost) WithStorageLock(fn func() error) error {
	if h.svc == nil {
		if fn == nil {
			return nil
		}
		return fn()
	}
	h.svc.storageMu.Lock()
	defer h.svc.storageMu.Unlock()
	return fn()
}

func (h canvasHost) StructuredQuota(userID, kind string, creating bool, deltaBytes int64) error {
	if h.svc == nil {
		return nil
	}
	policy, err := h.svc.RuntimePolicy()
	if err != nil {
		return err
	}
	usage, err := h.svc.repo.UserStorageUsage(userID)
	if err != nil {
		return err
	}
	return validateStructuredStorageQuotaWithPolicy(usage, kind, creating, deltaBytes, policy.Resource)
}

func (h canvasHost) StructuredReplacementQuota(userID, kind string, count int, bytes int64) error {
	if h.svc == nil {
		return nil
	}
	policy, err := h.svc.RuntimePolicy()
	if err != nil {
		return err
	}
	usage, err := h.svc.repo.UserStorageUsage(userID)
	if err != nil {
		return err
	}
	return validateStructuredReplacementQuotaWithPolicy(usage, kind, count, bytes, policy.Resource)
}

func (h canvasHost) DeleteUserAssetWithResources(userID, assetID string) error {
	if h.svc == nil {
		return nil
	}
	return h.svc.deleteUserAssetWithResources(userID, assetID)
}

func (h canvasHost) RecordActivity(userID, event string, count int) {
	if h.svc == nil {
		return
	}
	h.svc.recordActivity(userID, event, count)
}

func (s *Service) canvasDomain() *canvas.Service {
	if s == nil {
		return canvas.New(nil, nil)
	}
	if s.canvas != nil {
		return s.canvas
	}
	return canvas.New(s.repo, canvasHost{svc: s})
}

func (s *Service) CanvasShareStatus(userID string, projectID string) (CanvasShareStatus, error) {
	return s.canvasDomain().CanvasShareStatus(userID, projectID)
}

func (s *Service) CreateCanvasShare(userID string, projectID string, req CanvasShareRequest) (CanvasShareStatus, error) {
	return s.canvasDomain().CreateCanvasShare(userID, projectID, req)
}

func (s *Service) DeleteCanvasShare(userID string, projectID string) error {
	return s.canvasDomain().DeleteCanvasShare(userID, projectID)
}

func (s *Service) PublicCanvasShare(token string) (PublicCanvasShare, error) {
	return s.canvasDomain().PublicCanvasShare(token)
}

func (s *Service) OpenSharedCanvasResource(token string, resourceID string) (*model.Resource, io.ReadCloser, error) {
	return s.canvasDomain().OpenSharedCanvasResource(token, resourceID)
}

func (s *Service) OpenSharedCanvasResourceRange(token string, resourceID string, rangeHeader string) (*ResourceStream, error) {
	return s.canvasDomain().OpenSharedCanvasResourceRange(token, resourceID, rangeHeader)
}

func (s *Service) PrepareSharedCanvasResourceDelivery(token string, resourceID string, rangeHeader string) (*ResourceDelivery, error) {
	return s.canvasDomain().PrepareSharedCanvasResourceDelivery(token, resourceID, rangeHeader)
}

func (s *Service) validateCanvasMediaAssets(userID string, raw json.RawMessage) error {
	return s.canvasDomain().ValidateCanvasMediaAssets(userID, raw)
}

func (s *Service) validateAssetCanvasReferences(userID string, asset model.Asset) error {
	return s.canvasDomain().ValidateAssetCanvasReferences(userID, asset)
}

func (s *Service) validateAssetReplacementCanvasReferences(userID string, replacement []model.Asset) error {
	return s.canvasDomain().ValidateAssetReplacementCanvasReferences(userID, replacement)
}

func (s *Service) UserDataSnapshot(userID string) (UserDataSnapshot, error) {
	return s.canvasDomain().UserDataSnapshot(userID)
}

func (s *Service) UserAssetSummaries(userID string) ([]UserDataSummary, error) {
	return s.canvasDomain().UserAssetSummaries(userID)
}

func (s *Service) UserAsset(userID string, id string) (json.RawMessage, error) {
	return s.canvasDomain().UserAsset(userID, id)
}

func (s *Service) UpsertUserAsset(userID string, raw json.RawMessage) (UserDataSummary, error) {
	return s.canvasDomain().UpsertUserAsset(userID, raw)
}

func (s *Service) DeleteUserAsset(userID string, id string) error {
	return s.canvasDomain().DeleteUserAsset(userID, id)
}

func (s *Service) UserAssets(userID string) ([]json.RawMessage, error) {
	return s.canvasDomain().UserAssets(userID)
}

func (s *Service) ReplaceUserAssets(userID string, req AssetsSyncRequest) ([]json.RawMessage, error) {
	return s.canvasDomain().ReplaceUserAssets(userID, req)
}

func (s *Service) UserCanvasProjects(userID string) ([]json.RawMessage, error) {
	return s.canvasDomain().UserCanvasProjects(userID)
}

func (s *Service) UserCanvasProjectSummaries(userID string) ([]UserDataSummary, error) {
	return s.canvasDomain().UserCanvasProjectSummaries(userID)
}

func (s *Service) UserCanvasProject(userID string, id string) (json.RawMessage, error) {
	return s.canvasDomain().UserCanvasProject(userID, id)
}

func (s *Service) UpsertUserCanvasProject(userID string, raw json.RawMessage) (UserDataSummary, error) {
	return s.canvasDomain().UpsertUserCanvasProject(userID, raw)
}

func (s *Service) DeleteUserCanvasProject(userID string, id string) error {
	return s.canvasDomain().DeleteUserCanvasProject(userID, id)
}

func (s *Service) ReplaceUserCanvasProjects(userID string, req CanvasProjectsSyncRequest) ([]json.RawMessage, error) {
	return s.canvasDomain().ReplaceUserCanvasProjects(userID, req)
}

func (s *Service) UserAssetsByIDs(userID string, ids []string) ([]json.RawMessage, error) {
	return s.canvasDomain().UserAssetsByIDs(userID, ids)
}

func (s *Service) UserCanvasProjectsPage(userID string, page int, pageSize int, projectID string, search string, sort string) (CanvasLibraryPage, error) {
	return s.canvasDomain().UserCanvasProjectsPage(userID, page, pageSize, projectID, search, sort)
}

func clientAssetPayload(asset model.Asset) json.RawMessage {
	return canvas.ClientAssetPayload(asset)
}

func validateSyncedPayload(raw json.RawMessage, label string) error {
	return canvas.ValidateSyncedPayload(raw, label)
}

func containsInlineMediaDataURL(value interface{}) bool {
	return canvas.ContainsInlineMediaDataURL(value)
}

func assetFromJSON(userID string, raw json.RawMessage) (model.Asset, error) {
	return canvas.AssetFromJSON(userID, raw)
}
