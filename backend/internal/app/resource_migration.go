package app

import (
	"fmt"
	"io"
	"os"
	"path/filepath"
	"time"

	"yingce/backend/internal/model"
)

// MoveResourceToLocal 将存储在 OSS/S3 的资源（如视频、图片）安全迁移回服务器本地磁盘，并在成功后清理 OSS 远端对象。
func (s *Service) MoveResourceToLocal(actor *model.User, resourceID string) (*model.Resource, error) {
	if actor == nil {
		return nil, Unauthorized("请先登录")
	}
	resource, err := s.repo.Resource(resourceID)
	if err != nil {
		return nil, NotFound("资源不存在")
	}
	if err := s.RequireAdmin(actor); err != nil && resource.UserID != actor.ID {
		return nil, Forbidden("无权操作此资源")
	}
	if resource.Provider == "local" {
		return resource, nil
	}

	setting, err := s.ossSettingForResource(resource.UserID, resource)
	if err != nil {
		return nil, fmt.Errorf("读取资源的对象存储配置失败：%w", err)
	}
	setting.Provider = firstNonEmpty(resource.Provider, setting.Provider)
	setting.Endpoint = firstNonEmpty(resource.Endpoint, setting.Endpoint)
	setting.Bucket = firstNonEmpty(resource.Bucket, setting.Bucket)
	setting = s.storageSettingWithRuntimePolicy(setting)

	// 1. 从 OSS 流式下载
	stream, err := getOriginOSSObjectRange(setting, resource.ObjectKey, "")
	if err != nil {
		return nil, fmt.Errorf("从对象存储读取资源失败：%w", err)
	}
	defer stream.Body.Close()

	// 2. 准备本地服务器磁盘路径
	targetDir := filepath.Join(s.dataDir, "resources")
	targetPath := filepath.Join(targetDir, filepath.FromSlash(resource.ObjectKey))
	if err := os.MkdirAll(filepath.Dir(targetPath), 0755); err != nil {
		return nil, fmt.Errorf("创建服务器本地存储目录失败：%w", err)
	}

	tmpPath := targetPath + fmt.Sprintf(".transfer-%d.tmp", time.Now().UnixNano())
	tmpFile, err := os.OpenFile(tmpPath, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0644)
	if err != nil {
		return nil, fmt.Errorf("创建服务器临时文件失败：%w", err)
	}

	written, err := io.Copy(tmpFile, stream.Body)
	_ = tmpFile.Close()
	if err != nil {
		_ = os.Remove(tmpPath)
		return nil, fmt.Errorf("下载资源到服务器失败：%w", err)
	}
	if resource.Size > 0 && written != resource.Size {
		_ = os.Remove(tmpPath)
		return nil, fmt.Errorf("资源文件大小校验不一致（期望 %d 字节，实际下载 %d 字节）", resource.Size, written)
	}

	// 3. 原子重命名到最终本地路径
	if err := os.Rename(tmpPath, targetPath); err != nil {
		_ = os.Remove(tmpPath)
		return nil, fmt.Errorf("将资源放置到服务器存储目录失败：%w", err)
	}

	// 4. 更新数据库，将 Provider 改为 local，清空 OSS 特有字段
	oldProvider := resource.Provider
	oldObjectKey := resource.ObjectKey
	resource.Provider = "local"
	resource.Endpoint = ""
	resource.Bucket = ""
	resource.StorageSettingID = ""
	resource.UpdatedAt = time.Now()

	if err := s.repo.SaveResource(resource); err != nil {
		// 数据库更新失败时不删除 OSS，保留双份以防丢失
		return nil, fmt.Errorf("更新资源存储记录失败：%w", err)
	}

	// 5. 本地落盘与数据库均成功后，安全异步或同步清理 OSS 远端文件
	if oldProvider != "local" && oldObjectKey != "" {
		_ = deleteOSSObject(setting, oldObjectKey)
	}

	return resource, nil
}
