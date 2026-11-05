package app

import (
	"errors"
	"log"
	"time"

	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"
)

// 批准审批后的收尾：执行被批准的调用一次，再把结果交回 Pi 恢复运行。
//
// 决定一落库运行就回到 running，被批准的调用要等收尾才执行。这段间隙里任何 Pi 会话
// （3 秒一次的恢复扫描、幂等重放的创建请求）都不能直接开一轮模型：恢复提示还没写入，
// 会用原始提示词把用户请求重跑一遍并重复计费，还会和收尾争写同一个检查点，最后以
// “审批内容与待执行操作不一致”或检查点校验失败结束本轮。
//
// 收尾平时由决定审批的请求同步完成。请求在决定落库后失败、或进程在两者之间重启时，
// 下一个启动的 Pi 会话发现调用仍待执行，就改为在后台接手收尾。approvalFollowUps
// 保证同一审批在本进程里只有一个收尾方。

func cloudAgentApprovalFollowUpKey(runID, approvalID string) string {
	return runID + ":" + approvalID
}

// cloudAgentApprovedCallPending 判断审批已批准，但被批准的调用还没执行、也还没提交媒体任务
// 或启动批量生成。approvalID 为空时匹配当前任意审批。
func cloudAgentApprovedCallPending(run *model.CloudAgentExecution, state *cloudAgentRuntime, approvalID string) bool {
	if run == nil || state == nil || state.Approval == nil || state.Approval.Decision != "approve" || state.MediaTaskID != "" || cloudAgentMediaBatchActive(state) {
		return false
	}
	if approvalID != "" && state.Approval.ID != approvalID {
		return false
	}
	return run.Status == "running" || run.Status == "queued"
}

// claimCloudAgentApprovalFollowUp 登记由调用方负责收尾；已有负责方时返回 false。
func (s *Service) claimCloudAgentApprovalFollowUp(key string) bool {
	s.approvalFollowUpMu.Lock()
	defer s.approvalFollowUpMu.Unlock()
	return s.claimCloudAgentApprovalFollowUpLocked(key)
}

func (s *Service) claimCloudAgentApprovalFollowUpLocked(key string) bool {
	if _, exists := s.approvalFollowUps[key]; exists {
		return false
	}
	if s.approvalFollowUps == nil {
		s.approvalFollowUps = make(map[string]struct{})
	}
	s.approvalFollowUps[key] = struct{}{}
	return true
}

func (s *Service) releaseCloudAgentApprovalFollowUp(key string) {
	s.approvalFollowUpMu.Lock()
	delete(s.approvalFollowUps, key)
	s.approvalFollowUpMu.Unlock()
}

// startCloudAgentApprovalFollowUp 在后台接手没有负责方的收尾。收尾失败时结束本轮并写明原因，
// 不让运行一直停在 running。
func (s *Service) startCloudAgentApprovalFollowUp(userID, runID, approvalID string) {
	if s == nil || runID == "" || approvalID == "" {
		return
	}
	key := cloudAgentApprovalFollowUpKey(runID, approvalID)
	s.approvalFollowUpMu.Lock()
	if s.approvalFollowUpClosed || !s.claimCloudAgentApprovalFollowUpLocked(key) {
		s.approvalFollowUpMu.Unlock()
		return
	}
	s.approvalFollowUpWg.Add(1)
	s.approvalFollowUpMu.Unlock()

	go func() {
		defer s.approvalFollowUpWg.Done()
		defer s.releaseCloudAgentApprovalFollowUp(key)
		if err := s.continueApprovedCloudAgentCall(userID, runID, approvalID); err != nil {
			log.Printf("[Agent] approval follow-up failed run=%s: %v", runID, err)
			s.failPiRunner(runID, userID, errors.New(cloudAgentUserFailureMessage(runID, err)))
		}
	}()
}

// closeCloudAgentApprovalFollowUps 停止接手新的收尾，并等进行中的收尾写完检查点。
// 未执行的审批留在库里，下次启动后由新的 Pi 会话接手。
func (s *Service) closeCloudAgentApprovalFollowUps() {
	if s == nil {
		return
	}
	s.approvalFollowUpMu.Lock()
	s.approvalFollowUpClosed = true
	s.approvalFollowUpMu.Unlock()
	s.approvalFollowUpWg.Wait()
}

// continueApprovedCloudAgentCall 执行已批准的调用一次，再把结果交回 Pi。
// 每次尝试前都确认调用仍待执行：另一方已经执行过时直接返回，
// 不会把同批的下一个调用当成本次审批再执行一次。
func (s *Service) continueApprovedCloudAgentCall(userID, id, approvalID string) error {
	// Approval only releases the paused tool. Execute it once in the Go business
	// executor, then give the durable result back to Pi; Go never asks a model
	// what to do next.
	var mediaTaskID string
	batchActive := false
	for attempt := 0; attempt < 8; attempt++ {
		if attempt > 0 {
			time.Sleep(time.Duration(attempt) * 20 * time.Millisecond)
		}
		latest, err := s.repo.CloudAgent(userID, id)
		if err != nil {
			return err
		}
		state, err := cloudAgentDecode(latest)
		if err != nil {
			return err
		}
		if !cloudAgentApprovedCallPending(latest, &state, approvalID) {
			return nil
		}
		err = s.advanceCloudAgentTool(latest, &state)
		if !errors.Is(err, repository.ErrCreationConflict) {
			if err != nil {
				return err
			}
			mediaTaskID = state.MediaTaskID
			batchActive = cloudAgentMediaBatchActive(&state)
			break
		}
		if attempt == 7 {
			return err
		}
	}
	if batchActive {
		// 批次可能要跑几十分钟：审批请求立即返回，提交、回写与恢复都由后台执行器完成。
		s.startCloudAgentMediaBatchRunner(userID, id)
		return nil
	}
	if mediaTaskID == "" {
		// 提交前失败可能记录在重读后的状态上（见 enqueueCloudAgentTask 的回滚分支），
		// 恢复提示必须基于最新历史，否则会把同批上一个工具的结果当成本次审批的回执。
		latest, err := s.repo.CloudAgent(userID, id)
		if err != nil {
			return err
		}
		state, err := cloudAgentDecode(latest)
		if err != nil {
			return err
		}
		return s.resumeCloudAgentAfterApproval(userID, id, &state)
	}
	// 媒体生成可能要几分钟：审批请求立即返回，等待与回写在后台完成后再恢复运行。
	s.startApprovedCloudAgentMediaWaiter(userID, id, mediaTaskID)
	return nil
}
