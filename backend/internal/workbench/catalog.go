package workbench

import (
	"encoding/json"
	"fmt"
	"strings"
)

// InputContract describes the media and text inputs a workbench tool expects.
// It is stored inside capability JSON so the catalog and task admission share one contract.
type InputContract struct {
	PromptRequired    bool            `json:"promptRequired"`
	MinTextReferences int             `json:"minTextReferences"`
	Slots             []ReferenceSlot `json:"slots"`
}

type ReferenceSlot struct {
	Key              string   `json:"key"`
	Name             string   `json:"name"`
	MediaTypes       []string `json:"mediaTypes"`
	ResourceKind     string   `json:"resourceKind"`
	MaxCount         int      `json:"maxCount"`
	Required         bool     `json:"required"`
	MinCount         int      `json:"minCount"`
	CoverResourceID  string   `json:"coverResourceId,omitempty"`
	SampleResourceID string   `json:"sampleResourceId,omitempty"`
}

type ResultExample struct {
	Title            string   `json:"title,omitempty"`
	Description      string   `json:"description,omitempty"`
	ImageResourceIDs []string `json:"imageResourceIds,omitempty"`
	VideoResourceID  string   `json:"videoResourceId,omitempty"`
}

type catalogConfig struct {
	InputContract       InputContract `json:"inputContract"`
	SearchKeywords      []string      `json:"searchKeywords,omitempty"`
	Surfaces            []string      `json:"surfaces,omitempty"`
	Recommended         bool          `json:"recommended"`
	RecommendationOrder int           `json:"recommendationOrder"`
	InputHint           string        `json:"inputHint,omitempty"`
	ResultExample       ResultExample `json:"resultExample,omitempty"`
}

func parseCatalogConfig(capabilityJSON, guideJSON string) (catalogConfig, error) {
	config := catalogConfig{InputContract: InputContract{PromptRequired: true, Slots: []ReferenceSlot{}}}
	capability := map[string]json.RawMessage{}
	if strings.TrimSpace(capabilityJSON) != "" && strings.TrimSpace(capabilityJSON) != "{}" {
		if err := json.Unmarshal([]byte(capabilityJSON), &capability); err != nil {
			return config, fmt.Errorf("capability: %w", err)
		}
	}
	if raw, ok := capability["inputContract"]; ok {
		if err := json.Unmarshal(raw, &config.InputContract); err != nil {
			return config, fmt.Errorf("inputContract: %w", err)
		}
	}
	if raw, ok := capability["searchKeywords"]; ok {
		_ = json.Unmarshal(raw, &config.SearchKeywords)
	}
	if raw, ok := capability["surfaces"]; ok {
		_ = json.Unmarshal(raw, &config.Surfaces)
	}
	if raw, ok := capability["recommended"]; ok {
		_ = json.Unmarshal(raw, &config.Recommended)
	}
	if raw, ok := capability["recommendationOrder"]; ok {
		_ = json.Unmarshal(raw, &config.RecommendationOrder)
	}
	guide := map[string]json.RawMessage{}
	if strings.TrimSpace(guideJSON) != "" && strings.TrimSpace(guideJSON) != "{}" {
		if err := json.Unmarshal([]byte(guideJSON), &guide); err != nil {
			return config, fmt.Errorf("guide: %w", err)
		}
	}
	if raw, ok := guide["inputHint"]; ok {
		_ = json.Unmarshal(raw, &config.InputHint)
	}
	if raw, ok := guide["resultExample"]; ok {
		if err := json.Unmarshal(raw, &config.ResultExample); err != nil {
			return config, fmt.Errorf("resultExample: %w", err)
		}
	}
	return config, nil
}

func normalizeCatalogConfig(config catalogConfig) (catalogConfig, error) {
	if config.InputContract.MinTextReferences < 0 || config.InputContract.MinTextReferences > 20 {
		return config, fmt.Errorf("文本参考数量无效")
	}
	if len(config.InputContract.Slots) > 20 {
		return config, fmt.Errorf("输入素材槽位不能超过 20 个")
	}
	seen := map[string]bool{}
	for index := range config.InputContract.Slots {
		slot := &config.InputContract.Slots[index]
		slot.Key = strings.TrimSpace(slot.Key)
		slot.Name = strings.TrimSpace(slot.Name)
		slot.ResourceKind = strings.TrimSpace(slot.ResourceKind)
		if slot.ResourceKind == "" {
			slot.ResourceKind = "asset"
		}
		if slot.Key == "" || slot.Name == "" || seen[slot.Key] {
			return config, fmt.Errorf("输入素材槽位名称或标识无效")
		}
		seen[slot.Key] = true
		if len(slot.MediaTypes) == 0 {
			return config, fmt.Errorf("输入素材槽位必须指定媒体类型")
		}
		for mediaIndex, mediaType := range slot.MediaTypes {
			mediaType = strings.TrimSpace(mediaType)
			if mediaType != "image" && mediaType != "video" && mediaType != "audio" {
				return config, fmt.Errorf("输入素材槽位媒体类型无效")
			}
			slot.MediaTypes[mediaIndex] = mediaType
		}
		if slot.MaxCount < 1 || slot.MaxCount > 20 || slot.MinCount < 0 || slot.MinCount > slot.MaxCount {
			return config, fmt.Errorf("输入素材槽位数量范围无效")
		}
		if slot.Required && slot.MinCount < 1 {
			slot.MinCount = 1
		}
		slot.CoverResourceID = strings.TrimSpace(slot.CoverResourceID)
		slot.SampleResourceID = strings.TrimSpace(slot.SampleResourceID)
	}
	config.SearchKeywords = cleanStrings(config.SearchKeywords, 20)
	config.Surfaces = cleanStrings(config.Surfaces, 8)
	config.InputHint = strings.TrimSpace(config.InputHint)
	config.ResultExample.Title = strings.TrimSpace(config.ResultExample.Title)
	config.ResultExample.Description = strings.TrimSpace(config.ResultExample.Description)
	config.ResultExample.ImageResourceIDs = cleanStrings(config.ResultExample.ImageResourceIDs, 8)
	config.ResultExample.VideoResourceID = strings.TrimSpace(config.ResultExample.VideoResourceID)
	if config.RecommendationOrder < 0 || config.RecommendationOrder > 1_000_000 {
		return config, fmt.Errorf("推荐排序值无效")
	}
	return config, nil
}

func validCategoryID(categoryID string) bool {
	switch categoryID {
	case "recommended", "people", "ecommerce", "product", "drama-character", "drama-scene", "storyboard", "short-video", "scene", "enhancement":
		return true
	default:
		return false
	}
}
func cleanStrings(values []string, limit int) []string {
	seen := map[string]bool{}
	result := make([]string, 0, len(values))
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value == "" || seen[value] || len(result) >= limit {
			continue
		}
		seen[value] = true
		result = append(result, value)
	}
	return result
}

func catalogResourceIDs(config catalogConfig) []struct{ id, kind string } {
	result := make([]struct{ id, kind string }, 0)
	seen := map[string]bool{}
	appendResource := func(id, kind string) {
		id = strings.TrimSpace(id)
		if id == "" || seen[id] {
			return
		}
		seen[id] = true
		result = append(result, struct{ id, kind string }{id: id, kind: kind})
	}
	for _, slot := range config.InputContract.Slots {
		appendResource(slot.CoverResourceID, "image")
		appendResource(slot.SampleResourceID, "image")
	}
	for _, id := range config.ResultExample.ImageResourceIDs {
		appendResource(id, "image")
	}
	appendResource(config.ResultExample.VideoResourceID, "video")
	return result
}
