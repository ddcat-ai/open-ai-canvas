package app

import (
	"archive/zip"
	"context"
	"fmt"
	"io"
	"path/filepath"
	"strings"

	"yingce/backend/internal/model"
)

// Validate every resource before response headers. Bytes use the existing
// authenticated storage reader and flow directly into the ZIP, without buffering
// all full-resolution pictures or waiting for browser-side image conversion.
func (s *Service) EcommerceDownloadResources(userID string, ids []string) ([]model.Resource, error) {
	if len(ids) == 0 || len(ids) > 500 {
		return nil, BadAuthRequest("请选择1到500张图片")
	}
	files := make([]model.Resource, 0, len(ids))
	seen := map[string]bool{}
	var size int64
	for _, id := range ids {
		if seen[id] {
			return nil, BadAuthRequest("下载图片不能重复")
		}
		seen[id] = true
		resource, err := s.repo.ResourceForUser(userID, id)
		if err != nil || resource.Kind != "image" || resource.Status != model.ResourceStatusReady {
			return nil, NotFound("下载图片不存在或不可用")
		}
		size += resource.Size
		if size > 2<<30 {
			return nil, BadAuthRequest("本次下载超过2GB，请分批选择图片")
		}
		files = append(files, *resource)
	}
	return files, nil
}

func (s *Service) WriteEcommerceDownload(ctx context.Context, userID string, files []model.Resource, out io.Writer) error {
	archive := zip.NewWriter(out)
	for index, file := range files {
		if err := ctx.Err(); err != nil {
			return err
		}
		ext := strings.ToLower(filepath.Ext(file.ObjectKey))
		switch file.MimeType {
		case "image/png":
			ext = ".png"
		case "image/jpeg":
			ext = ".jpg"
		case "image/webp":
			ext = ".webp"
		}
		if len(ext) > 8 || strings.ContainsAny(ext, "/\\") || ext == "" {
			ext = ".png"
		}
		entry, err := archive.CreateHeader(&zip.FileHeader{Name: fmt.Sprintf("%02d%s", index+1, ext), Method: zip.Store})
		if err != nil {
			return err
		}
		_, body, err := s.OpenResource(userID, file.ID)
		if err != nil {
			return err
		}
		_, copyErr := io.Copy(entry, body)
		closeErr := body.Close()
		if copyErr != nil {
			return copyErr
		}
		if closeErr != nil {
			return closeErr
		}
		if err := archive.Flush(); err != nil {
			return err
		}
	}
	return archive.Close()
}
