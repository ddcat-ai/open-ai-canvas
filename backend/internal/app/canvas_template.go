package app

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/repository"

	"gorm.io/gorm"
)

const (
	canvasTemplateSchema            = "yingce.canvas-template"
	canvasTemplateSchemaVersion     = 2
	canvasTemplateStatusDraft       = "draft"
	canvasTemplateStatusPublished   = "published"
	canvasTemplateVisibilityPrivate = "private"
	canvasTemplateVisibilityPublic  = "public"
)

type CanvasTemplateDocument struct {
	Schema        string                `json:"schema"`
	SchemaVersion int                   `json:"schemaVersion"`
	Nodes         []json.RawMessage     `json:"nodes"`
	Connections   []json.RawMessage     `json:"connections"`
	Media         []CanvasTemplateMedia `json:"media,omitempty"`
}

// CanvasTemplateMedia is a server-managed preview file. It is intentionally
// separate from runtime resource references such as assetId or storageKey.
type CanvasTemplateMedia struct {
	ID       string `json:"id"`
	NodeID   string `json:"nodeId,omitempty"`
	Kind     string `json:"kind"`
	Role     string `json:"role,omitempty"`
	Path     string `json:"path,omitempty"`
	MimeType string `json:"mimeType,omitempty"`
	Bytes    int64  `json:"bytes,omitempty"`
}

type CanvasTemplateRequest struct {
	Title       string          `json:"title"`
	Description string          `json:"description"`
	Category    string          `json:"category"`
	Tags        []string        `json:"tags"`
	Document    json.RawMessage `json:"document"`
}

type CanvasTemplateAdminUpdateRequest struct {
	Status     string `json:"status"`
	Visibility string `json:"visibility"`
}

type CanvasTemplateView struct {
	ID             string                  `json:"id"`
	Title          string                  `json:"title"`
	Description    string                  `json:"description"`
	Category       string                  `json:"category"`
	Tags           []string                `json:"tags"`
	Status         string                  `json:"status"`
	Visibility     string                  `json:"visibility"`
	CurrentVersion int                     `json:"currentVersion"`
	Owned          bool                    `json:"owned"`
	Source         string                  `json:"source"`
	CreatedAt      time.Time               `json:"createdAt"`
	UpdatedAt      time.Time               `json:"updatedAt"`
	PublishedAt    *time.Time              `json:"publishedAt,omitempty"`
	Document       *CanvasTemplateDocument `json:"document,omitempty"`
}

type CanvasTemplatePage struct {
	Templates []CanvasTemplateView `json:"templates"`
	Page      int                  `json:"page"`
	PageSize  int                  `json:"pageSize"`
	Total     int64                `json:"total"`
	HasMore   bool                 `json:"hasMore"`
}

func (s *Service) ListCanvasTemplates(userID string, page int, pageSize int, queryText string, category string) (CanvasTemplatePage, error) {
	result, err := s.repo.CanvasTemplatesPage(userID, page, pageSize, queryText, category)
	if err != nil {
		return CanvasTemplatePage{}, err
	}
	return s.canvasTemplatePage(result, page, pageSize, userID, true)
}

func (s *Service) AdminListCanvasTemplates(actor *model.User, page int, pageSize int, queryText string, status string) (CanvasTemplatePage, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return CanvasTemplatePage{}, err
	}
	result, err := s.repo.AdminCanvasTemplatesPage(page, pageSize, queryText, status)
	if err != nil {
		return CanvasTemplatePage{}, err
	}
	return s.canvasTemplatePage(result, page, pageSize, actor.ID, true)
}

func (s *Service) CanvasTemplateForUser(userID string, id string) (CanvasTemplateView, error) {
	template, err := s.repo.CanvasTemplate(strings.TrimSpace(id))
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return CanvasTemplateView{}, NotFound("模板不存在")
	}
	if err != nil {
		return CanvasTemplateView{}, err
	}
	if template.OwnerID != userID && !(template.Status == canvasTemplateStatusPublished && template.Visibility == canvasTemplateVisibilityPublic) {
		return CanvasTemplateView{}, NotFound("模板不存在")
	}
	return s.canvasTemplateView(template, userID, true)
}

