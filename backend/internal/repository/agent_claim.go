package repository

import (
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
	"time"
	"yingce/backend/internal/model"
)

func (r *Repository) AgentSchedulerSetting(fallback model.AgentSchedulerSetting) (model.AgentSchedulerSetting, error) {
	if !r.db.Migrator().HasTable(&model.AgentSchedulerSetting{}) {
		return fallback, nil
	}
	var p model.AgentSchedulerSetting
	err := r.db.First(&p, 1).Error
	if err == gorm.ErrRecordNotFound {
		return fallback, nil
	}
	return p, err
}

// SetAgentSchedulerSessionLimit CAS-updates the resident session cap. The
// revision guard is optimistic like every other scheduler write; a concurrent
// update surfaces as ErrCreationConflict.
func (r *Repository) SetAgentSchedulerSessionLimit(limit int, expected int64) (model.AgentSchedulerSetting, error) {
	var next model.AgentSchedulerSetting
	err := r.db.Transaction(func(tx *gorm.DB) error {
		var current model.AgentSchedulerSetting
		if err := tx.First(&current, 1).Error; err != nil {
			if err != gorm.ErrRecordNotFound {
				return err
			}
			current = model.DefaultAgentSchedulerSetting()
		}
		// The counter row is touched (never appended) through the CAS so the
		// claim serialization point and policy writes stay one linearization.
		if err := tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&model.AgentAdmissionCounter{ID: 1}).Error; err != nil {
			return err
		}
		if err := tx.Model(&model.AgentAdmissionCounter{}).Where("id = ?", 1).UpdateColumn("value", gorm.Expr("value + 0")).Error; err != nil {
			return err
		}
		next = current
		next.MaxResidentSessions = limit
		next.Revision = current.Revision + 1
		next.UpdatedAt = time.Now().UTC()
		result := tx.Model(&model.AgentSchedulerSetting{}).
			Where("id = 1 AND revision = ?", current.Revision).
			Updates(map[string]any{"max_resident_sessions": next.MaxResidentSessions, "revision": next.Revision, "updated_at": next.UpdatedAt})
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected != 1 {
			return ErrCreationConflict
		}
		return tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&next).Error
	})
	return next, err
}

func admissionKey(run model.CloudAgentExecution) string {
	if run.CanvasID != "" {
		return run.UserID + ":" + run.CanvasID
	}
	return run.UserID + ":session:" + run.ConversationID + ":" + run.ID
}

