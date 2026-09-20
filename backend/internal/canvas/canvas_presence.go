package canvas

import (
	"context"
	"encoding/json"
	"infinite-canvas/backend/internal/kernel"
	"sort"
	"strings"
	"time"
	"unicode"

	"infinite-canvas/backend/internal/model"

	"github.com/redis/go-redis/v9"
)

const canvasPresenceTTL = 15 * time.Second
const canvasPresenceRedisPrefix = "canvas:presence:"

// CanvasPresence is intentionally ephemeral. It is not a canvas operation,
// does not advance revision, and is never included in history snapshots.
type CanvasPresence struct {
	SessionID   string                  `json:"sessionId"`
	UserID      string                  `json:"userId"`
	DisplayName string                  `json:"displayName"`
	Activity    CanvasPresenceActivity  `json:"activity"`
	Cursor      *CanvasPresenceCursor   `json:"cursor,omitempty"`
	Viewport    *CanvasPresenceViewport `json:"viewport,omitempty"`
	LastSeenAt  time.Time               `json:"lastSeenAt"`
}

type CanvasPresenceActivity struct {
	Kind   string `json:"kind"`
	NodeID string `json:"nodeId,omitempty"`
}

type CanvasPresenceCursor struct {
	X float64 `json:"x"`
	Y float64 `json:"y"`
}

type CanvasPresenceViewport struct {
	X float64 `json:"x"`
	Y float64 `json:"y"`
	K float64 `json:"k"`
}

type CanvasPresenceUpdate struct {
	SessionID string                  `json:"sessionId"`
	Activity  CanvasPresenceActivity  `json:"activity"`
	Cursor    *CanvasPresenceCursor   `json:"cursor,omitempty"`
	Viewport  *CanvasPresenceViewport `json:"viewport,omitempty"`
}

func (s *Service) UpsertCanvasPresence(actor *model.User, canvasID string, update CanvasPresenceUpdate) (CanvasPresence, error) {
	if err := s.requireCanvasCollaborationAccess(actor, canvasID, false); err != nil {
		return CanvasPresence{}, err
	}
	sessionID := strings.TrimSpace(update.SessionID)
	if !validCanvasPresenceSessionID(sessionID) {
		return CanvasPresence{}, kernel.BadAuthRequest("协作会话无效")
	}
	activity := update.Activity
	if !validCanvasPresenceActivity(activity.Kind) {
		activity.Kind = "viewing"
	}
	if len(activity.NodeID) > 120 {
		activity.NodeID = activity.NodeID[:120]
	}
	now := time.Now().UTC()
	presence := CanvasPresence{
		SessionID:   sessionID,
		UserID:      actor.ID,
		DisplayName: strings.TrimSpace(actor.DisplayName),
		Activity:    activity,
		Cursor:      clampCanvasPresenceCursor(update.Cursor),
		Viewport:    normalizeCanvasPresenceViewport(update.Viewport),
		LastSeenAt:  now,
	}
	if presence.DisplayName == "" {
		presence.DisplayName = actor.Username
	}
	field := canvasPresenceField(actor.ID, sessionID)
	// Redis is shared by all API instances. Keep a local shadow as a graceful
	// fallback for a transient Redis outage and for single-instance development.
	s.storeCanvasPresenceLocal(canvasID, field, presence)
	if client := s.canvasPresenceRedis(); client != nil {
		if payload, marshalErr := json.Marshal(presence); marshalErr == nil {
			ctx, cancel := context.WithTimeout(context.Background(), 800*time.Millisecond)
			writeErr := client.HSet(ctx, canvasPresenceRedisKey(canvasID), field, payload).Err()
			if writeErr == nil {
				writeErr = client.Expire(ctx, canvasPresenceRedisKey(canvasID), canvasPresenceTTL).Err()
			}
			cancel()
			if writeErr != nil {
				// The next heartbeat retries Redis; the local shadow still keeps
				// this instance useful while the shared store is unavailable.
			}
		}
	}
	return presence, nil
}

func (s *Service) CanvasPresenceForUser(actor *model.User, canvasID string) ([]CanvasPresence, error) {
	if err := s.requireCanvasCollaborationAccess(actor, canvasID, false); err != nil {
		return nil, err
	}
	now := time.Now().UTC()
	items := s.readCanvasPresenceShared(canvasID)
	result := make([]CanvasPresence, 0, len(items))
	for _, item := range items {
		if !freshCanvasPresence(now, item.LastSeenAt) || item.UserID == actor.ID {
			continue
		}
		result = append(result, item)
	}
	sort.Slice(result, func(i, j int) bool {
		if result[i].DisplayName == result[j].DisplayName {
			return result[i].UserID+result[i].SessionID < result[j].UserID+result[j].SessionID
		}
		return result[i].DisplayName < result[j].DisplayName
	})
	return result, nil
}

func (s *Service) RemoveCanvasPresence(actor *model.User, canvasID, sessionID string) error {
	if err := s.requireCanvasCollaborationAccess(actor, canvasID, false); err != nil {
		return err
	}
	sessionID = strings.TrimSpace(sessionID)
	if !validCanvasPresenceSessionID(sessionID) {
		return kernel.BadAuthRequest("协作会话无效")
	}
	field := canvasPresenceField(actor.ID, sessionID)
	s.canvasPresenceMu.Lock()
	if items := s.canvasPresence[canvasID]; items != nil {
		delete(items, field)
		if len(items) == 0 {
			delete(s.canvasPresence, canvasID)
		}
	}
	s.canvasPresenceMu.Unlock()
	if client := s.canvasPresenceRedis(); client != nil {
		ctx, cancel := context.WithTimeout(context.Background(), 800*time.Millisecond)
		_ = client.HDel(ctx, canvasPresenceRedisKey(canvasID), field).Err()
		cancel()
	}
	return nil
}

