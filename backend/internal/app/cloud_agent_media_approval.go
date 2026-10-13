package app

import (
	"encoding/json"
	"strings"

	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"
)

// Only user-editable image options cross the approval boundary. Targets,
// references, prompt, snapshot and generation mode remain server-authored.
type CloudAgentMediaSettings struct {
	LogicalModelID             string `json:"logicalModelId,omitempty"`
	ChannelID                  string `json:"channelId,omitempty"`
	ChannelModelKey            string `json:"channelModelKey,omitempty"`
	Size                       string `json:"size"`
	ImageResolution            string `json:"imageResolution,omitempty"`
	ImageParameters            string `json:"imageParameters,omitempty"`
	Quality                    string `json:"quality"`
	DurationSeconds            *int   `json:"durationSeconds,omitempty"`
	VideoGenerateAudio         *bool  `json:"videoGenerateAudio,omitempty"`
	VideoWatermark             *bool  `json:"videoWatermark,omitempty"`
	VideoArkPrivateAssetUpload *bool  `json:"videoArkPrivateAssetUpload,omitempty"`
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
		return BadAuthRequest("当前审批不是媒体生成，不能修改生成参数")
	}
	var args cloudAgentMediaArgs
	if err := decodeCloudAgentJSONObject(call.Function.Arguments, &args); err != nil {
		return err
	}
	if args.Mode != "image" && args.Mode != "video" {
		return BadAuthRequest("仅图片或视频生成审批支持修改模型和规格")
	}
	args.LogicalModelID, args.ChannelID, args.ChannelModelKey = settings.LogicalModelID, settings.ChannelID, settings.ChannelModelKey
	args.Size, args.ImageResolution, args.Quality = settings.Size, settings.ImageResolution, settings.Quality
	args.ImageParameters = settings.ImageParameters
	if args.Mode == "video" {
		if settings.DurationSeconds != nil {
			if *settings.DurationSeconds < 0 {
				return BadAuthRequest("视频时长不能为负数")
			}
			args.Duration = *settings.DurationSeconds
		}
		args.VideoGenerateAudio = settings.VideoGenerateAudio
		args.VideoWatermark = settings.VideoWatermark
		args.VideoArkPrivateAssetUpload = settings.VideoArkPrivateAssetUpload
	}
	if args.Mode == "image" && (settings.DurationSeconds != nil || settings.VideoGenerateAudio != nil || settings.VideoWatermark != nil || settings.VideoArkPrivateAssetUpload != nil) {
		return BadAuthRequest("视频参数仅适用于视频生成审批")
	}
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
	// DecideCloudAgentApproval already holds storageMu for this mutation.
	preparation := &creationTaskPreparation{}
	req.creationPrepare = preparation
	req.callerHoldsStorageMu = true
	task, err := s.CreateTask(run.UserID, req)
	if err != nil {
		return err
	}
	var resolved map[string]any
	if err := json.Unmarshal([]byte(task.InputJSON), &resolved); err != nil {
		return err
	}
	requested, _ := req.Input["config"].(map[string]any)
	if err := validateCloudAgentResolvedMediaOptions(requested, resolved); err != nil {
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

func validateCloudAgentResolvedMediaOptions(requested, resolvedInput map[string]any) error {
	resolvedOptions, _ := resolvedInput["capabilityOptions"].(map[string]any)
	resolvedConfig, _ := resolvedInput["config"].(map[string]any)
	if raw := requested["imageParameters"]; raw != nil {
		var values map[string]any
		if encoded, ok := raw.(string); ok {
			if err := json.Unmarshal([]byte(encoded), &values); err != nil {
				return creationConflict("图片参数格式无效")
			}
		} else {
			values, _ = raw.(map[string]any)
		}
		for name, value := range values {
			if resolvedOptions[name] != value {
				return creationConflict("模型解析后的图片参数与审批内容不同")
			}
		}
	}
	for _, key := range []string{"size", "imageResolution", "videoSeconds", "vquality", "quality", "count", "videoGenerateAudio", "videoWatermark", "videoArkPrivateAssetUpload"} {
		requestedValue := stringValue(requested[key])
		if key == "quality" && requestedValue != "" {
			if _, declared := resolvedOptions[key]; !declared && !strings.EqualFold(requestedValue, stringValue(resolvedOptions["imageResolution"])) {
				return creationConflict("所选图片模型未声明质量参数，请使用模型声明的图片分辨率或质量选项")
			}
		}
		resolved := stringValue(resolvedOptions[key])
		if resolved == "" {
			resolved = stringValue(resolvedConfig[key])
		}
		if requestedValue != "" && !strings.EqualFold(requestedValue, resolved) {
			return creationConflict("模型解析后的生成规格与审批参数不同，请重新读取目录并审批")
		}
	}
	return nil
}
