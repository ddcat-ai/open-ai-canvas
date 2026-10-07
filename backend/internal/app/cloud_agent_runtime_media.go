// 画布 Agent 的媒体生成：提交任务、等待结果、处理审批。
//
// 涉及扣费的 generate_media 必须先经用户审批（DecideCloudAgentApproval），
// 审批通过后才真正创建任务；用户直接在节点上生成时审批会被关闭为 superseded_by_node。

package app

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"math"
	"strings"
	"time"
	"unicode/utf8"

	"gorm.io/gorm"
	"infinite-canvas/backend/internal/kernel"
	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/repository"
)

// image_layer_split deliberately reuses the canonical media admission path.
// Keeping the alias at this boundary preserves one approval, billing and
// write-back implementation while exposing a task-specific Agent affordance.
func cloudAgentMediaCall(call cloudAgentCall) cloudAgentCall {
	if call.Function.Name != "image_layer_split" {
		return call
	}
	var args map[string]any
	if err := json.Unmarshal([]byte(call.Function.Arguments), &args); err == nil {
		args["mode"] = "image"
		if raw, err := json.Marshal(args); err == nil {
			call.Function.Arguments = string(raw)
		}
	}
	return call
}

func (s *Service) enqueueCloudAgentTask(run *model.CloudAgentExecution, state *cloudAgentRuntime, req CreateTaskRequest, media *cloudAgentMediaPlan) error {
	orders, err := s.repo.BillingOrdersByTaskIDs(run.UserID, state.TaskIDs)
	if err != nil {
		return err
	}
	remaining := int64(math.Floor(state.Request.Budget.MaxCredits * float64(CreditScale)))
	for _, order := range orders {
		remaining -= order.AmountMicrocredits
	}
	if remaining < 0 {
		return s.failCloudAgent(run, state, "Agent 累计预算已耗尽")
	}
	var prepared *cloudAgentPreparedMedia
	approvalID, generationID := "", ""
	if media != nil {
		prepared = media.Prepared
		if prepared == nil && state.Approval != nil {
			prepared = state.Approval.Prepared
			if state.Approval != nil {
				approvalID = state.Approval.ID
			}
		}
		if prepared == nil {
			return s.cloudAgentMediaError(run, state, "admission", false, false, creationConflict("缺少已批准的生成准备态，请重新申请审批；未提交任务"))
		}
		generationID = prepared.GenerationID
		refs, refErr := cloudAgentPreparedReferences(s.repo, run.UserID, prepared)
		if refErr != nil {
			return s.cloudAgentMediaError(run, state, "admission", false, false, refErr)
		}
		if req.Input == nil {
			req.Input = map[string]any{}
		}
		for _, field := range []string{"referenceImages", "referenceVideos", "referenceAudios"} {
			delete(req.Input, field)
		}
		for field, value := range refs {
			req.Input[field] = value
		}
	}
	prepare := &creationTaskPreparation{}
	req.admission = &taskAdmission{ID: cloudAgentID(run.UserID, fmt.Sprintf("%s:task:%d", run.ID, len(state.TaskIDs))), MaxCharge: remaining, AgentRunID: run.ID, GenerationID: generationID, ApprovalID: approvalID}
	req.creationPrepare = prepare
	task, err := s.CreateTask(run.UserID, req)
	if err != nil {
		if media != nil {
			return s.cloudAgentMediaError(run, state, "admission", false, false, err)
		}
		return s.failCloudAgent(run, state, cloudAgentSafeToolError(err))
	}
	var input map[string]any
	if err = json.Unmarshal([]byte(task.InputJSON), &input); err != nil {
		if media != nil {
			return s.cloudAgentMediaError(run, state, "admission", false, false, err)
		}
		return err
	}
	if media != nil {
		requested, _ := req.Input["config"].(map[string]any)
		resolved, _ := input["config"].(map[string]any)
		if err := validateCloudAgentResolvedMediaOptions(requested, resolved); err != nil {
			return s.cloudAgentMediaError(run, state, "admission", false, false, err)
		}
	}
	if err = s.protectTaskSecrets(input); err != nil {
		if media != nil {
			return s.cloudAgentMediaError(run, state, "admission", false, false, err)
		}
		return err
	}
	raw, err := json.Marshal(input)
	if err != nil {
		if media != nil {
			return s.cloudAgentMediaError(run, state, "admission", false, false, err)
		}
		return err
	}
	task.InputJSON = string(raw)
	if prepare.Order != nil {
		task.BillingOrderID = prepare.Order.ID
	}
	policy, err := s.RuntimePolicy()
	if err != nil {
		if media != nil {
			return s.cloudAgentMediaError(run, state, "admission", false, false, err)
		}
		return err
	}
	s.storageMu.Lock()
	defer s.storageMu.Unlock()
	err = s.repo.MutateCloudAgent(run.UserID, run.ID, run.Revision, func(current *model.CloudAgentExecution, repo *repository.Repository) error {
		if media != nil {
			canvas, err := repo.CanvasProjectForUser(run.UserID, state.Request.CanvasID)
			if err != nil {
				return err
			}
			doc, err := creationDocument(canvas.PayloadJSON)
			if err != nil {
				return err
			}
			if err := validateCloudAgentPreparedAdmission(repo, run.UserID, prepared, task, prepare.Order, doc, media.Args); err != nil {
				return err
			}
			if err := createCloudAgentMediaNode(repo, run.UserID, state.Request.CanvasID, media, task, policy, cloudAgentCanvasEventRecorder(run.ID, state)); err != nil {
				return err
			}
		}
		if err := createTaskWithStorageQuotaRepository(repo, task, prepare.Order, policy); err != nil {
			return err
		}
		if media != nil && prepared != nil {
			if approvalID != "" {
				if err := repo.TransferCloudAgentResourceLeases(run.UserID, approvalID, "task:"+task.ID, task.ID, prepared.Quote.ExpiresAt); err != nil {
					return err
				}
			} else {
				// Auto execution has no approval owner to transfer from. Attach the
				// resource lease directly to the billed task before it can run.
				ids := make([]string, 0, len(prepared.ResourceSignatures))
				for id := range prepared.ResourceSignatures {
					ids = append(ids, id)
				}
				if err := repo.UpsertCloudAgentResourceLeases(run.UserID, run.ID, "task:"+task.ID, ids, prepared.Quote.ExpiresAt); err != nil {
					return err
				}
			}
		}
		if media != nil {
			// The prepared auto admission is single-use. Once the billed task and
			// draft node are committed, a later retry must observe the task state,
			// not reuse the old quote or create a second task.
			state.AutoPreparedMedia = nil
			state.AutoPreparedCallHash = ""
		}
		state.TaskIDs = append(state.TaskIDs, task.ID)
		if media != nil {
			state.MediaTaskID = task.ID
			state.Generations++
			state.VideoSeconds += media.Args.Duration
			toolName := "generate_media"
			if state.CallIndex >= 0 && state.CallIndex < len(state.Calls) && state.Calls[state.CallIndex].Function.Name != "" {
				toolName = state.Calls[state.CallIndex].Function.Name
			}
			state.event(run.ID, "generation_task_created", map[string]any{"toolName": toolName, "taskId": task.ID, "nodeId": media.Args.NodeID, "title": media.Args.Title, "mode": media.Args.Mode, "canvasId": state.Request.CanvasID, "referenceNodeIds": media.Args.ReferenceNodeIDs, "text": "媒体节点与引用连线已创建，生成任务已提交"})
		} else {
			state.ActiveTaskID = task.ID
			// 压缩调用不是本轮的一步：压完还要用压缩后的上下文继续步进，步数不该被它占掉。
			if state.ContextCompaction != nil && req.Operation == cloudAgentContextCompactionOperation {
				state.ContextCompaction.Status = "running"
			} else {
				state.Step++
			}
		}
		return cloudAgentSave(current, state)
	})
	if err != nil && media != nil {
		// Rollback may have happened after checkpoint edits. Reload before recording
		// a tool failure; never turn a stale worker revision into a second result.
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
	return err
}

func (s *Service) cloudAgentMediaError(run *model.CloudAgentExecution, state *cloudAgentRuntime, phase string, submitted, terminal bool, err error) error {
	return s.repo.MutateCloudAgent(run.UserID, run.ID, run.Revision, func(current *model.CloudAgentExecution, _ *repository.Repository) error {
		if state.CallIndex < 0 || state.CallIndex >= len(state.Calls) {
			current.Status = "failed"
			state.event(run.ID, "run_failed", map[string]any{"text": "Agent 媒体调用状态无效，本轮已停止"})
			return cloudAgentSave(current, state)
		}
		if phase == "admission" && !submitted {
			// 工具结果里的原因会脱敏；原始原因只进服务端日志，排查准入失败时以它为准。
			log.Printf("[Agent] media admission rejected run=%s: %v", run.ID, err)
			err = cloudAgentWrapMediaAdmissionError(err)
		}
		toolName := state.Calls[state.CallIndex].Function.Name
		cloudAgentRecordToolResult(current, state, state.Calls[state.CallIndex], map[string]any{"phase": phase, "taskSubmitted": submitted}, err)
		// Any admission failure advances the call into the repair path. Do not let
		// a prepared quote from the failed attempt leak into the corrected call.
		state.AutoPreparedMedia = nil
		state.AutoPreparedCallHash = ""
		if submitted {
			state.MediaTaskID = ""
		}
		// Only explicitly typed argument errors, stale canvas snapshots and known
		// transient admission failures may continue into another model turn. A
		// transient failure is safe here because no billable task was submitted.
		continueAfterAdmissionError := false
		if phase == "admission" && !submitted {
			var argumentErr *cloudAgentArgumentError
			continueAfterAdmissionError = errors.As(err, &argumentErr)
			var admissionErr *cloudAgentMediaAdmissionError
			if errors.As(err, &admissionErr) && (admissionErr.Reason == "snapshot_conflict" || admissionErr.Retryable) {
				continueAfterAdmissionError = true
			}
		}
		if terminal || (phase == "admission" && !submitted && !continueAfterAdmissionError) {
			current.Status = "failed"
			message := "媒体生成准入失败，本轮已停止；请检查模型、能力和预算后由用户明确重试"
			reason := "tool_admission_failed"
			if terminal {
				message = "媒体任务已提交，但结果处理失败；任务不会自动重试"
				reason = "media_task_failed"
			}
			current.FailureMessage = truncateRunes(message, 1000)
			cloudAgentDropInterjections(run.ID, "本轮已结束："+truncateRunes(message, 120), state)
			state.event(run.ID, "run_failed", map[string]any{"text": message, "reason": reason, "toolName": toolName})
		}
		return cloudAgentSave(current, state)
	})
}

func (s *Service) advanceCloudAgentMedia(run *model.CloudAgentExecution, state *cloudAgentRuntime, call cloudAgentCall) error {
	if state.MediaTaskID != "" {
		task, err := s.repo.TaskForUser(run.UserID, state.MediaTaskID)
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return s.cloudAgentMediaError(run, state, "completion", true, true, BadAuthRequest("媒体任务不存在或已失去归属，结果未回写画布"))
		}
		if err != nil {
			return err
		}
		if task.Status == model.TaskStatusQueued || task.Status == model.TaskStatusRunning {
			return nil
		}
		policy, err := s.RuntimePolicy()
		if err != nil {
			return err
		}
		var target struct {
			NodeID string `json:"nodeId"`
		}
		if err := json.Unmarshal([]byte(call.Function.Arguments), &target); err != nil || validateCloudAgentID(target.NodeID, "生成节点ID", 80) != nil {
			return s.cloudAgentMediaError(run, state, "completion", true, true, BadAuthRequest("已提交媒体任务的目标节点记录无效，未回写画布"))
		}
		s.storageMu.Lock()
		defer s.storageMu.Unlock()
		return s.repo.MutateCloudAgent(run.UserID, run.ID, run.Revision, func(current *model.CloudAgentExecution, repo *repository.Repository) error {
			before, readErr := repo.CanvasProjectForUser(run.UserID, state.Request.CanvasID)
			nodeID, writeErr := completeCloudAgentMediaNode(repo, run.UserID, state.Request.CanvasID, target.NodeID, task, policy)
			if writeErr != nil {
				var appErr *AppError
				if !errors.Is(writeErr, gorm.ErrRecordNotFound) && !(errors.As(writeErr, &appErr) && (appErr.Status == 400 || appErr.Status == 409)) {
					return writeErr // Retry persistence, never resubmit the billed generation.
				}
			}
			// A deleted canvas/node must still checkpoint the tool failure. Only
			// a matched node can have changed and require an atomic canvas delta.
			if nodeID != "" {
				if readErr != nil {
					return readErr
				}
				if err := emitCloudAgentCanvasChange(repo, run.ID, state, cloudAgentMutationInput{UserID: run.UserID, CanvasID: state.Request.CanvasID, BeforeJSON: before.PayloadJSON, Operation: "generate_media_complete"}); err != nil {
					return err
				}
			}
			result := map[string]any{"phase": "completion", "taskSubmitted": true, "taskId": task.ID, "nodeId": nodeID, "targetNodeId": target.NodeID, "status": task.Status}
			var toolErr error
			generationMessage := ""
			writebackMessage, writebackReason := "", ""
			if task.Status != model.TaskStatusSucceeded {
				generationMessage = truncateRunes(cloudAgentSafeMediaTaskError(task), 90)
				if !cloudAgentSafeUserMessage(generationMessage) {
					generationMessage = "媒体任务未成功"
				}
				result["generationError"] = generationMessage
				toolErr = BadAuthRequest("媒体任务未成功：" + generationMessage + "；请在任务中心查看任务详情，不会自动重试收费生成")
				result["summary"] = "媒体任务未成功；任务记录保留在任务中心"
			}
			if writeErr != nil {
				writebackMessage = truncateRunes(cloudAgentSafeToolError(writeErr), 60)
				writebackReason = "canvas_writeback_failed"
				var writeback *cloudAgentMediaWritebackError
				if errors.As(writeErr, &writeback) {
					writebackReason = writeback.reason
				}
				result["writebackError"], result["writebackReason"] = writebackMessage, writebackReason
				message := "媒体任务已成功，但画布回写未完成：" + writebackMessage
				if generationMessage != "" {
					message = "媒体任务未成功：" + generationMessage + "；任务状态也未回写画布：" + writebackMessage
				}
				toolErr = BadAuthRequest(message + "。请在任务中心查看详情，不会自动重试收费生成")
				result["summary"] = "画布回写未完成；任务记录保留在任务中心"
			}
			if task.Status == model.TaskStatusSucceeded && writeErr == nil {
				// Completion writes the generated asset into the canvas. Invalidate
				// the same-run snapshot cache just like ordinary canvas writes.
				cloudAgentInvalidateReadCache(state)
				result["summary"] = "生成结果已回写画布节点"
			}
			if writeErr != nil {
				recordTaskWritebackDiagnostic(task, target.NodeID, "failed", writebackReason, writeErr)
			} else {
				recordTaskWritebackDiagnostic(task, target.NodeID, "succeeded", "", nil)
			}
			if err := repo.UpdateTaskExecutionDiagnostic(run.UserID, task.ID, task.ExecutionDiagnosticJSON); err != nil {
				return err
			}
			// A billed generation failure is a tool result, not a dead run: the
			// model must still be able to tell the user what happened. Only a
			// canvas write that cannot land is terminal for the whole turn.
			if writeErr != nil {
				if current.Status != "cancelled" {
					current.Status = "failed"
				}
				current.FailureMessage = cloudAgentSafeToolError(toolErr)
				state.event(run.ID, "run_failed", map[string]any{
					"text": current.FailureMessage, "taskId": task.ID, "nodeId": target.NodeID,
					"reason": result["writebackReason"], "generationStatus": task.Status,
					"generationError": generationMessage, "writebackError": result["writebackError"],
				})
			}
			cloudAgentToolResult(run.ID, state, call, result, toolErr)
			state.MediaTaskID = ""
			return cloudAgentSave(current, state)
		})
	}
	req, plan, err := s.prepareCloudAgentMedia(run, state, call)
	if err != nil {
		return s.cloudAgentMediaError(run, state, "admission", false, false, err)
	}
	return s.enqueueCloudAgentTask(run, state, req, plan)
}

