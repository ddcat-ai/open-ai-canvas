package app

// 方舟素材与素材库的衔接：自建组的图片通过方舟审核后自动写入「方舟认证」分类；
// 授权给用户的平台素材由用户手动加入，服务端把图片复制成用户自己的资源，素材库不引用他人的文件。
// 认证信息写在素材 payload 的 arkAssetId 与 arkCertification；previousCategory 记录认证前的分类，
// 取消认证时据此恢复。

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"strings"
	"time"

	"gorm.io/gorm"

	"yingce/backend/internal/model"
)

// arkPortraitMaxImageBytes 是复制平台素材图片时读取的上限，与方舟单图要求一致。
const arkPortraitMaxImageBytes = 30 << 20

func arkOwnLibraryAssetID(assetID string) string {
	return "ark-" + assetID
}

func arkSharedLibraryAssetID(assetID string, userID string) string {
	return "ark-" + assetID + "-" + userID
}

// arkLibraryAssetIDForUser 返回方舟素材在该用户素材库中对应的素材 ID。
func arkLibraryAssetIDForUser(asset model.ArkPortraitAsset, userID string) string {
	if asset.UserID == userID {
		if asset.LibraryAssetID != "" {
			return asset.LibraryAssetID
		}
		return arkOwnLibraryAssetID(asset.ID)
	}
	return arkSharedLibraryAssetID(asset.ID, userID)
}

func arkCertificationPayload(asset model.ArkPortraitAsset, group model.ArkPortraitGroup, previousCategory model.AssetCategory) map[string]any {
	payload := map[string]any{
		"kind":            firstNonEmpty(group.Kind, arkGroupKindReal),
		"scope":           firstNonEmpty(group.Scope, arkGroupScopeUser),
		"portraitAssetId": asset.ID,
		"groupId":         group.ID,
		"groupName":       group.Name,
		"arkGroupId":      group.GroupID,
		"certifiedAt":     time.Now().UTC().Format(time.RFC3339Nano),
	}
	if previousCategory != "" && previousCategory != model.AssetCategoryArk {
		payload["previousCategory"] = string(previousCategory)
	}
	if group.ExpiresAt != nil {
		payload["expiresAt"] = group.ExpiresAt.UTC().Format(time.RFC3339Nano)
	}
	return payload
}

// certifyArkLibraryAsset 把认证结果写入用户素材库中已有的图片素材。素材不存在、不是图片，
// 或图片已被替换成其他文件时返回 false，调用方改为新建素材。
func (s *Service) certifyArkLibraryAsset(userID string, libraryAssetID string, asset model.ArkPortraitAsset, group model.ArkPortraitGroup, resourceID string) (bool, error) {
	s.storageMu.Lock()
	defer s.storageMu.Unlock()
	return s.repo.UpdateUserAssetPayload(userID, libraryAssetID, func(record *model.Asset, payload map[string]any) (bool, error) {
		if record.Kind != "image" {
			return false, nil
		}
		data, _ := payload["data"].(map[string]any)
		if storageKey, _ := data["storageKey"].(string); strings.TrimSpace(storageKey) != "resource:"+resourceID {
			return false, nil
		}
		previous := record.Category
		if existing, ok := payload["arkCertification"].(map[string]any); ok && record.Category == model.AssetCategoryArk {
			if value, _ := existing["previousCategory"].(string); value != "" {
				previous = model.AssetCategory(value)
			}
		}
		payload["arkAssetId"] = asset.ArkAssetID
		payload["arkCertification"] = arkCertificationPayload(asset, group, previous)
		record.Category = model.AssetCategoryArk
		if record.Status == model.AssetVersionStatusArchived {
			record.Status = model.AssetVersionStatusConfirmed
		}
		return true, nil
	})
}

