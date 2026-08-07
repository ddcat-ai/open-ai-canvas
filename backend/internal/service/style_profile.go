package service

import (
	"encoding/json"
	"errors"
	"strings"
	"time"

	"infinite-canvas/backend/internal/model"
)

const maxUserStyleProfiles = 200

type StyleProfileRequest struct {
	ProfileJSON string `json:"profileJson"`
}

type StyleProfileFavoriteRequest struct {
	Favorite bool `json:"favorite"`
}

type styleProfileDocument struct {
	SchemaVersion   int                 `json:"schemaVersion"`
	PresetID        string              `json:"presetId"`
	Title           string              `json:"title"`
	Description     string              `json:"description"`
	Tags            []string            `json:"tags"`
	Prompt          string              `json:"prompt"`
	NegativePrompt  string              `json:"negativePrompt"`
	CoverURL        string              `json:"coverUrl"`
	SourceProfileID string              `json:"sourceProfileId"`
	Selection       map[string]string   `json:"selection,omitempty"`
	Assets          []styleProfileAsset `json:"assets"`
	ExecutionPolicy string              `json:"executionPolicy"`
	Source          string              `json:"source"`
	Revision        int                 `json:"revision"`
}

type styleProfileAsset struct {
	ID                   string                       `json:"id"`
	Kind                 string                       `json:"kind"`
	Provider             string                       `json:"provider"`
	Title                string                       `json:"title"`
	Enabled              *bool                        `json:"enabled"`
	SourceID             string                       `json:"sourceId"`
	SourceURL            string                       `json:"sourceUrl"`
	Model                string                       `json:"model"`
	Version              string                       `json:"version"`
	BaseModels           []string                     `json:"baseModels"`
	TriggerWords         []string                     `json:"triggerWords"`
	PromptFragment       string                       `json:"promptFragment"`
	Weight               *float64                     `json:"weight"`
	Parameters           *styleProfileAssetParameters `json:"parameters"`
	ReferenceURLs        []string                     `json:"referenceUrls"`
	ReferenceResourceIDs []string                     `json:"referenceResourceIds"`
	Status               string                       `json:"status"`
	License              *styleProfileAssetLicense    `json:"license,omitempty"`
}

type styleProfileAssetParameters struct {
	Sampler string   `json:"sampler"`
	Steps   *int     `json:"steps"`
	CFG     *float64 `json:"cfg"`
	Size    string   `json:"size"`
}

type styleProfileAssetLicense struct {
	Commercial *bool  `json:"commercial,omitempty"`
	Note       string `json:"note,omitempty"`
	Source     string `json:"source,omitempty"`
	CapturedAt string `json:"capturedAt,omitempty"`
}

func (s *Service) ListStyleProfiles(userID string) ([]model.StyleProfile, error) {
	return s.repo.StyleProfiles(userID)
}

func (s *Service) CreateStyleProfile(userID string, req StyleProfileRequest) (model.StyleProfile, error) {
	count, err := s.repo.StyleProfileCount(userID)
	if err != nil {
		return model.StyleProfile{}, err
	}
	if count >= maxUserStyleProfiles {
		return model.StyleProfile{}, BadAuthRequest("我的风格最多保存 200 个")
	}
	normalized, document, err := normalizeUserStyleProfileJSON(req.ProfileJSON, "", 1)
	if err != nil {
		return model.StyleProfile{}, BadAuthRequest(err.Error())
	}
	now := time.Now()
	profile := model.StyleProfile{
		ID: newID(), UserID: userID, Name: strings.TrimSpace(document.Title), Description: strings.TrimSpace(document.Description),
		CoverURL: strings.TrimSpace(document.CoverURL), TagsJSON: mustStyleProfileJSON(document.Tags), Favorite: false,
		Revision: 1, CreatedAt: now, UpdatedAt: now,
	}
	normalized, document, err = normalizeUserStyleProfileJSON(normalized, profile.ID, profile.Revision)
	if err != nil {
		return model.StyleProfile{}, BadAuthRequest(err.Error())
	}
	profile.ProfileJSON = normalized
	profile.Name = document.Title
	if err := s.repo.CreateStyleProfile(&profile); err != nil {
		return model.StyleProfile{}, err
	}
	return profile, nil
}

