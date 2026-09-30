// 画布 Agent 工具调用的执行与结果回填。
//
// 只读工具可以在同一步内批量执行（advanceCloudAgentReadBatch），结果按参数哈希缓存；
// 写工具逐个执行，执行前后都会让相关读缓存失效，避免模型基于过期画布做决定。

package app

import (
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/repository"
)

func cloudAgentToolResult(runID string, state *cloudAgentRuntime, call cloudAgentCall, result any, err error) bool {
	payload := map[string]any{"toolName": call.Function.Name, "callId": call.ID, "arguments": call.Function.Arguments}
	if call.Function.Name == "skill_read_file" {
		var args struct {
			SkillID string `json:"skillId"`
			Path    string `json:"path"`
		}
		if json.Unmarshal([]byte(call.Function.Arguments), &args) == nil {
			payload["skillId"], payload["path"] = args.SkillID, args.Path
			for _, skill := range state.Skills {
				if skill.ID == args.SkillID {
					payload["skillName"] = skill.Name
					break
				}
			}
		}
	}
	kind := "tool_completed"
	if err != nil {
		detail, ok := result.(map[string]any)
		if !ok || detail == nil {
			detail = map[string]any{}
		}
		// 模型漏了必填字段（或参数不是对象）时，即便业务校验抛的是普通 AppError，也按
		// "参数契约错误"处理：把本轮实际暴露的 schema 回给模型，它才改得对。
		// 只在业务侧确实按参数问题拒绝（400/422）时套用：上游 5xx 或网络错误即便同时漏字段，
		// 也该算上游故障，别把锅扣到参数上。已分类的参数错误不再套壳，避免覆盖更精确的反馈。
		var appErr *AppError
		var existingArgumentErr *cloudAgentArgumentError
		if missing := cloudAgentMissingRequiredArguments(state.Canonical.Tools, call); len(missing) > 0 &&
			!errors.As(err, &existingArgumentErr) &&
			errors.As(err, &appErr) && appErr != nil && (appErr.Status == 400 || appErr.Status == 422) {
			err = &cloudAgentFieldArgumentError{
				error: &cloudAgentArgumentError{err},
				Field: strings.Join(missing, ","), Issue: "required",
			}
		}
		message := cloudAgentSafeToolError(err)
		detail["error"] = message
		var admissionErr *cloudAgentMediaAdmissionError
		if errors.As(err, &admissionErr) {
			detail["reason"], detail["nodeId"] = admissionErr.Reason, admissionErr.NodeID
		}
		var argumentErr *cloudAgentArgumentError
		if errors.As(err, &argumentErr) {
			detail["reason"] = "invalid_tool_arguments"
			var fieldErr *cloudAgentFieldArgumentError
			if errors.As(err, &fieldErr) {
				detail["field"], detail["issue"] = fieldErr.Field, fieldErr.Issue
			}
			// Use this run's advertised contract, including its permission scope.
			for _, tool := range state.Canonical.Tools {
				function, _ := tool["function"].(map[string]any)
				if function["name"] == call.Function.Name {
					detail["parameters"] = function["parameters"]
					break
				}
			}
			detail["guidance"] = "本次调用未执行，请按 parameters 修正参数后重试，不要重复提交相同的错误参数"
			if call.Function.Name == "canvas_get_state" {
				detail["exampleArguments"] = map[string]any{}
			}
			if call.Function.Name == "canvas_apply_ops" {
				detail["exampleArguments"] = map[string]any{"snapshotHash": "<canvas_get_state.snapshotHash>", "ops": []any{map[string]any{"type": "add_node", "id": "<new-node-id>", "nodeType": "text", "content": "<content>"}}}
			}
		}
		// 稳定归类 + 可行动字段：只加标注，不改任何放行/拒绝判定。
		// allowed 与执行器用的是同一份判定（cloudAgentToolAllowed 是纯函数，结果一致）。
		if class, retryable, requiredAction := cloudAgentToolErrorClass(state.Request, call, err, cloudAgentToolAllowed(state.Request, call.Function.Name)); class != "" {
			detail["errorClass"], detail["errorClassLabel"] = class, cloudAgentToolErrorLabel(class)
			detail["retryable"] = retryable
			if requiredAction != "" {
				detail["requiredAction"] = requiredAction
			}
			payload["errorClass"] = class
		}
		result = detail
		kind = "tool_failed"
		payload["text"] = message
	} else {
		payload["text"] = "工具执行成功"
	}
	if inspection, ok := result.(cloudAgentImageInspection); ok && err == nil {
		receipt, _ := json.Marshal(inspection.Receipt)
		payload["result"] = inspection.Receipt
		state.event(runID, kind, payload)
		// tool 角色只接受字符串内容（四种上游图式都是纯文本），因此工具回执照常入历史，
		// 图片另起一条 user 消息携带，并显式标注为数据而非指令。
		state.Canonical.Messages = append(state.Canonical.Messages,
			map[string]any{"role": "tool", "tool_call_id": call.ID, "content": string(receipt)})
		// 重复查看时只回执文字（ImageURL 为空），不再附图。
		if strings.TrimSpace(inspection.ImageURL) != "" {
			cloudAgentStageImageInspection(state, inspection)
		}
		// 一批里可能有多个调用（模型一次发起 parallel tool calls），上游要求
		// assistant(tool_calls) 之后紧跟每一个 tool_call_id 的 tool 消息，所以图片
		// 不能插在 tool 结果之间。只有本批最后一个调用执行完，才把整批缓冲合并成
		// 一条 user 消息追加在全部 tool 结果之后。
		if state.CallIndex+1 >= len(state.Calls) {
			cloudAgentFlushPendingImages(state)
		}
		state.CallIndex++
		state.Approval = nil
		// 看图是只读成功路径，不占自动纠错名额（那名额只给写/生成类工具的预执行参数错误）。
		return false
	}
	exhausted := cloudAgentTrackToolRepair(runID, state, call, result, err, payload)
	raw, _ := json.Marshal(result)
	payload["result"] = result
	if call.Function.Name == "skill_read_file" && err == nil {
		// SSE/UI needs the read receipt, not another durable copy of skill text.
		if fields, ok := result.(map[string]any); ok {
			receipt := make(map[string]any, len(fields))
			for key, value := range fields {
				if key != "content" {
					receipt[key] = value
				}
			}
			payload["result"] = receipt
		}
	}
	state.event(runID, kind, payload)
	state.Canonical.Messages = append(state.Canonical.Messages, map[string]any{"role": "tool", "tool_call_id": call.ID, "content": string(raw)})
	state.CallIndex++
	state.Approval = nil
	return exhausted
}

