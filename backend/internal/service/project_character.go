package service

import (
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"strings"
	"time"

	"infinite-canvas/backend/internal/model"

	"gorm.io/gorm"
)

type CreateProjectCharacterRequest struct {
	Name       string         `json:"name"`
	Definition map[string]any `json:"definition"`
}

type UpdateProjectCharacterRequest struct {
	Name       string         `json:"name"`
	Definition map[string]any `json:"definition"`
}

type CharacterRepresentationInput struct {
	Role       string `json:"role"`
	ResourceID string `json:"resourceId"`
	Metadata   any    `json:"metadata"`
}

type ReplaceCharacterRepresentationsRequest struct {
	Representations []CharacterRepresentationInput `json:"representations"`
}

type BindCharacterVoiceRequest struct {
	VoiceProfileID string `json:"voiceProfileId"`
	Instructions   string `json:"instructions"`
}

type CharacterRepresentationSummary struct {
	ID         string `json:"id"`
	ResourceID string `json:"resourceId"`
	MediaType  string `json:"mediaType"`
	Role       string `json:"role"`
}

type VoiceProfileSummary struct {
	ID               string   `json:"id"`
	Name             string   `json:"name"`
	Provider         string   `json:"provider"`
	VoiceKey         string   `json:"voiceKey"`
	Language         string   `json:"language"`
	Timbre           string   `json:"timbre"`
	SampleResourceID string   `json:"sampleResourceId,omitempty"`
	CompatibleModels []string `json:"compatibleModels"`
	Status           string   `json:"status"`
}

type CharacterVoiceSummary struct {
	Profile      VoiceProfileSummary `json:"profile"`
	Instructions string              `json:"instructions"`
}

type characterTurnaroundTaskInput struct {
	Metadata struct {
		Operation        string `json:"operation"`
		CharacterAssetID string `json:"characterAssetId"`
	} `json:"metadata"`
}

type characterTurnaroundTaskResult struct {
	Images []struct {
		ResourceID string `json:"resourceId"`
	} `json:"images"`
}

type CharacterCardSummary struct {
	VersionID       string                           `json:"versionId"`
	Version         int                              `json:"version"`
	Definition      map[string]any                   `json:"definition"`
	Representations []CharacterRepresentationSummary `json:"representations"`
	Voice           *CharacterVoiceSummary           `json:"voice,omitempty"`
	VisualStatus    string                           `json:"visualStatus"`
	VoiceStatus     string                           `json:"voiceStatus"`
}

type ProjectCharacterDetail struct {
	Asset     ProjectAssetSummary  `json:"asset"`
	Character CharacterCardSummary `json:"character"`
}

var builtinVoiceNames = []string{"alloy", "ash", "ballad", "coral", "echo", "fable", "nova", "onyx", "sage", "shimmer", "verse", "marin", "cedar"}

func (s *Service) ListVoiceProfiles(userID string) ([]VoiceProfileSummary, error) {
	now := time.Now()
	profiles := make([]model.VoiceProfile, 0, len(builtinVoiceNames))
	for _, key := range builtinVoiceNames {
		profiles = append(profiles, model.VoiceProfile{
			ID: newID(), UserID: userID, Name: strings.ToUpper(key[:1]) + key[1:], Provider: "openai_compatible", VoiceKey: key,
			Language: "多语言", CompatibleModelsJSON: "[]", Status: "active", CreatedAt: now, UpdatedAt: now,
		})
	}
	if err := s.repo.EnsureVoiceProfiles(profiles); err != nil {
		return nil, err
	}
	stored, err := s.repo.VoiceProfiles(userID)
	if err != nil {
		return nil, err
	}
	result := make([]VoiceProfileSummary, 0, len(stored))
	for _, profile := range stored {
		result = append(result, voiceProfileSummary(profile))
	}
	return result, nil
}