func (s *Service) canvasPresenceRedis() *redis.Client {
	if s == nil {
		return nil
	}
	if provider, ok := s.host.(interface{ CanvasRedis() *redis.Client }); ok {
		return provider.CanvasRedis()
	}
	return nil
}

func canvasPresenceRedisKey(canvasID string) string {
	return canvasPresenceRedisPrefix + strings.TrimSpace(canvasID)
}

func canvasPresenceField(userID, sessionID string) string {
	return userID + ":" + sessionID
}

func (s *Service) storeCanvasPresenceLocal(canvasID, field string, presence CanvasPresence) {
	s.canvasPresenceMu.Lock()
	defer s.canvasPresenceMu.Unlock()
	if s.canvasPresence == nil {
		s.canvasPresence = make(map[string]map[string]CanvasPresence)
	}
	if s.canvasPresence[canvasID] == nil {
		s.canvasPresence[canvasID] = make(map[string]CanvasPresence)
	}
	s.canvasPresence[canvasID][field] = presence
}

func (s *Service) readCanvasPresenceShared(canvasID string) []CanvasPresence {
	byField := make(map[string]CanvasPresence)
	s.canvasPresenceMu.Lock()
	for field, item := range s.canvasPresence[canvasID] {
		if !freshCanvasPresence(time.Now().UTC(), item.LastSeenAt) {
			delete(s.canvasPresence[canvasID], field)
			continue
		}
		byField[field] = item
	}
	if len(s.canvasPresence[canvasID]) == 0 {
		delete(s.canvasPresence, canvasID)
	}
	s.canvasPresenceMu.Unlock()

	if client := s.canvasPresenceRedis(); client != nil {
		ctx, cancel := context.WithTimeout(context.Background(), 800*time.Millisecond)
		values, err := client.HGetAll(ctx, canvasPresenceRedisKey(canvasID)).Result()
		cancel()
		if err == nil {
			stale := make([]string, 0)
			for field, payload := range values {
				var item CanvasPresence
				if json.Unmarshal([]byte(payload), &item) != nil {
					stale = append(stale, field)
					continue
				}
				if !freshCanvasPresence(time.Now().UTC(), item.LastSeenAt) {
					stale = append(stale, field)
					continue
				}
				byField[field] = item
			}
			if len(stale) > 0 {
				ctx, cancel = context.WithTimeout(context.Background(), 800*time.Millisecond)
				_ = client.HDel(ctx, canvasPresenceRedisKey(canvasID), stale...).Err()
				cancel()
			}
		}
	}
	return valuesFromPresenceMap(byField)
}

func (s *Service) removeCanvasPresenceForUser(canvasID, userID string) {
	prefix := userID + ":"
	s.canvasPresenceMu.Lock()
	if items := s.canvasPresence[canvasID]; items != nil {
		for field := range items {
			if strings.HasPrefix(field, prefix) {
				delete(items, field)
			}
		}
		if len(items) == 0 {
			delete(s.canvasPresence, canvasID)
		}
	}
	s.canvasPresenceMu.Unlock()
	if client := s.canvasPresenceRedis(); client != nil {
		ctx, cancel := context.WithTimeout(context.Background(), 800*time.Millisecond)
		values, err := client.HGetAll(ctx, canvasPresenceRedisKey(canvasID)).Result()
		if err == nil {
			fields := make([]string, 0)
			for field := range values {
				if strings.HasPrefix(field, prefix) {
					fields = append(fields, field)
				}
			}
			if len(fields) > 0 {
				_ = client.HDel(ctx, canvasPresenceRedisKey(canvasID), fields...).Err()
			}
		}
		cancel()
	}
}

func valuesFromPresenceMap(items map[string]CanvasPresence) []CanvasPresence {
	result := make([]CanvasPresence, 0, len(items))
	for _, item := range items {
		result = append(result, item)
	}
	return result
}

func freshCanvasPresence(now, seen time.Time) bool {
	if seen.IsZero() {
		return false
	}
	// Treat malformed/far-future timestamps as stale. This avoids a bad clock
	// or payload leaving a cursor visible forever.
	return !now.Before(seen.Add(-canvasPresenceTTL)) && now.Sub(seen) <= canvasPresenceTTL
}

func validCanvasPresenceSessionID(value string) bool {
	if value == "" || len(value) > 120 {
		return false
	}
	for _, char := range value {
		if unicode.IsSpace(char) || unicode.IsControl(char) {
			return false
		}
		if !(unicode.IsLetter(char) || unicode.IsDigit(char) || strings.ContainsRune("-_.:", char)) {
			return false
		}
	}
	return true
}

func validCanvasPresenceActivity(kind string) bool {
	switch kind {
	case "viewing", "typing", "dragging", "resizing", "connecting", "generating":
		return true
	default:
		return false
	}
}

func clampCanvasPresenceCursor(value *CanvasPresenceCursor) *CanvasPresenceCursor {
	if value == nil || value.X != value.X || value.Y != value.Y {
		return nil
	}
	if value.X < -100000 || value.X > 100000 || value.Y < -100000 || value.Y > 100000 {
		return nil
	}
	return &CanvasPresenceCursor{X: value.X, Y: value.Y}
}

func normalizeCanvasPresenceViewport(value *CanvasPresenceViewport) *CanvasPresenceViewport {
	if value == nil || value.X != value.X || value.Y != value.Y || value.K != value.K {
		return nil
	}
	if value.K < 0.05 {
		value.K = 0.05
	}
	if value.K > 2 {
		value.K = 2
	}
	return &CanvasPresenceViewport{X: value.X, Y: value.Y, K: value.K}
}