func (s *Service) DecideCloudAgentApproval(userID, id, approvalID, decision, reason string, mediaSettings ...*CloudAgentMediaSettings) error {
	// Resource leases are a protection mechanism only. Expiry cleanup is safe to
	// run on the control-plane path and never changes the approval decision.
	if err := s.repo.ReleaseExpiredCloudAgentResourceLeases(time.Now().UTC()); err != nil {
		return err
	}
	var settings *CloudAgentMediaSettings
	if len(mediaSettings) > 1 {
		return BadAuthRequest("只能提交一组生成参数")
	}
	if len(mediaSettings) == 1 {
		settings = mediaSettings[0]
	}
	if settings != nil && decision != "approve" {
		return BadAuthRequest("仅批准生成时可修改生成参数")
	}
	if decision != "approve" && decision != "reject" {
		return BadAuthRequest("无效审批决定")
	}
	if len(reason) > 2000 {
		return BadAuthRequest("审批理由过长")
	}
	if _, _, err := s.cloudAgentTask(userID, id); err != nil {
		return err
	}
	run, err := s.repo.CloudAgent(userID, id)
	if err != nil {
		return err
	}
	state, err := cloudAgentDecodeForExecution(run)
	if err != nil {
		return err
	}
	if previous, ok := state.Decisions[approvalID]; ok {
		if previous == decision && (settings == nil || state.DecisionSettings[approvalID] == creationHash(settings)) {
			return nil
		}
		return cloudAgentDecisionConflict(previous)
	}
	if run.Status != "waiting_approval" || state.Approval == nil || state.Approval.ID != approvalID {
		return creationConflict("审批不存在或已过期")
	}
	// 只在记录审批决定的这次写入期间持锁：随后的工具执行（advanceCloudAgentTool）
	// 会自己获取 storageMu，持锁到函数返回会造成自锁。旧 Pi 会话退出前仍可能
	// 写入最后一个事件，因此审批决定采用重读后 CAS 重试。
	for attempt := 0; attempt < 8; attempt++ {
		if attempt > 0 {
			time.Sleep(time.Duration(attempt) * 20 * time.Millisecond)
			run, err = s.repo.CloudAgent(userID, id)
			if err != nil {
				return err
			}
			state, err = cloudAgentDecodeForExecution(run)
			if err != nil {
				return err
			}
			if previous, ok := state.Decisions[approvalID]; ok {
				if previous == decision && (settings == nil || state.DecisionSettings[approvalID] == creationHash(settings)) {
					return nil
				}
				return cloudAgentDecisionConflict(previous)
			}
			if run.Status != "waiting_approval" || state.Approval == nil || state.Approval.ID != approvalID {
				return creationConflict("审批不存在或已过期")
			}
		}
		s.storageMu.Lock()
		err = s.repo.MutateCloudAgent(userID, id, run.Revision, func(current *model.CloudAgentExecution, repo *repository.Repository) error {
			if settings != nil {
				if err := s.updateCloudAgentMediaApproval(repo, run, &state, *settings); err != nil {
					return err
				}
			}
			state.Approval.Decision = decision
			state.Approval.Reason = reason
			state.Decisions[approvalID] = decision
			if settings != nil {
				if state.DecisionSettings == nil {
					state.DecisionSettings = map[string]string{}
				}
				state.DecisionSettings[approvalID] = creationHash(settings)
			}
			if decision == "approve" && state.Approval.Prepared != nil {
				if state.DecisionPreparedHashes == nil {
					state.DecisionPreparedHashes = map[string]string{}
				}
				state.DecisionPreparedHashes[approvalID] = state.Approval.Prepared.Hash
			}
			if decision == "reject" {
				// Rejection is a user control-plane decision, not a failed tool
				// invocation. Make it terminal before the scheduler can advance the
				// pending call; no tool result, canvas mutation, generation task or
				// follow-up model request may be produced from this decision.
				current.Status = "rejected"
				current.FailureMessage = ""
				state.Approval = nil
				cloudAgentDropInterjections(id, "本轮已结束：已拒绝本次生成", &state)
				state.event(id, "approval_decided", map[string]any{
					"approvalId": approvalID,
					"decision":   decision,
					"reason":     reason,
					"text":       "已拒绝本次生成，草稿节点仍保留在画布中；未提交任务、未产生扣费。你可以继续编辑后重新申请。",
				})
				if err := repo.ReleaseCloudAgentResourceLeases(userID, approvalID); err != nil {
					return err
				}
				return cloudAgentSave(current, &state)
			}
			current.Status = "running"
			payload := map[string]any{"approvalId": approvalID, "decision": decision, "arguments": json.RawMessage(state.Approval.Call.Function.Arguments), "preview": state.Approval.Preview, "modelName": state.Approval.ModelName}
			if state.Approval.Prepared != nil {
				payload["preparedHash"] = state.Approval.Prepared.Hash
				payload["generationId"] = state.Approval.Prepared.GenerationID
			}
			state.event(id, "approval_decided", payload)
			return cloudAgentSave(current, &state)
		})
		s.storageMu.Unlock()
		if !errors.Is(err, repository.ErrCreationConflict) {
			break
		}
	}
	if err != nil || decision != "approve" {
		return err
	}
	// Approval only releases the paused tool. Execute it once in the Go business
	// executor, then give the durable result back to Pi; Go never asks a model
	// what to do next.
	var mediaTaskID string
	for attempt := 0; attempt < 8; attempt++ {
		if attempt > 0 {
			time.Sleep(time.Duration(attempt) * 20 * time.Millisecond)
		}
		latest, err := s.repo.CloudAgent(userID, id)
		if err != nil {
			return err
		}
		state, err = cloudAgentDecode(latest)
		if err != nil {
			return err
		}
		err = s.advanceCloudAgentTool(latest, &state)
		if !errors.Is(err, repository.ErrCreationConflict) {
			if err != nil {
				return err
			}
			mediaTaskID = state.MediaTaskID
			break
		}
		if attempt == 7 {
			return err
		}
	}
	if mediaTaskID == "" {
		return s.resumeCloudAgentAfterApproval(userID, id, &state)
	}
	// 媒体生成可能要几分钟：审批请求立即返回，等待与回写在后台完成后再恢复运行。
	s.startApprovedCloudAgentMediaWaiter(userID, id, mediaTaskID)
	return nil
}

