package app

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"strings"

	"gorm.io/gorm"
	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"
)

func (s *Service) TeamWorkspaceTask(actorID, teamID string, req CreateTaskRequest, quoteOnly bool) (any, error) {
	if err := s.RequireFeature(FeatureTeams); err != nil {
		return nil, err
	}
	if err := s.RequireFeature(FeatureCredits); err != nil {
		return nil, err
	}
	member, err := s.requireTeamMember(actorID, teamID, false)
	if err != nil {
		return nil, err
	}
	if req.Type != "canvas_text" || req.Operation != "text" || req.Input["mode"] != "text" || taskInputUsesCustomChannel(req.Input) || taskInputUsesWorkflowProvider(req.Input) || req.Input["agentRequests"] != nil {
		return nil, BadAuthRequest("当前空间仅开放系统模型的文本生成")
	}
	for _, key := range []string{"referenceImages", "referenceVideos", "referenceAudios"} {
		if refs := req.Input[key]; refs != nil {
			if list, ok := refs.([]any); !ok || len(list) != 0 {
				return nil, BadAuthRequest("当前空间的文本生成仅支持文本参考")
			}
		}
	}
	storageKey := model.TeamContentKey(teamID)
	canvasID := req.ProjectID
	if canvasID != "" {
		if _, err := s.repo.CanvasProjectMetadataForUser(storageKey, canvasID); err != nil {
			return nil, teamNotFound(err)
		}
	}
	var id, digest string
	if !quoteOnly {
		if strings.TrimSpace(req.IdempotencyKey) == "" || len(req.IdempotencyKey) > 160 || req.MaxChargeMicrocredits == nil || *req.MaxChargeMicrocredits < 0 {
			return nil, BadAuthRequest("请确认积分上限并提供提交标识")
		}
		identity := sha256.Sum256([]byte(member.ID + "\x00" + req.IdempotencyKey))
		id = hex.EncodeToString(identity[:16])
		raw, err := json.Marshal(req)
		if err != nil {
			return nil, err
		}
		hash := sha256.Sum256(raw)
		digest = hex.EncodeToString(hash[:])
		if saved, err := s.repo.TaskForUser(storageKey, id); err == nil {
			if saved.SubmissionHash != digest {
				return nil, BadAuthRequest("同一提交标识不能修改生成参数")
			}
			return taskForOutput(*saved), nil
		} else if !errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, err
		}
	}
	config, _ := req.Input["config"].(map[string]any)
	if req.LogicalModelID == "" && stringValue(config["channelId"]) == "" {
		return nil, BadAuthRequest("请选择系统文本模型")
	}
	options, _ := req.Input["textOptions"].(map[string]any)
	metadata, _ := req.Input["metadata"].(map[string]any)
	context := make(map[string]any)
	for _, key := range []string{"conversationId", "messageId", "nodeId", "sourceNodeId", "clientOperationId", "attemptGroupId"} {
		if value, ok := metadata[key].(string); ok {
			context[key] = value
		}
	}
	if source, _ := metadata["source"].(string); source == "create-page" {
		context["source"] = source
	}
	const outputBudget = 1024
	req.Input = map[string]any{"mode": "text", "prompt": req.Prompt, "maxOutputTokens": outputBudget, "config": map[string]any{"channelId": stringValue(config["channelId"]), "model": stringValue(config["model"]), "priceTierId": stringValue(config["priceTierId"])}, "textHistory": req.Input["textHistory"], "metadata": context, "textOptions": map[string]any{"maxOutputTokens": outputBudget, "stream": options["stream"], "thinkingLevel": options["thinkingLevel"]}}
	req.ProjectID = ""
	prepared := &creationTaskPreparation{}
	req.creationPrepare = prepared
	task, err := s.CreateTask(actorID, req)
	if err != nil {
		return nil, err
	}
	order := prepared.Order
	if order == nil || order.Capability != "text" || (order.BillingMode != "fixed_request" && order.BillingMode != "token") {
		return nil, BadAuthRequest("模型不支持团队积分封顶")
	}
	if quoteOnly {
		return map[string]int64{"maxChargeMicrocredits": order.AmountMicrocredits}, nil
	}
	if order.AmountMicrocredits > *req.MaxChargeMicrocredits {
		return nil, teamError(409, "team_text_quote_changed", "当前报价超过已确认上限，请重新报价")
	}
	var input map[string]any
	if err := json.Unmarshal([]byte(task.InputJSON), &input); err != nil {
		return nil, err
	}
	if err := s.protectTaskSecrets(input); err != nil {
		return nil, err
	}
	encoded, err := json.Marshal(input)
	if err != nil {
		return nil, err
	}
	task.InputJSON = string(encoded)
	task.ID, task.SubmissionHash, task.UserID, task.ProjectID, task.BillingOrderID = id, digest, storageKey, canvasID, order.ID
	task.AuthorizedChargeMicrocredits = order.AmountMicrocredits
	order.TaskID, order.IdempotencyKey, order.TeamID, order.MembershipID = id, "task:"+id, teamID, member.ID
	order.Scene, order.BillingAccountID, order.ChargeLimitSet, order.ChargeLimitMicrocredits = "team_text", model.TeamMemberCreditAccountID(member.ID), true, order.AmountMicrocredits
	policy, err := s.RuntimePolicy()
	if err != nil {
		return nil, err
	}
	if err := s.createTaskWithinStorageQuota(task, order, policy); err != nil {
		if saved, lookupErr := s.repo.TaskForUser(storageKey, id); lookupErr == nil && saved.SubmissionHash == digest {
			return taskForOutput(*saved), nil
		}
		return nil, teamWalletError(err)
	}
	return taskForOutput(*task), nil
}

func (s *Service) taskModelActor(task *model.Task) (string, error) {
	teamID, team := model.TeamIDFromContentKey(task.UserID)
	if !team {
		return task.UserID, nil
	}
	order, err := s.repo.BillingOrder(task.BillingOrderID)
	if err != nil {
		return "", err
	}
	if order.TaskID != task.ID || order.TeamID != teamID || order.UserID == "" {
		return "", repository.ErrTeamWalletForbidden
	}
	return order.UserID, nil
}

func (s *Service) authorizeQueuedTeamTask(task *model.Task, teamID string) error {
	if err := s.RequireFeature(FeatureTeams); err != nil {
		return err
	}
	if err := s.RequireFeature(FeatureCredits); err != nil {
		return err
	}
	order, err := s.repo.BillingOrder(task.BillingOrderID)
	if err != nil {
		return err
	}
	member, err := s.requireTeamMember(order.UserID, teamID, false)
	if err != nil {
		return err
	}
	if order.TeamID != teamID || member.ID != order.MembershipID {
		return repository.ErrTeamWalletForbidden
	}
	return nil
}
