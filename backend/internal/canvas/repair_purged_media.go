package canvas

import (
	"encoding/json"
	"fmt"
	"sort"
	"strconv"
	"strings"

	"yingce/backend/internal/assets"
	"yingce/backend/internal/model"
)

type canvasResourceReferenceKey struct {
	path string
	id   string
}

type canvasMediaAssetReferenceKey struct {
	path       string
	resourceID string
	assetID    string
}

// Only references that survived at the same path from the persisted document
// can be detached. New or moved references remain subject to strict validation.
func (s *Service) repairPurgedCanvasMediaReferences(userID string, before, candidate json.RawMessage) (json.RawMessage, error) {
	previous, err := assets.CollectDocumentResourceReferences(string(before))
	if err != nil {
		return nil, fmt.Errorf("读取已保存画布资源引用失败: %w", err)
	}
	if len(previous) == 0 {
		return candidate, nil
	}

	oldReferences := make(map[canvasResourceReferenceKey]struct{}, len(previous))
	oldResourceIDs := make(map[string]struct{}, len(previous))
	for _, reference := range previous {
		oldReferences[canvasResourceReferenceKey{path: reference.Path, id: reference.ResourceID}] = struct{}{}
		oldResourceIDs[reference.ResourceID] = struct{}{}
	}
	current, err := assets.CollectDocumentResourceReferences(string(candidate))
	if err != nil {
		return nil, fmt.Errorf("读取待保存画布资源引用失败: %w", err)
	}
	resourceIDs := make(map[string]struct{}, len(oldResourceIDs)+len(current))
	for id := range oldResourceIDs {
		resourceIDs[id] = struct{}{}
	}
	for _, reference := range current {
		resourceIDs[reference.ResourceID] = struct{}{}
	}
	resources, err := s.repo.ResourcesByIDs(assets.SortedIDs(resourceIDs))
	if err != nil {
		return nil, err
	}
	resourceByID := make(map[string]model.Resource, len(resources))
	for _, resource := range resources {
		resourceByID[resource.ID] = resource
	}
	deletedIDs := make(map[string]struct{})
	for id := range oldResourceIDs {
		if _, exists := resourceByID[id]; !exists {
			deletedIDs[id] = struct{}{}
		}
	}

	stale := make(map[canvasResourceReferenceKey]struct{})
	for _, reference := range current {
		key := canvasResourceReferenceKey{path: reference.Path, id: reference.ResourceID}
		if _, existed := oldReferences[key]; !existed {
			continue
		}
		if _, deleted := deletedIDs[reference.ResourceID]; deleted {
			stale[key] = struct{}{}
		}
	}

	var document any
	if len(stale) > 0 {
		if err := json.Unmarshal(candidate, &document); err != nil {
			return nil, err
		}
		document = sanitizePurgedCanvasValue(document, "", "", stale)
		var previousDocument any
		if err := json.Unmarshal(before, &previousDocument); err != nil {
			return nil, err
		}
		resetPurgedCanvasNodeTaskBindings(document, previousDocument, stale, userID, resourceByID)
	}
	if document == nil {
		if err := json.Unmarshal(candidate, &document); err != nil {
			return nil, err
		}
	}
	assetBindingChanged, err := s.rebindDeletedCanvasAssets(userID, before, document, resourceByID)
	if err != nil {
		return nil, err
	}
	if len(stale) == 0 && !assetBindingChanged {
		return candidate, nil
	}
	return json.Marshal(document)
}

