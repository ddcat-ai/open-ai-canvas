package service

import (
	"errors"
	"strings"
	"time"
	"unicode/utf8"

	"infinite-canvas/backend/internal/model"

	"gorm.io/gorm"
)

const (
	AgentRunStatusRunning   = "running"
	AgentRunStatusCompleted = "completed"
	AgentRunStatusFailed    = "failed"

	AgentRunKindCodex  = "codex"
	AgentRunKindClaude = "claude"

	maxAgentRunInputSummary = 500
	maxAgentRunErrorMessage = 500
	maxAgentRunThreadID     = 120
	maxAgentRunAgentKind    = 32
)

type StartAgentRunRequest struct {
	ProjectID    string `json:"projectId"`
	AgentKind    string `json:"agentKind"`
	InputSummary string `json:"inputSummary"`
}

type CompleteAgentRunRequest struct {
	ThreadID string `json:"threadId,omitempty"`
}

type FailAgentRunRequest struct {
	ThreadID     string `json:"threadId,omitempty"`
	ErrorMessage string `json:"errorMessage"`
}

// StartAgentRun 创建一条 running 状态的 AgentRun。
// 必须验证 projectId 属于当前认证用户，防止越权创建。
func (s *Service) StartAgentRun(userID string, req StartAgentRunRequest) (*model.AgentRun, error) {
	if userID == "" {
		return nil, BadAuthRequest("用户未登录")
	}
	projectID := strings.TrimSpace(req.ProjectID)
	if projectID == "" {
		return nil, BadAuthRequest("项目 ID 不能为空")
	}
	// 项目所有权验证：复用现有 ProjectForUser 授权边界
	if _, err := s.repo.ProjectForUser(userID, projectID); err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, BadAuthRequest("项目不存在或无权访问")
		}
		return nil, err
	}
	agentKind := normalizeAgentRunKind(req.AgentKind)
	now := time.Now()
	run := &model.AgentRun{
		ID:           newID(),
		UserID:       userID,
		ProjectID:    projectID,
		AgentKind:    agentKind,
		Status:       AgentRunStatusRunning,
		InputSummary: sanitizeAgentRunText(req.InputSummary, maxAgentRunInputSummary),
		StartedAt:    now,
		CreatedAt:    now,
		UpdatedAt:    now,
	}
	if err := s.repo.CreateAgentRun(run); err != nil {
		return nil, err
	}
	return run, nil
}

// CompleteAgentRun 将 running 状态的 AgentRun 迁移为 completed。
// 使用条件更新（仅影响 status=running 的行），保证终态不会被竞态覆盖。
// 如果 run 已处于终态，返回当前状态（幂等）。
func (s *Service) CompleteAgentRun(userID, runID string, req CompleteAgentRunRequest) (*model.AgentRun, error) {
	now := time.Now()
	affected, err := s.repo.TransitionAgentRunStatus(runID, userID, AgentRunStatusCompleted, &now, "")
	if err != nil {
		return nil, err
	}
	// 重新获取 run 以返回最新状态（无论条件更新是否命中）
	run, err := s.repo.AgentRunForUser(userID, runID)
	if err != nil {
		return nil, err
	}
	if affected > 0 {
		// 只有实际迁移成功时才更新 threadID（避免对已终态的 run 做不必要的写入）
		if threadID := sanitizeAgentRunThreadID(req.ThreadID); threadID != "" && run.ThreadID == "" {
			if err := s.repo.UpdateAgentRunThreadID(runID, userID, threadID); err != nil {
				return nil, err
			}
			run.ThreadID = threadID
		}
	}
	return run, nil
}

// FailAgentRun 将 running 状态的 AgentRun 迁移为 failed。
// 使用条件更新保证终态幂等。completed 状态的 run 不会被 failed 覆盖。
func (s *Service) FailAgentRun(userID, runID string, req FailAgentRunRequest) (*model.AgentRun, error) {
	now := time.Now()
	sanitizedError := sanitizeAgentRunText(req.ErrorMessage, maxAgentRunErrorMessage)
	affected, err := s.repo.TransitionAgentRunStatus(runID, userID, AgentRunStatusFailed, &now, sanitizedError)
	if err != nil {
		return nil, err
	}
	run, err := s.repo.AgentRunForUser(userID, runID)
	if err != nil {
		return nil, err
	}
	if affected > 0 {
		if threadID := sanitizeAgentRunThreadID(req.ThreadID); threadID != "" && run.ThreadID == "" {
			if err := s.repo.UpdateAgentRunThreadID(runID, userID, threadID); err != nil {
				return nil, err
			}
			run.ThreadID = threadID
		}
	}
	return run, nil
}

func (s *Service) GetAgentRun(userID, runID string) (*model.AgentRun, error) {
	return s.repo.AgentRunForUser(userID, runID)
}

func normalizeAgentRunKind(kind string) string {
	kind = strings.TrimSpace(strings.ToLower(kind))
	switch kind {
	case AgentRunKindCodex, AgentRunKindClaude:
		return kind
	default:
		return AgentRunKindCodex
	}
}

func sanitizeAgentRunThreadID(value string) string {
	value = strings.TrimSpace(value)
	if len(value) > maxAgentRunThreadID {
		value = value[:maxAgentRunThreadID]
	}
	return value
}

// sanitizeAgentRunText 截断并清理自由文本，避免持久化超长内容或敏感凭证。
// 不做完整的密钥检测（那是大型通用框架的职责），只做长度截断和基础空白清理。
func sanitizeAgentRunText(value string, maxRunes int) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return ""
	}
	if !utf8.ValidString(value) {
		value = strings.ToValidUTF8(value, "")
	}
	runes := []rune(value)
	if len(runes) > maxRunes {
		runes = runes[:maxRunes]
	}
	return string(runes)
}
