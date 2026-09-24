package assets

import (
	"encoding/json"
	"fmt"
	"sort"
	"strings"
)

// DocumentResourceReference describes one durable resource locator in a JSON document.
// Path is intentionally human-readable so it can be shown in save diagnostics.
type DocumentResourceReference struct {
	ResourceID    string `json:"resourceId"`
	Path          string `json:"path"`
	NodeID        string `json:"nodeId,omitempty"`
	ReferenceType string `json:"referenceType"`
	Source        string `json:"source,omitempty"`
}

func DocumentReferences(raw string, resourceIDs map[string]struct{}) bool {
	return len(DocumentReferencedIDs(raw, resourceIDs)) > 0
}

func DocumentReferencedIDs(raw string, resourceIDs map[string]struct{}) map[string]struct{} {
	matched := map[string]struct{}{}
	if len(resourceIDs) == 0 {
		return matched
	}
	references, err := CollectDocumentResourceReferences(raw)
	if err != nil {
		// A few read models store a URL directly rather than a JSON string.
		if id := ResourceID(strings.TrimSpace(raw)); id != "" {
			if _, exists := resourceIDs[id]; exists {
				matched[id] = struct{}{}
			}
		}
		return matched
	}
	for _, reference := range references {
		if _, exists := resourceIDs[reference.ResourceID]; exists {
			matched[reference.ResourceID] = struct{}{}
		}
	}
	return matched
}

// CollectOwnedDocumentReferences is kept as the compatibility API used by the
// history and deletion paths. The actual traversal lives in one collector so
// nested fields such as metadata.videoPreview.storageKey cannot be skipped by
// one of the callers.
func CollectOwnedDocumentReferences(raw string, resourceIDs map[string]struct{}) error {
	references, err := CollectDocumentResourceReferences(raw)
	if err != nil {
		return err
	}
	for _, reference := range references {
		resourceIDs[reference.ResourceID] = struct{}{}
	}
	return nil
}

func CollectDocumentResourceReferences(raw string) ([]DocumentResourceReference, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return nil, nil
	}
	var value any
	if err := json.Unmarshal([]byte(raw), &value); err != nil {
		return nil, err
	}
	if scalar, ok := value.(string); ok {
		if resourceID := ResourceID(scalar); resourceID != "" {
			return []DocumentResourceReference{{ResourceID: resourceID, Path: "$", ReferenceType: "value"}}, nil
		}
		return nil, nil
	}
	references := make([]DocumentResourceReference, 0)
	walkReferenceDocument(value, "", "", "", &references)
	sort.Slice(references, func(i, j int) bool {
		if references[i].Path != references[j].Path {
			return references[i].Path < references[j].Path
		}
		if references[i].ResourceID != references[j].ResourceID {
			return references[i].ResourceID < references[j].ResourceID
		}
		return references[i].ReferenceType < references[j].ReferenceType
	})
	return references, nil
}

func SortedIDs(values map[string]struct{}) []string {
	result := make([]string, 0, len(values))
	for value := range values {
		result = append(result, value)
	}
	sort.Strings(result)
	return result
}

func walkReferenceDocument(value any, parentKey, path, nodeID string, references *[]DocumentResourceReference) {
	switch item := value.(type) {
	case map[string]any:
		currentNodeID := nodeID
		if candidate, ok := item["id"].(string); ok && parentKey == "nodes" {
			currentNodeID = strings.TrimSpace(candidate)
		}
		keys := make([]string, 0, len(item))
		for key := range item {
			keys = append(keys, key)
		}
		sort.Strings(keys)
		for _, key := range keys {
			child := item[key]
			childPath := joinReferencePath(path, key)
			if text, ok := child.(string); ok {
				if resourceID := resourceIDForField(key, text); resourceID != "" {
					*references = append(*references, DocumentResourceReference{
						ResourceID: resourceID, Path: childPath, NodeID: currentNodeID, ReferenceType: key,
					})
				}
				continue
			}
			walkReferenceDocument(child, key, childPath, currentNodeID, references)
		}
	case []any:
		for index, child := range item {
			childPath := arrayReferencePath(path, index, child)
			walkReferenceDocument(child, parentKey, childPath, nodeID, references)
		}
	case string:
		if resourceID := resourceIDForField(parentKey, item); resourceID != "" {
			*references = append(*references, DocumentResourceReference{
				ResourceID: resourceID, Path: path, NodeID: nodeID, ReferenceType: parentKey,
			})
		}
	}
}

func resourceIDForField(field, value string) string {
	if isResourceLocatorField(field) {
		return ResourceID(value)
	}
	if isBareResourceIDField(field) {
		return ValidID(value)
	}
	return ""
}

func joinReferencePath(parent, child string) string {
	if parent == "" {
		return child
	}
	return parent + "." + child
}

func arrayReferencePath(parent string, index int, child any) string {
	if item, ok := child.(map[string]any); ok {
		if id, ok := item["id"].(string); ok && isCanvasCollectionPath(parent) && strings.TrimSpace(id) != "" {
			return fmt.Sprintf("%s[%s]", parent, strings.TrimSpace(id))
		}
	}
	return fmt.Sprintf("%s[%d]", parent, index)
}

func isCanvasCollectionPath(path string) bool {
	return path == "nodes" || strings.HasSuffix(path, ".clips") || path == "clips"
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
	case "storageKey", "content", "previewContent", "drawingPreviewStorageKey", "drawingPreviewUrl", "url", "dataUrl", "coverUrl", "imageUrl", "videoUrl", "audioUrl", "referenceUrl", "referenceUrls", "artifactRef", "providerArtifactRef":
		return true
	default:
		return false
	}
}