func (s *Service) CreateProjectCharacter(userID string, projectID string, req CreateProjectCharacterRequest) (ProjectCharacterDetail, error) {
	if _, err := s.repo.ProjectForUser(userID, projectID); err != nil {
		return ProjectCharacterDetail{}, err
	}
	name := strings.TrimSpace(req.Name)
	if name == "" {
		return ProjectCharacterDetail{}, BadAuthRequest("角色名称不能为空")
	}
	definition, err := normalizedCharacterDefinition(req.Definition)
	if err != nil {
		return ProjectCharacterDetail{}, err
	}
	now := time.Now()
	assetID := newID()
	versionID := newID()
	payload, err := characterAssetPayload(assetID, versionID, name, definition, now, now)
	if err != nil {
		return ProjectCharacterDetail{}, err
	}
	asset := model.Asset{ID: assetID, UserID: userID, Kind: "entity", Category: model.AssetCategoryCharacter, Status: model.AssetVersionStatusConfirmed, PrimaryVersionID: versionID, Title: name, PayloadJSON: payload, CreatedAt: now, UpdatedAt: now}
	version := model.AssetVersion{ID: versionID, AssetID: assetID, Version: 1, Status: model.AssetVersionStatusConfirmed, DefinitionJSON: string(definition), CreatedAt: now, UpdatedAt: now}
	link := model.ProjectAssetLink{ID: newID(), ProjectID: projectID, AssetID: assetID, CreatedAt: now}
	if err := s.repo.CreateProjectCharacter(projectID, &asset, &version, &link); err != nil {
		return ProjectCharacterDetail{}, err
	}
	return s.projectCharacterDetail(userID, projectID, &asset)
}

func (s *Service) ProjectCharacter(userID string, projectID string, assetID string) (ProjectCharacterDetail, error) {
	asset, err := s.repo.ProjectCharacterAsset(userID, projectID, strings.TrimSpace(assetID))
	if err != nil {
		return ProjectCharacterDetail{}, err
	}
	return s.projectCharacterDetail(userID, projectID, asset)
}

func (s *Service) UpdateProjectCharacter(userID string, projectID string, assetID string, req UpdateProjectCharacterRequest) (ProjectCharacterDetail, error) {
	asset, err := s.repo.ProjectCharacterAsset(userID, projectID, strings.TrimSpace(assetID))
	if err != nil {
		return ProjectCharacterDetail{}, err
	}
	name := strings.TrimSpace(req.Name)
	if name == "" {
		return ProjectCharacterDetail{}, BadAuthRequest("角色名称不能为空")
	}
	definition, err := normalizedCharacterDefinition(req.Definition)
	if err != nil {
		return ProjectCharacterDetail{}, err
	}
	if _, err := s.createNextCharacterVersion(projectID, asset, name, string(definition), nil, nil, false); err != nil {
		return ProjectCharacterDetail{}, err
	}
	return s.ProjectCharacter(userID, projectID, asset.ID)
}

func (s *Service) ReplaceProjectCharacterRepresentations(userID string, projectID string, assetID string, req ReplaceCharacterRepresentationsRequest) (ProjectCharacterDetail, error) {
	asset, err := s.repo.ProjectCharacterAsset(userID, projectID, strings.TrimSpace(assetID))
	if err != nil {
		return ProjectCharacterDetail{}, err
	}
	if len(req.Representations) == 0 || len(req.Representations) > 8 {
		return ProjectCharacterDetail{}, BadAuthRequest("角色形象数量必须在 1 到 8 之间")
	}
	roles := make(map[string]struct{}, len(req.Representations))
	representations := make([]model.AssetRepresentation, 0, len(req.Representations))
	operationID := newID()
	for _, input := range req.Representations {
		role := strings.TrimSpace(input.Role)
		if !validCharacterRepresentationRole(role) {
			return ProjectCharacterDetail{}, BadAuthRequest("不支持的角色形象视角")
		}
		if _, exists := roles[role]; exists {
			return ProjectCharacterDetail{}, BadAuthRequest("同一角色形象视角不能重复")
		}
		roles[role] = struct{}{}
		resourceID := strings.TrimSpace(input.ResourceID)
		resource, resourceErr := s.repo.ResourceForUser(userID, resourceID)
		if resourceErr != nil || resource.Kind != "image" || resource.Status != model.ResourceStatusReady {
			return ProjectCharacterDetail{}, BadAuthRequest("角色形象资源不可用")
		}
		metadata, marshalErr := json.Marshal(input.Metadata)
		if marshalErr != nil {
			return ProjectCharacterDetail{}, BadAuthRequest("角色形象元数据格式无效")
		}
		representations = append(representations, model.AssetRepresentation{ID: newID(), TaskID: operationID, ResourceID: resourceID, MediaType: "image", Role: role, MetadataJSON: string(metadata), CreatedAt: time.Now()})
	}
	if _, err := s.createNextCharacterVersion(projectID, asset, asset.Title, "", representations, nil, false); err != nil {
		return ProjectCharacterDetail{}, err
	}
	return s.ProjectCharacter(userID, projectID, asset.ID)
}

