package service

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"strings"
	"time"

	"infinite-canvas/backend/internal/model"

	"gorm.io/gorm"
)

type CanvasShareRequest struct {
	ExpiresDays int  `json:"expiresDays"`
	Rotate      bool `json:"rotate"`
}

type CanvasShareStatus struct {
	Enabled   bool       `json:"enabled"`
	Token     string     `json:"token,omitempty"`
	ExpiresAt *time.Time `json:"expiresAt,omitempty"`
	CreatedAt *time.Time `json:"createdAt,omitempty"`
}

type PublicCanvasShare struct {
	Project   map[string]any `json:"project"`
	ExpiresAt *time.Time     `json:"expiresAt,omitempty"`
}

var publicCanvasMetadataKeys = map[string]bool{
	"content": true, "composerContent": true, "prompt": true, "status": true, "fontSize": true,
	"generationMode": true, "generationType": true, "model": true, "size": true, "quality": true, "transparentBackground": true,
	"count": true, "seconds": true, "vquality": true, "generateAudio": true, "watermark": true,
	"audioVoice": true, "audioFormat": true, "audioSpeed": true, "audioInstructions": true,
	"naturalWidth": true, "naturalHeight": true, "freeResize": true, "isBatchRoot": true,
	"batchRootId": true, "batchChildIds": true, "batchUsesReferenceImages": true, "primaryImageId": true,
	"imageBatchExpanded": true, "mimeType": true, "bytes": true, "durationMs": true, "assetTags": true,
	"workflowKind": true, "workflowTitle": true, "workflowDescription": true, "shotIndex": true,
	"sceneId": true, "characterIds": true, "referenceSetId": true, "referenceAssetNodeIds": true,
	"characterName": true, "characterPrompt": true, "characterAliases": true, "characterView": true, "characterViewNodeIds": true,
	"videoEditOperation": true, "videoCameraMoveId": true, "videoCameraMovePrompt": true,
	"videoStartFrameNodeId": true, "videoEndFrameNodeId": true, "versionOfNodeId": true,
	"versionLabel": true, "versionPrimary": true, "directorSceneId": true, "directorShotId": true,
	"directorPreviewNodeId": true, "directorDepthNodeId": true, "directorNormalNodeId": true,
	"skillId": true, "skillVersion": true, "skillSnapshot": true, "storyboard": true,
	"storyboardShotDuration": true, "storyboardShotCount": true, "storyboardComposerHeight": true, "frame": true,
}

var publicCanvasForbiddenKeys = map[string]bool{
	"apiKey": true, "storageKey": true, "taskId": true, "taskStatus": true, "taskProgress": true,
	"taskStage": true, "taskCreatedAt": true, "taskUpdatedAt": true, "sessionId": true,
	"errorDetails": true, "references": true,
}

func (s *Service) CanvasShareStatus(userID string, projectID string) (CanvasShareStatus, error) {
	if _, err := s.repo.CanvasProjectForUser(userID, projectID); err != nil {
		return CanvasShareStatus{}, err
	}
	share, err := s.repo.CanvasShareForProject(userID, projectID)
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return CanvasShareStatus{Enabled: false}, nil
	}
	if err != nil {
		return CanvasShareStatus{}, err
	}
	return s.canvasShareStatus(share)
}

func (s *Service) CreateCanvasShare(userID string, projectID string, req CanvasShareRequest) (CanvasShareStatus, error) {
	if req.ExpiresDays < 0 || req.ExpiresDays > 365 {
		return CanvasShareStatus{}, BadAuthRequest("分享有效期必须在 0 到 365 天之间")
	}
	if _, err := s.repo.CanvasProjectForUser(userID, projectID); err != nil {
		return CanvasShareStatus{}, err
	}
	share, err := s.repo.CanvasShareForProject(userID, projectID)
	if errors.Is(err, gorm.ErrRecordNotFound) {
		share = &model.CanvasShare{ID: newID(), UserID: userID, ProjectID: projectID}
	} else if err != nil {
		return CanvasShareStatus{}, err
	}
	if req.Rotate || strings.TrimSpace(share.TokenCipher) == "" {
		token, tokenErr := newCanvasShareToken()
		if tokenErr != nil {
			return CanvasShareStatus{}, tokenErr
		}
		share.TokenHash = canvasShareTokenHash(token)
		share.TokenCipher, err = s.encryptSettingSecret(token)
		if err != nil {
			return CanvasShareStatus{}, err
		}
	}
	share.Enabled = true
	share.ExpiresAt = nil
	if req.ExpiresDays > 0 {
		expiresAt := time.Now().Add(time.Duration(req.ExpiresDays) * 24 * time.Hour)
		share.ExpiresAt = &expiresAt
	}
	if err := s.repo.Save(share); err != nil {
		return CanvasShareStatus{}, err
	}
	return s.canvasShareStatus(share)
}

