package app

import (
	"encoding/json"
	"fmt"
	"strconv"
	"strings"
	"unicode/utf8"

	"infinite-canvas/backend/internal/model"
)

type cloudAgentCommerceMediaIdentity struct {
	TaskID            string
	ItemID            string
	RetryFailedTaskID string
	RetryPromptHash   string
}

func (s *Service) cloudAgentResolvedMediaCall(userID string, state *cloudAgentRuntime, call cloudAgentCall) (cloudAgentCall, cloudAgentCommerceMediaIdentity, error) {
	identity := cloudAgentCommerceMediaIdentity{}
	if state.Request.Surface != "creation" || call.Function.Name != "generate_media" {
		return cloudAgentMediaCall(call), identity, nil
	}
	var args struct {
		ItemID            string `json:"commerceItemId"`
		RetryFailedTaskID string `json:"retryFailedTaskId"`
		RetryPrompt       string `json:"retryPrompt"`
	}
	if err := json.Unmarshal([]byte(call.Function.Arguments), &args); err != nil {
		return call, identity, cloudAgentJSONArgumentError(err)
	}
	if state.CommercePlan == nil {
		if args.RetryFailedTaskID != "" {
			plan, err := s.cloudAgentCommerceRetryPlan(userID, state, args.ItemID, args.RetryFailedTaskID)
			if err != nil {
				return call, identity, err
			}
			copyState := *state
			copyState.CommercePlan = plan
			compiled, retryIdentity, err := s.cloudAgentResolvedMediaCall(userID, &copyState, call)
			if err == nil {
				state.CommercePlan = plan
			}
			return compiled, retryIdentity, err
		}
		return cloudAgentMediaCall(call), identity, nil
	}
	compiled, err := cloudAgentCommerceMediaCall(state.CommercePlan, call)
	if err != nil {
		return call, identity, err
	}
	identity.ItemID = args.ItemID
	identity.TaskID = cloudAgentCommerceTaskID(userID, state.CommercePlan, args.ItemID, state.Request.SessionID)
	if args.RetryFailedTaskID != "" {
		if err := cloudAgentCommerceValidateRetryTarget(s.repo, userID, state, args.ItemID, args.RetryFailedTaskID); err != nil {
			return call, identity, err
		}
		identity.RetryFailedTaskID = args.RetryFailedTaskID
		identity.TaskID = cloudAgentCommerceRetryTaskID(userID, args.RetryFailedTaskID)
		if args.RetryPrompt != "" {
			failed, err := s.repo.TaskForUser(userID, args.RetryFailedTaskID)
			if err != nil {
				return call, identity, err
			}
			var media cloudAgentMediaArgs
			if err := json.Unmarshal([]byte(compiled.Function.Arguments), &media); err != nil {
				return call, identity, err
			}
			if strings.HasPrefix(failed.Prompt, media.Prompt) {
				return call, identity, BadAuthRequest("修复提示词须根据失败原因调整，不能原样重发已失败的提示词")
			}
			identity.RetryPromptHash = creationHash(strings.TrimSpace(args.RetryPrompt))
		}
	}
	return compiled, identity, nil
}

func cloudAgentCommerceTaskMatches(task *model.Task, plan *cloudAgentCommercePlan, itemID string) bool {
	if task == nil || plan == nil || itemID == "" {
		return false
	}
	var input struct {
		Metadata struct {
			CommercePlanID   string `json:"commercePlanId"`
			CommerceVersion  int    `json:"commerceVersion"`
			CommerceItemID   string `json:"commerceItemId"`
			CommercePlanHash string `json:"commercePlanHash"`
		} `json:"metadata"`
	}
	return json.Unmarshal([]byte(task.InputJSON), &input) == nil && input.Metadata.CommercePlanID == plan.PlanID && input.Metadata.CommerceVersion == plan.Version && input.Metadata.CommerceItemID == itemID && input.Metadata.CommercePlanHash == cloudAgentCommercePlanHash(plan)
}

// A creation run has no canvas document or draft node. Its admitted references
// are immutable request attachments, checked again at each billed boundary.
func cloudAgentCreationMediaDocument() map[string]any {
	return map[string]any{"nodes": []any{}, "connections": []any{}}
}

