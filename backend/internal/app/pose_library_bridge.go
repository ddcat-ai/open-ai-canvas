package app

import (
	"context"

	"yingce/backend/internal/model"
	"yingce/backend/internal/poselibrary"
)

const (
	PoseLibraryMaxImportBytes = poselibrary.MaxImportBytes
	PoseLibraryMaxImageBytes  = poselibrary.MaxImageBytes
	PoseLibraryFileThumb      = poselibrary.FileThumb
	PoseLibraryFileImage      = poselibrary.FileImage
)

type (
	PoseLibraryCatalogQuery      = poselibrary.CatalogQuery
	PoseLibraryCatalogPage       = poselibrary.CatalogPage
	PoseLibraryFileVariant       = poselibrary.FileVariant
	PoseLibraryOpenedFile        = poselibrary.OpenedFile
	PoseLibraryAdminQuery        = poselibrary.AdminQuery
	PoseLibraryAdminPage         = poselibrary.AdminPage
	PoseLibraryAdminItem         = poselibrary.AdminItem
	PoseLibraryImportRequest     = poselibrary.ImportRequest
	PoseLibraryImportResult      = poselibrary.ImportResult
	PoseLibrarySyncRequest       = poselibrary.SyncRequest
	PoseLibrarySyncResult        = poselibrary.SyncResult
	PoseLibraryUpdateItemRequest = poselibrary.UpdateItemRequest
	PoseLibraryBulkRequest       = poselibrary.BulkRequest
	PoseLibraryBulkResult        = poselibrary.BulkResult
	PoseLibraryCreateItemRequest = poselibrary.CreateItemRequest
)

// PoseLibraryUseResult 是一张选用后复制到当前用户名下的姿势图。
type PoseLibraryUseResult struct {
	ItemID   string          `json:"itemId"`
	Name     string          `json:"name"`
	Angle    string          `json:"angle"`
	Category string          `json:"category"`
	Resource *model.Resource `json:"resource"`
}

type poseLibraryAdminGate struct{ svc *Service }

func (g poseLibraryAdminGate) RequireAdmin(user *model.User) error {
	if g.svc == nil {
		return Unauthorized("请先登录")
	}
	return g.svc.RequireAdmin(user)
}

func (g poseLibraryAdminGate) AppendAudit(actor *model.User, action, targetType, targetID, summary string, metadata any) error {
	if g.svc == nil {
		return Unauthorized("请先登录")
	}
	return g.svc.appendAdminAudit(actor, action, targetType, targetID, summary, metadata)
}

func (s *Service) poseLibraryDomain() *poselibrary.Service {
	if s.poseLibrary != nil {
		return s.poseLibrary
	}
	return poselibrary.New(s.repo, s.dataDir, poseLibraryAdminGate{svc: s})
}

func (s *Service) PoseLibraryCatalog(actor *model.User, query PoseLibraryCatalogQuery) (*PoseLibraryCatalogPage, error) {
	return s.poseLibraryDomain().Catalog(actor, query)
}

func (s *Service) OpenPoseLibraryFile(actor *model.User, id string, variant PoseLibraryFileVariant) (*PoseLibraryOpenedFile, error) {
	return s.poseLibraryDomain().OpenFile(actor, id, variant)
}

// UsePoseLibraryItems 把选中的姿势原图复制成当前用户的资源，画布节点和生成任务只引用用户自己的资源。
// 上传幂等键绑定条目与原图摘要：同一用户重复插入同一张图复用已有资源，不重复占用额度。
func (s *Service) UsePoseLibraryItems(actor *model.User, ids []string) ([]PoseLibraryUseResult, error) {
	sources, err := s.poseLibraryDomain().ImagesForUse(actor, ids)
	if err != nil {
		return nil, err
	}
	results := make([]PoseLibraryUseResult, 0, len(sources))
	for _, source := range sources {
		uploadKey := normalizedResourceUploadKey([]string{"pose-library:" + source.Item.ID + ":" + source.Item.ImageSHA256})
		existing, err := s.resourceForUploadKey(actor.ID, uploadKey)
		if err != nil {
			return nil, err
		}
		if existing != nil && existing.Status == model.ResourceStatusPending {
			return nil, resourceUploadInProgress()
		}
		resource, err := s.storeFetchedResource(actor.ID, existing, uploadKey, source.FileName, source.Data, source.Item.Width, source.Item.Height, 0)
		if err != nil {
			return nil, err
		}
		results = append(results, PoseLibraryUseResult{ItemID: source.Item.ID, Name: source.Item.Name, Angle: source.Item.Angle, Category: source.Item.Category, Resource: resource})
	}
	return results, nil
}

func (s *Service) AdminPoseLibraryItems(actor *model.User, query PoseLibraryAdminQuery) (*PoseLibraryAdminPage, error) {
	return s.poseLibraryDomain().AdminList(actor, query)
}

func (s *Service) ImportPoseLibrary(actor *model.User, req PoseLibraryImportRequest) (*PoseLibraryImportResult, error) {
	return s.poseLibraryDomain().Import(actor, req)
}

func (s *Service) SyncPoseLibraryImages(ctx context.Context, actor *model.User, req PoseLibrarySyncRequest) (*PoseLibrarySyncResult, error) {
	return s.poseLibraryDomain().SyncImages(ctx, actor, req)
}

func (s *Service) UpdatePoseLibraryItem(actor *model.User, id string, req PoseLibraryUpdateItemRequest) (*PoseLibraryAdminItem, error) {
	return s.poseLibraryDomain().UpdateItem(actor, id, req)
}

func (s *Service) DeletePoseLibraryItem(actor *model.User, id string) error {
	return s.poseLibraryDomain().DeleteItem(actor, id)
}

func (s *Service) BulkPoseLibraryItems(actor *model.User, req PoseLibraryBulkRequest) (*PoseLibraryBulkResult, error) {
	return s.poseLibraryDomain().Bulk(actor, req)
}

func (s *Service) CreatePoseLibraryItem(actor *model.User, req PoseLibraryCreateItemRequest) (*PoseLibraryAdminItem, error) {
	return s.poseLibraryDomain().CreateCustomItem(actor, req)
}
