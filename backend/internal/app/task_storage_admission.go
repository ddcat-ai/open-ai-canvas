package app

import (
	"fmt"
	"strings"
	"time"
)

// 产出媒体文件的任务类型：这些任务成功后必须把结果回存为资源文件。
// 文本任务只增长任务历史数据，不占用账号文件容量。
func taskTypeProducesStoredFile(taskType string) bool {
	switch taskType {
	case "canvas_image", "canvas_video", "canvas_audio":
		return true
	}
	return strings.HasPrefix(taskType, "video_")
}

// requireStoredFileCapacityForTask 是生成任务 admission 阶段的账号文件容量校验。
//
// 账号文件容量此前只在产物回存时校验，上游调用已经发出并扣费，失败只能表现为
// 媒体无法入库。生成任务必须在扣费前确认账号还有可用容量，容量已满时直接拒绝。
func (s *Service) requireStoredFileCapacityForTask(userID string, taskType string, policy RuntimePolicySetting) error {
	s.storageMu.Lock()
	defer s.storageMu.Unlock()
	return s.requireStoredFileCapacityWhileLocked(userID, taskType, policy)
}

// requireStoredFileCapacityWhileLocked 与上面相同，但调用方必须已经持有 storageMu。
// sync.Mutex 不可重入；审批改参数的干跑 admission 发生在 DecideCloudAgentApproval
// 的临界区内，再次加锁会把测试和线上审批一起卡死。
func (s *Service) requireStoredFileCapacityWhileLocked(userID string, taskType string, policy RuntimePolicySetting) error {
	if !taskTypeProducesStoredFile(taskType) {
		return nil
	}
	storedLimit, err := s.storedFileLimit(userID, policy)
	if err != nil {
		return err
	}
	if storedLimit <= 0 {
		return nil
	}
	storedBytes, err := s.repo.UserStoredFileBytes(userID)
	if err != nil {
		return err
	}
	if err := validateStoredFileCapacity(storedBytes, s.pendingStorage[userID], storedLimit); err != nil {
		return err
	}

	usage, err := s.repo.UserStorageUsage(userID)
	if err != nil {
		return err
	}
	if err := validateStructuredStorageQuotaWithPolicy(usage, "asset", true, 0, policy.Resource); err != nil {
		return err
	}

	day := time.Now().UTC().Format("2006-01-02")
	dailyBytes, err := s.repo.DailyUploadBytes(userID, day)
	if err != nil {
		return err
	}
	dailyLimit := megabytes(policy.Resource.DailyUploadMB)
	generatedFileBytes := megabytes(policy.Resource.GeneratedFileMB)
	if dailyLimit-dailyBytes <= generatedFileBytes {
		return QuotaExceeded(fmt.Sprintf("每个账号 UTC 自然日上传额度不足以容纳一个最大生成文件（%dMB）", policy.Resource.GeneratedFileMB))
	}
	return nil
}

func validateStoredFileCapacity(storedBytes int64, pendingBytes int64, storedLimit int64) error {
	if storedLimit > 0 && storedBytes+pendingBytes >= storedLimit {
		return StorageCapacityExceeded(fmt.Sprintf("账号文件容量已达到 %s 上限，请清理素材或购买存储空间后再生成", formatStorageLimit(storedLimit)))
	}
	return nil
}
