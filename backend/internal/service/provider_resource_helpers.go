package service

import (
	"errors"
	"time"

	"infinite-canvas/backend/internal/model"
)

// ResourceForUser is the service-layer ownership check used by provider workers.
func (s *Service) ResourceForUser(actor *model.User, id string) (*model.Resource, error) {
	if actor == nil || actor.ID == "" {
		return nil, errors.New("用户身份无效")
	}
	return s.repo.ResourceForUser(actor.ID, id)
}

// providerResourceURL gives an upstream a short-lived URL after the resource
// ownership and ready-state checks have already been performed.
func (s *Service) providerResourceURL(resource *model.Resource, expiresAt time.Time) (string, error) {
	return s.directResourceURL(resource, expiresAt)
}
