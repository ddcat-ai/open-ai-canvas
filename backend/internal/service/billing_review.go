package service

import (
	"log"
	"time"
)

const billingReviewStaleAfter = 15 * time.Minute

// AuditBillingReview 执行只读账单巡检，提醒运维及时进入人工核对链路。
// 资金状态必须由人工依据上游证据结算或退款，巡检不能代替资金动作。
func (s *Service) AuditBillingReview() error {
	stats, err := s.repo.StaleBillingReviewStats(time.Now(), billingReviewStaleAfter)
	if err != nil {
		return err
	}
	if stats.Total() == 0 {
		return nil
	}
	oldest := ""
	if stats.Oldest != nil {
		oldest = stats.Oldest.UTC().Format(time.RFC3339)
	}
	log.Printf("billing review audit stale_orders=%d reserved=%d running=%d uncertain=%d oldest=%s", stats.Total(), stats.Reserved, stats.Running, stats.Uncertain, oldest)
	return nil
}

func (s *Service) startBillingReviewAudit() {
	audit := func() {
		if err := s.AuditBillingReview(); err != nil {
			log.Printf("billing review audit failed: %v", err)
		}
	}
	audit()
	go func() {
		ticker := time.NewTicker(time.Hour)
		defer ticker.Stop()
		for range ticker.C {
			audit()
		}
	}()
}
