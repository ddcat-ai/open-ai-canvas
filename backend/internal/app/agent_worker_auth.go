package app

import (
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"os"
	"regexp"
	"strings"

	"gorm.io/gorm"
	"yingce/backend/internal/model"
)

var agentWorkerIDPattern = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$`)
var agentWorkerOwnerSuffixPattern = regexp.MustCompile(`^[A-Za-z0-9._-]{1,15}$`)

// AgentWorkerOwnsOwner requires a capacity/claim owner to be a slot of the
// authenticated worker ("workerID:suffix"); a suffix keeps concurrent worker
// processes of the same deployment distinguishable.
func (s *Service) AgentWorkerOwnsOwner(workerID, owner string) bool {
	if !agentWorkerIDPattern.MatchString(workerID) || len(owner) > 80 || !strings.HasPrefix(owner, workerID+":") {
		return false
	}
	return agentWorkerOwnerSuffixPattern.MatchString(strings.TrimPrefix(owner, workerID+":"))
}

func agentWorkerSecretDigest(secret string) string {
	sum := sha256.Sum256([]byte(secret))
	return hex.EncodeToString(sum[:])
}

// P2 bootstrap: the worker identity lives in process env until the first
// migration lands (RFC #943 P3 swaps the backing store to the agent_workers
// table without touching handlers). Both variables must be present and strong;
// compare digests with constant time so token length is never observable.
func (s *Service) AuthenticateAgentWorker(id, secret string) (*model.AgentWorker, error) {
	if !agentWorkerIDPattern.MatchString(id) || len(secret) < 32 {
		return nil, gorm.ErrRecordNotFound
	}
	expectID := strings.TrimSpace(os.Getenv("CANVAS_AGENT_WORKER_ID"))
	expectSecret := os.Getenv("CANVAS_AGENT_WORKER_TOKEN")
	if expectID == "" || len(expectSecret) < 32 || expectID != id {
		return nil, gorm.ErrRecordNotFound
	}
	if subtle.ConstantTimeCompare([]byte(agentWorkerSecretDigest(secret)), []byte(agentWorkerSecretDigest(expectSecret))) != 1 {
		return nil, gorm.ErrRecordNotFound
	}
	// 非空 UserID 限定单租户领取；空 UserID 是显式的全局 Worker。
	return &model.AgentWorker{ID: id, UserID: strings.TrimSpace(os.Getenv("CANVAS_AGENT_WORKER_USER_ID"))}, nil
}