// 三视图生成是强校验写路径：任务只有在资源已绑定到新角色版本后才能对外显示成功。
func (s *Service) finalizeCharacterTurnaroundTask(task model.Task, result map[string]interface{}) (bool, error) {
	if !strings.Contains(task.InputJSON, "character_turnaround") {
		return false, nil
	}
	decrypted, err := s.decryptTaskInputJSON(task.InputJSON)
	if err != nil {
		return false, err
	}
	var input characterTurnaroundTaskInput
	if err := json.Unmarshal([]byte(decrypted), &input); err != nil {
		return false, err
	}
	if input.Metadata.Operation != "character_turnaround" {
		return false, nil
	}
	projectID := strings.TrimSpace(task.ProjectID)
	assetID := strings.TrimSpace(input.Metadata.CharacterAssetID)
	if projectID == "" || assetID == "" {
		return false, errors.New("三视图任务缺少项目或角色标识")
	}
	encodedResult, err := json.Marshal(result)
	if err != nil {
		return false, err
	}
	var output characterTurnaroundTaskResult
	if err := json.Unmarshal(encodedResult, &output); err != nil {
		return false, err
	}
	if len(output.Images) == 0 || strings.TrimSpace(output.Images[0].ResourceID) == "" {
		return false, errors.New("三视图任务没有返回已持久化的图片资源")
	}

	s.characterTaskMu.Lock()
	defer s.characterTaskMu.Unlock()
	bound, err := s.characterTurnaroundTaskBound(task.ID)
	if err != nil || bound {
		return false, err
	}
	asset, err := s.repo.ProjectCharacterAsset(task.UserID, projectID, assetID)
	if err != nil {
		return false, err
	}
	resourceID := strings.TrimSpace(output.Images[0].ResourceID)
	resource, err := s.repo.ResourceForUser(task.UserID, resourceID)
	if err != nil || resource.Kind != "image" || resource.Status != model.ResourceStatusReady {
		return false, BadAuthRequest("三视图任务生成的图片资源不可用")
	}
	sheetMetadata, _ := json.Marshal(map[string]any{"prompt": task.Prompt, "source": "character_turnaround"})
	primaryMetadata, _ := json.Marshal(map[string]any{"source": "turnaround_sheet"})
	now := time.Now()
	representations := []model.AssetRepresentation{
		{ID: newID(), TaskID: task.ID, ResourceID: resourceID, MediaType: "image", Role: "turnaround_sheet", MetadataJSON: string(sheetMetadata), CreatedAt: now},
		{ID: newID(), TaskID: task.ID, ResourceID: resourceID, MediaType: "image", Role: "primary", MetadataJSON: string(primaryMetadata), CreatedAt: now},
	}
	if _, err := s.createNextCharacterVersion(projectID, asset, asset.Title, "", representations, nil, false); err != nil {
		// 多实例同时收尾时，唯一任务视角约束只允许一个事务成功；其余实例按已绑定处理。
		if bound, checkErr := s.characterTurnaroundTaskBound(task.ID); checkErr == nil && bound {
			return false, nil
		}
		return false, err
	}
	return true, nil
}