func (s *Service) finishApprovedCloudAgentMedia(ctx context.Context, userID, id, mediaTaskID string) error {
	mediaTask, err := s.waitCloudAgentTask(ctx, mediaTaskID)
	if err != nil && ctx.Err() != nil {
		// 服务停机或等待被取消：不能继续回写和恢复运行时，否则正在排空的进程会重新拉起 Agent。
		// MediaTaskID 仍保留在运行状态里，重启后 recoverCloudAgentPiRunners 会重新挂上等待。
		return ctx.Err()
	}
	if mediaTask == nil {
		// 失败的任务也要回写（记录工具失败并释放 MediaTaskID）；只有读不到任务才中止。
		if mediaTask, err = s.repo.Task(mediaTaskID); err != nil {
			return err
		}
	}
	if err = s.settleCloudAgentMedia(userID, id); err != nil {
		return err
	}
	latest, err := s.repo.CloudAgent(userID, id)
	if err != nil {
		return err
	}
	state, err := cloudAgentDecode(latest)
	if err != nil {
		return err
	}
	if mediaTask.Status != model.TaskStatusSucceeded {
		state.PiResumePrompt = "用户已批准该操作，但媒体任务未成功完成。请根据工具结果告知用户，不要重复提交该操作。"
	}
	return s.resumeCloudAgentAfterApproval(userID, id, &state)
}

