package app

import (
	"errors"

	"gorm.io/gorm"
	"yingce/backend/internal/kernel"
)

// DeleteCloudAgentConversation removes the user's Agent history while keeping
// task, canvas, media and billing records available for audit and recovery.
func (s *Service) DeleteCloudAgentConversation(userID, conversationID string) error {
	if userID == "" {
		return kernel.Unauthorized("请先登录")
	}
	if err := validateCloudAgentID(conversationID, "会话 ID", 80); err != nil {
		return err
	}
	exists, err := s.repo.CloudAgentConversationExists(userID, conversationID)
	if err != nil {
		return err
	}
	if !exists {
		return kernel.NotFound("Agent 对话不存在")
	}
	_, err = s.repo.DeleteCloudAgentConversation(userID, conversationID)
	return err
}

// CompactCloudAgentConversation explicitly moves terminal runs to cold storage.
// It is idempotent and reports the hot bytes released by this request.
func (s *Service) CompactCloudAgentConversation(userID, conversationID string) (int64, error) {
	if userID == "" {
		return 0, kernel.Unauthorized("请先登录")
	}
	if err := validateCloudAgentID(conversationID, "会话 ID", 80); err != nil {
		return 0, err
	}
	ids, err := s.repo.CloudAgentConversationRunIDs(userID, conversationID)
	if err != nil {
		return 0, err
	}
	if len(ids) == 0 {
		return 0, kernel.NotFound("Agent 对话不存在")
	}
	var freed int64
	for _, id := range ids {
		amount, compactErr := s.repo.CompactCloudAgentRun(userID, id)
		if compactErr != nil {
			if errors.Is(compactErr, gorm.ErrRecordNotFound) {
				continue
			}
			return freed, compactErr
		}
		freed += amount
	}
	return freed, nil
}
