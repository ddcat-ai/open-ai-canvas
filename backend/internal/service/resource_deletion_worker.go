package service

import (
	"log"
	"math"
	"time"

	"infinite-canvas/backend/internal/model"
)

const resourceDeletionLease = 2 * time.Minute

func (s *Service) startResourceDeletionWorker() {
	go func() {
		s.drainResourceDeletionJobs(32)
		s.cleanupStaleAnnouncementImageDrafts()
		ticker := time.NewTicker(15 * time.Second)
		defer ticker.Stop()
		lastDraftCleanup := time.Now()
		for range ticker.C {
			s.drainResourceDeletionJobs(32)
			if time.Since(lastDraftCleanup) >= time.Hour {
				s.cleanupStaleAnnouncementImageDrafts()
				lastDraftCleanup = time.Now()
			}
		}
	}()
}

func (s *Service) drainResourceDeletionJobs(limit int) {
	owner := s.workerID
	if owner == "" {
		owner = newID()
	}
	for index := 0; index < limit; index++ {
		job, err := s.repo.ClaimNextResourceDeletionJob(owner, resourceDeletionLease)
		if err != nil {
			log.Printf("resource deletion worker claim failed: %v", err)
			return
		}
		if job == nil {
			return
		}
		resource := &model.Resource{
			ID: job.ResourceID, UserID: job.UserID, Provider: job.Provider,
			Endpoint: job.Endpoint, Bucket: job.Bucket, StorageSettingID: job.StorageSettingID,
			ObjectKey: job.ObjectKey,
		}
		if err := s.deleteStoredResourceObject(job.UserID, resource); err != nil {
			delay := resourceDeletionRetryDelay(job.Attempts)
			if retryErr := s.repo.RetryResourceDeletionJob(job.ID, owner, err.Error(), time.Now().Add(delay)); retryErr != nil {
				log.Printf("resource deletion worker retry update failed for %s: %v", job.ID, retryErr)
			}
			continue
		}
		if err := s.repo.CompleteResourceDeletionJob(job.ID, owner); err != nil {
			log.Printf("resource deletion worker completion failed for %s: %v", job.ID, err)
		}
	}
}

func resourceDeletionRetryDelay(attempts int) time.Duration {
	exponent := math.Min(float64(max(attempts-1, 0)), 8)
	return time.Duration(math.Pow(2, exponent)) * 15 * time.Second
}
