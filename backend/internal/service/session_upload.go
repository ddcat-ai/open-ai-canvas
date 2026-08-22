package service

import (
	"fmt"
	"io"
	"mime/multipart"
	"os"
	"path/filepath"
	"strings"

	"infinite-canvas/backend/internal/model"
)

// sessionUploadCoordinator 只负责会话附件的文件落盘和资源额度生命周期。
//
// 会话创建、任务排队和素材/OSS 资源上传是不同的写路径。把附件写入从 Service
// 主流程移出后，文件系统失败、会话归属校验和额度回滚不再和任务 worker 共用一段
// 巨型方法，也便于用内存仓储覆盖失败分支。
type sessionUploadCoordinator struct {
	repo          sessionUploadRepository
	dataDir       string
	runtimePolicy func() (RuntimePolicySetting, error)
	reserveQuota  func(userID string, size int64) (string, error)
	releaseQuota  func(userID string, day string, size int64)
	commitQuota   func(userID string, size int64)
}

type sessionUploadRepository interface {
	SessionForUser(userID string, id string) (*model.Session, error)
	Create(value any) error
}

func newSessionUploadCoordinator(s *Service) *sessionUploadCoordinator {
	return &sessionUploadCoordinator{
		repo:          s.repo,
		dataDir:       s.dataDir,
		runtimePolicy: s.RuntimePolicy,
		reserveQuota:  s.reserveSessionUploadQuota,
		releaseQuota:  s.releaseUserUploadQuota,
		commitQuota:   s.commitUserUploadQuota,
	}
}

func (s *Service) sessionUpload() *sessionUploadCoordinator {
	if s.sessionUploadCoordinator != nil {
		return s.sessionUploadCoordinator
	}
	// 部分单元测试直接构造 Service 字面量；延迟创建保持这些测试和内部工具兼容。
	return newSessionUploadCoordinator(s)
}

func (s *Service) StoreUpload(userID string, sessionID string, header *multipart.FileHeader) (*model.SessionFile, error) {
	return s.sessionUpload().Store(userID, sessionID, header)
}

func (c *sessionUploadCoordinator) Store(userID string, sessionID string, header *multipart.FileHeader) (*model.SessionFile, error) {
	policy, err := c.runtimePolicy()
	if err != nil {
		return nil, err
	}
	maxBytes := megabytes(policy.Resource.SessionUploadMB)
	if header == nil || header.Size > maxBytes {
		return nil, BadAuthRequest(fmt.Sprintf("会话文件不能超过 %dMB", policy.Resource.SessionUploadMB))
	}
	day, err := c.reserveQuota(userID, header.Size)
	if err != nil {
		return nil, err
	}
	reserved := true
	defer func() {
		if reserved {
			c.releaseQuota(userID, day, header.Size)
		}
	}()

	file, err := header.Open()
	if err != nil {
		return nil, err
	}
	defer file.Close()

	uploadDir := filepath.Join(c.dataDir, "uploads")
	if err := os.MkdirAll(uploadDir, 0o750); err != nil {
		return nil, err
	}
	if strings.TrimSpace(sessionID) != "" {
		if _, err := c.repo.SessionForUser(userID, sessionID); err != nil {
			return nil, err
		}
	}

	storedName := newID() + "-" + filepath.Base(header.Filename)
	path := filepath.Join(uploadDir, storedName)
	dst, err := os.OpenFile(path, os.O_CREATE|os.O_WRONLY|os.O_EXCL, 0o640)
	if err != nil {
		return nil, err
	}
	size, err := io.Copy(dst, io.LimitReader(file, maxBytes+1))
	closeErr := dst.Close()
	if err != nil {
		_ = os.Remove(path)
		return nil, err
	}
	if closeErr != nil {
		_ = os.Remove(path)
		return nil, closeErr
	}
	if size > maxBytes {
		_ = os.Remove(path)
		return nil, BadAuthRequest(fmt.Sprintf("会话文件不能超过 %dMB", policy.Resource.SessionUploadMB))
	}

	item := model.SessionFile{
		ID:        newID(),
		UserID:    userID,
		SessionID: sessionID,
		FileName:  header.Filename,
		MimeType:  header.Header.Get("Content-Type"),
		Path:      path,
		Size:      size,
	}
	if err := c.repo.Create(&item); err != nil {
		_ = os.Remove(path)
		return nil, err
	}
	c.commitQuota(userID, header.Size)
	reserved = false
	return &item, nil
}
