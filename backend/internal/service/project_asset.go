package service

import (
	"encoding/json"
	"strings"
	"time"

	"infinite-canvas/backend/internal/model"
)

type LinkProjectAssetRequest struct {
	AssetID  string  `json:"assetId"`
	Category string  `json:"category"`
	FolderID *string `json:"folderId"`
}

type UpdateProjectAssetRequest struct {
	Category *string `json:"category"`
	FolderID *string `json:"folderId"`
}

type CreateAssetVersionRequest struct {
	Prompt         string `json:"prompt"`
	DefinitionJSON string `json:"definitionJson"`
	Note           string `json:"note"`
}

type ProjectAssetSummary struct {
	ID               string                   `json:"id"`
	Title            string                   `json:"title"`
	MediaType        string                   `json:"mediaType"`
	Category         model.AssetCategory      `json:"category"`
	Status           model.AssetVersionStatus `json:"status"`
	PrimaryVersionID string                   `json:"primaryVersionId,omitempty"`
	VersionCount     int                      `json:"versionCount"`
	Usages           []string                 `json:"usages"`
	FolderID         string                   `json:"folderId,omitempty"`
	Position         int                      `json:"position"`
	StorageKey       string                   `json:"storageKey,omitempty"`
	PreviewText      string                   `json:"previewText,omitempty"`
	UpdatedAt        time.Time                `json:"updatedAt"`
	Character        *CharacterCardSummary    `json:"character,omitempty"`
}

type ProjectAssetFilter struct {
	Category  string
	MediaType string
	Status    string
	Usage     string
}

type ConfirmProjectAssetCandidateRequest struct {
	AssetID string `json:"assetId"`
}

func (s *Service) FilterProjectAssets(userID string, projectID string, filter ProjectAssetFilter) ([]ProjectAssetSummary, error) {
	assets, err := s.ProjectAssets(userID, projectID)
	if err != nil {
		return nil, err
	}
	result := make([]ProjectAssetSummary, 0, len(assets))
	for _, asset := range assets {
		if filter.Category != "" && string(asset.Category) != filter.Category {
			continue
		}
		if filter.MediaType != "" && asset.MediaType != filter.MediaType {
			continue
		}
		if filter.Status != "" && string(asset.Status) != filter.Status {
			continue
		}
		if filter.Usage != "" && !containsString(asset.Usages, filter.Usage) {
			continue
		}
		result = append(result, asset)
	}
	return result, nil
}

func (s *Service) ProjectAssets(userID string, projectID string) ([]ProjectAssetSummary, error) {
	assets, err := s.repo.ProjectAssets(userID, projectID)
	if err != nil {
		return nil, err
	}
	result := make([]ProjectAssetSummary, 0, len(assets))
	for _, asset := range assets {
		summary, summaryErr := s.projectAssetSummary(userID, projectID, &asset)
		if summaryErr != nil {
			return nil, summaryErr
		}
		result = append(result, summary)
	}
	return result, nil
}

