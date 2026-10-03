package app

import (
	"strings"

	"infinite-canvas/backend/internal/model"
)

// Resolve only the direct parent's effective set. Walking earlier turns would
// resurrect references that a later turn explicitly replaced or cleared.
// The request fingerprint is captured before this resolution so identical
// client retries remain idempotent while the durable request holds exact IDs.
func (s *Service) resolveCloudAgentCreationAttachments(userID string, req *CloudAgentRequest, previous []CloudAgentAttachment) error {
	if req.Surface != "creation" {
		return nil
	}
	mode := req.AttachmentMode
	if mode == "" {
		mode = "replace"
		if len(req.Attachments) == 0 {
			mode = "inherit"
		} else if len(previous) > 0 {
			mode = "append"
		}
	}
	req.Attachments = append([]CloudAgentAttachment(nil), req.Attachments...)
	turnCounts := map[string]int{}
	for index := range req.Attachments {
		turnCounts[req.Attachments[index].Kind]++
		req.Attachments[index].TurnIndex = turnCounts[req.Attachments[index].Kind]
	}
	inherited := append([]CloudAgentAttachment(nil), previous...)
	for index := range inherited {
		inherited[index].TurnIndex = 0
	}
	switch mode {
	case "inherit":
		req.Attachments = inherited
	case "append":
		merged := inherited
		positions := make(map[string]int, len(merged))
		for index, attachment := range merged {
			positions[attachment.ResourceID] = index
		}
		for _, attachment := range req.Attachments {
			if index, exists := positions[attachment.ResourceID]; exists {
				merged[index] = attachment
			} else {
				positions[attachment.ResourceID] = len(merged)
				merged = append(merged, attachment)
			}
		}
		req.Attachments = merged
	}
	if len(req.Attachments) > 16 {
		return BadAuthRequest("本轮最多引用 16 个素材，请替换或排除部分素材")
	}
	for _, attachment := range req.Attachments {
		resource, err := s.repo.ResourceForUser(userID, attachment.ResourceID)
		if err != nil || resource.Status != model.ResourceStatusReady || !strings.HasPrefix(strings.ToLower(resource.MimeType), attachment.Kind+"/") {
			return BadAuthRequest("当前有效素材不存在、不属于当前用户、尚未就绪或类型不匹配，请重新选择素材")
		}
	}
	// Checkpoints contain the resolved set, not an operation to replay when the
	// runtime validates or restores the immutable request.
	req.AttachmentMode = "replace"
	return nil
}

// Display names may change without changing evidence. Replacing a resource or
// its role invalidates the previous product plan and confirmation, while an
// explicit append can retain the previous evidence alongside new references.
func cloudAgentCreationAttachmentsPreserveContext(previous, current []CloudAgentAttachment, appendOnly bool) bool {
	if !appendOnly && len(previous) != len(current) {
		return false
	}
	available := make(map[string]CloudAgentAttachment, len(current))
	for _, attachment := range current {
		available[attachment.ResourceID] = attachment
	}
	for _, attachment := range previous {
		next, ok := available[attachment.ResourceID]
		if !ok || next.Kind != attachment.Kind || next.Role != attachment.Role {
			return false
		}
	}
	return true
}