func (s *Service) CreateCanvasTemplate(userID string, req CanvasTemplateRequest) (CanvasTemplateView, error) {
	metadata, document, err := normalizeCanvasTemplateRequest(req)
	if err != nil {
		return CanvasTemplateView{}, err
	}
	now := time.Now()
	template := &model.CanvasTemplate{
		ID:             newID(),
		OwnerID:        userID,
		Title:          metadata.title,
		Description:    metadata.description,
		Category:       metadata.category,
		TagsJSON:       metadata.tagsJSON,
		Status:         canvasTemplateStatusDraft,
		Visibility:     canvasTemplateVisibilityPrivate,
		CurrentVersion: 1,
		CreatedBy:      userID,
		CreatedAt:      now,
		UpdatedAt:      now,
	}
	version := &model.CanvasTemplateVersion{ID: newID(), TemplateID: template.ID, Version: 1, SchemaVersion: metadata.schemaVersion, DocumentJSON: string(document), CreatedBy: userID, CreatedAt: now}
	if err := s.repo.CreateCanvasTemplate(template, version); err != nil {
		return CanvasTemplateView{}, err
	}
	return s.canvasTemplateView(template, userID, true)
}

func (s *Service) CreateCanvasTemplateVersion(userID string, id string, req CanvasTemplateRequest) (CanvasTemplateView, error) {
	template, err := s.repo.CanvasTemplate(strings.TrimSpace(id))
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return CanvasTemplateView{}, NotFound("模板不存在")
	}
	if err != nil {
		return CanvasTemplateView{}, err
	}
	if template.OwnerID != userID {
		return CanvasTemplateView{}, Forbidden("只能修改自己的模板")
	}
	metadata, document, err := normalizeCanvasTemplateRequest(req)
	if err != nil {
		return CanvasTemplateView{}, err
	}
	now := time.Now()
	version := &model.CanvasTemplateVersion{ID: newID(), TemplateID: template.ID, Version: template.CurrentVersion + 1, SchemaVersion: metadata.schemaVersion, DocumentJSON: string(document), CreatedBy: userID, CreatedAt: now}
	if err := s.repo.CreateCanvasTemplateVersion(template, version); err != nil {
		return CanvasTemplateView{}, err
	}
	template.Title = metadata.title
	template.Description = metadata.description
	template.Category = metadata.category
	template.TagsJSON = metadata.tagsJSON
	template.CurrentVersion = version.Version
	template.UpdatedAt = now
	if err := s.repo.UpdateCanvasTemplate(template, map[string]any{"title": template.Title, "description": template.Description, "category": template.Category, "tags_json": template.TagsJSON, "updated_at": now}); err != nil {
		return CanvasTemplateView{}, err
	}
	return s.canvasTemplateView(template, userID, true)
}

func (s *Service) DeleteCanvasTemplate(userID string, id string) error {
	template, err := s.repo.CanvasTemplate(strings.TrimSpace(id))
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return NotFound("模板不存在")
	}
	if err != nil {
		return err
	}
	if template.OwnerID != userID {
		return Forbidden("只能删除自己的模板")
	}
	return s.repo.DeleteCanvasTemplate(template.ID)
}

func (s *Service) AdminUpdateCanvasTemplate(actor *model.User, id string, req CanvasTemplateAdminUpdateRequest) (CanvasTemplateView, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return CanvasTemplateView{}, err
	}
	template, err := s.repo.CanvasTemplate(strings.TrimSpace(id))
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return CanvasTemplateView{}, NotFound("模板不存在")
	}
	if err != nil {
		return CanvasTemplateView{}, err
	}
	status := strings.TrimSpace(req.Status)
	visibility := strings.TrimSpace(req.Visibility)
	if status != canvasTemplateStatusDraft && status != canvasTemplateStatusPublished {
		return CanvasTemplateView{}, BadAuthRequest("不支持的模板状态")
	}
	if visibility != canvasTemplateVisibilityPrivate && visibility != canvasTemplateVisibilityPublic {
		return CanvasTemplateView{}, BadAuthRequest("不支持的模板可见性")
	}
	now := time.Now()
	updates := map[string]any{"status": status, "visibility": visibility, "updated_at": now}
	if status == canvasTemplateStatusPublished {
		updates["published_by"] = actor.ID
		updates["published_at"] = now
	} else {
		updates["published_by"] = ""
		updates["published_at"] = nil
	}
	if err := s.repo.UpdateCanvasTemplate(template, updates); err != nil {
		return CanvasTemplateView{}, err
	}
	template.Status = status
	template.Visibility = visibility
	template.UpdatedAt = now
	if status == canvasTemplateStatusPublished {
		template.PublishedBy = actor.ID
		template.PublishedAt = &now
	} else {
		template.PublishedBy = ""
		template.PublishedAt = nil
	}
	return s.canvasTemplateView(template, actor.ID, true)
}

type canvasTemplateMetadata struct {
	title         string
	description   string
	category      string
	tagsJSON      string
	schemaVersion int
}

