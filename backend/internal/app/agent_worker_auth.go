package app

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"os"
	"regexp"
	"strings"
	"time"

	"gorm.io/gorm"
	"yingce/backend/internal/kernel"
	"yingce/backend/internal/model"
)

var agentWorkerIDPattern = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$`)
var agentWorkerOwnerSuffixPattern = regexp.MustCompile(`^[A-Za-z0-9._-]{1,15}$`)

// AgentWorkerOwnsOwner requires a capacity/claim owner to be a slot of the
// authenticated worker ("workerID:suffix"); a slot keeps concurrent worker
// processes of one deployment distinguishable.
func (s *Service) AgentWorkerOwnsOwner(workerID, owner string) bool {
	if !agentWorkerIDPattern.MatchString(workerID) || len(owner) > 80 || !strings.HasPrefix(owner, workerID+":") {
		return false
	}
	return agentWorkerOwnerSuffixPattern.MatchString(strings.TrimPrefix(owner, workerID+":"))
}

// AgentRunGrant is the short-lived run authorization a worker spends on
// run-scoped requests. It is HMAC'd by the internal control-plane token —
// the worker itself only receives grants, never the key.
type AgentRunGrant struct {
	WorkerID string `json:"workerId"`
	Owner    string `json:"owner"`
	UserID   string `json:"userId"`
	RunID    string `json:"runId"`
	Epoch    int64  `json:"epoch"`
	Expires  int64  `json:"expires"`
}

// The signing key belongs only to the control plane. Node has a distinct
// registry credential and receives only individual short-lived grants.
func agentGrantKey() []byte { return []byte(os.Getenv("CANVAS_AGENT_INTERNAL_TOKEN")) }

func (s *Service) SeedAgentWorker() error {
	id, secret := os.Getenv("CANVAS_AGENT_WORKER_ID"), os.Getenv("CANVAS_AGENT_WORKER_TOKEN")
	if id == "" && secret == "" {
		return nil
	}
	if !agentWorkerIDPattern.MatchString(id) || len(secret) < 32 {
		return errors.New("invalid worker bootstrap credential")
	}
	return s.repo.SeedAgentWorker(id, secret, os.Getenv("CANVAS_AGENT_WORKER_USER_ID"))
}

// P2 env fallback remains as the bootstrap path: v83 registers the env
// credential into the insert-only table at startup, then authentication goes
// through the table (so revocation is irreversible across restarts).
func (s *Service) AuthenticateAgentWorker(id, secret string) (*model.AgentWorker, error) {
	if !agentWorkerIDPattern.MatchString(id) || secret == "" {
		return nil, gorm.ErrRecordNotFound
	}
	if s.repo == nil {
		return nil, gorm.ErrRecordNotFound
	}
	return s.repo.AuthenticateAgentWorker(id, secret)
}

func (s *Service) IssueAgentRunGrant(workerID, owner, userID, runID string, epoch int64) (string, error) {
	if len(agentGrantKey()) < 32 || epoch <= 0 || !s.AgentWorkerOwnsOwner(workerID, owner) || !s.repo.AgentRunAuthorization(userID, runID, owner, epoch) {
		return "", kernel.Unauthorized("invalid agent run lease")
	}
	worker, err := s.repo.AgentWorker(workerID)
	if err != nil || worker.RevokedAt != nil || (worker.UserID != "" && worker.UserID != userID) {
		return "", kernel.Unauthorized("invalid agent worker")
	}
	grant := AgentRunGrant{WorkerID: workerID, Owner: owner, UserID: userID, RunID: runID, Epoch: epoch, Expires: time.Now().UTC().Add(5 * time.Minute).Unix()}
	body, err := json.Marshal(grant)
	if err != nil {
		return "", err
	}
	payload := base64.RawURLEncoding.EncodeToString(body)
	mac := hmac.New(sha256.New, agentGrantKey())
	mac.Write([]byte(payload))
	return "run." + payload + "." + base64.RawURLEncoding.EncodeToString(mac.Sum(nil)), nil
}

func (s *Service) ValidateAgentRunGrant(token, userID, runID, workerOwner string, epoch int64) bool {
	parts := strings.Split(token, ".")
	if len(parts) != 3 || parts[0] != "run" || len(agentGrantKey()) < 32 {
		return false
	}
	signature, err := base64.RawURLEncoding.DecodeString(parts[2])
	if err != nil {
		return false
	}
	mac := hmac.New(sha256.New, agentGrantKey())
	mac.Write([]byte(parts[1]))
	if !hmac.Equal(signature, mac.Sum(nil)) {
		return false
	}
	body, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil || len(body) > 2048 {
		return false
	}
	var grant AgentRunGrant
	if json.Unmarshal(body, &grant) != nil || grant.Expires <= time.Now().UTC().Unix() || grant.Expires > time.Now().UTC().Add(5*time.Minute).Unix() || grant.UserID != userID || grant.RunID != runID || grant.Owner != workerOwner || grant.Epoch != epoch {
		return false
	}
	worker, err := s.repo.AgentWorker(grant.WorkerID)
	if err != nil || worker.RevokedAt != nil || (worker.UserID != "" && worker.UserID != userID) || !s.AgentWorkerOwnsOwner(grant.WorkerID, grant.Owner) {
		return false
	}
	return s.repo.AgentRunAuthorization(userID, runID, grant.Owner, grant.Epoch)
}

// The caller must first pass ValidateAgentRunGrant on the same request; this
// helper only re-parses the decoded identity for grant re-issue.
func (s *Service) AgentRunGrantWorker(token string) (string, error) {
	parts := strings.Split(token, ".")
	if len(parts) != 3 {
		return "", errors.New("invalid run authorization")
	}
	body, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		return "", err
	}
	var grant AgentRunGrant
	if err := json.Unmarshal(body, &grant); err != nil {
		return "", err
	}
	return grant.WorkerID, nil
}
