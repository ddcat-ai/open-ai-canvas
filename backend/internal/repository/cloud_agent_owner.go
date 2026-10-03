package repository

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"infinite-canvas/backend/internal/model"
)

var ErrCloudAgentOwnerLost = errors.New("Agent execution owner is no longer valid")

const CloudAgentOwnerLeaseSeconds int64 = 120

func cloudAgentLease(run *model.CloudAgentExecution) (model.CloudAgentExecutionLease, error) {
	var state struct {
		Lease model.CloudAgentExecutionLease `json:"executionLease"`
	}
	err := json.Unmarshal([]byte(run.StateJSON), &state)
	return state.Lease, err
}

func setCloudAgentLease(run *model.CloudAgentExecution, lease model.CloudAgentExecutionLease) error {
	var state map[string]json.RawMessage
	if err := json.Unmarshal([]byte(run.StateJSON), &state); err != nil {
		return err
	}
	if state == nil {
		return fmt.Errorf("empty Agent checkpoint")
	}
	raw, err := json.Marshal(lease)
	if err != nil {
		return err
	}
	state["executionLease"] = raw
	raw, err = json.Marshal(state)
	if err == nil {
		run.StateJSON = string(raw)
	}
	return err
}

func (r *Repository) cloudAgentDatabaseTime() (int64, error) {
	query := "SELECT CAST(strftime('%s','now') AS INTEGER)"
	if r.Dialect() == "postgres" {
		query = "SELECT CAST(EXTRACT(EPOCH FROM clock_timestamp()) AS BIGINT)"
	}
	var now int64
	err := r.db.Raw(query).Scan(&now).Error
	return now, err
}

func (r *Repository) CheckCloudAgentOwner(run *model.CloudAgentExecution, fence *model.CloudAgentFence) error {
	return r.checkCloudAgentOwner(run, fence, false)
}

func (r *Repository) CheckCloudAgentPiSnapshotOwner(run *model.CloudAgentExecution, fence *model.CloudAgentFence) error {
	return r.checkCloudAgentOwner(run, fence, true)
}

func (r *Repository) checkCloudAgentOwner(run *model.CloudAgentExecution, fence *model.CloudAgentFence, finalSnapshot bool) error {
	terminalSnapshot := finalSnapshot && (run.Status == "completed" || run.Status == "failed")
	if fence == nil {
		if terminalSnapshot {
			return ErrCloudAgentOwnerLost
		}
		return nil
	}
	lease, err := cloudAgentLease(run)
	if err != nil {
		return err
	}
	now, err := r.cloudAgentDatabaseTime()
	if err != nil {
		return err
	}
	if fence.Token == "" || fence.Epoch < 1 || lease.Token != fence.Token || lease.Epoch != fence.Epoch || lease.LeaseUntil <= now || (run.Status != "running" && run.Status != "queued" && run.Status != "waiting_approval" && !terminalSnapshot) {
		return ErrCloudAgentOwnerLost
	}
	return nil
}

// Ownership is checked after the run CAS has acquired the database write lock.
func (r *Repository) MutateCloudAgentRun(run *model.CloudAgentExecution, fn func(*model.CloudAgentExecution, *Repository) error) error {
	return r.MutateCloudAgent(run.UserID, run.ID, run.Revision, func(current *model.CloudAgentExecution, repo *Repository) error {
		if err := repo.CheckCloudAgentOwner(current, run.ExecutionFence); err != nil {
			return err
		}
		current.ExecutionFence = run.ExecutionFence
		return fn(current, repo)
	})
}

// Only the native Pi journal may flush after a tool completes or fails its run.
// Its original, unexpired owner is still required; all ordinary writes retain
// the running-state check above.
func (r *Repository) MutateCloudAgentPiSnapshot(run *model.CloudAgentExecution, fn func(*model.CloudAgentExecution, *Repository) error) error {
	return r.MutateCloudAgent(run.UserID, run.ID, run.Revision, func(current *model.CloudAgentExecution, repo *Repository) error {
		if err := repo.checkCloudAgentOwner(current, run.ExecutionFence, true); err != nil {
			return err
		}
		current.ExecutionFence = run.ExecutionFence
		return fn(current, repo)
	})
}

func (r *Repository) ClaimCloudAgentOwner(userID, runID string) (*model.CloudAgentFence, error) {
	var token [24]byte
	if _, err := rand.Read(token[:]); err != nil {
		return nil, err
	}
	fence := &model.CloudAgentFence{Token: hex.EncodeToString(token[:])}
	err := r.changeCloudAgentOwner(userID, runID, nil, func(run *model.CloudAgentExecution, repo *Repository, now int64) error {
		lease, err := cloudAgentLease(run)
		if err != nil {
			return err
		}
		if lease.Token != "" && lease.LeaseUntil > now {
			return ErrCloudAgentOwnerLost
		}
		if run.Status != "running" && run.Status != "queued" {
			return ErrCloudAgentOwnerLost
		}
		fence.Epoch = lease.Epoch + 1
		return setCloudAgentLease(run, model.CloudAgentExecutionLease{CloudAgentFence: *fence, LeaseUntil: now + CloudAgentOwnerLeaseSeconds})
	})
	return fence, err
}

func (r *Repository) changeCloudAgentOwner(userID, runID string, fence *model.CloudAgentFence, fn func(*model.CloudAgentExecution, *Repository, int64) error) error {
	for attempt := 0; attempt < 8; attempt++ {
		run, err := r.CloudAgent(userID, runID)
		if err != nil {
			return err
		}
		err = r.MutateCloudAgent(userID, runID, run.Revision, func(current *model.CloudAgentExecution, repo *Repository) error {
			if fence != nil {
				lease, err := cloudAgentLease(current)
				if err != nil {
					return err
				}
				if lease.Token != fence.Token || lease.Epoch != fence.Epoch {
					return ErrCloudAgentOwnerLost
				}
			}
			now, err := repo.cloudAgentDatabaseTime()
			if err != nil {
				return err
			}
			return fn(current, repo, now)
		})
		if !errors.Is(err, ErrCreationConflict) {
			return err
		}
	}
	return ErrCreationConflict
}

func (r *Repository) RenewCloudAgentOwner(userID, runID string, fence *model.CloudAgentFence) error {
	if fence == nil {
		return ErrCloudAgentOwnerLost
	}
	return r.changeCloudAgentOwner(userID, runID, fence, func(run *model.CloudAgentExecution, repo *Repository, now int64) error {
		if err := repo.CheckCloudAgentOwner(run, fence); err != nil {
			return err
		}
		return setCloudAgentLease(run, model.CloudAgentExecutionLease{CloudAgentFence: *fence, LeaseUntil: now + CloudAgentOwnerLeaseSeconds})
	})
}

func (r *Repository) ReleaseCloudAgentOwner(userID, runID string, fence *model.CloudAgentFence) error {
	if fence == nil {
		return ErrCloudAgentOwnerLost
	}
	return r.changeCloudAgentOwner(userID, runID, fence, func(run *model.CloudAgentExecution, _ *Repository, _ int64) error {
		return setCloudAgentLease(run, model.CloudAgentExecutionLease{CloudAgentFence: model.CloudAgentFence{Epoch: fence.Epoch}})
	})
}
