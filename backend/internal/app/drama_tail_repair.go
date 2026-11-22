package app

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"time"

	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"
)

const (
	dramaTailRepairInterval = 5 * time.Second
	dramaTailIdleInterval   = time.Minute
)

func (s *Service) wakeDramaTailRepairs() {
	if s.dramaTailRepairWake == nil {
		return
	}
	select {
	case s.dramaTailRepairWake <- struct{}{}:
	default:
	}
}

func (s *Service) startDramaTailRepairs() {
	s.runWorkerLoop(func(ctx context.Context) {
		timer := time.NewTimer(0)
		defer timer.Stop()
		var nextCleanup time.Time
		for {
			select {
			case <-ctx.Done():
				return
			case <-timer.C:
			case <-s.dramaTailRepairWake:
			}
			delay := dramaTailIdleInterval
			if !s.IsDraining() {
				if now := time.Now(); !now.Before(nextCleanup) {
					s.cleanupDramaTailFiles(now)
					nextCleanup = now.Add(dramaTailIdleInterval)
				}
				processed, err := s.repairSavedDramaTails(ctx)
				if err != nil && ctx.Err() == nil {
					slog.Warn("drama tail repair failed", "error", err)
				} else if processed {
					delay = dramaTailRepairInterval
				}
			}
			timer.Reset(delay)
		}
	})
}

func (s *Service) repairSavedDramaTails(ctx context.Context) (bool, error) {
	jobs, err := s.repo.DramaTailRepairJobs(ctx)
	if err != nil || len(jobs) == 0 {
		return false, err
	}
	release, acquired, err := s.coordinator.Acquire(ctx, "drama-tail-repair", 1, dramaTailLeaseTTL)
	if err != nil || !acquired {
		return false, err
	}
	defer release()
	for _, job := range jobs {
		processed, err := s.repairSavedDramaTail(ctx, job)
		if err != nil || processed {
			return processed, err
		}
	}
	return false, nil
}

func dramaTailRepairMatches(segment model.DramaSegment, payload dramaRevisionPayload, task *model.Task, userID string) bool {
	return segment.VideoStatus == model.DramaMediaFailed && segment.TailFrameResourceID == "" && segment.VideoResourceID != "" &&
		segment.Revision == payload.Revision && task.Status == model.TaskStatusSucceeded && task.UserID == userID &&
		task.ProjectID == segment.ProjectID && dramaTaskResource(task) == segment.VideoResourceID
}

func (s *Service) repairSavedDramaTail(ctx context.Context, job model.DramaJob) (bool, error) {
	segment, err := s.repo.DramaSegment(job.ProjectID, job.ShotID)
	if err != nil {
		return false, err
	}
	task, err := s.repo.Task(job.TaskID)
	if err != nil {
		return false, err
	}
	production, err := s.repo.DramaProduction(job.ProjectID)
	if err != nil {
		return false, err
	}
	var payload dramaRevisionPayload
	if err := json.Unmarshal([]byte(job.PayloadJSON), &payload); err != nil {
		slog.Warn("drama tail repair payload invalid", "jobId", job.ID)
		return false, nil
	}
	if !dramaTailRepairMatches(*segment, payload, task, production.UserID) {
		payload.TailRepair = repository.DramaTailRepairFinished
		data, _ := json.Marshal(payload)
		return false, s.repo.DiscardDramaTailRepair(job, string(data))
	}
	if !s.dramaTails.claim(segment.VideoResourceID) {
		return false, nil
	}
	defer s.dramaTails.finish(segment.VideoResourceID, nil)
	release, acquired := s.acquireDramaTailLease(segment.VideoResourceID)
	if !acquired {
		return false, nil
	}
	defer release()
	if payload.TailRepair != repository.DramaTailRepairPending {
		payload.TailRepair = repository.DramaTailRepairPending
		data, _ := json.Marshal(payload)
		queued, err := s.repo.QueueDramaTailRepair(job, *segment, string(data))
		if err != nil || !queued {
			return false, err
		}
		job.PayloadJSON = string(data)
	}
	tail, err := s.extractDramaTailFrame(withTaskExecutionID(ctx, task.ID), production.UserID, segment.VideoResourceID)
	if ctx.Err() != nil {
		return false, ctx.Err()
	}
	reason := ""
	if err != nil {
		var readErr *dramaVideoReadError
		reason = "提取尾帧失败，请重新处理视频"
		if errors.As(err, &readErr) {
			reason = readErr.Error()
		}
	}
	payload.TailRepair = repository.DramaTailRepairFinished
	data, _ := json.Marshal(payload)
	finished, saveErr := s.repo.FinishDramaTailRepair(job, *segment, string(data), tail, reason)
	if saveErr != nil {
		return false, saveErr
	}
	if !finished {
		return true, s.repo.DiscardDramaTailRepair(job, string(data))
	}
	slog.Info("drama tail repair finished", "jobId", job.ID, "taskId", task.ID, "resourceId", segment.VideoResourceID, "success", tail != "")
	return true, nil
}
