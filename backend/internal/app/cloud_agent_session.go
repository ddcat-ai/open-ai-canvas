package app

import (
	"encoding/json"
	"errors"
	"strings"
	"time"
	"unicode/utf8"

	"gorm.io/gorm"
	"infinite-canvas/backend/internal/kernel"
	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/repository"
)

const (
	cloudAgentDefaultSurface = "canvas"
	cloudAgentSessionActive  = "active"
)

type CloudAgentSessionRequest struct {
	Title   string `json:"title,omitempty"`
	Surface string `json:"surface,omitempty"`
}

type CloudAgentSession struct {
	ID          string    `json:"id"`
	Title       string    `json:"title,omitempty"`
	Surface     string    `json:"surface"`
	LastSurface string    `json:"lastSurface,omitempty"`
	Status      string    `json:"status"`
	Revision    int64     `json:"revision"`
	CreatedAt   time.Time `json:"createdAt"`
	UpdatedAt   time.Time `json:"updatedAt"`
}

type CloudAgentSessionDetail struct {
	Session CloudAgentSession `json:"session"`
	Runs    []CloudAgentRun   `json:"runs"`
}

func normalizeCloudAgentSessionRequest(req *CloudAgentSessionRequest) error {
	if req == nil {
		return BadAuthRequest("会话请求不能为空")
	}
	req.Title = strings.TrimSpace(req.Title)
	if !utf8.ValidString(req.Title) || utf8.RuneCountInString(req.Title) > 240 {
		return BadAuthRequest("会话标题无效")
	}
	req.Surface = strings.TrimSpace(req.Surface)
	if req.Surface == "" {
		req.Surface = cloudAgentDefaultSurface
	}
	if err := validateCloudAgentID(req.Surface, "Agent surface", 64); err != nil {
		return err
	}
	return nil
}

func cloudAgentSessionView(row *model.AgentSession) CloudAgentSession {
	if row == nil {
		return CloudAgentSession{}
	}
	return CloudAgentSession{ID: row.ID, Title: row.Title, Surface: row.Surface, LastSurface: row.LastSurface, Status: row.Status, Revision: row.Revision, CreatedAt: row.CreatedAt, UpdatedAt: row.UpdatedAt}
}

func (s *Service) CreateCloudAgentSession(userID string, req CloudAgentSessionRequest) (*CloudAgentSession, error) {
	if strings.TrimSpace(userID) == "" {
		return nil, kernel.Unauthorized("请先登录")
	}
	if err := normalizeCloudAgentSessionRequest(&req); err != nil {
		return nil, err
	}
	id, err := s.repo.NextPrefixedID("AGS")
	if err != nil {
		return nil, err
	}
	now := time.Now()
	row := &model.AgentSession{ID: id, UserID: userID, Title: req.Title, Surface: req.Surface, LastSurface: req.Surface, Status: cloudAgentSessionActive, Revision: 1, CreatedAt: now, UpdatedAt: now}
	if err := s.repo.CreateAgentSession(row); err != nil {
		return nil, err
	}
	view := cloudAgentSessionView(row)
	return &view, nil
}

func (s *Service) CloudAgentSessions(userID, surface, status string, limit int) ([]CloudAgentSession, error) {
	return s.cloudAgentSessions(userID, "", surface, status, limit)
}

func (s *Service) CloudAgentSessionsForCanvas(userID, canvasID, surface, status string, limit int) ([]CloudAgentSession, error) {
	if err := validateCloudAgentID(canvasID, "画布 ID", 80); err != nil {
		return nil, err
	}
	return s.cloudAgentSessions(userID, canvasID, surface, status, limit)
}

func (s *Service) cloudAgentSessions(userID, canvasID, surface, status string, limit int) ([]CloudAgentSession, error) {
	if strings.TrimSpace(userID) == "" {
		return nil, kernel.Unauthorized("请先登录")
	}
	surface = strings.TrimSpace(surface)
	if surface != "" {
		if err := validateCloudAgentID(surface, "Agent surface", 64); err != nil {
			return nil, err
		}
	}
	status = strings.TrimSpace(status)
	if status != "" {
		if err := validateCloudAgentID(status, "会话状态", 32); err != nil {
			return nil, err
		}
	}
	var rows []model.AgentSession
	var err error
	if strings.TrimSpace(canvasID) == "" {
		rows, err = s.repo.AgentSessions(userID, surface, status, limit)
	} else {
		rows, err = s.repo.AgentSessionsForCanvas(userID, canvasID, surface, status, limit)
	}
	if err != nil {
		return nil, err
	}
	views := make([]CloudAgentSession, 0, len(rows))
	for index := range rows {
		views = append(views, cloudAgentSessionView(&rows[index]))
	}
	return views, nil
}

