package app

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"net/url"
	"strings"
	"time"

	"gorm.io/gorm"
	"yingce/backend/internal/canvas"
	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"
)

type PublishTeamAssetsRequest struct {
	AssetIDs       []string `json:"assetIds"`
	IdempotencyKey string   `json:"idempotencyKey"`
}

type TeamAssetPublicationError struct {
	Code   int    `json:"code"`
	Msg    string `json:"msg"`
	Reason string `json:"reason,omitempty"`
}

type PublishedAsset struct {
	ID               string `json:"id"`
	PrimaryVersionID string `json:"primaryVersionId"`
}

type TeamAssetPublicationResult struct {
	SourceAssetID string                     `json:"sourceAssetId"`
	PublicationID string                     `json:"publicationId,omitempty"`
	Asset         *PublishedAsset            `json:"asset,omitempty"`
	Error         *TeamAssetPublicationError `json:"error,omitempty"`
}

type PublishTeamAssetsResult struct {
	Results []TeamAssetPublicationResult `json:"results"`
}

func (s *Service) PublishTeamAssets(ctx context.Context, userID, teamID string, req PublishTeamAssetsRequest) (*PublishTeamAssetsResult, error) {
	if _, err := s.requireTeamMember(userID, teamID, false); err != nil {
		return nil, err
	}
	req.IdempotencyKey = strings.TrimSpace(req.IdempotencyKey)
	if req.IdempotencyKey == "" || len(req.IdempotencyKey) > 128 || len(req.AssetIDs) < 1 || len(req.AssetIDs) > 20 {
		return nil, BadAuthRequest("请选择 1–20 个素材并提供有效发布幂等键")
	}
	seen := map[string]bool{}
	for _, id := range req.AssetIDs {
		if id == "" || len(id) > model.AssetIDMaxLength || strings.TrimSpace(id) != id || seen[id] {
			return nil, BadAuthRequest("素材 ID 不能为空、重复或超过长度限制")
		}
		seen[id] = true
	}
	encoded, err := json.Marshal(struct {
		UserID   string   `json:"userId"`
		AssetIDs []string `json:"assetIds"`
	}{userID, req.AssetIDs})
	if err != nil {
		return nil, err
	}
	requestHash := teamAssetDigest(encoded)
	result := &PublishTeamAssetsResult{Results: []TeamAssetPublicationResult{}}
	for _, id := range req.AssetIDs {
		item := TeamAssetPublicationResult{SourceAssetID: id}
		item.Asset, item.PublicationID, err = s.publishTeamAsset(ctx, userID, teamID, id, req.IdempotencyKey, requestHash)
		if err != nil {
			item.Error = &TeamAssetPublicationError{Code: 500, Msg: "素材发布失败，请稍后重试", Reason: "team_publication_failed"}
			var appErr *AppError
			if errors.As(err, &appErr) {
				item.Error = &TeamAssetPublicationError{Code: appErr.Code, Msg: appErr.Message, Reason: string(appErr.Reason)}
			}
		}
		result.Results = append(result.Results, item)
	}
	return result, nil
}

func teamAssetDigest(data []byte) string {
	digest := sha256.Sum256(data)
	return hex.EncodeToString(digest[:])
}