func (s *Service) DeleteCanvasShare(userID string, projectID string) error {
	if _, err := s.repo.CanvasProjectForUser(userID, projectID); err != nil {
		return err
	}
	return s.repo.DeleteCanvasShare(userID, projectID)
}

func (s *Service) PublicCanvasShare(token string) (PublicCanvasShare, error) {
	share, project, err := s.sharedCanvasProject(token)
	if err != nil {
		return PublicCanvasShare{}, err
	}
	publicProject, _, err := publicCanvasProject(project, token)
	if err != nil {
		return PublicCanvasShare{}, err
	}
	return PublicCanvasShare{Project: publicProject, ExpiresAt: share.ExpiresAt}, nil
}

func (s *Service) OpenSharedCanvasResource(token string, resourceID string) (*model.Resource, io.ReadCloser, error) {
	stream, err := s.OpenSharedCanvasResourceRange(token, resourceID, "")
	if err != nil {
		return nil, nil, err
	}
	return stream.Resource, stream.Body, nil
}

func (s *Service) OpenSharedCanvasResourceRange(token string, resourceID string, rangeHeader string) (*ResourceStream, error) {
	share, project, err := s.sharedCanvasProject(token)
	if err != nil {
		return nil, err
	}
	_, allowedResources, err := publicCanvasProject(project, token)
	if err != nil {
		return nil, err
	}
	if !allowedResources[resourceID] {
		return nil, gorm.ErrRecordNotFound
	}
	return s.OpenResourceRange(share.UserID, resourceID, rangeHeader)
}

func (s *Service) sharedCanvasProject(token string) (*model.CanvasShare, *model.CanvasProject, error) {
	token = strings.TrimSpace(token)
	if len(token) < 32 || len(token) > 128 {
		return nil, nil, gorm.ErrRecordNotFound
	}
	share, err := s.repo.CanvasShareByTokenHash(canvasShareTokenHash(token))
	if err != nil {
		return nil, nil, err
	}
	if share.ExpiresAt != nil && !share.ExpiresAt.After(time.Now()) {
		return nil, nil, gorm.ErrRecordNotFound
	}
	project, err := s.repo.CanvasProjectForUser(share.UserID, share.ProjectID)
	return share, project, err
}

func (s *Service) canvasShareStatus(share *model.CanvasShare) (CanvasShareStatus, error) {
	if share == nil || !share.Enabled || (share.ExpiresAt != nil && !share.ExpiresAt.After(time.Now())) {
		return CanvasShareStatus{Enabled: false}, nil
	}
	token, err := s.decryptSettingSecret(share.TokenCipher)
	if err != nil {
		return CanvasShareStatus{}, err
	}
	createdAt := share.CreatedAt
	return CanvasShareStatus{Enabled: true, Token: token, ExpiresAt: share.ExpiresAt, CreatedAt: &createdAt}, nil
}

func newCanvasShareToken() (string, error) {
	payload := make([]byte, 32)
	if _, err := rand.Read(payload); err != nil {
		return "", fmt.Errorf("生成分享令牌失败：%w", err)
	}
	return base64.RawURLEncoding.EncodeToString(payload), nil
}

func canvasShareTokenHash(token string) string {
	sum := sha256.Sum256([]byte(strings.TrimSpace(token)))
	return hex.EncodeToString(sum[:])
}

