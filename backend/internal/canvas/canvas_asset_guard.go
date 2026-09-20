package canvas

import (
	"encoding/json"
	"errors"
	"infinite-canvas/backend/internal/assets"
	"infinite-canvas/backend/internal/kernel"
	"strings"

	"gorm.io/gorm"
	"infinite-canvas/backend/internal/model"
)

type MediaAssetReference struct {
	AssetID    string
	ResourceID string
}

// Media must have a valid Asset/Resource pair and be owned by the publisher or
// already authorized in this canvas. The same contract applies to branches.
func (s *Service) ValidateCanvasMediaAssets(userID string, raw json.RawMessage) error {
	var document struct {
		ID string `json:"id"`
	}
	if err := json.Unmarshal(raw, &document); err != nil {
		return kernel.BadAuthRequest("画布媒体数据格式错误")
	}
	references, err := MediaAssetReferences(raw)
	if err != nil {
		return kernel.BadAuthRequest("画布媒体数据格式错误")
	}
	for _, reference := range references {
		if reference.AssetID == "" {
			return kernel.BadAuthRequest("画布媒体尚未进入素材库，请等待同步完成后重试")
		}
	}
	_, err = canvasDocumentMediaGrants(s.repo, userID, document.ID, string(raw))
	return err
}

// validateAssetCanvasReferences prevents an Asset update from changing the
// resource behind a canvas that already points at that Asset.
func (s *Service) ValidateAssetCanvasReferences(userID string, asset model.Asset) error {
	canvases, err := s.repo.CanvasProjectsReferencingUserAssets(userID)
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
			if !assets.DocumentReferences(asset.PayloadJSON, candidate) {
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
	assetByID := make(map[string]model.Asset, len(replacement))
	for _, asset := range replacement {
		assetByID[asset.ID] = asset
	}
	canvases, err := s.repo.CanvasProjectsReferencingUserAssets(userID)
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
				if _, err := s.repo.AssetForUser(userID, reference.AssetID); err != nil {
					if errors.Is(err, gorm.ErrRecordNotFound) {
						continue
					}
					return err
				}
			}
			if !exists {
				return kernel.BadAuthRequest("素材仍被画布引用，不能从素材库移除")
			}
			candidate := map[string]struct{}{reference.ResourceID: {}}
			if !assets.DocumentReferences(asset.PayloadJSON, candidate) {
				return kernel.BadAuthRequest("画布媒体与替换后的素材库记录不一致")
			}
		}
	}
	return nil
}

func MediaAssetReferences(raw json.RawMessage) ([]MediaAssetReference, error) {
	var payload struct {
		Nodes []struct {
			Type     string `json:"type"`
			Metadata struct {
				AssetID    string `json:"assetId"`
				StorageKey string `json:"storageKey"`
				Content    string `json:"content"`
			} `json:"metadata"`
		} `json:"nodes"`
		Timeline struct {
			Clips []struct {
				DirectMedia *struct {
					Kind       string `json:"kind"`
					AssetID    string `json:"assetId"`
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
		if !isCanvasMediaKind(node.Type) {
			continue
		}
		resourceID := firstCanvasResourceID(node.Metadata.StorageKey, node.Metadata.Content)
		if resourceID == "" {
			continue
		}
		references = append(references, MediaAssetReference{
			AssetID: strings.TrimSpace(node.Metadata.AssetID), ResourceID: resourceID,
		})
	}
	for _, clip := range payload.Timeline.Clips {
		media := clip.DirectMedia
		if media == nil || !isCanvasMediaKind(media.Kind) {
			continue
		}
		resourceID := firstCanvasResourceID(media.StorageKey, media.URL, media.DataURL, media.Content)
		if resourceID == "" {
			continue
		}
		references = append(references, MediaAssetReference{
			AssetID: strings.TrimSpace(media.AssetID), ResourceID: resourceID,
		})
	}
	return references, nil
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
