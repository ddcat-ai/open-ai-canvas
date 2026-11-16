package app

import (
	"fmt"
	"strings"

	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"
)

type cloudAgentCharacter struct {
	AssetID          string
	Name             string
	VersionPolicy    string
	SelectedOutfitID string
	CoverURL         string
	Card             CharacterCardSummary
}

func cloudAgentCharacterNode(node map[string]any) bool {
	meta, _ := node["metadata"].(map[string]any)
	return stringValue(node["type"]) == "text" && stringValue(meta["workflowKind"]) == "character"
}

func cloudAgentResolveCharacter(repo *repository.Repository, userID, projectID string, node map[string]any) (*cloudAgentCharacter, error) {
	meta, _ := node["metadata"].(map[string]any)
	assetID := stringValue(meta["characterAssetId"])
	if assetID == "" {
		return nil, BadAuthRequest("角色卡未关联角色资产")
	}
	_ = projectID
	asset, err := repo.UserCharacterAsset(userID, assetID)
	if err != nil {
		return nil, BadAuthRequest("角色卡不存在或不可访问")
	}
	policy := stringValue(meta["characterVersionPolicy"])
	versionID := asset.PrimaryVersionID
	if policy == "pinned" {
		versionID = stringValue(meta["characterVersionId"])
		if versionID == "" {
			return nil, BadAuthRequest("角色卡固定版本不存在")
		}
	} else if policy != "" && policy != "current" {
		return nil, BadAuthRequest("角色卡版本策略无效")
	} else {
		policy = "current"
	}
	version, err := repo.AssetVersion(versionID)
	if err != nil || version.AssetID != asset.ID {
		return nil, BadAuthRequest("角色卡版本不存在或不属于当前角色")
	}
	card, err := (&Service{repo: repo}).characterCardVersion(userID, version)
	if err != nil {
		return nil, err
	}
	return &cloudAgentCharacter{
		AssetID:          asset.ID,
		Name:             asset.Title,
		VersionPolicy:    policy,
		SelectedOutfitID: stringValue(meta["selectedOutfitId"]),
		CoverURL:         stringValue(meta["characterCoverUrl"]),
		Card:             card,
	}, nil
}

func (character *cloudAgentCharacter) outfits() []map[string]any {
	rawOutfits, _ := character.Card.Definition["outfits"].([]any)
	result := []map[string]any{}
	for _, raw := range rawOutfits {
		item, ok := raw.(map[string]any)
		if !ok {
			continue
		}
		id, name, resourceID, clothing := stringValue(item["id"]), stringValue(item["name"]), stringValue(item["resourceId"]), stringValue(item["clothing"])
		if resourceID == "" {
			continue
		}
		entry := map[string]any{"id": id, "name": truncateRunes(name, 100), "resourceId": resourceID}
		if clothing != "" {
			entry["clothing"] = truncateRunes(clothing, 1000)
		}
		result = append(result, entry)
	}
	return result
}

func (character *cloudAgentCharacter) selectedOutfitInfo() map[string]any {
	outfits := character.outfits()
	if len(outfits) == 0 {
		return nil
	}
	targetID := strings.TrimSpace(character.SelectedOutfitID)
	if targetID != "" {
		for _, item := range outfits {
			if stringValue(item["id"]) == targetID {
				return item
			}
		}
	}
	if character.CoverURL != "" {
		for _, item := range outfits {
			resID := stringValue(item["resourceId"])
			if resID != "" && strings.Contains(character.CoverURL, "/resources/"+resID+"/file") {
				return item
			}
		}
	}
	if targetID == "" {
		targetID = stringValue(character.Card.Definition["activeOutfitId"])
		for _, item := range outfits {
			if stringValue(item["id"]) == targetID {
				return item
			}
		}
	}
	return outfits[0]
}

func (character *cloudAgentCharacter) selectedOutfit() (string, string) {
	info := character.selectedOutfitInfo()
	if info == nil {
		return "", ""
	}
	return stringValue(info["resourceId"]), stringValue(info["clothing"])
}

