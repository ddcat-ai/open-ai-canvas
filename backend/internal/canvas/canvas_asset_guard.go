package canvas

import (
	"encoding/json"
	"net/http"
	"strconv"
	"strings"
	"yingce/backend/internal/assets"
	"yingce/backend/internal/kernel"

	"yingce/backend/internal/model"
)

type MediaAssetReference struct {
	AssetID       string
	VersionID     string
	ResourceID    string
	NodeID        string
	Path          string
	ReferenceType string
}

// validateCanvasMediaAssets is the final server-side invariant for canvas sync:
// a persisted canvas may only point at an uploaded Resource through an Asset
// owned by the same user. The client writes Assets before canvases, so rejecting
// an incomplete pair prevents a durable Resource-only (ghost capacity) state.
func (s *Service) ValidateCanvasMediaAssets(userID string, raw json.RawMessage) error {
	var identity struct {
		ID string `json:"id"`
	}
	if err := json.Unmarshal(raw, &identity); err != nil {
		return kernel.BadAuthRequest("画布媒体数据格式错误")
	}
	references, err := MediaAssetReferences(raw)
	if err != nil {
		return kernel.BadAuthRequest("画布媒体数据格式错误")
	}
	allResourceReferences, err := assets.CollectDocumentResourceReferences(string(raw))
	if err != nil {
		return kernel.BadAuthRequest("画布媒体数据格式错误")
	}
	if len(references) == 0 && len(allResourceReferences) == 0 {
		return nil
	}

	assetIDSet := make(map[string]struct{}, len(references))
	resourceIDSet := make(map[string]struct{}, len(references)+len(allResourceReferences))
	for _, reference := range references {
		if reference.AssetID != "" {
			assetIDSet[reference.AssetID] = struct{}{}
		}
		resourceIDSet[reference.ResourceID] = struct{}{}
	}
	for _, reference := range allResourceReferences {
		resourceIDSet[reference.ResourceID] = struct{}{}
	}

	ownedAssets, err := s.repo.AssetsForUserIDs(userID, assets.SortedIDs(assetIDSet))
	if err != nil {
		return err
	}
	assetResources := make(map[string]map[string]struct{}, len(ownedAssets))
	for _, asset := range ownedAssets {
		assetResources[asset.ID] = assets.DocumentReferencedIDs(asset.PayloadJSON, resourceIDSet)
	}
	history, err := s.projectImageHistory(userID, ownedAssets)
	if err != nil {
		return err
	}
	for assetID, ids := range history {
		for resourceID := range ids {
			assetResources[assetID][resourceID] = struct{}{}
		}
	}

	resources, err := s.repo.ResourcesForUserIDs(userID, assets.SortedIDs(resourceIDSet))
	if err != nil {
		return err
	}
	readyResources := make(map[string]struct{}, len(resources))
	for _, resource := range resources {
		if resource.Status == model.ResourceStatusReady {
			readyResources[resource.ID] = struct{}{}
		}
	}
	officialResources := make(map[string]bool)
	for resourceID := range resourceIDSet {
		if _, owned := readyResources[resourceID]; owned {
			continue
		}
		published, err := s.repo.PublishedOfficialResource(resourceID)
		if err != nil {
			return err
		}
		if !published {
			published, err = s.repo.RetainedCanvasOfficialResource(userID, identity.ID, resourceID)
			if err != nil {
				return err
			}
		}
		if published {
			officialResources[resourceID] = true
			readyResources[resourceID] = struct{}{}
		}
	}
	missing := make([]assets.DocumentResourceReference, 0)
	for _, reference := range allResourceReferences {
		if _, exists := readyResources[reference.ResourceID]; !exists {
			reference.Source = "current"
			missing = append(missing, reference)
		}
	}
	if len(missing) > 0 {
		return canvasResourcesMissingError(missing)
	}

	for _, reference := range references {
		if reference.AssetID == "" {
			allowed := officialResources[reference.ResourceID]
			if !allowed {
				allowed, err = s.repo.PublishedOfficialResource(reference.ResourceID)
				if err != nil {
					return err
				}
			}
			if !allowed {
				allowed, err = s.repo.RetainedCanvasOfficialResource(userID, identity.ID, reference.ResourceID)
				if err != nil {
					return err
				}
			}
			if allowed {
				continue
			}
		}
		resourceIDs, assetExists := assetResources[reference.AssetID]
		if !assetExists {
			return canvasMediaAssetsPendingError()
		}
		if _, matches := resourceIDs[reference.ResourceID]; !matches {
			return canvasMediaAssetsPendingError()
		}
	}
	return nil
}

func canvasMediaAssetsPendingError() *kernel.AppError {
	err := kernel.BadAuthRequest("画布媒体尚未进入素材库，正在重新对齐")
	err.Reason = "canvas_media_assets_pending"
	return err
}

