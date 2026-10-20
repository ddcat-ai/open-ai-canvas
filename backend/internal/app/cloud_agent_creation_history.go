package app

import (
	"encoding/json"
	"errors"
	"strings"

	"gorm.io/gorm"
	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"
)

// Historical references are lookup metadata, not current-message attachments.
// A missing/unready old file must not block an unrelated new creation.
func cloudAgentCreationReferenceMetadata(repo *repository.Repository, userID string, attachment CloudAgentAttachment) (map[string]any, error) {
	fact := map[string]any{"resourceId": attachment.ResourceID, "ready": false}
	resource, err := repo.Resource(attachment.ResourceID)
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return fact, nil
	}
	if err != nil {
		return nil, err
	}
	if resource.UserID != userID {
		return nil, BadAuthRequest("历史素材不属于当前用户")
	}
	kind := strings.SplitN(strings.ToLower(resource.MimeType), "/", 2)[0]
	if kind != "image" && kind != "video" && kind != "audio" {
		if resource.Status != model.ResourceStatusReady {
			return fact, nil
		}
		return nil, BadAuthRequest("历史素材类型不支持")
	}
	fact["kind"], fact["ready"] = kind, resource.Status == model.ResourceStatusReady
	fact["name"], fact["role"] = truncateRunes(attachment.Name, 80), attachment.Role
	return fact, nil
}

func cloudAgentCreationHistoricalRequest(repo *repository.Repository, userID string, state *cloudAgentRuntime, runID string) (CloudAgentRequest, error) {
	var snapshot struct {
		Request CloudAgentRequest `json:"request"`
	}
	run, err := repo.CloudAgent(userID, runID)
	if err != nil || run.Surface != "creation" || run.SessionID != state.Request.SessionID {
		return snapshot.Request, BadAuthRequest("只能读取当前用户本创作会话的历史素材")
	}
	if err := json.Unmarshal([]byte(run.StateJSON), &snapshot); err != nil {
		return snapshot.Request, err
	}
	return snapshot.Request, nil
}

func cloudAgentCreationHistoricalAttachment(repo *repository.Repository, userID string, state *cloudAgentRuntime, resourceID, runID string) (CloudAgentAttachment, error) {
	var selected CloudAgentAttachment
	if state.Request.Surface != "creation" || state.Request.SessionID == "" {
		return selected, BadAuthRequest("当前入口没有创作会话")
	}
	if runID != "" {
		req, err := cloudAgentCreationHistoricalRequest(repo, userID, state, runID)
		if err != nil {
			return selected, err
		}
		for _, attachment := range req.Attachments {
			if attachment.ResourceID == resourceID {
				selected = attachment
				break
			}
		}
	} else {
		for _, entry := range state.Request.CreationContext {
			for _, id := range entry.ResourceIDs {
				if id == resourceID {
					selected.ResourceID = id
				}
			}
		}
	}
	if selected.ResourceID == "" {
		return selected, BadAuthRequest("素材不在指定历史轮次或本轮普通创作上下文中，请先查目录")
	}
	resource, err := repo.ResourceForUser(userID, resourceID)
	if err != nil || resource.Status != model.ResourceStatusReady {
		return selected, BadAuthRequest("历史素材已删除、尚未就绪或不属于当前用户")
	}
	kind := strings.SplitN(strings.ToLower(resource.MimeType), "/", 2)[0]
	if kind != "image" && kind != "video" && kind != "audio" {
		return selected, BadAuthRequest("历史素材类型不支持")
	}
	selected.Kind, selected.StorageKey, selected.TurnIndex = kind, "resource:"+resourceID, 0
	selected.Role = firstNonEmpty(selected.Role, "reference")
	selected.Name = firstNonEmpty(selected.Name, "历史素材 "+resourceID)
	return selected, nil
}

func cloudAgentCreationHistoricalCatalogue(repo *repository.Repository, userID string, state *cloudAgentRuntime, runID, beforeRunID string) ([]map[string]any, string, error) {
	items := []map[string]any{}
	appendReferences := func(req CloudAgentRequest, id string) error {
		for index, attachment := range req.Attachments {
			fact, err := cloudAgentCreationReferenceMetadata(repo, userID, attachment)
			if err != nil {
				return err
			}
			fact["runId"] = id
			if index == 0 {
				fact["prompt"] = truncateRunes(req.Prompt, 160)
			}
			items = append(items, fact)
		}
		return nil
	}
	if runID != "" {
		req, err := cloudAgentCreationHistoricalRequest(repo, userID, state, runID)
		if err != nil {
			return nil, "", err
		}
		err = appendReferences(req, runID)
		return items, "", err
	}
	seen := map[string]bool{}
	for _, entry := range state.Request.CreationContext {
		for _, id := range entry.ResourceIDs {
			if seen[id] {
				continue
			}
			seen[id] = true
			fact, err := cloudAgentCreationReferenceMetadata(repo, userID, CloudAgentAttachment{ResourceID: id})
			if err != nil {
				return nil, "", err
			}
			items = append(items, fact)
		}
	}
	// Up to 16 uploads per run; keep the catalogue small alongside media tasks.
	runs, err := repo.CloudAgentBudgetRecordsBySession(userID, state.Request.SessionID, 6, beforeRunID)
	if err != nil {
		return nil, "", err
	}
	next := ""
	if len(runs) > 5 {
		runs = runs[:5]
		next = runs[len(runs)-1].ID
	}
	for _, run := range runs {
		var snapshot struct {
			Request CloudAgentRequest `json:"request"`
		}
		if err := json.Unmarshal([]byte(run.StateJSON), &snapshot); err != nil {
			return nil, "", err
		}
		if snapshot.Request.Surface == "creation" {
			if err := appendReferences(snapshot.Request, run.ID); err != nil {
				return nil, "", err
			}
		}
	}
	return items, next, nil
}