func (s *Service) publishTeamAsset(ctx context.Context, actorID, teamID, sourceID, batchKey, requestHash string) (*PublishedAsset, string, error) {
	key := teamAssetDigest([]byte(batchKey + "\x00" + sourceID))
	ownerKey := model.TeamContentKey(teamID)
	var publication *model.TeamAssetPublication
	var media, target *model.Resource
	var source *model.Asset
	var payload struct {
		Data struct {
			Content    string
			StorageKey string
		}
	}
	err := s.withTeamWrite(actorID, teamID, false, func(tx *repository.Repository, _ *model.TeamMembership) error {
		batch, err := tx.TeamAssetPublicationBatch(teamID, batchKey)
		if err == nil && batch.RequestHash != requestHash {
			return teamError(409, "team_publication_conflict", "发布标识已用于其他请求")
		}
		if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
			return err
		}
		publication, err = tx.TeamAssetPublicationByKey(teamID, key)
		if err == nil {
			if publication.Status == model.TeamAssetReady {
				return nil
			}
			return teamError(409, "team_publication_"+ErrorReason(publication.Status), "该发布请求未完成，请检查发布状态")
		}
		if !errors.Is(err, gorm.ErrRecordNotFound) {
			return err
		}
		source, err = tx.LockPersonalAssetForTeamPublication(actorID, sourceID)
		if err != nil {
			return teamNotFound(err)
		}
		if source.Status == model.AssetVersionStatusArchived {
			return BadAuthRequest("请先恢复已归档的素材")
		}
		if err := json.Unmarshal([]byte(source.PayloadJSON), &payload); err != nil {
			return BadAuthRequest("素材数据格式错误")
		}
		publication = &model.TeamAssetPublication{ID: newID(), TeamID: teamID, PublishedBy: actorID, BatchKey: batchKey, IdempotencyKey: key, RequestHash: requestHash, SourceAssetID: sourceID, Status: model.TeamAssetPending, ExpiresAt: time.Now().Add(15 * time.Minute)}
		switch source.Kind {
		case "text":
			if strings.TrimSpace(payload.Data.Content) == "" {
				return BadAuthRequest("文本内容不能为空")
			}
		case "image", "video", "audio":
			id, ok := strings.CutPrefix(payload.Data.StorageKey, "resource:")
			if !ok || id == "" {
				return BadAuthRequest("请先上传素材媒体再共享")
			}
			media, err = tx.ResourceForUser(actorID, id)
			if err != nil {
				return teamNotFound(err)
			}
			if media.Status != model.ResourceStatusReady || media.Size <= 0 || !strings.HasPrefix(media.MimeType, source.Kind+"/") {
				return BadAuthRequest("素材媒体未就绪或类型不匹配")
			}
			publication.SourceResourceID = &media.ID
		default:
			return BadAuthRequest("仅支持发布文本、图片、视频和音频素材")
		}
		return tx.BeginTeamAssetPublication(publication)
	})
	if err != nil {
		return nil, "", err
	}
	if publication.Status == model.TeamAssetReady {
		return &PublishedAsset{publication.AssetID, publication.VersionID}, publication.ID, nil
	}
	data := map[string]any{"content": payload.Data.Content}
	if media != nil {
		target, err = s.copyPublishedResource(ctx, ownerKey, media)
		if err == nil {
			data = map[string]any{"storageKey": "resource:" + target.ID, "bytes": target.Size, "mimeType": target.MimeType, "width": target.Width, "height": target.Height, "durationMs": target.DurationMs}
			fileURL := "/api/teams/" + url.PathEscape(teamID) + "/workspace/resources/" + url.PathEscape(target.ID) + "/file"
			if source.Kind == "image" {
				data["dataUrl"] = fileURL
			} else {
				data["url"] = fileURL
			}
		}
	}
	var assetID string
	versionID := newID()
	if err == nil {
		err = s.withTeamWrite(actorID, teamID, false, func(tx *repository.Repository, _ *model.TeamMembership) error {
			asset, err := tx.PublishedAssetForSource(teamID, actorID, sourceID)
			creating := errors.Is(err, gorm.ErrRecordNotFound)
			if err != nil && !creating {
				return err
			}
			if !creating && asset.Status == model.AssetVersionStatusArchived {
				return BadAuthRequest("请先恢复目标空间中已归档的素材")
			}
			now := time.Now().UTC()
			created, folderID, previousSize := now, "", 0
			if creating {
				assetID = newID()
			} else {
				assetID, created, folderID, previousSize = asset.ID, asset.CreatedAt, asset.FolderID, len(asset.PayloadJSON)
			}
			raw, err := json.Marshal(map[string]any{"id": assetID, "kind": source.Kind, "title": source.Title, "category": model.AssetCategoryMaterial, "status": model.AssetVersionStatusConfirmed, "primaryVersionId": versionID, "folderId": folderID, "data": data, "coverUrl": "", "tags": []string{}, "createdAt": created, "updatedAt": now})
			if err != nil {
				return err
			}
			item, err := canvas.AssetFromJSON(ownerKey, raw)
			if err != nil {
				return err
			}
			item.CreatedBy = actorID
			policy, err := s.RuntimePolicy()
			if err != nil {
				return err
			}
			usage, err := tx.UserStructuredStorageUsage(ownerKey)
			if err != nil {
				return err
			}
			if err := validateStructuredStorageQuotaWithPolicy(usage, "asset", creating, int64(len(raw)-previousSize), policy.Resource); err != nil {
				return err
			}
			return tx.CompleteTeamAssetPublication(publication.ID, &item, versionID)
		})
	}
	if err != nil {
		if target != nil {
			cleanupErr := s.deleteStoredResourceObject(ownerKey, target)
			if cleanupErr == nil {
				cleanupErr = s.repo.DeleteResource(ownerKey, target.ID)
			}
			err = errors.Join(err, cleanupErr)
		}
		return nil, publication.ID, errors.Join(err, s.repo.FailTeamAssetPublication(publication.ID, "发布失败"))
	}
	return &PublishedAsset{assetID, versionID}, publication.ID, nil
}

