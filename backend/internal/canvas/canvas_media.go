package canvas

import (
	"encoding/json"
	"errors"
	"strings"
	"time"

	"infinite-canvas/backend/internal/assets"
	"infinite-canvas/backend/internal/kernel"
	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/repository"

	"gorm.io/gorm"
)

func (s *Service) ResourceForReader(userID, id string) (*model.Resource, error) {
	if strings.TrimSpace(userID) == "" {
		return nil, kernel.Unauthorized("请先登录")
	}
	resource, err := s.repo.ResourceForUser(userID, id)
	if !errors.Is(err, gorm.ErrRecordNotFound) {
		return resource, err
	}
	resource, err = s.repo.GrantedResourceForReader(userID, id)
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, kernel.NotFound("资源不存在或无权访问")
	}
	return resource, err
}

// The caller must hold the target canvas write permission and transaction.
// Source IDs may only be supplied after checking access to those source canvases.
func grantCanvasDocumentMedia(repo *repository.Repository, actorID, canvasID, raw string, sourceIDs ...string) error {
	grants, err := canvasDocumentMediaGrants(repo, actorID, canvasID, raw, sourceIDs...)
	if err != nil {
		return err
	}
	return repo.SetCurrentCanvasMediaGrants(canvasID, grants)
}

func canvasDocumentMediaGrants(repo *repository.Repository, actorID, canvasID, raw string, sourceIDs ...string) ([]model.CanvasMediaGrant, error) {
	resourceIDs := map[string]struct{}{}
	if err := assets.CollectOwnedDocumentReferences(raw, resourceIDs); err != nil {
		return nil, kernel.BadAuthRequest("画布媒体数据格式错误")
	}
	assetIDs, err := assets.DocumentAssetIDs(raw)
	if err != nil {
		return nil, kernel.BadAuthRequest("画布素材数据格式错误")
	}
	if len(resourceIDs) == 0 && len(assetIDs) == 0 {
		return nil, nil
	}
	// Existing grants are server-issued. A resource ID inserted into document
	// JSON alone must never confer access to another account's private media.
	var allowed map[string]bool
	canPublish := func(kind, id, ownerID string) (bool, error) {
		if ownerID == actorID {
			return true, nil
		}
		if allowed == nil {
			allowed = map[string]bool{}
			grants, err := repo.CanvasMediaGrants(append([]string{canvasID}, sourceIDs...))
			if err != nil {
				return false, err
			}
			for _, grant := range grants {
				allowed[grant.Kind+":"+grant.ObjectID] = true
			}
		}
		return allowed[kind+":"+id], nil
	}
	assetRecords, err := repo.AssetRecords(assets.SortedIDs(assetIDs))
	if err != nil {
		return nil, err
	}
	if len(assetRecords) != len(assetIDs) {
		return nil, kernel.BadAuthRequest("画布引用的素材不存在，请先完成素材同步")
	}
	grants := make([]model.CanvasMediaGrant, 0, len(assetIDs)+len(resourceIDs))
	now := time.Now().UTC()
	assetResources := map[string]map[string]struct{}{}
	for _, asset := range assetRecords {
		permitted, err := canPublish(model.CanvasMediaAsset, asset.ID, asset.UserID)
		if err != nil {
			return nil, err
		}
		if !permitted {
			return nil, kernel.Forbidden("素材未获授权用于此画布")
		}
		refs := map[string]struct{}{}
		if err := assets.CollectOwnedDocumentReferences(asset.PayloadJSON, refs); err != nil {
			return nil, err
		}
		assetResources[asset.ID] = refs
		for id := range refs {
			resourceIDs[id] = struct{}{}
		}
		grants = append(grants, model.CanvasMediaGrant{CanvasID: canvasID, Kind: model.CanvasMediaAsset, ObjectID: asset.ID, Current: true, GrantedBy: actorID, CreatedAt: now})
	}
	references, err := MediaAssetReferences(json.RawMessage(raw))
	if err != nil {
		return nil, kernel.BadAuthRequest("画布媒体数据格式错误")
	}
	for _, reference := range references {
		if reference.AssetID == "" {
			// Server-side Agent output can precede Asset materialization. Its
			// Resource still requires ownership or a server-issued canvas grant.
			continue
		}
		if _, matches := assetResources[reference.AssetID][reference.ResourceID]; !matches {
			return nil, kernel.BadAuthRequest("画布媒体与素材库记录不一致，请先完成素材同步")
		}
	}
	resources, err := repo.ResourceRecords(assets.SortedIDs(resourceIDs))
	if err != nil {
		return nil, err
	}
	if len(resources) != len(resourceIDs) {
		return nil, kernel.BadAuthRequest("画布引用的云端资源不存在")
	}
	for _, resource := range resources {
		permitted, err := canPublish(model.CanvasMediaResource, resource.ID, resource.UserID)
		if err != nil {
			return nil, err
		}
		if !permitted {
			return nil, kernel.Forbidden("资源未获授权用于此画布")
		}
		if resource.Status != model.ResourceStatusReady {
			return nil, kernel.BadAuthRequest("画布媒体尚未上传完成")
		}
		grants = append(grants, model.CanvasMediaGrant{CanvasID: canvasID, Kind: model.CanvasMediaResource, ObjectID: resource.ID, Current: true, GrantedBy: actorID, CreatedAt: now})
	}
	return grants, nil
}