// cloudAgentApprovalResumePrompt 构造审批恢复后的续跑提示。
//
// 线上评测（run ag7317ce5c seq 28→31）暴露的关键缺口：审批等待期间，模型历史里该调用
// 停留在「操作正在等待用户审批」占位上；批准后执行器虽已写入并追加了真实结果，但恢复
// 提示只有一句"已执行一次"——模型看不到结果里的新 snapshotHash / 节点状态，只会合理地
// 重发同参数调用，随后撞上自己第一次执行改变的快照（state_conflict）。把执行结果摘要
// 直接装进恢复提示，模型就有了继续操作所需的最新状态；同批排在审批之后被中止的调用也
// 一并说明，避免恢复后发出空回合。
func cloudAgentApprovalResumePrompt(state *cloudAgentRuntime) string {
	if receipt, ok := cloudAgentLastToolReceipt(state); ok {
		prompt := "用户已批准刚才等待审批的操作，已执行完成，结果如下：\n" + receipt +
			"\n该操作不要重复调用。结果里是目标对象的最新状态（含 snapshotHash）；继续写同一对象必须基于它，否则会因快照过期被拒绝。"
		if state.CallIndex < len(state.Calls) {
			prompt += " 你上一步同批发出的其余调用未被执行（每个审批周期只放行一个操作），仍需要请重发。"
		}
		return prompt
	}
	return "用户已批准刚才等待审批的操作。业务执行器已执行一次；请根据最新工具结果继续，不要重复调用该操作。"
}