func (s *Service) LinkProjectAsset(userID string, projectID string, req LinkProjectAssetRequest) (ProjectAssetSummary, error) {
	if _, err := s.repo.ProjectForUser(userID, projectID); err != nil {
		return ProjectAssetSummary{}, err
	}
	assetID := strings.TrimSpace(req.AssetID)
	asset, err := s.repo.AssetForUser(userID, assetID)
	if err != nil {
		return ProjectAssetSummary{}, err
	}
	category := model.AssetCategory(strings.TrimSpace(req.Category))
	if category == "" {
		category = asset.Category
	}
	if !validAssetCategory(category) {
		return ProjectAssetSummary{}, BadAuthRequest("不支持的资产业务分类")
	}
	folderID, err := s.resolveProjectAssetFolderID(projectID, req.FolderID)
	if err != nil {
		return ProjectAssetSummary{}, err
	}
	linked, err := s.repo.ProjectAssetLinked(projectID, asset.ID)
	if err != nil {
		return ProjectAssetSummary{}, err
	}
	if linked {
		return s.projectAssetSummary(userID, projectID, asset)
	}
	now := time.Now()
	asset.Category = category
	if asset.Status == "" {
		asset.Status = model.AssetVersionStatusConfirmed
	}
	versions, err := s.repo.AssetVersions(asset.ID)
	if err != nil {
		return ProjectAssetSummary{}, err
	}
	var initialVersion *model.AssetVersion
	if len(versions) == 0 {
		version := model.AssetVersion{ID: newID(), AssetID: asset.ID, Version: 1, Status: asset.Status, DefinitionJSON: "{}", CreatedAt: now, UpdatedAt: now}
		initialVersion = &version
		asset.PrimaryVersionID = version.ID
		versions = append(versions, version)
	}
	asset.UpdatedAt = now
	position, err := s.repo.NextProjectAssetPosition(projectID, folderID)
	if err != nil {
		return ProjectAssetSummary{}, err
	}
	link := model.ProjectAssetLink{ID: newID(), ProjectID: projectID, AssetID: asset.ID, FolderID: folderID, Position: position, CreatedAt: now}
	created, err := s.repo.LinkProjectAsset(asset, initialVersion, &link)
	if err != nil {
		return ProjectAssetSummary{}, err
	}
	if !created {
		current, currentErr := s.repo.AssetForUser(userID, asset.ID)
		if currentErr != nil {
			return ProjectAssetSummary{}, currentErr
		}
		return s.projectAssetSummary(userID, projectID, current)
	}
	return s.projectAssetSummary(userID, projectID, asset)
}

func (s *Service) UnlinkProjectAsset(userID string, projectID string, assetID string) error {
	if _, err := s.repo.ProjectForUser(userID, projectID); err != nil {
		return err
	}
	asset, err := s.repo.AssetForUser(userID, assetID)
	if err != nil {
		return err
	}
	if asset.Category == model.AssetCategoryCharacter {
		canvases, canvasErr := s.repo.ProjectCanvasDocuments(userID, projectID)
		if canvasErr != nil {
			return canvasErr
		}
		for _, canvas := range canvases {
			referenced, parseErr := canvasReferencesCharacterAsset(canvas.PayloadJSON, assetID)
			if parseErr != nil {
				return BadAuthRequest("画布数据格式错误，无法确认角色引用")
			}
			if referenced {
				return BadAuthRequest("角色仍被项目画布引用，请先删除对应角色卡节点")
			}
		}
	}
	references, err := s.repo.ProjectAssetShotReferenceCount(projectID, assetID)
	if err != nil {
		return err
	}
	if references > 0 {
		return BadAuthRequest("素材仍被项目镜头引用，请先解除镜头用途")
	}
	if err := s.repo.DeleteProjectAssetLink(projectID, assetID); err != nil {
		return err
	}
	return s.repo.BumpProjectRevision(projectID)
}

func canvasReferencesCharacterAsset(payloadJSON string, assetID string) (bool, error) {
	var payload struct {
		Nodes []struct {
			Metadata struct {
				WorkflowKind     string `json:"workflowKind"`
				CharacterAssetID string `json:"characterAssetId"`
			} `json:"metadata"`
		} `json:"nodes"`
	}
	if err := json.Unmarshal([]byte(payloadJSON), &payload); err != nil {
		return false, err
	}
	for _, node := range payload.Nodes {
		if node.Metadata.WorkflowKind == "character" && node.Metadata.CharacterAssetID == assetID {
			return true, nil
		}
	}
	return false, nil
}