func (s *Service) characterTurnaroundTaskBound(taskID string) (bool, error) {
	representations, err := s.repo.AssetRepresentationsForTask(taskID)
	if err != nil {
		return false, err
	}
	roles := make(map[string]bool, len(representations))
	for _, representation := range representations {
		roles[representation.Role] = true
	}
	if len(representations) > 0 && (!roles["turnaround_sheet"] || !roles["primary"]) {
		return false, fmt.Errorf("三视图任务 %s 的角色表现绑定不完整", taskID)
	}
	return roles["turnaround_sheet"] && roles["primary"], nil
}

// 项目页读取时只修复旧版前端刷新造成的断点；单个异常任务记录告警，不阻断项目展示。
func (s *Service) reconcileCharacterTurnaroundTasks(userID string, projectID string) bool {
	tasks, err := s.repo.UnboundCharacterTurnaroundTasks(userID, projectID)
	if err != nil {
		log.Printf("reconcile character turnaround tasks failed: user=%s project=%s error=%v", userID, projectID, err)
		return false
	}
	recovered := false
	for _, task := range tasks {
		var result map[string]interface{}
		if err := json.Unmarshal([]byte(task.ResultJSON), &result); err != nil {
			log.Printf("restore character turnaround result failed: user=%s project=%s task=%s error=%v", userID, projectID, task.ID, err)
			continue
		}
		applied, err := s.finalizeCharacterTurnaroundTask(task, result)
		if err != nil {
			log.Printf("restore character turnaround task failed: user=%s project=%s task=%s error=%v", userID, projectID, task.ID, err)
			continue
		}
		if applied {
			recovered = true
			_ = s.log(userID, task.ID, "info", "已将历史三视图任务恢复到角色卡", "")
		}
	}
	return recovered
}

func (s *Service) BindProjectCharacterVoice(userID string, projectID string, assetID string, req BindCharacterVoiceRequest) (ProjectCharacterDetail, error) {
	asset, err := s.repo.ProjectCharacterAsset(userID, projectID, strings.TrimSpace(assetID))
	if err != nil {
		return ProjectCharacterDetail{}, err
	}
	profile, err := s.repo.VoiceProfileForUser(userID, strings.TrimSpace(req.VoiceProfileID))
	if err != nil || profile.Status != "active" {
		return ProjectCharacterDetail{}, BadAuthRequest("选择的声音素材不可用")
	}
	binding := &model.CharacterVoiceBinding{ID: newID(), VoiceProfileID: profile.ID, Instructions: strings.TrimSpace(req.Instructions), CreatedAt: time.Now(), UpdatedAt: time.Now()}
	if _, err := s.createNextCharacterVersion(projectID, asset, asset.Title, "", nil, binding, false); err != nil {
		return ProjectCharacterDetail{}, err
	}
	return s.ProjectCharacter(userID, projectID, asset.ID)
}

func (s *Service) UnbindProjectCharacterVoice(userID string, projectID string, assetID string) (ProjectCharacterDetail, error) {
	asset, err := s.repo.ProjectCharacterAsset(userID, projectID, strings.TrimSpace(assetID))
	if err != nil {
		return ProjectCharacterDetail{}, err
	}
	if _, err := s.createNextCharacterVersion(projectID, asset, asset.Title, "", nil, nil, true); err != nil {
		return ProjectCharacterDetail{}, err
	}
	return s.ProjectCharacter(userID, projectID, asset.ID)
}

func (s *Service) createNextCharacterVersion(projectID string, asset *model.Asset, name string, definitionJSON string, replacementRepresentations []model.AssetRepresentation, replacementVoice *model.CharacterVoiceBinding, dropVoice bool) (model.AssetVersion, error) {
	nextAsset, next, representations, voice, err := s.prepareNextCharacterVersion(asset, name, definitionJSON, replacementRepresentations, replacementVoice, dropVoice)
	if err != nil {
		return model.AssetVersion{}, err
	}
	if err := s.repo.SaveCharacterVersion(projectID, &nextAsset, &next, representations, voice); err != nil {
		return model.AssetVersion{}, err
	}
	*asset = nextAsset
	return next, nil
}