func publicCanvasProject(project *model.CanvasProject, token string) (map[string]any, map[string]bool, error) {
	var source map[string]any
	if project == nil || json.Unmarshal([]byte(project.PayloadJSON), &source) != nil {
		return nil, nil, errors.New("分享画布数据格式无效")
	}
	allowedResources := map[string]bool{}
	result := map[string]any{
		"id":             stringValue(source["id"]),
		"title":          defaultString(stringValue(source["title"]), project.Title),
		"createdAt":      source["createdAt"],
		"updatedAt":      source["updatedAt"],
		"backgroundMode": source["backgroundMode"],
		"showImageInfo":  source["showImageInfo"],
		"viewport":       scrubPublicCanvasValue(source["viewport"]),
		"connections":    publicCanvasConnections(source["connections"]),
		"chatSessions":   []any{},
		"activeChatId":   nil,
		"directorScenes": []any{},
	}
	rawNodes, _ := source["nodes"].([]any)
	nodes := make([]any, 0, len(rawNodes))
	for _, rawNode := range rawNodes {
		if node, ok := publicCanvasNode(rawNode, token, allowedResources); ok {
			nodes = append(nodes, node)
		}
	}
	result["nodes"] = nodes
	return result, allowedResources, nil
}

func publicCanvasConnections(value any) []any {
	rawConnections, _ := value.([]any)
	result := make([]any, 0, len(rawConnections))
	for _, raw := range rawConnections {
		connection, _ := raw.(map[string]any)
		if connection == nil {
			continue
		}
		result = append(result, map[string]any{
			"id": connection["id"], "fromNodeId": connection["fromNodeId"], "toNodeId": connection["toNodeId"],
			"fromHandleId": connection["fromHandleId"], "toHandleId": connection["toHandleId"],
		})
	}
	return result
}

func publicCanvasNode(value any, token string, allowedResources map[string]bool) (map[string]any, bool) {
	node, _ := value.(map[string]any)
	if node == nil || stringValue(node["id"]) == "" || stringValue(node["type"]) == "" {
		return nil, false
	}
	result := map[string]any{
		"id": node["id"], "type": node["type"], "title": node["title"], "position": scrubPublicCanvasValue(node["position"]),
		"width": node["width"], "height": node["height"], "parentId": node["parentId"],
	}
	metadata, _ := node["metadata"].(map[string]any)
	publicMetadata := map[string]any{}
	for key, value := range metadata {
		if !publicCanvasMetadataKeys[key] {
			continue
		}
		publicMetadata[key] = scrubPublicCanvasValue(value)
	}
	if resourceID := canvasResourceID(stringValue(metadata["storageKey"])); resourceID != "" {
		allowedResources[resourceID] = true
		publicMetadata["content"] = sharedCanvasResourceURL(token, resourceID)
	} else if resourceID := canvasResourceID(stringValue(metadata["content"])); resourceID != "" {
		allowedResources[resourceID] = true
		publicMetadata["content"] = sharedCanvasResourceURL(token, resourceID)
	} else if nodeType := stringValue(node["type"]); nodeType == "image" || nodeType == "video" || nodeType == "audio" {
		delete(publicMetadata, "content")
	}
	delete(publicMetadata, "storageKey")
	result["metadata"] = publicMetadata
	return result, true
}

func scrubPublicCanvasValue(value any) any {
	switch item := value.(type) {
	case map[string]any:
		result := make(map[string]any, len(item))
		for key, child := range item {
			if publicCanvasForbiddenKeys[key] {
				continue
			}
			result[key] = scrubPublicCanvasValue(child)
		}
		return result
	case []any:
		result := make([]any, len(item))
		for index, child := range item {
			result[index] = scrubPublicCanvasValue(child)
		}
		return result
	default:
		return value
	}
}

func canvasResourceID(value string) string {
	value = strings.TrimSpace(value)
	if strings.HasPrefix(value, "resource:") {
		return validCanvasResourceID(strings.TrimPrefix(value, "resource:"))
	}
	const prefix = "/api/resources/"
	index := strings.Index(value, prefix)
	if index < 0 {
		return ""
	}
	remainder := value[index+len(prefix):]
	if end := strings.IndexByte(remainder, '/'); end >= 0 {
		remainder = remainder[:end]
	}
	return validCanvasResourceID(remainder)
}

func validCanvasResourceID(value string) string {
	value = strings.TrimSpace(value)
	if value == "" || len(value) > 80 {
		return ""
	}
	for _, char := range value {
		if (char < 'a' || char > 'z') && (char < 'A' || char > 'Z') && (char < '0' || char > '9') && char != '-' && char != '_' {
			return ""
		}
	}
	return value
}

func sharedCanvasResourceURL(token string, resourceID string) string {
	return "/api/public/canvas-shares/" + token + "/resources/" + resourceID + "/file"
}
