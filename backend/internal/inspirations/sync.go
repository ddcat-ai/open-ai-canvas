package inspirations

import (
	"context"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/url"
	"time"

	"yingce/backend/internal/kernel"
	"yingce/backend/internal/model"
	"yingce/backend/internal/outbound"
)

// StartSyncWorker 启动定时同步：启动后稍等片刻再检查，之后每 10 分钟看一次是否到期。
// 是否到期按数据库里的上次同步时间判断，重启或多实例部署都不会重复同步。
func (s *Service) StartSyncWorker() {
	s.runWorkerLoop(func(ctx context.Context) {
		timer := time.NewTimer(startupDelay)
		defer timer.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-timer.C:
			}
			s.syncIfDue(ctx)
			timer.Reset(checkInterval)
		}
	})
}

func (s *Service) syncIfDue(ctx context.Context) {
	settings, err := s.settings()
	if err != nil {
		slog.Warn("inspiration feed settings load failed", "error", err)
		return
	}
	if !settings.Enabled {
		return
	}
	state, err := s.readState()
	if err != nil {
		slog.Warn("inspiration feed state load failed", "error", err)
		return
	}
	if next := nextSyncAt(state); next != nil && s.now().Before(*next) {
		return
	}
	syncCtx, cancel := context.WithTimeout(ctx, syncTimeout)
	defer cancel()
	if _, _, err := s.sync(syncCtx, TriggerSchedule, ""); err != nil && ctx.Err() == nil {
		slog.Warn("inspiration feed sync failed", "error", err)
	}
}

// SyncNow 由管理员立即同步一次，结束后返回最新状态。
// 同步与请求解绑：管理员关掉页面不会打断，已拉到的数据照常落库。
func (s *Service) SyncNow(ctx context.Context, actor *model.User) (*AdminStatus, error) {
	if err := s.admin.RequireAdmin(actor); err != nil {
		return nil, err
	}
	settings, err := s.settings()
	if err != nil {
		return nil, err
	}
	if !settings.Enabled {
		return nil, kernel.NewAppError(http.StatusConflict, "灵感上新已关闭，开启后再同步")
	}
	syncCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), syncTimeout)
	defer cancel()
	state, acquired, err := s.sync(syncCtx, TriggerManual, actor.ID)
	if err != nil {
		return nil, err
	}
	if !acquired {
		return nil, kernel.NewAppError(http.StatusConflict, "灵感上新正在同步，请稍后刷新查看结果")
	}
	created, updated := state.totals()
	if err := s.admin.AppendAudit(actor, "inspiration_feed.sync", "system_setting", stateKey, "手动同步灵感上新", map[string]any{"created": created, "updated": updated, "error": state.LastError}); err != nil {
		return nil, err
	}
	if state.allFailed() {
		return nil, kernel.NewAppError(http.StatusBadGateway, "灵感上新同步失败。"+state.LastError)
	}
	return s.status()
}

// sync 拉取全部来源并落库；拿不到锁时 acquired 为 false，表示已有同步在进行。
// 单个来源失败只记进结果，其余来源照常同步。被取消（服务停止）时不写同步记录，重启后会重新同步。
func (s *Service) sync(ctx context.Context, trigger string, actorID string) (*SyncState, bool, error) {
	release, acquired, err := s.lock(ctx, lockKey, lockTTL)
	if err != nil {
		return nil, false, fmt.Errorf("获取灵感上新同步锁：%w", err)
	}
	if !acquired {
		return nil, false, nil
	}
	defer release()

	previous, err := s.readState()
	if err != nil {
		return nil, true, err
	}
	startedAt := s.now()
	state := &SyncState{
		LastAttemptAt: &startedAt,
		LastSuccessAt: previous.LastSuccessAt,
		Trigger:       trigger,
		Sources:       make([]SourceResult, 0, len(s.sources)),
		Categories:    map[string]map[string]string{},
	}
	for id, labels := range previous.Categories {
		state.Categories[id] = labels
	}
	for _, src := range s.sources {
		result, labels, err := s.syncSource(ctx, src, startedAt)
		if err != nil {
			result.Error = clipText(err.Error(), 300)
			if state.LastError == "" {
				state.LastError = src.name + "：" + result.Error
			}
			if ctx.Err() == nil {
				slog.Warn("inspiration feed source sync failed", "source", src.id, "error", err)
			}
		} else if len(labels) > 0 {
			state.Categories[src.id] = labels
		}
		state.Sources = append(state.Sources, result)
	}
	if errors.Is(ctx.Err(), context.Canceled) {
		return state, true, ctx.Err()
	}
	if !state.allFailed() {
		state.LastSuccessAt = &startedAt
	}
	if err := s.saveSetting(stateKey, state, actorID); err != nil {
		return state, true, fmt.Errorf("保存灵感上新同步记录：%w", err)
	}
	s.invalidateFeed()
	if created, updated := state.totals(); created > 0 || updated > 0 {
		slog.Info("inspiration feed synced", "trigger", trigger, "created", created, "updated", updated)
	}
	return state, true, nil
}