func (s *Service) UpdateProjectAsset(userID string, projectID string, assetID string, req UpdateProjectAssetRequest) (ProjectAssetSummary, error) {
	if _, err := s.repo.ProjectForUser(userID, projectID); err != nil {
		return ProjectAssetSummary{}, err
	}
	asset, err := s.repo.AssetForUser(userID, strings.TrimSpace(assetID))
	if err != nil {
		return ProjectAssetSummary{}, err
	}
	linked, err := s.repo.ProjectAssetLinked(projectID, asset.ID)
	if err != nil {
		return ProjectAssetSummary{}, err
	}
	if !linked {
		return ProjectAssetSummary{}, BadAuthRequest("素材尚未加入当前项目")
	}
	if req.Category != nil && req.FolderID != nil {
		return ProjectAssetSummary{}, BadAuthRequest("一次只能修改素材分类或所在文件夹")
	}
	if req.Category != nil {
		category := model.AssetCategory(strings.TrimSpace(*req.Category))
		if !validAssetCategory(category) {
			return ProjectAssetSummary{}, BadAuthRequest("不支持的资产业务分类")
		}
		asset.Category = category
		asset.UpdatedAt = time.Now()
		if err := s.repo.UpdateAssetDomain(asset); err != nil {
			return ProjectAssetSummary{}, err
		}
		if err := s.repo.BumpProjectRevision(projectID); err != nil {
			return ProjectAssetSummary{}, err
		}
	} else if req.FolderID != nil {
		folderID, folderErr := s.resolveProjectAssetFolderID(projectID, req.FolderID)
		if folderErr != nil {
			return ProjectAssetSummary{}, folderErr
		}
		position, positionErr := s.repo.NextProjectAssetPosition(projectID, folderID)
		if positionErr != nil {
			return ProjectAssetSummary{}, positionErr
		}
		if err := s.repo.MoveProjectAsset(projectID, asset.ID, folderID, position); err != nil {
			return ProjectAssetSummary{}, err
		}
	} else {
		return ProjectAssetSummary{}, BadAuthRequest("没有可更新的素材字段")
	}
	return s.projectAssetSummary(userID, projectID, asset)
}

func (s *Service) CreateProjectAssetVersion(userID string, projectID string, assetID string, req CreateAssetVersionRequest) (model.AssetVersion, error) {
	if _, err := s.repo.ProjectForUser(userID, projectID); err != nil {
		return model.AssetVersion{}, err
	}
	asset, err := s.repo.AssetForUser(userID, assetID)
	if err != nil {
		return model.AssetVersion{}, err
	}
	linked, err := s.repo.ProjectAssetLinked(projectID, assetID)
	if err != nil {
		return model.AssetVersion{}, err
	}
	if !linked {
		return model.AssetVersion{}, BadAuthRequest("素材尚未加入当前项目")
	}
	versions, err := s.repo.AssetVersions(assetID)
	if err != nil {
		return model.AssetVersion{}, err
	}
	nextVersion := 1
	if len(versions) > 0 {
		nextVersion = versions[0].Version + 1
	}
	definition := strings.TrimSpace(req.DefinitionJSON)
	if definition == "" {
		definition = "{}"
	}
	if !json.Valid([]byte(definition)) {
		return model.AssetVersion{}, BadAuthRequest("资产版本设定必须是有效 JSON")
	}
	now := time.Now()
	version := model.AssetVersion{ID: newID(), AssetID: assetID, Version: nextVersion, Status: model.AssetVersionStatusDraft, DefinitionJSON: definition, Prompt: strings.TrimSpace(req.Prompt), Note: strings.TrimSpace(req.Note), CreatedAt: now, UpdatedAt: now}
	if err := s.repo.CreateAssetVersion(&version); err != nil {
		return model.AssetVersion{}, err
	}
	asset.PrimaryVersionID = version.ID
	asset.Status = model.AssetVersionStatusDraft
	asset.UpdatedAt = now
	if err := s.repo.UpdateAssetDomain(asset); err != nil {
		return model.AssetVersion{}, err
	}
	if err := s.repo.BumpProjectRevision(projectID); err != nil {
		return model.AssetVersion{}, err
	}
	return version, nil
}