// cloudAgentReadResultInContext reports whether the full cached result is still
// present in the canonical transcript. Context compaction deliberately removes old
// tool bodies, so a replay must restore the body once instead of returning a receipt
// that refers to history the model can no longer see.
func cloudAgentReadResultInContext(state *cloudAgentRuntime, result json.RawMessage) bool {
	if state == nil || len(result) == 0 {
		return false
	}
	// Unit-level callers may exercise the cache helper without constructing a
	// transcript. The real runtime always has the first tool message here.
	if len(state.Canonical.Messages) == 0 {
		return true
	}
	want := string(result)
	for _, message := range state.Canonical.Messages {
		if stringValue(message["role"]) == "tool" && stringValue(message["content"]) == want {
			return true
		}
	}
	return false
}

// cloudAgentBatchableReadTool identifies read calls that are independent of
// each other and safe to execute from one model tool-call response. Keeping
// this list limited to the cacheable read contract is important: mutations,
// approvals, user questions, media and vision calls remain ordered state
// transitions and must each retain their existing semantics.
func cloudAgentBatchableReadTool(name string) bool {
	return cloudAgentReadToolReadOnly(name)
}

func cloudAgentInvalidateReadCache(state *cloudAgentRuntime) {
	if state == nil {
		return
	}
	// Canvas writes invalidate only canvas projections. Skill documents,
	// profile preferences, and the model catalog do not change when a canvas is
	// edited, so retaining them avoids re-reading large unrelated tool results.
	for key := range state.ToolReadResults {
		if strings.HasPrefix(key, "canvas_get_state:") || strings.HasPrefix(key, "canvas_read_storyboard:") {
			delete(state.ToolReadResults, key)
			delete(state.ToolReadReplays, key)
		}
	}
}

