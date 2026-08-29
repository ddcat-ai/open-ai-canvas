package service

import (
	"errors"
	"sort"
	"strings"

	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/repository"
)

const maxAdminResourceDeleteCount = 100

type AdminResourceDeleteRequest struct {
	ResourceIDs []string `json:"resourceIds"`
}

type AdminResourceReferenceView struct {
	Kind  string `json:"kind"`
	ID    string `json:"id"`
	Title string `json:"title"`
}

type AdminResourceDeleteBlocked struct {
	ID         string                       `json:"id"`
	Reason     string                       `json:"reason"`
	References []AdminResourceReferenceView `json:"references"`
}

type AdminResourceDeleteResult struct {
	Deleted []string                     `json:"deleted"`
	Blocked []AdminResourceDeleteBlocked `json:"blocked"`
}

func (s *Service) DeleteAdminResources(actor *model.User, req AdminResourceDeleteRequest) (*AdminResourceDeleteResult, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return nil, err
	}
	resourceIDs, err := normalizeAdminResourceDeleteIDs(req.ResourceIDs)
	if err != nil {
		return nil, err
	}
	s.storageMu.Lock()
	defer s.storageMu.Unlock()

	resources, err := s.repo.AdminResourcesByIDs(resourceIDs)
	if err != nil {
		return nil, err
	}
	resourcesByID := make(map[string]model.Resource, len(resources))
	resourcesByUser := make(map[string][]model.Resource)
	for _, resource := range resources {
		resourcesByID[resource.ID] = resource
		resourcesByUser[resource.UserID] = append(resourcesByUser[resource.UserID], resource)
	}
	blockedByID := make(map[string]AdminResourceDeleteBlocked)
	for _, resourceID := range resourceIDs {
		if _, exists := resourcesByID[resourceID]; !exists {
			blockedByID[resourceID] = AdminResourceDeleteBlocked{ID: resourceID, Reason: "资源不存在", References: []AdminResourceReferenceView{}}
		}
	}
	for userID, userResources := range resourcesByUser {
		userResourceIDs := make([]string, 0, len(userResources))
		for _, resource := range userResources {
			userResourceIDs = append(userResourceIDs, resource.ID)
		}
		snapshot, snapshotErr := s.repo.ResourceReferenceSnapshot(userID, "", userResourceIDs)
		if snapshotErr != nil {
			return nil, snapshotErr
		}
		for resourceID, references := range adminResourceReferences(snapshot, userResources) {
			blockedByID[resourceID] = AdminResourceDeleteBlocked{ID: resourceID, Reason: "资源仍被业务数据引用", References: references}
		}
	}
	announcementReferences, err := s.repo.AnnouncementResourceReferences(resourceIDs)
	if err != nil {
		return nil, err
	}
	for _, reference := range announcementReferences {
		blocked := blockedByID[reference.ResourceID]
		blocked.ID = reference.ResourceID
		blocked.Reason = "资源仍被业务数据引用"
		blocked.References = appendUniqueAdminResourceReference(blocked.References, AdminResourceReferenceView{Kind: reference.Kind, ID: reference.ID, Title: reference.Title})
		blockedByID[reference.ResourceID] = blocked
	}

	deletable := make([]model.Resource, 0, len(resources))
	deletableIDs := make([]string, 0, len(resources))
	for _, resourceID := range resourceIDs {
		resource, exists := resourcesByID[resourceID]
		if !exists {
			continue
		}
		if _, blocked := blockedByID[resourceID]; blocked {
			continue
		}
		if !supportedResourceDeleteProvider(resource.Provider) {
			blockedByID[resourceID] = AdminResourceDeleteBlocked{ID: resourceID, Reason: "资源使用了不支持的存储类型，无法安全删除", References: []AdminResourceReferenceView{}}
			continue
		}
		deletable = append(deletable, resource)
		deletableIDs = append(deletableIDs, resource.ID)
	}

	physicalObjects := map[string]*model.Resource{}
	checkedPhysical := map[string]bool{}
	for index := range deletable {
		resource := &deletable[index]
		if strings.TrimSpace(resource.ObjectKey) == "" {
			continue
		}
		identity := resourceStorageIdentity(resource)
		if checkedPhysical[identity] {
			continue
		}
		checkedPhysical[identity] = true
		sharedCount, countErr := s.repo.ResourceStorageReferenceCount(resource, deletableIDs)
		if countErr != nil {
			return nil, countErr
		}
		if sharedCount == 0 {
			physicalObjects[identity] = resource
		}
	}
	deletionJobs := resourceDeletionJobsForResources(physicalObjects)
	queuedResourceIDs := make(map[string]bool, len(deletionJobs))
	for _, job := range deletionJobs {
		queuedResourceIDs[job.ResourceID] = true
	}
	audits := make([]model.AdminAuditEvent, 0, len(deletable))
	for _, resource := range deletable {
		event, eventErr := newAdminAuditEvent(actor, "resource.delete", "resource", resource.ID, "管理员删除存储资源", map[string]any{
			"userId": resource.UserID, "kind": resource.Kind, "provider": normalizedResourceProvider(resource.Provider),
			"objectKey": resource.ObjectKey, "physicalDeleteQueued": queuedResourceIDs[resource.ID],
		})
		if eventErr != nil {
			return nil, eventErr
		}
		audits = append(audits, *event)
	}
	if err := s.repo.DeleteAdminResources(deletable, deletionJobs, audits); err != nil {
		if errors.Is(err, repository.ErrAdminResourceDeleteChanged) || errors.Is(err, repository.ErrAdminResourceStillReferenced) {
			return nil, BadAuthRequest("资源状态或引用已变化，请刷新后重试")
		}
		return nil, err
	}
	if len(deletionJobs) > 0 {
		go s.drainResourceDeletionJobs(len(deletionJobs))
	}

	result := &AdminResourceDeleteResult{Deleted: []string{}, Blocked: []AdminResourceDeleteBlocked{}}
	deletedSet := make(map[string]struct{}, len(deletable))
	for _, resource := range deletable {
		deletedSet[resource.ID] = struct{}{}
	}
	for _, resourceID := range resourceIDs {
		if _, deleted := deletedSet[resourceID]; deleted {
			result.Deleted = append(result.Deleted, resourceID)
		} else if blocked, exists := blockedByID[resourceID]; exists {
			result.Blocked = append(result.Blocked, blocked)
		}
	}
	return result, nil
}