// cloudAgentLastToolReceipt 取 canonical 历史末尾最近一条工具结果的可读摘要。
// 批准执行完成后它就是被批准调用的真实结果；拿不到时返回 false，调用方回退通用提示。
func cloudAgentLastToolReceipt(state *cloudAgentRuntime) (string, bool) {
	if state == nil {
		return "", false
	}
	for i := len(state.Canonical.Messages) - 1; i >= 0; i-- {
		message := state.Canonical.Messages[i]
		if stringField(message, "role") != "tool" {
			return "", false
		}
		content := strings.TrimSpace(stringField(message, "content"))
		if content == "" {
			continue
		}
		if cloudAgentToolContentIsError(content) {
			return "", false
		}
		if utf8.RuneCountInString(content) > 1600 {
			content = truncateRunes(content, 1600) + "…（已截断；完整状态请用读取工具获取）"
		}
		return content, true
	}
	return "", false
}

func (s *Service) resumeCloudAgentAfterApproval(userID, id string, state *cloudAgentRuntime) error {
	if state.PiResumePrompt == "" {
		state.PiResumePrompt = cloudAgentApprovalResumePrompt(state)
	}
	if err := s.saveCloudAgentPiResumePrompt(userID, id, state.PiResumePrompt); err != nil {
		return err
	}
	s.resumeCloudAgentPi(userID, id)
	return nil
}

