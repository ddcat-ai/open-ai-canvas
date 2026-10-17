package canvas

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"time"
	"unicode/utf8"
	"yingce/backend/internal/kernel"

	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"

	"gorm.io/gorm"
)

type AssetsSyncRequest struct {
	Assets []json.RawMessage `json:"assets"`
}

type UserDataSummary struct {
	ID        string           `json:"id"`
	FolderID  string           `json:"folderId,omitempty"`
	Kind      string           `json:"kind,omitempty"`
	Category  string           `json:"category,omitempty"`
	Status    string           `json:"status,omitempty"`
	Title     string           `json:"title"`
	CreatedAt time.Time        `json:"createdAt"`
	UpdatedAt time.Time        `json:"updatedAt"`
	Revision  int64            `json:"revision,omitempty"`
	SaveAudit *CanvasSaveAudit `json:"-"`
}

type CanvasSaveAudit struct {
	NodesBefore int
	NodesAfter  int
}

func canvasNodeCount(payload string) int {
	var document struct {
		Nodes []json.RawMessage `json:"nodes"`
	}
	_ = json.Unmarshal([]byte(payload), &document)
	return len(document.Nodes)
}

type UserDataSnapshot struct {
	Assets   []json.RawMessage `json:"assets"`
	Projects []json.RawMessage `json:"projects"`
}

func (s *Service) UserDataSnapshot(userID string) (UserDataSnapshot, error) {
	assets, err := s.UserAssets(userID)
	if err != nil {
		return UserDataSnapshot{}, err
	}
	projects, err := s.UserCanvasProjects(userID)
	if err != nil {
		return UserDataSnapshot{}, err
	}
	return UserDataSnapshot{Assets: assets, Projects: projects}, nil
}

func (s *Service) UserAssetSummaries(userID string) ([]UserDataSummary, error) {
	assets, err := s.repo.AssetSummaries(userID)
	if err != nil {
		return nil, err
	}
	result := make([]UserDataSummary, 0, len(assets))
	for _, asset := range assets {
		result = append(result, UserDataSummary{ID: asset.ID, FolderID: asset.FolderID, Kind: asset.Kind, Category: string(asset.Category), Status: string(asset.Status), Title: asset.Title, CreatedAt: asset.CreatedAt, UpdatedAt: asset.UpdatedAt})
	}
	return result, nil
}

func (s *Service) UserAsset(userID string, id string) (json.RawMessage, error) {
	asset, err := s.repo.AssetForUser(userID, id)
	if err != nil {
		return nil, err
	}
	return ClientAssetPayload(*asset), nil
}

func (s *Service) UpsertUserAsset(userID string, raw json.RawMessage) (UserDataSummary, error) {
	asset, err := AssetFromJSON(userID, raw)
	if err != nil {
		return UserDataSummary{}, err
	}
	err = s.host.WithStorageLock(func() error {
		if asset.FolderID != "" {
			if _, err := s.repo.AssetFolderForUser(userID, asset.FolderID); err != nil {
				if errors.Is(err, gorm.ErrRecordNotFound) {
					return kernel.BadAuthRequest("素材分类不存在")
				}
				return err
			}
		}
		existing, existingErr := s.repo.AssetForUser(userID, asset.ID)
		if existingErr != nil && !errors.Is(existingErr, gorm.ErrRecordNotFound) {
			return existingErr
		}
		if existing != nil && existing.PayloadJSON != asset.PayloadJSON {
			if err := s.ValidateAssetCanvasReferences(userID, asset); err != nil {
				return err
			}
		}
		existingBytes := int64(0)
		if existing != nil {
			existingBytes = int64(len([]byte(existing.PayloadJSON)))
		}
		if err := s.host.StructuredQuota(userID, "asset", errors.Is(existingErr, gorm.ErrRecordNotFound), int64(len(raw))-existingBytes); err != nil {
			return err
		}
		if err := s.repo.UpsertAsset(&asset); err != nil {
			return err
		}
		if existingErr != nil {
			s.host.RecordActivity(userID, "asset", 1)
		}
		return nil
	})
	if err != nil {
		return UserDataSummary{}, err
	}
	return UserDataSummary{ID: asset.ID, FolderID: asset.FolderID, Kind: asset.Kind, Category: string(asset.Category), Status: string(asset.Status), Title: asset.Title, CreatedAt: asset.CreatedAt, UpdatedAt: asset.UpdatedAt}, nil
}