func (s *Service) UpdateStyleProfile(userID string, id string, req StyleProfileRequest) (model.StyleProfile, error) {
	profile, err := s.repo.StyleProfileForUser(userID, id)
	if err != nil {
		return model.StyleProfile{}, err
	}
	normalized, document, err := normalizeUserStyleProfileJSON(req.ProfileJSON, profile.ID, profile.Revision+1)
	if err != nil {
		return model.StyleProfile{}, BadAuthRequest(err.Error())
	}
	profile.Name = document.Title
	profile.Description = document.Description
	profile.CoverURL = document.CoverURL
	profile.TagsJSON = mustStyleProfileJSON(document.Tags)
	profile.ProfileJSON = normalized
	profile.Revision++
	profile.UpdatedAt = time.Now()
	if err := s.repo.UpdateStyleProfile(profile); err != nil {
		return model.StyleProfile{}, err
	}
	return *profile, nil
}

func (s *Service) SetStyleProfileFavorite(userID string, id string, favorite bool) error {
	return s.repo.SetStyleProfileFavorite(userID, id, favorite)
}

func (s *Service) TouchStyleProfile(userID string, id string) error {
	return s.repo.TouchStyleProfile(userID, id, time.Now())
}

func (s *Service) DeleteStyleProfile(userID string, id string) error {
	return s.repo.DeleteStyleProfile(userID, id)
}

func validateStyleProfileJSON(value string) (string, error) {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return "", nil
	}
	if len([]byte(trimmed)) > 256*1024 {
		return "", errors.New("项目画风资产配置过大")
	}
	var profile styleProfileDocument
	if err := json.Unmarshal([]byte(trimmed), &profile); err != nil {
		return "", errors.New("项目画风资产配置不是合法 JSON")
	}
	if profile.SchemaVersion != 1 || strings.TrimSpace(profile.PresetID) == "" || strings.TrimSpace(profile.Title) == "" || strings.TrimSpace(profile.Prompt) == "" || profile.Revision < 1 {
		return "", errors.New("项目画风资产配置缺少必要字段")
	}
	if profile.Assets == nil {
		return "", errors.New("项目画风资产配置缺少 assets 数组")
	}
	if len(profile.Assets) > 20 {
		return "", errors.New("项目画风执行资产最多绑定 20 个")
	}
	if profile.ExecutionPolicy != "" && profile.ExecutionPolicy != "compatible-fallback" && profile.ExecutionPolicy != "strict-assets" {
		return "", errors.New("项目画风执行策略不支持")
	}
	if profile.Source != "builtin" && profile.Source != "user" && profile.Source != "external" {
		return "", errors.New("项目画风来源不支持")
	}
	if len(profile.Selection) > 20 {
		return "", errors.New("项目画风辅助标注最多 20 项")
	}
	for key, value := range profile.Selection {
		if strings.TrimSpace(key) == "" || len([]rune(key)) > 64 || len([]rune(value)) > 200 {
			return "", errors.New("项目画风辅助标注格式无效")
		}
	}
	assetIDs := make(map[string]struct{}, len(profile.Assets))
	for _, asset := range profile.Assets {
		if strings.TrimSpace(asset.ID) == "" || strings.TrimSpace(asset.Title) == "" || strings.TrimSpace(asset.Provider) == "" || !styleProfileValueAllowed(asset.Kind, "lora", "template", "reference", "prompt") || !styleProfileValueAllowed(asset.Status, "draft", "validated", "unavailable") {
			return "", errors.New("项目画风执行资产字段不完整")
		}
		if _, exists := assetIDs[asset.ID]; exists {
			return "", errors.New("项目画风执行资产 ID 不能重复")
		}
		assetIDs[asset.ID] = struct{}{}
		if asset.Weight != nil && (*asset.Weight < 0 || *asset.Weight > 2) {
			return "", errors.New("LoRA 权重必须在 0 到 2 之间")
		}
		if len(asset.BaseModels) > 20 {
			return "", errors.New("单个画风资产最多声明 20 个兼容模型")
		}
		if len(asset.TriggerWords) > 50 || len(asset.ReferenceURLs) > 20 || len(asset.ReferenceResourceIDs) > 20 {
			return "", errors.New("项目画风执行资产的触发词或参考图数量过多")
		}
		if asset.Parameters != nil {
			if asset.Parameters.Steps != nil && (*asset.Parameters.Steps < 1 || *asset.Parameters.Steps > 200) {
				return "", errors.New("画风资产 Steps 必须在 1 到 200 之间")
			}
			if asset.Parameters.CFG != nil && (*asset.Parameters.CFG < 0 || *asset.Parameters.CFG > 50) {
				return "", errors.New("画风资产 CFG 必须在 0 到 50 之间")
			}
		}
		if asset.Status == "validated" {
			switch asset.Kind {
			case "lora":
				if strings.TrimSpace(asset.SourceID) == "" && strings.TrimSpace(asset.SourceURL) == "" {
					return "", errors.New("已验证的 LoRA 必须填写来源资产 ID 或 URL")
				}
			case "template", "prompt":
				if strings.TrimSpace(asset.PromptFragment) == "" && len(nonEmptyStyleProfileStrings(asset.TriggerWords)) == 0 {
					return "", errors.New("已验证的模板或提示词模块必须填写提示词内容")
				}
			case "reference":
				if len(nonEmptyStyleProfileStrings(asset.ReferenceURLs)) == 0 && len(nonEmptyStyleProfileStrings(asset.ReferenceResourceIDs)) == 0 {
					return "", errors.New("已验证的参考图组必须绑定参考图")
				}
			}
		}
	}
	return trimmed, nil
}

