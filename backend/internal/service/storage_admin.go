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
	From     string
	To       string
	Page     int
	Limit    int
}

type AdminStorageResourceView struct {
	ID              string             `json:"id"`
	UserID          string             `json:"userId"`
	UserName        string             `json:"userName"`
	Kind            string             `json:"kind"`
	Status          model.ResourceStatus `json:"status"`
	Provider        string             `json:"provider"`
	Endpoint        string             `json:"endpoint,omitempty"`
	Bucket          string             `json:"bucket,omitempty"`
	ObjectKey       string             `json:"objectKey"`
	MimeType        string             `json:"mimeType"`
	Size            int64              `json:"size"`
	Width           int                `json:"width"`
	Height          int                `json:"height"`
	DurationMs      int64              `json:"durationMs"`
	Error           string             `json:"error,omitempty"`
	StorageLocation string             `json:"storageLocation"`
	StorageBytes    int64              `json:"storageBytes"`
	FileURL         string             `json:"fileUrl"`
	CreatedAt       time.Time          `json:"createdAt"`
	UpdatedAt       time.Time          `json:"updatedAt"`
}

type AdminResourcePage struct {
	Items []AdminStorageResourceView `json:"items"`
	Total int64                      `json:"total"`
	Page  int                        `json:"page"`
	Limit int                        `json:"limit"`
}

type AdminStorageStats struct {
	ResourceCount int64                             `json:"resourceCount"`
	ByKind        []repository.ResourceKindStat     `json:"byKind"`
	ByProvider    []repository.ResourceProviderStat `json:"byProvider"`
	TotalBytes    int64                             `json:"totalBytes"`
	LocalBytes    int64                             `json:"localBytes"`
	RemoteBytes   int64                             `json:"remoteBytes"`
}

func (s *Service) AdminResourcePage(actor *model.User, query AdminResourceQuery) (*AdminResourcePage, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return nil, err
	}
	page, limit := normalizeAdminPage(query.Page, query.Limit)
	filter := repository.AdminResourceFilter{Keyword: query.Keyword, Kind: query.Kind, Status: query.Status, Provider: query.Provider, UserID: query.UserID, Limit: limit, Offset: (page - 1) * limit}
	filter.From = parseAdminResourceTime(query.From)
	filter.To = parseAdminResourceTime(query.To)
	resources, total, err := s.repo.AdminResources(filter)
	if err != nil {
		return nil, err
	}
	userIDs := make([]string, 0, len(resources))
	seen := map[string]struct{}{}
	for _, resource := range resources {
		if _, exists := seen[resource.UserID]; !exists {
			seen[resource.UserID] = struct{}{}
			userIDs = append(userIDs, resource.UserID)
		}
	}
	users, err := s.repo.UsersByIDs(userIDs)
	if err != nil {
		return nil, err
	}
	items := make([]AdminStorageResourceView, 0, len(resources))
	for _, resource := range resources {
		provider := normalizedResourceProvider(resource.Provider)
		user := users[resource.UserID]
		items = append(items, AdminStorageResourceView{
			ID: resource.ID, UserID: resource.UserID, UserName: pickAdminUserName(user), Kind: resource.Kind, Status: resource.Status,
			Provider: provider, Endpoint: resource.Endpoint, Bucket: resource.Bucket, ObjectKey: resource.ObjectKey, MimeType: resource.MimeType,
			Size: resource.Size, Width: resource.Width, Height: resource.Height, DurationMs: resource.DurationMs, Error: resource.Error,
			StorageLocation: provider, StorageBytes: resourcePhysicalBytesForAdmin(resource), FileURL: "/api/admin/resources/" + resource.ID + "/file",
			CreatedAt: resource.CreatedAt, UpdatedAt: resource.UpdatedAt,
		})
	}
	return &AdminResourcePage{Items: items, Total: total, Page: page, Limit: limit}, nil
}

