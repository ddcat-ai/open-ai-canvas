package service

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"infinite-canvas/backend/internal/model"

	qiniuAuth "github.com/qiniu/go-sdk/v7/auth"
	qiniuStorage "github.com/qiniu/go-sdk/v7/storage"
)

func (s *Service) deleteUserAssetWithResources(userID string, assetID string) error {
	asset, err := s.repo.AssetForUser(userID, assetID)
	if err != nil {
		return err
	}
	assetReferences, err := s.repo.AssetBusinessReferences(userID, assetID)
	if err != nil {
		return err
	}
	versions, representations, err := s.repo.AssetResourceRecords(assetID)
	if err != nil {
		return err
	}

	resourceIDs := map[string]struct{}{}
	originTaskIDs := map[string]struct{}{}
	if err := collectOwnedAssetDocumentReferences(asset.PayloadJSON, resourceIDs, originTaskIDs); err != nil {
		return BadAuthRequest("素材数据无法解析，已停止删除以避免误删文件")
	}
	for _, version := range versions {
		if err := collectOwnedAssetDocumentReferences(version.DefinitionJSON, resourceIDs, originTaskIDs); err != nil {
			return BadAuthRequest("素材版本数据无法解析，已停止删除以避免误删文件")
		}
	}
	for _, representation := range representations {
		if resourceID := validCanvasResourceID(representation.ResourceID); resourceID != "" {
			resourceIDs[resourceID] = struct{}{}
		}
		if taskID := validCanvasResourceID(representation.TaskID); taskID != "" {
			originTaskIDs[taskID] = struct{}{}
		}
		if err := collectOwnedAssetDocumentReferences(representation.MetadataJSON, resourceIDs, originTaskIDs); err != nil {
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

	usages := make([]resourceUsage, 0, len(assetReferences))
	for _, reference := range assetReferences {
		usages = append(usages, resourceUsage{Kind: reference.Kind, ID: reference.ID, Title: reference.Title})
	}
	if len(ownedIDs) > 0 {
		snapshot, snapshotErr := s.repo.ResourceReferenceSnapshot(userID, assetID, ownedIDs)
		if snapshotErr != nil {
			return snapshotErr
		}
		for _, reference := range snapshot.Direct {
			if _, exists := ownedIDSet[reference.ResourceID]; exists {
				usages = append(usages, resourceUsage{Kind: reference.Kind, ID: reference.ID, Title: reference.Title})
			}
		}
		for _, document := range snapshot.Documents {
			primaryReferenced := documentReferencesResources(document.PrimaryJSON, ownedIDSet)
			secondaryReferenced := documentReferencesResources(document.SecondaryJSON, ownedIDSet)
			if document.Kind == "任务" {
				_, originTask := originTaskIDs[document.ID]
				secondaryReferenced = secondaryReferenced && !originTask
			}
			if primaryReferenced || secondaryReferenced {
				usages = append(usages, resourceUsage{Kind: document.Kind, ID: document.ID, Title: document.Title})
			}
		}
	}
	if message := resourceOccupiedMessage(usages); message != "" {
		return BadAuthRequest(message)
	}

	// 所有引用校验必须先完成；任何资源仍被占用时，一个物理文件都不会开始删除。
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
	physicalKeys := make([]string, 0, len(physicalObjects))
	for key := range physicalObjects {
		physicalKeys = append(physicalKeys, key)
	}
	sort.Strings(physicalKeys)
	for _, key := range physicalKeys {
		resource := physicalObjects[key]
		if err := s.deleteStoredResourceObject(userID, resource); err != nil {
			return fmt.Errorf("素材文件删除失败，素材记录已保留：%w", err)
		}
	}
	if err := s.repo.DeleteAssetAndResources(userID, assetID, ownedIDs); err != nil {
		return fmt.Errorf("素材记录删除失败，请重试：%w", err)
	}
	return nil
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

func collectOwnedAssetDocumentReferences(raw string, resourceIDs map[string]struct{}, taskIDs map[string]struct{}) error {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return nil
	}
	var value any
	if err := json.Unmarshal([]byte(raw), &value); err != nil {
		return err
	}
	walkReferenceDocument(value, "", resourceIDs, taskIDs)
	return nil
}

func walkReferenceDocument(value any, parentKey string, resourceIDs map[string]struct{}, taskIDs map[string]struct{}) {
	switch item := value.(type) {
	case map[string]any:
		for key, child := range item {
			walkReferenceDocument(child, key, resourceIDs, taskIDs)
		}
	case []any:
		for _, child := range item {
			walkReferenceDocument(child, parentKey, resourceIDs, taskIDs)
		}
	case string:
		key := normalizeReferenceKey(parentKey)
		if isResourceLocatorKey(key) {
			if resourceID := canvasResourceID(item); resourceID != "" {
				resourceIDs[resourceID] = struct{}{}
			}
		}
		if isBareResourceIDKey(key) {
			if resourceID := validCanvasResourceID(item); resourceID != "" {
				resourceIDs[resourceID] = struct{}{}
			}
		}
		if key == "taskid" || key == "taskids" {
			if taskID := validCanvasResourceID(item); taskID != "" {
				taskIDs[taskID] = struct{}{}
			}
		}
	}
}

func normalizeReferenceKey(key string) string {
	key = strings.ToLower(strings.TrimSpace(key))
	return strings.NewReplacer("_", "", "-", "").Replace(key)
}

func isBareResourceIDKey(key string) bool {
	return key == "resourceid" || key == "resourceids" || key == "sampleresourceid" || key == "referenceresourceid" || key == "referenceresourceids"
}

func isResourceLocatorKey(key string) bool {
	if key == "" || strings.HasSuffix(key, "url") || strings.HasSuffix(key, "urls") || strings.HasSuffix(key, "storagekey") {
		return true
	}
	switch key {
	case "content", "data", "image", "images", "video", "videos", "audio", "audios", "media", "references", "result", "output", "artifactref", "providerartifactref":
		return true
	default:
		return false
	}
}

func documentReferencesResources(raw string, resourceIDs map[string]struct{}) bool {
	raw = strings.TrimSpace(raw)
	if raw == "" || len(resourceIDs) == 0 {
		return false
	}
	var value any
	if err := json.Unmarshal([]byte(raw), &value); err == nil {
		found := map[string]struct{}{}
		walkReferenceDocument(value, "", found, map[string]struct{}{})
		for resourceID := range found {
			if _, exists := resourceIDs[resourceID]; exists {
				return true
			}
		}
		return false
	}
	// cover_url 等字段可以直接保存资源 URL，而不是 JSON。候选记录已经包含完整 ID，保守阻止删除。
	for resourceID := range resourceIDs {
		if strings.Contains(raw, resourceID) {
			return true
		}
	}
	return false
}

func sortedReferenceIDs(values map[string]struct{}) []string {
	result := make([]string, 0, len(values))
	for value := range values {
		result = append(result, value)
	}
	sort.Strings(result)
	return result
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