func normalizeAdminResourceDeleteIDs(values []string) ([]string, error) {
	if len(values) == 0 {
		return nil, BadAuthRequest("请选择要删除的资源")
	}
	result := make([]string, 0, len(values))
	seen := make(map[string]struct{}, len(values))
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value == "" || len(value) > 80 {
			return nil, BadAuthRequest("资源 ID 无效")
		}
		if _, exists := seen[value]; exists {
			continue
		}
		seen[value] = struct{}{}
		result = append(result, value)
	}
	if len(result) == 0 || len(result) > maxAdminResourceDeleteCount {
		return nil, BadAuthRequest("单次最多删除 100 个资源")
	}
	return result, nil
}

func adminResourceReferences(snapshot repository.ResourceReferenceSnapshot, resources []model.Resource) map[string][]AdminResourceReferenceView {
	result := make(map[string][]AdminResourceReferenceView)
	seen := make(map[string]map[string]struct{})
	for _, reference := range snapshot.Direct {
		appendAdminResourceReference(result, seen, reference.ResourceID, AdminResourceReferenceView{Kind: reference.Kind, ID: reference.ID, Title: reference.Title})
	}
	for _, resource := range resources {
		candidate := map[string]struct{}{resource.ID: {}}
		for _, document := range snapshot.Documents {
			if documentReferencesResources(document.PrimaryJSON, candidate) || documentReferencesResources(document.SecondaryJSON, candidate) {
				appendAdminResourceReference(result, seen, resource.ID, AdminResourceReferenceView{Kind: document.Kind, ID: document.ID, Title: document.Title})
			}
		}
	}
	for resourceID := range result {
		sort.Slice(result[resourceID], func(i, j int) bool {
			left, right := result[resourceID][i], result[resourceID][j]
			if left.Kind != right.Kind {
				return left.Kind < right.Kind
			}
			return left.ID < right.ID
		})
	}
	return result
}

func appendAdminResourceReference(result map[string][]AdminResourceReferenceView, seen map[string]map[string]struct{}, resourceID string, reference AdminResourceReferenceView) {
	if resourceID == "" {
		return
	}
	if seen[resourceID] == nil {
		seen[resourceID] = map[string]struct{}{}
	}
	key := reference.Kind + "\x00" + reference.ID
	if _, exists := seen[resourceID][key]; exists {
		return
	}
	seen[resourceID][key] = struct{}{}
	result[resourceID] = append(result[resourceID], reference)
}

func appendUniqueAdminResourceReference(references []AdminResourceReferenceView, reference AdminResourceReferenceView) []AdminResourceReferenceView {
	for _, existing := range references {
		if existing.Kind == reference.Kind && existing.ID == reference.ID {
			return references
		}
	}
	return append(references, reference)
}

func supportedResourceDeleteProvider(provider string) bool {
	provider = normalizedResourceProvider(provider)
	return oneOf(provider, "local", aliyunOSSProvider, tencentCOSProvider, qiniuKodoProvider, s3Provider)
}

func resourceDeletionJobsForResources(physicalObjects map[string]*model.Resource) []model.ResourceDeletionJob {
	resourcesByUser := make(map[string]map[string]*model.Resource)
	for identity, resource := range physicalObjects {
		if resourcesByUser[resource.UserID] == nil {
			resourcesByUser[resource.UserID] = map[string]*model.Resource{}
		}
		resourcesByUser[resource.UserID][identity] = resource
	}
	userIDs := make([]string, 0, len(resourcesByUser))
	for userID := range resourcesByUser {
		userIDs = append(userIDs, userID)
	}
	sort.Strings(userIDs)
	jobs := []model.ResourceDeletionJob{}
	for _, userID := range userIDs {
		jobs = append(jobs, resourceDeletionJobs(userID, resourcesByUser[userID])...)
	}
	return jobs
}
