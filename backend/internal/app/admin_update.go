package app

import (
	"context"
	"net/http"
	"strings"

	"infinite-canvas/backend/internal/hostupdate"
	"infinite-canvas/backend/internal/model"
)

type UpdateManager interface {
	Status(context.Context) (hostupdate.Status, error)
	Check(context.Context) (hostupdate.Status, error)
	Start(context.Context, string) (hostupdate.Status, error)
	Rollback(context.Context, string) (hostupdate.Status, error)
}

func (s *Service) ConfigureUpdateManager(manager UpdateManager) {
	s.updateManager = manager
}

func (s *Service) AdminUpdateStatus(ctx context.Context, actor *model.User) (hostupdate.Status, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return hostupdate.Status{}, err
	}
	if s.updateManager == nil {
		return unsupportedUpdateStatus("当前部署未安装 Host Updater"), nil
	}
	status, err := s.updateManager.Status(ctx)
	if err != nil {
		return unsupportedUpdateStatus("Host Updater 当前不可连接"), nil
	}
	return status, nil
}

func (s *Service) AdminCheckUpdate(ctx context.Context, actor *model.User) (hostupdate.Status, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return hostupdate.Status{}, err
	}
	if s.updateManager == nil {
		return hostupdate.Status{}, NewAppError(http.StatusServiceUnavailable, "当前部署未安装 Host Updater")
	}
	status, err := s.updateManager.Check(ctx)
	if err != nil {
		return status, WrapAppError(http.StatusBadGateway, "检查更新失败，请查看更新器状态和日志", err)
	}
	return status, nil
}

func (s *Service) AdminStartUpdate(ctx context.Context, actor *model.User, targetVersion string) (hostupdate.Status, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return hostupdate.Status{}, err
	}
	if s.updateManager == nil {
		return hostupdate.Status{}, NewAppError(http.StatusServiceUnavailable, "当前部署未安装 Host Updater")
	}
	targetVersion = strings.TrimSpace(targetVersion)
	if targetVersion == "" {
		return hostupdate.Status{}, NewAppError(http.StatusBadRequest, "目标版本不能为空")
	}
	status, err := s.updateManager.Start(ctx, targetVersion)
	if err != nil {
		return status, WrapAppError(http.StatusConflict, "无法开始更新，请刷新状态后重试", err)
	}
	return status, nil
}

func (s *Service) AdminRollbackUpdate(ctx context.Context, actor *model.User, reason string) (hostupdate.Status, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return hostupdate.Status{}, err
	}
	if s.updateManager == nil {
		return hostupdate.Status{}, NewAppError(http.StatusServiceUnavailable, "当前部署未安装 Host Updater")
	}
	if strings.TrimSpace(reason) == "" {
		return hostupdate.Status{}, NewAppError(http.StatusBadRequest, "请填写回退原因")
	}
	status, err := s.updateManager.Rollback(ctx, reason)
	if err != nil {
		return status, WrapAppError(http.StatusConflict, "无法开始回退，请检查备份和当前状态", err)
	}
	return status, nil
}

func unsupportedUpdateStatus(detail string) hostupdate.Status {
	return hostupdate.Status{
		Supported:  false,
		Connected:  false,
		Deployment: "unsupported",
		Checks:     []hostupdate.Check{{Key: "updater", Label: "Host Updater", Status: "failed", Detail: detail, Blocking: true}},
		Operation:  hostupdate.Operation{Phase: hostupdate.PhaseIdle, Logs: []hostupdate.LogEntry{}},
	}
}
