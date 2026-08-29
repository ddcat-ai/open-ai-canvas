package service

import (
	"errors"
	"strings"
	"time"

	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/repository"

	"gorm.io/gorm"
)

type AdminResourceQuery struct {
	Keyword  string
	Kind     string
	Status   string
	Provider string
	UserID   string
	Page     int
	Limit    int
}

type AdminStorageResourceView struct {
	ID            string               `json:"id"`
	UserID        string               `json:"userId"`
	UserName      string               `json:"userName"`
	Kind          string               `json:"kind"`
	Status        model.ResourceStatus `json:"status"`
	Provider      string               `json:"provider"`
	Bucket        string               `json:"bucket,omitempty"`
	ObjectKey     string               `json:"objectKey"`
	MimeType      string               `json:"mimeType"`
	Size          int64                `json:"size"`
	PhysicalBytes int64                `json:"physicalBytes"`
	Width         int                  `json:"width"`
	Height        int                  `json:"height"`
	DurationMs    int64                `json:"durationMs"`
	FileURL       string               `json:"fileUrl"`
	CreatedAt     time.Time            `json:"createdAt"`
	UpdatedAt     time.Time            `json:"updatedAt"`
}

type AdminResourcePage struct {
	Items []AdminStorageResourceView `json:"items"`
	Total int64                      `json:"total"`
	Page  int                        `json:"page"`
	Limit int                        `json:"limit"`
}

type AdminStorageStats struct {
	repository.ResourceStorageSummary
	ByKind     []repository.ResourceKindStat     `json:"byKind"`
	ByProvider []repository.ResourceProviderStat `json:"byProvider"`
}

func (s *Service) AdminResourcePage(actor *model.User, query AdminResourceQuery) (*AdminResourcePage, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return nil, err
	}
	filter, page, limit, err := normalizeAdminResourceQuery(query)
	if err != nil {
		return nil, err
	}
	resources, total, err := s.repo.AdminResources(filter)
	if err != nil {
		return nil, err
	}
	userIDs := make([]string, 0, len(resources))
	seen := make(map[string]struct{}, len(resources))
	for _, resource := range resources {
		if _, exists := seen[resource.UserID]; exists {
			continue
		}
		seen[resource.UserID] = struct{}{}
		userIDs = append(userIDs, resource.UserID)
	}
	users, err := s.repo.UsersByIDs(userIDs)
	if err != nil {
		return nil, err
	}
	items := make([]AdminStorageResourceView, 0, len(resources))
	for _, resource := range resources {
		provider := normalizedResourceProvider(resource.Provider)
		items = append(items, AdminStorageResourceView{
			ID: resource.ID, UserID: resource.UserID, UserName: adminResourceUserName(users[resource.UserID]),
			Kind: resource.Kind, Status: resource.Status, Provider: provider, Bucket: resource.Bucket,
			ObjectKey: resource.ObjectKey, MimeType: resource.MimeType, Size: resource.Size,
			PhysicalBytes: readyResourceBytes(resource), Width: resource.Width, Height: resource.Height, DurationMs: resource.DurationMs,
			FileURL: "/api/admin/resources/" + resource.ID + "/file", CreatedAt: resource.CreatedAt, UpdatedAt: resource.UpdatedAt,
		})
	}
	return &AdminResourcePage{Items: items, Total: total, Page: page, Limit: limit}, nil
}

func (s *Service) AdminStorageStats(actor *model.User) (*AdminStorageStats, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return nil, err
	}
	summary, err := s.repo.ResourceStorageSummary()
	if err != nil {
		return nil, err
	}
	byKind, err := s.repo.ResourceKindStats()
	if err != nil {
		return nil, err
	}
	byProvider, err := s.repo.ResourceProviderStats()
	if err != nil {
		return nil, err
	}
	return &AdminStorageStats{ResourceStorageSummary: summary, ByKind: byKind, ByProvider: byProvider}, nil
}

func (s *Service) OpenResourceRangeAsAdmin(actor *model.User, id string, rangeHeader string) (*ResourceStream, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return nil, err
	}
	resource, err := s.repo.Resource(strings.TrimSpace(id))
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, NotFound("资源不存在")
		}
		return nil, err
	}
	resource.Provider = normalizedResourceProvider(resource.Provider)
	return s.openResourceRange(resource.UserID, resource, rangeHeader)
}

func normalizeAdminResourceQuery(query AdminResourceQuery) (repository.AdminResourceFilter, int, int, error) {
	page, limit := normalizeAdminPage(query.Page, query.Limit)
	filter := repository.AdminResourceFilter{
		Keyword:  strings.TrimSpace(query.Keyword),
		Kind:     strings.ToLower(strings.TrimSpace(query.Kind)),
		Status:   strings.ToLower(strings.TrimSpace(query.Status)),
		Provider: strings.ToLower(strings.TrimSpace(query.Provider)),
		UserID:   strings.TrimSpace(query.UserID),
		Limit:    limit,
		Offset:   (page - 1) * limit,
	}
	if filter.Kind != "" && !oneOf(filter.Kind, "image", "video", "audio", "file") {
		return repository.AdminResourceFilter{}, 0, 0, BadAuthRequest("资源类型筛选无效")
	}
	if filter.Status != "" && !oneOf(filter.Status, string(model.ResourceStatusPending), string(model.ResourceStatusReady), string(model.ResourceStatusFailed), string(model.ResourceStatusDeleted)) {
		return repository.AdminResourceFilter{}, 0, 0, BadAuthRequest("资源状态筛选无效")
	}
	if filter.Provider != "" && !oneOf(filter.Provider, "local", aliyunOSSProvider, tencentCOSProvider, qiniuKodoProvider, s3Provider) {
		return repository.AdminResourceFilter{}, 0, 0, BadAuthRequest("资源存储位置筛选无效")
	}
	if len(filter.Keyword) > 200 || len(filter.UserID) > 64 {
		return repository.AdminResourceFilter{}, 0, 0, BadAuthRequest("资源筛选条件过长")
	}
	return filter, page, limit, nil
}

func normalizedResourceProvider(provider string) string {
	provider = strings.ToLower(strings.TrimSpace(provider))
	if provider == "" {
		return "local"
	}
	return provider
}

func readyResourceBytes(resource model.Resource) int64 {
	if resource.Status != model.ResourceStatusReady {
		return 0
	}
	return resource.Size
}

func adminResourceUserName(user model.User) string {
	if value := strings.TrimSpace(user.DisplayName); value != "" {
		return value
	}
	if value := strings.TrimSpace(user.Username); value != "" {
		return value
	}
	return user.ID
}

func oneOf(value string, allowed ...string) bool {
	for _, item := range allowed {
		if value == item {
			return true
		}
	}
	return false
}
