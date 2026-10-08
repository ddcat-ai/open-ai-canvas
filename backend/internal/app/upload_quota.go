package app

import (
	"errors"
	"fmt"
	"log"
	"time"

	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"
)

// 上传额度在写文件或 OSS 前原子预留，避免并发请求同时通过日限额检查。
func (s *Service) reserveUserUploadQuota(userID string, size int64) (string, error) {
	policy, err := s.RuntimePolicy()
	if err != nil {
		return "", err
	}
	return s.reserveUserStoredFileQuota(userID, size, megabytes(policy.Resource.ResourceUploadMB), megabytes(policy.Resource.DailyUploadMB), gigabytes(policy.Resource.StoredFileGB), fmt.Sprintf("单个上传文件必须小于 %dMB", policy.Resource.ResourceUploadMB))
}

// 分片和普通上传使用相同的单文件上限。
func (s *Service) reserveChunkedUploadQuota(userID string, size int64) (string, error) {
	return s.reserveUserUploadQuota(userID, size)
}

func (s *Service) ReserveChunkUploadSession(userID, id string, size int64, expires time.Time, maxSessions int) error {
	policy, err := s.RuntimePolicy()
	if err != nil {
		return err
	}
	if size <= 0 || size >= megabytes(policy.Resource.ResourceUploadMB) {
		return BadAuthRequest(fmt.Sprintf("单个上传文件必须小于 %dMB", policy.Resource.ResourceUploadMB))
	}
	if !expires.After(time.Now()) || maxSessions <= 0 {
		return BadAuthRequest("上传会话参数无效")
	}
	err = s.repo.ReserveUploadSession(&model.UploadReservation{ID: id, UserID: userID, Size: size, Day: time.Now().UTC().Format("2006-01-02"), ExpiresAt: expires}, megabytes(policy.Resource.DailyUploadMB), gigabytes(policy.Resource.StoredFileGB), maxSessions)
	return uploadReservationError(err)
}

func (s *Service) ReleaseChunkUploadSession(userID, id string) error {
	return s.repo.ReleaseUploadSession(userID, id)
}

func uploadReservationError(err error) error {
	if errors.Is(err, repository.ErrUploadSessionLimit) {
		return NewAppError(429, err.Error())
	}
	if errors.Is(err, repository.ErrUploadStorageLimit) || errors.Is(err, repository.ErrDailyUploadLimitExceeded) {
		return QuotaExceeded(err.Error())
	}
	if errors.Is(err, repository.ErrUploadReservationExpired) {
		return BadAuthRequest(err.Error())
	}
	return err
}

func (s *Service) saveResourceWithinStorageLimit(resource *model.Resource, reservationID string) error {
	policy, err := s.RuntimePolicy()
	if err != nil {
		return err
	}
	return uploadReservationError(s.repo.SaveResourceWithinStorageLimit(resource, gigabytes(policy.Resource.StoredFileGB), megabytes(policy.Resource.DailyUploadMB), reservationID))
}

func (s *Service) reserveGeneratedResourceQuota(userID string, size int64) (string, error) {
	policy, err := s.RuntimePolicy()
	if err != nil {
		return "", err
	}
	return s.reserveUserStoredFileQuota(userID, size, megabytes(policy.Resource.GeneratedFileMB)+1, megabytes(policy.Resource.DailyUploadMB), gigabytes(policy.Resource.StoredFileGB), fmt.Sprintf("单个生成文件不能超过 %dMB", policy.Resource.GeneratedFileMB))
}

// 失败资源的记录已经计入账号存储用量；重试只重新预留当日上传额度，避免重复计算存储容量。
func (s *Service) reserveRetryUploadQuota(userID string, size int64) (string, error) {
	policy, err := s.RuntimePolicy()
	if err != nil {
		return "", err
	}
	if size <= 0 {
		return "", BadAuthRequest("上传文件不能为空")
	}
	if size >= megabytes(policy.Resource.ResourceUploadMB) {
		return "", BadAuthRequest(fmt.Sprintf("单个上传文件必须小于 %dMB", policy.Resource.ResourceUploadMB))
	}
	day := time.Now().UTC().Format("2006-01-02")
	s.storageMu.Lock()
	defer s.storageMu.Unlock()
	if err := s.repo.ReserveDailyUpload(userID, day, size, megabytes(policy.Resource.DailyUploadMB)); err != nil {
		if errors.Is(err, repository.ErrDailyUploadLimitExceeded) {
			return "", QuotaExceeded(fmt.Sprintf("每个账号 UTC 自然日上传总量必须小于 %s", formatStorageLimit(megabytes(policy.Resource.DailyUploadMB))))
		}
		return "", err
	}
	return day, nil
}

func (s *Service) reserveUserStoredFileQuota(userID string, size int64, exclusiveSingleFileLimit int64, dailyLimit int64, storedLimit int64, singleFileMessage string) (string, error) {
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
	if storedBytes+s.pendingStorage[userID]+size >= storedLimit {
		return "", QuotaExceeded(fmt.Sprintf("账号资源和会话附件已达到 %s 上限，请联系管理员清理历史文件", formatStorageLimit(storedLimit)))
	}
	s.pendingStorage[userID] += size
	if err := s.repo.ReserveDailyUpload(userID, day, size, dailyLimit); err != nil {
		s.decreasePendingStorage(userID, size)
		if errors.Is(err, repository.ErrDailyUploadLimitExceeded) {
			return "", QuotaExceeded(fmt.Sprintf("每个账号 UTC 自然日上传总量必须小于 %s", formatStorageLimit(dailyLimit)))
		}
		return "", err
	}
	return day, nil
}

func formatStorageLimit(value int64) string {
	if value%(1<<30) == 0 {
		return fmt.Sprintf("%dGB", value>>30)
	}
	return fmt.Sprintf("%dMB", value>>20)
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

func (s *Service) releaseRetryUploadQuota(userID string, day string, size int64) {
	if day == "" || size <= 0 {
		return
	}
	s.storageMu.Lock()
	defer s.storageMu.Unlock()
	if err := s.repo.ReleaseDailyUpload(userID, day, size); err != nil {
		log.Printf("release retry upload quota failed: user=%s day=%s size=%d error=%v", userID, day, size, err)
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