func (s *Service) prepareCloudAgentCreationMedia(run *model.CloudAgentExecution, state *cloudAgentRuntime, a cloudAgentMediaArgs, callID string) (CreateTaskRequest, *cloudAgentMediaPlan, error) {
	if a.Mode != "image" && a.Mode != "video" || state.Request.MediaSettings == nil {
		return CreateTaskRequest{}, nil, BadAuthRequest("本轮未配置所请求的图片或视频生成")
	}
	choice := state.Request.MediaSettings.Image
	if a.Mode == "video" {
		choice = state.Request.MediaSettings.Video
	}
	if choice == nil {
		return CreateTaskRequest{}, nil, BadAuthRequest("本轮未选择该媒体类型的执行模型")
	}
	if a.LogicalModelID != "" || a.ChannelID != "" || a.ChannelModelKey != "" || a.NodeID != "" || a.SourceNodeID != "" || a.SnapshotHash != "" || len(a.ReferenceNodeIDs) > 0 || len(a.ReferenceTransientIDs) > 0 {
		return CreateTaskRequest{}, nil, BadAuthRequest("创建入口不能指定画布节点、快照或改写本轮已选模型")
	}
	if strings.TrimSpace(a.Prompt) == "" || utf8.RuneCountInString(a.Prompt) > 16000 || a.Duration < 0 || len(a.AttachmentResourceIDs) > 16 {
		return CreateTaskRequest{}, nil, BadAuthRequest("生成提示词、时长或参考素材数量无效")
	}
	if a.Mode != "video" && (a.Duration != 0 || a.VideoGenerateAudio != nil) {
		return CreateTaskRequest{}, nil, BadAuthRequest("仅视频生成支持时长和音频参数")
	}
	if utf8.RuneCountInString(a.Title) > 240 {
		return CreateTaskRequest{}, nil, BadAuthRequest("生成标题不能超过240字符")
	}
	a.LogicalModelID, a.ChannelID, a.ChannelModelKey = choice.Selection.LogicalModelID, choice.Selection.ChannelID, choice.Selection.ChannelModelKey
	if choice.ParameterMode == "manual" {
		if choice.Size != "" {
			a.Size = choice.Size
		}
		if choice.Quality != "" {
			a.Quality = choice.Quality
		}
		if a.Mode == "video" && choice.DurationSeconds > 0 {
			a.Duration = choice.DurationSeconds
		}
	}
	if a.Mode == "video" && state.Request.Budget.MaxVideoSeconds > 0 && state.VideoSeconds > state.Request.Budget.MaxVideoSeconds-a.Duration {
		return CreateTaskRequest{}, nil, BadAuthRequest("已超过本轮视频时长预算")
	}
	if state.Request.Budget.MaxGenerationTasks > 0 && state.Generations >= state.Request.Budget.MaxGenerationTasks {
		return CreateTaskRequest{}, nil, BadAuthRequest("已达到本轮媒体生成次数上限")
	}
	a.NodeID = cloudAgentID(run.UserID, fmt.Sprintf("%s:media:%d:%d:%s", run.ID, state.Step, state.CallIndex, callID))
	if strings.TrimSpace(a.Title) == "" {
		a.Title = map[string]string{"image": "生成图片", "video": "生成视频"}[a.Mode]
	}
	refs := map[string]any{}
	if a.Prepared != nil {
		var err error
		refs, err = cloudAgentPreparedReferences(s.repo, run.UserID, a.Prepared)
		if err != nil {
			return CreateTaskRequest{}, nil, err
		}
		a.Prompt = stringValue(a.Prepared.Input["prompt"])
	} else {
		attachmentsWithRoles, err := cloudAgentCreationReferenceRoles(state.Request, a.References)
		if err != nil {
			return CreateTaskRequest{}, nil, err
		}
		usages := map[string]string{}
		for _, reference := range a.References {
			usages[reference.ResourceID] = reference.Usage
		}
		allowed := map[string]CloudAgentAttachment{}
		for _, attachment := range attachmentsWithRoles {
			allowed[attachment.ResourceID] = attachment
		}
		seen := map[string]bool{}
		for _, id := range a.AttachmentResourceIDs {
			attachment, ok := allowed[id]
			if !ok || seen[id] {
				return CreateTaskRequest{}, nil, BadAuthRequest("参考素材不在本轮授权附件中或重复")
			}
			seen[id] = true
			resource, err := s.repo.ResourceForUser(run.UserID, id)
			if err != nil || resource.Status != model.ResourceStatusReady || !strings.HasPrefix(strings.ToLower(resource.MimeType), attachment.Kind+"/") {
				return CreateTaskRequest{}, nil, BadAuthRequest("参考素材不存在、不属于当前用户或媒体类型不匹配")
			}
			field := cloudAgentReferenceAdapters[attachment.Kind].PayloadField
			items, _ := refs[field].([]any)
			refs[field] = append(items, map[string]any{"id": id, "name": attachment.Name, "storageKey": "resource:" + id, "type": resource.MimeType, "mimeType": resource.MimeType, "bytes": resource.Size, "width": resource.Width, "height": resource.Height, "durationMs": resource.DurationMs, "inputKind": attachment.Kind, "role": attachment.Role, "referenceUsage": usages[id]})
		}
		a.Prompt = cloudAgentCreationMediaRolePrompt(a.Prompt, refs)
		a.Prompt, err = cloudAgentMediaReferencePrompt(a.Prompt, refs)
		if err != nil {
			return CreateTaskRequest{}, nil, err
		}
	}
	if err := validateCloudAgentMediaReferences(a.Mode, refs); err != nil {
		return CreateTaskRequest{}, nil, err
	}
	spec, err := cloudAgentGenerationSpec(a, refs, nil)
	if err != nil {
		return CreateTaskRequest{}, nil, err
	}
	config := spec.Options.TaskConfig()
	if a.ChannelID != "" {
		config["channelId"], config["channelModelKey"], config["model"] = a.ChannelID, a.ChannelModelKey, a.ChannelModelKey
	}
	if a.Mode == "image" && choice.ParameterMode == "manual" && choice.Count > 0 {
		config["count"] = strconv.Itoa(choice.Count)
	}
	if a.Mode == "image" && state.CommercePlan != nil {
		// 套图数量来自独立交付项，不能把手动总数量乘到每一项。
		config["count"] = "1"
	}
	input := refs
	input["mode"], input["prompt"], input["config"] = a.Mode, a.Prompt, config
	input["metadata"] = map[string]any{"source": "cloud_agent_creation", "agentRunId": run.ID, "title": a.Title}
	operation := cloudAgentMediaOperation(a.Mode, refs)
	if operation == "" {
		return CreateTaskRequest{}, nil, BadAuthRequest("生成模式尚未实现媒体任务适配器")
	}
	return CreateTaskRequest{Type: "canvas_" + a.Mode, Operation: operation, Prompt: a.Prompt, LogicalModelID: a.LogicalModelID, Model: a.ChannelModelKey, Input: input}, &cloudAgentMediaPlan{Args: a, CallID: callID, Prepared: a.Prepared}, nil
}