// createArkLibraryAsset 在用户素材库新建一张已认证图片；同 ID 素材已存在时只补写认证信息，
// 已被用户换成其他图片的素材保持原样。
func (s *Service) createArkLibraryAsset(userID string, libraryAssetID string, resource *model.Resource, asset model.ArkPortraitAsset, group model.ArkPortraitGroup) error {
	if ok, err := s.certifyArkLibraryAsset(userID, libraryAssetID, asset, group, resource.ID); err != nil || ok {
		return err
	}
	if _, err := s.repo.AssetForUser(userID, libraryAssetID); err == nil {
		return nil
	} else if !errors.Is(err, gorm.ErrRecordNotFound) {
		return err
	}
	width, height := s.arkResourceDimensions(resource)
	if width <= 0 || height <= 0 {
		return errors.New("无法读取方舟素材图片尺寸，未写入素材库")
	}
	now := time.Now().UTC()
	url := resourceFileURL(resource.ID)
	title := truncateRunes(firstNonEmpty(strings.TrimSpace(asset.Name), group.Name), 120)
	payload, err := json.Marshal(map[string]any{
		"id": libraryAssetID, "kind": "image", "category": model.AssetCategoryArk, "status": model.AssetVersionStatusConfirmed,
		"source": "方舟素材库", "title": title, "coverUrl": url, "tags": []string{arkGroupKindLabel(group.Kind)},
		"createdAt": now.Format(time.RFC3339Nano), "updatedAt": now.Format(time.RFC3339Nano),
		"data":       map[string]any{"dataUrl": url, "storageKey": "resource:" + resource.ID, "mimeType": resource.MimeType, "bytes": resource.Size, "width": width, "height": height},
		"metadata":   map[string]any{"source": "ark-portrait"},
		"arkAssetId": asset.ArkAssetID, "arkCertification": arkCertificationPayload(asset, group, model.AssetCategoryMaterial),
	})
	if err != nil {
		return err
	}
	policy, err := s.RuntimePolicy()
	if err != nil {
		return err
	}
	s.storageMu.Lock()
	defer s.storageMu.Unlock()
	usage, err := s.repo.UserStorageUsage(userID)
	if err != nil {
		return err
	}
	if err := validateStructuredStorageQuotaWithPolicy(usage, "asset", true, int64(len(payload)), policy.Resource); err != nil {
		return err
	}
	return s.repo.UpsertAsset(&model.Asset{
		ID: libraryAssetID, UserID: userID, Kind: "image", Category: model.AssetCategoryArk, Status: model.AssetVersionStatusConfirmed,
		Title: title, PayloadJSON: string(payload), CreatedAt: now, UpdatedAt: now,
	})
}

// arkResourceDimensions 返回图片尺寸；上传时未带尺寸的旧资源从文件头解码。
func (s *Service) arkResourceDimensions(resource *model.Resource) (int, int) {
	if resource.Width > 0 && resource.Height > 0 {
		return resource.Width, resource.Height
	}
	_, body, err := s.OpenResource(resource.UserID, resource.ID)
	if err != nil {
		return 0, 0
	}
	defer body.Close()
	header, err := io.ReadAll(io.LimitReader(body, 4<<20))
	if err != nil {
		return 0, 0
	}
	return imageDimensions(header)
}

// syncArkLibraryAfterActive 在素材通过方舟审核后写入素材库：自建组的图片自动进入「方舟认证」分类，
// 从素材库提交的图片原地移入，组内直接上传的图片新建素材。平台素材组由用户手动加入。
func (s *Service) syncArkLibraryAfterActive(asset *model.ArkPortraitAsset, group model.ArkPortraitGroup) error {
	if group.Scope != arkGroupScopeUser || asset.AssetType != "Image" || asset.UserID != group.UserID {
		return nil
	}
	if asset.LibraryAssetID != "" {
		ok, err := s.certifyArkLibraryAsset(asset.UserID, asset.LibraryAssetID, *asset, group, asset.ResourceID)
		if err != nil || ok {
			return err
		}
	}
	resource, err := s.repo.ResourceForUser(asset.UserID, asset.ResourceID)
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil
	}
	if err != nil {
		return err
	}
	libraryID := arkOwnLibraryAssetID(asset.ID)
	if err := s.createArkLibraryAsset(asset.UserID, libraryID, resource, *asset, group); err != nil {
		return err
	}
	if asset.LibraryAssetID == libraryID {
		return nil
	}
	asset.LibraryAssetID = libraryID
	return s.repo.SetArkPortraitAssetLibraryAsset(asset.ID, libraryID)
}

