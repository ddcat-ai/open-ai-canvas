package app

import (
	"errors"
	"io/fs"
	"log/slog"
	"os"
	"path/filepath"
	"strings"
	"time"

	"yingce/backend/internal/model"
)

const (
	dramaTailStageTTL    = 15 * time.Minute
	dramaTailStagePrefix = "tail-"
	dramaTailClaimPrefix = "tail-active-"
)

func removeStagingFile(path string) error {
	err := os.Remove(path)
	if errors.Is(err, fs.ErrNotExist) {
		return nil
	}
	return err
}

func (s *Service) dramaTailStagePath(resourceID string) string {
	return filepath.Join(s.dataDir, "media-staging", dramaTailStagePrefix+safeObjectSegment(resourceID))
}

func (s *Service) retainDramaTailFile(task *model.Task, resource *model.Resource, path string) bool {
	eligible, err := s.repo.IsDramaSegmentVideoTask(task.ID)
	if err != nil {
		_ = s.log(task.UserID, task.ID, "warn", "识别短剧视频暂存失败", "")
		return false
	}
	if !eligible || resource.UserID != task.UserID || resource.Size <= 0 {
		return false
	}
	mediaStagingMu.Lock()
	defer mediaStagingMu.Unlock()
	info, err := os.Lstat(path)
	if err != nil || !info.Mode().IsRegular() || info.Size() != resource.Size {
		return false
	}
	now := time.Now()
	if err = os.Chtimes(path, now, now); err == nil {
		err = os.Rename(path, s.dramaTailStagePath(resource.ID))
	}
	if err != nil {
		_ = s.log(task.UserID, task.ID, "warn", "保留尾帧处理暂存失败", "")
		return false
	}
	return true
}

func (s *Service) claimDramaTailFile(resource *model.Resource) string {
	mediaStagingMu.Lock()
	defer mediaStagingMu.Unlock()
	path := s.dramaTailStagePath(resource.ID)
	info, err := os.Lstat(path)
	now := time.Now()
	if err != nil || !info.Mode().IsRegular() || info.Size() != resource.Size || now.Sub(info.ModTime()) >= dramaTailStageTTL {
		return ""
	}
	// 移给当前工作线程独占，暂存空间回收只会优先清理尚未使用的副本。
	active := filepath.Join(filepath.Dir(path), dramaTailClaimPrefix+newID())
	if err := os.Rename(path, active); err != nil {
		return ""
	}
	if err := os.Chtimes(active, now, now); err != nil {
		s.releaseDramaTailFile(active)
		return ""
	}
	return active
}

func (s *Service) releaseDramaTailFile(path string) {
	if err := removeStagingFile(path); err != nil {
		slog.Warn("drama tail staging cleanup failed", "error", err)
	}
}

func (s *Service) cleanupDramaTailFiles(now time.Time) {
	mediaStagingMu.Lock()
	defer mediaStagingMu.Unlock()
	dir := filepath.Join(s.dataDir, "media-staging")
	files, err := os.ReadDir(dir)
	if err != nil {
		if !errors.Is(err, fs.ErrNotExist) {
			slog.Warn("drama tail staging scan failed", "error", err)
		}
		return
	}
	for _, file := range files {
		if !strings.HasPrefix(file.Name(), dramaTailStagePrefix) || !file.Type().IsRegular() {
			continue
		}
		info, err := file.Info()
		if err == nil && now.Sub(info.ModTime()) >= dramaTailStageTTL {
			s.releaseDramaTailFile(filepath.Join(dir, file.Name()))
		}
	}
}
