package service

import (
	"errors"
	"log"
	"time"

	"infinite-canvas/backend/internal/repository"
)

const MaxResourceUploadBytes int64 = 50 << 20
const MaxDailyUserUploadBytes int64 = 200 << 20
const MaxUserStoredFileBytes int64 = 2 << 30

// 上传额度在写文件或 OSS 前原子预留，避免并发请求同时通过日限额检查。
func (s *Service) reserveUserUploadQuota(userID string, size int64) (string, error) {
	return s.reserveUserStoredFileQuota(userID, size, MaxResourceUploadBytes, "单个上传文件必须小于 50MB")
}

func (s *Service) reserveGeneratedResourceQuota(userID string, size int64) (string, error) {
	return s.reserveUserStoredFileQuota(userID, size, maxProviderResponseBytes+1, "单个生成文件不能超过 64MB")
}

func (s *Service) reserveUserStoredFileQuota(userID string, size int64, exclusiveSingleFileLimit int64, singleFileMessage string) (string, error) {
	if size <= 0 {
		return "", BadAuthRequest("上传文件不能为空")
	}
	if size >= exclusiveSingleFileLimit {
		return "", BadAuthRequest(singleFileMessage)
	}
	day := time.Now().UTC().Format("2006-01-02")
	s.storageMu.Lock()
	defer s.storageMu.Unlock()
	storedBytes, err := s.repo.UserStoredFileBytes(userID)
	if err != nil {
		return "", err
	}
	if s.pendingStorage == nil {
		s.pendingStorage = map[string]int64{}
	}
	if storedBytes+s.pendingStorage[userID]+size >= MaxUserStoredFileBytes {
		return "", BadAuthRequest("账号资源和会话附件已达到 2GB 上限，请联系管理员清理历史文件")
	}
	s.pendingStorage[userID] += size
	if err := s.repo.ReserveDailyUpload(userID, day, size, MaxDailyUserUploadBytes); err != nil {
		s.decreasePendingStorage(userID, size)
		if errors.Is(err, repository.ErrDailyUploadLimitExceeded) {
			return "", BadAuthRequest("每个账号 UTC 自然日上传总量必须小于 200MB")
		}
		return "", err
	}
	return day, nil
}

func (s *Service) releaseUserUploadQuota(userID string, day string, size int64) {
	if day == "" || size <= 0 {
		return
	}
	s.storageMu.Lock()
	defer s.storageMu.Unlock()
	s.decreasePendingStorage(userID, size)
	if err := s.repo.ReleaseDailyUpload(userID, day, size); err != nil {
		log.Printf("release upload quota failed: user=%s day=%s size=%d error=%v", userID, day, size, err)
	}
}

func (s *Service) commitUserUploadQuota(userID string, size int64) {
	if size <= 0 {
		return
	}
	s.storageMu.Lock()
	defer s.storageMu.Unlock()
	s.decreasePendingStorage(userID, size)
}

func (s *Service) decreasePendingStorage(userID string, size int64) {
	remaining := s.pendingStorage[userID] - size
	if remaining > 0 {
		s.pendingStorage[userID] = remaining
		return
	}
	delete(s.pendingStorage, userID)
}