func normalizeCanvasTemplateRequest(req CanvasTemplateRequest) (canvasTemplateMetadata, []byte, error) {
	title := strings.TrimSpace(req.Title)
	if title == "" || len([]rune(title)) > 160 {
		return canvasTemplateMetadata{}, nil, BadAuthRequest("模板名称不能为空且不能超过 160 个字符")
	}
	description := strings.TrimSpace(req.Description)
	if len([]rune(description)) > 500 {
		return canvasTemplateMetadata{}, nil, BadAuthRequest("模板描述不能超过 500 个字符")
	}
	category := strings.TrimSpace(req.Category)
	if category == "" || len(category) > 40 {
		return canvasTemplateMetadata{}, nil, BadAuthRequest("模板分类无效")
	}
	if len(req.Tags) > 12 {
		return canvasTemplateMetadata{}, nil, BadAuthRequest("模板标签不能超过 12 个")
	}
	tags := make([]string, 0, len(req.Tags))
	seen := map[string]bool{}
	for _, raw := range req.Tags {
		tag := strings.TrimSpace(raw)
		if tag == "" || len([]rune(tag)) > 40 || seen[tag] {
			continue
		}
		seen[tag] = true
		tags = append(tags, tag)
	}
	tagsJSON, _ := json.Marshal(tags)
	if len(req.Document) == 0 || len(req.Document) > 2<<20 {
		return canvasTemplateMetadata{}, nil, BadAuthRequest("模板文档为空或超过 2MB 限制")
	}
	var document CanvasTemplateDocument
	if err := json.Unmarshal(req.Document, &document); err != nil {
		return canvasTemplateMetadata{}, nil, BadAuthRequest("模板文档格式无效")
	}
	if document.Schema != canvasTemplateSchema || (document.SchemaVersion != 1 && document.SchemaVersion != canvasTemplateSchemaVersion) || len(document.Nodes) == 0 || len(document.Nodes) > 200 {
		return canvasTemplateMetadata{}, nil, BadAuthRequest("不支持的模板文档版本或节点数量")
	}
	ids := make(map[string]bool, len(document.Nodes))
	for _, rawNode := range document.Nodes {
		var node struct {
			ID       string                     `json:"id"`
			Type     string                     `json:"type"`
			Metadata map[string]json.RawMessage `json:"metadata"`
		}
		if err := json.Unmarshal(rawNode, &node); err != nil || strings.TrimSpace(node.ID) == "" || strings.TrimSpace(node.Type) == "" || ids[node.ID] {
			return canvasTemplateMetadata{}, nil, BadAuthRequest("模板节点数据无效")
		}
		ids[node.ID] = true
		for _, forbidden := range []string{"storageKey", "assetId", "taskId", "previewContent"} {
			if _, exists := node.Metadata[forbidden]; exists {
				return canvasTemplateMetadata{}, nil, BadAuthRequest("模板不能包含运行时媒体或任务引用")
			}
		}
	}
	mediaIDs := make(map[string]bool, len(document.Media))
	for _, media := range document.Media {
		media.ID = strings.TrimSpace(media.ID)
		media.NodeID = strings.TrimSpace(media.NodeID)
		media.Kind = strings.TrimSpace(media.Kind)
		media.Role = strings.TrimSpace(media.Role)
		media.Path = strings.TrimSpace(strings.ReplaceAll(media.Path, "\\", "/"))
		if media.ID == "" || mediaIDs[media.ID] || (media.Kind != "image" && media.Kind != "video") || (media.Role != "" && media.Role != "node" && media.Role != "cover") || media.Bytes < 0 || media.Bytes > 128<<20 {
			return canvasTemplateMetadata{}, nil, BadAuthRequest("模板预览媒体数据无效")
		}
		if media.NodeID != "" && !ids[media.NodeID] {
			return canvasTemplateMetadata{}, nil, BadAuthRequest("模板预览媒体节点不存在")
		}
		if media.Path != "" && !safeCanvasTemplateMediaPath(media.Path) {
			return canvasTemplateMetadata{}, nil, BadAuthRequest("模板预览媒体路径无效")
		}
		mediaIDs[media.ID] = true
	}
	for _, rawConnection := range document.Connections {
		var connection struct {
			FromNodeID string `json:"fromNodeId"`
			ToNodeID   string `json:"toNodeId"`
		}
		if err := json.Unmarshal(rawConnection, &connection); err != nil || !ids[connection.FromNodeID] || !ids[connection.ToNodeID] {
			return canvasTemplateMetadata{}, nil, BadAuthRequest("模板连线数据无效")
		}
	}
	canonical, err := json.Marshal(document)
	if err != nil {
		return canvasTemplateMetadata{}, nil, fmt.Errorf("marshal template document: %w", err)
	}
	return canvasTemplateMetadata{title: title, description: description, category: category, tagsJSON: string(tagsJSON), schemaVersion: document.SchemaVersion}, canonical, nil
}

