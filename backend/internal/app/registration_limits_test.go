package app

import (
	"context"
	"infinite-canvas/backend/internal/platform"
	"testing"
	"time"
)

func TestRequestRetryAfterMatchesWindow(t *testing.T) {
	s := &Service{coordinator: platform.NewCoordinatorWithRedis(nil, "registration-test")}
	ctx := context.Background()
	if ok, err := s.AllowRequest(ctx, "email-code:test", 1, time.Hour); err != nil || !ok {
		t.Fatal(err)
	}
	if ok, _ := s.AllowRequest(ctx, "email-code:test", 1, time.Hour); ok {
		t.Fatal("limit bypassed")
	}
	wait := s.RequestRetryAfter(ctx, "email-code:test", time.Hour)
	if wait < 59*time.Minute || wait > time.Hour {
		t.Fatalf("wrong wait: %v", wait)
	}
	if s.coordinator.LocalRateCount() != 1 {
		t.Fatal("rejection consumed quota")
	}
}
