package app

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"infinite-canvas/backend/internal/assets"
	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/repository"

	qiniuAuth "github.com/qiniu/go-sdk/v7/auth"
	qiniuStorage "github.com/qiniu/go-sdk/v7/storage"
	"gorm.io/gorm"
)

func (s *Service) deleteUserAssetWithResources(userID string, assetID string, purge bool) error {
	return s.deleteUserAssetsWithResources(userID, []string{assetID}, purge)
}

func (s *Service) deleteUserAssetsWithResources(userID string, ids []string, purge bool) error {
	if strings.TrimSpace(userID) == "" || len(ids) == 0 || len(ids) > 1000 {
		return BadAuthRequest("每次删除须提供 1–1000 个素材 ID 和有效用户")
	}
	assetIDs := make([]string, 0, len(ids))
	seen := make(map[string]struct{}, len(ids))
	for _, id := range ids {
		id = strings.TrimSpace(id)
		if id == "" {
			return BadAuthRequest("素材 ID 不能为空")
		}
		if _, exists := seen[id]; !exists {
			seen[id] = struct{}{}
			assetIDs = append(assetIDs, id)
		}
	}
	assetRecords, err := s.repo.AssetsForUserIDs(userID, assetIDs)
	if err != nil {
		return err
	}
	if len(assetRecords) != len(assetIDs) {
		return NotFound("素材不存在或无权删除")
	}
	deleteReferencedResources := purge
	if !purge {
		// 内部普通删除仍为单素材保护路径；用户显式删除统一走 purge。
		if len(assetRecords) != 1 {
			return BadAuthRequest("普通删除仅支持单个素材")
		}
		deleteReferencedResources = assetRecords[0].Status == model.AssetVersionStatusArchived
	}
	versions, representations, err := s.repo.AssetsResourceRecords(assetIDs)
	if err != nil {
		return err
	}

	resourceIDs := map[string]struct{}{}
	for _, asset := range assetRecords {
		if err := collectOwnedAssetDocumentReferences(asset.PayloadJSON, resourceIDs); err != nil {
			return BadAuthRequest("素材数据无法解析，已停止删除以避免误删文件")
		}
	}
	for _, version := range versions {
		if err := collectOwnedAssetDocumentReferences(version.DefinitionJSON, resourceIDs); err != nil {
			return BadAuthRequest("素材版本数据无法解析，已停止删除以避免误删文件")
		}
	}
	for _, representation := range representations {
		if resourceID := validCanvasResourceID(representation.ResourceID); resourceID != "" {
			resourceIDs[resourceID] = struct{}{}
		}
		if err := collectOwnedAssetDocumentReferences(representation.MetadataJSON, resourceIDs); err != nil {
			return BadAuthRequest("素材表现数据无法解析，已停止删除以避免误删文件")
		}
	}

	candidateIDs := sortedReferenceIDs(resourceIDs)
	resources, err := s.repo.ResourcesForUserIDs(userID, candidateIDs)
	if err != nil {
		return err
	}
	ownedIDs := make([]string, 0, len(resources))
	ownedIDSet := make(map[string]struct{}, len(resources))
	for _, resource := range resources {
		ownedIDs = append(ownedIDs, resource.ID)
		ownedIDSet[resource.ID] = struct{}{}
	}

	usages := make([]resourceUsage, 0)
	if !deleteReferencedResources {
		assetReferences, referenceErr := s.repo.AssetBusinessReferences(userID, assetIDs[0])
		if referenceErr != nil {
			return referenceErr
		}
		for _, reference := range assetReferences {
			usages = append(usages, resourceUsage{Kind: reference.Kind, ID: reference.ID, Title: reference.Title})
		}
	}
	if len(ownedIDs) > 0 {
		var snapshot repository.ResourceReferenceSnapshot
		var snapshotErr error
		if deleteReferencedResources {
			snapshot, snapshotErr = s.repo.OtherAssetResourceReferences(userID, assetIDs)
		} else {
			snapshot, snapshotErr = s.repo.ResourceReferenceSnapshot(userID, assetIDs[0], ownedIDs)
		}
		if snapshotErr != nil {
			return snapshotErr
		}
		sharedAssetResourceIDs := map[string]struct{}{}
		for _, reference := range snapshot.Direct {
			if _, exists := ownedIDSet[reference.ResourceID]; exists {
				if reference.Kind == "素材" {
					sharedAssetResourceIDs[reference.ResourceID] = struct{}{}
					continue
				}
				if !deleteReferencedResources {
					usages = append(usages, resourceUsage{Kind: reference.Kind, ID: reference.ID, Title: reference.Title})
				}
			}
		}
		for _, document := range snapshot.Documents {
			// 已结束任务的输出和日志仅记录生成历史，不构成素材占用。
			// 仅在素材删除时放行；孤儿清理仍保留尚未入库的任务产物。
			switch document.TaskStatus {
			case model.TaskStatusSucceeded, model.TaskStatusFailed, model.TaskStatusCancelled:
				if document.Kind == "任务日志" || document.Kind == "任务结果" {
					continue
				}
				if document.Kind == "任务" {
					document.SecondaryJSON = ""
				}
			}
			referencedIDs := documentReferencedResourceIDs(document.PrimaryJSON, ownedIDSet)
			for resourceID := range documentReferencedResourceIDs(document.SecondaryJSON, ownedIDSet) {
				referencedIDs[resourceID] = struct{}{}
			}
			if len(referencedIDs) > 0 {
				if document.Kind == "素材" {
					for resourceID := range referencedIDs {
						sharedAssetResourceIDs[resourceID] = struct{}{}
					}
					continue
				}
				if !deleteReferencedResources {
					usages = append(usages, resourceUsage{Kind: document.Kind, ID: document.ID, Title: document.Title})
				}
			}
		}
		if len(sharedAssetResourceIDs) > 0 {
			deletableOwnedIDs := ownedIDs[:0]
			for _, resourceID := range ownedIDs {
				if _, shared := sharedAssetResourceIDs[resourceID]; !shared {
					deletableOwnedIDs = append(deletableOwnedIDs, resourceID)
				}
			}
			ownedIDs = deletableOwnedIDs
		}
	}
	if message := resourceOccupiedMessage(usages); message != "" {
		return BadAuthRequest(message)
	}

	// 所有引用校验必须先完成；仍被其他资源记录共享的物理对象不会进入删除队列。
	physicalObjects := map[string]*model.Resource{}
	for index := range resources {
		resource := &resources[index]
		sharedCount, countErr := s.repo.ResourceStorageReferenceCount(resource, ownedIDs)
		if countErr != nil {
			return countErr
		}
		if sharedCount > 0 {
			continue
		}
		physicalObjects[resourceStorageIdentity(resource)] = resource
	}
	deletionJobs := resourceDeletionJobs(userID, physicalObjects)
	// 业务记录和 Outbox 必须在同一事务提交。事务失败时物理文件完全不动；
	// 提交成功后由幂等 worker 清理，进程退出或对象存储暂时失败都可继续重试。
	if err := s.repo.DeleteAssetsAndResources(userID, assetIDs, ownedIDs, deletionJobs, deleteReferencedResources); err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return NotFound("素材不存在或无权删除")
		}
		if errors.Is(err, repository.ErrCanvasHistoryResourceReferenced) {
			return BadAuthRequest("素材仍被画布历史版本引用，已保留文件")
		}
		return fmt.Errorf("素材记录删除失败，请重试：%w", err)
	}
	if len(deletionJobs) > 0 {
		// 纳入停机等待；排空期间拒绝新 worker 时，已提交的 outbox 留待下次启动处理。
		s.runWorkerTask(func() { s.drainResourceDeletionJobs(len(deletionJobs)) })
	}
	return nil
}