func (s *Service) prepareNextCharacterVersion(asset *model.Asset, name string, definitionJSON string, replacementRepresentations []model.AssetRepresentation, replacementVoice *model.CharacterVoiceBinding, dropVoice bool) (model.Asset, model.AssetVersion, []model.AssetRepresentation, *model.CharacterVoiceBinding, error) {
	current, err := s.repo.AssetVersion(asset.PrimaryVersionID)
	if err != nil {
		return model.Asset{}, model.AssetVersion{}, nil, nil, err
	}
	versions, err := s.repo.AssetVersions(asset.ID)
	if err != nil {
		return model.Asset{}, model.AssetVersion{}, nil, nil, err
	}
	nextNumber := 1
	if len(versions) > 0 {
		nextNumber = versions[0].Version + 1
	}
	if strings.TrimSpace(definitionJSON) == "" {
		definitionJSON = current.DefinitionJSON
	}
	now := time.Now()
	next := model.AssetVersion{ID: newID(), AssetID: asset.ID, Version: nextNumber, Status: model.AssetVersionStatusConfirmed, DefinitionJSON: definitionJSON, Prompt: current.Prompt, Note: current.Note, CreatedAt: now, UpdatedAt: now}
	representations := replacementRepresentations
	if representations == nil {
		currentRepresentations, representationErr := s.repo.AssetRepresentations(current.ID)
		if representationErr != nil {
			return model.Asset{}, model.AssetVersion{}, nil, nil, representationErr
		}
		operationID := newID()
		representations = make([]model.AssetRepresentation, 0, len(currentRepresentations))
		for _, representation := range currentRepresentations {
			representations = append(representations, model.AssetRepresentation{ID: newID(), TaskID: operationID, AssetVersionID: next.ID, ResourceID: representation.ResourceID, MediaType: representation.MediaType, Role: representation.Role, MetadataJSON: representation.MetadataJSON, CreatedAt: now})
		}
	} else {
		for index := range representations {
			representations[index].AssetVersionID = next.ID
		}
	}
	voice := replacementVoice
	if voice == nil && !dropVoice {
		currentVoice, voiceErr := s.repo.CharacterVoiceBinding(current.ID)
		if voiceErr == nil {
			voice = &model.CharacterVoiceBinding{ID: newID(), AssetVersionID: next.ID, VoiceProfileID: currentVoice.VoiceProfileID, Instructions: currentVoice.Instructions, CreatedAt: now, UpdatedAt: now}
		} else if !errors.Is(voiceErr, gorm.ErrRecordNotFound) {
			return model.Asset{}, model.AssetVersion{}, nil, nil, voiceErr
		}
	}
	if voice != nil {
		voice.ID = newID()
		voice.AssetVersionID = next.ID
		voice.CreatedAt = now
		voice.UpdatedAt = now
	}
	payload, err := characterAssetPayload(asset.ID, next.ID, name, json.RawMessage(definitionJSON), asset.CreatedAt, now)
	if err != nil {
		return model.Asset{}, model.AssetVersion{}, nil, nil, err
	}
	nextAsset := *asset
	nextAsset.Title = name
	nextAsset.Kind = "entity"
	nextAsset.Category = model.AssetCategoryCharacter
	nextAsset.Status = model.AssetVersionStatusConfirmed
	nextAsset.PrimaryVersionID = next.ID
	nextAsset.PayloadJSON = payload
	nextAsset.UpdatedAt = now
	return nextAsset, next, representations, voice, nil
}

func (s *Service) projectCharacterDetail(userID string, projectID string, asset *model.Asset) (ProjectCharacterDetail, error) {
	versions, err := s.repo.AssetVersions(asset.ID)
	if err != nil {
		return ProjectCharacterDetail{}, err
	}
	usages, err := s.repo.ProjectAssetUsageRoles(projectID, asset.ID)
	if err != nil {
		return ProjectCharacterDetail{}, err
	}
	card, err := s.characterCard(userID, asset)
	if err != nil {
		return ProjectCharacterDetail{}, err
	}
	summary := ProjectAssetSummary{ID: asset.ID, Title: asset.Title, MediaType: asset.Kind, Category: asset.Category, Status: asset.Status, PrimaryVersionID: asset.PrimaryVersionID, VersionCount: len(versions), Usages: usages, UpdatedAt: asset.UpdatedAt, Character: &card}
	return ProjectCharacterDetail{Asset: summary, Character: card}, nil
}

