package app

import (
	"fmt"
	"io"
	"os"
	"path/filepath"

	"infinite-canvas/backend/internal/model"
)

// A personal copy gives collaborators ordinary resource management without
// changing or deleting the owner's shared object. Retries reuse the copy.
func (s *Service) CopyReadableResource(userID, id string) (*model.Resource, error) {
	resource, err := s.canvasDomain().ResourceForReader(userID, id)
	if err != nil {
		return nil, err
	}
	if resource.UserID == userID {
		return resource, nil
	}
	key := "shared-copy:" + id
	if existing, err := s.resourceForUploadKey(userID, &key); err != nil {
		return nil, err
	} else if existing != nil && existing.Status == model.ResourceStatusReady {
		return existing, nil
	}
	policy, err := s.RuntimePolicy()
	if err != nil {
		return nil, err
	}
	if resource.Size <= 0 || resource.Size > megabytes(policy.Resource.ResourceUploadMB) {
		return nil, BadAuthRequest("共享媒体超过单文件保存上限")
	}
	stream, err := s.openResourceRange(resource.UserID, resource, "")
	if err != nil {
		return nil, err
	}
	defer stream.Body.Close()
	file, err := os.CreateTemp(s.dataDir, "canvas-media-copy-*")
	if err != nil {
		return nil, err
	}
	defer os.Remove(file.Name())
	defer file.Close()
	written, err := io.Copy(file, io.LimitReader(stream.Body, resource.Size+1))
	if err != nil {
		return nil, err
	}
	if written != resource.Size {
		return nil, fmt.Errorf("共享资源大小发生变化，请重试")
	}
	if _, err := file.Seek(0, io.SeekStart); err != nil {
		return nil, err
	}
	return s.UploadResourceFile(userID, filepath.Base(resource.ObjectKey), resource.Size, resource.Kind, resource.Width, resource.Height, resource.DurationMs, file, key)
}
