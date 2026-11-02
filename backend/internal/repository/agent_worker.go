package repository

import (
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"time"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
	"yingce/backend/internal/model"
)

func agentWorkerHash(secret string) string {
	sum := sha256.Sum256([]byte(secret))
	return hex.EncodeToString(sum[:])
}

func (r *Repository) ProvisionAgentWorker(id, secret, userID string) error {
	return r.db.Create(&model.AgentWorker{ID: id, SecretHash: agentWorkerHash(secret), UserID: userID}).Error
}

// SeedAgentWorker is insert-only: restarting the backend cannot undo revocation
// or rotate an administrator-provisioned credential back to an old value.
func (r *Repository) SeedAgentWorker(id, secret, userID string) error {
	return r.db.Clauses(clause.OnConflict{DoNothing: true}).Create(&model.AgentWorker{ID: id, SecretHash: agentWorkerHash(secret), UserID: userID}).Error
}

func (r *Repository) AgentWorker(id string) (*model.AgentWorker, error) {
	var worker model.AgentWorker
	if err := r.db.Where("id = ?", id).First(&worker).Error; err != nil {
		return nil, err
	}
	return &worker, nil
}

func (r *Repository) AuthenticateAgentWorker(id, secret string) (*model.AgentWorker, error) {
	worker, err := r.AgentWorker(id)
	if err != nil {
		return nil, err
	}
	provided := agentWorkerHash(secret)
	// Constant-time over digests: length differences can never short-circuit.
	if worker.RevokedAt != nil || subtle.ConstantTimeCompare([]byte(provided), []byte(worker.SecretHash)) != 1 {
		return nil, gorm.ErrRecordNotFound
	}
	return worker, nil
}

func (r *Repository) RevokeAgentWorker(id string) error {
	result := r.db.Model(&model.AgentWorker{}).Where("id = ? AND revoked_at IS NULL", id).Update("revoked_at", time.Now().UTC())
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected != 1 {
		return gorm.ErrRecordNotFound
	}
	return nil
}

func (r *Repository) ListAgentWorkers() ([]model.AgentWorker, error) {
	var workers []model.AgentWorker
	err := r.db.Order("created_at,id").Find(&workers).Error
	return workers, err
}

// AgentRunAuthorization revalidates the current database lease before a run
// grant is issued or accepted: terminal/expired/foreign/older-epoch leases all
// fail closed. P3 keeps the check on the run row itself (the Pi session table
// join arrives with P4's snapshot contract).
func (r *Repository) AgentRunAuthorization(userID, runID, owner string, epoch int64) bool {
	var count int64
	// 租约列按 UTC 写入与比较；本地时区混入会让未来租约被判过期。
	now := time.Now().UTC()
	err := r.db.Table("cloud_agent_executions AS run").
		Where("run.id = ? AND run.user_id = ? AND run.engine = ? AND run.lease_owner = ? AND run.lease_epoch = ? AND run.lease_expires_at > ? AND run.status IN ?",
			runID, userID, "pi", owner, epoch, now, []string{"running", "waiting_approval"}).
		Count(&count).Error
	return err == nil && count == 1
}
