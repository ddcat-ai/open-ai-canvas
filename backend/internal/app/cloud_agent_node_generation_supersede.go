package app

import (
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"strings"
	"time"

	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"
)

// cloudAgentApprovalSuperseded 是审批的第三种决定：用户没有点 Agent 卡片里的
// “同意/拒绝”，而是直接在画布节点上提交了同一节点的生成。Agent 不再提交自己的
// 任务、不扣费，也不接管该任务的结果回写（画布自己的生成链路负责回写）。
const cloudAgentApprovalSuperseded = "superseded_by_node"

// cloudAgentDecisionConflict 给重复/冲突的审批决定一个用户能看懂的原因。
func cloudAgentDecisionConflict(previous string) error {
	if previous == cloudAgentApprovalSuperseded {
		return creationConflict("你已在画布节点上直接生成，本次审批已自动关闭")
	}
	return creationConflict("该审批已有不同决定")
}

// supersedeCloudAgentApprovalsForNodeTask 在普通画布生成任务创建成功后调用：
// 如果同一画布上有 Agent 正在等待对同一节点的 generate_media 审批，就把该审批
// 关闭为 superseded_by_node，并让 Agent 带着“用户已手动提交”的工具结果继续。
//
// 这是尽力而为的联动：任何失败只记日志，不影响用户已经创建成功的任务。
func (s *Service) supersedeCloudAgentApprovalsForNodeTask(userID string, task *model.Task, input map[string]any) {
	if s == nil || s.repo == nil || task == nil || task.AgentRunID != "" || strings.TrimSpace(task.ProjectID) == "" {
		return
	}
	metadata, _ := input["metadata"].(map[string]any)
	nodeID := strings.TrimSpace(stringValue(metadata["nodeId"]))
	if nodeID == "" || stringValue(metadata["source"]) == "cloud_agent" {
		return
	}
	// 批量图片等场景结果落在新节点上，sourceNodeId 才是用户点击生成的节点。
	nodeIDs := []string{nodeID}
	if source := strings.TrimSpace(stringValue(metadata["sourceNodeId"])); source != "" && source != nodeID {
		nodeIDs = append(nodeIDs, source)
	}
	runIDs, err := s.repo.CloudAgentIDsWaitingApprovalForCanvas(userID, task.ProjectID)
	if err != nil {
		slog.Warn("agent approval supersede lookup failed", "canvas", task.ProjectID, "task", task.ID, "error", err)
		return
	}
	for _, runID := range runIDs {
		target, err := s.supersedeCloudAgentApproval(userID, runID, nodeIDs, task)
		if err != nil {
			slog.Warn("agent approval supersede failed", "run", runID, "task", task.ID, "error", err)
			continue
		}
		if target != "" {
			s.resumeCloudAgentAfterSupersede(userID, runID, target, task.ID)
		}
	}
}

// cloudAgentApprovalTargetNode 返回待审批 generate_media 调用的目标节点。
// 其他工具（批量、删除、计划等）不参与联动。
func cloudAgentApprovalTargetNode(approval *cloudAgentApproval) (string, bool) {
	if approval == nil || approval.Decision != "" || approval.Call.Function.Name != "generate_media" {
		return "", false
	}
	var args struct {
		NodeID string `json:"nodeId"`
	}
	if err := json.Unmarshal([]byte(approval.Call.Function.Arguments), &args); err != nil {
		return "", false
	}
	nodeID := strings.TrimSpace(args.NodeID)
	return nodeID, nodeID != ""
}

// supersedeCloudAgentApproval 返回被关闭审批的目标节点；不匹配时返回空串。
// 与 DecideCloudAgentApproval 一样按 revision CAS 重试：两边同时点击时先落库者生效，
// 后到的一方看到状态已变化直接退出，不会重复提交任务。
func (s *Service) supersedeCloudAgentApproval(userID, runID string, nodeIDs []string, task *model.Task) (string, error) {
	for attempt := 0; attempt < 8; attempt++ {
		if attempt > 0 {
			time.Sleep(time.Duration(attempt) * 20 * time.Millisecond)
		}
		run, err := s.repo.CloudAgent(userID, runID)
		if err != nil {
			return "", err
		}
		if run.Status != "waiting_approval" {
			return "", nil
		}
		state, err := cloudAgentDecodeForExecution(run)
		if err != nil {
			return "", err
		}
		target, ok := cloudAgentApprovalTargetNode(state.Approval)
		if !ok || !cloudAgentContainsString(nodeIDs, target) || state.CallIndex >= len(state.Calls) {
			return "", nil
		}
		approvalID := state.Approval.ID
		if _, decided := state.Decisions[approvalID]; decided {
			return "", nil
		}
		call := state.Calls[state.CallIndex]
		s.storageMu.Lock()
		err = s.repo.MutateCloudAgent(userID, runID, run.Revision, func(current *model.CloudAgentExecution, repo *repository.Repository) error {
			applyCloudAgentApprovalSupersede(current, &state, call, approvalID, target, task.ID)
			if err := repo.ReleaseCloudAgentResourceLeases(userID, approvalID); err != nil {
				return err
			}
			return cloudAgentSave(current, &state)
		})
		s.storageMu.Unlock()
		if errors.Is(err, repository.ErrCreationConflict) {
			continue
		}
		if err != nil {
			return "", err
		}
		return target, nil
	}
	return "", repository.ErrCreationConflict
}

// applyCloudAgentApprovalSupersede 在同一个检查点里记录决定、关闭审批，并把
// “用户已手动提交”作为本次工具调用的结果写入历史（同时推进到下一个调用）。
func applyCloudAgentApprovalSupersede(current *model.CloudAgentExecution, state *cloudAgentRuntime, call cloudAgentCall, approvalID, nodeID, taskID string) {
	state.Decisions[approvalID] = cloudAgentApprovalSuperseded
	state.Approval = nil
	state.event(current.ID, "approval_decided", map[string]any{
		"approvalId": approvalID,
		"decision":   cloudAgentApprovalSuperseded,
		"nodeId":     nodeID,
		"taskId":     taskID,
		"text":       "你已在画布节点上直接提交了生成，本次审批已自动关闭；Agent 不会重复提交或扣费，结果由画布回写。",
	})
	cloudAgentRecordToolResult(current, state, call, map[string]any{
		"status":        "superseded_by_user",
		"taskSubmitted": false,
		"nodeId":        nodeID,
		"userTaskId":    taskID,
		"summary":       fmt.Sprintf("用户已在画布节点 %s 上直接提交该生成（taskId=%s）。Agent 未提交任务、未扣费；不要再为该节点调用 generate_media，结果由画布自动回写。", nodeID, taskID),
	}, nil)
	if current.Status == "waiting_approval" {
		current.Status = "running"
	}
}

func (s *Service) resumeCloudAgentAfterSupersede(userID, runID, nodeID, taskID string) {
	prompt := fmt.Sprintf("用户没有使用审批卡片，而是直接在画布节点 %s 上提交了刚才等待审批的生成（taskId=%s）。该调用已记录为用户手动提交：Agent 没有提交任务、没有扣费，生成结果由画布回写。请继续剩余步骤，不要再次为该节点调用 generate_media。", nodeID, taskID)
	if err := s.saveCloudAgentPiResumePrompt(userID, runID, prompt); err != nil {
		slog.Warn("agent approval supersede resume prompt failed", "run", runID, "error", err)
		return
	}
	s.resumeCloudAgentPi(userID, runID)
}