func (s *Service) ConfirmProjectAssetCandidate(userID string, projectID string, candidateID string, req ConfirmProjectAssetCandidateRequest) (ProjectAssetSummary, error) {
	if _, err := s.repo.ProjectForUser(userID, projectID); err != nil {
		return ProjectAssetSummary{}, err
	}
	candidate, err := s.repo.ProjectAssetCandidate(projectID, candidateID)
	if err != nil {
		return ProjectAssetSummary{}, err
	}
	if candidate.Status != "pending_confirmation" {
		return ProjectAssetSummary{}, BadAuthRequest("资产候选已处理")
	}
	now := time.Now()
	assetID := strings.TrimSpace(req.AssetID)
	if assetID != "" && candidate.Category == model.AssetCategoryCharacter {
		asset, assetErr := s.repo.ProjectCharacterAsset(userID, projectID, assetID)
		if assetErr != nil {
			return ProjectAssetSummary{}, assetErr
		}
		current, versionErr := s.repo.AssetVersion(asset.PrimaryVersionID)
		if versionErr != nil {
			return ProjectAssetSummary{}, versionErr
		}
		definition, mergeErr := mergeCharacterCandidateDefinition(current.DefinitionJSON, candidate.DetailsJSON, asset.Title, candidate.Name)
		if mergeErr != nil {
			return ProjectAssetSummary{}, mergeErr
		}
		nextAsset, nextVersion, representations, voice, prepareErr := s.prepareNextCharacterVersion(asset, asset.Title, definition, nil, nil, false)
		if prepareErr != nil {
			return ProjectAssetSummary{}, prepareErr
		}
		candidate.Status = "confirmed"
		candidate.ResolvedAssetID = asset.ID
		candidate.UpdatedAt = now
		if saveErr := s.repo.ConfirmProjectCharacterCandidate(candidate, &nextAsset, &nextVersion, representations, voice); saveErr != nil {
			return ProjectAssetSummary{}, saveErr
		}
		return s.projectAssetSummary(userID, projectID, &nextAsset)
	}
	createAsset := assetID == ""
	var asset model.Asset
	var version model.AssetVersion
	if createAsset {
		assetID = newID()
		versionID := newID()
		kind := "text"
		var payload []byte
		var marshalErr error
		if candidate.Category == model.AssetCategoryCharacter {
			kind = "entity"
			var characterPayload string
			characterPayload, marshalErr = characterAssetPayload(assetID, versionID, candidate.Name, json.RawMessage(candidate.DetailsJSON), now, now)
			payload = []byte(characterPayload)
		} else {
			payload, marshalErr = json.Marshal(map[string]any{
				"id": assetID, "kind": kind, "category": candidate.Category, "status": model.AssetVersionStatusConfirmed,
				"primaryVersionId": versionID, "title": candidate.Name, "tags": []string{}, "data": map[string]string{"content": ""},
				"createdAt": now.Format(time.RFC3339Nano), "updatedAt": now.Format(time.RFC3339Nano),
			})
		}
		if marshalErr != nil {
			return ProjectAssetSummary{}, marshalErr
		}
		asset = model.Asset{ID: assetID, UserID: userID, Kind: kind, Category: candidate.Category, Status: model.AssetVersionStatusConfirmed, PrimaryVersionID: versionID, Title: candidate.Name, PayloadJSON: string(payload), CreatedAt: now, UpdatedAt: now}
		version = model.AssetVersion{ID: versionID, AssetID: assetID, Version: 1, Status: model.AssetVersionStatusConfirmed, DefinitionJSON: candidate.DetailsJSON, CreatedAt: now, UpdatedAt: now}
	} else {
		existing, assetErr := s.repo.AssetForUser(userID, assetID)
		if assetErr != nil {
			return ProjectAssetSummary{}, assetErr
		}
		asset = *existing
	}
	candidate.Status = "confirmed"
	candidate.ResolvedAssetID = assetID
	candidate.UpdatedAt = now
	folderID, folderErr := s.resolveProjectAssetFolderID(projectID, nil)
	if folderErr != nil {
		return ProjectAssetSummary{}, folderErr
	}
	position, positionErr := s.repo.NextProjectAssetPosition(projectID, folderID)
	if positionErr != nil {
		return ProjectAssetSummary{}, positionErr
	}
	link := model.ProjectAssetLink{ID: newID(), ProjectID: projectID, AssetID: assetID, FolderID: folderID, Position: position, CreatedAt: now}
	if err := s.repo.ConfirmProjectAssetCandidate(candidate, &asset, &version, &link, createAsset); err != nil {
		return ProjectAssetSummary{}, err
	}
	return s.projectAssetSummary(userID, projectID, &asset)
}

