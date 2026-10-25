package app

import (
	"encoding/json"
	"errors"
	"os"

	"gorm.io/gorm"

	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"
)

type AdminTaskMediaInspection struct {
	TaskID        string `json:"taskId"`
	StagedFiles   int    `json:"stagedFiles"`
	StagedBytes   int64  `json:"stagedBytes"`
	ReadyItems    int    `json:"readyItems"`
	RemoteItems   int    `json:"remoteItems"`
	MissingItems  int    `json:"missingItems"`
	CapacityError string `json:"capacityError,omitempty"`
}

func (s *Service) AdminInspectTaskMedia(actor *model.User, userID, taskID string) (*AdminTaskMediaInspection, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return nil, err
	}
	task, err := s.repo.TaskForUser(userID, taskID)
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, NotFound("任务不存在")
	}
	if err != nil {
		return nil, err
	}
	checkpoint, err := s.decodeMediaCheckpoint(task)
	if err != nil {
		return nil, BadAuthRequest("任务没有可检查的作品恢复记录")
	}
	view := &AdminTaskMediaInspection{TaskID: task.ID}
	for index, item := range checkpoint.Items {
		resource, err := s.resourceForUploadKey(userID, mediaUploadKey(task.ID, index))
		if err != nil {
			return nil, err
		}
		if resource != nil && resource.Status == model.ResourceStatusReady {
			view.ReadyItems++
			continue
		}
		if info, err := os.Lstat(s.mediaTempPath(item.TempName)); err == nil && info.Mode().IsRegular() {
			view.StagedFiles++
			view.StagedBytes += info.Size()
		} else if item.Reference.URL != "" {
			view.RemoteItems++
		} else {
			view.MissingItems++
		}
	}
	if err := s.checkMediaRecoveryCapacity(task, checkpoint); err != nil {
		var appErr *AppError
		if !errors.As(err, &appErr) || appErr.Reason != ReasonQuotaExceeded {
			return nil, err
		}
		view.CapacityError = appErr.Message
	}
	return view, nil
}

// A short maintenance lease excludes manual requeue and other administrators
// while files are removed. No running task's staging may be discarded.
func (s *Service) AdminDiscardTaskMedia(actor *model.User, userID, taskID string) (*AdminTaskMediaInspection, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return nil, err
	}
	task, err := s.repo.TaskForUser(userID, taskID)
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, NotFound("任务不存在")
	}
	if err != nil {
		return nil, err
	}
	checkpoint, err := s.decodeMediaCheckpoint(task)
	if err != nil {
		return nil, BadAuthRequest("任务没有可清理的暂存作品")
	}
	owner := "media-cleanup:" + newID()
	audit, err := newAdminAuditEvent(actor, "task.media_staging_discard", "task", task.ID, "管理员手动清理失败作品暂存", map[string]any{"userId": userID})
	if err != nil {
		return nil, err
	}
	if err := s.repo.LockFailedTaskMedia(task, owner, audit); err != nil {
		if errors.Is(err, repository.ErrTaskStateConflict) {
			return nil, BadAuthRequest("任务正在执行、恢复或已变化，请刷新后重试")
		}
		return nil, err
	}
	defer func() {
		if err := s.repo.UnlockFailedTaskMedia(task.ID, owner); err != nil {
			_ = s.log(userID, taskID, "error", "释放作品暂存清理租约失败，等待租约到期", "")
		}
	}()
	var deleteErrors []error
	for index := range checkpoint.Items {
		item := &checkpoint.Items[index]
		path := s.mediaTempPath(item.TempName)
		if path == "" {
			continue
		}
		if err := os.Remove(path); err != nil && !os.IsNotExist(err) {
			deleteErrors = append(deleteErrors, errors.New("部分暂存文件清理失败，未释放的文件仍可重试清理"))
			continue
		}
		item.TempName = ""
	}
	data, err := json.Marshal(checkpoint)
	if err != nil {
		return nil, err
	}
	encrypted, err := s.encryptSettingSecret(string(data))
	if err != nil {
		return nil, err
	}
	if err := s.repo.UpdateDiscardedTaskMedia(task.ID, owner, encrypted); err != nil {
		return nil, err
	}
	if len(deleteErrors) > 0 {
		return nil, errors.Join(deleteErrors...)
	}
	return s.AdminInspectTaskMedia(actor, userID, taskID)
}