var cloudAgentCharacterFields = []string{"role", "appearance", "physique", "clothing", "personality", "props", "consistencyPrompt", "multiViewPrompt", "voiceLanguage", "voiceAge", "voiceTimbre"}

func (character *cloudAgentCharacter) definition() map[string]any {
	definition := map[string]any{}
	_, outfitClothing := character.selectedOutfit()
	for _, key := range cloudAgentCharacterFields {
		if key == "clothing" && strings.TrimSpace(outfitClothing) != "" {
			definition[key] = truncateRunes(outfitClothing, 4000)
			continue
		}
		if value, ok := character.Card.Definition[key].(string); ok && strings.TrimSpace(value) != "" {
			definition[key] = truncateRunes(value, 4000)
		}
	}
	if aliases, ok := character.Card.Definition["aliases"].([]any); ok {
		values := []string{}
		for _, item := range aliases[:min(len(aliases), 16)] {
			if value, ok := item.(string); ok {
				values = append(values, truncateRunes(value, 100))
			}
		}
		if len(values) > 0 {
			definition["aliases"] = values
		}
	}
	return definition
}

func (character *cloudAgentCharacter) read(precise bool) map[string]any {
	result := map[string]any{
		"assetId": character.AssetID, "name": character.Name,
		"versionId": character.Card.VersionID, "version": character.Card.Version,
		"versionPolicy": character.VersionPolicy, "visualStatus": character.Card.VisualStatus,
		"voiceStatus": character.Card.VoiceStatus, "hasDefinition": len(character.definition()) > 0,
	}
	if outfit := character.selectedOutfitInfo(); outfit != nil {
		result["selectedOutfit"] = outfit
	}
	if !precise {
		return result
	}
	if outfits := character.outfits(); len(outfits) > 0 {
		result["outfits"] = outfits
	}
	result["definition"] = character.definition()
	roles := []string{}
	representations := []map[string]any{}
	for _, representation := range character.Card.Representations {
		roles = append(roles, representation.Role)
		representations = append(representations, map[string]any{
			"id": representation.ID, "role": representation.Role, "mediaType": representation.MediaType,
			"resourceId": representation.ResourceID,
		})
	}
	result["representationRoles"] = roles
	result["representations"] = representations
	if character.Card.Voice != nil {
		profile := character.Card.Voice.Profile
		result["voice"] = map[string]any{"profileId": profile.ID, "name": profile.Name, "voiceKey": profile.VoiceKey, "language": profile.Language, "timbre": profile.Timbre, "sampleResourceId": profile.SampleResourceID, "instructions": truncateRunes(character.Card.Voice.Instructions, 1000)}
	}
	return result
}

func (character *cloudAgentCharacter) prompt() string {
	outfitInfo := character.selectedOutfitInfo()
	_, outfitClothing := character.selectedOutfit()
	parts := []string{}
	for _, key := range []string{"role", "appearance", "physique", "clothing", "personality", "props", "consistencyPrompt"} {
		if key == "clothing" && strings.TrimSpace(outfitClothing) != "" {
			parts = append(parts, strings.TrimSpace(outfitClothing))
			continue
		}
		if value, ok := character.Card.Definition[key].(string); ok && strings.TrimSpace(value) != "" {
			parts = append(parts, strings.TrimSpace(value))
		}
	}
	if len(parts) == 0 {
		return ""
	}
	if outfitName := stringValue(outfitInfo["name"]); outfitName != "" {
		return fmt.Sprintf("【角色卡：%s（第%d版·当前造型：%s）】\n%s", character.Name, character.Card.Version, outfitName, strings.Join(parts, "\n"))
	}
	return fmt.Sprintf("【角色卡：%s（第%d版）】\n%s", character.Name, character.Card.Version, strings.Join(parts, "\n"))
}