func canvasResourcesMissingError(references []assets.DocumentResourceReference) *kernel.AppError {
	ids := make(map[string]struct{}, len(references))
	for _, reference := range references {
		ids[reference.ResourceID] = struct{}{}
	}
	err := kernel.NewAppError(http.StatusConflict, "画布引用的素材已变化，当前内容未被覆盖，请修复缺失素材后重试")
	err.Code = kernel.CodeCanvasResourcesMissing
	err.Reason = kernel.ReasonCanvasResourcesMissing
	err.Details = map[string]any{"resourceIds": assets.SortedIDs(ids), "missingResources": references}
	return err
}

// validateAssetCanvasReferences prevents an Asset update from changing the
// resource behind a canvas that already points at that Asset.
func (s *Service) ValidateAssetCanvasReferences(userID string, asset model.Asset) error {
	history, err := s.projectImageHistory(userID, []model.Asset{asset})
	if err != nil {
		return err
	}
	canvases, err := s.repo.CanvasProjects(userID)
	if err != nil {
		return err
	}
	for _, canvas := range canvases {
		references, parseErr := MediaAssetReferences(json.RawMessage(canvas.PayloadJSON))
		if parseErr != nil {
			return kernel.BadAuthRequest("已有画布媒体数据无法解析，已停止修改素材")
		}
		for _, reference := range references {
			if reference.AssetID != asset.ID {
				continue
			}
			candidate := map[string]struct{}{reference.ResourceID: {}}
			_, historical := history[asset.ID][reference.ResourceID]
			if !assets.DocumentReferences(asset.PayloadJSON, candidate) && !historical {
				return kernel.BadAuthRequest("素材仍被画布引用，不能替换为其他云端资源")
			}
		}
	}
	return nil
}

// validateAssetReplacementCanvasReferences applies the same invariant to the
// legacy full-replacement endpoint, which otherwise could silently remove an
// Asset that a canvas still needs.
func (s *Service) ValidateAssetReplacementCanvasReferences(userID string, replacement []model.Asset) error {
	history, err := s.projectImageHistory(userID, replacement)
	if err != nil {
		return err
	}
	assetByID := make(map[string]model.Asset, len(replacement))
	for _, asset := range replacement {
		assetByID[asset.ID] = asset
	}
	canvases, err := s.repo.CanvasProjects(userID)
	if err != nil {
		return err
	}
	for _, canvas := range canvases {
		references, parseErr := MediaAssetReferences(json.RawMessage(canvas.PayloadJSON))
		if parseErr != nil {
			return kernel.BadAuthRequest("已有画布媒体数据无法解析，已停止替换素材库")
		}
		for _, reference := range references {
			asset, exists := assetByID[reference.AssetID]
			if !exists {
				return kernel.BadAuthRequest("素材仍被画布引用，不能从素材库移除")
			}
			candidate := map[string]struct{}{reference.ResourceID: {}}
			_, historical := history[asset.ID][reference.ResourceID]
			if !assets.DocumentReferences(asset.PayloadJSON, candidate) && !historical {
				return kernel.BadAuthRequest("画布媒体与替换后的素材库记录不一致")
			}
		}
	}
	return nil
}

// 场景、道具换图后保留旧画布的不可变资源引用；信任版本表，不信任客户端声明的历史。
func (s *Service) projectImageHistory(userID string, candidates []model.Asset) (map[string]map[string]struct{}, error) {
	ids := []string{}
	for _, asset := range candidates {
		if asset.Category == model.AssetCategoryEnvironment || asset.Category == model.AssetCategoryProp {
			ids = append(ids, asset.ID)
		}
	}
	references, err := s.repo.ProjectAssetImageReferences(userID, ids)
	if err != nil {
		return nil, err
	}
	history := map[string]map[string]struct{}{}
	for _, reference := range references {
		if history[reference.AssetID] == nil {
			history[reference.AssetID] = map[string]struct{}{}
		}
		history[reference.AssetID][reference.ResourceID] = struct{}{}
	}
	if _, team := model.TeamIDFromContentKey(userID); team && len(candidates) != 0 {
		ids = ids[:0]
		for _, asset := range candidates {
			ids = append(ids, asset.ID)
		}
		versions, err := s.repo.AssetVersionsForAssets(ids)
		if err != nil {
			return nil, err
		}
		for _, version := range versions {
			if history[version.AssetID] == nil {
				history[version.AssetID] = map[string]struct{}{}
			}
			if err := assets.CollectOwnedDocumentReferences(version.DefinitionJSON, history[version.AssetID]); err != nil {
				return nil, err
			}
		}
	}
	return history, nil
}

func MediaAssetReferences(raw json.RawMessage) ([]MediaAssetReference, error) {
	return canvasAssetReferences(raw, false)
}

