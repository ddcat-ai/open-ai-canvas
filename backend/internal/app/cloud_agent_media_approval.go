package app

import (
	"encoding/json"
	"strings"

	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/repository"
)

// Only user-editable image options cross the approval boundary. Targets,
// references, prompt, snapshot and generation mode remain server-authored.
type CloudAgentMediaSettings struct {
	LogicalModelID  string `json:"logicalModelId,omitempty"`
	ChannelID       string `json:"channelId,omitempty"`
	ChannelModelKey string `json:"channelModelKey,omitempty"`
	Size            string `json:"size"`
	Quality         string `json:"quality"`
}

// updateCloudAgentMediaApproval rebuilds the complete prepared admission for an
// edited approval. It is called inside MutateCloudAgent so the new prepared
// hash, resource lease set and runtime checkpoint commit atomically.
func (s *Service) updateCloudAgentMediaApproval(repo *repository.Repository, run *model.CloudAgentExecution, state *cloudAgentRuntime, settings CloudAgentMediaSettings) error {
	if state == nil || state.Approval == nil {
		return creationConflict("审批不存在或已过期")
	}
	call := state.Approval.Call
	if call.Function.Name != "generate_media" {
		return BadAuthRequest("当前审批不是图片生成，不能修改生成参数")
	}
	var args cloudAgentMediaArgs
	if err := decodeCloudAgentJSONObject(call.Function.Arguments, &args); err != nil {
		return err
	}
	if args.Mode != "image" {
		return BadAuthRequest("仅图片生成审批支持修改模型、画幅和质量")
	}
	args.LogicalModelID, args.ChannelID, args.ChannelModelKey = settings.LogicalModelID, settings.ChannelID, settings.ChannelModelKey
	args.Size, args.Quality = settings.Size, settings.Quality
	raw, err := json.Marshal(args)
	if err != nil {
		return err
	}
	call.Function.Arguments = string(raw)
	req, plan, err := s.prepareCloudAgentMedia(run, state, call)
	if err != nil {
		return err
	}
	// Dry admission uses the same model, ownership and option checks as task
	// submission, without reserving credits or creating a generation task.
	preparation := &creationTaskPreparation{}
	req.creationPrepare = preparation
	task, err := s.CreateTask(run.UserID, req)
	if err != nil {
		return err
	}
	var resolved struct {
		Config map[string]any `json:"config"`
	}
	if err := json.Unmarshal([]byte(task.InputJSON), &resolved); err != nil {
		return err
	}
	requested, _ := req.Input["config"].(map[string]any)
	if err := validateCloudAgentResolvedMediaOptions(requested, resolved.Config); err != nil {
		return err
	}
	name, err := s.cloudAgentMediaModelName(args)
	if err != nil {
		return err
	}
	canvas, err := repo.CanvasProjectForUser(run.UserID, state.Request.CanvasID)
	if err != nil {
		return err
	}
	doc, err := creationDocument(canvas.PayloadJSON)
	if err != nil {
		return err
	}
	prepared, err := prepareCloudAgentMediaApproval(repo, run.UserID, doc, plan, req, task, preparation.Order)
	if err != nil {
		return err
	}
	// Editing an approval changes the prepared inputs and quote, but it is still
	// the same user-approved generation intent until the user submits a new
	// generation from the canvas.
	if previous := state.Approval.Prepared; previous != nil && previous.GenerationID != "" {
		prepared.GenerationID = previous.GenerationID
		prepared.Hash = creationHash(prepared)
	}
	if err := replaceCloudAgentPreparedLeases(repo, run.UserID, run.ID, state.Approval.ID, prepared); err != nil {
		return err
	}
	state.Calls[state.CallIndex] = call
	state.Approval.Call = call
	state.Approval.CallHash = cloudAgentApprovalCallHash(call)
	state.Approval.ModelName = name
	state.Approval.Preview = cloudAgentMediaApprovalPreview(plan, name)
	state.Approval.Prepared = prepared
	return nil
}

func replaceCloudAgentPreparedLeases(repo *repository.Repository, userID, runID, approvalID string, prepared *cloudAgentPreparedMedia) error {
	ids := make([]string, 0, len(prepared.ResourceSignatures))
	for id := range prepared.ResourceSignatures {
		ids = append(ids, id)
	}
	return repo.ReplaceCloudAgentResourceLeases(userID, runID, approvalID, ids, prepared.Quote.ExpiresAt)
}

func validateCloudAgentResolvedMediaOptions(requested, resolved map[string]any) error {
	for _, key := range []string{"size", "videoSeconds", "vquality", "quality", "count", "videoGenerateAudio"} {
		if value := stringValue(requested[key]); value != "" && !strings.EqualFold(value, stringValue(resolved[key])) {
			return creationConflict("模型解析后的生成规格与审批参数不同，请重新读取目录并审批")
		}
	}
	return nil
}