func (s *Service) copyPublishedResource(ctx context.Context, ownerKey string, source *model.Resource) (*model.Resource, error) {
	_, body, err := s.OpenResource(source.UserID, source.ID)
	if err != nil {
		return nil, err
	}
	defer body.Close()
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	resource, _, err := s.storeResource(ownerKey, source.Kind, "", source.MimeType, source.Size, source.Width, source.Height, source.DurationMs, &publicationReader{io.LimitedReader{R: body, N: source.Size}}, nil, true)
	return resource, err
}

type publicationReader struct{ io.LimitedReader }

func (reader *publicationReader) Read(buffer []byte) (int, error) {
	count, err := reader.LimitedReader.Read(buffer)
	if err == io.EOF && reader.N != 0 {
		return count, io.ErrUnexpectedEOF
	}
	return count, err
}

func (s *Service) GetTeamAssetPublication(userID, teamID, id string) (*model.TeamAssetPublication, error) {
	if _, err := s.requireTeamMember(userID, teamID, false); err != nil {
		return nil, err
	}
	row, err := s.repo.TeamAssetPublication(teamID, id)
	return row, teamNotFound(err)
}

func (s *Service) UpsertWorkspaceAsset(actorID, teamID string, raw json.RawMessage) (UserDataSummary, error) {
	if teamID == "" {
		return s.UpsertUserAsset(actorID, raw)
	}
	member, err := s.requireTeamMember(actorID, teamID, false)
	if err != nil {
		return UserDataSummary{}, err
	}
	return s.canvasDomain().UpsertAssetAs(model.TeamContentKey(teamID), raw, actorID, member.Role == model.TeamOwner)
}

func (s *Service) DeleteWorkspaceAssets(actorID, teamID string, ids []string) error {
	if teamID == "" {
		return s.PurgeUserAssets(actorID, ids)
	}
	if _, err := s.requireTeamMember(actorID, teamID, true); err != nil {
		return err
	}
	return s.PurgeUserAssets(model.TeamContentKey(teamID), ids)
}

func referencesWorkspaceAsset(raw string, ids map[string]struct{}) (bool, error) {
	var doc any
	if !strings.Contains(raw, `"assetId"`) {
		return false, nil
	}
	if err := json.Unmarshal([]byte(raw), &doc); err != nil {
		return false, err
	}
	var visit func(any) bool
	visit = func(value any) bool {
		switch item := value.(type) {
		case []any:
			for _, child := range item {
				if visit(child) {
					return true
				}
			}
		case map[string]any:
			if id, ok := item["assetId"].(string); ok {
				if _, found := ids[id]; found {
					return true
				}
			}
			for _, child := range item {
				if visit(child) {
					return true
				}
			}
		}
		return false
	}
	return visit(doc), nil
}
