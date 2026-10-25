package app

import (
	"fmt"
	"os"
	"time"

	"yingce/backend/internal/model"
)

// Check known result sizes before consuming a manual recovery attempt. The
// actual write still reserves quota atomically; this check grants no quota.
func (s *Service) checkMediaRecoveryCapacity(task *model.Task, checkpoint *mediaCheckpoint) error {
	var incoming int64
	for index, item := range checkpoint.Items {
		resource, err := s.resourceForUploadKey(task.UserID, mediaUploadKey(task.ID, index))
		if err != nil {
			return err
		}
		if resource != nil && resource.Status == model.ResourceStatusReady {
			continue
		}
		if info, err := os.Lstat(s.mediaTempPath(item.TempName)); err == nil && info.Mode().IsRegular() {
			incoming += info.Size()
		} else {
			incoming++
		}
	}
	if incoming == 0 {
		return nil
	}
	policy, err := s.RuntimePolicy()
	if err != nil {
		return err
	}
	s.storageMu.Lock()
	defer s.storageMu.Unlock()
	stored, err := s.repo.UserStoredFileBytes(task.UserID)
	if err != nil {
		return err
	}
	if stored+s.pendingStorage[task.UserID]+incoming >= gigabytes(policy.Resource.StoredFileGB) {
		return QuotaExceeded(fmt.Sprintf("账号剩余容量不足以保存作品，请先清理资源或联系管理员调整 %s 容量上限", formatStorageLimit(gigabytes(policy.Resource.StoredFileGB))))
	}
	daily, err := s.repo.DailyUploadBytes(task.UserID, time.Now().UTC().Format("2006-01-02"))
	if err != nil {
		return err
	}
	if daily+incoming >= megabytes(policy.Resource.DailyUploadMB) {
		return QuotaExceeded("账号今日上传额度不足，请调整额度或明天重试保存")
	}
	return nil
}