func (s *Service) DeleteUserAsset(userID string, id string) error {
	return s.host.WithStorageLock(func() error {
		return s.host.DeleteUserAssetWithResources(userID, id, false)
	})
}

func (s *Service) PurgeUserAsset(userID string, id string) error {
	return s.PurgeUserAssets(userID, []string{id})
}

func (s *Service) PurgeUserAssets(userID string, ids []string) error {
	return s.host.WithStorageLock(func() error {
		return s.host.PurgeUserAssetsWithResources(userID, ids)
	})
}

func (s *Service) UserAssets(userID string) ([]json.RawMessage, error) {
	assets, err := s.repo.Assets(userID)
	if err != nil {
		return nil, err
	}
	result := make([]json.RawMessage, 0, len(assets))
	for _, asset := range assets {
		if payload := ClientAssetPayload(asset); len(payload) > 0 {
			result = append(result, payload)
		}
	}
	return result, nil
}

func (s *Service) ReplaceUserAssets(userID string, req AssetsSyncRequest) ([]json.RawMessage, error) {
	assets := make([]model.Asset, 0, len(req.Assets))
	var totalBytes int64
	for _, raw := range req.Assets {
		item, err := AssetFromJSON(userID, raw)
		if err != nil {
			return nil, err
		}
		assets = append(assets, item)
		totalBytes += int64(len(raw))
	}
	err := s.host.WithStorageLock(func() error {
		if err := s.ValidateAssetReplacementCanvasReferences(userID, assets); err != nil {
			return err
		}
		if err := s.host.StructuredReplacementQuota(userID, "asset", len(assets), totalBytes); err != nil {
			return err
		}
		if err := s.repo.ReplaceAssets(userID, assets); err != nil {
			return err
		}
		if len(assets) > 0 {
			s.host.RecordActivity(userID, "asset", len(assets))
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	return s.UserAssets(userID)
}

func (s *Service) UserCanvasProjects(userID string) ([]json.RawMessage, error) {
	projects, err := s.repo.CanvasProjects(userID)
	if err != nil {
		return nil, err
	}
	result := make([]json.RawMessage, 0, len(projects))
	for _, project := range projects {
		if strings.TrimSpace(project.PayloadJSON) != "" {
			payload, err := canvasProjectPayload(project)
			if err != nil {
				return nil, err
			}
			result = append(result, payload)
		}
	}
	return result, nil
}

func (s *Service) UserCanvasProjectSummaries(userID string) ([]UserDataSummary, error) {
	projects, err := s.repo.CanvasProjectSummaries(userID)
	if err != nil {
		return nil, err
	}
	result := make([]UserDataSummary, 0, len(projects))
	for _, project := range projects {
		result = append(result, UserDataSummary{ID: project.ID, Title: project.Title, CreatedAt: project.CreatedAt, UpdatedAt: project.UpdatedAt, Revision: project.Revision})
	}
	return result, nil
}

func (s *Service) UserCanvasProjectMetadata(userID string, id string) (*model.CanvasProject, error) {
	return s.repo.CanvasProjectMetadataForUser(userID, id)
}

func (s *Service) UserCanvasProject(userID string, id string) (json.RawMessage, error) {
	project, err := s.repo.CanvasProjectForUser(userID, id)
	if err != nil {
		return nil, err
	}
	return canvasProjectPayload(*project)
}

func (s *Service) UpsertUserCanvasProject(userID string, raw json.RawMessage) (UserDataSummary, error) {
	return s.upsertUserCanvasProjectWithHistory(userID, raw, "automatic")
}

type canvasMutationReceiptResult struct {
	Summary  UserDataSummary `json:"summary"`
	Document json.RawMessage `json:"document"`
}

func decodeCanvasMutationReceipt(raw string, result *UserDataSummary) error {
	var stored canvasMutationReceiptResult
	if err := json.Unmarshal([]byte(raw), &stored); err == nil && stored.Summary.ID != "" {
		*result = stored.Summary
		return nil
	}
	return json.Unmarshal([]byte(raw), result)
}

// ApplyUserCanvasOperations applies only the objects changed by the caller to the
// latest server document. The request is idempotent by mutation ID and commits
// the canvas row plus its receipt in one database transaction.
func (s *Service) ApplyUserCanvasOperations(userID, canvasID string, req CanvasOperationsRequest) (UserDataSummary, error) {
	if canvasID == "" || len(canvasID) > 80 || req.MutationID == "" || len(req.MutationID) > 160 || len(req.Operations) == 0 || len(req.Operations) > 500 {
		return UserDataSummary{}, kernel.BadAuthRequest("画布操作请求 ID、操作内容或批次大小无效")
	}
	if req.BaseRevision != nil && (*req.BaseRevision < 0 || *req.BaseRevision >= 9007199254740991) {
		return UserDataSummary{}, kernel.BadAuthRequest("画布基线版本无效")
	}
	if len(req.EditProofs) > 500 {
		return UserDataSummary{}, kernel.BadAuthRequest("画布编辑凭据数量超出限制")
	}
	seenProofs := make(map[string]bool, len(req.EditProofs))
	for _, proof := range req.EditProofs {
		if proof.NodeID == "" || len(proof.NodeID) > 160 || proof.SessionID == "" || len(proof.SessionID) > 160 || proof.Token == "" || len(proof.Token) > 80 || seenProofs[proof.NodeID] {
			return UserDataSummary{}, kernel.BadAuthRequest("画布编辑凭据无效或重复")
		}
		seenProofs[proof.NodeID] = true
	}
	quota, err := s.host.CanvasQuotaCheck(userID)
	if err != nil {
		return UserDataSummary{}, err
	}
	digest := CanvasOperationsDigest(req)
	var result UserDataSummary
	err = s.host.WithStorageLock(func() error {
		return s.repo.Transaction(func(tx *repository.Repository) error {
			tx = tx.WithCanvasEditProofs(req.EditProofs)
			if err := tx.LockCanvasMutation(userID, canvasID); err != nil {
				return err
			}
			candidate := &model.CanvasMutationReceipt{ID: kernel.NewID(), UserID: userID, CanvasID: canvasID, MutationID: req.MutationID, PayloadDigest: digest}
			created, err := tx.TryCreateCanvasMutationReceipt(candidate)
			if err != nil {
				return err
			}
			if !created {
				receipt, err := tx.CanvasMutationReceiptForUser(userID, canvasID, req.MutationID)
				if err != nil {
					return err
				}
				if receipt.PayloadDigest != digest {
					return canvasMutationError("canvas_mutation_id_reused", "同一画布请求 ID 对应的操作内容不一致")
				}
				return decodeCanvasMutationReceipt(receipt.ResultJSON, &result)
			}
			existing, err := tx.CanvasProjectForUser(userID, canvasID)
			if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
				return err
			}
			if errors.Is(err, gorm.ErrRecordNotFound) {
				existing = nil
			}
			isCreate := existing == nil
			if isCreate && (len(req.Operations) == 0 || req.Operations[0].Type != "create_canvas") {
				return kernel.NotFound("画布不存在或已删除")
			}
			if !isCreate {
				for _, operation := range req.Operations {
					if operation.Type == "create_canvas" {
						return canvasOperationConflict("画布 %q 已存在，不能重复创建", canvasID)
					}
				}
			}
			if req.BaseRevision != nil && *req.BaseRevision > 0 && isCreate {
				return canvasMutationError("canvas_invalid_base", "新画布不能使用已有版本作为基线")
			}
			now := time.Now().UTC()
			var payload map[string]json.RawMessage
			var operations []CanvasOperation
			if isCreate {
				create := req.Operations[0]
				if create.ID != "" && create.ID != canvasID {
					return kernel.BadAuthRequest("画布创建操作的 ID 与请求路径不一致")
				}
				payload = map[string]json.RawMessage{
					"id":          jsonRawValue(canvasID),
					"nodes":       json.RawMessage(`[]`),
					"connections": json.RawMessage(`[]`),
				}
				for field, value := range create.Patch {
					if !allowedCanvasOperationField(field) {
						return kernel.BadAuthRequest("不支持的新画布字段")
					}
					payload[field] = append(json.RawMessage(nil), value...)
				}
				operations = req.Operations[1:]
			} else {
				// 客户端的 beforeValue 来自 GET 返回的投影（title/projectId 等以数据库列为准），
				// 字段基线校验必须对同一份投影进行，否则 projectId 列为 "" 而 payload 缺省时会误判冲突。
				base, err := canvasProjectPayload(*existing)
				if err != nil {
					return err
				}
				if err := json.Unmarshal(base, &payload); err != nil {
					return err
				}
				operations = req.Operations
			}
			if err := applyCanvasOperations(payload, operations); err != nil {
				if errors.Is(err, ErrCanvasObjectMissing) || errors.Is(err, ErrCanvasOperationConflict) {
					return err
				}
				return kernel.BadAuthRequest(err.Error())
			}
			delete(payload, "revision")
			delete(payload, "remoteContentHash")
			payload["id"] = jsonRawValue(canvasID)
			payload["updatedAt"] = jsonRawValue(now)
			raw, err := json.Marshal(payload)
			if err != nil {
				return err
			}
			if !req.TrustedServerMutation {
				if err := New(tx, nil).ValidateCanvasMediaAssets(userID, raw); err != nil {
					return err
				}
			}
			project, err := canvasProjectFromJSONWithValidation(userID, raw, !req.TrustedServerMutation)
			if err != nil {
				return err
			}
			if project.ID != canvasID {
				return kernel.BadAuthRequest("画布 ID 与请求路径不一致")
			}
			if existing != nil {
				project.ID, project.CreatedAt, project.Revision, project.UpdatedAt = existing.ID, existing.CreatedAt, existing.Revision, now
			} else {
				project.CreatedAt, project.Revision, project.UpdatedAt = now, 0, now
			}
			var existingPayload string
			if existing != nil {
				existingPayload = existing.PayloadJSON
			}
			if err := quota(tx, existing == nil, int64(len(raw)-len(existingPayload))); err != nil {
				return err
			}
			if err := tx.UpsertCanvasProject(&project); err != nil {
				return err
			}
			result = UserDataSummary{ID: project.ID, Title: project.Title, CreatedAt: project.CreatedAt, UpdatedAt: project.UpdatedAt, Revision: project.Revision,
				SaveAudit: &CanvasSaveAudit{NodesBefore: canvasNodeCount(existingPayload), NodesAfter: canvasNodeCount(project.PayloadJSON)}}
			document, err := canvasProjectPayload(project)
			if err != nil {
				return err
			}
			encoded, err := json.Marshal(canvasMutationReceiptResult{Summary: result, Document: document})
			if err != nil {
				return err
			}
			candidate.ResultJSON, candidate.Revision = string(encoded), project.Revision
			return tx.FinalizeCanvasMutationReceipt(candidate)
		})
	})
	if errors.Is(err, ErrCanvasObjectMissing) {
		return UserDataSummary{}, canvasMutationError("canvas_object_missing", err.Error())
	}
	if errors.Is(err, ErrCanvasOperationConflict) {
		return UserDataSummary{}, canvasMutationError("canvas_field_conflict", err.Error())
	}
	if errors.Is(err, repository.ErrCanvasRevisionConflict) {
		retry := canvasMutationError("canvas_concurrent_write", "画布正在更新，将自动重放原请求")
		retry.Retryable = true
		return UserDataSummary{}, retry
	}
	if errors.Is(err, repository.ErrCanvasEditLease) {
		return UserDataSummary{}, canvasMutationError("canvas_edit_lease_conflict", err.Error())
	}
	return result, err
}

func canvasMutationError(reason kernel.ErrorReason, message string) *kernel.AppError {
	err := kernel.NewAppError(http.StatusConflict, message)
	err.Reason = reason
	return err
}

func (s *Service) upsertUserCanvasProjectWithHistory(userID string, raw json.RawMessage, reason string) (UserDataSummary, error) {
	var version struct {
		Revision *int64 `json:"revision"`
	}
	if err := json.Unmarshal(raw, &version); err != nil {
		return UserDataSummary{}, kernel.BadAuthRequest("画布版本格式错误")
	}
	if version.Revision == nil {
		return UserDataSummary{}, kernel.NewAppError(http.StatusPreconditionRequired, "缺少画布版本，请保留本地草稿后重新加载画布")
	}
	if *version.Revision < 0 || *version.Revision >= 9007199254740991 {
		return UserDataSummary{}, kernel.BadAuthRequest("画布版本无效")
	}
	project, err := canvasProjectFromJSON(userID, raw)
	if err != nil {
		return UserDataSummary{}, err
	}
	var audit CanvasSaveAudit
	err = s.host.WithStorageLock(func() error {
		if err := s.ValidateCanvasMediaAssets(userID, raw); err != nil {
			return err
		}
		existing, existingErr := s.repo.CanvasProjectForUser(userID, project.ID)
		if existingErr != nil && !errors.Is(existingErr, gorm.ErrRecordNotFound) {
			return existingErr
		}
		existingBytes := int64(0)
		project.Revision = *version.Revision
		project.UpdatedAt = time.Now().UTC()
		if existing != nil {
			existingBytes = int64(len([]byte(existing.PayloadJSON)))
			project.CreatedAt = existing.CreatedAt
		}
		if (existing == nil && project.Revision != 0) || (existing != nil && project.Revision != existing.Revision) {
			return canvasRevisionConflict()
		}
		var payload map[string]json.RawMessage
		if err := json.Unmarshal(raw, &payload); err != nil {
			return err
		}
		delete(payload, "revision")
		delete(payload, "remoteContentHash")
		payload["viewport"] = json.RawMessage(`{"x":0,"y":0,"k":1}`)
		if existing != nil {
			var previous map[string]json.RawMessage
			if json.Unmarshal([]byte(existing.PayloadJSON), &previous) == nil && previous["viewport"] != nil {
				payload["viewport"] = previous["viewport"]
			}
		}
		payload["createdAt"], _ = json.Marshal(project.CreatedAt)
		payload["updatedAt"], _ = json.Marshal(project.UpdatedAt)
		cleaned, err := json.Marshal(payload)
		if err != nil {
			return err
		}
		project.PayloadJSON = string(cleaned)
		if err := s.host.StructuredQuota(userID, "canvas", errors.Is(existingErr, gorm.ErrRecordNotFound), int64(len(cleaned))-existingBytes); err != nil {
			return err
		}
		if err := SaveDocumentWithHistory(s.repo, existing, &project, reason); err != nil {
			if errors.Is(err, repository.ErrCanvasEditLease) {
				return canvasMutationError("canvas_edit_lease_conflict", err.Error())
			}
			if errors.Is(err, repository.ErrCanvasRevisionConflict) {
				return canvasRevisionConflict()
			}
			var missing *repository.CanvasHistoryResourceMissingError
			if errors.As(err, &missing) {
				return canvasResourcesMissingError(missing.References)
			}
			return err
		}
		audit.NodesAfter = canvasNodeCount(project.PayloadJSON)
		if existing != nil {
			audit.NodesBefore = canvasNodeCount(existing.PayloadJSON)
		}
		if existingErr != nil || existing.PayloadJSON != project.PayloadJSON || existing.Title != project.Title {
			s.host.RecordActivity(userID, "canvas", 1)
		}
		return nil
	})
	if err != nil {
		return UserDataSummary{}, err
	}
	return UserDataSummary{ID: project.ID, Title: project.Title, CreatedAt: project.CreatedAt, UpdatedAt: project.UpdatedAt, Revision: project.Revision, SaveAudit: &audit}, nil
}

func (s *Service) DeleteUserCanvasProject(userID string, id string) error {
	err := s.repo.DeleteCanvasProject(userID, id)
	if errors.Is(err, repository.ErrCanvasEditLease) {
		return canvasMutationError("canvas_edit_lease_conflict", err.Error())
	}
	return err
}

func AssetFromJSON(userID string, raw json.RawMessage) (model.Asset, error) {
	if err := ValidateSyncedPayload(raw, "素材"); err != nil {
		return model.Asset{}, err
	}
	var payload struct {
		ID               string `json:"id"`
		FolderID         string `json:"folderId"`
		Kind             string `json:"kind"`
		Category         string `json:"category"`
		Status           string `json:"status"`
		PrimaryVersionID string `json:"primaryVersionId"`
		Title            string `json:"title"`
		CreatedAt        string `json:"createdAt"`
		UpdatedAt        string `json:"updatedAt"`
	}
	if err := json.Unmarshal(raw, &payload); err != nil {
		return model.Asset{}, kernel.BadAuthRequest("素材数据格式错误")
	}
	now := time.Now()
	createdAt := parseClientTime(payload.CreatedAt, now)
	updatedAt := parseClientTime(payload.UpdatedAt, createdAt)
	id := strings.TrimSpace(payload.ID)
	if id == "" {
		id = kernel.NewID()
	}
	if utf8.RuneCountInString(id) > model.AssetIDMaxLength {
		return model.Asset{}, kernel.BadAuthRequest("素材 ID 不能超过 80 个字符")
	}
	primaryVersionID := strings.TrimSpace(payload.PrimaryVersionID)
	if utf8.RuneCountInString(primaryVersionID) > 36 {
		return model.Asset{}, kernel.BadAuthRequest("素材主版本 ID 不能超过 36 个字符")
	}
	if err := validateUserAssetDocument(raw); err != nil {
		return model.Asset{}, err
	}
	category := model.NormalizeAssetCategory(model.AssetCategory(payload.Category), payload.Kind)
	status := model.AssetVersionStatus(strings.TrimSpace(payload.Status))
	if status == "" {
		status = model.AssetVersionStatusConfirmed
	}
	return model.Asset{
		ID:               id,
		UserID:           userID,
		FolderID:         strings.TrimSpace(payload.FolderID),
		Kind:             strings.TrimSpace(payload.Kind),
		Category:         category,
		Status:           status,
		PrimaryVersionID: primaryVersionID,
		Title:            strings.TrimSpace(payload.Title),
		PayloadJSON:      string(raw),
		CreatedAt:        createdAt,
		UpdatedAt:        updatedAt,
	}, nil
}

func canvasProjectFromJSON(userID string, raw json.RawMessage) (model.CanvasProject, error) {
	return canvasProjectFromJSONWithValidation(userID, raw, true)
}

func canvasProjectFromJSONWithValidation(userID string, raw json.RawMessage, validate bool) (model.CanvasProject, error) {
	if validate {
		if err := ValidateSyncedPayload(raw, "画布"); err != nil {
			return model.CanvasProject{}, err
		}
	}
	var payload struct {
		ID        string `json:"id"`
		Title     string `json:"title"`
		ProjectID string `json:"projectId"`
		CreatedAt string `json:"createdAt"`
		UpdatedAt string `json:"updatedAt"`
	}
	if err := json.Unmarshal(raw, &payload); err != nil {
		return model.CanvasProject{}, kernel.BadAuthRequest("画布数据格式错误")
	}
	now := time.Now()
	createdAt := parseClientTime(payload.CreatedAt, now)
	updatedAt := parseClientTime(payload.UpdatedAt, createdAt)
	id := strings.TrimSpace(payload.ID)
	if id == "" {
		id = kernel.NewID()
	}
	return model.CanvasProject{
		ID:          id,
		UserID:      userID,
		ProjectID:   strings.TrimSpace(payload.ProjectID),
		Title:       strings.TrimSpace(payload.Title),
		PayloadJSON: string(raw),
		CreatedAt:   createdAt,
		UpdatedAt:   updatedAt,
	}, nil
}

func ValidateSyncedPayload(raw json.RawMessage, label string) error {
	if len(raw) > 4<<20 {
		return kernel.BadAuthRequest(label + "数据超过 4MB，请先把媒体文件保存到资源存储")
	}
	var payload interface{}
	if err := json.Unmarshal(raw, &payload); err == nil && ContainsInlineMediaDataURL(payload) {
		return kernel.BadAuthRequest(label + "数据包含内嵌媒体，请先上传到资源存储")
	}
	return nil
}

// 同步数据只禁止作为字段值存在的媒体 Data URL；提示词和上游错误文案可能合法提到相同字符串。
func ContainsInlineMediaDataURL(value interface{}) bool {
	switch item := value.(type) {
	case string:
		text := strings.ToLower(strings.TrimSpace(item))
		return strings.HasPrefix(text, "data:image/") || strings.HasPrefix(text, "data:video/") || strings.HasPrefix(text, "data:audio/")
	case []interface{}:
		for _, child := range item {
			if ContainsInlineMediaDataURL(child) {
				return true
			}
		}
	case map[string]interface{}:
		for _, child := range item {
			if ContainsInlineMediaDataURL(child) {
				return true
			}
		}
	}
	return false
}

func parseClientTime(value string, fallback time.Time) time.Time {
	value = strings.TrimSpace(value)
	if value == "" {
		return fallback
	}
	if parsed, err := time.Parse(time.RFC3339Nano, value); err == nil {
		return parsed
	}
	return fallback
}