func resourceDeletionJobs(userID string, physicalObjects map[string]*model.Resource) []model.ResourceDeletionJob {
	keys := make([]string, 0, len(physicalObjects))
	for key := range physicalObjects {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	now := time.Now()
	jobs := make([]model.ResourceDeletionJob, 0, len(keys))
	for _, key := range keys {
		resource := physicalObjects[key]
		jobs = append(jobs, model.ResourceDeletionJob{
			ID: newID(), UserID: userID, ResourceID: resource.ID,
			Provider: resource.Provider, Endpoint: resource.Endpoint, Bucket: resource.Bucket,
			StorageSettingID: resource.StorageSettingID, ObjectKey: resource.ObjectKey,
			Status: model.ResourceDeletionStatusPending, NextAttemptAt: now,
		})
	}
	return jobs
}

type resourceUsage struct {
	Kind  string
	ID    string
	Title string
}

func resourceOccupiedMessage(usages []resourceUsage) string {
	seen := map[string]struct{}{}
	labels := make([]string, 0, len(usages))
	for _, usage := range usages {
		key := usage.Kind + "\x00" + usage.ID
		if _, exists := seen[key]; exists {
			continue
		}
		seen[key] = struct{}{}
		title := strings.TrimSpace(usage.Title)
		if title == "" {
			title = usage.ID
		}
		title = truncateRunes(title, 32)
		labels = append(labels, usage.Kind+"「"+title+"」")
	}
	if len(labels) == 0 {
		return ""
	}
	sort.Strings(labels)
	visible := labels
	if len(visible) > 3 {
		visible = append(append([]string{}, visible[:3]...), fmt.Sprintf("等 %d 处", len(labels)))
	}
	return "素材仍被" + strings.Join(visible, "、") + "引用，请先在对应画布、任务或业务记录中解除引用后再删除"
}

func collectOwnedAssetDocumentReferences(raw string, resourceIDs map[string]struct{}) error {
	return assets.CollectOwnedDocumentReferences(raw, resourceIDs)
}

func documentReferencesResources(raw string, resourceIDs map[string]struct{}) bool {
	return assets.DocumentReferences(raw, resourceIDs)
}

func documentReferencedResourceIDs(raw string, resourceIDs map[string]struct{}) map[string]struct{} {
	return assets.DocumentReferencedIDs(raw, resourceIDs)
}

func sortedReferenceIDs(values map[string]struct{}) []string {
	return assets.SortedIDs(values)
}

func resourceStorageIdentity(resource *model.Resource) string {
	if resource == nil {
		return ""
	}
	provider := strings.ToLower(strings.TrimSpace(resource.Provider))
	if provider == "" {
		provider = "local"
	}
	return strings.Join([]string{provider, resource.Endpoint, resource.Bucket, resource.ObjectKey}, "\x00")
}

func (s *Service) deleteStoredResourceObject(userID string, resource *model.Resource) error {
	if resource == nil {
		return errors.New("资源记录为空")
	}
	if strings.TrimSpace(resource.ObjectKey) == "" {
		return fmt.Errorf("资源 %s 的存储路径为空", resource.ID)
	}
	protected, err := s.repo.CanvasHistoryReferencesObject(resource)
	if err != nil {
		return err
	}
	if protected {
		return errors.New("资源仍被画布历史版本引用")
	}
	switch strings.ToLower(strings.TrimSpace(resource.Provider)) {
	case "", "local":
		return s.deleteLocalResourceObject(resource.ObjectKey)
	case aliyunOSSProvider:
		setting, err := s.ossSettingForResource(userID, resource)
		if err != nil {
			return fmt.Errorf("无法读取阿里云 OSS 配置：%w", err)
		}
		return deleteAliyunOSSObject(setting, resource.ObjectKey)
	case tencentCOSProvider:
		setting, err := s.ossSettingForResource(userID, resource)
		if err != nil {
			return fmt.Errorf("无法读取腾讯云 COS 配置：%w", err)
		}
		return deleteTencentCOSObject(setting, resource.ObjectKey)
	case qiniuKodoProvider:
		setting, err := s.ossSettingForResource(userID, resource)
		if err != nil {
			return fmt.Errorf("无法读取七牛云 Kodo 配置：%w", err)
		}
		return deleteQiniuObject(setting, resource.ObjectKey)
	case s3Provider:
		setting, err := s.ossSettingForResource(userID, resource)
		if err != nil {
			return fmt.Errorf("无法读取 S3 配置：%w", err)
		}
		return deleteS3Object(setting, resource.ObjectKey)
	default:
		return fmt.Errorf("资源 %s 使用了不支持的存储类型 %q", resource.ID, resource.Provider)
	}
}

func (s *Service) deleteLocalResourceObject(objectKey string) error {
	root, err := filepath.Abs(filepath.Join(s.dataDir, "resources"))
	if err != nil {
		return fmt.Errorf("解析本地资源目录失败：%w", err)
	}
	target, err := filepath.Abs(filepath.Join(root, filepath.FromSlash(strings.TrimLeft(objectKey, "/\\"))))
	if err != nil {
		return fmt.Errorf("解析本地资源路径失败：%w", err)
	}
	relative, err := filepath.Rel(root, target)
	if err != nil || relative == "." || relative == ".." || strings.HasPrefix(relative, ".."+string(filepath.Separator)) {
		return errors.New("本地资源路径超出允许目录")
	}
	fileInfo, err := os.Lstat(target)
	if errors.Is(err, os.ErrNotExist) {
		return nil
	} else if err != nil {
		return fmt.Errorf("检查服务器本地文件失败：%w", err)
	}
	if fileInfo.IsDir() {
		return errors.New("本地资源路径指向目录，已停止删除")
	}
	resolvedRoot, err := filepath.EvalSymlinks(root)
	if err != nil {
		return fmt.Errorf("检查本地资源目录失败：%w", err)
	}
	resolvedTarget, err := filepath.EvalSymlinks(target)
	if err != nil {
		return fmt.Errorf("检查本地资源路径失败：%w", err)
	}
	resolvedRelative, err := filepath.Rel(resolvedRoot, resolvedTarget)
	if err != nil || resolvedRelative == "." || resolvedRelative == ".." || strings.HasPrefix(resolvedRelative, ".."+string(filepath.Separator)) {
		return errors.New("本地资源真实路径超出允许目录")
	}
	if err := os.Remove(target); err != nil && !errors.Is(err, os.ErrNotExist) {
		return fmt.Errorf("删除服务器本地文件失败：%w", err)
	}
	return nil
}

func deleteAliyunOSSObject(setting ossSettingValue, objectKey string) error {
	req, err := newOSSRequest(http.MethodDelete, setting, objectKey, "", nil)
	if err != nil {
		return err
	}
	resp, err := OutboundHTTPClient(2 * time.Minute).Do(req)
	if err != nil {
		return fmt.Errorf("删除阿里云 OSS 对象失败：%w", err)
	}
	defer resp.Body.Close()
	if (resp.StatusCode < 200 || resp.StatusCode >= 300) && resp.StatusCode != http.StatusNotFound {
		detail, _ := io.ReadAll(io.LimitReader(resp.Body, 512))
		return fmt.Errorf("删除阿里云 OSS 对象失败：%s %s", resp.Status, strings.TrimSpace(string(detail)))
	}
	return nil
}

func deleteTencentCOSObject(setting ossSettingValue, objectKey string) error {
	client, err := newCOSClient(setting, 2*time.Minute)
	if err != nil {
		return err
	}
	resp, err := client.Object.Delete(context.Background(), objectKey)
	if resp != nil && resp.Body != nil {
		defer resp.Body.Close()
	}
	if err != nil {
		if resp != nil && resp.StatusCode == http.StatusNotFound {
			return nil
		}
		return fmt.Errorf("删除腾讯云 COS 对象失败：%w", err)
	}
	return nil
}

func deleteQiniuObject(setting ossSettingValue, objectKey string) error {
	if setting.AccessKeyID == "" || setting.AccessKeySecret == "" {
		return errors.New("七牛云 Kodo 访问密钥不可用")
	}
	if setting.Bucket == "" || strings.TrimSpace(objectKey) == "" {
		return errors.New("七牛云 Kodo Bucket 或对象路径为空")
	}
	mac := qiniuAuth.New(setting.AccessKeyID, setting.AccessKeySecret)
	manager := qiniuStorage.NewBucketManager(mac, &qiniuStorage.Config{Region: qiniuRegion(setting.Region), UseHTTPS: true})
	if err := manager.Delete(setting.Bucket, strings.TrimLeft(objectKey, "/")); err != nil {
		if strings.Contains(strings.ToLower(err.Error()), "no such") || strings.Contains(strings.ToLower(err.Error()), "not found") {
			return nil
		}
		return fmt.Errorf("删除七牛云 Kodo 对象失败：%w", err)
	}
	return nil
}