func normalizeUserStyleProfileJSON(value string, presetID string, revision int64) (string, styleProfileDocument, error) {
	validated, err := validateStyleProfileJSON(value)
	if err != nil {
		return "", styleProfileDocument{}, err
	}
	var document styleProfileDocument
	if err := json.Unmarshal([]byte(validated), &document); err != nil {
		return "", styleProfileDocument{}, errors.New("用户风格配置解析失败")
	}
	if len([]rune(strings.TrimSpace(document.Title))) > 80 {
		return "", styleProfileDocument{}, errors.New("风格名称最多 80 个字")
	}
	if len([]rune(strings.TrimSpace(document.Description))) > 500 {
		return "", styleProfileDocument{}, errors.New("风格简介最多 500 个字")
	}
	if len(document.Tags) > 20 {
		return "", styleProfileDocument{}, errors.New("风格标签最多 20 个")
	}
	if len([]byte(document.CoverURL)) > 4096 || len([]byte(document.NegativePrompt)) > 64*1024 {
		return "", styleProfileDocument{}, errors.New("风格封面或负面 Prompt 过大")
	}
	if coverURL := strings.ToLower(strings.TrimSpace(document.CoverURL)); coverURL != "" && !strings.HasPrefix(coverURL, "http://") && !strings.HasPrefix(coverURL, "https://") && !strings.HasPrefix(coverURL, "/") && !strings.HasPrefix(coverURL, "data:image/") {
		return "", styleProfileDocument{}, errors.New("风格封面只支持 http(s)、站内路径或图片 Data URL")
	}
	if strings.TrimSpace(presetID) != "" {
		document.PresetID = strings.TrimSpace(presetID)
	}
	document.SourceProfileID = document.PresetID
	document.Source = "user"
	document.Revision = int(revision)
	document.Title = strings.TrimSpace(document.Title)
	document.Description = strings.TrimSpace(document.Description)
	document.CoverURL = strings.TrimSpace(document.CoverURL)
	document.NegativePrompt = strings.TrimSpace(document.NegativePrompt)
	document.Tags = nonEmptyStyleProfileStrings(document.Tags)
	encoded, err := json.Marshal(document)
	if err != nil {
		return "", styleProfileDocument{}, errors.New("用户风格配置序列化失败")
	}
	if len(encoded) > 256*1024 {
		return "", styleProfileDocument{}, errors.New("用户风格配置过大")
	}
	return string(encoded), document, nil
}

func validateStyleProfilePreset(presetID string, profileJSON string) error {
	if strings.TrimSpace(profileJSON) == "" {
		return nil
	}
	var profile styleProfileDocument
	if err := json.Unmarshal([]byte(profileJSON), &profile); err != nil {
		return errors.New("项目画风资产配置解析失败")
	}
	if strings.TrimSpace(presetID) == "" || strings.TrimSpace(profile.PresetID) != strings.TrimSpace(presetID) {
		return errors.New("项目画风预设与结构化快照不一致")
	}
	return nil
}

func mustStyleProfileJSON(value any) string {
	encoded, _ := json.Marshal(value)
	return string(encoded)
}

func nonEmptyStyleProfileStrings(values []string) []string {
	result := make([]string, 0, len(values))
	for _, value := range values {
		if trimmed := strings.TrimSpace(value); trimmed != "" {
			result = append(result, trimmed)
		}
	}
	return result
}

func styleProfileValueAllowed(value string, allowed ...string) bool {
	for _, item := range allowed {
		if value == item {
			return true
		}
	}
	return false
}