func (s *Service) AdminStorageStats(actor *model.User) (*AdminStorageStats, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return nil, err
	}
	count, err := s.repo.ResourceCount()
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
	var total, local, remote int64
	for _, stat := range byKind {
		total += stat.Bytes
	}
	for _, stat := range byProvider {
		if stat.Provider == "local" {
			local += stat.PhysicalBytes
		} else {
			remote += stat.PhysicalBytes
		}
	}
	return &AdminStorageStats{ResourceCount: count, ByKind: byKind, ByProvider: byProvider, TotalBytes: total, LocalBytes: local, RemoteBytes: remote}, nil
}

func (s *Service) ResourceAsAdmin(actor *model.User, id string) (*model.Resource, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return nil, err
	}
	resource, err := s.repo.Resource(strings.TrimSpace(id))
	if resource != nil {
		resource.PublicURL = ""
	}
	return resource, err
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
	return s.openResourceRange(resource.UserID, resource, rangeHeader)
}

func (s *Service) AdminDeleteResource(actor *model.User, id string) error {
	if err := s.RequireAdmin(actor); err != nil {
		return err
	}
	s.storageMu.Lock()
	defer s.storageMu.Unlock()
	resource, err := s.repo.Resource(strings.TrimSpace(id))
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return NotFound("资源不存在")
		}
		return err
	}
	if err := s.ensureAdminResourceIsUnreferenced(resource); err != nil {
		return err
	}
	jobs := resourceDeletionJobs(resource.UserID, map[string]*model.Resource{resourceStorageIdentity(resource): resource})
	if len(jobs) != 1 {
		return errors.New("无法创建资源删除任务")
	}
	if err := s.repo.DeleteResourceAndEnqueueDeletion(resource, jobs[0]); err != nil {
		return err
	}
	if err := s.appendAdminAudit(actor, "resource.delete", "resource", resource.ID, "管理员删除资源", map[string]any{"userId": resource.UserID, "kind": resource.Kind, "provider": normalizedResourceProvider(resource.Provider), "size": resource.Size}); err != nil {
		return err
	}
	go s.drainResourceDeletionJobs(1)
	return nil
}

func (s *Service) ensureAdminResourceIsUnreferenced(resource *model.Resource) error {
	if resource == nil {
		return NotFound("资源不存在")
	}
	if count, err := s.repo.ResourceAnnouncementCount(resource.ID); err != nil {
		return err
	} else if count > 0 {
		return BadAuthRequest("资源仍被系统公告使用，请先移除公告配图")
	}
	snapshot, err := s.repo.ResourceReferenceSnapshot(resource.UserID, "", []string{resource.ID})
	if err != nil {
		return err
	}
	ids := map[string]struct{}{resource.ID: {}}
	for _, document := range snapshot.Documents {
		if documentReferencesResources(document.PrimaryJSON, ids) || documentReferencesResources(document.SecondaryJSON, ids) {
			return BadAuthRequest("资源仍被业务数据引用，请先解除引用")
		}
	}
	if len(snapshot.Direct) > 0 {
		return BadAuthRequest("资源仍被业务数据引用，请先解除引用")
	}
	if count, err := s.repo.ResourceStorageReferenceCount(resource, []string{resource.ID}); err != nil {
		return err
	} else if count > 0 {
		return BadAuthRequest("资源仍与其他记录共享存储对象，暂不能删除")
	}
	return nil
}

func normalizedResourceProvider(provider string) string {
	provider = strings.ToLower(strings.TrimSpace(provider))
	if provider == "" {
		return "local"
	}
	return provider
}

func resourcePhysicalBytesForAdmin(resource model.Resource) int64 {
	if resource.Status != model.ResourceStatusReady {
		return 0
	}
	return resource.Size
}

func pickAdminUserName(user model.User) string {
	if strings.TrimSpace(user.DisplayName) != "" {
		return user.DisplayName
	}
	if strings.TrimSpace(user.Username) != "" {
		return user.Username
	}
	return user.ID
}

func parseAdminResourceTime(raw string) *time.Time {
	for _, layout := range []string{time.RFC3339, "2006-01-02T15:04:05", "2006-01-02"} {
		if parsed, err := time.Parse(layout, strings.TrimSpace(raw)); err == nil {
			return &parsed
		}
	}
	return nil
}