// saveCloudAgentPiResumePrompt 只合并恢复提示词，不覆盖其它并发写入的字段。
func (s *Service) saveCloudAgentPiResumePrompt(userID, id, prompt string) error {
	for attempt := 0; attempt < 8; attempt++ {
		run, err := s.repo.CloudAgent(userID, id)
		if err != nil {
			return err
		}
		err = s.repo.MutateCloudAgent(userID, id, run.Revision, func(current *model.CloudAgentExecution, _ *repository.Repository) error {
			fresh, err := cloudAgentDecode(current)
			if err != nil {
				return err
			}
			fresh.PiResumePrompt = prompt
			return cloudAgentSave(current, &fresh)
		})
		if !errors.Is(err, repository.ErrCreationConflict) {
			return err
		}
	}
	return repository.ErrCreationConflict
}

func (s *Service) CancelCloudAgent(ctx context.Context, userID, id string) error {
	// Cancellation is a control-plane operation. It must remain available even
	// when the user-facing runtime blob is damaged, so authenticate/authorize
	// from the task row first instead of calling CloudAgentRun up front.
	task, err := s.repo.TaskForUser(userID, id)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return kernel.NotFound("Agent 运行不存在")
		}
		return err
	}
	if task.Operation != cloudAgentOperation {
		return kernel.NotFound("Agent 运行不存在")
	}
	s.stopCloudAgentPi(id)
	run, err := s.repo.CloudAgent(userID, id)
	if errors.Is(err, gorm.ErrRecordNotFound) {
		// Legacy root tasks may not have an execution row yet. The normal read
		// path validates the signed/deterministic task identity before creating it.
		if _, err = s.CloudAgentRun(userID, id); err != nil {
			return err
		}
		run, err = s.repo.CloudAgent(userID, id)
	}
	if err != nil {
		return err
	}
	if run.Status == "completed" || (run.Status == "failed" && !run.CleanupPending) {
		return nil
	}
	// 取消是用户操作，不能因为运行时正在并发写事件就失败：冲突时重读最新 revision 重试。
	for attempt := 0; run.Status != "failed" && attempt < 8; attempt++ {
		if attempt > 0 {
			time.Sleep(time.Duration(attempt) * 20 * time.Millisecond)
			if run, err = s.repo.CloudAgent(userID, id); err != nil {
				return err
			}
			if run.Status == "completed" || (run.Status == "failed" && !run.CleanupPending) {
				return nil
			}
		}
		// Persist intent independently of the transcript. Retrying also repairs
		// legacy cancelled rows that crashed before cancelling their children.
		state, decodeErr := cloudAgentDecode(run)
		err = s.repo.MutateCloudAgent(userID, id, run.Revision, func(current *model.CloudAgentExecution, _ *repository.Repository) error {
			firstCancellation := current.Status != "cancelled"
			current.Status = "cancelled"
			current.CleanupPending = true
			if decodeErr == nil {
				current.CanvasID, current.ActiveTaskID, current.MediaTaskID = state.Request.CanvasID, state.ActiveTaskID, state.MediaTaskID
				if firstCancellation {
					state.event(id, "run_cancelled", map[string]any{"source": "user_request", "activeTaskId": state.ActiveTaskID, "mediaTaskId": state.MediaTaskID, "text": "用户取消接口已接收请求，正在取消关联任务"})
					cloudAgentDropInterjections(id, "本轮已结束：用户已取消本轮", &state)
					if saveErr := cloudAgentSave(current, &state); saveErr != nil {
						// Cancellation must still work if the transcript is oversized.
						log.Printf("[cloud-agent] cancellation event unavailable for run %s: checkpoint rejected", id)
					}
				}
			} else {
				log.Printf("[cloud-agent] cancellation event unavailable for run %s: invalid transcript", id)
			}
			return nil
		})
		if errors.Is(err, repository.ErrCreationConflict) {
			continue
		}
		if err != nil {
			return err
		}
		break
	}
	if errors.Is(err, repository.ErrCreationConflict) {
		return err
	}
	latest, err := s.repo.CloudAgent(userID, id)
	if err != nil {
		return err
	}
	return s.finishCloudAgentCleanup(ctx, latest)
}
