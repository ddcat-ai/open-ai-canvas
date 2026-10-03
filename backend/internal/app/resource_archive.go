package app

import (
	"archive/zip"
	"context"
	"fmt"
	"io"
	"os"
	"strings"

	"infinite-canvas/backend/internal/model"
)

type ImageResourceArchiveItem struct {
	ResourceID string `json:"resourceId"`
	Name       string `json:"name"`
}

// An archive is a temporary export, separate from ordinary origin/CDN delivery.
// Assemble owned originals on disk so browser CORS cannot break the ZIP, and
// return it only after every file succeeds. The caller closes and removes it.
func (s *Service) CreateImageResourceArchive(ctx context.Context, userID string, items []ImageResourceArchiveItem) (*os.File, error) {
	if len(items) == 0 || len(items) > 100 {
		return nil, BadAuthRequest("请选择 1 至 100 张图片")
	}
	resources := make([]*model.Resource, len(items))
	names := make([]string, len(items))
	seen := map[string]bool{}
	var total int64
	for i, item := range items {
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		name := strings.TrimSpace(item.Name)
		if name == "" || len(name) > 128 || strings.ContainsAny(name, "/\\:*?\"<>|") || strings.HasPrefix(name, ".") || strings.ContainsFunc(name, func(r rune) bool { return r < 32 }) {
			return nil, BadAuthRequest("图片文件名无效")
		}
		resource, err := s.repo.ResourceForUser(userID, item.ResourceID)
		if err != nil {
			return nil, err
		}
		extension := map[string]string{"image/png": ".png", "image/jpeg": ".jpg", "image/webp": ".webp", "image/gif": ".gif", "image/avif": ".avif"}[strings.ToLower(strings.SplitN(resource.MimeType, ";", 2)[0])]
		if resource.Kind != "image" || resource.Status != model.ResourceStatusReady || extension == "" || resource.Size <= 0 {
			return nil, BadAuthRequest("资源不是可下载的图片")
		}
		total += resource.Size
		if total > 256<<20 {
			return nil, BadAuthRequest("图片总大小超过 256 MB，请分批下载")
		}
		names[i] = name + extension
		if seen[names[i]] {
			return nil, BadAuthRequest("图片文件名重复")
		}
		seen[names[i]], resources[i] = true, resource
	}
	file, err := os.CreateTemp("", "canvas-image-archive-*.zip")
	if err != nil {
		return nil, err
	}
	complete := false
	defer func() {
		if !complete {
			file.Close()
			os.Remove(file.Name())
		}
	}()
	archive := zip.NewWriter(file)
	for i, resource := range resources {
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		_, body, err := s.OpenResource(userID, resource.ID)
		if err != nil {
			return nil, err
		}
		entry, err := archive.CreateHeader(&zip.FileHeader{Name: names[i], Method: zip.Store})
		if err != nil {
			body.Close()
			return nil, err
		}
		copied, copyErr := io.Copy(entry, io.LimitReader(body, resource.Size+1))
		body.Close()
		if copyErr != nil {
			return nil, copyErr
		}
		if copied != resource.Size {
			return nil, fmt.Errorf("图片 %s 下载不完整，请重试", names[i])
		}
	}
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	if err := archive.Close(); err != nil {
		return nil, err
	}
	if _, err := file.Seek(0, io.SeekStart); err != nil {
		return nil, err
	}
	complete = true
	return file, nil
}