func (s *Service) characterCard(userID string, asset *model.Asset) (CharacterCardSummary, error) {
	version, err := s.repo.AssetVersion(asset.PrimaryVersionID)
	if err != nil {
		return CharacterCardSummary{}, err
	}
	definition := map[string]any{}
	if err := json.Unmarshal([]byte(version.DefinitionJSON), &definition); err != nil {
		return CharacterCardSummary{}, err
	}
	stored, err := s.repo.AssetRepresentations(version.ID)
	if err != nil {
		return CharacterCardSummary{}, err
	}
	representations := make([]CharacterRepresentationSummary, 0, len(stored))
	roles := make(map[string]bool, len(stored))
	for _, representation := range stored {
		representations = append(representations, CharacterRepresentationSummary{ID: representation.ID, ResourceID: representation.ResourceID, MediaType: representation.MediaType, Role: representation.Role})
		roles[representation.Role] = true
	}
	visualStatus := "missing"
	// 新角色只需要一张完整的三视图设定图；旧版本的三张视图仍按原规则兼容读取。
	if roles["turnaround_sheet"] || (roles["front"] && roles["side"] && roles["back"]) {
		visualStatus = "ready"
	} else if len(representations) > 0 {
		visualStatus = "partial"
	}
	var voice *CharacterVoiceSummary
	voiceStatus := "missing"
	binding, bindingErr := s.repo.CharacterVoiceBinding(version.ID)
	if bindingErr == nil {
		profile, profileErr := s.repo.VoiceProfileForUser(userID, binding.VoiceProfileID)
		if profileErr == nil && profile.Status == "active" {
			voice = &CharacterVoiceSummary{Profile: voiceProfileSummary(*profile), Instructions: binding.Instructions}
			voiceStatus = "ready"
		} else {
			voiceStatus = "unavailable"
		}
	} else if !errors.Is(bindingErr, gorm.ErrRecordNotFound) {
		return CharacterCardSummary{}, bindingErr
	}
	return CharacterCardSummary{VersionID: version.ID, Version: version.Version, Definition: definition, Representations: representations, Voice: voice, VisualStatus: visualStatus, VoiceStatus: voiceStatus}, nil
}

func normalizedCharacterDefinition(value map[string]any) (json.RawMessage, error) {
	if value == nil {
		value = map[string]any{}
	}
	encoded, err := json.Marshal(value)
	if err != nil {
		return nil, BadAuthRequest("角色设定格式无效")
	}
	return encoded, nil
}

func characterAssetPayload(assetID string, versionID string, name string, definition json.RawMessage, createdAt time.Time, updatedAt time.Time) (string, error) {
	var value map[string]any
	if err := json.Unmarshal(definition, &value); err != nil {
		return "", err
	}
	payload, err := json.Marshal(map[string]any{
		"id": assetID, "kind": "entity", "category": model.AssetCategoryCharacter, "status": model.AssetVersionStatusConfirmed,
		"primaryVersionId": versionID, "title": name, "coverUrl": "", "tags": []string{}, "data": map[string]any{"definition": value},
		"createdAt": createdAt.Format(time.RFC3339Nano), "updatedAt": updatedAt.Format(time.RFC3339Nano),
	})
	return string(payload), err
}

func voiceProfileSummary(profile model.VoiceProfile) VoiceProfileSummary {
	compatible := []string{}
	_ = json.Unmarshal([]byte(profile.CompatibleModelsJSON), &compatible)
	return VoiceProfileSummary{ID: profile.ID, Name: profile.Name, Provider: profile.Provider, VoiceKey: profile.VoiceKey, Language: profile.Language, Timbre: profile.Timbre, SampleResourceID: profile.SampleResourceID, CompatibleModels: compatible, Status: profile.Status}
}

func validCharacterRepresentationRole(role string) bool {
	switch role {
	case "primary", "front", "side", "back", "turnaround_sheet", "expression_sheet":
		return true
	default:
		return false
	}
}
