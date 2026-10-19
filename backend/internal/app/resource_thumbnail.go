package app

import (
	"bytes"
	"errors"
	"image"
	"strings"
	"time"

	"gorm.io/gorm"
	"yingce/backend/internal/assets"
	"yingce/backend/internal/model"
)

const maxBrowserThumbnailBytes = 1 << 20

func (s *Service) SaveBrowserResourceThumbnail(userID, id string, data []byte) (*model.Resource, error) {
	if strings.TrimSpace(userID) == "" {
		return nil, Unauthorized("请先登录")
	}
	resource, err := s.repo.ResourceForUser(userID, id)
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, NotFound("原图不存在或不可访问")
	}
	if err != nil {
		return nil, err
	}
	if resource.Status != model.ResourceStatusReady || resource.TransferPending || resource.Kind != "image" {
		return nil, BadAuthRequest("原图尚未就绪")
	}
	if resource.ThumbnailStatus == "ready" {
		return resource, nil
	}
	if len(data) == 0 || len(data) > maxBrowserThumbnailBytes {
		return nil, BadAuthRequest("缩略图必须小于 1MB")
	}
	mimeType, err := detectUploadedMimeType(bytes.NewReader(data))
	if err != nil {
		return nil, err
	}
	if mimeType != "image/png" && mimeType != "image/jpeg" {
		return nil, BadAuthRequest("缩略图只支持 PNG 或 JPEG")
	}
	config, _, err := image.DecodeConfig(bytes.NewReader(data))
	if err != nil || config.Width <= 0 || config.Height <= 0 || config.Width > 512 || config.Height > 512 {
		return nil, BadAuthRequest("缩略图尺寸须在 512 × 512 以内")
	}
	// A failed direct attempt may already have reserved these exact thumbnail bytes.
	reservationID := thumbnailUploadID(id, BrowserResourceUploadInput{Size: int64(len(data)), MimeType: mimeType, Width: config.Width, Height: config.Height})
	if err := s.ReleaseChunkUploadSession(userID, reservationID); err != nil {
		return nil, err
	}
	day, err := s.reserveUserUploadQuota(userID, int64(len(data)))
	if err != nil {
		return nil, err
	}
	saved := false
	defer func() {
		if saved {
			s.commitUserUploadQuota(userID, int64(len(data)))
		} else {
			s.releaseUserUploadQuota(userID, day, int64(len(data)))
		}
	}()
	thumbnail := *resource
	if updated, err := s.repo.BeginResourceThumbnailUpload(userID, id); err != nil {
		return nil, err
	} else if !updated {
		return nil, NotFound("原图已清理，无法保存缩略图")
	}
	thumbnail.ObjectKey, thumbnail.MimeType, thumbnail.Size = assets.ThumbnailObjectKey(resource.ObjectKey), mimeType, int64(len(data))
	if _, err := s.storeResourceObject(&thumbnail, "thumbnail", bytes.NewReader(data)); err != nil {
		return nil, err
	}
	updated, err := s.repo.UpdateResourceThumbnail(userID, id, map[string]any{
		"thumbnail_status": "ready", "thumbnail_mime_type": mimeType, "thumbnail_size": len(data),
		"thumbnail_width": config.Width, "thumbnail_height": config.Height, "updated_at": time.Now(),
	})
	if err != nil || !updated {
		if cleanupErr := s.deleteResourceObjectAtKey(userID, &thumbnail); cleanupErr != nil {
			return nil, cleanupErr
		}
		if err != nil {
			return nil, err
		}
		return nil, NotFound("原图已删除，未保存缩略图")
	}
	saved = true
	resource.ThumbnailStatus, resource.ThumbnailMimeType, resource.ThumbnailSize = "ready", mimeType, int64(len(data))
	resource.ThumbnailWidth, resource.ThumbnailHeight = config.Width, config.Height
	return resource, nil
}
