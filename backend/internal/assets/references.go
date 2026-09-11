package assets

import (
	"encoding/json"
	"sort"
	"strings"
)

func DocumentReferences(raw string, resourceIDs map[string]struct{}) bool {
	return len(DocumentReferencedIDs(raw, resourceIDs)) > 0
}

func DocumentReferencedIDs(raw string, resourceIDs map[string]struct{}) map[string]struct{} {
	matched := map[string]struct{}{}
	raw = strings.TrimSpace(raw)
	if raw == "" || len(resourceIDs) == 0 {
		return matched
	}
	found := map[string]struct{}{}
	var value any
	if err := json.Unmarshal([]byte(raw), &value); err == nil {
		if scalar, ok := value.(string); ok {
			if resourceID := ResourceID(scalar); resourceID != "" {
				found[resourceID] = struct{}{}
			}
		} else {
			walkReferenceDocument(value, "", found)
		}
	} else if resourceID := ResourceID(raw); resourceID != "" {
		found[resourceID] = struct{}{}
	}
	for resourceID := range found {
		if _, exists := resourceIDs[resourceID]; exists {
			matched[resourceID] = struct{}{}
		}
	}
	return matched
}

func CollectOwnedDocumentReferences(raw string, resourceIDs map[string]struct{}) error {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return nil
	}
	var value any
	if err := json.Unmarshal([]byte(raw), &value); err != nil {
		return err
	}
	if scalar, ok := value.(string); ok {
		if resourceID := ResourceID(scalar); resourceID != "" {
			resourceIDs[resourceID] = struct{}{}
		}
		return nil
	}
	walkReferenceDocument(value, "", resourceIDs)
	return nil
}

func SortedIDs(values map[string]struct{}) []string {
	result := make([]string, 0, len(values))
	for value := range values {
		result = append(result, value)
	}
	sort.Strings(result)
	return result
}

func walkReferenceDocument(value any, parentKey string, resourceIDs map[string]struct{}) {
	switch item := value.(type) {
	case map[string]any:
		for key, child := range item {
			walkReferenceDocument(child, key, resourceIDs)
		}
	case []any:
		for _, child := range item {
			walkReferenceDocument(child, parentKey, resourceIDs)
		}
	case string:
		if isResourceLocatorField(parentKey) {
			if resourceID := ResourceID(item); resourceID != "" {
				resourceIDs[resourceID] = struct{}{}
			}
		}
		if isBareResourceIDField(parentKey) {
			if resourceID := ValidID(item); resourceID != "" {
				resourceIDs[resourceID] = struct{}{}
			}
		}
	}
}

func isBareResourceIDField(field string) bool {
	switch field {
	case "resourceId", "resourceIds", "sampleResourceId", "referenceResourceId", "referenceResourceIds":
		return true
	default:
		return false
	}
}

func isResourceLocatorField(field string) bool {
	switch field {
	case "storageKey", "content", "url", "dataUrl", "coverUrl", "imageUrl", "videoUrl", "audioUrl", "referenceUrl", "referenceUrls", "artifactRef", "providerArtifactRef":
		return true
	default:
		return false
	}
}