func (s *Service) CloudAgentSession(userID, sessionID string) (*CloudAgentSession, error) {
	if strings.TrimSpace(userID) == "" {
		return nil, kernel.Unauthorized("请先登录")
	}
	if err := validateCloudAgentID(sessionID, "会话 ID", 80); err != nil {
		return nil, err
	}
	row, err := s.repo.AgentSession(userID, strings.TrimSpace(sessionID))
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, kernel.NotFound("Agent 会话不存在")
	}
	if err != nil {
		return nil, err
	}
	if row.Status == repository.AgentSessionDeleted {
		return nil, kernel.NotFound("Agent 会话不存在")
	}
	view := cloudAgentSessionView(row)
	return &view, nil
}

// DeleteCloudAgentSession hides completed history while preserving task,
// billing and asset records. It never cancels work as a side effect.
func (s *Service) DeleteCloudAgentSession(userID, sessionID string) error {
	if strings.TrimSpace(userID) == "" {
		return kernel.Unauthorized("请先登录")
	}
	if err := validateCloudAgentID(sessionID, "会话 ID", 80); err != nil {
		return err
	}
	err := s.repo.DeleteAgentSession(userID, sessionID)
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return kernel.NotFound("Agent 会话不存在")
	}
	if errors.Is(err, repository.ErrAgentSessionBusy) {
		return kernel.NewAppError(409, "Agent 会话仍有未结束的任务，请先停止或等待任务结束后再删除")
	}
	return err
}

func (s *Service) CloudAgentSessionRuns(userID, sessionID string, limit int, before ...string) ([]CloudAgentRun, error) {
	if _, err := s.CloudAgentSession(userID, sessionID); err != nil {
		return nil, err
	}
	if len(before) > 0 && before[0] != "" {
		if err := validateCloudAgentID(before[0], "运行游标", 80); err != nil {
			return nil, err
		}
	}
	rows, err := s.repo.CloudAgentExecutionsBySession(userID, strings.TrimSpace(sessionID), limit, before...)
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, kernel.NotFound("Agent 运行游标不存在")
	}
	if err != nil {
		return nil, err
	}
	result := make([]CloudAgentRun, 0, len(rows))
	for index := range rows {
		run := &rows[index]
		state, decodeErr := cloudAgentDecode(run)
		if decodeErr != nil {
			result = append(result, CloudAgentRun{ID: run.ID, SessionID: firstNonEmpty(run.SessionID, run.ConversationID), CanvasID: run.CanvasID, ParentID: run.ParentID, Surface: firstNonEmpty(run.Surface, cloudAgentDefaultSurface), Status: run.Status, Revision: run.Revision, CleanupPending: run.CleanupPending, FailureMessage: run.FailureMessage, CreatedAt: run.CreatedAt, UpdatedAt: run.UpdatedAt})
			continue
		}
		if state.Request.SessionID == "" {
			state.Request.SessionID = firstNonEmpty(run.SessionID, run.ConversationID)
		}
		if state.Request.Surface == "" {
			state.Request.Surface = firstNonEmpty(run.Surface, cloudAgentDefaultSurface)
		}
		if state.Request.ContextSelection.Surface == "" {
			if run.ContextSelectionJSON != "" {
				_ = json.Unmarshal([]byte(run.ContextSelectionJSON), &state.Request.ContextSelection)
			}
			if state.Request.ContextSelection.Surface == "" {
				state.Request.ContextSelection = CloudAgentContextSelection{Surface: state.Request.Surface, CanvasID: state.Request.CanvasID}
			}
		}
		task, taskErr := s.repo.TaskForUser(userID, run.ID)
		if taskErr != nil {
			result = append(result, CloudAgentRun{ID: run.ID, SessionID: firstNonEmpty(run.SessionID, run.ConversationID), CanvasID: run.CanvasID, ParentID: run.ParentID, Surface: firstNonEmpty(run.Surface, cloudAgentDefaultSurface), Status: run.Status, Revision: run.Revision, CleanupPending: run.CleanupPending, FailureMessage: run.FailureMessage, CreatedAt: run.CreatedAt, UpdatedAt: run.UpdatedAt})
			continue
		}
		result = append(result, *agentRunOutput(task, cloudAgentState{Request: state.Request, ParentID: state.ParentID, Skills: state.Skills}))
		result[len(result)-1].Status = run.Status
		result[len(result)-1].Revision = run.Revision
		result[len(result)-1].CleanupPending = run.CleanupPending
		result[len(result)-1].FailureMessage = run.FailureMessage
		result[len(result)-1].UpdatedAt = run.UpdatedAt
	}
	return result, nil
}