// advanceCloudAgentReadBatch executes consecutive independent reads from the
// same model response before returning to the scheduler. The previous path
// checkpointed after every read, which turned one parallel tool-call response
// into N scheduler/database transitions. Results still get one tool message
// per call, in the original order, so every provider contract remains valid.
func (s *Service) advanceCloudAgentReadBatch(run *model.CloudAgentExecution, state *cloudAgentRuntime) (bool, error) {
	if run == nil || state == nil || (run.Status != "running" && run.Status != "queued") {
		return true, nil
	}
	if state.CallIndex < 0 || state.CallIndex >= len(state.Calls) {
		return false, nil
	}
	type outcome struct {
		call   cloudAgentCall
		result any
		err    error
	}
	outcomes := make([]outcome, 0, len(state.Calls)-state.CallIndex)
	// Reads are collected before one checkpoint write. During collection, their
	// successful receipts are not in Canonical.Messages yet, so the regular cache
	// layer cannot see that an earlier call in this same batch already returned
	// the full body. Track those keys here to avoid appending the same large result
	// repeatedly when a model emits duplicate parallel reads.
	batchReadResults := make(map[string]bool, len(state.Calls)-state.CallIndex)
	for index := state.CallIndex; index < len(state.Calls); index++ {
		call := state.Calls[index]
		if !cloudAgentBatchableReadTool(call.Function.Name) || !cloudAgentToolAllowed(state.Request, call.Function.Name) {
			break
		}
		call = s.cloudAgentRefreshStepSnapshotHash(run, state, call)
		state.Calls[index] = call
		if call.Function.Name == "skill_read_file" || call.Function.Name == "model_list" {
			state.RuntimeRunID = run.ID
		}
		result, err := cloudAgentReadToolCached(s.repo, run.UserID, state, call, s)
		if err == nil {
			cacheKey := cloudAgentReadCacheKeyForState(s.repo, run.UserID, state, call)
			if batchReadResults[cacheKey] {
				// The first receipt will be appended before this one in the same
				// checkpoint transaction, so this acknowledgement is truthful even
				// though the canonical transcript has not been updated yet.
				result = map[string]any{
					"cacheReplay": true,
					"replayCount": state.ToolReadReplays[cacheKey],
					"message":     "该只读结果已在本批工具调用的前序结果中，请直接使用已有结果，不要再次读取",
				}
			} else {
				batchReadResults[cacheKey] = true
			}
		}
		outcomes = append(outcomes, outcome{call: call, result: result, err: err})
		var loopErr *cloudAgentReadLoopError
		if errors.As(err, &loopErr) {
			break
		}
	}
	if len(outcomes) == 0 {
		return false, nil
	}

	s.storageMu.Lock()
	defer s.storageMu.Unlock()
	err := s.repo.MutateCloudAgent(run.UserID, run.ID, run.Revision, func(current *model.CloudAgentExecution, _ *repository.Repository) error {
		for _, item := range outcomes {
			var readLoopErr *cloudAgentReadLoopError
			if errors.As(item.err, &readLoopErr) {
				// A provider tool-call turn is atomic from the transcript's point of
				// view: every declared tool_call_id needs a tool message, even when a
				// read guard terminates the run. Record the triggering error and then
				// explicit skipped receipts before appending run_failed, otherwise a
				// later resume/replay produces an invalid provider transcript.
				cloudAgentToolResult(current.ID, state, item.call, item.result, item.err)
				for state.CallIndex < len(state.Calls) {
					pending := state.Calls[state.CallIndex]
					cloudAgentToolResult(current.ID, state, pending,
						map[string]any{"skipped": true, "reason": readLoopErr.reasonCode()},
						nil)
				}
				current.Status = "failed"
				current.FailureMessage = truncateRunes(readLoopErr.Error(), 1000)
				cloudAgentDropInterjections(run.ID, "本轮已结束："+truncateRunes(current.FailureMessage, 120), state)
				reason := readLoopErr.reasonCode()
				state.event(run.ID, "run_failed", map[string]any{
					"text": current.FailureMessage, "reason": reason,
					"toolName": item.call.Function.Name, "readCount": readLoopErr.Count,
				})
				break
			}
			cloudAgentRecordToolResult(current, state, item.call, item.result, item.err)
		}
		return cloudAgentSave(current, state)
	})
	return true, err
}