func (s *Service) syncSource(ctx context.Context, src source, seenAt time.Time) (SourceResult, map[string]string, error) {
	result := SourceResult{SourceID: src.id}
	parsed, err := src.load(ctx, s.fetch)
	if err != nil {
		return result, nil, err
	}
	result.Upstream = parsed.upstream
	result.Accepted = len(parsed.entries)
	ids := make([]string, len(parsed.entries))
	for index := range parsed.entries {
		ids[index] = parsed.entries[index].ID
	}
	hashes, err := s.repo.InspirationFeedContentHashes(ids)
	if err != nil {
		return result, nil, fmt.Errorf("读取已收录条目：%w", err)
	}
	var created, updated []model.InspirationFeedEntry
	for _, entry := range parsed.entries {
		hash, found := hashes[entry.ID]
		switch {
		case !found:
			entry.FirstSeenAt = seenAt
			created = append(created, entry)
		case hash != entry.ContentHash:
			entry.UpdatedAt = seenAt
			updated = append(updated, entry)
		}
	}
	if err := s.repo.SaveInspirationFeedEntries(created, updated); err != nil {
		return result, nil, fmt.Errorf("保存条目：%w", err)
	}
	result.Created, result.Updated = len(created), len(updated)
	return result, parsed.categories, nil
}

// fetch 经出站客户端下载上游文件；超过 maxBytes 视为异常，不截断使用。
func (s *Service) fetch(ctx context.Context, rawURL string, maxBytes int64) ([]byte, error) {
	parsed, err := outbound.ValidateOutboundURL(rawURL)
	if err != nil {
		// 部分网络会把 GitHub 域名解析成 0.0.0.0 或内网地址，出站校验会拒绝，这里说明该查什么。
		host := rawURL
		if target, parseErr := url.Parse(rawURL); parseErr == nil {
			host = target.Host
		}
		return nil, fmt.Errorf("无法访问 %s（%v），请检查服务器 DNS 能否正常解析 GitHub", host, err)
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, parsed.String(), nil)
	if err != nil {
		return nil, err
	}
	outbound.ApplyDefaultOutboundHeaders(request)
	response, err := s.client.Do(request)
	if err != nil {
		if ctx.Err() != nil {
			return nil, ctx.Err()
		}
		var urlErr *url.Error
		if errors.As(err, &urlErr) {
			err = urlErr.Err
		}
		return nil, fmt.Errorf("连接 %s 失败（%v），请确认服务器能访问 GitHub，必要时配置 HTTPS_PROXY", parsed.Host, err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("%s 返回 %s", parsed.Host, response.Status)
	}
	data, err := io.ReadAll(io.LimitReader(response.Body, maxBytes+1))
	if err != nil {
		if ctx.Err() != nil {
			return nil, ctx.Err()
		}
		return nil, fmt.Errorf("读取 %s 的响应失败：%w", parsed.Host, err)
	}
	if int64(len(data)) > maxBytes {
		return nil, fmt.Errorf("%s 返回的文件超过 %d MB", parsed.Host, maxBytes>>20)
	}
	return data, nil
}