// ensureCloudAgentSession assigns the durable conversation identity to a new
// immutable run. Parent runs take precedence so a child cannot silently fork
// a conversation. Legacy executions use ConversationID as a compatibility ID.
func (s *Service) ensureCloudAgentSession(userID string, req *CloudAgentRequest, parentID string) (*model.AgentSession, error) {
	if req == nil {
		return nil, BadAuthRequest("请求不能为空")
	}
	var inheritedID string
	if parentID != "" {
		parent, err := s.repo.CloudAgent(userID, parentID)
		if err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return nil, kernel.NotFound("Agent 运行不存在")
			}
			return nil, err
		}
		inheritedID = firstNonEmpty(parent.SessionID, parent.ConversationID)
		if inheritedID != "" && req.SessionID != "" && req.SessionID != inheritedID {
			return nil, kernel.NewAppError(409, "追加消息必须继续原 Agent 会话")
		}
	}
	id := strings.TrimSpace(req.SessionID)
	if id == "" {
		id = inheritedID
	}
	generatedID := false
	if id == "" && parentID == "" {
		// Root turns without an explicit session must still use a stable session
		// identity. This keeps the request fingerprint deterministic when two
		// identical first submissions race before task creation.
		id = cloudAgentSessionID(userID, req.IdempotencyKey)
		generatedID = true
	}
	if id != "" {
		row, err := s.repo.AgentSession(userID, id)
		if errors.Is(err, gorm.ErrRecordNotFound) && (id == inheritedID || generatedID) {
			// Upgrade a legacy execution lazily. The old ConversationID is already
			// user scoped, so retaining it preserves child-run continuity.
			now := time.Now()
			row = &model.AgentSession{ID: id, UserID: userID, Title: truncateRunes(req.Prompt, 80), Surface: req.Surface, LastSurface: req.Surface, Status: cloudAgentSessionActive, Revision: 1, CreatedAt: now, UpdatedAt: now}
			if err := s.repo.CreateAgentSession(row); err != nil {
				// Another identical request may have created the deterministic
				// session first. Re-read it before surfacing the insert error.
				if existing, readErr := s.repo.AgentSession(userID, id); readErr == nil {
					row = existing
				} else {
					return nil, err
				}
			}
		} else if err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return nil, kernel.NotFound("Agent 会话不存在")
			}
			return nil, err
		}
		if row.Status == repository.AgentSessionDeleted {
			return nil, kernel.NotFound("Agent 会话不存在")
		}
		req.SessionID = row.ID
		if row.Surface != "" && req.Surface == cloudAgentDefaultSurface && row.Surface != cloudAgentDefaultSurface {
			req.Surface = row.Surface
			req.ContextSelection.Surface = row.Surface
		}
		title := ""
		if strings.TrimSpace(row.Title) == "" {
			title = truncateRunes(req.Prompt, 80)
		}
		if err := s.repo.TouchAgentSession(userID, row.ID, req.Surface, title); err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return nil, kernel.NotFound("Agent 会话不存在")
			}
			return nil, err
		}
		return row, nil
	}
	id, err := s.repo.NextPrefixedID("AGS")
	if err != nil {
		return nil, err
	}
	now := time.Now()
	row := &model.AgentSession{ID: id, UserID: userID, Title: truncateRunes(req.Prompt, 80), Surface: req.Surface, LastSurface: req.Surface, Status: cloudAgentSessionActive, Revision: 1, CreatedAt: now, UpdatedAt: now}
	if err := s.repo.CreateAgentSession(row); err != nil {
		return nil, err
	}
	req.SessionID = row.ID
	return row, nil
}