func canvasAssetReferences(raw json.RawMessage, includeAssetBindings bool) ([]MediaAssetReference, error) {
	var payload struct {
		Nodes []struct {
			ID       string `json:"id"`
			Type     string `json:"type"`
			Metadata struct {
				AssetID    string `json:"assetId"`
				VersionID  string `json:"assetVersionId"`
				StorageKey string `json:"storageKey"`
				Content    string `json:"content"`
			} `json:"metadata"`
		} `json:"nodes"`
		Timeline struct {
			Clips []struct {
				ID          string `json:"id"`
				DirectMedia *struct {
					Kind       string `json:"kind"`
					AssetID    string `json:"assetId"`
					VersionID  string `json:"assetVersionId"`
					StorageKey string `json:"storageKey"`
					URL        string `json:"url"`
					DataURL    string `json:"dataUrl"`
					Content    string `json:"content"`
				} `json:"directMedia"`
			} `json:"clips"`
		} `json:"timeline"`
	}
	if err := json.Unmarshal(raw, &payload); err != nil {
		return nil, err
	}

	references := make([]MediaAssetReference, 0)
	for _, node := range payload.Nodes {
		assetID := strings.TrimSpace(node.Metadata.AssetID)
		var resourceID string
		if isCanvasMediaKind(node.Type) {
			resourceID = firstCanvasResourceID(node.Metadata.StorageKey, node.Metadata.Content)
		}
		if resourceID != "" || (includeAssetBindings && assetID != "") {
			references = append(references, MediaAssetReference{
				AssetID: assetID, VersionID: node.Metadata.VersionID, ResourceID: resourceID, NodeID: node.ID,
				Path: "nodes[" + node.ID + "].metadata.storageKey", ReferenceType: "storageKey",
			})
		}
	}
	for index, clip := range payload.Timeline.Clips {
		media := clip.DirectMedia
		if media == nil || !isCanvasMediaKind(media.Kind) {
			continue
		}
		resourceID := firstCanvasResourceID(media.StorageKey, media.URL, media.DataURL, media.Content)
		if resourceID == "" && (!includeAssetBindings || media.AssetID == "") {
			continue
		}
		clipKey := strconv.Itoa(index)
		if includeAssetBindings && clip.ID != "" {
			clipKey = clip.ID
		}
		references = append(references, MediaAssetReference{
			AssetID: strings.TrimSpace(media.AssetID), VersionID: media.VersionID, ResourceID: resourceID,
			Path: "timeline.clips[" + clipKey + "].directMedia", ReferenceType: "directMedia",
		})
	}
	return references, nil
}

func (s *Service) validateNewWorkspaceBindings(ownerKey string, existing *model.CanvasProject, raw json.RawMessage) error {
	if _, team := model.TeamIDFromContentKey(ownerKey); !team {
		return nil
	}
	current, err := canvasAssetReferences(raw, true)
	if err != nil || len(current) == 0 {
		return err
	}
	retained := map[MediaAssetReference]bool{}
	if existing != nil {
		previous, err := canvasAssetReferences(json.RawMessage(existing.PayloadJSON), true)
		if err != nil {
			return err
		}
		for _, ref := range previous {
			retained[ref] = true
		}
	}
	assetIDs := map[string]struct{}{}
	versionAssets := map[string]struct{}{}
	for _, ref := range current {
		if ref.AssetID == "" || retained[ref] {
			continue
		}
		assetIDs[ref.AssetID] = struct{}{}
		if ref.VersionID != "" {
			versionAssets[ref.AssetID] = struct{}{}
		}
	}
	if len(assetIDs) == 0 {
		return nil
	}
	owned, err := s.repo.AssetsForUserIDs(ownerKey, assets.SortedIDs(assetIDs))
	if err != nil {
		return err
	}
	if len(owned) != len(assetIDs) {
		return canvasMediaAssetsPendingError()
	}
	for _, asset := range owned {
		if asset.Status == model.AssetVersionStatusArchived {
			return canvasMutationError("asset_archived", "不能新增已归档素材的引用，请先恢复素材")
		}
	}
	if len(versionAssets) == 0 {
		return nil
	}
	versions, err := s.repo.AssetVersionsForAssets(assets.SortedIDs(versionAssets))
	if err != nil {
		return err
	}
	byVersion := make(map[string]model.AssetVersion, len(versions))
	for _, version := range versions {
		byVersion[version.ID] = version
	}
	for _, ref := range current {
		if ref.VersionID == "" || retained[ref] || ref.AssetID == "" {
			continue
		}
		version, ok := byVersion[ref.VersionID]
		if !ok || version.AssetID != ref.AssetID || (ref.ResourceID != "" && !assets.DocumentReferences(version.DefinitionJSON, map[string]struct{}{ref.ResourceID: {}})) {
			return canvasMediaAssetsPendingError()
		}
	}
	return nil
}

func firstCanvasResourceID(values ...string) string {
	for _, value := range values {
		if resourceID := assets.ResourceID(value); resourceID != "" {
			return resourceID
		}
	}
	return ""
}

func isCanvasMediaKind(kind string) bool {
	switch strings.ToLower(strings.TrimSpace(kind)) {
	case "image", "video", "audio":
		return true
	default:
		return false
	}
}