func (s *Service) advanceCloudAgentTool(run *model.CloudAgentExecution, state *cloudAgentRuntime) error {
	if run == nil || state == nil || (run.Status != "running" && run.Status != "queued") {
		return nil
	}
	if state.CallIndex < 0 || state.CallIndex >= len(state.Calls) {
		return s.failCloudAgent(run, state, "Agent 工具调用状态无效，本轮已停止")
	}
	call := state.Calls[state.CallIndex]
	call = s.cloudAgentRefreshStepSnapshotHash(run, state, call)
	state.Calls[state.CallIndex] = call
	if state.Approval != nil && state.Approval.Decision == "" {
		return nil
	}
	if state.Approval != nil && state.Approval.Decision != "" && state.Approval.CallHash != "" && state.Approval.CallHash != cloudAgentApprovalCallHash(call) {
		return s.terminateCloudAgent(run, "审批内容与待执行操作不一致，本轮已停止")
	}
	allowed := cloudAgentToolAllowed(state.Request, call.Function.Name)
	mediaTool := call.Function.Name == "generate_media" || call.Function.Name == "image_layer_split"
	// 媒体工具在所有模式下都进入审批；其他写入只在 request_approval 下审批。
	if allowed && cloudAgentWrite(call.Function.Name) && (state.Request.PermissionMode == "request_approval" || mediaTool) && state.Approval == nil {
		var plan *cloudAgentMediaPlan
		var modelName string
		var mediaRequest CreateTaskRequest
		var preparedTask *model.Task
		var mediaPreparation *creationTaskPreparation
		policy, err := s.RuntimePolicy()
		if err != nil {
			return s.terminateCloudAgent(run, "Agent 运行策略不可用，本轮已停止")
		}
		if call.Function.Name == "generate_media" || call.Function.Name == "image_layer_split" {
			mediaCall := cloudAgentMediaCall(call)
			req, prepared, err := s.prepareCloudAgentMedia(run, state, mediaCall)
			if err != nil {
				return s.cloudAgentMediaError(run, state, "admission", false, false, err)
			}
			mediaRequest, plan = req, prepared
			// A durable auto checkpoint already contains the exact admitted input and
			// quote. Reusing it avoids a second dry admission after a worker restart.
			if plan.Prepared == nil {
				// Dry admission validates the selected model and prompt limits without a task or charge.
				mediaPreparation = &creationTaskPreparation{}
				req.creationPrepare = mediaPreparation
				preparedTask, err = s.CreateTask(run.UserID, req)
				if err != nil {
					return s.cloudAgentMediaError(run, state, "admission", false, false, err)
				}
				// Resolve model-owned defaults once during the dry admission. Both the
				// eventual task and the canvas draft must use this exact resolved input;
				// otherwise auto mode reports a false tool failure for omitted size or
				// duration and makes the model spend another turn repairing its own call.
				if err := applyCloudAgentResolvedMediaDefaults(&req, prepared, preparedTask); err != nil {
					return s.cloudAgentMediaError(run, state, "admission", false, false, err)
				}
				mediaRequest, plan = req, prepared
			}
			modelName, err = s.cloudAgentMediaModelName(plan.Args)
			if err != nil {
				return s.cloudAgentMediaError(run, state, "admission", false, false, err)
			}
		}
		if plan != nil && state.Request.PermissionMode == "auto" && !mediaTool {
			if plan.Prepared != nil {
				// The draft and quote were already checkpointed. Reuse them after a
				// worker restart instead of dry-admitting and mutating the canvas again.
				latest, err := s.repo.CloudAgent(run.UserID, run.ID)
				if err != nil {
					return err
				}
				fresh, err := cloudAgentDecode(latest)
				if err != nil {
					return err
				}
				return s.enqueueCloudAgentTask(latest, &fresh, mediaRequest, plan)
			}
			// Auto media is a direct, server-admitted write. Prepare the draft and
			// its immutable quote in one checkpoint transaction, then release the
			// lock before enqueueCloudAgentTask performs the billed submission.
			s.storageMu.Lock()
			err := s.repo.MutateCloudAgent(run.UserID, run.ID, run.Revision, func(current *model.CloudAgentExecution, repo *repository.Repository) error {
				if err := createCloudAgentMediaNode(repo, run.UserID, state.Request.CanvasID, plan, nil, policy, cloudAgentCanvasEventRecorder(run.ID, state)); err != nil {
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
				plan.Args.SnapshotHash = cloudAgentMediaContentHash(doc)
				raw, err := json.Marshal(plan.Args)
				if err != nil {
					return err
				}
				call.Function.Arguments = string(raw)
				state.Calls[state.CallIndex] = call
				preparedMedia, err := prepareCloudAgentMediaApproval(repo, run.UserID, doc, plan, mediaRequest, preparedTask, mediaPreparation.Order)
				if err != nil {
					return err
				}
				plan.Prepared = preparedMedia
				state.AutoPreparedMedia = preparedMedia
				state.AutoPreparedCallHash = cloudAgentApprovalCallHash(call)
				return cloudAgentSave(current, state)
			})
			s.storageMu.Unlock()
			if err != nil {
				latest, readErr := s.repo.CloudAgent(run.UserID, run.ID)
				if readErr != nil || latest.Revision != run.Revision {
					return err
				}
				fresh, decodeErr := cloudAgentDecode(latest)
				if decodeErr != nil {
					return decodeErr
				}
				return s.cloudAgentMediaError(latest, &fresh, "admission", false, false, err)
			}
			latest, err := s.repo.CloudAgent(run.UserID, run.ID)
			if err != nil {
				return err
			}
			fresh, err := cloudAgentDecode(latest)
			if err != nil {
				return err
			}
			return s.enqueueCloudAgentTask(latest, &fresh, mediaRequest, plan)
		}
		s.storageMu.Lock()
		defer s.storageMu.Unlock()
		return s.repo.MutateCloudAgent(run.UserID, run.ID, run.Revision, func(current *model.CloudAgentExecution, repo *repository.Repository) error {
			var preview cloudAgentApprovalPreview
			var preparedMedia *cloudAgentPreparedMedia
			if plan != nil {
				if err := createCloudAgentMediaNode(repo, run.UserID, state.Request.CanvasID, plan, nil, policy, cloudAgentCanvasEventRecorder(run.ID, state)); err != nil {
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
				plan.Args.SnapshotHash = cloudAgentMediaContentHash(doc)
				raw, err := json.Marshal(plan.Args)
				if err != nil {
					return err
				}
				call.Function.Arguments = string(raw)
				state.Calls[state.CallIndex] = call
				preview = cloudAgentMediaApprovalPreview(plan, modelName)
				preparedMedia, err = prepareCloudAgentMediaApproval(repo, run.UserID, doc, plan, mediaRequest, preparedTask, mediaPreparation.Order)
				if err != nil {
					return err
				}
			} else {
				var mutationErr error
				switch call.Function.Name {
				case "canvas_create_storyboard":
					storyboardPlan, err := prepareCloudAgentStoryboardCreate(repo, run.UserID, state.Request.CanvasID, call)
					mutationErr = err
					if err == nil {
						preview = storyboardPlan.Preview
					}
				case "canvas_edit_storyboard":
					storyboardPlan, err := prepareCloudAgentStoryboardEdit(repo, run.UserID, state.Request.CanvasID, call)
					mutationErr = err
					if err == nil {
						preview = storyboardPlan.Preview
					}
				case "canvas_edit_batch_table":
					batchPlan, err := prepareCloudAgentBatchTableEdit(repo, run.UserID, state.Request.CanvasID, call)
					mutationErr = err
					if err == nil {
						preview = batchPlan.Preview
					}
				case "canvas_arrange_nodes":
					arrangePlan, err := prepareCloudAgentArrangeNodes(repo, run.UserID, state.Request.CanvasID, call)
					mutationErr = err
					if err == nil {
						preview = arrangePlan.Preview
					}
				default:
					canvasPlan, err := prepareCloudAgentCanvasMutation(repo, run.UserID, state.Request.CanvasID, call)
					mutationErr = err
					if err == nil {
						preview = canvasPlan.Preview
					}
				}
				if mutationErr != nil {
					var argumentErr *cloudAgentArgumentError
					if errors.As(mutationErr, &argumentErr) {
						cloudAgentRecordToolResult(current, state, call, nil, mutationErr)
						return cloudAgentSave(current, state)
					}
					var appErr *AppError
					if errors.As(mutationErr, &appErr) && appErr != nil {
						return failCloudAgentAdmission(current, state, run.ID, mutationErr)
					}
					return mutationErr
				}
			}
			state.Approval = &cloudAgentApproval{ID: fmt.Sprintf("%s-%d-%d", run.ID, state.Step, state.CallIndex), Call: call, CallHash: cloudAgentApprovalCallHash(call), Preview: preview, ModelName: modelName, Prepared: preparedMedia}
			if preparedMedia != nil {
				if err := pinCloudAgentPreparedMedia(repo, run.UserID, run.ID, state.Approval.ID, preparedMedia); err != nil {
					return err
				}
			}
			current.Status = "waiting_approval"
			state.event(run.ID, "approval_requested", map[string]any{"approvalId": state.Approval.ID, "toolName": call.Function.Name, "modelName": modelName, "arguments": json.RawMessage(call.Function.Arguments), "preview": preview, "prepared": preparedMedia.publicView(), "text": preview.Description})
			return cloudAgentSave(current, state)
		})
	}
	if allowed && call.Function.Name == "plan_update" && cloudAgentPlanRequiresFirstApproval(state, call) {
		if preview, ok := cloudAgentPlanApprovalPreview(call); ok {
			return s.repo.MutateCloudAgent(run.UserID, run.ID, run.Revision, func(current *model.CloudAgentExecution, _ *repository.Repository) error {
				approvalID := fmt.Sprintf("%s-%d-%d", run.ID, state.Step, state.CallIndex)
				state.Approval = &cloudAgentApproval{ID: approvalID, Call: call, CallHash: cloudAgentApprovalCallHash(call), Preview: preview}
				current.Status = "waiting_approval"
				state.event(run.ID, "approval_requested", map[string]any{"approvalId": approvalID, "toolName": call.Function.Name, "arguments": json.RawMessage(call.Function.Arguments), "preview": preview, "text": preview.Description})
				return cloudAgentSave(current, state)
			})
		}
	}
	if allowed && (call.Function.Name == "generate_media" || call.Function.Name == "image_layer_split") && state.Approval != nil && state.Approval.Decision == "approve" {
		return s.advanceCloudAgentMedia(run, state, cloudAgentMediaCall(call))
	}
	policy, err := s.RuntimePolicy()
	if err != nil {
		return s.terminateCloudAgent(run, "Agent 运行策略不可用，本轮已停止")
	}
	// 看图的资源与能力校验在写事务外完成；真实图片只在模型任务执行时读取。
	var inspectionResult any
	var inspectionErr error
	if allowed && call.Function.Name == "canvas_inspect_image" && state.Request.VisionEnabled {
		inspectionResult, inspectionErr = s.prepareCloudAgentImageInspection(run.UserID, state.Request.CanvasID, state, call)
		if errors.Is(inspectionErr, errCloudAgentImageInspectionBudget) {
			return s.failCloudAgent(run, state, cloudAgentImageInspectionBudgetMessage)
		}
	}
	// Skill reads use the domain repository and filesystem, not the checkpoint
	// transaction's connection. Read first to avoid nesting DB reads on SQLite.
	var skillResult any
	var skillErr error
	if allowed && (call.Function.Name == "skill_read_file" || call.Function.Name == "model_list" || call.Function.Name == "image_annotation_render") {
		state.RuntimeRunID = run.ID
		if call.Function.Name == "image_annotation_render" {
			skillResult, skillErr = cloudAgentReadTool(s.repo, run.UserID, state, call, s)
		} else {
			// 技能文件和模型目录都是稳定的只读结果。统一走检查点缓存，
			// 使重复调用不会再次访问文件系统/数据库，也不会把大结果重复
			// 写入后续模型上下文。
			skillResult, skillErr = cloudAgentReadToolCached(s.repo, run.UserID, state, call, s)
		}
	}
	s.storageMu.Lock()
	defer s.storageMu.Unlock()
	return s.repo.MutateCloudAgent(run.UserID, run.ID, run.Revision, func(current *model.CloudAgentExecution, repo *repository.Repository) error {
		var result any
		var toolErr error
		switch {
		case !allowed:
			// 幻觉出来的工具名与"真被权限挡住"要分开反馈：前者模型根本不该发这个调用，
			// 后者是授权边界问题。两者仍然一律拒绝，只是给模型的下一步更明确。
			if !cloudAgentPlatformToolNames()[call.Function.Name] {
				toolErr = BadAuthRequest("模型调用了不存在的工具「" + truncateRunes(call.Function.Name, 60) + "」，本轮已拒绝；请只使用本轮工具表里列出的工具")
			} else {
				toolErr = BadAuthRequest("工具未获本轮权限授权")
			}
		case call.Function.Name == "canvas_apply_ops":
			result, toolErr = applyCloudAgentCanvas(repo, run.UserID, state.Request.CanvasID, call, policy, cloudAgentCanvasEventRecorder(run.ID, state))
		case call.Function.Name == "canvas_arrange_nodes":
			result, toolErr = applyCloudAgentArrangeNodes(repo, run.UserID, state.Request.CanvasID, call, policy, cloudAgentCanvasEventRecorder(run.ID, state))
		case call.Function.Name == "canvas_create_storyboard", call.Function.Name == "canvas_edit_storyboard":
			result, toolErr = applyCloudAgentStoryboardMutation(repo, run.UserID, state.Request.CanvasID, call, policy, cloudAgentCanvasEventRecorder(run.ID, state))
		case call.Function.Name == "canvas_edit_batch_table":
			result, toolErr = applyCloudAgentBatchTableMutation(repo, run.UserID, state.Request.CanvasID, call, policy, cloudAgentCanvasEventRecorder(run.ID, state))
		case call.Function.Name == "canvas_inspect_image":
			result, toolErr = inspectionResult, inspectionErr
			if toolErr == nil && inspectionResult != nil {
				if inspection, ok := inspectionResult.(cloudAgentImageInspection); ok {
					state.markCanvasImageInspection(stringValue(inspection.Receipt["nodeId"]), strings.TrimSpace(inspection.ImageURL) != "")
					if inspection.CacheKey != "" {
						if state.ImageInspectionReads == nil {
							state.ImageInspectionReads = map[string]int{}
						}
						state.ImageInspectionReads[inspection.CacheKey]++
					}
				}
			}
		case call.Function.Name == "skill_read_file", call.Function.Name == "model_list", call.Function.Name == "image_annotation_render":
			result, toolErr = skillResult, skillErr
		default:
			result, toolErr = cloudAgentReadToolCached(repo, run.UserID, state, call)
		}
		if toolErr == nil && cloudAgentWrite(call.Function.Name) {
			// A successful canvas mutation changes the read model. Do not replay a
			// pre-mutation canvas snapshot later in the same Agent run.
			cloudAgentInvalidateReadCache(state)
		}
		var readLoopErr *cloudAgentReadLoopError
		if errors.As(toolErr, &readLoopErr) {
			cloudAgentRecordToolResult(current, state, call, result, toolErr)
			current.Status = "failed"
			current.FailureMessage = truncateRunes(readLoopErr.Error(), 1000)
			cloudAgentDropInterjections(run.ID, "本轮已结束："+truncateRunes(current.FailureMessage, 120), state)
			reason := readLoopErr.reasonCode()
			state.event(run.ID, "run_failed", map[string]any{
				"text": current.FailureMessage, "reason": reason,
				"toolName": call.Function.Name, "readCount": readLoopErr.Count,
			})
			return cloudAgentSave(current, state)
		}
		if call.Function.Name == "plan_update" && toolErr == nil {
			state.event(run.ID, "plan_updated", map[string]any{"items": state.Plan, "pendingTitles": cloudAgentPendingPlanItems(state.Plan)})
		}
		if call.Function.Name == "ask_user" && toolErr == nil {
			payload, _ := result.(map[string]any)
			if payload["phase"] == "question" {
				state.event(run.ID, "user_question", payload)
				cloudAgentRecordToolResult(current, state, call, result, nil)
				skipRemainingCloudAgentCalls(run.ID, state)
				current.Status = "completed"
				return cloudAgentSave(current, state)
			}
			// The server-side round limit turns further questions into a normal
			// tool result so the model must continue with safe defaults.
			cloudAgentRecordToolResult(current, state, call, result, nil)
			return cloudAgentSave(current, state)
		}
		cloudAgentRecordToolResult(current, state, call, result, toolErr)
		return cloudAgentSave(current, state)
	})
}