func (s *Service) rebindDeletedCanvasAssets(userID string, before json.RawMessage, document any, resources map[string]model.Resource) (bool, error) {
	previous, err := MediaAssetReferences(before)
	if err != nil {
		return false, err
	}
	encoded, err := json.Marshal(document)
	if err != nil {
		return false, err
	}
	current, err := MediaAssetReferences(encoded)
	if err != nil {
		return false, err
	}
	oldBindings := make(map[canvasMediaAssetReferenceKey]struct{}, len(previous))
	for _, reference := range previous {
		oldBindings[canvasMediaAssetReferenceKey{path: reference.Path, resourceID: reference.ResourceID, assetID: reference.AssetID}] = struct{}{}
	}
	assetIDs := make(map[string]struct{})
	for _, reference := range current {
		if reference.AssetID == "" {
			continue
		}
		key := canvasMediaAssetReferenceKey{path: reference.Path, resourceID: reference.ResourceID, assetID: reference.AssetID}
		if _, persisted := oldBindings[key]; persisted {
			assetIDs[reference.AssetID] = struct{}{}
		}
	}
	if len(assetIDs) == 0 {
		return false, nil
	}
	ownedAssets, err := s.repo.AssetsForUserIDs(userID, assets.SortedIDs(assetIDs))
	if err != nil {
		return false, err
	}
	ownedAssetIDs := make(map[string]struct{}, len(ownedAssets))
	for _, asset := range ownedAssets {
		ownedAssetIDs[asset.ID] = struct{}{}
	}
	missing := make([]MediaAssetReference, 0)
	for _, reference := range current {
		if reference.AssetID == "" {
			continue
		}
		key := canvasMediaAssetReferenceKey{path: reference.Path, resourceID: reference.ResourceID, assetID: reference.AssetID}
		if _, persisted := oldBindings[key]; !persisted {
			continue
		}
		if _, exists := ownedAssetIDs[reference.AssetID]; exists {
			continue
		}
		resource, exists := resources[reference.ResourceID]
		if exists && resource.UserID == userID && resource.Status == model.ResourceStatusReady {
			missing = append(missing, reference)
		}
	}
	if len(missing) == 0 {
		return false, nil
	}
	allAssets, err := s.repo.Assets(userID)
	if err != nil {
		return false, err
	}
	sort.Slice(allAssets, func(i, j int) bool { return allAssets[i].ID < allAssets[j].ID })
	changed := false
	for _, reference := range missing {
		resourceSet := map[string]struct{}{reference.ResourceID: {}}
		for _, asset := range allAssets {
			if asset.ID == reference.AssetID || !assets.DocumentReferences(asset.PayloadJSON, resourceSet) {
				continue
			}
			if setCanvasMediaAssetID(document, reference, asset.ID) {
				changed = true
			}
			break
		}
	}
	return changed, nil
}

func setCanvasMediaAssetID(document any, reference MediaAssetReference, assetID string) bool {
	root, ok := document.(map[string]any)
	if !ok {
		return false
	}
	set := func(media any) bool {
		item, ok := media.(map[string]any)
		if !ok {
			return false
		}
		item["assetId"] = assetID
		return true
	}
	if reference.NodeID != "" {
		nodes, _ := root["nodes"].([]any)
		for _, value := range nodes {
			node, _ := value.(map[string]any)
			if node["id"] != reference.NodeID {
				continue
			}
			metadata, _ := node["metadata"].(map[string]any)
			return set(metadata)
		}
		return false
	}
	const clipsPrefix = "timeline.clips["
	if !strings.HasPrefix(reference.Path, clipsPrefix) {
		return false
	}
	end := strings.Index(reference.Path[len(clipsPrefix):], "]")
	if end < 0 {
		return false
	}
	index, err := strconv.Atoi(reference.Path[len(clipsPrefix) : len(clipsPrefix)+end])
	if err != nil {
		return false
	}
	timeline, _ := root["timeline"].(map[string]any)
	clips, _ := timeline["clips"].([]any)
	if index < 0 || index >= len(clips) {
		return false
	}
	clip, _ := clips[index].(map[string]any)
	return set(clip["directMedia"])
}

func sanitizePurgedCanvasValue(value any, parentKey, path string, stale map[canvasResourceReferenceKey]struct{}) any {
	switch item := value.(type) {
	case map[string]any:
		result := make(map[string]any, len(item))
		keys := make([]string, 0, len(item))
		for key := range item {
			keys = append(keys, key)
		}
		sort.Strings(keys)
		for _, key := range keys {
			child := item[key]
			childPath := joinCanvasReferencePath(path, key)
			if (key == "videoPreview" || key == "imageRotation") && canvasValueHasPurgedReference(child, childPath, stale) {
				continue
			}
			if text, ok := child.(string); ok {
				if id := canvasResourceIDForField(key, text); id != "" {
					if _, remove := stale[canvasResourceReferenceKey{path: childPath, id: id}]; remove {
						continue
					}
				}
			}
			sanitized := sanitizePurgedCanvasValue(child, key, childPath, stale)
			if key == "mediaVersions" {
				if versions, ok := sanitized.([]any); ok && len(versions) == 0 {
					continue
				}
			}
			result[key] = sanitized
		}
		return result
	case []any:
		result := make([]any, 0, len(item))
		for index, child := range item {
			childPath := canvasReferenceArrayPath(path, index, child)
			if parentKey == "mediaVersions" && canvasValueHasPurgedReference(child, childPath, stale) {
				continue
			}
			if text, ok := child.(string); ok {
				if id := canvasResourceIDForField(parentKey, text); id != "" {
					if _, remove := stale[canvasResourceReferenceKey{path: childPath, id: id}]; remove {
						continue
					}
				}
			}
			result = append(result, sanitizePurgedCanvasValue(child, parentKey, childPath, stale))
		}
		return result
	default:
		return value
	}
}