func safeCanvasTemplateMediaPath(value string) bool {
	clean := filepath.ToSlash(filepath.Clean(value))
	if clean == "." || filepath.IsAbs(value) || clean != value || !strings.HasPrefix(clean, "template-media/") {
		return false
	}
	for _, part := range strings.Split(clean, "/") {
		if part == "" || part == "." || part == ".." {
			return false
		}
	}
	return true
}

// CanvasTemplateMediaPath resolves only files under the template-media data
// directory after checking the template's visibility for the current user.
func (s *Service) CanvasTemplateMediaPath(userID string, id string, mediaID string) (string, string, error) {
	template, err := s.repo.CanvasTemplate(strings.TrimSpace(id))
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return "", "", NotFound("模板不存在")
	}
	if err != nil {
		return "", "", err
	}
	if template.OwnerID != userID && !(template.Status == canvasTemplateStatusPublished && template.Visibility == canvasTemplateVisibilityPublic) {
		return "", "", NotFound("模板不存在")
	}
	version, err := s.repo.CanvasTemplateVersion(template.ID, template.CurrentVersion)
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return "", "", NotFound("模板版本不存在")
	}
	if err != nil {
		return "", "", err
	}
	var document CanvasTemplateDocument
	if err := json.Unmarshal([]byte(version.DocumentJSON), &document); err != nil {
		return "", "", err
	}
	for _, media := range document.Media {
		if media.ID != mediaID || media.Path == "" || !safeCanvasTemplateMediaPath(media.Path) {
			continue
		}
		root, err := filepath.Abs(filepath.Join(s.dataDir, "template-media"))
		if err != nil {
			return "", "", err
		}
		path, err := filepath.Abs(filepath.Join(s.dataDir, filepath.FromSlash(media.Path)))
		if err != nil {
			return "", "", err
		}
		relative, err := filepath.Rel(root, path)
		if err != nil || relative == ".." || strings.HasPrefix(relative, ".."+string(filepath.Separator)) {
			return "", "", Forbidden("模板预览媒体路径无效")
		}
		if _, err := os.Stat(path); errors.Is(err, os.ErrNotExist) {
			return "", "", NotFound("模板预览媒体不存在")
		} else if err != nil {
			return "", "", err
		}
		return path, media.MimeType, nil
	}
	return "", "", NotFound("模板预览媒体不存在")
}

func (s *Service) canvasTemplatePage(result repository.CanvasTemplatePage, page int, pageSize int, userID string, admin bool) (CanvasTemplatePage, error) {
	if page < 1 {
		page = 1
	}
	if pageSize < 1 {
		pageSize = 40
	}
	views := make([]CanvasTemplateView, 0, len(result.Templates))
	for index := range result.Templates {
		view, err := s.canvasTemplateView(&result.Templates[index], userID, admin)
		if err != nil {
			return CanvasTemplatePage{}, err
		}
		views = append(views, view)
	}
	return CanvasTemplatePage{Templates: views, Page: page, PageSize: pageSize, Total: result.Total, HasMore: int64(page*pageSize) < result.Total}, nil
}

func (s *Service) canvasTemplateView(template *model.CanvasTemplate, userID string, includeDocument bool) (CanvasTemplateView, error) {
	var tags []string
	if strings.TrimSpace(template.TagsJSON) != "" {
		if err := json.Unmarshal([]byte(template.TagsJSON), &tags); err != nil {
			return CanvasTemplateView{}, err
		}
	}
	view := CanvasTemplateView{ID: template.ID, Title: template.Title, Description: template.Description, Category: template.Category, Tags: tags, Status: template.Status, Visibility: template.Visibility, CurrentVersion: template.CurrentVersion, Owned: template.OwnerID == userID, Source: "user", CreatedAt: template.CreatedAt, UpdatedAt: template.UpdatedAt, PublishedAt: template.PublishedAt}
	if template.Status == canvasTemplateStatusPublished {
		view.Source = "published"
	}
	if !includeDocument {
		return view, nil
	}
	version, err := s.repo.CanvasTemplateVersion(template.ID, template.CurrentVersion)
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return CanvasTemplateView{}, NotFound("模板版本不存在")
	}
	if err != nil {
		return CanvasTemplateView{}, err
	}
	var document CanvasTemplateDocument
	if err := json.Unmarshal([]byte(version.DocumentJSON), &document); err != nil {
		return CanvasTemplateView{}, err
	}
	view.Document = &document
	return view, nil
}
