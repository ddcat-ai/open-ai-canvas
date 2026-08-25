package service

import (
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"infinite-canvas/backend/internal/model"
)

// sessionCreationCoordinator 负责会话草稿、首条消息和首个 storyboard 任务的一致性补偿。
// 会话详情读取与文件上传不放在这里，避免创建流程继续膨胀成通用 session service。
type sessionCreationCoordinator struct {
	service *Service
}

func newSessionCreationCoordinator(service *Service) *sessionCreationCoordinator {
	return &sessionCreationCoordinator{service: service}
}

func (s *Service) sessionCreation() *sessionCreationCoordinator {
	if s.sessionCreationCoordinator != nil {
		return s.sessionCreationCoordinator
	}
	// 部分单元测试直接构造 Service 字面量；延迟创建保持内部测试和工具兼容。
	return newSessionCreationCoordinator(s)
}

func (w *sessionCreationCoordinator) create(userID string, req CreateSessionRequest) (*SessionDetail, error) {
	s := w.service
	prompt := strings.TrimSpace(req.Prompt)
	if prompt == "" {
		return nil, errors.New("prompt is required")
	}
	if err := validateStoryboardContext(req.ProjectStyle, req.Characters); err != nil {
		return nil, err
	}
	compactedSnapshot := compactPersistedValue(req.CanvasSnapshot)
	snapshotJSON, err := json.Marshal(compactedSnapshot)
	if err != nil {
		return nil, fmt.Errorf("序列化画布快照失败：%w", err)
	}
	session := model.Session{ID: newID(), UserID: userID, ProjectID: req.ProjectID, Status: model.SessionStatusActive, Prompt: prompt, CanvasSnapshotJSON: string(snapshotJSON)}
	policy, err := s.RuntimePolicy()
	if err != nil {
		return nil, err
	}
	if err := w.persistDraft(userID, prompt, snapshotJSON, session, policy); err != nil {
		return nil, err
	}
	taskReq := CreateTaskRequest{SessionID: session.ID, ProjectID: req.ProjectID, TraceID: req.TraceID, RequestID: req.RequestID, Type: "agent_storyboard", Operation: "storyboard", Prompt: prompt, Provider: "openai-compatible", Model: req.Config.Model, LogicalModelID: req.LogicalModelID, Input: map[string]any{"mode": "text", "references": req.References, "canvasSnapshot": compactedSnapshot, "requirements": req.Requirements, "canvasAssets": req.CanvasAssets, "projectStyle": req.ProjectStyle, "characters": req.Characters, "config": req.Config}}
	if _, err := s.CreateTask(userID, taskReq); err != nil {
		if cleanupErr := w.deleteDraft(userID, session.ID); cleanupErr != nil {
			return nil, fmt.Errorf("创建会话任务失败：%v；清理会话失败：%w", err, cleanupErr)
		}
		return nil, err
	}
	s.recordActivity(userID, "agent_message", 1)
	return s.SessionDetail(userID, session.ID)
}

func (w *sessionCreationCoordinator) persistDraft(userID string, prompt string, snapshotJSON []byte, session model.Session, policy RuntimePolicySetting) error {
	s := w.service
	s.storageMu.Lock()
	defer s.storageMu.Unlock()
	usage, err := s.repo.UserStorageUsage(userID)
	if err != nil {
		return err
	}
	incomingBytes := int64(len([]byte(prompt))*2 + len(snapshotJSON))
	if err := validateStructuredStorageQuotaWithPolicy(usage, "session", true, incomingBytes, policy.Resource); err != nil {
		return err
	}
	if err := s.repo.Create(&session); err != nil {
		return err
	}
	if err := s.repo.Create(&model.Message{ID: newID(), UserID: userID, SessionID: session.ID, Role: "user", Content: prompt}); err != nil {
		if cleanupErr := s.repo.DeleteSessionDraft(userID, session.ID); cleanupErr != nil {
			return fmt.Errorf("创建会话消息失败：%v；清理会话失败：%w", err, cleanupErr)
		}
		return err
	}
	return nil
}

func (w *sessionCreationCoordinator) deleteDraft(userID string, sessionID string) error {
	s := w.service
	s.storageMu.Lock()
	defer s.storageMu.Unlock()
	return s.repo.DeleteSessionDraft(userID, sessionID)
}