// ClaimPiAgentRun fairly leases one claimable run to owner, serialized by the
// admission counter row (its lock lives until commit; on SQLite that is also
// the database write lock). Candidate lease columns compare in UTC — mixing a
// local time zone into these text comparisons makes future leases look expired
// (see the v83 migration note), so `now` must never lose its .UTC().
func (r *Repository) ClaimPiAgentRun(owner string, until time.Time, fallback model.AgentSchedulerSetting, userScope ...string) (*model.CloudAgentExecution, error) {
	var claimed *model.CloudAgentExecution
	err := r.db.Transaction(func(tx *gorm.DB) error {
		counter := model.AgentAdmissionCounter{ID: 1}
		if err := tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&counter).Error; err != nil {
			return err
		}
		// The write holds the row until commit (also acquires SQLite's write lock).
		if err := tx.Model(&counter).Where("id = ?", 1).UpdateColumn("value", gorm.Expr("value + 0")).Error; err != nil {
			return err
		}
		policy, err := New(tx).AgentSchedulerSetting(fallback)
		if err != nil {
			return err
		}
		now := time.Now().UTC()
		var candidates []model.CloudAgentExecution
		candidateQuery := tx.Where("engine = ? AND status IN ? AND (lease_expires_at IS NULL OR lease_expires_at < ?) AND (next_recovery_at IS NULL OR next_recovery_at <= ?)", "pi", []string{"queued", "running", "waiting_approval"}, now, now)
		if len(userScope) > 0 && userScope[0] != "" {
			candidateQuery = candidateQuery.Where("user_id = ?", userScope[0])
		}
		// 公平性在 P3 收窄为 FIFO：fork 的 round-robin 序列表随 P4 一并恢复；
		// 多用户混跑时的头插风险由常驻上限兜底（超限用户整户跳过）。
		if err := candidateQuery.Order("created_at,id").Find(&candidates).Error; err != nil {
			return err
		}
		var live []model.CloudAgentExecution
		if err := tx.Select("id", "user_id", "canvas_id", "conversation_id").Where("engine = ? AND status IN ? AND lease_expires_at > ?", "pi", []string{"queued", "running", "waiting_approval"}, now).Find(&live).Error; err != nil {
			return err
		}
		canvasCounts := map[string]int{}
		userCounts := map[string]int{}
		for _, run := range live {
			canvasCounts[admissionKey(run)]++
			userCounts[run.UserID]++
		}
		for _, candidate := range candidates {
			// 常驻上限到顶的账户整体让位：相位改成 waiting_resource，等待容量
			// 上报或租约释放后自然回到候选池。
			if userCounts[candidate.UserID] >= policy.MaxResidentPerUser || canvasCounts[admissionKey(candidate)] >= policy.MaxResidentPerCanvas {
				if candidate.Status == "queued" && candidate.RuntimePhase != "waiting_resource" {
					if err := tx.Model(&model.CloudAgentExecution{}).Where("id = ? AND revision = ?", candidate.ID, candidate.Revision).Updates(map[string]any{"runtime_phase": "waiting_resource", "revision": gorm.Expr("revision + 1")}).Error; err != nil {
						return err
					}
				}
				continue
			}
			updates := map[string]any{
				"lease_owner":      owner,
				"lease_expires_at": until,
				// 释放不清零、领取才前进：重领一定得到新的 fencing epoch。
				"lease_epoch":      gorm.Expr("lease_epoch + 1"),
				"next_recovery_at": nil,
				"status":           gorm.Expr("CASE WHEN status = 'queued' THEN 'running' ELSE status END"),
				"runtime_phase":    "ready",
				"revision":         gorm.Expr("revision + 1"),
			}
			result := tx.Model(&model.CloudAgentExecution{}).Where(
				"id = ? AND revision = ? AND engine = ? AND status IN ? AND (lease_expires_at IS NULL OR lease_expires_at < ?)",
				candidate.ID, candidate.Revision, "pi", []string{"queued", "running", "waiting_approval"}, now,
			).Updates(updates)
			if result.Error != nil {
				return result.Error
			}
			if result.RowsAffected != 1 {
				continue
			}
			// 在同一事务里回读，拿到 CAS 后的新 epoch 供 run grant 签发。
			var leased model.CloudAgentExecution
			if err := tx.Where("id = ?", candidate.ID).First(&leased).Error; err != nil {
				return err
			}
			claimed = &leased
			return nil
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	return claimed, nil
}

// AgentCapacityReport records one worker heartbeat and re-evaluates the phase
// of queued unleased runs. When at least one ready worker has free residency,
// runs blocked on capacity become claimable again.
func (r *Repository) AgentCapacityReport(owner string, p model.AgentCapacityReport) error {
	instance := model.AgentRuntimeInstance{ID: owner, Active: p.Active, Capacity: p.Capacity, ClaimReservations: p.ClaimReservations, DispatchActive: p.DispatchActive, ReadyQueued: p.ReadyQueued, Draining: p.Draining, Readiness: p.Readiness, ReadinessReason: p.ReadinessReason, AppliedConfigRevision: p.AppliedConfigRevision, UpdatedAt: time.Now().UTC()}
	return r.db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Clauses(clause.OnConflict{UpdateAll: true}).Create(&instance).Error; err != nil {
			return err
		}
		var instances []model.AgentRuntimeInstance
		if err := tx.Where("updated_at > ?", instance.UpdatedAt.Add(-45*time.Second)).Find(&instances).Error; err != nil {
			return err
		}
		var available int
		for _, row := range instances {
			if row.Readiness == "ready" && !row.Draining && row.Active+row.ClaimReservations < row.Capacity {
				available++
			}
		}
		if available == 0 {
			return nil
		}
		// 全 UTC：相位判定与租约候选使用同一条时间语义。
		return tx.Model(&model.CloudAgentExecution{}).
			Where("engine = ? AND status = ? AND runtime_phase = ? AND (lease_expires_at IS NULL OR lease_expires_at < ?)", "pi", "queued", "waiting_resource", time.Now().UTC()).
			Updates(map[string]any{"runtime_phase": "ready", "revision": gorm.Expr("revision + 1")}).Error
	})
}

func (r *Repository) AgentRuntimeInstances() ([]model.AgentRuntimeInstance, error) {
	var rows []model.AgentRuntimeInstance
	err := r.db.Order("id").Find(&rows).Error
	return rows, err
}

// ClaimablePiAgentRunCount counts runs any worker could claim right now: not
// leased (or lapsed), not waiting on a recovery backoff.
func (r *Repository) ClaimablePiAgentRunCount() int {
	var count int64
	now := time.Now().UTC()
	err := r.db.Model(&model.CloudAgentExecution{}).
		Where("engine = ? AND status IN ? AND (lease_expires_at IS NULL OR lease_expires_at < ?) AND (next_recovery_at IS NULL OR next_recovery_at <= ?)",
			"pi", []string{"queued", "running", "waiting_approval"}, now, now).
		Count(&count).Error
	if err != nil {
		return 0
	}
	return int(count)
}
