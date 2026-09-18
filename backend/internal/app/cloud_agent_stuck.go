package app

import (
	"errors"
	"fmt"
	"log"
	"time"

	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/repository"
)

const cloudAgentStuckAfter = 5 * time.Minute
const cloudAgentConflictLogThreshold = 15

func (s *Service) terminateStuckCloudAgent(run *model.CloudAgentExecution) bool {
	if run == nil || run.CleanupPending || (run.Status != "running" && run.Status != "queued") {
		return false
	}
	state, err := cloudAgentDecode(run)
	if err != nil {
		return false
	}
	if s.cloudAgentHasLiveWork(run, &state) {
		return false
	}
	last := cloudAgentLastEventAt(&state)
	if last.IsZero() || time.Since(last) < cloudAgentStuckAfter {
		return false
	}
	idle := time.Since(last)
	if err := s.terminateCloudAgent(run, fmt.Sprintf("运行已 %.0f 分钟没有任何进展（既没有新事件、也没有在跑的任务），已判定为卡住并停止；可以重新发起", idle.Minutes())); err != nil {
		if !errors.Is(err, repository.ErrCreationConflict) {
			log.Printf("agent stuck cleanup %s: %v", run.ID, err)
		}
		return false
	}
	log.Printf("agent scheduler: run=%s 判定卡死并收尾（最后一条事件在 %.0f 分钟前）", run.ID, idle.Minutes())
	return true
}

func (s *Service) cloudAgentHasLiveWork(run *model.CloudAgentExecution, state *cloudAgentRuntime) bool {
	for _, taskID := range []string{state.ActiveTaskID, state.MediaTaskID, state.StoryboardTaskID} {
		if taskID == "" {
			continue
		}
		task, err := s.repo.TaskForUser(run.UserID, taskID)
		if err != nil {
			return true
		}
		if task.Status == model.TaskStatusQueued || task.Status == model.TaskStatusRunning {
			return true
		}
	}
	return false
}

func cloudAgentLastEventAt(state *cloudAgentRuntime) time.Time {
	if state == nil || len(state.Events) == 0 {
		return time.Time{}
	}
	return state.Events[len(state.Events)-1].CreatedAt
}

func (s *Service) noteCloudAgentSchedulerConflict(runID string) {
	if s.agentConflictStreak == nil {
		s.agentConflictStreak = map[string]int{}
	}
	s.agentConflictStreak[runID]++
	if streak := s.agentConflictStreak[runID]; streak == cloudAgentConflictLogThreshold {
		log.Printf("agent scheduler: run=%s 连续 %d 次 CAS 冲突（另有写者持续占用该行），这一轮很可能卡住了", runID, streak)
	}
}

func (s *Service) clearCloudAgentSchedulerConflict(runID string) {
	if s.agentConflictStreak == nil {
		return
	}
	delete(s.agentConflictStreak, runID)
}