// uncertifyArkLibraryAssets 在方舟素材被删除后取消素材库中的认证标记并恢复原分类，图片文件保留。
func (s *Service) uncertifyArkLibraryAssets(asset model.ArkPortraitAsset) {
	targets := map[string]string{arkOwnLibraryAssetID(asset.ID): asset.UserID}
	if asset.LibraryAssetID != "" {
		targets[asset.LibraryAssetID] = asset.UserID
	}
	copies, err := s.repo.AssetRefsByIDPrefix(arkOwnLibraryAssetID(asset.ID) + "-")
	if err != nil {
		slog.Warn("ark library copies lookup failed", "asset", asset.ID, "error", err)
	}
	for _, item := range copies {
		targets[item.ID] = item.UserID
	}
	for libraryAssetID, userID := range targets {
		if err := s.uncertifyArkLibraryAsset(userID, libraryAssetID, asset.ID); err != nil {
			slog.Warn("ark library uncertify failed", "asset", asset.ID, "libraryAsset", libraryAssetID, "error", err)
		}
	}
}

func (s *Service) uncertifyArkLibraryAsset(userID string, libraryAssetID string, portraitAssetID string) error {
	s.storageMu.Lock()
	defer s.storageMu.Unlock()
	_, err := s.repo.UpdateUserAssetPayload(userID, libraryAssetID, func(record *model.Asset, payload map[string]any) (bool, error) {
		certification, _ := payload["arkCertification"].(map[string]any)
		if certification == nil {
			return false, nil
		}
		if id, _ := certification["portraitAssetId"].(string); id != "" && id != portraitAssetID {
			return false, nil
		}
		previous, _ := certification["previousCategory"].(string)
		delete(payload, "arkCertification")
		delete(payload, "arkAssetId")
		if record.Category == model.AssetCategoryArk {
			restored := model.NormalizeAssetCategory(model.AssetCategory(previous), record.Kind)
			if restored == model.AssetCategoryArk {
				restored = model.NormalizeAssetCategory("", record.Kind)
			}
			record.Category = restored
		}
		return true, nil
	})
	return err
}

// copyArkResourceForUser 把平台素材的图片复制成用户自己的资源；上传幂等键绑定方舟素材，重复加入复用同一份文件。
func (s *Service) copyArkResourceForUser(userID string, asset model.ArkPortraitAsset) (*model.Resource, error) {
	uploadKey := normalizedResourceUploadKey([]string{"ark-portrait:" + asset.ID})
	existing, err := s.resourceForUploadKey(userID, uploadKey)
	if err != nil {
		return nil, err
	}
	if existing != nil && existing.Status == model.ResourceStatusReady {
		return existing, nil
	}
	if existing != nil && existing.Status == model.ResourceStatusPending {
		return nil, resourceUploadInProgress()
	}
	source, body, err := s.OpenResource(asset.UserID, asset.ResourceID)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, NotFound("该方舟素材的原图已被删除，无法加入素材库")
		}
		return nil, err
	}
	defer body.Close()
	data, err := io.ReadAll(io.LimitReader(body, arkPortraitMaxImageBytes+1))
	if err != nil {
		return nil, err
	}
	if len(data) > arkPortraitMaxImageBytes {
		return nil, BadAuthRequest("方舟素材图片超过 30MB，无法加入素材库")
	}
	return s.storeFetchedResource(userID, existing, uploadKey, fmt.Sprintf("ark-%s%s", asset.ID, arkImageExtension(source.MimeType)), data, source.Width, source.Height, 0)
}

func arkImageExtension(mimeType string) string {
	switch strings.ToLower(strings.TrimSpace(mimeType)) {
	case "image/jpeg", "image/jpg":
		return ".jpg"
	case "image/png":
		return ".png"
	case "image/webp":
		return ".webp"
	case "image/gif":
		return ".gif"
	default:
		return ""
	}
}