func mergeCharacterCandidateDefinition(currentJSON string, candidateJSON string, currentName string, candidateName string) (string, error) {
	current := map[string]any{}
	candidate := map[string]any{}
	if err := json.Unmarshal([]byte(currentJSON), &current); err != nil {
		return "", err
	}
	if err := json.Unmarshal([]byte(candidateJSON), &candidate); err != nil {
		return "", BadAuthRequest("角色候选设定格式无效")
	}
	for key, value := range candidate {
		if key == "aliases" || !emptyCharacterDefinitionValue(current[key]) {
			continue
		}
		current[key] = value
	}
	aliases := make([]string, 0)
	seen := map[string]bool{}
	appendAlias := func(value string) {
		value = strings.TrimSpace(value)
		key := strings.ToLower(value)
		if value == "" || seen[key] || strings.EqualFold(value, strings.TrimSpace(currentName)) {
			return
		}
		seen[key] = true
		aliases = append(aliases, value)
	}
	for _, value := range []any{current["aliases"], candidate["aliases"]} {
		if list, ok := value.([]any); ok {
			for _, item := range list {
				if text, valid := item.(string); valid {
					appendAlias(text)
				}
			}
		}
	}
	appendAlias(candidateName)
	current["aliases"] = aliases
	encoded, err := json.Marshal(current)
	return string(encoded), err
}

func emptyCharacterDefinitionValue(value any) bool {
	switch typed := value.(type) {
	case nil:
		return true
	case string:
		return strings.TrimSpace(typed) == ""
	case []any:
		return len(typed) == 0
	default:
		return false
	}
}

func containsString(values []string, target string) bool {
	for _, value := range values {
		if value == target {
			return true
		}
	}
	return false
}

func validAssetCategory(category model.AssetCategory) bool {
	switch category {
	case model.AssetCategoryCharacter, model.AssetCategoryEnvironment, model.AssetCategoryWardrobe, model.AssetCategoryProp, model.AssetCategoryWeapon, model.AssetCategoryStyle, model.AssetCategoryOther:
		return true
	default:
		return false
	}
}

func (s *Service) projectAssetSummary(userID string, projectID string, asset *model.Asset) (ProjectAssetSummary, error) {
	versions, err := s.repo.AssetVersions(asset.ID)
	if err != nil {
		return ProjectAssetSummary{}, err
	}
	usages, err := s.repo.ProjectAssetUsageRoles(projectID, asset.ID)
	if err != nil {
		return ProjectAssetSummary{}, err
	}
	link, err := s.repo.ProjectAssetLink(projectID, asset.ID)
	if err != nil {
		return ProjectAssetSummary{}, err
	}
	storageKey, previewText := projectAssetPreview(asset.PayloadJSON)
	summary := ProjectAssetSummary{ID: asset.ID, Title: asset.Title, MediaType: asset.Kind, Category: asset.Category, Status: asset.Status, PrimaryVersionID: asset.PrimaryVersionID, VersionCount: len(versions), Usages: usages, FolderID: link.FolderID, Position: link.Position, StorageKey: storageKey, PreviewText: previewText, UpdatedAt: asset.UpdatedAt}
	if asset.Category == model.AssetCategoryCharacter && asset.PrimaryVersionID != "" {
		card, cardErr := s.characterCard(userID, asset)
		if cardErr != nil {
			return ProjectAssetSummary{}, cardErr
		}
		summary.Character = &card
	}
	return summary, nil
}

func projectAssetPreview(payloadJSON string) (string, string) {
	var payload struct {
		Data struct {
			StorageKey string `json:"storageKey"`
			Content    string `json:"content"`
		} `json:"data"`
	}
	if json.Unmarshal([]byte(payloadJSON), &payload) != nil {
		return "", ""
	}
	previewRunes := []rune(strings.TrimSpace(payload.Data.Content))
	if len(previewRunes) > 240 {
		previewRunes = append(previewRunes[:240], '…')
	}
	return strings.TrimSpace(payload.Data.StorageKey), string(previewRunes)
}
