package app

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"strings"

	"gorm.io/gorm"
	"yingce/backend/internal/repository"
)

// CreateExternalDrama gives MCP retries a stable project identity before any work is scheduled.
func (s *Service) CreateExternalDrama(userID, idempotencyKey string, req CreateDramaRequest) (DramaSummary, error) {
	key := strings.TrimSpace(idempotencyKey)
	if len(key) < 8 || len(key) > 128 {
		return DramaSummary{}, BadAuthRequest("创建作品需要 8–128 位幂等键")
	}
	encoded, err := json.Marshal(req)
	if err != nil {
		return DramaSummary{}, err
	}
	fingerprint := sha256.Sum256(encoded)
	requestHash := hex.EncodeToString(fingerprint[:])
	idHash := sha256.Sum256([]byte("external-drama\x00" + userID + "\x00" + key))
	projectID := hex.EncodeToString(idHash[:16])
	existing, lookupErr := s.repo.ProjectForUser(userID, projectID)
	if lookupErr == nil {
		if existing.ExternalRequestHash != requestHash {
			return DramaSummary{}, BadAuthRequest("幂等键已用于不同作品请求")
		}
		return s.DramaSummary(userID, projectID)
	}
	if !errors.Is(lookupErr, gorm.ErrRecordNotFound) {
		return DramaSummary{}, lookupErr
	}
	creation, err := s.prepareDramaCreation(userID, projectID, req)
	if err != nil {
		return DramaSummary{}, err
	}
	creation.project.ExternalRequestHash = requestHash
	if err := s.repo.CreateDramaProject(&creation.project, creation.chapters, &creation.production, creation.episodes...); err != nil {
		if raced, lookupErr := s.repo.ProjectForUser(userID, projectID); lookupErr == nil {
			if raced.ExternalRequestHash != requestHash {
				return DramaSummary{}, BadAuthRequest("幂等键已用于不同作品请求")
			}
			return s.DramaSummary(userID, projectID)
		}
		if errors.Is(err, repository.ErrProjectNameConflict) {
			return DramaSummary{}, dramaNameConflict()
		}
		return DramaSummary{}, err
	}
	s.wakeDramaScheduler()
	return s.DramaSummary(userID, projectID)
}
