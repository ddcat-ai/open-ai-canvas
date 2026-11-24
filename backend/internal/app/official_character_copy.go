package app

import (
	"encoding/json"
	"strings"
	"time"

	"yingce/backend/internal/model"
)

type CopyOfficialCharacterRequest struct {
	Name            string         `json:"name"`
	Definition      map[string]any `json:"definition"`
	SourceVersionID string         `json:"sourceVersionId"`
}

// CopyOfficialCharacter creates a personal card from the published, server-owned snapshot.
func (s *Service) CopyOfficialCharacter(userID, id string, req CopyOfficialCharacterRequest) (CharacterAssetSummary, error) {
	if strings.TrimSpace(userID) == "" {
		return CharacterAssetSummary{}, Unauthorized("请先登录")
	}
	if err := s.requireOfficialAssetLibraryForUser(userID); err != nil {
		return CharacterAssetSummary{}, err
	}
	official, err := s.loadPublishedOfficialAsset(id)
	if err != nil {
		return CharacterAssetSummary{}, err
	}
	if official.MediaType != model.OfficialAssetMediaTypeEntity {
		return CharacterAssetSummary{}, BadAuthRequest("该素材不是角色卡")
	}
	var snapshot characterRecommendationSnapshot
	if err := json.Unmarshal([]byte(official.CharacterSnapshotJSON), &snapshot); err != nil || len(snapshot.Definition) == 0 || len(snapshot.PartialReasons) > 0 {
		return CharacterAssetSummary{}, BadAuthRequest("官方角色卡资料不完整")
	}
	if snapshot.VersionID == "" || req.SourceVersionID != snapshot.VersionID {
		return CharacterAssetSummary{}, BadAuthRequest("官方角色卡版本已变化，请重新添加后再保存")
	}
	name := strings.TrimSpace(req.Name)
	if name == "" {
		return CharacterAssetSummary{}, BadAuthRequest("角色名称不能为空")
	}
	definition, err := normalizedCharacterDefinition(req.Definition)
	if err != nil {
		return CharacterAssetSummary{}, err
	}
	now := time.Now()
	assetID, versionID := newID(), newID()
	payload, err := characterAssetPayload(assetID, versionID, name, definition, now, now)
	if err != nil {
		return CharacterAssetSummary{}, err
	}
	asset := model.Asset{ID: assetID, UserID: userID, Kind: "entity", Category: model.AssetCategoryCharacter, Status: model.AssetVersionStatusConfirmed, PrimaryVersionID: versionID, Title: name, PayloadJSON: payload, CreatedAt: now, UpdatedAt: now}
	version := model.AssetVersion{ID: versionID, AssetID: assetID, Version: 1, Status: model.AssetVersionStatusConfirmed, DefinitionJSON: string(definition), CreatedAt: now, UpdatedAt: now}
	var reps []model.AssetRepresentation
	for _, rep := range snapshot.Representations {
		if rep.ResourceID == "" || rep.Status == "partial" || !validCharacterRepresentationRole(rep.Role) {
			return CharacterAssetSummary{}, BadAuthRequest("官方角色形象资料不完整")
		}
		resource, e := s.resourceForUserOrOfficial(userID, rep.ResourceID)
		if e != nil || resource.Kind != "image" || resource.Status != model.ResourceStatusReady {
			return CharacterAssetSummary{}, BadAuthRequest("官方角色形象资源不可用")
		}
		reps = append(reps, model.AssetRepresentation{ID: newID(), TaskID: assetID, AssetVersionID: versionID, ResourceID: rep.ResourceID, MediaType: "image", Role: rep.Role, MetadataJSON: "{}", CreatedAt: now})
	}
	if len(reps) == 0 {
		return CharacterAssetSummary{}, BadAuthRequest("官方角色形象资料不完整")
	}
	var profile *model.VoiceProfile
	var voice *model.CharacterVoiceBinding
	if snapshot.Voice != nil {
		original := snapshot.Voice.Profile
		if strings.TrimSpace(original.VoiceKey) == "" {
			return CharacterAssetSummary{}, BadAuthRequest("官方角色声音身份不完整")
		}
		if original.SampleResourceID != "" {
			resource, e := s.resourceForUserOrOfficial(userID, original.SampleResourceID)
			if e != nil || resource.Kind != "audio" || resource.Status != model.ResourceStatusReady {
				return CharacterAssetSummary{}, BadAuthRequest("官方角色声音资源不可用")
			}
		}
		compatible, e := json.Marshal(original.CompatibleModels)
		if e != nil {
			return CharacterAssetSummary{}, e
		}
		profile = &model.VoiceProfile{ID: newID(), UserID: userID, Name: original.Name, Provider: "official_copy", VoiceKey: original.VoiceKey, Language: original.Language, Timbre: original.Timbre, SampleResourceID: original.SampleResourceID, CompatibleModelsJSON: string(compatible), Status: "active", CreatedAt: now, UpdatedAt: now}
		voice = &model.CharacterVoiceBinding{ID: newID(), AssetVersionID: versionID, VoiceProfileID: profile.ID, Instructions: snapshot.Voice.Instructions, CreatedAt: now, UpdatedAt: now}
	}
	if err := s.repo.CreateOfficialCharacterCopy(&asset, &version, reps, profile, voice); err != nil {
		return CharacterAssetSummary{}, err
	}
	return s.characterAssetDetail(userID, &asset)
}
