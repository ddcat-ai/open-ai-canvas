package service

import (
	"context"
	"log"
	"math"
	"time"

	"infinite-canvas/backend/internal/model"
)

const resourceDeletionLease = 2 * time.Minute

func (s *Service) startResourceDeletionWorker(ctx context.Context) {
	s.runWorkerLoop(func(ctx context.Context) {
		s.drainResourceDeletionJobs(32)
		s.cleanupStaleAnnouncementImageDrafts()
		s.cleanupExpiredArchivedAssets()
		ticker := time.NewTicker(15 * time.Second)
		defer ticker.Stop()
		lastPeriodicCleanup := time.Now()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				s.drainResourceDeletionJobs(32)
				if time.Since(lastPeriodicCleanup) >= time.Hour {
					s.cleanupStaleAnnouncementImageDrafts()
					s.cleanupExpiredArchivedAssets()
					lastPeriodicCleanup = time.Now()
				}
			}
		}
	})
}

func (s *Service) cleanupExpiredArchivedAssets() {
	policy, err := s.RuntimePolicy()
	if err != nil {
		return
	}
	retentionDays := policy.Resource.RecycleBinRetentionDays
	if retentionDays <= 0 {
		return
	}
	cutoff := time.Now().Add(-time.Duration(retentionDays) * 24 * time.Hour)
	expired, err := s.repo.FindExpiredArchivedAssets(cutoff, 100)
	if err != nil {
		log.Printf("expired archived assets query failed: %v", err)
		return
	}
	deleted := 0
	for _, asset := range expired {
		// 自动清理与用户手动删除走同一条强校验路径：先检查业务引用，
		// 再以事务 + Outbox 删除资源记录和物理对象，不能从 repository 旁路。
		if err := s.DeleteUserAsset(asset.UserID, asset.ID); err != nil {
			log.Printf("expired archived asset delete failed for %s: %v", asset.ID, err)
			continue
		}
		deleted++
	}
	if deleted > 0 {
		log.Printf("recycle bin cleanup: deleted %d expired assets (retention: %d days)", deleted, retentionDays)
	}
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