func cloudAgentCharacterImageReference(repo *repository.Repository, userID, nodeID string, character *cloudAgentCharacter) (map[string]any, error) {
	if outfitResourceID, _ := character.selectedOutfit(); outfitResourceID != "" {
		if resource, err := repo.ResourceForUser(userID, outfitResourceID); err == nil && resource.Status == model.ResourceStatusReady && strings.HasPrefix(strings.ToLower(resource.MimeType), "image/") {
			return map[string]any{
				"id": nodeID, "name": character.Name, "storageKey": "resource:" + resource.ID,
				"canvasReferenceKind": "character",
				"type":                resource.MimeType, "mimeType": resource.MimeType, "bytes": resource.Size,
				"width": resource.Width, "height": resource.Height, "inputKind": "image",
			}, nil
		}
	}
	for _, role := range []string{"turnaround_sheet", "primary", "front"} {
		for _, representation := range character.Card.Representations {
			if representation.Role != role || !strings.HasPrefix(representation.MediaType, "image") || representation.ResourceID == "" {
				continue
			}
			resource, err := repo.ResourceForUser(userID, representation.ResourceID)
			if err != nil || resource.Status != model.ResourceStatusReady || !strings.HasPrefix(strings.ToLower(resource.MimeType), "image/") {
				return nil, BadAuthRequest("角色卡三视图资源不存在、未就绪或不可访问")
			}
			return map[string]any{
				"id": nodeID, "name": character.Name, "storageKey": "resource:" + resource.ID,
				"canvasReferenceKind": "character",
				"type":                resource.MimeType, "mimeType": resource.MimeType, "bytes": resource.Size,
				"width": resource.Width, "height": resource.Height, "inputKind": "image",
			}, nil
		}
	}
	return nil, BadAuthRequest("角色卡尚未绑定可用的三视图图片")
}

func cloudAgentCharacterAudioReference(repo *repository.Repository, userID, nodeID string, character *cloudAgentCharacter) (map[string]any, error) {
	if character.Card.Voice == nil || strings.TrimSpace(character.Card.Voice.Profile.VoiceKey) == "" {
		return nil, BadAuthRequest("角色卡尚未绑定可用的声音档案")
	}
	return map[string]any{
		"id": nodeID, "name": character.Name, "voiceProfileId": character.Card.Voice.Profile.ID,
		"voiceKey": character.Card.Voice.Profile.VoiceKey, "language": character.Card.Voice.Profile.Language,
		"timbre": character.Card.Voice.Profile.Timbre, "instructions": character.Card.Voice.Instructions,
	}, nil
}

func cloudAgentMediaReference(repo *repository.Repository, userID, projectID string, node map[string]any, modes ...string) (map[string]any, string, error) {
	if !cloudAgentCharacterNode(node) {
		return cloudAgentReference(repo, userID, node)
	}
	character, err := cloudAgentResolveCharacter(repo, userID, projectID, node)
	if err != nil {
		return nil, "", err
	}
	if len(modes) > 0 && modes[0] == "audio" {
		return map[string]any{"id": node["id"], "name": character.Name, "canvasReferenceKind": "character"}, "referenceCharacters", nil
	}
	ref, err := cloudAgentCharacterImageReference(repo, userID, stringValue(node["id"]), character)
	return ref, "referenceImages", err
}

func cloudAgentMediaCharacters(repo *repository.Repository, userID, projectID string, doc map[string]any, args cloudAgentMediaArgs) (map[string]*cloudAgentCharacter, error) {
	nodes, err := creationObjects(doc["nodes"])
	if err != nil {
		return nil, err
	}
	characters := map[string]*cloudAgentCharacter{}
	for _, id := range append(append([]string{}, args.ReferenceNodeIDs...), args.SourceNodeID) {
		node := nodes[id]
		if node == nil || !cloudAgentCharacterNode(node) {
			continue
		}
		character, err := cloudAgentResolveCharacter(repo, userID, projectID, node)
		if err != nil {
			return nil, err
		}
		if id == args.SourceNodeID && character.prompt() == "" {
			return nil, BadAuthRequest("角色卡还没有可用的文字设定，不能作为文本来源")
		}
		characters[id] = character
	}
	return characters, nil
}
