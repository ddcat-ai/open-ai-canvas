package app

import (
	"encoding/json"
	"fmt"
	"net/url"
	"slices"
)

func isSenseNovaModelCatalog(baseURL, apiFormat string) bool {
	if apiFormat != "openai" {
		return false
	}
	parsed, err := url.Parse(baseURL)
	if err != nil || parsed.Scheme != "https" || parsed.Hostname() != "token.sensenova.cn" || parsed.User != nil || parsed.RawQuery != "" || parsed.Fragment != "" {
		return false
	}
	if port := parsed.Port(); port != "" && port != "443" {
		return false
	}
	return parsed.Path == "" || parsed.Path == "/" || parsed.Path == "/v1" || parsed.Path == "/v1/"
}

// SenseNova's documented /models metadata is scoped to its exact official
// origin. Similar fields on gateways must not change another vendor's model.
func applySenseNovaCatalogModalities(item channelModelItem, entry *ChannelModelCatalogItem) error {
	if len(item.InputModalities) == 0 && len(item.OutputModalities) == 0 {
		return nil
	}
	inputs, err := parseSenseNovaModalities(item.InputModalities)
	if err != nil {
		return err
	}
	outputs, err := parseSenseNovaModalities(item.OutputModalities)
	if err != nil {
		return err
	}
	if entry.MinImages != nil && *entry.MinImages < 0 || entry.MaxImages != nil && *entry.MaxImages < 0 || entry.MinImages != nil && entry.MaxImages != nil && *entry.MinImages > *entry.MaxImages {
		return fmt.Errorf("invalid SenseNova image reference limits")
	}
	for _, capability := range []string{"image", "video", "audio", "text"} {
		if slices.Contains(outputs, capability) {
			entry.ModelType = capability
			break
		}
	}
	supportsImages := slices.Contains(inputs, "image")
	entry.SupportsImages = &supportsImages
	if !supportsImages {
		if entry.MinImages != nil && *entry.MinImages > 0 {
			return fmt.Errorf("SenseNova model requires unsupported image inputs")
		}
		entry.MinImages, entry.MaxImages = ptr(0), ptr(0)
		return nil
	}
	if entry.ModelType == "image" && entry.ID == senseNovaImageModel {
		if entry.MaxImages == nil || *entry.MaxImages > 5 {
			entry.MaxImages = ptr(5)
		}
	}
	if entry.MinImages != nil && entry.MaxImages != nil && *entry.MinImages > *entry.MaxImages {
		return fmt.Errorf("SenseNova image inputs exceed the documented model limit")
	}
	return nil
}

func parseSenseNovaModalities(raw json.RawMessage) ([]string, error) {
	var modalities []string
	if err := json.Unmarshal(raw, &modalities); err != nil || len(modalities) == 0 || len(modalities) > 4 {
		return nil, fmt.Errorf("invalid SenseNova modalities")
	}
	seen := make(map[string]bool, len(modalities))
	for _, modality := range modalities {
		if !slices.Contains([]string{"text", "image", "video", "audio"}, modality) || seen[modality] {
			return nil, fmt.Errorf("invalid SenseNova modality")
		}
		seen[modality] = true
	}
	return modalities, nil
}