func resetPurgedCanvasNodeTaskBindings(document, previousDocument any, stale map[canvasResourceReferenceKey]struct{}, userID string, resources map[string]model.Resource) {
	root, ok := document.(map[string]any)
	if !ok {
		return
	}
	previousRoot, _ := previousDocument.(map[string]any)
	previousNodes, _ := previousRoot["nodes"].([]any)
	previousMetadata := make(map[string]map[string]any, len(previousNodes))
	for _, value := range previousNodes {
		node, _ := value.(map[string]any)
		id, _ := node["id"].(string)
		metadata, _ := node["metadata"].(map[string]any)
		if id != "" && metadata != nil {
			previousMetadata[id] = metadata
		}
	}
	nodes, ok := root["nodes"].([]any)
	if !ok {
		return
	}
	for _, value := range nodes {
		node, ok := value.(map[string]any)
		if !ok {
			continue
		}
		metadata, ok := node["metadata"].(map[string]any)
		if !ok {
			continue
		}
		nodeID, _ := node["id"].(string)
		mainMediaPurged := false
		for _, field := range []string{"storageKey", "content"} {
			path := "nodes[" + nodeID + "].metadata." + field
			for reference := range stale {
				if reference.path == path {
					mainMediaPurged = true
					break
				}
			}
		}
		if !mainMediaPurged {
			continue
		}
		old := previousMetadata[nodeID]
		replacementMediaPresent := false
		for _, field := range []string{"storageKey", "content"} {
			text, exists := metadata[field].(string)
			if !exists || strings.TrimSpace(text) == "" {
				continue
			}
			if id := assets.ResourceID(text); id != "" {
				resource, exists := resources[id]
				if exists && resource.UserID == userID && resource.Status == model.ResourceStatusReady {
					replacementMediaPresent = true
				}
			} else if text != old[field] {
				replacementMediaPresent = true
			}
		}
		if replacementMediaPresent {
			continue
		}
		for _, field := range []string{"content", "previewContent"} {
			if current, exists := metadata[field]; exists && current == old[field] {
				delete(metadata, field)
			}
		}
		delete(metadata, "assetId")
		delete(metadata, "agentGenerationContinuation")
		metadata["status"] = "idle"
		for _, field := range []string{
			"taskId", "taskClientOperationId", "retryOf", "attemptGroupId", "taskStatus", "taskProgress",
			"taskStage", "taskMediaStage", "taskCanRecoverMedia", "taskProvider", "taskStartedAt",
			"taskCompletedAt", "taskDurationMs", "taskErrorCode", "taskOfficialStatus", "taskReceiptRecorded",
			"taskCreatedAt", "taskUpdatedAt", "generationOutputCount", "errorDetails", "generationErrorCode",
			"resourceReloadAvailable", "failedPromptFingerprint",
		} {
			delete(metadata, field)
		}
	}
}

func canvasValueHasPurgedReference(value any, prefix string, stale map[canvasResourceReferenceKey]struct{}) bool {
	encoded, err := json.Marshal(value)
	if err != nil {
		return false
	}
	references, err := assets.CollectDocumentResourceReferences(string(encoded))
	if err != nil {
		return false
	}
	for _, reference := range references {
		if _, exists := stale[canvasResourceReferenceKey{path: joinCanvasReferencePath(prefix, reference.Path), id: reference.ResourceID}]; exists {
			return true
		}
	}
	return false
}

func canvasResourceIDForField(field, value string) string {
	switch field {
	case "storageKey", "content", "previewContent", "drawingPreviewStorageKey", "drawingPreviewUrl", "url", "dataUrl", "coverUrl", "imageUrl", "videoUrl", "audioUrl", "referenceUrl", "referenceUrls", "artifactRef", "providerArtifactRef":
		return assets.ResourceID(value)
	case "resourceId", "resourceIds", "sampleResourceId", "referenceResourceId", "referenceResourceIds":
		return assets.ValidID(value)
	default:
		return ""
	}
}

func joinCanvasReferencePath(parent, child string) string {
	if parent == "" {
		return child
	}
	return parent + "." + child
}

func canvasReferenceArrayPath(parent string, index int, child any) string {
	if item, ok := child.(map[string]any); ok {
		if id, ok := item["id"].(string); ok && (parent == "nodes" || strings.HasSuffix(parent, ".clips") || parent == "clips") && strings.TrimSpace(id) != "" {
			return parent + "[" + strings.TrimSpace(id) + "]"
		}
	}
	return parent + "[" + fmt.Sprint(index) + "]"
}
